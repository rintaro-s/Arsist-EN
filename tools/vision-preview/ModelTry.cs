// エディタの「モデル」タブの「試す」。実機と同じ InferenceService を ONNX Runtime で動かす。
//
//   VisionPreview --model-try request.json
//
// request.json:
//   { "model": ModelDefinition (file と text.tokenizer は絶対パス),
//     "action": "describe" | "generate" | "embed" | "classify" | "run" | "tokenize" | "image",
//     "messages": [{role, content}], "options": {…},        generate
//     "texts": ["a", "b", …],                               embed (1 本目と残りの似ている度合いも出す)
//     "text": "…",                                          classify / tokenize
//     "inputs": {…}, "fill": "zeros|ones|random", "dims": {入力名: [..]}   run (無い入力は埋める)
//     "image": "in.rgba" }                                  image (VisionPreview の RGBA と同じ形)
//
// 標準出力に JSON を 1 行ずつ書く。生成は書けたそばから {"type":"delta"} が流れる (エディタが逐次出す)。
//   {"type":"signature", inputs, outputs}   最初に 1 回
//   {"type":"delta", "delta": "…"}           generate のみ
//   {"type":"result", ok, …}                最後に 1 回
#if ARSIST_ONNX
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Arsist.Runtime.Inference;
using Arsist.Runtime.Inference.Text;
using Arsist.Runtime.Perception.Vision.Classic;

