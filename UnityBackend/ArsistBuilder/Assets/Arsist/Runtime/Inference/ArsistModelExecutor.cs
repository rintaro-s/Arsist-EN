// ==============================================
// Arsist Engine - Inference
// 実機の推論器: Unity Inference Engine (旧 Sentis)
//
// どのモデルも「名前つきのテンソル → 名前つきのテンソル」として動かす。画像認識の `infer` op も、
// スクリプトの model.run / generate / embed も、ここを通る。
//
// Inference Engine はメインスレッドからしか触れない:
//   スクリプト:   Run(…, done) → 依頼を積む。Update で Schedule → 非同期 readback → 完了で done
//                 (done もメインスレッド)
//   画像認識:     ワーカースレッドの TryRun → 同じ依頼を積んで待つ (ManualResetEventSlim)
// GPU を待っている間もメインスレッドは止まらない (readback はポーリング)。
//
// バックエンド:
//   auto → コンピュートシェーダーが使えれば GPUCompute (Quest / XREAL / 普通のスマホは全部可)、
//          無ければ CPU。GPUCompute の生成に失敗したら CPU に落ちる。
//   gpu / cpu → 指定どおり。
//
// 整数の入力 (トークン番号) は Inference Engine では int32 になる (ONNX の int64 は取り込み時に変換される)。
// パッケージ (com.unity.ai.inference) はモデルを使うプロジェクトでだけ入る
// (UnityBuilder.ensureInferencePackage)。無いビルドでは空の実装になり、すべて "inferenceNotBuilt" で失敗する。
// ==============================================

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using Arsist.Runtime.Perception.Models;
using UnityEngine;
#if ARSIST_INFERENCE
using Unity.InferenceEngine;
#endif

namespace Arsist.Runtime.Inference
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistModelExecutor : MonoBehaviour, IModelRunner, IVisionModelRunner
    {
        public static ArsistModelExecutor Instance { get; private set; }

        /// <summary>Resources 内の置き場。ArsistBuildPipeline.CopyModelsToProject と揃えること。</summary>
        public const string ResourcesFolder = "ArsistModels";
        /// <summary>モデルのフォルダの中の名前。ArsistBuildPipeline と揃えること。</summary>
        public const string ModelFileName = "model";

        /// <summary>画像認識のワーカーが待つ上限。GPU が固まったときにワーカーを永遠に待たせない。</summary>
        private const int VisionTimeoutMs = 8000;

        private sealed class Job
        {
            public ModelRef Model;
            public Dictionary<string, ModelTensor> Inputs;
            public Action<ModelRunResult> Done;
        }

        private readonly ConcurrentQueue<Job> _pending = new ConcurrentQueue<Job>();
        private int _mainThread;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            _mainThread = Thread.CurrentThread.ManagedThreadId;
        }

        private bool OnMainThread => Thread.CurrentThread.ManagedThreadId == _mainThread;

        // ---- IModelRunner ----

        public void Run(ModelRef model, Dictionary<string, ModelTensor> inputs, Action<ModelRunResult> done)
        {
            if (model == null || inputs == null) { done?.Invoke(ModelRunResult.Fail("badRequest")); return; }
            _pending.Enqueue(new Job { Model = model, Inputs = inputs, Done = done });
        }

        // ---- IVisionModelRunner (ワーカースレッドから) ----

        public bool TryRun(ModelSpec spec, TensorData input, out Dictionary<string, TensorData> outputs, out string error)
        {
            outputs = null;
            error = null;
            if (spec == null || input == null) { error = "badRequest"; return false; }

            var model = new ModelRef { Id = spec.Id, Backend = spec.Backend };
            // 入力名が無ければ、メインスレッドで最初の入力に流す ("" は「最初の入力」)
            var inputs = new Dictionary<string, ModelTensor> { [spec.Input.Name ?? ""] = ModelTensor.Float(input.Shape, input.Data) };

            ModelRunResult result = null;
            using (var signal = new ManualResetEventSlim(false))
            {
                Run(model, inputs, r => { result = r; signal.Set(); });
                if (!signal.Wait(VisionTimeoutMs)) { error = "timeout"; return false; }
            }
            if (result == null || !result.Ok) { error = result?.Error ?? "failed"; return false; }

            outputs = new Dictionary<string, TensorData>();
            foreach (var pair in result.Outputs)
            {
                if (pair.Value.Length == 0) continue;
                var shape = (int[])pair.Value.Shape.Clone();
                for (int i = 0; i < shape.Length; i++) if (shape[i] <= 0) shape[i] = 1;
                outputs[pair.Key] = new TensorData(shape, pair.Value.ToFloats());
            }
            if (outputs.Count == 0) { error = "noOutputs"; return false; }
            return true;
        }

        private void Complete(Job job, ModelRunResult result)
        {
            if (job.Done == null) return;
            try { job.Done(result); }
            catch (Exception e) { UnityEngine.Debug.LogError($"[Arsist] Model '{job.Model.Id}' callback failed: {e}"); }
        }

