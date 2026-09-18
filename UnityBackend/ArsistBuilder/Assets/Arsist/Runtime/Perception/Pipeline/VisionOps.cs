// ==============================================
// Arsist Engine - Perception / Pipeline
// 画像処理の一手
//
// ここにあるのは全部「汎用の一手」で、特定のアプリのための機能はひとつも無い。
// 「曇り空を青空にする」も「赤いランプを数える」も、これらの並べ方の違いでしかない。
//
// 新しい op を足すときは:
//   1. Apply に case を足す
//   2. Signature に入出力の型を書く (エディタの結線チェックがこれを見る)
//   3. tools/perception-check に合成画像の検証を足す
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Vision.Classic;

namespace Arsist.Runtime.Perception.Pipeline
{
    /// <summary>op ひとつの定義。パイプラインの JSON をそのまま写したもの。</summary>
    public sealed class VisionOpSpec
    {
        public string Id;
        public string Op;
        public string[] In = Array.Empty<string>();
        public string Out;
        public Dictionary<string, object> Params = new Dictionary<string, object>();

        public double Number(string key, double fallback)
        {
            if (Params == null || !Params.TryGetValue(key, out var raw) || raw == null) return fallback;
            try { return Convert.ToDouble(raw); }
            catch { return fallback; }
        }

        public int Int(string key, int fallback) => (int)Math.Round(Number(key, fallback));

        public bool Bool(string key, bool fallback)
        {
            if (Params == null || !Params.TryGetValue(key, out var raw) || raw == null) return fallback;
            if (raw is bool b) return b;
            return string.Equals(raw.ToString(), "true", StringComparison.OrdinalIgnoreCase);
        }

        public string Text(string key, string fallback)
        {
            if (Params == null || !Params.TryGetValue(key, out var raw) || raw == null) return fallback;
            var s = raw.ToString();
            return string.IsNullOrEmpty(s) ? fallback : s;
        }
    }

    /// <summary>op の入出力の型。エディタの結線チェックとビルド時の検証が共有する。</summary>
    public sealed class VisionOpSignature
    {
        public VisionValueKind[] Inputs;
        public VisionValueKind Output;
        public VisionOpSignature(VisionValueKind output, params VisionValueKind[] inputs)
        {
            Output = output;
            Inputs = inputs;
        }
    }

    public static class VisionOps
    {
        /// <summary>op 名 → 入出力の型。</summary>
        public static readonly Dictionary<string, VisionOpSignature> Signatures =
            new Dictionary<string, VisionOpSignature>(StringComparer.OrdinalIgnoreCase)
            {
                ["grayscale"] = new VisionOpSignature(VisionValueKind.Gray, VisionValueKind.Color),
                ["blur"] = new VisionOpSignature(VisionValueKind.Gray, VisionValueKind.Gray),
                ["sobel"] = new VisionOpSignature(VisionValueKind.Edges, VisionValueKind.Gray),
                ["canny"] = new VisionOpSignature(VisionValueKind.Mask, VisionValueKind.Gray),
                ["edgeScan"] = new VisionOpSignature(VisionValueKind.Boundary, VisionValueKind.Edges),
                ["maskSide"] = new VisionOpSignature(VisionValueKind.Mask, VisionValueKind.Boundary),
                ["hsvRange"] = new VisionOpSignature(VisionValueKind.Mask, VisionValueKind.Color),
                ["threshold"] = new VisionOpSignature(VisionValueKind.Mask, VisionValueKind.Gray),
                ["morphology"] = new VisionOpSignature(VisionValueKind.Mask, VisionValueKind.Mask),
                ["maskCombine"] = new VisionOpSignature(VisionValueKind.Mask, VisionValueKind.Mask, VisionValueKind.Mask),
                ["largestBlob"] = new VisionOpSignature(VisionValueKind.Mask, VisionValueKind.Mask),
                ["blobs"] = new VisionOpSignature(VisionValueKind.Blobs, VisionValueKind.Mask),
                ["contours"] = new VisionOpSignature(VisionValueKind.Contours, VisionValueKind.Mask),
                ["stats"] = new VisionOpSignature(VisionValueKind.Record, VisionValueKind.Mask),
                ["gate"] = new VisionOpSignature(VisionValueKind.Record, VisionValueKind.Record),
                ["recolor"] = new VisionOpSignature(VisionValueKind.Color, VisionValueKind.Color, VisionValueKind.Mask),
                ["dominantColor"] = new VisionOpSignature(VisionValueKind.Record, VisionValueKind.Color),
                ["templateMatch"] = new VisionOpSignature(VisionValueKind.Record, VisionValueKind.Gray),
            };

