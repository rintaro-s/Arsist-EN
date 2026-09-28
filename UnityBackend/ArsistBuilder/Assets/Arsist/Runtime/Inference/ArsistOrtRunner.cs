// ==============================================
// Arsist Engine - Inference
// Unity のエンジンを通さない推論器: APK に同梱した ONNX Runtime (Android)
//
// なぜ要るか:
//   Unity の Inference Engine は、最近の言語モデルの書き出しが使う演算子
//   (GroupQueryAttention / LinearAttention / CausalConvWithState / MatMulNBits / If …) を
//   取り込めない。Qwen3.5 のような LLM は、どの精度を落としても Unity 側では動かせない。
//   一方 ONNX Runtime はそれらを動かせる (エディタの「試す」で確かめている)。
//   そこで、そういうモデルは Unity のエンジンを迂回して、この推論器で動かす。
//
// 作り:
//   C# ── AndroidJavaClass ──▶ com.arsist.ort.ArsistOnnxRuntime (Java) ──▶ libonnxruntime.so
//   値は基本的に JNI をまたがない。出力は「あちら側の番号」(ModelTensor.Handle) で返し、
//   次の一歩の入力にそのまま渡す。運ぶのは本当に読む値 (logits の最後の行) だけ。
//   KV キャッシュは 1 歩ごとに数 MB あるので、ここを運ぶ作りにすると速さが出ない。
//
// モデルのファイル:
//   ビルド時に StreamingAssets/ArsistModels/<id>/ に入る。Android では APK の中 (jar:) にあって
//   そのままでは開けないので、初回だけ端末の書き込める場所へ写してから開く (CopyToDisk)。
//
// スレッド:
//   推論は数十 ms 〜 数百 ms かかる。メインスレッドで回すと、その間ずっと画が止まる
//   (頭に着けている端末では、これは「重い」では済まない)。そこで:
//     メインスレッドから呼ばれたら → 別スレッドで動かし、終わったらメインスレッドで done を呼ぶ
//     ワーカーから呼ばれたら (画像認識) → そのまま動かす。止まって困るスレッドではない
//   セッションごとに順番待ちさせる (生成は 1 歩ずつなので、これで足りる)。
// ==============================================

using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using UnityEngine;
using UnityEngine.Networking;

namespace Arsist.Runtime.Inference
{
    public sealed class ArsistOrtRunner : IModelRunner, IDisposable
    {
        private const string BridgeClass = "com.arsist.ort.ArsistOnnxRuntime";
        /// <summary>ビルド時の置き場 (ArsistBuildPipeline.StreamingModelsFolder と揃えること)。</summary>
        public const string StreamingFolder = "ArsistModels";

        private sealed class Loaded
        {
            public int SessionId;
            public ModelSignature Signature;
            public readonly object Gate = new object();
            public int Runs;
            public double TotalMs;
        }

        private readonly Dictionary<string, Loaded> _loaded = new Dictionary<string, Loaded>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> _failed = new Dictionary<string, string>(StringComparer.Ordinal);

        /// <summary>メインスレッドに戻す仕事 (推論が終わったことの知らせ)。</summary>
        private readonly ConcurrentQueue<Action> _completions = new ConcurrentQueue<Action>();
        private readonly int _mainThreadId = Thread.CurrentThread.ManagedThreadId;
        private Pump _pump;

        /// <summary>別スレッドで終わった仕事を、メインスレッドで呼び直すだけのもの。</summary>
        private sealed class Pump : MonoBehaviour
        {
            public ArsistOrtRunner Owner;

            private void Update()
            {
                if (Owner == null) return;
                while (Owner._completions.TryDequeue(out var action))
                {
                    try { action(); }
                    catch (Exception e) { UnityEngine.Debug.LogError($"[Arsist] ONNX Runtime callback failed: {e}"); }
                }
            }
        }

        private void EnsurePump()
        {
            if (_pump != null) return;
            var go = new GameObject("[ArsistOnnxRuntime]");
            UnityEngine.Object.DontDestroyOnLoad(go);
            _pump = go.AddComponent<Pump>();
            _pump.Owner = this;
        }
#if UNITY_ANDROID && !UNITY_EDITOR
        private AndroidJavaClass _bridge;
        /// <summary>こちら側で気づいた失敗の理由 (ブリッジが何も言わないとき用)。</summary>
        private string _localError;
        private bool _attachReported;
#endif