internal static class ModelTry
{
    public static int Main(string requestPath)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };

        void Emit(Dictionary<string, object> line) => stdout.WriteLine(MiniJson.Write(line));
        void Fail(string error) => Emit(new Dictionary<string, object> { ["type"] = "result", ["ok"] = false, ["error"] = error });

        Dictionary<string, object> request;
        try { request = MiniJson.ParseObject(File.ReadAllText(requestPath)); }
        catch (Exception e) { Fail("badRequest:" + e.Message); return 1; }

        var entry = ModelEntry.FromPlain(MiniJson.Obj(request, "model"));
        if (entry == null) { Fail("noModel"); return 1; }

        var runner = new OnnxModelRunner();
        var service = new InferenceService(runner, new[] { entry }, e =>
        {
            var path = e.Text?.Tokenizer;
            return !string.IsNullOrEmpty(path) && File.Exists(path) ? File.ReadAllText(path) : null;
        });

        if (!runner.TryDescribe(entry.Ref, out var signature, out var describeError)) { Fail(describeError); return 1; }
        var described = signature.ToPlain();
        described["type"] = "signature";
        Emit(described);

        var action = MiniJson.Text(request, "action", "describe");
        Dictionary<string, object> result = null;
        void Done(Dictionary<string, object> r) => result = r;

        switch (action)
        {
            case "describe":
                result = new Dictionary<string, object> { ["ok"] = true };
                if (entry.Use == "text")
                {
                    var tokenizer = service.Tokenizer(entry, out var tokError);
                    result["tokenizer"] = tokenizer != null ? tokenizer.ModelType : null;
                    result["vocabSize"] = tokenizer != null ? (double)tokenizer.VocabSize : 0.0;
                    if (tokError != null) result["tokenizerError"] = tokError;
                    result["generative"] = TextGenerationSession.Check(signature) ?? "ok";
                }
                break;

            case "generate":
            {
                var messages = new List<ChatMessage>();
                foreach (var raw in MiniJson.List(request, "messages") ?? new List<object>())
                    if (raw is Dictionary<string, object> m) messages.Add(new ChatMessage(MiniJson.Text(m, "role", "user"), MiniJson.Text(m, "content", "")));
                service.Generate(entry.Id, messages, MiniJson.Obj(request, "options"),
                    (delta, _) => Emit(new Dictionary<string, object> { ["type"] = "delta", ["delta"] = delta }),
                    Done);
                break;
            }

            case "embed":
            {
                var texts = MiniJson.Strings(request, "texts");
                var vectors = new List<float[]>();
                var items = new List<object>();
                foreach (var text in texts)
                {
                    Dictionary<string, object> one = null;
                    service.Embed(entry.Id, text, r => one = r);
                    if (one == null || !(one.TryGetValue("ok", out var ok) && ok is bool b && b)) { result = one ?? InferenceService.Failure("embedFailed"); break; }
                    var list = MiniJson.List(one, "vector");
                    var vector = new float[list.Count];
                    for (int i = 0; i < vector.Length; i++) vector[i] = (float)(double)list[i];
                    vectors.Add(vector);
                    items.Add(new Dictionary<string, object>
                    {
                        ["text"] = text,
                        ["dims"] = (double)vector.Length,
                        ["head"] = PreviewValues(vector, 8),
                        ["similarity"] = vectors.Count > 1 ? TextEncoding.Cosine(vectors[0], vector) : 1.0,
                        ["ms"] = one["ms"],
                    });
                }
                result ??= new Dictionary<string, object> { ["ok"] = true, ["items"] = items };
                break;
            }

            case "classify":
                service.ClassifyText(entry.Id, MiniJson.Text(request, "text", ""), Done);
                break;

            case "tokenize":
            {
                var ids = service.Tokenize(entry.Id, MiniJson.Text(request, "text", ""), out var error);
                if (ids == null) { result = InferenceService.Failure(error); break; }
                var tokenizer = service.Tokenizer(entry, out _);
                var tokens = new List<object>();
                foreach (var id in ids) tokens.Add(new Dictionary<string, object> { ["id"] = (double)id, ["token"] = tokenizer.TokenOf(id) });
                result = new Dictionary<string, object> { ["ok"] = true, ["tokens"] = tokens, ["roundTrip"] = tokenizer.Decode(ids, false) };
                break;
            }

            case "run":
            {
                var inputs = MiniJson.Obj(request, "inputs") ?? new Dictionary<string, object>();
                var fill = MiniJson.Text(request, "fill", "zeros");
                var dims = MiniJson.Obj(request, "dims");
                var random = new Random(1);
                foreach (var info in signature.Inputs)
                {
                    if (inputs.ContainsKey(info.Name)) continue;
                    var shape = info.Shape != null ? (int[])info.Shape.Clone() : new[] { 1 };
                    var wanted = MiniJson.List(dims, info.Name);
                    for (int i = 0; i < shape.Length; i++)
                    {
                        if (wanted != null && i < wanted.Count && wanted[i] is double d && d >= 0) shape[i] = (int)d;
                        else if (shape[i] < 0) shape[i] = 1;
                    }
                    long count = ModelTensor.Count(shape);
                    var data = new List<object>((int)Math.Min(count, 1 << 24));
                    for (long i = 0; i < count; i++)
                        data.Add(fill == "ones" ? 1.0 : fill == "random" ? (info.Kind == TensorKind.Float ? random.NextDouble() : random.Next(0, 100)) : 0.0);
                    var shapeList = new List<object>();
                    foreach (var s in shape) shapeList.Add((double)s);
                    inputs[info.Name] = new Dictionary<string, object> { ["type"] = ModelTensor.KindName(info.Kind), ["shape"] = shapeList, ["data"] = data };
                }
                service.Run(entry.Id, inputs, 32, Done);
                break;
            }

            case "image":
            {
                var path = MiniJson.Text(request, "image");
                if (path == null || !File.Exists(path)) { result = InferenceService.Failure("noImage"); break; }
                service.RunImage(entry.Id, ReadRgba(path), Done);
                break;
            }

            default:
                result = InferenceService.Failure("unknownAction:" + action);
                break;
        }

        result ??= InferenceService.Failure("noResult");
        result["type"] = "result";
        Emit(result);
        return 0;
    }

    private static List<object> PreviewValues(float[] values, int count)
    {
        var list = new List<object>();
        for (int i = 0; i < Math.Min(count, values.Length); i++) list.Add(Math.Round(values[i], 4));
        return list;
    }

    private static ColorImage ReadRgba(string path)
    {
        var bytes = File.ReadAllBytes(path);
        int width = BitConverter.ToInt32(bytes, 0);
        int height = BitConverter.ToInt32(bytes, 4);
        var rgba = new byte[width * height * 4];
        Array.Copy(bytes, 8, rgba, 0, Math.Min(rgba.Length, bytes.Length - 8));
        return ColorImage.FromRgba(rgba, width, height);
    }
}
#endif
