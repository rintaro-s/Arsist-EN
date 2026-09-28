// エディタのプレビュー用の推論器。ONNX Runtime (CPU) で同じ ONNX を流す。
//
// 実機は Unity の Inference Engine で動くので、ここで見える結果と実機の結果は
// 「同じ重み・同じ前処理・同じ後処理・同じ分割器・同じ生成の手順」で、違うのは推論エンジンの浮動小数の丸めだけ。
//
// 画像認識の `infer` op (IVisionModelRunner) と、汎用の口 (IModelRunner: 型つき・複数入力) の両方を持つ。
// セッションはファイルごとに一度だけ作る (作るのに数百 ms かかる)。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Arsist.Runtime.Inference;
using Arsist.Runtime.Perception.Models;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

internal sealed class OnnxModelRunner : IVisionModelRunner, IModelRunner
{
    private readonly Dictionary<string, InferenceSession> _sessions = new Dictionary<string, InferenceSession>();

    // ---- 画像認識 ----

    public bool TryRun(ModelSpec spec, TensorData input, out Dictionary<string, TensorData> outputs, out string error)
    {
        outputs = null;
        error = null;

        var model = new ModelRef { Id = spec.Id, File = spec.File, Backend = spec.Backend };
        if (!TryDescribe(model, out var signature, out error)) return false;

        string inputName = spec.Input.Name;
        if (string.IsNullOrEmpty(inputName)) inputName = signature.Inputs.Count > 0 ? signature.Inputs[0].Name : null;
        if (inputName == null) { error = "noInputs"; return false; }

        ModelRunResult result = null;
        Run(model, new Dictionary<string, ModelTensor> { [inputName] = ModelTensor.Float(input.Shape, input.Data) }, r => result = r);
        if (result == null || !result.Ok) { error = result?.Error ?? "failed"; return false; }

        outputs = new Dictionary<string, TensorData>();
        foreach (var pair in result.Outputs)
        {
            if (pair.Value.Length == 0) continue;
            var shape = (int[])pair.Value.Shape.Clone();
            for (int i = 0; i < shape.Length; i++) shape[i] = Math.Max(1, shape[i]);
            outputs[pair.Key] = new TensorData(shape, pair.Value.ToFloats());
        }
        if (outputs.Count == 0) { error = "noFloatOutputs"; return false; }
        return true;
    }

    // ---- 汎用 ----

    public bool TryDescribe(ModelRef model, out ModelSignature signature, out string error)
    {
        signature = null;
        error = null;
        InferenceSession session;
        try { session = Session(model.File); }
        catch (Exception e) { error = "load:" + e.Message; return false; }

        signature = new ModelSignature();
        foreach (var pair in session.InputMetadata) signature.Inputs.Add(Describe(pair.Key, pair.Value));
        foreach (var pair in session.OutputMetadata) signature.Outputs.Add(Describe(pair.Key, pair.Value));
        return true;
    }

    private static TensorInfo Describe(string name, NodeMetadata meta)
    {
        var dims = meta.Dimensions?.ToArray() ?? Array.Empty<int>();
        for (int i = 0; i < dims.Length; i++) if (dims[i] < 0) dims[i] = -1;
        return new TensorInfo { Name = name, Kind = KindOf(meta.ElementDataType), Shape = dims };
    }

    private static TensorKind KindOf(TensorElementType type)
    {
        switch (type)
        {
            case TensorElementType.Int64: return TensorKind.Int64;
            case TensorElementType.Int32: return TensorKind.Int32;
            case TensorElementType.Bool: return TensorKind.Bool;
            default: return TensorKind.Float;
        }
    }

