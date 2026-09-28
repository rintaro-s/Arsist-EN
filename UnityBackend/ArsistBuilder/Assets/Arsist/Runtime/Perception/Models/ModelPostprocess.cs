// ==============================================
// Arsist Engine - Perception / Models
// 出力テンソルを、パイプラインの値 (数値 / 塊 / マスク) に読み替える
//
// モデルの task ごとに:
//   classify → Record  { label, index, score, top: [{label, index, score}] }
//   detect   → Blobs   [{ label, index, score, x, y, width, height }]  (正規化、原点左下)
//   segment  → Mask    (元の画と同じ大きさ、下から上)
//   raw      → Record  { shape, length, values: [...] }
//
// 座標の規約は blobs op と同じ: 0..1 に正規化し、y は下から上に測る。
// テンソルは上から下なので、ここで反転する。
//
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Perception.Pipeline;
using Arsist.Runtime.Perception.Vision.Classic;

namespace Arsist.Runtime.Perception.Models
{
    public static class ModelPostprocess
    {
        public static VisionValue Interpret(
            ModelSpec spec, PreparedInput prepared, Dictionary<string, TensorData> outputs, out string error)
        {
            error = null;
            if (outputs == null || outputs.Count == 0) { error = "noOutputs"; return null; }

            switch (spec.Task)
            {
                case ModelTask.Classify: return Classify(spec, MainOutput(spec, outputs), out error);
                case ModelTask.Detect: return Detect(spec, prepared, outputs, out error);
                case ModelTask.Segment: return Segment(spec, prepared, MainOutput(spec, outputs), out error);
                default: return Raw(spec, MainOutput(spec, outputs));
            }
        }

        /// <summary>主出力。名前が指定されていればそれ、無ければ最初の出力。</summary>
        private static TensorData MainOutput(ModelSpec spec, Dictionary<string, TensorData> outputs)
        {
            var name = spec.Output.Name;
            if (!string.IsNullOrEmpty(name) && outputs.TryGetValue(name, out var named)) return named;
            foreach (var pair in outputs) return pair.Value;
            return null;
        }

        private static TensorData Named(Dictionary<string, TensorData> outputs, string name, int fallbackIndex)
        {
            if (!string.IsNullOrEmpty(name) && outputs.TryGetValue(name, out var named)) return named;
            int i = 0;
            foreach (var pair in outputs)
            {
                if (i++ == fallbackIndex) return pair.Value;
            }
            return null;
        }

        // ---- 分類 ------------------------------------------------------------

        private static VisionValue Classify(ModelSpec spec, TensorData output, out string error)
        {
            error = null;
            if (output == null) { error = "noOutputs"; return null; }

            var scores = (float[])output.Data.Clone();
            if (spec.Output.Softmax) Softmax(scores);

            var order = new int[scores.Length];
            for (int i = 0; i < order.Length; i++) order[i] = i;
            Array.Sort(order, (a, b) => scores[b].CompareTo(scores[a]));

            int best = order.Length > 0 ? order[0] : -1;
            int topK = Math.Max(1, Math.Min(spec.Output.TopK, order.Length));
            var top = new List<object>();
            for (int i = 0; i < topK; i++)
            {
                top.Add(new Dictionary<string, object>
                {
                    ["label"] = spec.LabelOf(order[i]),
                    ["index"] = order[i],
                    ["score"] = Math.Round(scores[order[i]], 4),
                });
            }

            return VisionValue.OfRecord(new Dictionary<string, object>
            {
                ["label"] = best >= 0 ? spec.LabelOf(best) : "",
                ["index"] = best,
                ["score"] = best >= 0 ? Math.Round(scores[best], 4) : 0.0,
                ["top"] = top,
            });
        }

        public static void Softmax(float[] values)
        {
            if (values.Length == 0) return;
            float max = float.NegativeInfinity;
            foreach (var v in values) if (v > max) max = v;
            double sum = 0;
            for (int i = 0; i < values.Length; i++)
            {
                values[i] = (float)Math.Exp(values[i] - max);
                sum += values[i];
            }
            if (sum <= 0) return;
            for (int i = 0; i < values.Length; i++) values[i] = (float)(values[i] / sum);
        }

