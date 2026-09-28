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
using Arsist.Runtime.Perception.Models;
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
        /// <summary>一時的に外す (素通し)。入力と出力の型が同じ op でだけ効く。</summary>
        public bool Disabled;

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
                // 出力の型はモデルの task で決まる (OutputKindOf)。ここに書くのは仮の値。
                ["infer"] = new VisionOpSignature(VisionValueKind.Record, VisionValueKind.Color),

                // ---- 見つけた物を扱う ----
                ["select"] = new VisionOpSignature(VisionValueKind.Blobs, VisionValueKind.Blobs),
                ["countItems"] = new VisionOpSignature(VisionValueKind.Record, VisionValueKind.Blobs),
                ["track"] = new VisionOpSignature(VisionValueKind.Blobs, VisionValueKind.Blobs),
                ["annotate"] = new VisionOpSignature(VisionValueKind.Color, VisionValueKind.Color, VisionValueKind.Blobs),
                ["boxMask"] = new VisionOpSignature(VisionValueKind.Mask, VisionValueKind.Blobs),

                // ---- 時間 ----
                ["stabilize"] = new VisionOpSignature(VisionValueKind.Record, VisionValueKind.Record),
                ["motion"] = new VisionOpSignature(VisionValueKind.Mask, VisionValueKind.Gray),
                ["event"] = new VisionOpSignature(VisionValueKind.Record, VisionValueKind.Record),

                // ---- 幾何 ----
                ["quads"] = new VisionOpSignature(VisionValueKind.Quads, VisionValueKind.Mask),
                ["rectify"] = new VisionOpSignature(VisionValueKind.Color, VisionValueKind.Color, VisionValueKind.Quads),
            };

        /// <summary>
        /// op の出力の型。ほとんどの op は Signatures のとおりだが、`infer` だけは
        /// 参照しているモデルの task で変わる: classify/raw → Record, detect → Blobs, segment → Mask。
        /// モデルが見つからなければ仮の Record を返す (見つからないこと自体は Validate が指摘する)。
        /// </summary>
        public static VisionValueKind OutputKindOf(VisionOpSpec spec, IReadOnlyDictionary<string, ModelSpec> models)
        {
            if (!Signatures.TryGetValue(spec.Op ?? "", out var signature)) return VisionValueKind.Record;
            if (!string.Equals(spec.Op, "infer", StringComparison.OrdinalIgnoreCase)) return signature.Output;

            var id = spec.Text("model", null);
            if (id == null || models == null || !models.TryGetValue(id, out var model)) return VisionValueKind.Record;
            return KindForTask(model.Task);
        }

        /// <summary>外せる op か (最初の入力と出力の型が同じ)。エディタの canBypass と同じ判定。</summary>
        public static bool CanBypass(VisionOpSpec spec, IReadOnlyDictionary<string, ModelSpec> models)
        {
            if (!Signatures.TryGetValue(spec.Op ?? "", out var signature) || signature.Inputs.Length == 0) return false;
            return signature.Inputs[0] == OutputKindOf(spec, models);
        }

        public static VisionValueKind KindForTask(ModelTask task)
        {
            switch (task)
            {
                case ModelTask.Detect: return VisionValueKind.Blobs;
                case ModelTask.Segment: return VisionValueKind.Mask;
                default: return VisionValueKind.Record;
            }
        }

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

                case "infer": return ApplyInfer(spec, inputs[0].Color, context);

                case "select": return VisionValue.OfBlobs(ApplySelect(spec, inputs[0].Items));
                case "countitems": return VisionValue.OfRecord(CountItems(inputs[0].Items));
                case "track": return VisionValue.OfBlobs(ApplyTrack(spec, inputs[0].Items, context));

                case "annotate":
                {
                    var drawn = Annotate.Boxes(inputs[0].Color, inputs[1].Items,
                        spec.Text("color", "#4A9BD1"), spec.Int("thickness", 2), out _);
                    return VisionValue.OfColor(drawn);
                }

                case "boxmask":
                {
                    // 枠 (または塗り潰し) のマスク。world 出力の alpha にすると、枠だけを現実に重ねられる。
                    var blank = new ColorImage(context.Width, context.Height);
                    bool fill = spec.Bool("fill", false);
                    Annotate.Boxes(blank, inputs[0].Items, "#FFFFFF", fill ? 100000 : spec.Int("thickness", 2), out var mask);
                    return VisionValue.OfMask(mask);
                }

                case "stabilize": return VisionValue.OfRecord(ApplyStabilize(spec, inputs[0].Record, context));
                case "motion": return VisionValue.OfMask(ApplyMotion(spec, inputs[0].Gray, context));
                case "event": return VisionValue.OfRecord(ApplyEvent(spec, inputs[0].Record, context));

                case "quads":
                    return VisionValue.OfQuads(Quads.Find(
                        inputs[0].Mask, spec.Number("epsilonRatio", 0.04), spec.Int("minArea", 400), spec.Int("maxItems", 4)));

                case "rectify": return ApplyRectify(spec, inputs[0].Color, inputs[1].Items, context);

                default:
                    throw new VisionPipelineException($"unknown op '{spec.Op}'");
            }
        }

        // ---- 見つけた物を扱う ----

        private static double ItemNumber(Dictionary<string, object> item, string key) => Tracker.Number(item, key);

        /// <summary>ラベル・スコア・大きさで絞り、並べ替え、数を絞る。</summary>
        private static List<object> ApplySelect(VisionOpSpec spec, List<object> items)
        {
            var wanted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var part in (spec.Text("label", "") ?? "").Split(','))
            {
                var trimmed = part.Trim();
                if (trimmed.Length > 0) wanted.Add(trimmed);
            }
            double minScore = spec.Number("minScore", 0);
            double minWidth = spec.Number("minWidth", 0);
            double minHeight = spec.Number("minHeight", 0);
            bool stableOnly = spec.Bool("stableOnly", false);

            var kept = new List<Dictionary<string, object>>();
            foreach (var raw in items ?? new List<object>())
            {
                if (!(raw is Dictionary<string, object> item)) continue;
                if (wanted.Count > 0 && !wanted.Contains(Tracker.Text(item, "label") ?? "")) continue;
                if (item.ContainsKey("score") && ItemNumber(item, "score") < minScore) continue;
                if (ItemNumber(item, "width") < minWidth || ItemNumber(item, "height") < minHeight) continue;
                if (stableOnly && item.TryGetValue("stable", out var stable) && stable is bool b && !b) continue;
                if (spec.Bool("presentOnly", true) && item.TryGetValue("missing", out var missing) && missing is bool m && m) continue;
                kept.Add(item);
            }

            switch (spec.Text("sortBy", "score").ToLowerInvariant())
            {
                case "size": kept.Sort((a, b) => (ItemNumber(b, "width") * ItemNumber(b, "height")).CompareTo(ItemNumber(a, "width") * ItemNumber(a, "height"))); break;
                case "x": kept.Sort((a, b) => ItemNumber(a, "x").CompareTo(ItemNumber(b, "x"))); break;
                case "y": kept.Sort((a, b) => ItemNumber(b, "y").CompareTo(ItemNumber(a, "y"))); break;
                case "none": break;
                default: kept.Sort((a, b) => ItemNumber(b, "score").CompareTo(ItemNumber(a, "score"))); break;
            }

            int maxItems = spec.Int("maxItems", 0);
            if (maxItems > 0 && kept.Count > maxItems) kept.RemoveRange(maxItems, kept.Count - maxItems);

            var result = new List<object>(kept.Count);
            foreach (var item in kept) result.Add(item);
            return result;
        }

        /// <summary>件数、ラベルごとの数、一番確かな物。UI に bind したりイベントの条件にしたりする。</summary>
        private static Dictionary<string, object> CountItems(List<object> items)
        {
            var labels = new Dictionary<string, object>();
            string bestLabel = "";
            double bestScore = double.NegativeInfinity, sum = 0;
            int count = 0;
            foreach (var raw in items ?? new List<object>())
            {
                if (!(raw is Dictionary<string, object> item)) continue;
                count++;
                var label = Tracker.Text(item, "label") ?? "";
                if (label.Length > 0) labels[label] = (labels.TryGetValue(label, out var n) ? Convert.ToInt32(n) : 0) + 1;
                double score = ItemNumber(item, "score");
                sum += score;
                if (score > bestScore) { bestScore = score; bestLabel = label; }
            }
            return new Dictionary<string, object>
            {
                ["count"] = count,
                ["labels"] = labels,
                ["best"] = bestLabel,
                ["bestScore"] = count > 0 ? Math.Round(bestScore, 4) : 0.0,
                ["meanScore"] = count > 0 ? Math.Round(sum / count, 4) : 0.0,
            };
        }

        private static List<object> ApplyTrack(VisionOpSpec spec, List<object> items, VisionContext context)
        {
            var key = "track:" + (spec.Id ?? spec.Out);
            var state = context.State.Get<TrackerState>(key);
            if (state == null) { state = new TrackerState(); context.State.Set(key, state); }
            return Tracker.Update(state, items, context.TimeSeconds,
                spec.Number("maxDistance", 0.15), spec.Int("maxAge", 5), spec.Number("smooth", 0.5),
                spec.Int("minHits", 2), spec.Bool("matchLabel", true));
        }

        // ---- 時間 ----

        private sealed class StabilizeState
        {
            public readonly Dictionary<string, double> Numbers = new Dictionary<string, double>();
            public readonly Dictionary<string, List<string>> Texts = new Dictionary<string, List<string>>();
        }

        /// <summary>数値は指数平滑、文字と真偽は直近 N 回の多数決。ちらつく値を落ち着かせる。</summary>
        private static Dictionary<string, object> ApplyStabilize(VisionOpSpec spec, Dictionary<string, object> record, VisionContext context)
        {
            var key = "stabilize:" + (spec.Id ?? spec.Out);
            var state = context.State.Get<StabilizeState>(key);
            if (state == null) { state = new StabilizeState(); context.State.Set(key, state); }

            double alpha = Math.Max(0.01, Math.Min(1, spec.Number("alpha", 0.4)));
            int window = Math.Max(1, spec.Int("window", 5));
            var output = new Dictionary<string, object>(record);

            foreach (var pair in record)
            {
                if (pair.Value is bool || pair.Value is string)
                {
                    var text = pair.Value.ToString();
                    if (!state.Texts.TryGetValue(pair.Key, out var history)) { history = new List<string>(); state.Texts[pair.Key] = history; }
                    history.Add(text);
                    if (history.Count > window) history.RemoveAt(0);
                    var counts = new Dictionary<string, int>();
                    string best = text; int bestCount = 0;
                    foreach (var h in history)
                    {
                        counts[h] = (counts.TryGetValue(h, out var c) ? c : 0) + 1;
                        if (counts[h] > bestCount) { bestCount = counts[h]; best = h; }
                    }
                    output[pair.Key] = pair.Value is bool ? (object)(best == "True") : best;
                }
                else if (pair.Value is int || pair.Value is long || pair.Value is double || pair.Value is float)
                {
                    double v = Convert.ToDouble(pair.Value);
                    if (state.Numbers.TryGetValue(pair.Key, out var previous)) v = previous + (v - previous) * alpha;
                    state.Numbers[pair.Key] = v;
                    output[pair.Key] = Math.Round(v, 4);
                }
            }
            return output;
        }

        /// <summary>前のフレームとの差。動いた所だけのマスク。最初のフレームは空。</summary>
        private static MaskImage ApplyMotion(VisionOpSpec spec, GrayImage gray, VisionContext context)
        {
            var key = "motion:" + (spec.Id ?? spec.Out);
            var previous = context.State.Get<GrayImage>(key);
            context.State.Set(key, gray);

            var mask = new MaskImage(gray.Width, gray.Height);
            if (previous == null || previous.Width != gray.Width || previous.Height != gray.Height) return mask;

            int threshold = spec.Int("threshold", 25);
            for (int i = 0; i < mask.Data.Length; i++)
            {
                if (Math.Abs(gray.Data[i] - previous.Data[i]) >= threshold) mask.Data[i] = MaskImage.On;
            }
            return mask;
        }

        private sealed class EventState
        {
            public bool WasTrue;
            public double LastFired = double.NegativeInfinity;
        }

        /// <summary>
        /// 条件を満たしたらイベントを発火する。gate と違い、パイプラインは止めない。
        /// mode = onChange なら「満たさない → 満たす」に変わった瞬間だけ、always なら満たしている間ずっと。
        /// </summary>
        private static Dictionary<string, object> ApplyEvent(VisionOpSpec spec, Dictionary<string, object> record, VisionContext context)
        {
            var key = "event:" + (spec.Id ?? spec.Out);
            var state = context.State.Get<EventState>(key);
            if (state == null) { state = new EventState(); context.State.Set(key, state); }

            bool condition = Compare(record, spec.Text("value", "count"), spec.Text("op", "gte"), spec.Number("compare", 1));
            bool fire = condition;
            if (string.Equals(spec.Text("mode", "onChange"), "onChange", StringComparison.OrdinalIgnoreCase) && state.WasTrue) fire = false;
            double cooldown = spec.Number("cooldown", 0);
            if (fire && context.TimeSeconds - state.LastFired < cooldown) fire = false;

            if (fire)
            {
                context.Emit(spec.Text("name", "vision.event"));
                state.LastFired = context.TimeSeconds;
            }
            state.WasTrue = condition;

            return new Dictionary<string, object>(record)
            {
                ["condition"] = condition,
                ["fired"] = fire,
            };
        }

        private static bool Compare(Dictionary<string, object> record, string field, string comparison, double compare)
        {
            double actual = 0;
            if (record.TryGetValue(field, out var raw) && raw != null)
            {
                if (raw is bool b) actual = b ? 1 : 0;
                else { try { actual = Convert.ToDouble(raw); } catch { actual = 0; } }
            }
            switch ((comparison ?? "gte").ToLowerInvariant())
            {
                case "lt": return actual < compare;
                case "lte": return actual <= compare;
                case "gt": return actual > compare;
                case "eq": return Math.Abs(actual - compare) < 1e-9;
                case "neq": return Math.Abs(actual - compare) >= 1e-9;
                default: return actual >= compare;
            }
        }

        // ---- 幾何 ----

        /// <summary>四角形の中を正対した長方形の画に起こす。看板や画面を読む前段。</summary>
        private static VisionValue ApplyRectify(VisionOpSpec spec, ColorImage image, List<object> quads, VisionContext context)
        {
            int index = spec.Int("index", 0);
            if (quads == null || quads.Count <= index || !(quads[index] is Dictionary<string, object> quad)
                || !quad.TryGetValue("px", out var pxRaw) || !(pxRaw is List<object> px) || px.Count < 8)
            {
                context.Stop(spec.Text("reason", "noQuad"));
                return VisionValue.OfColor(image);
            }

            var corners = new double[8];
            for (int i = 0; i < 8; i++) corners[i] = Convert.ToDouble(px[i]);

            int width = Math.Max(16, spec.Int("width", 320));
            int height = spec.Int("height", 0);
            if (height <= 0) height = Math.Max(16, (int)Math.Round(width * Quads.AspectOf(corners)));

            var channels = new GrayImage[3];
            for (int c = 0; c < 3; c++)
            {
                var status = RegionRectifier.TryRectify(image.Channel(c), corners, width, height, out channels[c]);
                if (status != RectifyStatus.Ok)
                {
                    context.Stop(status == RectifyStatus.OutOfView ? "outOfView"
                        : status == RectifyStatus.TooOblique ? "tooOblique" : "degenerate");
                    return VisionValue.OfColor(image);
                }
            }
            return VisionValue.OfColor(ColorImage.Combine(channels[0], channels[1], channels[2]));
        }

        // ---- 学習済みモデル ----

        /// <summary>
        /// ONNX モデルを流す。前処理と後処理はここ (UnityEngine 非依存) で行い、
        /// 推論だけを IVisionModelRunner (実機: Inference Engine、エディタ: ONNX Runtime) に頼む。
        /// </summary>
        private static VisionValue ApplyInfer(VisionOpSpec spec, ColorImage image, VisionContext context)
        {
            var id = spec.Text("model", null);
            if (id == null) throw new VisionPipelineException("modelNotSet");
            if (context.Models == null || !context.Models.TryGetValue(id, out var model))
                throw new VisionPipelineException($"modelMissing:{id}");
            if (context.ModelRunner == null)
                throw new VisionPipelineException("modelRunnerUnavailable");

            var started = DateTime.UtcNow;
            var prepared = ModelPreprocess.Prepare(image, model);
            if (!context.ModelRunner.TryRun(model, prepared.Tensor, out var outputs, out var runError))
                throw new VisionPipelineException($"inferFailed:{runError}");

            var value = ModelPostprocess.Interpret(model, prepared, outputs, out var readError);
            if (value == null) throw new VisionPipelineException($"inferOutput:{readError}");

            context.Note(spec.Out + ".inferMs", (int)(DateTime.UtcNow - started).TotalMilliseconds);
            return value;
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