        public bool Available
        {
            get
            {
#if UNITY_ANDROID && !UNITY_EDITOR
                return true;
#else
                return false;
#endif
            }
        }

        // ---- モデルのファイルを、開ける場所に用意する ----

        /// <summary>
        /// StreamingAssets のモデルを、端末の書き込める場所へ写す (初回だけ)。
        /// Android では StreamingAssets は APK の中にあり、ファイルとして開けない。
        /// 重みが別ファイル (*.onnx_data) のモデルもあるので、フォルダごと写す。
        /// </summary>
        public static IEnumerator EnsureOnDisk(string modelId, List<string> fileNames, Action<string> done)
        {
            var destinationDir = Path.Combine(Application.persistentDataPath, StreamingFolder, modelId);
            Directory.CreateDirectory(destinationDir);

            foreach (var name in fileNames)
            {
                var destination = Path.Combine(destinationDir, name);
                if (File.Exists(destination)) continue;

                var source = Path.Combine(Application.streamingAssetsPath, StreamingFolder, modelId, name);
                if (!source.StartsWith("jar:") && !source.StartsWith("http")) source = "file://" + source;

                UnityEngine.Debug.Log($"[Arsist] Copying model file out of the APK: {modelId}/{name}");
                using (var request = UnityWebRequest.Get(source))
                {
                    var handler = new DownloadHandlerFile(destination) { removeFileOnAbort = true };
                    request.downloadHandler = handler;
                    yield return request.SendWebRequest();
                    if (request.result != UnityWebRequest.Result.Success)
                    {
                        UnityEngine.Debug.LogError($"[Arsist] Could not read {modelId}/{name} from the APK: {request.error}");
                        done?.Invoke(null);
                        yield break;
                    }
                }
            }
            done?.Invoke(destinationDir);
        }

        // ---- IModelRunner ----

        public bool TryDescribe(ModelRef model, out ModelSignature signature, out string error)
        {
            signature = null;
#if UNITY_ANDROID && !UNITY_EDITOR
            // 画像認識のワーカースレッドから来ることがある。Java を触る前につないでおく。
            string loadError = null;
            var loaded = WithJvm(() => Load(model, out loadError));
            error = loadError;
#else
            var loaded = Load(model, out error);
#endif
            if (loaded == null) return false;
            signature = loaded.Signature;
            return true;
        }

        public void Run(ModelRef model, Dictionary<string, ModelTensor> inputs, Action<ModelRunResult> done)
        {
            // 画像認識のワーカーなど、止まって困らないスレッドからならそのまま動かす
            if (Thread.CurrentThread.ManagedThreadId != _mainThreadId)
            {
                done?.Invoke(RunBlocking(model, inputs));
                return;
            }

            // メインスレッド (スクリプト) からは、別スレッドに出して画を止めない
            EnsurePump();
            ThreadPool.QueueUserWorkItem(_ =>
            {
                ModelRunResult result;
                try { result = RunBlocking(model, inputs); }
                catch (Exception e) { result = ModelRunResult.Fail("run:" + e.Message); }
                _completions.Enqueue(() => done?.Invoke(result));
            });
        }

        /// <summary>呼んだスレッドで最後まで動かす。</summary>
        public ModelRunResult RunBlocking(ModelRef model, Dictionary<string, ModelTensor> inputs)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            return WithJvm(() => RunAttached(model, inputs));
#else
            return ModelRunResult.Fail("ortNotAvailable");
#endif
        }

#if UNITY_ANDROID && !UNITY_EDITOR
        /// <summary>
        /// Java を呼ぶ間、このスレッドを JVM につないでおく。
        ///
        /// JNI は**つないでいないスレッドからは何も呼べない**。Unity の AndroidJavaClass は
        /// そういうとき例外も投げず、0 や空文字をそのまま返す。実機では
        ///   badInput:input_ids:            ← 理由の無いエラー
        /// という形でしか出ない (2026-09 に踏んだ)。推論もその結果の読み出しも、
        /// 画像認識のワーカースレッドから来ることがあるので、**Java を触る入口は全部ここを通す**。
        ///
        /// 入れ子で呼ばれても、いちばん外側が終わるまで切らない (途中で切ると、
        /// 外側がまだ使っている最中に接続が消える)。
        /// </summary>
        [ThreadStatic] private static int _attachDepth;