        /// <summary>
        /// 一手を適用する。
        /// 入力の型はここに来るまでに Validate 済みという前提。
        /// </summary>
        public static VisionValue Apply(VisionOpSpec spec, VisionValue[] inputs, VisionContext context)
        {
            switch (spec.Op.ToLowerInvariant())
            {
                case "grayscale": return VisionValue.OfGray(inputs[0].Color.ToGray());

                case "blur":
                {
                    var gray = inputs[0].Gray;
                    int passes = Math.Max(1, Math.Min(8, spec.Int("passes", 1)));
                    for (int i = 0; i < passes; i++) gray = gray.Blur();
                    return VisionValue.OfGray(gray);
                }

                case "sobel": return VisionValue.OfEdges(EdgeDetector.Sobel(inputs[0].Gray));

                case "canny":
                    return VisionValue.OfMask(EdgeDetector.Canny(
                        inputs[0].Gray, spec.Int("low", 40), spec.Int("high", 90)));

                case "edgescan":
                    return VisionValue.OfBoundary(BoundaryScanner.Scan(
                        inputs[0].Edges,
                        spec.Text("from", "top"),
                        spec.Int("threshold", 22),
                        spec.Int("smooth", 12),
                        spec.Number("limit", 0.95)));

                case "maskside":
                    return VisionValue.OfMask(BoundaryScanner.SideMask(
                        inputs[0].Boundary,
                        context.Width, context.Height,
                        spec.Text("from", "top"),
                        spec.Text("keep", "before")));

                case "hsvrange":
                    return VisionValue.OfMask(Threshold.HsvRange(
                        inputs[0].Color,
                        spec.Int("hueMin", 0), spec.Int("hueMax", 359),
                        spec.Int("satMin", 0), spec.Int("satMax", 255),
                        spec.Int("valMin", 0), spec.Int("valMax", 255)));

                case "threshold": return ApplyThreshold(spec, inputs, context);

                case "morphology":
                {
                    var mask = inputs[0].Mask;
                    int radius = Math.Max(1, Math.Min(32, spec.Int("radius", 1)));
                    switch (spec.Text("mode", "open").ToLowerInvariant())
                    {
                        case "erode": return VisionValue.OfMask(Morphology.Erode(mask, radius));
                        case "dilate": return VisionValue.OfMask(Morphology.Dilate(mask, radius));
                        case "close": return VisionValue.OfMask(Morphology.Close(mask, radius));
                        default: return VisionValue.OfMask(Morphology.Open(mask, radius));
                    }
                }

                case "maskcombine":
                    return VisionValue.OfMask(MaskAlgebra.Combine(
                        inputs[0].Mask, inputs.Length > 1 ? inputs[1].Mask : null,
                        spec.Text("mode", "and")));

                case "largestblob":
                {
                    var labelled = ConnectedComponents.Label(inputs[0].Mask, spec.Int("minArea", 1));
                    var largest = labelled.Largest();
                    return VisionValue.OfMask(largest == null
                        ? new MaskImage(inputs[0].Mask.Width, inputs[0].Mask.Height)
                        : labelled.MaskOf(largest));
                }

                case "blobs": return ApplyBlobs(spec, inputs[0].Mask);

                case "contours": return ApplyContours(spec, inputs[0].Mask);

                case "stats": return ApplyStats(spec, inputs, context);

                case "gate": return ApplyGate(spec, inputs[0].Record, context);

                case "recolor":
                    return VisionValue.OfColor(Recolor.Apply(
                        inputs[0].Color, inputs[1].Mask,
                        spec.Text("topColor", "#2060D2"),
                        spec.Text("bottomColor", "#9EC8F2"),
                        spec.Number("strength", 1.0),
                        spec.Bool("preserveLuminance", true)));

                case "dominantcolor":
                    return VisionValue.OfRecord(ColorSummary.Describe(
                        inputs[0].Color,
                        inputs.Length > 1 ? inputs[1].Mask : null,
                        spec.Int("minSaturation", 40),
                        spec.Int("minValue", 30)));

                case "templatematch":
                {
                    var template = context.LoadTemplate(spec.Text("template", null));
                    if (template == null)
                    {
                        return VisionValue.OfRecord(new Dictionary<string, object>
                        {
                            ["found"] = false, ["error"] = "templateMissing",
                        });
                    }
                    var match = TemplateMatcher.Match(
                        inputs[0].Gray, template, spec.Number("minScore", 0.7), spec.Int("step", 1));
                    return VisionValue.OfRecord(new Dictionary<string, object>
                    {
                        ["found"] = match.Found,
                        ["score"] = Math.Round(match.Score, 4),
                        ["x"] = Math.Round((double)match.X / Math.Max(1, inputs[0].Gray.Width), 4),
                        ["y"] = Math.Round((double)match.Y / Math.Max(1, inputs[0].Gray.Height), 4),
                    });
                }

                default:
                    throw new VisionPipelineException($"unknown op '{spec.Op}'");
            }
        }