    public void Run(ModelRef model, Dictionary<string, ModelTensor> inputs, Action<ModelRunResult> done)
    {
        InferenceSession session;
        try { session = Session(model.File); }
        catch (Exception e) { done(ModelRunResult.Fail("load:" + e.Message)); return; }

        var clock = Stopwatch.StartNew();
        try
        {
            var values = new List<NamedOnnxValue>();
            foreach (var pair in session.InputMetadata)
            {
                if (!inputs.TryGetValue(pair.Key, out var tensor))
                {
                    done(ModelRunResult.Fail("missingInput:" + pair.Key));
                    return;
                }
                values.Add(ToOnnx(pair.Key, pair.Value.ElementDataType, tensor));
            }

            using var results = session.Run(values);
            var outputs = new Dictionary<string, ModelTensor>();
            foreach (var result in results)
            {
                var converted = FromOnnx(result);
                if (converted != null) outputs[result.Name] = converted;
            }
            clock.Stop();
            done(new ModelRunResult { Ok = true, Outputs = outputs, Ms = clock.Elapsed.TotalMilliseconds });
        }
        catch (Exception e)
        {
            done(ModelRunResult.Fail("run:" + e.Message));
        }
    }

    private static NamedOnnxValue ToOnnx(string name, TensorElementType type, ModelTensor tensor)
    {
        var shape = tensor.Shape;
        switch (type)
        {
            case TensorElementType.Int64:
                return NamedOnnxValue.CreateFromTensor(name, new DenseTensor<long>(tensor.ToLongs(), shape));
            case TensorElementType.Int32:
                return NamedOnnxValue.CreateFromTensor(name, new DenseTensor<int>(tensor.ToLongs().Select(v => (int)v).ToArray(), shape));
            case TensorElementType.Bool:
                return NamedOnnxValue.CreateFromTensor(name, new DenseTensor<bool>(tensor.ToLongs().Select(v => v != 0).ToArray(), shape));
            case TensorElementType.Float16:
                return NamedOnnxValue.CreateFromTensor(name, new DenseTensor<Float16>(tensor.ToFloats().Select(v => (Float16)v).ToArray(), shape));
            case TensorElementType.Double:
                return NamedOnnxValue.CreateFromTensor(name, new DenseTensor<double>(tensor.ToFloats().Select(v => (double)v).ToArray(), shape));
            default:
                return NamedOnnxValue.CreateFromTensor(name, new DenseTensor<float>(tensor.ToFloats(), shape));
        }
    }

    private static ModelTensor FromOnnx(DisposableNamedOnnxValue value)
    {
        switch (value.Value)
        {
            case Tensor<float> f: return ModelTensor.Float(Dims(f.Dimensions), f.ToDenseTensor().Buffer.ToArray());
            case Tensor<Float16> h: return ModelTensor.Float(Dims(h.Dimensions), h.ToDenseTensor().Buffer.ToArray().Select(v => (float)v).ToArray());
            case Tensor<double> d: return ModelTensor.Float(Dims(d.Dimensions), d.ToDenseTensor().Buffer.ToArray().Select(v => (float)v).ToArray());
            case Tensor<long> l: return ModelTensor.Int64(Dims(l.Dimensions), l.ToDenseTensor().Buffer.ToArray());
            case Tensor<int> i: return ModelTensor.Int32(Dims(i.Dimensions), i.ToDenseTensor().Buffer.ToArray().Select(v => (long)v).ToArray());
            case Tensor<bool> b: return ModelTensor.Bool(Dims(b.Dimensions), b.ToDenseTensor().Buffer.ToArray().Select(v => v ? 1L : 0L).ToArray());
            default: return null;
        }
    }

    private static int[] Dims(ReadOnlySpan<int> dims) => dims.ToArray();

    private InferenceSession Session(string path)
    {
        path ??= "";
        if (_sessions.TryGetValue(path, out var existing)) return existing;
        if (!File.Exists(path)) throw new FileNotFoundException("model file not found: " + path);

        var options = new SessionOptions { GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL };
        var session = new InferenceSession(path, options);
        _sessions[path] = session;
        return session;
    }
}