        private T WithJvm<T>(Func<T> work)
        {
            bool mine = false;
            if (Thread.CurrentThread.ManagedThreadId != _mainThreadId && _attachDepth == 0)
            {
                AndroidJNI.AttachCurrentThread();
                mine = true;
                if (!_attachReported)
                {
                    _attachReported = true;
                    UnityEngine.Debug.Log("[Arsist] ONNX Runtime: worker thread attached to the JVM.");
                }
            }
            if (Thread.CurrentThread.ManagedThreadId != _mainThreadId) _attachDepth++;
            try { return work(); }
            finally
            {
                if (Thread.CurrentThread.ManagedThreadId != _mainThreadId) _attachDepth--;
                if (mine) AndroidJNI.DetachCurrentThread();
            }
        }

        private ModelRunResult RunAttached(ModelRef model, Dictionary<string, ModelTensor> inputs)
        {
            var loaded = Load(model, out var loadError);
            if (loaded == null) return ModelRunResult.Fail(loadError);

            lock (loaded.Gate)
            {
                var clock = Stopwatch.StartNew();
                var madeHere = new List<int>();
                try
                {
                    var names = new List<string>();
                    var handles = new List<int>();
                    // 最初の一歩だけ、何をどう渡そうとしているかを残す。
                    // 実機でしか動かない道なので、失敗したときに形と型が分からないと追えない。
                    var plan = loaded.Runs == 0 ? new List<string>() : null;
                    foreach (var info in loaded.Signature.Inputs)
                    {
                        if (!inputs.TryGetValue(info.Name, out var tensor))
                        {
                            // 画像認識は入力名を省略できる ("" = 最初の入力)
                            if (inputs.Count == 1 && inputs.TryGetValue("", out var only) && info == loaded.Signature.Inputs[0]) tensor = only;
                            else return ModelRunResult.Fail("missingInput:" + info.Name);
                        }
                        int handle = HandleFor(tensor, info, madeHere);
                        if (handle == 0) return ModelRunResult.Fail("badInput:" + Describe(info, tensor) + ": " + LastError());
                        names.Add(info.Name);
                        handles.Add(handle);
                        plan?.Add($"{info.Name}:{tensor.Kind}{tensor.ShapeText()}" + (tensor.IsDeviceHeld ? "*" : ""));
                    }
                    if (plan != null)
                    {
                        UnityEngine.Debug.Log($"[Arsist] Model '{model.Id}' first step inputs: {string.Join(" ", plan)} " +
                                              "(* = kept by the runtime from the previous step)");
                    }

                    var json = _bridge.CallStatic<string>("run", loaded.SessionId, names.ToArray(), handles.ToArray());
                    if (string.IsNullOrEmpty(json)) return ModelRunResult.Fail("run:" + LastError());

                    var outputs = new Dictionary<string, ModelTensor>();
                    foreach (var raw in MiniJson.Parse(json) as List<object> ?? new List<object>())
                    {
                        if (!(raw is Dictionary<string, object> entry)) continue;
                        var name = MiniJson.Text(entry, "name");
                        int handle = MiniJson.Int(entry, "handle", 0);
                        ModelTensor.TryParseKind(MiniJson.Text(entry, "type", "float"), out var kind);
                        var shapeList = MiniJson.List(entry, "shape") ?? new List<object>();
                        var shape = new int[shapeList.Count];
                        for (int i = 0; i < shape.Length; i++) shape[i] = (int)Math.Max(0, Convert.ToDouble(shapeList[i]));
                        outputs[name] = ModelTensor.Device(kind, shape, handle, Fetch);
                    }

                    clock.Stop();
                    loaded.Runs++;
                    loaded.TotalMs += clock.Elapsed.TotalMilliseconds;
                    if (loaded.Runs == 1 || loaded.Runs % 50 == 0)
                    {
                        UnityEngine.Debug.Log($"[Arsist] Model '{model.Id}' on ONNX Runtime: {clock.Elapsed.TotalMilliseconds:F0} ms " +
                                              $"(avg {loaded.TotalMs / loaded.Runs:F0} ms over {loaded.Runs} run(s))");
                    }
                    return new ModelRunResult { Ok = true, Outputs = outputs, Ms = clock.Elapsed.TotalMilliseconds };
                }
                catch (Exception e)
                {
                    UnityEngine.Debug.LogError($"[Arsist] Model '{model.Id}' failed on ONNX Runtime: {e.Message}");
                    return ModelRunResult.Fail("run:" + e.Message);
                }
                finally
                {
                    // この一歩のために作った入力だけを離す (前の一歩の出力は Java 側が持っている)
                    foreach (var handle in madeHere) _bridge.CallStatic("release", handle, false);
                }
            }
        }