        // ---- しきい値 ----

        private static VisionValue ApplyThreshold(VisionOpSpec spec, VisionValue[] inputs, VisionContext context)
        {
            var gray = inputs[0].Gray;
            bool invert = spec.Bool("invert", false);

            switch (spec.Text("mode", "otsu").ToLowerInvariant())
            {
                case "fixed":
                    return VisionValue.OfMask(Threshold.Fixed(gray, spec.Int("value", 128), invert));

                case "relativemedian":
                {
                    // 「周りと比べて明るい/暗い」。絶対値で切ると、暗い場面でまるごと落ちる。
                    // 対象領域の中央値を基準にするので、明るさが変わっても同じように効く。
                    var within = spec.Text("within", null);
                    MaskImage region = null;
                    if (!string.IsNullOrEmpty(within) && context.TryGet(within, out var regionValue)
                        && regionValue.Kind == VisionValueKind.Mask)
                    {
                        region = regionValue.Mask;
                    }

                    int median = Statistics.Median(gray, region);
                    double ratio = spec.Number("ratio", 0.5);
                    int floor = spec.Int("floor", 0);
                    int ceiling = spec.Int("ceiling", 255);

                    int threshold = (int)Math.Round(median * ratio);
                    if (threshold < floor) threshold = floor;
                    if (threshold > ceiling) threshold = ceiling;

                    context.Note(spec.Out + ".threshold", threshold);
                    return VisionValue.OfMask(Threshold.Fixed(gray, threshold, invert));
                }

                default:
                    return VisionValue.OfMask(Threshold.Otsu(gray, invert));
            }
        }

        // ---- 塊と輪郭 ----

        private static VisionValue ApplyBlobs(VisionOpSpec spec, MaskImage mask)
        {
            var labelled = ConnectedComponents.Label(mask, spec.Int("minArea", 60));
            labelled.Blobs.Sort((a, b) => b.Area.CompareTo(a.Area));

            int maxItems = Math.Max(1, spec.Int("maxItems", 8));
            var items = new List<object>();
            for (int i = 0; i < labelled.Blobs.Count && i < maxItems; i++)
            {
                var blob = labelled.Blobs[i];
                items.Add(new Dictionary<string, object>
                {
                    ["area"] = blob.Area,
                    // 位置は正規化して返す。解像度が変わっても bind 側を直さずに済む。
                    ["x"] = Math.Round(blob.CentroidX / mask.Width, 4),
                    ["y"] = Math.Round(blob.CentroidY / mask.Height, 4),
                    ["width"] = Math.Round((double)blob.BoundsWidth / mask.Width, 4),
                    ["height"] = Math.Round((double)blob.BoundsHeight / mask.Height, 4),
                    ["fill"] = Math.Round(blob.Fill, 4),
                    ["aspect"] = Math.Round(blob.Aspect, 4),
                });
            }
            return VisionValue.OfBlobs(items);
        }

