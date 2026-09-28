// ==============================================
// Arsist Engine - Perception / Models
// モデル定義 (IR の ModelDefinition をそのまま写したもの)
//
// ONNX には「入力をどう正規化するか」「出力をどう読むか」が書かれていない。
// その分だけを IR 側で持ち、ここに読み込む。重み自体は ONNX のまま。
//
// JSON ライブラリに依存しないよう、素の辞書 (Dictionary / List / 数 / 文字列) から作る。
// Unity 側は Newtonsoft の JObject を、エディタのツール側は System.Text.Json を、
// それぞれ素の辞書に直してから渡す。
//
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;
using System.Globalization;

namespace Arsist.Runtime.Perception.Models
{
    public enum ModelTask { Classify, Detect, Segment, Raw }

    public sealed class ModelInputSpec
    {
        public string Name;
        public int Width = 224;
        public int Height = 224;
        /// <summary>"NCHW" か "NHWC"</summary>
        public string Layout = "NCHW";
        public int Channels = 3;
        /// <summary>"RGB" か "BGR"</summary>
        public string ColorOrder = "RGB";
        public double Scale = 1.0 / 255.0;
        public double[] Mean = { 0, 0, 0 };
        public double[] Std = { 1, 1, 1 };
        /// <summary>"stretch" か "letterbox"</summary>
        public string Resize = "stretch";
        public int PadValue = 114;

        public bool ChannelsFirst => !string.Equals(Layout, "NHWC", StringComparison.OrdinalIgnoreCase);
        public bool Letterbox => string.Equals(Resize, "letterbox", StringComparison.OrdinalIgnoreCase);
        public bool Bgr => string.Equals(ColorOrder, "BGR", StringComparison.OrdinalIgnoreCase);

        public double MeanOf(int c) => Mean != null && c < Mean.Length ? Mean[c] : 0;
        public double StdOf(int c) => Std != null && c < Std.Length && Std[c] != 0 ? Std[c] : 1;
    }

    public sealed class ModelOutputSpec
    {
        public string Name;

        // classify
        public bool Softmax = true;
        public int TopK = 5;

        // detect
        /// <summary>"yolo" / "yolo5" / "xyxyScoreClass" / "separate"</summary>
        public string BoxLayout = "yolo";
        public string BoxesName;
        public string ScoresName;
        public string ClassesName;
        public bool BoxesNormalized;
        /// <summary>"xyxy" / "cxcywh" / "xywh"</summary>
        public string BoxFormat = "cxcywh";
        public double ScoreThreshold = 0.35;
        public double IouThreshold = 0.5;
        public int MaxItems = 20;

        // segment
        /// <summary>"argmax" / "sigmoid"</summary>
        public string MaskMode = "argmax";
        public int[] ClassIndices = { 1 };
        public double MaskThreshold = 0.5;
        public bool ApplySigmoid;

        // raw
        public int RawLimit = 16;
    }

    public sealed class ModelSpec
    {
        public string Id;
        public string Name;
        /// <summary>ONNX のパス。エディタではプロジェクト相対、ツールでは絶対、実機では Resources 名。</summary>
        public string File;
        public ModelTask Task = ModelTask.Raw;
        public ModelInputSpec Input = new ModelInputSpec();
        public ModelOutputSpec Output = new ModelOutputSpec();
        public string[] Labels = Array.Empty<string>();
        /// <summary>"auto" / "gpu" / "cpu"</summary>
        public string Backend = "auto";
        /// <summary>
        /// "image" / "text" / "tensor" (IR v3)。画像認識の `infer` op が使えるのは image だけ。
        /// 項目が無い定義 (v2 まで) はすべて画像のモデル。
        /// </summary>
        public string Use = "image";

        public string LabelOf(int index)
        {
            if (Labels != null && index >= 0 && index < Labels.Length && !string.IsNullOrEmpty(Labels[index]))
                return Labels[index];
            return index.ToString(CultureInfo.InvariantCulture);
        }

        // ---- 素の辞書から --------------------------------------------------