        /// <summary>値を持っているものは渡す前に作り、あちら側にあるものは番号をそのまま使う。</summary>
        private int HandleFor(ModelTensor tensor, TensorInfo info, List<int> madeHere)
        {
            if (tensor.IsDeviceHeld && tensor.Handle is int existing)
            {
                // 0 は「番号が無い」を意味する。そのまま渡すと ONNX Runtime 側には何も届かず、
                // 理由の無いエラーになる。ここで気づけるようにする。
                if (existing == 0) SetLocalError("the value is held by the runtime but its handle is 0 (already released?)");
                return existing;
            }

            // 形と値の数が食い違っていたら、ここで止める (向こうで出る例外より、こちらの方が具体的)
            long expected = 1;
            foreach (var d in tensor.Shape) expected *= Math.Max(0, d);
            // 空 (要素 0) は正しい入力になりうる。最初の一歩の KV キャッシュは [1,2,0,256] のように
            // 長さ 0 で渡す約束なので、ここで弾いてはいけない。数が食い違うときだけ止める。
            if (tensor.Length != expected)
            {
                SetLocalError($"the shape {tensor.ShapeText()} needs {expected} value(s) but {tensor.Length} were given");
                return 0;
            }

            var shape = new long[tensor.Shape.Length];
            for (int i = 0; i < shape.Length; i++) shape[i] = tensor.Shape[i];

            int handle;
            switch (info.Kind)
            {
                case TensorKind.Int64:
                    handle = _bridge.CallStatic<int>("createLong", shape, tensor.ToLongs());
                    break;
                case TensorKind.Int32:
                {
                    var longs = tensor.ToLongs();
                    var ints = new int[longs.Length];
                    for (int i = 0; i < ints.Length; i++) ints[i] = (int)longs[i];
                    handle = _bridge.CallStatic<int>("createInt", shape, ints);
                    break;
                }
                case TensorKind.Bool:
                    handle = _bridge.CallStatic<int>("createBool", shape, tensor.Length > 0 && tensor.LongAt(0) != 0);
                    break;
                default:
                    handle = _bridge.CallStatic<int>("createFloat", shape, tensor.ToFloats());
                    break;
            }
            if (handle != 0) madeHere.Add(handle);
            return handle;
        }

        /// <summary>こちら側で気づいた理由を、ブリッジの lastError と同じ場所に残す。</summary>
        private void SetLocalError(string reason)
        {
            _localError = reason;
        }

        /// <summary>値を本当に読むときだけ運ぶ (logits など)。</summary>
        private float[] Fetch(ModelTensor tensor)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            return WithJvm(() => FetchAttached(tensor));
        }

        /// <summary>値の読み出し本体。呼ばれるスレッドは JVM につながっていること。</summary>
        private float[] FetchAttached(ModelTensor tensor)
        {
#endif
            if (!(tensor.Handle is int handle)) return Array.Empty<float>();
            // 生成では最後の位置の行しか読まないので、そこだけ運ぶ
            int vocab = tensor.Dim(tensor.Rank - 1);
            long total = 1;
            foreach (var d in tensor.Shape) total *= Math.Max(1, d);
            int offset = (int)Math.Max(0, total - vocab);
            var row = _bridge.CallStatic<float[]>("readFloats", handle, offset, vocab);
            if (offset == 0) return row;

            // 読む側は「全体の最後の vocab 個」を見るので、前を 0 で埋めて形を合わせる
            var values = new float[total];
            Array.Copy(row, 0, values, offset, Math.Min(row.Length, vocab));
            return values;
        }

        private string LastError()
        {
            try
            {
                if (!string.IsNullOrEmpty(_localError))
                {
                    var local = _localError;
                    _localError = null;
                    return local;
                }
                var text = _bridge.CallStatic<string>("lastError");
                // 空で返ってくると「原因が何も書かれていないエラー」になる。何が起きたか分からず
                // 実機でしか再現しないので、必ず何か言わせる (2026-09 に踏んだ)。
                return string.IsNullOrEmpty(text) ? "(the ONNX Runtime bridge reported no reason)" : text;
            }
            catch (Exception e) { return "could not read the bridge's error: " + e.Message; }
        }

        /// <summary>失敗したときに「どの入力が、どんな形で」を残す。</summary>
        private static string Describe(TensorInfo info, ModelTensor tensor)
        {
            long expected = 1;
            foreach (var d in tensor.Shape) expected *= Math.Max(0, d);
            var wantedShape = info.Shape == null ? "?" : "[" + string.Join(",", info.Shape) + "]";
            return $"{info.Name} (model wants {info.Kind} {wantedShape}, got {tensor.Kind} {tensor.ShapeText()}" +
                   $", {tensor.Length} value(s), expected {expected}" +
                   (tensor.IsDeviceHeld ? $", held by the runtime as #{tensor.Handle}" : "") + ")";
        }