        // ---- 検出 ------------------------------------------------------------

        private struct Candidate
        {
            public double X1, Y1, X2, Y2; // 入力の画素座標 (上から下)
            public double Score;
            public int Class;
        }

        private static VisionValue Detect(
            ModelSpec spec, PreparedInput prepared, Dictionary<string, TensorData> outputs, out string error)
        {
            error = null;
            var o = spec.Output;
            var candidates = new List<Candidate>();

            switch ((o.BoxLayout ?? "yolo").ToLowerInvariant())
            {
                case "separate":
                {
                    var boxes = Named(outputs, o.BoxesName, 0);
                    var scores = Named(outputs, o.ScoresName, 1);
                    var classes = Named(outputs, o.ClassesName, 2);
                    if (boxes == null || scores == null) { error = "detectOutputsMissing"; return null; }
                    int n = scores.Length;
                    if (boxes.Length < n * 4) { error = "detectShape:" + boxes.ShapeText(); return null; }
                    for (int i = 0; i < n; i++)
                    {
                        double score = scores.Data[i];
                        if (score < o.ScoreThreshold) continue;
                        var c = Box(o, prepared, boxes.Data[i * 4], boxes.Data[i * 4 + 1], boxes.Data[i * 4 + 2], boxes.Data[i * 4 + 3]);
                        c.Score = score;
                        c.Class = classes != null && i < classes.Length ? (int)Math.Round(classes.Data[i]) : 0;
                        candidates.Add(c);
                    }
                    break;
                }

                case "xyxyscoreclass":
                {
                    var t = MainOutput(spec, outputs);
                    if (t == null) { error = "noOutputs"; return null; }
                    // [N, 6] か [1, N, 6]
                    int stride = t.Dim(t.Rank - 1);
                    if (stride < 6) { error = "detectShape:" + t.ShapeText(); return null; }
                    int n = t.Length / stride;
                    for (int i = 0; i < n; i++)
                    {
                        int at = i * stride;
                        double score = t.Data[at + 4];
                        if (score < o.ScoreThreshold) continue;
                        var c = Box(o, prepared, t.Data[at], t.Data[at + 1], t.Data[at + 2], t.Data[at + 3]);
                        c.Score = score;
                        c.Class = (int)Math.Round(t.Data[at + 5]);
                        candidates.Add(c);
                    }
                    break;
                }

                case "yolo5":
                case "yolo":
                default:
                {
                    var t = MainOutput(spec, outputs);
                    if (t == null) { error = "noOutputs"; return null; }
                    bool yolo5 = string.Equals(o.BoxLayout, "yolo5", StringComparison.OrdinalIgnoreCase);
                    if (t.Rank < 2) { error = "detectShape:" + t.ShapeText(); return null; }

                    // [1, F, N] (Ultralytics v8/11) か [1, N, F] (v5)。ラベルの数が分かっていれば
                    // F = 4(+1) + クラス数 で見分けられる。分からなければ、候補数の方が多いとみなす。
                    int a = t.Dim(t.Rank - 2), b = t.Dim(t.Rank - 1);
                    int classOffset = yolo5 ? 5 : 4;
                    int labelled = spec.Labels != null ? spec.Labels.Length : 0;
                    bool featuresFirst;
                    if (labelled > 0 && a == classOffset + labelled) featuresFirst = true;
                    else if (labelled > 0 && b == classOffset + labelled) featuresFirst = false;
                    else featuresFirst = a < b;
                    int features = featuresFirst ? a : b;
                    int n = featuresFirst ? b : a;
                    int classCount = features - classOffset;
                    if (classCount < 1) { error = "detectShape:" + t.ShapeText(); return null; }

                    Func<int, int, float> at = featuresFirst
                        ? (Func<int, int, float>)((i, f) => t.Data[f * n + i])
                        : (i, f) => t.Data[i * features + f];

                    for (int i = 0; i < n; i++)
                    {
                        double objectness = yolo5 ? at(i, 4) : 1.0;
                        if (yolo5 && objectness < o.ScoreThreshold) continue;

                        int bestClass = 0;
                        float bestScore = float.NegativeInfinity;
                        for (int c = 0; c < classCount; c++)
                        {
                            float s = at(i, classOffset + c);
                            if (s > bestScore) { bestScore = s; bestClass = c; }
                        }
                        double score = bestScore * objectness;
                        if (score < o.ScoreThreshold) continue;

                        var cand = Box(o, prepared, at(i, 0), at(i, 1), at(i, 2), at(i, 3));
                        cand.Score = score;
                        cand.Class = bestClass;
                        candidates.Add(cand);
                    }
                    break;
                }
            }

            var kept = NonMaxSuppression(candidates, o.IouThreshold, Math.Max(1, o.MaxItems));

            var items = new List<object>();
            foreach (var c in kept)
            {
                // 入力の画素 → 元の画の画素 (上から下) → 正規化して y を下からに直す
                prepared.ToImage(c.X1, c.Y1, out double ix1, out double iy1);
                prepared.ToImage(c.X2, c.Y2, out double ix2, out double iy2);
                double w = Math.Max(1, prepared.ImageWidth), h = Math.Max(1, prepared.ImageHeight);
                double left = Clamp01(ix1 / w), right = Clamp01(ix2 / w);
                double top = Clamp01(iy1 / h), bottom = Clamp01(iy2 / h);

                items.Add(new Dictionary<string, object>
                {
                    ["label"] = spec.LabelOf(c.Class),
                    ["index"] = c.Class,
                    ["score"] = Math.Round(c.Score, 4),
                    ["x"] = Math.Round((left + right) * 0.5, 4),
                    ["y"] = Math.Round(1.0 - (top + bottom) * 0.5, 4),
                    ["width"] = Math.Round(right - left, 4),
                    ["height"] = Math.Round(bottom - top, 4),
                });
            }
            return VisionValue.OfBlobs(items);
        }