        public static ModelSpec FromPlain(Dictionary<string, object> plain)
        {
            if (plain == null) return null;
            var spec = new ModelSpec
            {
                Id = Text(plain, "id"),
                Name = Text(plain, "name"),
                File = Text(plain, "file"),
                Task = ParseTask(Text(plain, "task")),
                Backend = Text(plain, "backend") ?? "auto",
                Use = Text(plain, "use") ?? "image",
                Labels = Strings(plain, "labels"),
            };

            if (plain.TryGetValue("input", out var inputRaw) && inputRaw is Dictionary<string, object> input)
            {
                var i = spec.Input;
                i.Name = Text(input, "name");
                i.Width = Int(input, "width", i.Width);
                i.Height = Int(input, "height", i.Height);
                i.Layout = Text(input, "layout") ?? i.Layout;
                i.Channels = Int(input, "channels", i.Channels);
                i.ColorOrder = Text(input, "colorOrder") ?? i.ColorOrder;
                i.Scale = Number(input, "scale", i.Scale);
                i.Mean = Numbers(input, "mean") ?? i.Mean;
                i.Std = Numbers(input, "std") ?? i.Std;
                i.Resize = Text(input, "resize") ?? i.Resize;
                i.PadValue = Int(input, "padValue", i.PadValue);
            }

            if (plain.TryGetValue("output", out var outputRaw) && outputRaw is Dictionary<string, object> output)
            {
                var o = spec.Output;
                o.Name = Text(output, "name");
                o.Softmax = Bool(output, "softmax", o.Softmax);
                o.TopK = Int(output, "topK", o.TopK);
                o.BoxLayout = Text(output, "boxLayout") ?? o.BoxLayout;
                o.BoxesName = Text(output, "boxesName");
                o.ScoresName = Text(output, "scoresName");
                o.ClassesName = Text(output, "classesName");
                o.BoxesNormalized = Bool(output, "boxesNormalized", o.BoxesNormalized);
                o.BoxFormat = Text(output, "boxFormat") ?? o.BoxFormat;
                o.ScoreThreshold = Number(output, "scoreThreshold", o.ScoreThreshold);
                o.IouThreshold = Number(output, "iouThreshold", o.IouThreshold);
                o.MaxItems = Int(output, "maxItems", o.MaxItems);
                o.MaskMode = Text(output, "maskMode") ?? o.MaskMode;
                var classes = Ints(output, "classIndices");
                if (classes != null) o.ClassIndices = classes;
                o.MaskThreshold = Number(output, "maskThreshold", o.MaskThreshold);
                o.ApplySigmoid = Bool(output, "applySigmoid", o.ApplySigmoid);
                o.RawLimit = Int(output, "rawLimit", o.RawLimit);
            }

            return spec;
        }

        public static ModelTask ParseTask(string text)
        {
            switch ((text ?? "").ToLowerInvariant())
            {
                case "classify": return ModelTask.Classify;
                case "detect": return ModelTask.Detect;
                case "segment": return ModelTask.Segment;
                default: return ModelTask.Raw;
            }
        }

        private static string Text(Dictionary<string, object> d, string key)
        {
            if (!d.TryGetValue(key, out var raw) || raw == null) return null;
            var s = Convert.ToString(raw, CultureInfo.InvariantCulture);
            return string.IsNullOrEmpty(s) ? null : s;
        }

        private static double Number(Dictionary<string, object> d, string key, double fallback)
        {
            if (!d.TryGetValue(key, out var raw) || raw == null) return fallback;
            try { return Convert.ToDouble(raw, CultureInfo.InvariantCulture); }
            catch { return fallback; }
        }

        private static int Int(Dictionary<string, object> d, string key, int fallback) =>
            (int)Math.Round(Number(d, key, fallback));

        private static bool Bool(Dictionary<string, object> d, string key, bool fallback)
        {
            if (!d.TryGetValue(key, out var raw) || raw == null) return fallback;
            if (raw is bool b) return b;
            return string.Equals(raw.ToString(), "true", StringComparison.OrdinalIgnoreCase);
        }

        private static double[] Numbers(Dictionary<string, object> d, string key)
        {
            if (!d.TryGetValue(key, out var raw) || !(raw is List<object> list)) return null;
            var values = new double[list.Count];
            for (int i = 0; i < list.Count; i++)
            {
                try { values[i] = Convert.ToDouble(list[i], CultureInfo.InvariantCulture); }
                catch { values[i] = 0; }
            }
            return values;
        }

        private static int[] Ints(Dictionary<string, object> d, string key)
        {
            var numbers = Numbers(d, key);
            if (numbers == null) return null;
            var ints = new int[numbers.Length];
            for (int i = 0; i < numbers.Length; i++) ints[i] = (int)Math.Round(numbers[i]);
            return ints;
        }

        private static string[] Strings(Dictionary<string, object> d, string key)
        {
            if (!d.TryGetValue(key, out var raw) || !(raw is List<object> list)) return Array.Empty<string>();
            var values = new string[list.Count];
            for (int i = 0; i < list.Count; i++) values[i] = list[i]?.ToString() ?? "";
            return values;
        }
    }
}
