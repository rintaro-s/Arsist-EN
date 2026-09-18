// パイプラインを1枚の画像に流して、各ステップの結果を書き出す。
//
// エディタが「この一手で何が起きたか」を見せるために使う。実機と同じ C# を
// 呼んでいるので、ここで見えているものがそのまま端末でも起きる。
//
//   VisionPreview --pipeline p.json --image in.rgba --out outdir/
//
// 画像は生の RGBA。先頭 8 バイトが width, height (little-endian int32) で、
// あとは下から上の行順で RGBA が並ぶ (ColorImage と同じ規約)。
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Arsist.Runtime.Perception.Pipeline;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Vision.Classic;

internal static class Program
{
    private static int Main(string[] args)
    {
        string pipelinePath = null, imagePath = null, outDir = null;
        for (int i = 0; i + 1 < args.Length; i += 2)
        {
            switch (args[i])
            {
                case "--pipeline": pipelinePath = args[i + 1]; break;
                case "--image": imagePath = args[i + 1]; break;
                case "--out": outDir = args[i + 1]; break;
            }
        }

        if (pipelinePath == null || imagePath == null || outDir == null)
        {
            Console.Error.WriteLine("usage: VisionPreview --pipeline p.json --image in.rgba --out dir");
            return 2;
        }

        try
        {
            var pipeline = ReadPipeline(File.ReadAllText(pipelinePath));
            var source = ReadRgba(imagePath);

            Directory.CreateDirectory(outDir);
            var result = VisionPipelineRunner.Run(pipeline, source);

            var report = new Dictionary<string, object>
            {
                ["ok"] = result.Ok,
                ["error"] = result.Error,
                ["gated"] = result.Gated,
                ["gateReason"] = result.GateReason,
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
                pipeline.Outputs.Add(new VisionOutputSpec
                {
                    Kind = Text(entry, "kind") ?? "store",
                    Value = Text(entry, "value"),
                    Alpha = Text(entry, "alpha"),
                    StoreAs = Text(entry, "storeAs"),
                    BindingId = Text(entry, "bindingId"),
                });
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
}