#endif

        private Loaded Load(ModelRef model, out string error)
        {
            error = null;
#if UNITY_ANDROID && !UNITY_EDITOR
            lock (_loaded)
            {
                if (_loaded.TryGetValue(model.Id, out var existing)) return existing;
                if (_failed.TryGetValue(model.Id, out var why)) { error = why; return null; }

                if (_bridge == null)
                {
                    try { _bridge = new AndroidJavaClass(BridgeClass); }
                    catch (Exception e)
                    {
                        error = "ortBridgeMissing:" + e.Message;
                        _failed[model.Id] = error;
                        return null;
                    }
                }

                var path = model.File;
                if (string.IsNullOrEmpty(path) || !File.Exists(path))
                {
                    error = "modelFileMissing:" + path;
                    _failed[model.Id] = error;
                    return null;
                }

                int sessionId = _bridge.CallStatic<int>("open", path, Math.Max(2, SystemInfo.processorCount - 2));
                if (sessionId == 0)
                {
                    error = "open:" + LastError();
                    _failed[model.Id] = error;
                    return null;
                }

                var json = _bridge.CallStatic<string>("describe", sessionId);
                var signature = ParseSignature(json);
                if (signature == null)
                {
                    error = "describe:" + LastError();
                    _failed[model.Id] = error;
                    return null;
                }

                var loaded = new Loaded { SessionId = sessionId, Signature = signature };
                _loaded[model.Id] = loaded;
                UnityEngine.Debug.Log($"[Arsist] Model '{model.Id}' loaded on ONNX Runtime: " +
                                      $"inputs={signature.Inputs.Count}, outputs={signature.Outputs.Count}, file={path}");
                return loaded;
            }
#else
            error = "ortNotAvailable";
            return null;
#endif
        }

        internal static ModelSignature ParseSignature(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            try
            {
                var root = MiniJson.ParseObject(json);
                var signature = new ModelSignature();
                Fill(signature.Inputs, MiniJson.List(root, "inputs"));
                Fill(signature.Outputs, MiniJson.List(root, "outputs"));
                return signature.Inputs.Count > 0 ? signature : null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static void Fill(List<TensorInfo> into, List<object> raw)
        {
            foreach (var item in raw ?? new List<object>())
            {
                if (!(item is Dictionary<string, object> entry)) continue;
                ModelTensor.TryParseKind(MiniJson.Text(entry, "type", "float"), out var kind);
                var shapeList = MiniJson.List(entry, "shape");
                int[] shape = null;
                if (shapeList != null)
                {
                    shape = new int[shapeList.Count];
                    for (int i = 0; i < shape.Length; i++) shape[i] = (int)Convert.ToDouble(shapeList[i]);
                }
                into.Add(new TensorInfo { Name = MiniJson.Text(entry, "name"), Kind = kind, Shape = shape });
            }
        }

        public void Dispose()
        {
            if (_pump != null)
            {
                UnityEngine.Object.Destroy(_pump.gameObject);
                _pump = null;
            }
#if UNITY_ANDROID && !UNITY_EDITOR
            lock (_loaded)
            {
                foreach (var loaded in _loaded.Values)
                {
                    try { _bridge?.CallStatic("closeSession", loaded.SessionId); } catch { }
                }
                _loaded.Clear();
            }
#endif
        }
    }
}