#if ARSIST_INFERENCE
        private sealed class LoadedModel
        {
            public Model Model;
            public Worker Worker;
            public BackendType Backend;
            public ModelSignature Signature;
            public int Runs;
            public double TotalMs;
        }

        private readonly Dictionary<string, LoadedModel> _loaded = new Dictionary<string, LoadedModel>();

        private Job _active;
        private LoadedModel _activeModel;
        private readonly List<Tensor> _activeInputs = new List<Tensor>();
        private readonly List<(string name, Tensor tensor)> _activeOutputs = new List<(string, Tensor)>();
        private readonly Stopwatch _activeClock = new Stopwatch();

        public bool TryDescribe(ModelRef model, out ModelSignature signature, out string error)
        {
            signature = null;
            error = null;
            if (!OnMainThread) { error = "mainThreadOnly"; return false; }
            try
            {
                signature = Load(model).Signature;
                return true;
            }
            catch (Exception e)
            {
                error = "load:" + e.Message;
                return false;
            }
        }

        private void Update()
        {
            if (_active != null)
            {
                PollActive();
                return;
            }
            if (!_pending.TryDequeue(out var job)) return;
            StartJob(job);
        }

        private void StartJob(Job job)
        {
            LoadedModel loaded;
            try
            {
                loaded = Load(job.Model);
            }
            catch (Exception e)
            {
                UnityEngine.Debug.LogError($"[Arsist] Model '{job.Model.Id}' could not be loaded: {e.Message}");
                Complete(job, ModelRunResult.Fail("load:" + e.Message));
                return;
            }

            try
            {
                foreach (var info in loaded.Signature.Inputs)
                {
                    if (!job.Inputs.TryGetValue(info.Name, out var tensor))
                    {
                        // 画像認識は入力名を省略できる ("" = 最初の入力)
                        if (job.Inputs.Count == 1 && job.Inputs.TryGetValue("", out var only) && info == loaded.Signature.Inputs[0]) tensor = only;
                        else throw new InvalidOperationException("missingInput:" + info.Name);
                    }
                    var shape = new TensorShape(tensor.Shape);
                    Tensor engineTensor = info.Kind == TensorKind.Float
                        ? new Tensor<float>(shape, tensor.ToFloats())
                        : (Tensor)new Tensor<int>(shape, ToInts(tensor));
                    _activeInputs.Add(engineTensor);
                    loaded.Worker.SetInput(info.Name, engineTensor);
                }

                _activeClock.Restart();
                loaded.Worker.Schedule();

                _activeOutputs.Clear();
                foreach (var info in loaded.Signature.Outputs)
                {
                    var output = loaded.Worker.PeekOutput(info.Name);
                    if (output == null) continue;
                    output.ReadbackRequest(); // GPU → CPU を非同期に。完了は PollActive で見る
                    _activeOutputs.Add((info.Name, output));
                }
                if (_activeOutputs.Count == 0) throw new InvalidOperationException("noOutputs");
                _active = job;
                _activeModel = loaded;
            }
            catch (Exception e)
            {
                DisposeActiveInputs();
                _activeOutputs.Clear();
                UnityEngine.Debug.LogError($"[Arsist] Model '{job.Model.Id}' failed to schedule: {e.Message}");
                Complete(job, ModelRunResult.Fail(e.Message.StartsWith("missingInput", StringComparison.Ordinal) ? e.Message : "schedule:" + e.Message));
            }
        }

        private static int[] ToInts(ModelTensor tensor)
        {
            var longs = tensor.ToLongs();
            var ints = new int[longs.Length];
            for (int i = 0; i < ints.Length; i++) ints[i] = (int)Math.Max(int.MinValue, Math.Min(int.MaxValue, longs[i]));
            return ints;
        }

        private void PollActive()
        {
            foreach (var (_, tensor) in _activeOutputs)
            {
                if (!tensor.IsReadbackRequestDone()) return;
            }

            var job = _active;
            var loaded = _activeModel;
            _active = null;
            _activeModel = null;
            ModelRunResult result;
            try
            {
                var outputs = new Dictionary<string, ModelTensor>();
                foreach (var (name, tensor) in _activeOutputs)
                {
                    var shape = tensor.shape.ToArray();
                    switch (tensor)
                    {
                        case Tensor<float> f: outputs[name] = ModelTensor.Float(shape, f.DownloadToArray()); break;
                        case Tensor<int> n:
                        {
                            var ints = n.DownloadToArray();
                            var longs = new long[ints.Length];
                            for (int i = 0; i < ints.Length; i++) longs[i] = ints[i];
                            outputs[name] = ModelTensor.Int64(shape, longs);
                            break;
                        }
                    }
                }
                _activeClock.Stop();
                double ms = _activeClock.Elapsed.TotalMilliseconds;
                loaded.Runs++;
                loaded.TotalMs += ms;
                if (loaded.Runs == 1 || loaded.Runs % 50 == 0)
                {
                    UnityEngine.Debug.Log($"[Arsist] Model '{job.Model.Id}' on {loaded.Backend}: {ms:F0} ms " +
                                          $"(avg {loaded.TotalMs / loaded.Runs:F0} ms over {loaded.Runs} run(s))");
                }
                result = new ModelRunResult { Ok = true, Outputs = outputs, Ms = ms };
            }
            catch (Exception e)
            {
                UnityEngine.Debug.LogError($"[Arsist] Model '{job.Model.Id}' readback failed: {e.Message}");
                result = ModelRunResult.Fail("readback:" + e.Message);
            }
            finally
            {
                DisposeActiveInputs();
                _activeOutputs.Clear();
            }
            Complete(job, result);
        }

        private void DisposeActiveInputs()
        {
            foreach (var tensor in _activeInputs) tensor?.Dispose();
            _activeInputs.Clear();
        }

        private LoadedModel Load(ModelRef model)
        {
            if (_loaded.TryGetValue(model.Id, out var existing)) return existing;

            // 置き場は モデル 1 つにつき 1 フォルダ (重みの別ファイルを隣に置くため)
            var asset = Resources.Load<ModelAsset>(ResourcesFolder + "/" + model.Id + "/" + ModelFileName);
            if (asset == null)
                throw new InvalidOperationException($"Resources/{ResourcesFolder}/{model.Id}/{ModelFileName} not found (was the model copied at build time?)");

            var engineModel = ModelLoader.Load(asset);
            var backend = ChooseBackend(model.Backend);
            Worker worker;
            try
            {
                worker = new Worker(engineModel, backend);
            }
            catch (Exception e) when (backend != BackendType.CPU)
            {
                UnityEngine.Debug.LogWarning($"[Arsist] Model '{model.Id}': {backend} backend failed ({e.Message}); falling back to CPU.");
                backend = BackendType.CPU;
                worker = new Worker(engineModel, backend);
            }

            var signature = new ModelSignature();
            foreach (var input in engineModel.inputs)
            {
                signature.Inputs.Add(new TensorInfo
                {
                    Name = input.name,
                    Kind = input.dataType == DataType.Float ? TensorKind.Float : TensorKind.Int32,
                    Shape = input.shape.isRankDynamic ? null : input.shape.ToIntArray(),
                });
            }
            foreach (var output in engineModel.outputs)
            {
                signature.Outputs.Add(new TensorInfo { Name = output.name, Kind = TensorKind.Float, Shape = null });
            }
            if (signature.Inputs.Count == 0) throw new InvalidOperationException("model has no inputs");

            var loaded = new LoadedModel { Model = engineModel, Worker = worker, Backend = backend, Signature = signature };
            _loaded[model.Id] = loaded;
            UnityEngine.Debug.Log($"[Arsist] Model '{model.Id}' loaded: backend={backend}, " +
                                  $"inputs={signature.Inputs.Count}, outputs={signature.Outputs.Count}, computeShaders={SystemInfo.supportsComputeShaders}");
            return loaded;
        }

        private static BackendType ChooseBackend(string backend)
        {
            switch ((backend ?? "auto").ToLowerInvariant())
            {
                case "cpu": return BackendType.CPU;
                case "gpu": return SystemInfo.supportsComputeShaders ? BackendType.GPUCompute : BackendType.GPUPixel;
                default: return SystemInfo.supportsComputeShaders ? BackendType.GPUCompute : BackendType.CPU;
            }
        }

        private void OnDestroy()
        {
            DisposeActiveInputs();
            foreach (var loaded in _loaded.Values) loaded.Worker?.Dispose();
            _loaded.Clear();
            if (_active != null) Complete(_active, ModelRunResult.Fail("destroyed"));
            _active = null;
            while (_pending.TryDequeue(out var job)) Complete(job, ModelRunResult.Fail("destroyed"));
            if (Instance == this) Instance = null;
        }
#else
        public bool TryDescribe(ModelRef model, out ModelSignature signature, out string error)
        {
            signature = null;
            error = "inferenceNotBuilt";
            return false;
        }

        private void Update()
        {
            while (_pending.TryDequeue(out var job)) Complete(job, ModelRunResult.Fail("inferenceNotBuilt"));
        }

        private void OnDestroy()
        {
            while (_pending.TryDequeue(out var job)) Complete(job, ModelRunResult.Fail("destroyed"));
            if (Instance == this) Instance = null;
        }
#endif
    }
}
