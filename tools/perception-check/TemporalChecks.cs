// 「見つけた物を扱う」「時間」「幾何」の一手の検証。
//
// 追跡は ID が安定すること、平滑化はちらつきが減ること、イベントは立ち上がりで一度だけ
// 鳴ること、四角形は角の順序が正対化の規約に揃うことを見る。
using System;
using System.Collections.Generic;
using Arsist.Runtime.Perception.Pipeline;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Vision.Classic;

internal static class TemporalChecks
{
    private static int _failures;

    private static void Expect(string label, bool ok, string detail = null)
    {
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}{(detail != null ? $": {detail}" : "")}");
        if (!ok) _failures++;
    }

    private static Dictionary<string, object> Item(double x, double y, double w, double h, string label = "cup", double score = 0.9) =>
        new Dictionary<string, object> { ["x"] = x, ["y"] = y, ["width"] = w, ["height"] = h, ["label"] = label, ["score"] = score };

    private static VisionOpSpec Op(string id, string op, string outName, string[] inputs, params object[] pairs)
    {
        var spec = new VisionOpSpec { Id = id, Op = op, Out = outName, In = inputs ?? Array.Empty<string>() };
        for (int i = 0; i + 1 < pairs.Length; i += 2) spec.Params[(string)pairs[i]] = pairs[i + 1];
        return spec;
    }

    // ---- 追跡 ----

    private static void TestTrackerKeepsIds()
    {
        var state = new TrackerState();
        var a0 = Tracker.Update(state, new List<object> { Item(0.2, 0.5, 0.1, 0.1), Item(0.7, 0.5, 0.1, 0.1, "bottle") },
            0.0, 0.15, 3, 0.5, 2, true);
        Expect("two detections become two tracks", a0.Count == 2);

        // 少し動いた。ID は保たれ、速度が出る
        var a1 = Tracker.Update(state, new List<object> { Item(0.25, 0.5, 0.1, 0.1), Item(0.7, 0.52, 0.1, 0.1, "bottle") },
            0.5, 0.15, 3, 0.5, 2, true);
        var first = (Dictionary<string, object>)a1[0];
        Expect("ids are stable across frames", Convert.ToInt32(first["id"]) == 1 && Convert.ToInt32(((Dictionary<string, object>)a1[1])["id"]) == 2);
        Expect("stable after minHits observations", (bool)first["stable"]);
        double vx = Convert.ToDouble(first["vx"]);
        Expect("velocity is measured from raw positions (0.05 in 0.5 s = 0.1/s)", Math.Abs(vx - 0.1) < 1e-6, vx.ToString("F4"));
        double x = Convert.ToDouble(first["x"]);
        Expect("position is smoothed (between 0.2 and 0.25)", x > 0.2 && x < 0.25, x.ToString("F4"));

        // 片方が一度見えなくなる → missing で残り、ID は保たれる
        var a2 = Tracker.Update(state, new List<object> { Item(0.3, 0.5, 0.1, 0.1) }, 1.0, 0.15, 3, 0.5, 2, true);
        Expect("a track that vanished stays as missing", a2.Count == 2 && (bool)((Dictionary<string, object>)a2[1])["missing"]);

        // 遠くに新しい物 → 新しい ID
        var a3 = Tracker.Update(state, new List<object> { Item(0.3, 0.5, 0.1, 0.1), Item(0.9, 0.1, 0.1, 0.1) }, 1.5, 0.15, 3, 0.5, 2, true);
        Expect("a far detection gets a new id", a3.Count == 3 && Convert.ToInt32(((Dictionary<string, object>)a3[2])["id"]) == 3);

        // 長く見えない → 消える
        for (int i = 0; i < 4; i++) Tracker.Update(state, new List<object> { Item(0.3, 0.5, 0.1, 0.1) }, 2 + i * 0.5, 0.15, 3, 0.5, 2, true);
        Expect("tracks older than maxAge are dropped", state.Tracks.Count == 1, state.Tracks.Count.ToString());

        // ラベルが違えば結び付けない
        var state2 = new TrackerState();
        Tracker.Update(state2, new List<object> { Item(0.5, 0.5, 0.1, 0.1, "cup") }, 0, 0.15, 3, 0.5, 2, true);
        var b = Tracker.Update(state2, new List<object> { Item(0.5, 0.5, 0.1, 0.1, "bottle") }, 0.5, 0.15, 3, 0.5, 2, true);
        Expect("matchLabel keeps different labels apart", b.Count == 2);
    }

    // ---- select / countItems / stabilize / event を Run で通す ----

    private static void TestItemsThroughPipeline()
    {
        var items = new List<object>
        {
            Item(0.2, 0.5, 0.1, 0.1, "cup", 0.9), Item(0.5, 0.5, 0.2, 0.2, "cup", 0.4), Item(0.8, 0.5, 0.05, 0.05, "bottle", 0.95),
        };
        var pipeline = new VisionPipelineSpec
        {
            Id = "p", MaxWidth = 0,
            Ops =
            {
                Op("pick", "select", "cups", new[] { "found" }, "label", "cup", "minScore", 0.5, "sortBy", "score"),
                Op("n", "countItems", "count", new[] { "cups" }),
                Op("ev", "event", "flag", new[] { "count" }, "value", "count", "op", "gte", "compare", 1.0, "name", "cup.seen", "mode", "onChange"),
                Op("sm", "stabilize", "smooth", new[] { "flag" }, "alpha", 0.5),
            },
            Outputs = { new VisionOutputSpec { Kind = "store", Value = "smooth", StoreAs = "s" } },
        };

        // "found" は source から作れないので、テスト用に直接値を差し込む
        var state = new VisionState();
        VisionPipelineResult RunWith(List<object> found, double t)
        {
            var values = new Dictionary<string, VisionValue>(StringComparer.Ordinal)
            {
                [VisionPipelineRunner.SourceName] = VisionValue.OfColor(new ColorImage(8, 8)),
                ["found"] = VisionValue.OfBlobs(found),
            };
            var context = new VisionContext(values) { Width = 8, Height = 8, State = state, TimeSeconds = t };
            var result = new VisionPipelineResult { Ok = true };
            foreach (var op in pipeline.Ops)
            {
                var inputs = new VisionValue[VisionOps.Signatures[op.Op].Inputs.Length];
                for (int i = 0; i < inputs.Length; i++) inputs[i] = values[op.In[i]];
                values[op.Out] = VisionOps.Apply(op, inputs, context);
            }
            result.Named = values;
            result.Events = new List<string>(context.Events);
            return result;
        }

        var r0 = RunWith(items, 0);
        Expect("select keeps only matching labels above the score", r0.Named["cups"].Items.Count == 1);
        Expect("countItems reports the count", Convert.ToInt32(r0.Named["count"].Record["count"]) == 1);
        Expect("event fires on the rising edge", r0.Events.Contains("cup.seen"));

        var r1 = RunWith(items, 0.5);
        Expect("onChange does not fire again while the condition holds", r1.Events.Count == 0);

        var r2 = RunWith(new List<object>(), 1.0);
        Expect("condition false clears the edge", r2.Events.Count == 0 && !(bool)r2.Named["flag"].Record["condition"]);
        var r3 = RunWith(items, 1.5);
        Expect("event fires again after the condition was false", r3.Events.Contains("cup.seen"));

        double smoothed = Convert.ToDouble(r3.Named["smooth"].Record["count"]);
        Expect("stabilize smooths a flickering count (1,1,0,1 → between 0 and 1)", smoothed > 0.5 && smoothed < 1.0, smoothed.ToString("F3"));
        Expect("stabilize keeps a majority for booleans", r3.Named["smooth"].Record["condition"] is bool);
    }

    // ---- motion ----

    private static void TestMotion()
    {
        var a = new GrayImage(16, 16);
        var b = new GrayImage(16, 16);
        for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) { a.Data[y * 16 + x] = 50; b.Data[y * 16 + x] = (byte)(x < 8 ? 50 : 200); }

        var state = new VisionState();
        var op = Op("m", "motion", "moved", new[] { "gray" }, "threshold", 25);
        VisionContext Ctx(double t) => new VisionContext(new Dictionary<string, VisionValue>()) { Width = 16, Height = 16, State = state, TimeSeconds = t };

        var first = VisionOps.Apply(op, new[] { VisionValue.OfGray(a) }, Ctx(0)).Mask;
        Expect("first frame has no motion", first.Count() == 0);
        var second = VisionOps.Apply(op, new[] { VisionValue.OfGray(b) }, Ctx(0.5)).Mask;
        Expect("changed half of the frame is marked as motion", Math.Abs(second.Coverage() - 0.5) < 0.01, second.Coverage().ToString("F3"));
        var third = VisionOps.Apply(op, new[] { VisionValue.OfGray(b) }, Ctx(1.0)).Mask;
        Expect("a still frame has no motion", third.Count() == 0);
    }

    // ---- quads / rectify / annotate ----

    private static void TestQuadsAndRectify()
    {
        // 傾いた四角形 (平行四辺形寄り) を描いたマスク
        var mask = new MaskImage(200, 160);
        var corners = new double[] { 40, 30, 150, 40, 160, 120, 50, 110 }; // 左下・右下・右上・左上
        for (int y = 0; y < 160; y++)
            for (int x = 0; x < 200; x++)
                if (Inside(corners, x, y)) mask.Data[y * 200 + x] = MaskImage.On;

        var quads = Quads.Find(mask, 0.04, 400, 4);
        Expect("a tilted rectangle is found as one quad", quads.Count == 1, quads.Count.ToString());
        if (quads.Count != 1) return;
        var quad = (Dictionary<string, object>)quads[0];
        var px = (List<object>)quad["px"];
        double bx = Convert.ToDouble(px[0]), by = Convert.ToDouble(px[1]);
        Expect("first corner is bottom-left (smallest x+y)", Math.Abs(bx - 40) < 4 && Math.Abs(by - 30) < 4, $"{bx},{by}");
        double tx = Convert.ToDouble(px[6]), ty = Convert.ToDouble(px[7]);
        Expect("fourth corner is top-left", Math.Abs(tx - 50) < 4 && Math.Abs(ty - 110) < 4, $"{tx},{ty}");
        Expect("normalised centre is inside the unit square", Convert.ToDouble(quad["x"]) > 0.3 && Convert.ToDouble(quad["x"]) < 0.7);

        // 中を色分けした画を正対化: 左半分が赤、右半分が青になっているか
        var image = new ColorImage(200, 160);
        for (int y = 0; y < 160; y++)
            for (int x = 0; x < 200; x++)
            {
                // 四角形の中で「左寄り」かを、下辺に沿った割合で決める
                double t = (x - 40 - (y - 30) * (10.0 / 80)) / 110.0;
                if (t < 0.5) image.Set(x, y, 220, 30, 30); else image.Set(x, y, 30, 30, 220);
            }
        var values = new Dictionary<string, VisionValue>(StringComparer.Ordinal)
        {
            ["source"] = VisionValue.OfColor(image), ["quads"] = VisionValue.OfQuads(quads),
        };
        var context = new VisionContext(values) { Width = 200, Height = 160 };
        var rectified = VisionOps.Apply(Op("r", "rectify", "flat", new[] { "source", "quads" }, "width", 100),
            new[] { values["source"], values["quads"] }, context);
        Expect("rectify produces the requested width and an aspect-derived height",
               rectified.Color.Width == 100 && rectified.Color.Height > 55 && rectified.Color.Height < 90,
               $"{rectified.Color.Width}x{rectified.Color.Height}");
        rectified.Color.Get(20, rectified.Color.Height / 2, out byte r, out _, out byte b);
        rectified.Color.Get(80, rectified.Color.Height / 2, out byte r2, out _, out byte b2);
        Expect("rectified left is red, right is blue", r > 150 && b < 100 && b2 > 150 && r2 < 100, $"{r},{b} / {r2},{b2}");

        var none = VisionOps.Apply(Op("r2", "rectify", "flat2", new[] { "source", "quads" }),
            new[] { values["source"], VisionValue.OfQuads(new List<object>()) }, context);
        Expect("rectify with no quad stops the pipeline with a reason", context.StopReason == "noQuad" && none.Color != null);

        // annotate: 箱の線が描かれ、その画素だけがマスクになる
        var items = new List<object> { Item(0.5, 0.5, 0.5, 0.5) };
        var drawn = Annotate.Boxes(new ColorImage(100, 100), items, "#FF0000", 2, out var boxMask);
        drawn.Get(25, 50, out byte dr, out _, out _);
        drawn.Get(50, 50, out byte cr, out _, out _);
        Expect("annotate draws the box edge in the requested colour", dr == 255 && cr == 0);
        Expect("box mask covers the edge only", boxMask[25, 50] && !boxMask[50, 50]);
    }

    private static bool Inside(double[] c, double x, double y)
    {
        // 凸多角形の内側判定 (すべての辺で同じ側)
        int sign = 0;
        for (int i = 0; i < 4; i++)
        {
            int j = (i + 1) % 4;
            double cross = (c[j * 2] - c[i * 2]) * (y - c[i * 2 + 1]) - (c[j * 2 + 1] - c[i * 2 + 1]) * (x - c[i * 2]);
            int s = cross >= 0 ? 1 : -1;
            if (sign == 0) sign = s; else if (s != sign) return false;
        }
        return true;
    }

    private static void TestValidationOfNewOps()
    {
        var pipeline = new VisionPipelineSpec
        {
            Id = "p",
            Ops =
            {
                Op("g", "grayscale", "gray", new[] { "source" }),
                Op("m", "motion", "moved", new[] { "gray" }),
                Op("b", "blobs", "found", new[] { "moved" }),
                Op("t", "track", "tracked", new[] { "found" }),
                Op("n", "countItems", "count", new[] { "tracked" }),
                Op("e", "event", "flag", new[] { "count" }, "name", "moved"),
                Op("a", "annotate", "drawn", new[] { "source", "tracked" }),
                Op("bm", "boxMask", "boxes", new[] { "tracked" }),
            },
            Outputs =
            {
                new VisionOutputSpec { Kind = "anchor", Value = "tracked", Label = "id" },
                new VisionOutputSpec { Kind = "world", Value = "drawn", Alpha = "boxes" },
                new VisionOutputSpec { Kind = "store", Value = "flag", StoreAs = "motion" },
            },
        };
        var problems = VisionPipelineRunner.Validate(pipeline);
        Expect("a motion → track → event → anchor pipeline validates", problems.Count == 0, string.Join("; ", problems));

        var bad = new VisionPipelineSpec
        {
            Id = "p", Ops = { Op("g", "grayscale", "gray", new[] { "source" }) },
            Outputs = { new VisionOutputSpec { Kind = "anchor", Value = "gray" } },
        };
        Expect("anchoring a non-list value is rejected", VisionPipelineRunner.Validate(bad).Count == 1);

        // 実際に 2 フレーム流して、状態が残ることを見る (source は動く明るい四角)
        var state = new VisionState();
        ColorImage Frame(int offset)
        {
            var img = new ColorImage(64, 64);
            for (int y = 20; y < 44; y++) for (int x = 10 + offset; x < 30 + offset; x++) img.Set(x, y, 255, 255, 255);
            return img;
        }
        var r0 = VisionPipelineRunner.Run(pipeline, Frame(0), null, null, null, state, 0);
        var r1 = VisionPipelineRunner.Run(pipeline, Frame(6), null, null, null, state, 0.5);
        var r2 = VisionPipelineRunner.Run(pipeline, Frame(12), null, null, null, state, 1.0);
        Expect("frames run with shared state", r0.Ok && r1.Ok && r2.Ok, r0.Error + r1.Error + r2.Error);
        Expect("motion appears from the second frame", r0.Named["found"].Items.Count == 0 && r1.Named["found"].Items.Count > 0);
        Expect("the moving thing keeps its track id between frames",
               r2.Named["tracked"].Items.Count > 0 && Convert.ToInt32(((Dictionary<string, object>)r2.Named["tracked"].Items[0])["id"]) == 1);
        Expect("the event fired once when motion started", r1.Events.Contains("moved") && !r2.Events.Contains("moved"));
        Expect("world output was prepared from the annotated image", r2.PreparedRgba.ContainsKey(1));
    }

    public static int Run()
    {
        _failures = 0;
        Console.WriteLine("\n--- tracking: ids, velocity, ageing ---");
        TestTrackerKeepsIds();
        Console.WriteLine("\n--- items: select / countItems / event / stabilize ---");
        TestItemsThroughPipeline();
        Console.WriteLine("\n--- time: motion ---");
        TestMotion();
        Console.WriteLine("\n--- geometry: quads / rectify / annotate ---");
        TestQuadsAndRectify();
        Console.WriteLine("\n--- pipeline: motion → track → event → anchor ---");
        TestValidationOfNewOps();
        return _failures;
    }
}