        private static double Clamp01(double v) => v < 0 ? 0 : (v > 1 ? 1 : v);

        /// <summary>モデルの箱の表現を、入力の画素座標の (x1,y1,x2,y2) に揃える。</summary>
        private static Candidate Box(ModelOutputSpec o, PreparedInput prepared, double a, double b, double c, double d)
        {
            double sx = o.BoxesNormalized ? prepared.InputWidth : 1;
            double sy = o.BoxesNormalized ? prepared.InputHeight : 1;
            a *= sx; c *= sx; b *= sy; d *= sy;

            switch ((o.BoxFormat ?? "cxcywh").ToLowerInvariant())
            {
                case "xyxy": return new Candidate { X1 = a, Y1 = b, X2 = c, Y2 = d };
                case "xywh": return new Candidate { X1 = a, Y1 = b, X2 = a + c, Y2 = b + d };
                default: return new Candidate { X1 = a - c / 2, Y1 = b - d / 2, X2 = a + c / 2, Y2 = b + d / 2 };
            }
        }

        private static List<Candidate> NonMaxSuppression(List<Candidate> candidates, double iouThreshold, int maxItems)
        {
            candidates.Sort((p, q) => q.Score.CompareTo(p.Score));
            var kept = new List<Candidate>();
            foreach (var c in candidates)
            {
                bool overlaps = false;
                foreach (var k in kept)
                {
                    if (k.Class != c.Class) continue;
                    if (Iou(k, c) > iouThreshold) { overlaps = true; break; }
                }
                if (overlaps) continue;
                kept.Add(c);
                if (kept.Count >= maxItems) break;
            }
            return kept;
        }

        private static double Iou(Candidate a, Candidate b)
        {
            double ix = Math.Max(0, Math.Min(a.X2, b.X2) - Math.Max(a.X1, b.X1));
            double iy = Math.Max(0, Math.Min(a.Y2, b.Y2) - Math.Max(a.Y1, b.Y1));
            double inter = ix * iy;
            double union = (a.X2 - a.X1) * (a.Y2 - a.Y1) + (b.X2 - b.X1) * (b.Y2 - b.Y1) - inter;
            return union <= 0 ? 0 : inter / union;
        }

        // ---- 領域分割 ----------------------------------------------------------

