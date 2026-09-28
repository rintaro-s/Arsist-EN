// パイプラインを画像 (1 枚か、連続したフレーム) に流して、各ステップの結果を書き出す。
//
// エディタが「この一手で何が起きたか」を見せるために使う。実機と同じ C# を
// 呼んでいるので、ここで見えているものがそのまま端末でも起きる。
//
//   VisionPreview --pipeline p.json --image in.rgba --out outdir/
//   VisionPreview --pipeline p.json --image f0.rgba --image f1.rgba … --focus 1 --fps 2 --out outdir/
//   VisionPreview --model-try request.json      (モデルタブの「試す」、ModelTry.cs)
//
// 複数のフレームを渡すと、状態 (track / stabilize / motion / event) を引き継いで順に流す。
// 各ステップの画を書き出すのは --focus のフレームだけ。全フレームぶんの値・件数・イベントは
// result.json の frames に入る (エディタの時間軸に出す)。
//
// 画像は生の RGBA。先頭 8 バイトが width, height (little-endian int32) で、
// あとは下から上の行順で RGBA が並ぶ (ColorImage と同じ規約)。
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Arsist.Runtime.Perception.Models;
using Arsist.Runtime.Perception.Pipeline;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Vision.Classic;

internal static class Program
{
    private static int Main(string[] args)
    {
        // モデルタブの「試す」(文章のモデル・テンソルのモデルも)。ONNX Runtime が要る。
        if (args.Length >= 2 && args[0] == "--model-try")
        {
#if ARSIST_ONNX
            return ModelTry.Main(args[1]);
#else
            Console.WriteLine("{\"type\":\"result\",\"ok\":false,\"error\":\"onnxRuntimeMissing\"}");
            return 3;
#endif
        }

        string pipelinePath = null, outDir = null, modelsPath = null, probePath = null;
        var imagePaths = new List<string>();
        int focus = -1;
        double fps = 2;
        for (int i = 0; i + 1 < args.Length; i += 2)
        {
            switch (args[i])
            {
                case "--pipeline": pipelinePath = args[i + 1]; break;
                case "--image": imagePaths.Add(args[i + 1]); break;
                case "--out": outDir = args[i + 1]; break;
                case "--models": modelsPath = args[i + 1]; break;
                case "--probe": probePath = args[i + 1]; break;
                case "--focus": int.TryParse(args[i + 1], out focus); break;
                case "--fps": double.TryParse(args[i + 1], System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out fps); break;
            }
        }

        if (pipelinePath == null || imagePaths.Count == 0 || outDir == null)
        {
            Console.Error.WriteLine("usage: VisionPreview --pipeline p.json --image in.rgba [--image …] [--focus n] [--fps n] --out dir");
            return 2;
        }
        if (focus < 0 || focus >= imagePaths.Count) focus = imagePaths.Count - 1;
        if (fps <= 0) fps = 2;

        try
        {
            var pipeline = ReadPipeline(File.ReadAllText(pipelinePath));

            // `infer` op が使うモデル。定義は JSON、重みは ONNX Runtime が直接読む。
            IReadOnlyDictionary<string, ModelSpec> models = null;
            IVisionModelRunner runner = null;
            if (modelsPath != null)
            {
                models = ReadModels(File.ReadAllText(modelsPath));
#if ARSIST_ONNX
                runner = new OnnxModelRunner();
#endif
            }

            Directory.CreateDirectory(outDir);

            // フレームを順に流す。状態は引き継ぐ (実機と同じ)。
            var state = new VisionState();
            var frames = new List<object>();
            VisionPipelineResult result = null;
            for (int f = 0; f < imagePaths.Count; f++)
            {
                var source = ReadRgba(imagePaths[f]);
                var frameResult = VisionPipelineRunner.Run(pipeline, source, null, models, runner, state, f / fps);
                frames.Add(Summarise(f, frameResult));
                if (f == focus) result = frameResult;
            }

            var report = new Dictionary<string, object>
            {
                ["ok"] = result.Ok,
                ["error"] = result.Error,
                ["gated"] = result.Gated,
                ["gateReason"] = result.GateReason,
                ["events"] = result.Events,
                ["focus"] = focus,
                ["frames"] = frames,
            };

            var steps = new List<object>();
            foreach (var pair in result.Named)
            {
                var value = pair.Value;
                var entry = new Dictionary<string, object>
                {
                    ["name"] = pair.Key,
                    ["kind"] = value.Kind.ToString().ToLowerInvariant(),
                };

                // 画になるものは書き出す。数や一覧はそのまま JSON に載せる。
                var rgba = Visualise(value);
                if (rgba != null)
                {
                    var file = Sanitise(pair.Key) + ".rgba";
                    WriteRgba(Path.Combine(outDir, file), rgba, value.Width, value.Height);
                    entry["image"] = file;
                    entry["width"] = value.Width;
                    entry["height"] = value.Height;
                }
                else if (value.Kind == VisionValueKind.Record)
                {
                    entry["record"] = value.Record;
                }
                else if (value.Items != null)
                {
                    entry["items"] = value.Items;
                    entry["count"] = value.Items.Count;
                }
                else if (value.Boundary != null)
                {
                    entry["boundary"] = value.Boundary;
                }

                steps.Add(entry);
            }
            report["steps"] = steps;
            report["values"] = result.Values;

            // 候補の一手を「今の画」で試す (エディタの「一手を足す」画面用)。
            // 結果は小さな絵にして返す。名前と説明を読んで想像するより、絵を見る方が早い。
            if (probePath != null)
            {
                report["probes"] = RunProbes(File.ReadAllText(probePath), pipeline, result, models, runner, outDir);
            }

            File.WriteAllText(Path.Combine(outDir, "result.json"),
                JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = false }));
            return 0;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine(e.Message);
            return 1;
        }
    }

    /// <summary>
    /// 候補の一手を、パイプラインの途中 (index の位置) の値に対して一つずつ試す。
    /// 状態 (track など) は使い捨て。絵は幅 200 に縮める (候補が 20 個あっても軽く送れるように)。
    /// </summary>
    private static List<object> RunProbes(
        string json, VisionPipelineSpec pipeline, VisionPipelineResult result,
        IReadOnlyDictionary<string, ModelSpec> models, IVisionModelRunner runner, string outDir)
    {
        var probes = new List<object>();
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        int index = root.TryGetProperty("index", out var indexProperty) && indexProperty.ValueKind == JsonValueKind.Number
            ? indexProperty.GetInt32() : pipeline.Ops.Count;

        // 挿入位置より前に作られている値だけが見える
        var visible = new Dictionary<string, VisionValue>(StringComparer.Ordinal);
        if (result.Named.TryGetValue(VisionPipelineRunner.SourceName, out var source)) visible[VisionPipelineRunner.SourceName] = source;
        for (int i = 0; i < Math.Min(index, pipeline.Ops.Count); i++)
        {
            var name = pipeline.Ops[i].Out;
            if (name != null && result.Named.TryGetValue(name, out var v)) visible[name] = v;
        }
        int width = source?.Color?.Width ?? 0, height = source?.Color?.Height ?? 0;

        if (!root.TryGetProperty("ops", out var ops) || ops.ValueKind != JsonValueKind.Array) return probes;
        int k = 0;
        foreach (var entry in ops.EnumerateArray())
        {
            var op = new VisionOpSpec { Id = Text(entry, "id"), Op = Text(entry, "op"), Out = Text(entry, "out") ?? "probe" };
            if (entry.TryGetProperty("in", out var inputs) && inputs.ValueKind == JsonValueKind.Array)
            {
                var names = new List<string>();
                foreach (var name in inputs.EnumerateArray()) if (name.ValueKind == JsonValueKind.String) names.Add(name.GetString());
                op.In = names.ToArray();
            }
            if (entry.TryGetProperty("params", out var parameters) && parameters.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in parameters.EnumerateObject()) op.Params[property.Name] = Plain(property.Value);
            }

            var probe = new Dictionary<string, object> { ["id"] = op.Id ?? op.Op, ["op"] = op.Op };
            try
            {
                if (!VisionOps.Signatures.TryGetValue(op.Op ?? "", out var signature)) throw new VisionPipelineException("unknown op");
                var args = new VisionValue[signature.Inputs.Length];
                for (int i = 0; i < args.Length; i++)
                {
                    if (i >= op.In.Length || !visible.TryGetValue(op.In[i], out args[i])) throw new VisionPipelineException("input missing");
                    if (args[i].Kind != signature.Inputs[i]) throw new VisionPipelineException("input type");
                }
                var context = new VisionContext(visible) { Width = width, Height = height, Models = models, ModelRunner = runner, State = new VisionState() };
                var value = VisionOps.Apply(op, args, context);
                probe["kind"] = value.Kind.ToString().ToLowerInvariant();
                if (context.StopReason != null) probe["stopped"] = context.StopReason;

                var rgba = Visualise(value);
                if (rgba != null)
                {
                    Downscale(rgba, value.Width, value.Height, 200, out var small, out int sw, out int sh);
                    var file = $"probe_{k}.rgba";
                    WriteRgba(Path.Combine(outDir, file), small, sw, sh);
                    probe["image"] = file;
                    probe["width"] = sw;
                    probe["height"] = sh;
                    if (value.Kind == VisionValueKind.Mask) probe["coverage"] = Math.Round(value.Mask.Coverage(), 4);
                }
                else if (value.Kind == VisionValueKind.Record) probe["record"] = value.Record;
                else if (value.Items != null) { probe["items"] = value.Items; probe["count"] = value.Items.Count; }
                else if (value.Boundary != null) probe["boundary"] = value.Boundary;
            }
            catch (Exception e)
            {
                probe["error"] = e.Message;
            }
            probes.Add(probe);
            k++;
        }
        return probes;
    }

    /// <summary>RGBA を最近傍で幅 targetWidth に縮める (小さな絵にするだけなので画質は要らない)。</summary>
    private static void Downscale(byte[] rgba, int width, int height, int targetWidth, out byte[] small, out int sw, out int sh)
    {
        if (width <= targetWidth) { small = rgba; sw = width; sh = height; return; }
        sw = targetWidth;
        sh = Math.Max(1, (int)Math.Round((double)height * targetWidth / width));
        small = new byte[sw * sh * 4];
        for (int y = 0; y < sh; y++)
        {
            int sy = Math.Min(height - 1, (int)((y + 0.5) * height / sh));
            for (int x = 0; x < sw; x++)
            {
                int sx = Math.Min(width - 1, (int)((x + 0.5) * width / sw));
                Array.Copy(rgba, (sy * width + sx) * 4, small, (y * sw + x) * 4, 4);
            }
        }
    }

    /// <summary>フレームごとの軽い要約 (時間軸に出す)。画は含めない。</summary>
    private static Dictionary<string, object> Summarise(int index, VisionPipelineResult result)
    {
        var counts = new Dictionary<string, object>();
        foreach (var pair in result.Named)
        {
            if (pair.Value.Items != null) counts[pair.Key] = pair.Value.Items.Count;
            else if (pair.Value.Kind == VisionValueKind.Mask) counts[pair.Key] = Math.Round(pair.Value.Mask.Coverage(), 4);
        }
        return new Dictionary<string, object>
        {
            ["index"] = index,
            ["ok"] = result.Ok,
            ["error"] = result.Error,
            ["gated"] = result.Gated,
            ["gateReason"] = result.GateReason,
            ["events"] = result.Events,
            ["values"] = result.Values,
            ["counts"] = counts,
        };
    }

    /// <summary>値を目で見える絵にする。マスクは白、勾配は明るさ、境界線は赤い折れ線。</summary>
    private static byte[] Visualise(VisionValue value)
    {
        switch (value.Kind)
        {
            case VisionValueKind.Color:
                return Composite.ToRgba(value.Color, null, 0);

            case VisionValueKind.Gray:
            {
                var color = new ColorImage(value.Gray.Width, value.Gray.Height);
                for (int i = 0, p = 0; i < value.Gray.Data.Length; i++, p += 3)
                {
                    color.Data[p] = color.Data[p + 1] = color.Data[p + 2] = value.Gray.Data[i];
                }
                return Composite.ToRgba(color, null, 0);
            }

            case VisionValueKind.Mask:
            {
                // マスクは「拾ったところ」が分かればよいので、白と黒でよい。
                var color = new ColorImage(value.Mask.Width, value.Mask.Height);
                for (int i = 0, p = 0; i < value.Mask.Data.Length; i++, p += 3)
                {
                    byte v = value.Mask.Data[i];
                    color.Data[p] = color.Data[p + 1] = color.Data[p + 2] = v;
                }
                return Composite.ToRgba(color, null, 0);
            }

            case VisionValueKind.Edges:
            {
                var color = new ColorImage(value.Edges.Width, value.Edges.Height);
                for (int i = 0, p = 0; i < value.Edges.Magnitude.Length; i++, p += 3)
                {
                    color.Data[p] = color.Data[p + 1] = color.Data[p + 2] = value.Edges.Magnitude[i];
                }
                return Composite.ToRgba(color, null, 0);
            }

            default:
                return null;
        }
    }

    private static string Sanitise(string name)
    {
        var chars = name.ToCharArray();
        for (int i = 0; i < chars.Length; i++)
        {
            if (!char.IsLetterOrDigit(chars[i]) && chars[i] != '_' && chars[i] != '-') chars[i] = '_';
        }
        return new string(chars);
    }

    // ---- 生 RGBA の読み書き ----

    private static ColorImage ReadRgba(string path)
    {
        var bytes = File.ReadAllBytes(path);
        if (bytes.Length < 8) throw new InvalidDataException("image file is too short");

        int width = BitConverter.ToInt32(bytes, 0);
        int height = BitConverter.ToInt32(bytes, 4);
        if (width <= 0 || height <= 0) throw new InvalidDataException("bad image size");

        int needed = 8 + width * height * 4;
        if (bytes.Length < needed) throw new InvalidDataException("image data is truncated");

        var rgba = new byte[width * height * 4];
        Array.Copy(bytes, 8, rgba, 0, rgba.Length);
        return ColorImage.FromRgba(rgba, width, height);
    }

    private static void WriteRgba(string path, byte[] rgba, int width, int height)
    {
        using var stream = File.Create(path);
        stream.Write(BitConverter.GetBytes(width));
        stream.Write(BitConverter.GetBytes(height));
        stream.Write(rgba);
    }

    // ---- パイプライン JSON ----

    private static VisionPipelineSpec ReadPipeline(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        var pipeline = new VisionPipelineSpec
        {
            Id = Text(root, "id"),
            Name = Text(root, "name"),
            MaxWidth = root.TryGetProperty("maxWidth", out var mw) && mw.ValueKind == JsonValueKind.Number
                ? mw.GetInt32() : 480,
        };

        if (root.TryGetProperty("ops", out var ops) && ops.ValueKind == JsonValueKind.Array)
        {
            foreach (var entry in ops.EnumerateArray())
            {
                var op = new VisionOpSpec
                {
                    Id = Text(entry, "id"),
                    Op = Text(entry, "op"),
                    Out = Text(entry, "out"),
                    Disabled = entry.TryGetProperty("disabled", out var disabled) && disabled.ValueKind == JsonValueKind.True,
                };

                if (entry.TryGetProperty("in", out var inputs) && inputs.ValueKind == JsonValueKind.Array)
                {
                    var names = new List<string>();
                    foreach (var name in inputs.EnumerateArray())
                    {
                        if (name.ValueKind == JsonValueKind.String) names.Add(name.GetString());
                    }
                    op.In = names.ToArray();
                }

                if (entry.TryGetProperty("params", out var parameters)
                    && parameters.ValueKind == JsonValueKind.Object)
                {
                    foreach (var property in parameters.EnumerateObject())
                    {
                        op.Params[property.Name] = Plain(property.Value);
                    }
                }
                pipeline.Ops.Add(op);
            }
        }

        if (root.TryGetProperty("outputs", out var outputs) && outputs.ValueKind == JsonValueKind.Array)
        {
            foreach (var entry in outputs.EnumerateArray())
            {
                var output = new VisionOutputSpec
                {
                    Kind = Text(entry, "kind") ?? "store",
                    Value = Text(entry, "value"),
                    Alpha = Text(entry, "alpha"),
                    StoreAs = Text(entry, "storeAs"),
                    BindingId = Text(entry, "bindingId"),
                    ObjectId = Text(entry, "objectId"),
                };
                if (entry.TryGetProperty("distance", out var distance) && distance.ValueKind == JsonValueKind.Number)
                    output.Distance = distance.GetDouble();
                if (entry.TryGetProperty("label", out var label) && label.ValueKind == JsonValueKind.String)
                    output.Label = label.GetString();
                if (entry.TryGetProperty("maxItems", out var maxItems) && maxItems.ValueKind == JsonValueKind.Number)
                    output.MaxItems = maxItems.GetInt32();
                pipeline.Outputs.Add(output);
            }
        }

        return pipeline;
    }

    private static string Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() : null;

    private static object Plain(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Number:
                return element.TryGetInt64(out long l) ? l : (object)element.GetDouble();
            case JsonValueKind.True: return true;
            case JsonValueKind.False: return false;
            case JsonValueKind.Null: return null;
            default: return element.ToString();
        }
    }

    // ---- モデル定義 JSON ----

    /// <summary>入れ子も含めて素の辞書 / リストに直す。ModelSpec.FromPlain が読む形。</summary>
    private static object PlainTree(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
            {
                var dict = new Dictionary<string, object>();
                foreach (var property in element.EnumerateObject()) dict[property.Name] = PlainTree(property.Value);
                return dict;
            }
            case JsonValueKind.Array:
            {
                var list = new List<object>();
                foreach (var item in element.EnumerateArray()) list.Add(PlainTree(item));
                return list;
            }
            default:
                return Plain(element);
        }
    }

    private static IReadOnlyDictionary<string, ModelSpec> ReadModels(string json)
    {
        var models = new Dictionary<string, ModelSpec>();
        using var document = JsonDocument.Parse(json);
        if (document.RootElement.ValueKind != JsonValueKind.Array) return models;
        foreach (var entry in document.RootElement.EnumerateArray())
        {
            if (!(PlainTree(entry) is Dictionary<string, object> plain)) continue;
            var spec = ModelSpec.FromPlain(plain);
            if (spec != null && !string.IsNullOrEmpty(spec.Id)) models[spec.Id] = spec;
        }
        return models;
    }
}