        private static VisionValue ApplyContours(VisionOpSpec spec, MaskImage mask)
        {
            var contours = Contours.FindExternal(mask);
            contours.Sort((a, b) => Math.Abs(b.Area()).CompareTo(Math.Abs(a.Area())));

            int minArea = spec.Int("minArea", 60);
            int maxItems = Math.Max(1, spec.Int("maxItems", 8));

            var items = new List<object>();
            foreach (var contour in contours)
            {
                double area = Math.Abs(contour.Area());
                if (area < minArea) continue;
                if (items.Count >= maxItems) break;

                double cx = 0, cy = 0;
                foreach (var point in contour.Points) { cx += point.X; cy += point.Y; }
                cx /= contour.Points.Count;
                cy /= contour.Points.Count;

                items.Add(new Dictionary<string, object>
                {
                    ["shape"] = Contours.ClassifyShape(contour, spec.Number("epsilonRatio", 0.02)),
                    ["area"] = (int)area,
                    ["x"] = Math.Round(cx / mask.Width, 4),
                    ["y"] = Math.Round(cy / mask.Height, 4),
                    ["circularity"] = Math.Round(contour.Circularity(), 4),
                });
            }
            return VisionValue.OfContours(items);
        }

        // ---- 統計と門 ----

        private static VisionValue ApplyStats(VisionOpSpec spec, VisionValue[] inputs, VisionContext context)
        {
            var mask = inputs[0].Mask;
            var against = spec.Text("against", null);

            GrayImage sample = null;
            if (!string.IsNullOrEmpty(against) && context.TryGet(against, out var value))
            {
                if (value.Kind == VisionValueKind.Gray) sample = value.Gray;
                else if (value.Kind == VisionValueKind.Edges) sample = Statistics.AsGray(value.Edges);
                else if (value.Kind == VisionValueKind.Color) sample = value.Color.ToGray();
            }

            var record = Statistics.Describe(mask, sample);
            foreach (var pair in context.Notes) record[pair.Key] = pair.Value;
            return VisionValue.OfRecord(record);
        }

        private static VisionValue ApplyGate(VisionOpSpec spec, Dictionary<string, object> record, VisionContext context)
        {
            var field = spec.Text("value", "coverage");
            var comparison = spec.Text("op", "gte");
            double compare = spec.Number("compare", 0);

            // 相対比較。「地面より平坦なら」のように、別の統計値を基準にできる。
            var relativeTo = spec.Text("relativeTo", null);
            if (!string.IsNullOrEmpty(relativeTo) && record.TryGetValue(relativeTo, out var baseline))
            {
                try { compare = Convert.ToDouble(baseline) * spec.Number("factor", 1.0); }
                catch { /* 数でなければ compare をそのまま使う */ }
            }

            double actual = 0;
            if (record.TryGetValue(field, out var raw))
            {
                try { actual = Convert.ToDouble(raw); } catch { actual = 0; }
            }

            bool pass;
            switch (comparison.ToLowerInvariant())
            {
                case "lt": pass = actual < compare; break;
                case "lte": pass = actual <= compare; break;
                case "gt": pass = actual > compare; break;
                case "eq": pass = Math.Abs(actual - compare) < 1e-9; break;
                default: pass = actual >= compare; break;
            }

            // or 条件。ひとつの門で「絶対値で十分平坦」または「周りより平坦」を書ける。
            if (!pass && spec.Params != null && spec.Params.ContainsKey("orRelativeTo"))
            {
                var alt = spec.Text("orRelativeTo", null);
                if (!string.IsNullOrEmpty(alt) && record.TryGetValue(alt, out var altBaseline))
                {
                    try
                    {
                        double altCompare = Convert.ToDouble(altBaseline) * spec.Number("orFactor", 1.0);
                        pass = comparison.StartsWith("l", StringComparison.OrdinalIgnoreCase)
                            ? actual <= altCompare
                            : actual >= altCompare;
                    }
                    catch { /* 無視 */ }
                }
            }

            var result = new Dictionary<string, object>(record) { ["pass"] = pass };
            if (!pass) context.Stop(spec.Text("reason", "gate:" + field));
            return VisionValue.OfRecord(result);
        }
    }

    public sealed class VisionPipelineException : Exception
    {
        public VisionPipelineException(string message) : base(message) { }
    }
}
