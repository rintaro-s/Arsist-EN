// パイプラインの検証。
//
// ここで一番大事なのは「青空アプリが汎用の op だけで組めること」を示すテスト。
// エンジンに空専用の機能を戻したくなったら、まずこれが通らなくなるはず。
using System;
using System.Collections.Generic;
using System.Linq;
using Arsist.Runtime.Perception.Pipeline;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Vision.Classic;

internal static class PipelineChecks
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
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}: {value:F3} (expected {expected:F3} +-{tolerance})");
        if (!ok) _failures++;
    }

    private static VisionOpSpec Op(string id, string op, string outName, string[] inputs = null,
                                   params object[] pairs)
    {
        var spec = new VisionOpSpec { Id = id, Op = op, Out = outName, In = inputs ?? Array.Empty<string>() };
        for (int i = 0; i + 1 < pairs.Length; i += 2)
        {
            spec.Params[(string)pairs[i]] = pairs[i + 1];
        }
        return spec;
    }

    private static ColorImage MakeScene(int w, int h, double skyRatio, int skyLevel = 195, int groundLevel = 50)
    {
        var img = new ColorImage(w, h);
        int horizon = (int)(h * skyRatio);
        var rng = new Random(7);

        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                if (y > horizon)
                {
                    byte v = (byte)Clamp(skyLevel + Math.Sin(x * 0.05) * 12 + Math.Sin(y * 0.07) * 10);
                    img.Set(x, y, v, v, (byte)Math.Min(255, v + 6));
                }
                else
                {
                    byte n = (byte)rng.Next(0, 60);
                    img.Set(x, y, (byte)Clamp(groundLevel + n),
                                  (byte)Clamp(groundLevel + 20 + n),
                                  (byte)Clamp(groundLevel - 10 + n));
                }
            }
        }
        return img;
    }

    private static double Clamp(double v) => v < 0 ? 0 : (v > 255 ? 255 : v);

    /// <summary>
    /// products/BlueSky と同じ組み方。エンジン側に "sky" という概念は一切無く、
    /// 汎用の op を並べただけでここまで出来ることを示す。
    /// </summary>
    private static VisionPipelineSpec BlueSkyPipeline()
    {
        return new VisionPipelineSpec
        {
            Id = "sky",
            Name = "Blue sky",
            MaxWidth = 0,
            Ops = new List<VisionOpSpec>
            {
                // 1. 輪郭を見るために輝度にして、ノイズを落とす
                Op("gray", "grayscale", "gray"),
                Op("soft", "blur", "soft", new[] { "gray" }, "passes", 1),
                Op("edges", "sobel", "edges", new[] { "soft" }),

                // 2. 上から降りて最初の強い輪郭 = 空の下端
                Op("horizon", "edgeScan", "horizon", new[] { "edges" },
                   "from", "top", "threshold", 22, "smooth", 12, "limit", 0.95),
                Op("above", "maskSide", "above", new[] { "horizon" },
                   "from", "top", "keep", "before"),

                // 3. 明るさは絶対値で切らない。周りと比べて明るいかで見る
                Op("bright", "threshold", "bright", new[] { "gray" },
                   "mode", "relativeMedian", "within", "above",
                   "ratio", 0.5, "floor", 20, "ceiling", 90),

                // 4. 彩度が低いこと（曇天も晴天も彩度は高くない）
                Op("pale", "hsvRange", "pale", new[] { "source" },
                   "satMax", 140, "valMin", 20),

                // 5. 3条件の重なりが空
                Op("and1", "maskCombine", "candidate", new[] { "above", "bright" }, "mode", "and"),
                Op("and2", "maskCombine", "rough", new[] { "candidate", "pale" }, "mode", "and"),
                Op("fill", "morphology", "filled", new[] { "rough" }, "mode", "close", "radius", 2),
                Op("clean", "morphology", "sky", new[] { "filled" }, "mode", "open", "radius", 1),

                // 6. 確からしさを測る。空は平坦なので、地面より平坦なはず
                Op("stats", "stats", "skyStats", new[] { "sky" }, "against", "edges"),
                Op("enough", "gate", "checked", new[] { "skyStats" },
                   "value", "coverage", "op", "gte", "compare", 0.02, "reason", "noSky"),
                Op("flat", "gate", "verdict", new[] { "checked" },
                   "value", "mean", "op", "lte", "compare", 8.0,
                   "relativeTo", null, "orRelativeTo", "meanOutside", "orFactor", 0.6,
                   "reason", "notFlat"),

                // 7. 塗り替え
                Op("paint", "recolor", "painted", new[] { "source", "sky" },
                   "topColor", "#2060D2", "bottomColor", "#9EC8F2",
                   "strength", 1.0, "preserveLuminance", true),
            },
            Outputs = new List<VisionOutputSpec>
            {
                new VisionOutputSpec { Kind = "world", Value = "painted", Alpha = "sky" },
                new VisionOutputSpec { Kind = "store", Value = "verdict", StoreAs = "sky" },
            },
        };
    }

    private static void TestBlueSkyFromGeneralOps()
    {
        var pipeline = BlueSkyPipeline();

        Expect("the blue-sky pipeline wires up", VisionPipelineRunner.Validate(pipeline).Count == 0,
               string.Join(" | ", VisionPipelineRunner.Validate(pipeline)));

        var scene = MakeScene(240, 180, 0.6);
        var result = VisionPipelineRunner.Run(pipeline, scene);
        Expect("the blue-sky pipeline runs", result.Ok, result.Error);
        Expect("the gate opened on a real sky", !result.Gated, result.GateReason);

        var sky = result.Named["sky"].Mask;
        double coverage = sky.Data.Count(v => v == MaskImage.On) / (double)sky.Data.Length;
        Near("it finds about the right amount of sky", coverage, 0.4, 0.08);

        // 空の画素が本当に上側にあること。
        int horizon = (int)(180 * 0.6);
        int below = 0;
        for (int y = 0; y < horizon - 2; y++)
            for (int x = 0; x < 240; x++)
                if (sky.Data[y * 240 + x] == MaskImage.On) below++;
        Expect("no sky below the horizon", below == 0, $"{below} px");

        // 塗った結果が青いこと。
        var painted = result.Named["painted"].Color;
        long r = 0, b = 0; int n = 0;
        for (int i = 0; i < painted.PixelCount; i++)
        {
            if (sky.Data[i] == MaskImage.Off) continue;
            r += painted.Data[i * 3];
            b += painted.Data[i * 3 + 2];
            n++;
        }
        Expect("the sky came out blue", n > 0 && b > r * 1.3, $"R={r / Math.Max(1, n)} B={b / Math.Max(1, n)}");

        // 空でない画素は 1 バイトも変わっていないこと。
        bool untouched = true;
        for (int i = 0; i < painted.PixelCount && untouched; i++)
        {
            if (sky.Data[i] == MaskImage.On) continue;
            for (int c = 0; c < 3; c++)
                if (painted.Data[i * 3 + c] != scene.Data[i * 3 + c]) { untouched = false; break; }
        }
        Expect("the ground is untouched", untouched);
    }

    private static void TestDimSkyThroughPipeline()
    {
        var pipeline = BlueSkyPipeline();

        // 昼からほぼ夜まで、同じ組み方で同じだけ取れること。
        // 明るさを絶対値で切らない (relativeMedian) 効果がここに出る。
        foreach (var level in new[] { 195, 110, 70, 40 })
        {
            var scene = MakeScene(240, 180, 0.6, level, Math.Max(10, level - 130));
            var result = VisionPipelineRunner.Run(pipeline, scene);
            var mask = result.Named.TryGetValue("sky", out var v) ? v.Mask : null;
            double coverage = mask == null ? 0
                : mask.Data.Count(x => x == MaskImage.On) / (double)mask.Data.Length;

            Expect($"a dim sky at level {level} still works",
                   result.Ok && !result.Gated && Math.Abs(coverage - 0.4) < 0.08,
                   $"gated={result.Gated}({result.GateReason}) coverage={coverage:F3}");
        }
    }

    private static void TestGateRejectsGround()
    {
        var pipeline = BlueSkyPipeline();

        // 地面しか写っていない画。門が閉じること。
        var ground = new ColorImage(240, 180);
        var rng = new Random(11);
        for (int i = 0; i < ground.PixelCount; i++)
        {
            byte n = (byte)rng.Next(0, 60);
            ground.Data[i * 3] = (byte)(50 + n);
            ground.Data[i * 3 + 1] = (byte)(70 + n);
            ground.Data[i * 3 + 2] = (byte)(40 + n);
        }

        var result = VisionPipelineRunner.Run(pipeline, ground);
        Expect("a ground-only image is rejected by a gate", result.Ok && result.Gated,
               $"gated={result.Gated} reason={result.GateReason}");
    }

    private static void TestValidationCatchesBadWiring()
    {
        // マスクを期待する op に色を繋ぐ。
        var wrongType = new VisionPipelineSpec
        {
            Ops = new List<VisionOpSpec>
            {
                Op("m", "morphology", "m", new[] { "source" }),
            },
        };
        var problems = VisionPipelineRunner.Validate(wrongType);
        Expect("a type mismatch is caught before running", problems.Count > 0,
               problems.FirstOrDefault());

        // 無い値を読む。
        var dangling = new VisionPipelineSpec
        {
            Ops = new List<VisionOpSpec> { Op("g", "grayscale", "g", new[] { "nope" }) },
        };
        Expect("reading a name nothing produces is caught",
               VisionPipelineRunner.Validate(dangling).Any(p => p.Contains("nope")),
               string.Join(" | ", VisionPipelineRunner.Validate(dangling)));

        // 知らない op。
        var unknown = new VisionPipelineSpec
        {
            Ops = new List<VisionOpSpec> { Op("x", "teleport", "x") },
        };
        Expect("an unknown operation is caught",
               VisionPipelineRunner.Validate(unknown).Any(p => p.Contains("teleport")));

        // 世界に描く出力にマスクではないものを alpha として渡す。
        var badAlpha = new VisionPipelineSpec
        {
            Ops = new List<VisionOpSpec> { Op("g", "grayscale", "g") },
            Outputs = new List<VisionOutputSpec>
            {
                new VisionOutputSpec { Kind = "world", Value = "source", Alpha = "g" },
            },
        };
        Expect("a non-mask alpha is caught",
               VisionPipelineRunner.Validate(badAlpha).Any(p => p.Contains("alpha")),
               string.Join(" | ", VisionPipelineRunner.Validate(badAlpha)));

        // 出力キーが無い store。
        var noKey = new VisionPipelineSpec
        {
            Ops = new List<VisionOpSpec> { Op("g", "grayscale", "g") },
            Outputs = new List<VisionOutputSpec> { new VisionOutputSpec { Kind = "store", Value = "g" } },
        };
        Expect("a store output without a key is caught",
               VisionPipelineRunner.Validate(noKey).Any(p => p.Contains("key")));
    }

    /// <summary>青空以外も同じ道具立てで組めること。</summary>
    private static void TestOtherAppsFromSameOps()
    {
        // (a) 赤いランプを数える
        var scene = new ColorImage(200, 150);
        for (int y = 20; y < 60; y++) for (int x = 20; x < 70; x++) scene.Set(x, y, 220, 20, 20);
        for (int y = 90; y < 120; y++) for (int x = 120; x < 160; x++) scene.Set(x, y, 220, 20, 20);

        var counter = new VisionPipelineSpec
        {
            MaxWidth = 0,
            Ops = new List<VisionOpSpec>
            {
                Op("red", "hsvRange", "red", new[] { "source" },
                   "hueMin", 340, "hueMax", 20, "satMin", 80, "valMin", 80),
                Op("clean", "morphology", "clean", new[] { "red" }, "mode", "open", "radius", 1),
                Op("count", "blobs", "lamps", new[] { "clean" }, "minArea", 20),
            },
            Outputs = new List<VisionOutputSpec>
            {
                new VisionOutputSpec { Kind = "store", Value = "lamps", StoreAs = "lamps" },
            },
        };
        var counted = VisionPipelineRunner.Run(counter, scene);
        Expect("counting red lamps needs no new engine feature",
               counted.Ok && counted.Named["lamps"].Items.Count == 2,
               $"{counted.Named["lamps"].Items.Count} lamp(s)");

        // (b) 形を見分ける
        var shapes = new ColorImage(220, 180);
        for (int i = 0; i < shapes.PixelCount; i++)
        {
            shapes.Data[i * 3] = 20; shapes.Data[i * 3 + 1] = 20; shapes.Data[i * 3 + 2] = 20;
        }
        for (int y = 20; y < 80; y++) for (int x = 20; x < 80; x++) shapes.Set(x, y, 240, 240, 240);
        for (int y = 90; y < 170; y++)
            for (int x = 120; x < 200; x++)
            {
                int dx = x - 160, dy = y - 130;
                if (dx * dx + dy * dy <= 38 * 38) shapes.Set(x, y, 240, 240, 240);
            }

        var classifier = new VisionPipelineSpec
        {
            MaxWidth = 0,
            Ops = new List<VisionOpSpec>
            {
                Op("gray", "grayscale", "gray"),
                Op("bin", "threshold", "bin", new[] { "gray" }, "mode", "otsu"),
                Op("shapes", "contours", "shapes", new[] { "bin" }, "minArea", 200),
            },
            Outputs = new List<VisionOutputSpec>
            {
                new VisionOutputSpec { Kind = "store", Value = "shapes", StoreAs = "shapes" },
            },
        };
        var classified = VisionPipelineRunner.Run(classifier, shapes);
        var names = classified.Named["shapes"].Items
            .Select(item => (string)((Dictionary<string, object>)item)["shape"]).ToList();
        Expect("classifying shapes needs no new engine feature",
               classified.Ok && names.Contains("square") && names.Contains("circle"),
               string.Join(",", names));

        // (c) 代表色を測る
        var swatch = new ColorImage(80, 60);
        for (int y = 0; y < 60; y++)
            for (int x = 0; x < 80; x++)
                swatch.Set(x, y, x < 60 ? (byte)220 : (byte)20, x < 60 ? (byte)30 : (byte)200, (byte)30);

        var colour = new VisionPipelineSpec
        {
            MaxWidth = 0,
            Ops = new List<VisionOpSpec> { Op("c", "dominantColor", "colour", new[] { "source" }) },
            Outputs = new List<VisionOutputSpec>
            {
                new VisionOutputSpec { Kind = "store", Value = "colour", StoreAs = "colour" },
            },
        };
        var measured = VisionPipelineRunner.Run(colour, swatch);
        Expect("measuring the dominant colour needs no new engine feature",
               measured.Ok && (string)measured.Named["colour"].Record["name"] == "red",
               (string)measured.Named["colour"].Record["name"]);
    }

    private static void TestOutputsReachTheStore()
    {
        var pipeline = BlueSkyPipeline();
        var result = VisionPipelineRunner.Run(pipeline, MakeScene(240, 180, 0.6));

        Expect("store outputs are collected", result.Values.ContainsKey("sky"),
               string.Join(",", result.Values.Keys));

        var record = (Dictionary<string, object>)result.Values["sky"];
        Expect("the record carries the numbers the UI binds to",
               record.ContainsKey("coverage") && record.ContainsKey("pass"),
               string.Join(",", record.Keys));
    }

    private static void TestBoundaryScanner()
    {
        // 上半分が明るく、下半分が暗い画。境界は真ん中に出るはず。
        var gray = new GrayImage(80, 60);
        for (int y = 0; y < 60; y++)
            for (int x = 0; x < 80; x++)
                gray.Data[y * 80 + x] = (byte)(y >= 30 ? 220 : 40);

        var edges = EdgeDetector.Sobel(gray.Blur());
        var boundary = BoundaryScanner.Scan(edges, "top", 22, 3, 0.95);
        double mean = boundary.Average();
        Near("scanning from the top finds the step", mean, 30, 3);

        // 反対側から走査しても同じ場所を指すこと。
        var fromBottom = BoundaryScanner.Scan(edges, "bottom", 22, 3, 0.95);
        Near("scanning from the bottom finds the same step", fromBottom.Average(), 29, 3);

        // 手前側を残すマスクが、走査を始めた端の側になること。
        var above = BoundaryScanner.SideMask(boundary, 80, 60, "top", "before");
        int topHalf = 0, bottomHalf = 0;
        for (int y = 0; y < 60; y++)
            for (int x = 0; x < 80; x++)
                if (above.Data[y * 80 + x] == MaskImage.On) { if (y >= 30) topHalf++; else bottomHalf++; }
        Expect("keeping 'before' from the top keeps the upper side",
               topHalf > 2000 && bottomHalf == 0, $"upper {topHalf} lower {bottomHalf}");

        var below = BoundaryScanner.SideMask(boundary, 80, 60, "top", "after");
        int lower = 0;
        for (int y = 0; y < 30; y++)
            for (int x = 0; x < 80; x++)
                if (below.Data[y * 80 + x] == MaskImage.On) lower++;
        Expect("keeping 'after' keeps the other side", lower > 2000, $"{lower} px");
    }

    private static void TestMaskAlgebra()
    {
        var a = new MaskImage(20, 20);
        var b = new MaskImage(20, 20);
        for (int i = 0; i < 200; i++) a.Data[i] = MaskImage.On;          // 前半
        for (int i = 100; i < 300; i++) b.Data[i] = MaskImage.On;        // 中盤

        Expect("and keeps the overlap",
               MaskAlgebra.Combine(a, b, "and").Data.Count(v => v == MaskImage.On) == 100);
        Expect("or keeps the union",
               MaskAlgebra.Combine(a, b, "or").Data.Count(v => v == MaskImage.On) == 300);
        Expect("subtract removes the second",
               MaskAlgebra.Combine(a, b, "subtract").Data.Count(v => v == MaskImage.On) == 100);
        Expect("not inverts",
               MaskAlgebra.Combine(a, null, "not").Data.Count(v => v == MaskImage.On) == 200);

        // 大きさ違いは黙って通さないこと。ずれた結果が静かに出るより落ちた方がいい。
        bool threw = false;
        try { MaskAlgebra.Combine(a, new MaskImage(10, 10), "and"); }
        catch (ArgumentException) { threw = true; }
        Expect("mismatched mask sizes throw instead of silently misaligning", threw);
    }

    public static int Run()
    {
        _failures = 0;

        Console.WriteLine("\n--- pipeline: general operators ---");
        TestBoundaryScanner();
        TestMaskAlgebra();

        Console.WriteLine("\n--- pipeline: validation ---");
        TestValidationCatchesBadWiring();

        Console.WriteLine("\n--- pipeline: the blue-sky app, built only from general ops ---");
        TestBlueSkyFromGeneralOps();
        TestDimSkyThroughPipeline();
        TestGateRejectsGround();
        TestOutputsReachTheStore();

        Console.WriteLine("\n--- pipeline: other apps from the same ops ---");
        TestOtherAppsFromSameOps();

        return _failures;
    }
}