        private static VisionValue Segment(ModelSpec spec, PreparedInput prepared, TensorData output, out string error)
        {
            error = null;
            if (output == null) { error = "noOutputs"; return null; }

            // 出力の形を (classes, H, W) に読む。[1,C,H,W] / [1,H,W,C] / [1,1,H,W] / [1,H,W] / [H,W]
            int classes, mh, mw;
            bool channelsLast = false;
            if (output.Rank == 4)
            {
                if (spec.Input.ChannelsFirst) { classes = output.Dim(1); mh = output.Dim(2); mw = output.Dim(3); }
                else { mh = output.Dim(1); mw = output.Dim(2); classes = output.Dim(3); channelsLast = true; }
            }
            else if (output.Rank == 3)
            {
                // [1, H, W] (batch) か [C, H, W]。先頭が 1 ならバッチとみなす。
                classes = output.Dim(0); mh = output.Dim(1); mw = output.Dim(2);
            }
            else if (output.Rank == 2) { classes = 1; mh = output.Dim(0); mw = output.Dim(1); }
            else { error = "segmentShape:" + output.ShapeText(); return null; }

            bool argmax = string.Equals(spec.Output.MaskMode, "argmax", StringComparison.OrdinalIgnoreCase) && classes > 1;
            var wanted = new HashSet<int>(spec.Output.ClassIndices ?? new[] { 1 });

            // まずモデルの出力の大きさで判定 (上から下)
            var modelMask = new bool[mh * mw];
            for (int y = 0; y < mh; y++)
            {
                for (int x = 0; x < mw; x++)
                {
                    bool on;
                    if (argmax)
                    {
                        int best = 0;
                        float bestValue = float.NegativeInfinity;
                        for (int c = 0; c < classes; c++)
                        {
                            float v = channelsLast ? output.Data[(y * mw + x) * classes + c] : output.Data[c * mh * mw + y * mw + x];
                            if (v > bestValue) { bestValue = v; best = c; }
                        }
                        on = wanted.Contains(best);
                    }
                    else
                    {
                        int c = classes > 1 ? (spec.Output.ClassIndices != null && spec.Output.ClassIndices.Length > 0
                            ? Math.Min(classes - 1, Math.Max(0, spec.Output.ClassIndices[0])) : 0) : 0;
                        float v = channelsLast ? output.Data[(y * mw + x) * classes + c] : output.Data[c * mh * mw + y * mw + x];
                        double p = spec.Output.ApplySigmoid ? 1.0 / (1.0 + Math.Exp(-v)) : v;
                        on = p >= spec.Output.MaskThreshold;
                    }
                    modelMask[y * mw + x] = on;
                }
            }

            // 元の画の大きさに戻す (下から上)。letterbox の余白は捨てる。
            int iw = prepared.ImageWidth, ih = prepared.ImageHeight;
            var mask = new MaskImage(iw, ih);
            double toModelX = (double)mw / prepared.InputWidth;
            double toModelY = (double)mh / prepared.InputHeight;
            for (int y = 0; y < ih; y++)
            {
                int topDownY = ih - 1 - y;
                double inputY = (topDownY + 0.5) * prepared.ScaleY + prepared.PadY;
                int my = (int)(inputY * toModelY);
                if (my < 0 || my >= mh) continue;
                for (int x = 0; x < iw; x++)
                {
                    double inputX = (x + 0.5) * prepared.ScaleX + prepared.PadX;
                    int mx = (int)(inputX * toModelX);
                    if (mx < 0 || mx >= mw) continue;
                    if (modelMask[my * mw + mx]) mask.Data[y * iw + x] = MaskImage.On;
                }
            }
            return VisionValue.OfMask(mask);
        }

        // ---- 生の値 ------------------------------------------------------------

        private static VisionValue Raw(ModelSpec spec, TensorData output)
        {
            if (output == null) return VisionValue.OfRecord(new Dictionary<string, object> { ["error"] = "noOutputs" });
            int limit = Math.Max(1, Math.Min(spec.Output.RawLimit, output.Length));
            var values = new List<object>(limit);
            for (int i = 0; i < limit; i++) values.Add(Math.Round((double)output.Data[i], 5));
            var shape = new List<object>();
            foreach (var d in output.Shape) shape.Add(d);
            return VisionValue.OfRecord(new Dictionary<string, object>
            {
                ["shape"] = shape,
                ["length"] = output.Length,
                ["values"] = values,
            });
        }
    }
}
