// 学習済みモデルの前処理・後処理の検証。
//
// 推論エンジンそのものは Unity (Inference Engine) と ONNX Runtime に任せているので、
// ここで確かめるのは「画をテンソルにする」「テンソルを塊・マスク・数値に戻す」の部分。
// 偽の推論器 (FakeRunner) が、入力テンソルからそれらしい出力を合成する。
//
// 一番落ちやすいのは行順: ColorImage は下から上、テンソルは上から下。
// 反転を忘れると分類は気付かず、検出は箱が上下逆に出る。
using System;
using System.Collections.Generic;
using Arsist.Runtime.Perception.Models;
using Arsist.Runtime.Perception.Pipeline;
using Arsist.Runtime.Perception.Vision.Classic;

internal static class ModelChecks
{
    private static int _failures;

    private static void Expect(string label, bool ok, string detail = null)
    {
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}{(detail != null ? $": {detail}" : "")}");
        if (!ok) _failures++;
    }

    private static void Near(string label, double value, double expected, double tolerance)
    {
        bool ok = Math.Abs(value - expected) <= tolerance && !double.IsNaN(value);
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}: {value:F4} (expected {expected:F4} +-{tolerance})");
        if (!ok) _failures++;
    }

    /// <summary>出力を合成する偽の推論器。</summary>
    private sealed class FakeRunner : IVisionModelRunner
    {
        public Func<ModelSpec, TensorData, Dictionary<string, TensorData>> Produce;
        public TensorData LastInput;

        public bool TryRun(ModelSpec spec, TensorData input, out Dictionary<string, TensorData> outputs, out string error)
        {
            LastInput = input;
            outputs = Produce(spec, input);
            error = null;
            return true;
        }
    }

    private static ModelSpec Spec(ModelTask task, int w, int h, Action<ModelSpec> tweak = null)
    {
        var spec = new ModelSpec
        {
            Id = "m", Name = "test", File = "test.onnx", Task = task,
            Input = { Width = w, Height = h, Layout = "NCHW", Channels = 3, Scale = 1.0 / 255, Mean = new[] { 0.0, 0, 0 }, Std = new[] { 1.0, 1, 1 } },
            Labels = new[] { "red", "green", "blue" },
        };
        tweak?.Invoke(spec);
        return spec;
    }

    /// <summary>上半分が赤、下半分が青の画 (ColorImage は下から上なので、行 0 が青)。</summary>
    private static ColorImage RedOverBlue(int w, int h)
    {
        var img = new ColorImage(w, h);
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                if (y >= h / 2) img.Set(x, y, 255, 0, 0); else img.Set(x, y, 0, 0, 255);
        return img;
    }

    // ---- 前処理 ---------------------------------------------------------------

    private static void TestPreprocessLayoutAndRowOrder()
    {
        var img = RedOverBlue(8, 4);
        var spec = Spec(ModelTask.Raw, 8, 4);
        var prepared = ModelPreprocess.Prepare(img, spec);
        var t = prepared.Tensor;

        Expect("NCHW shape is [1,3,H,W]", t.ShapeText() == "[1,3,4,8]", t.ShapeText());
        // テンソルの行 0 は画の一番上 = 赤。R プレーンの先頭が 1、B プレーンの先頭が 0。
        Near("tensor row 0 is the top of the image (red)", t.Data[0], 1.0, 1e-6);
        Near("blue plane at row 0 is empty", t.Data[2 * 32], 0.0, 1e-6);
        // 最後の行は画の一番下 = 青
        Near("tensor last row is the bottom of the image (blue)", t.Data[2 * 32 + 3 * 8], 1.0, 1e-6);
        Near("red plane at the last row is empty", t.Data[3 * 8], 0.0, 1e-6);

        var nhwc = Spec(ModelTask.Raw, 8, 4, s => { s.Input.Layout = "NHWC"; s.Input.ColorOrder = "BGR"; });
        var t2 = ModelPreprocess.Prepare(img, nhwc).Tensor;
        Expect("NHWC shape is [1,H,W,3]", t2.ShapeText() == "[1,4,8,3]", t2.ShapeText());
        // 先頭画素 (左上, 赤) を BGR で並べると [0, 0, 1]
        Near("BGR order puts red last", t2.Data[2], 1.0, 1e-6);
        Near("BGR order puts blue first (and it is 0 at the top)", t2.Data[0], 0.0, 1e-6);

        var normalised = Spec(ModelTask.Raw, 8, 4, s =>
        {
            s.Input.Mean = new[] { 0.5, 0.5, 0.5 };
            s.Input.Std = new[] { 0.25, 0.25, 0.25 };
        });
        var t3 = ModelPreprocess.Prepare(img, normalised).Tensor;
        // 赤 = 1.0 → (1 - 0.5) / 0.25 = 2, 0 → -2
        Near("mean/std normalisation applies per channel", t3.Data[0], 2.0, 1e-6);
        Near("mean/std normalisation of a zero channel", t3.Data[32], -2.0, 1e-6);

        var gray = Spec(ModelTask.Raw, 8, 4, s => s.Input.Channels = 1);
        var t4 = ModelPreprocess.Prepare(img, gray).Tensor;
        Expect("single channel input is [1,1,H,W]", t4.ShapeText() == "[1,1,4,8]", t4.ShapeText());
        Near("luminance of pure red is 0.299", t4.Data[0], 0.299, 0.01);
    }

    private static void TestPreprocessLetterbox()
    {
        // 横長 (16x8) を正方形 (8x8) に letterbox: 内容は 8x4、上下に 2 行ずつ余白
        var img = RedOverBlue(16, 8);
        var spec = Spec(ModelTask.Raw, 8, 8, s => { s.Input.Resize = "letterbox"; s.Input.PadValue = 114; });
        var prepared = ModelPreprocess.Prepare(img, spec);
        var t = prepared.Tensor;

        Near("letterbox scale keeps the aspect ratio", prepared.ScaleX, 0.5, 1e-9);
        Expect("letterbox pads top and bottom equally", prepared.PadX == 0 && prepared.PadY == 2,
               $"padX={prepared.PadX} padY={prepared.PadY}");

        double pad = 114 / 255.0;
        Near("row 0 is padding", t.Data[0], pad, 1e-6);
        Near("row 2 is the top of the content (red)", t.Data[2 * 8], 1.0, 1e-6);
        Near("row 5 is the bottom of the content (blue)", t.Data[2 * 64 + 5 * 8], 1.0, 1e-6);
        Near("row 7 is padding again", t.Data[7 * 8], pad, 1e-6);

        prepared.ToImage(4, 2, out double ix, out double iy);
        Near("input → image maps x through the scale", ix, 8, 1e-9);
        Near("input → image removes the padding", iy, 0, 1e-9);
    }

    // ---- 分類 -----------------------------------------------------------------

    private static void TestClassifyThroughPipeline()
    {
        // 偽の「channel-mean」モデル: 各チャンネルの平均を出す。tools/model-samples の ONNX と同じ振る舞い。
        var runner = new FakeRunner
        {
            Produce = (spec, input) =>
            {
                int plane = input.Dim(2) * input.Dim(3);
                var means = new float[3];
                for (int c = 0; c < 3; c++)
                {
                    double sum = 0;
                    for (int i = 0; i < plane; i++) sum += input.Data[c * plane + i];
                    means[c] = (float)(sum / plane);
                }
                return new Dictionary<string, TensorData> { ["channelMean"] = new TensorData(new[] { 1, 3 }, means) };
            },
        };

        var models = new Dictionary<string, ModelSpec>
        {
            ["m"] = Spec(ModelTask.Classify, 16, 16, s => { s.Output.Softmax = true; s.Output.TopK = 2; }),
        };

        var pipeline = new VisionPipelineSpec
        {
            Id = "p", MaxWidth = 64,
            Ops = { new VisionOpSpec { Id = "ai", Op = "infer", Out = "guess", In = new[] { "source" }, Params = { ["model"] = "m" } } },
            Outputs = { new VisionOutputSpec { Kind = "store", Value = "guess", StoreAs = "guess" } },
        };

        Expect("a classify model produces a record", VisionOps.OutputKindOf(pipeline.Ops[0], models) == VisionValueKind.Record);
        Expect("the pipeline validates with the model", VisionPipelineRunner.Validate(pipeline, models).Count == 0,
               string.Join("; ", VisionPipelineRunner.Validate(pipeline, models)));

        var mostlyGreen = new ColorImage(32, 24);
        for (int y = 0; y < 24; y++) for (int x = 0; x < 32; x++) mostlyGreen.Set(x, y, 20, 200, 30);

        var result = VisionPipelineRunner.Run(pipeline, mostlyGreen, null, models, runner);
        Expect("classification runs", result.Ok, result.Error);
        var record = result.Values.TryGetValue("guess", out var raw) ? raw as Dictionary<string, object> : null;
        Expect("the dominant channel is labelled", record != null && Equals(record["label"], "green"),
               record != null ? record["label"]?.ToString() : "(none)");
        Expect("the input was resized to the model's size", runner.LastInput.ShapeText() == "[1,3,16,16]", runner.LastInput.ShapeText());
        var top = record?["top"] as List<object>;
        Expect("topK trims the list", top != null && top.Count == 2, top?.Count.ToString());
        double score = record != null ? Convert.ToDouble(record["score"]) : 0;
        Expect("softmax turns means into a probability", score > 0.34 && score < 1.0, score.ToString("F3"));

        // モデルが無い / 推論器が無い場合は、黙って空を返さず失敗する
        var missing = new VisionPipelineSpec
        {
            Id = "p", Ops = { new VisionOpSpec { Id = "ai", Op = "infer", Out = "g", In = new[] { "source" }, Params = { ["model"] = "nope" } } },
            Outputs = { new VisionOutputSpec { Kind = "store", Value = "g", StoreAs = "g" } },
        };
        var missingProblems = VisionPipelineRunner.Validate(missing, models);
        Expect("a missing model is a validation problem, reported once", missingProblems.Count == 1 && missingProblems[0].Contains("nope"),
               string.Join("; ", missingProblems));
        var noRunner = VisionPipelineRunner.Run(pipeline, mostlyGreen, null, models, null);
        Expect("no inference engine is reported, not ignored", !noRunner.Ok && noRunner.Error.Contains("modelRunnerUnavailable"), noRunner.Error);
    }

    // ---- 検出 -----------------------------------------------------------------

    private static void TestDetectYoloWithLetterbox()
    {
        // 入力 64x64 (letterbox)。元の画は 128x64 → 内容 64x32、上下 16 の余白。
        // 候補 3 つ: A (クラス 0, 高スコア), B (A とほぼ同じ箱, 低め → NMS で消える), C (クラス 1, 別の場所)。
        // 加えて D (スコアが閾値未満)。
        var runner = new FakeRunner
        {
            Produce = (spec, input) =>
            {
                const int n = 4, features = 4 + 2; // 2 クラス
                var data = new float[features * n];
                void Put(int i, float cx, float cy, float w, float h, float c0, float c1)
                {
                    data[0 * n + i] = cx; data[1 * n + i] = cy; data[2 * n + i] = w; data[3 * n + i] = h;
                    data[4 * n + i] = c0; data[5 * n + i] = c1;
                }
                Put(0, 16, 24, 16, 8, 0.9f, 0.1f);   // A: 内容の左上寄り (入力座標)
                Put(1, 17, 24, 16, 8, 0.8f, 0.1f);   // B: A と重なる
                Put(2, 48, 40, 8, 8, 0.1f, 0.7f);    // C: 右下寄り、クラス 1
                Put(3, 32, 32, 8, 8, 0.2f, 0.2f);    // D: 弱い
                return new Dictionary<string, TensorData> { ["output0"] = new TensorData(new[] { 1, features, n }, data) };
            },
        };

        var spec = Spec(ModelTask.Detect, 64, 64, s =>
        {
            s.Input.Resize = "letterbox";
            s.Output.BoxLayout = "yolo";
            s.Output.BoxFormat = "cxcywh";
            s.Output.ScoreThreshold = 0.5;
            s.Output.IouThreshold = 0.5;
            s.Labels = new[] { "cat", "dog" };
        });
        var models = new Dictionary<string, ModelSpec> { ["m"] = spec };
        var pipeline = new VisionPipelineSpec
        {
            Id = "p", MaxWidth = 0,
            Ops = { new VisionOpSpec { Id = "ai", Op = "infer", Out = "found", In = new[] { "source" }, Params = { ["model"] = "m" } } },
            Outputs = { new VisionOutputSpec { Kind = "store", Value = "found", StoreAs = "found" } },
        };
        Expect("a detect model produces blobs", VisionOps.OutputKindOf(pipeline.Ops[0], models) == VisionValueKind.Blobs);

        var image = new ColorImage(128, 64);
        var result = VisionPipelineRunner.Run(pipeline, image, null, models, runner);
        Expect("detection runs", result.Ok, result.Error);

        var items = result.Values.TryGetValue("found", out var foundRaw) ? foundRaw as List<object> : null;
        Expect("NMS keeps A and C, drops B (overlap) and D (weak)", items != null && items.Count == 2, items?.Count.ToString());
        if (items == null || items.Count != 2) return;

        var a = (Dictionary<string, object>)items[0];
        var c = (Dictionary<string, object>)items[1];
        Expect("highest score first, with its label", Equals(a["label"], "cat") && Equals(c["label"], "dog"));

        // A: 入力 (16,24) 中心, 16x8 → 余白 16 を引いて (16, 8), 内容 64x32 → 画 128x64 では (32, 16), 32x16
        //    正規化: x = 32/128 = 0.25, 幅 = 32/128 = 0.25, 高さ = 16/64 = 0.25
        //    y は下から: 上から 16/64 = 0.25 → 0.75
        Near("box x maps through the letterbox", Convert.ToDouble(a["x"]), 0.25, 1e-3);
        Near("box y is measured from the bottom, like blobs", Convert.ToDouble(a["y"]), 0.75, 1e-3);
        Near("box width maps through the scale", Convert.ToDouble(a["width"]), 0.25, 1e-3);
        Near("box height maps through the scale", Convert.ToDouble(a["height"]), 0.25, 1e-3);
        // C: 入力 (48,40) → (48, 24) → 画 (96, 48) → x=0.75, y(top-down)=0.75 → 0.25
        Near("second box x", Convert.ToDouble(c["x"]), 0.75, 1e-3);
        Near("second box y", Convert.ToDouble(c["y"]), 0.25, 1e-3);
    }

    private static void TestDetectOtherLayouts()
    {
        // NMS 済みの [1, N, 6] (x1,y1,x2,y2,score,class)、正規化された箱
        var runner = new FakeRunner
        {
            Produce = (spec, input) => new Dictionary<string, TensorData>
            {
                ["det"] = new TensorData(new[] { 1, 2, 6 }, new float[]
                {
                    0.0f, 0.0f, 0.5f, 0.5f, 0.9f, 1,   // 左上 4 分の 1 (上から下の座標)
                    0.5f, 0.5f, 1.0f, 1.0f, 0.2f, 0,   // 弱い
                }),
            },
        };
        var spec = Spec(ModelTask.Detect, 32, 32, s =>
        {
            s.Output.BoxLayout = "xyxyScoreClass";
            s.Output.BoxFormat = "xyxy";
            s.Output.BoxesNormalized = true;
            s.Output.ScoreThreshold = 0.5;
            s.Labels = new[] { "a", "b" };
        });
        var prepared = ModelPreprocess.Prepare(new ColorImage(32, 32), spec);
        runner.TryRun(spec, prepared.Tensor, out var outputs, out _);
        var value = ModelPostprocess.Interpret(spec, prepared, outputs, out var error);
        Expect("xyxy layout is read", value != null && value.Items.Count == 1, error ?? value?.Items.Count.ToString());
        if (value == null || value.Items.Count != 1) return;
        var box = (Dictionary<string, object>)value.Items[0];
        Near("normalised xyxy centre x", Convert.ToDouble(box["x"]), 0.25, 1e-3);
        Near("normalised xyxy centre y (top quarter → 0.75 from the bottom)", Convert.ToDouble(box["y"]), 0.75, 1e-3);
        Expect("class index becomes a label", Equals(box["label"], "b"));

        // YOLOv5 の [1, N, 5+C]: objectness 込み
        var v5 = new FakeRunner
        {
            Produce = (s, input) => new Dictionary<string, TensorData>
            {
                ["out"] = new TensorData(new[] { 1, 2, 7 }, new float[]
                {
                    16, 16, 8, 8, 0.9f, 0.1f, 0.9f,  // objectness 0.9 × class1 0.9
                    16, 16, 8, 8, 0.3f, 0.9f, 0.1f,  // objectness 0.3 → 落ちる
                }),
            },
        };
        // ラベルが 2 つなので F = 5 + 2 = 7 と分かり、[1, N, F] のどちらが候補数かを迷わない
        var spec5 = Spec(ModelTask.Detect, 32, 32, s => { s.Output.BoxLayout = "yolo5"; s.Output.ScoreThreshold = 0.5; s.Labels = new[] { "a", "b" }; });
        v5.TryRun(spec5, prepared.Tensor, out var out5, out _);
        var value5 = ModelPostprocess.Interpret(spec5, prepared, out5, out error);
        Expect("yolo5 layout multiplies objectness into the score", value5 != null && value5.Items.Count == 1, error);
        if (value5 != null && value5.Items.Count == 1)
        {
            var b5 = (Dictionary<string, object>)value5.Items[0];
            Near("yolo5 score", Convert.ToDouble(b5["score"]), 0.81, 1e-3);
            Expect("yolo5 class", Convert.ToInt32(b5["index"]) == 1);
        }
    }

    // ---- 領域分割 -------------------------------------------------------------

    private static void TestSegmentToMaskAndRecolor()
    {
        // 出力 [1, 2, 8, 8]: 上半分がクラス 1、下半分がクラス 0
        var runner = new FakeRunner
        {
            Produce = (spec, input) =>
            {
                var data = new float[2 * 8 * 8];
                for (int y = 0; y < 8; y++)
                    for (int x = 0; x < 8; x++)
                    {
                        bool top = y < 4;
                        data[0 * 64 + y * 8 + x] = top ? 0.1f : 0.9f;
                        data[1 * 64 + y * 8 + x] = top ? 0.9f : 0.1f;
                    }
                return new Dictionary<string, TensorData> { ["seg"] = new TensorData(new[] { 1, 2, 8, 8 }, data) };
            },
        };
        var spec = Spec(ModelTask.Segment, 16, 16, s => { s.Output.MaskMode = "argmax"; s.Output.ClassIndices = new[] { 1 }; });
        var models = new Dictionary<string, ModelSpec> { ["m"] = spec };

        var pipeline = new VisionPipelineSpec
        {
            Id = "p", MaxWidth = 0,
            Ops =
            {
                new VisionOpSpec { Id = "ai", Op = "infer", Out = "region", In = new[] { "source" }, Params = { ["model"] = "m" } },
                new VisionOpSpec { Id = "paint", Op = "recolor", Out = "painted", In = new[] { "source", "region" },
                    Params = { ["topColor"] = "#00FF00", ["bottomColor"] = "#00FF00", ["strength"] = 1.0, ["preserveLuminance"] = false } },
                new VisionOpSpec { Id = "m", Op = "stats", Out = "stats", In = new[] { "region" } },
            },
            Outputs =
            {
                new VisionOutputSpec { Kind = "world", Value = "painted", Alpha = "region" },
                new VisionOutputSpec { Kind = "store", Value = "stats", StoreAs = "stats" },
            },
        };
        Expect("a segment model produces a mask, so recolor can use it directly",
               VisionPipelineRunner.Validate(pipeline, models).Count == 0,
               string.Join("; ", VisionPipelineRunner.Validate(pipeline, models)));

        var image = new ColorImage(40, 20);
        for (int i = 0; i < image.Data.Length; i++) image.Data[i] = 128;
        var result = VisionPipelineRunner.Run(pipeline, image, null, models, runner);
        Expect("segmentation runs through recolor", result.Ok, result.Error);

        var mask = result.Named["region"].Mask;
        Near("mask covers the top half", mask.Coverage(), 0.5, 0.05);
        Expect("mask is bottom-up: the top row is on, the bottom row is off",
               mask[20, 19] && !mask[20, 0]);
        Expect("mask has the image's size, not the model's", mask.Width == 40 && mask.Height == 20);

        var painted = result.Named["painted"].Color;
        painted.Get(20, 19, out byte r, out byte g, out _);
        Expect("recolor painted the segmented area", g > 200 && r < 50, $"r={r} g={g}");
        Expect("world output was prepared as RGBA", result.PreparedRgba.ContainsKey(0));

        // sigmoid モード: [1,1,H,W] ロジット
        var sig = new FakeRunner
        {
            Produce = (s, input) =>
            {
                var data = new float[16];
                for (int i = 0; i < 16; i++) data[i] = i < 8 ? 3f : -3f; // 上半分が正
                return new Dictionary<string, TensorData> { ["seg"] = new TensorData(new[] { 1, 1, 4, 4 }, data) };
            },
        };
        var sigSpec = Spec(ModelTask.Segment, 8, 8, s => { s.Output.MaskMode = "sigmoid"; s.Output.ApplySigmoid = true; s.Output.MaskThreshold = 0.5; });
        var prepared = ModelPreprocess.Prepare(new ColorImage(8, 8), sigSpec);
        sig.TryRun(sigSpec, prepared.Tensor, out var outputs, out _);
        var sigValue = ModelPostprocess.Interpret(sigSpec, prepared, outputs, out var error);
        Expect("sigmoid mode thresholds logits", sigValue != null && Math.Abs(sigValue.Mask.Coverage() - 0.5) < 0.01, error);
    }

    // ---- 生の値 / 定義の読み込み -----------------------------------------------

    private static void TestRawAndSpecParsing()
    {
        var plain = new Dictionary<string, object>
        {
            ["id"] = "x", ["name"] = "X", ["file"] = "Assets/Models/x.onnx", ["task"] = "detect", ["backend"] = "gpu",
            ["labels"] = new List<object> { "a", "b" },
            ["input"] = new Dictionary<string, object>
            {
                ["width"] = 320L, ["height"] = 320L, ["layout"] = "NHWC", ["channels"] = 3L, ["colorOrder"] = "BGR",
                ["scale"] = 1.0, ["mean"] = new List<object> { 1L, 2L, 3L }, ["std"] = new List<object> { 4.0, 5.0, 6.0 },
                ["resize"] = "letterbox", ["padValue"] = 0L,
            },
            ["output"] = new Dictionary<string, object>
            {
                ["boxLayout"] = "separate", ["boxesName"] = "boxes", ["scoresName"] = "scores", ["classesName"] = "classes",
                ["boxesNormalized"] = true, ["boxFormat"] = "xyxy", ["scoreThreshold"] = 0.25, ["iouThreshold"] = 0.45,
                ["maxItems"] = 3L, ["classIndices"] = new List<object> { 0L, 2L },
            },
        };
        var spec = ModelSpec.FromPlain(plain);
        Expect("spec: task/backend/labels", spec.Task == ModelTask.Detect && spec.Backend == "gpu" && spec.Labels.Length == 2);
        Expect("spec: input", !spec.Input.ChannelsFirst && spec.Input.Bgr && spec.Input.Letterbox && spec.Input.Width == 320
                              && spec.Input.MeanOf(2) == 3 && spec.Input.StdOf(1) == 5);
        Expect("spec: output", spec.Output.BoxLayout == "separate" && spec.Output.BoxesNormalized && spec.Output.MaxItems == 3
                               && spec.Output.ClassIndices.Length == 2 && spec.Output.ClassIndices[1] == 2);
        Expect("spec: labels beyond the list fall back to the index", spec.LabelOf(7) == "7");

        // separate 出力の検出
        var runner = new FakeRunner
        {
            Produce = (s, input) => new Dictionary<string, TensorData>
            {
                ["boxes"] = new TensorData(new[] { 2, 4 }, new float[] { 0, 0, 0.5f, 1, 0.5f, 0, 1, 1 }),
                ["scores"] = new TensorData(new[] { 2 }, new float[] { 0.9f, 0.1f }),
                ["classes"] = new TensorData(new[] { 2 }, new float[] { 1, 0 }),
            },
        };
        var prepared = ModelPreprocess.Prepare(new ColorImage(320, 320), spec);
        runner.TryRun(spec, prepared.Tensor, out var outputs, out _);
        var value = ModelPostprocess.Interpret(spec, prepared, outputs, out var error);
        Expect("separate outputs are combined", value != null && value.Items.Count == 1, error);

        // raw
        var raw = Spec(ModelTask.Raw, 4, 4, s => s.Output.RawLimit = 3);
        var rawRunner = new FakeRunner
        {
            Produce = (s, input) => new Dictionary<string, TensorData> { ["y"] = new TensorData(new[] { 1, 5 }, new float[] { 1, 2, 3, 4, 5 }) },
        };
        rawRunner.TryRun(raw, prepared.Tensor, out var rawOut, out _);
        var rawValue = ModelPostprocess.Interpret(raw, prepared, rawOut, out error);
        var values = rawValue?.Record["values"] as List<object>;
        Expect("raw keeps the first N values and the shape", values != null && values.Count == 3
               && Convert.ToInt32(rawValue.Record["length"]) == 5, error);
    }

    public static int Run()
    {
        _failures = 0;

        Console.WriteLine("\n--- models: preprocessing (image → tensor) ---");
        TestPreprocessLayoutAndRowOrder();
        TestPreprocessLetterbox();

        Console.WriteLine("\n--- models: classify / detect / segment through the pipeline ---");
        TestClassifyThroughPipeline();
        TestDetectYoloWithLetterbox();
        TestDetectOtherLayouts();
        TestSegmentToMaskAndRecolor();

        Console.WriteLine("\n--- models: definitions and raw output ---");
        TestRawAndSpecParsing();

        return _failures;
    }
}
