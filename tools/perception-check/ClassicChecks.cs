// 古典的な画像処理 (Vision/Classic) の数値検証。
// 合成画像を作って、期待どおりの領域・形・位置が返るかを見る。
// 実機では「なんとなく違う」としか分からないので、ここで詰める。
using System;
using System.Linq;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Vision.Classic;

internal static class ClassicChecks
{
    private static int _failures;

    private static void Expect(string label, bool ok, string detail = null)
    {
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}{(detail != null ? $": {detail}" : "")}");
        if (!ok) _failures++;
    }

    /// <summary>値が上限以下であること（Program.cs の Check と同じ書き味）。</summary>
    private static void Check(string label, double value, double limit)
    {
        bool ok = value <= limit && !double.IsNaN(value);
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}: {value:G4} (limit {limit})");
        if (!ok) _failures++;
    }

    private static void Near(string label, double value, double expected, double tolerance)
    {
        bool ok = Math.Abs(value - expected) <= tolerance && !double.IsNaN(value);
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}: {value:F3} (expected {expected:F3} +-{tolerance})");
        if (!ok) _failures++;
    }

    // --- 合成画像 ---

    private static GrayImage Gray(int w, int h, byte fill)
    {
        var g = new GrayImage(w, h);
        for (int i = 0; i < g.Data.Length; i++) g.Data[i] = fill;
        return g;
    }

    private static void FillRect(GrayImage g, int x0, int y0, int w, int h, byte value)
    {
        for (int y = y0; y < y0 + h; y++)
            for (int x = x0; x < x0 + w; x++)
                if (x >= 0 && x < g.Width && y >= 0 && y < g.Height) g.Data[y * g.Width + x] = value;
    }

    private static void FillRect(MaskImage m, int x0, int y0, int w, int h)
    {
        for (int y = y0; y < y0 + h; y++)
            for (int x = x0; x < x0 + w; x++)
                if (x >= 0 && x < m.Width && y >= 0 && y < m.Height) m.Data[y * m.Width + x] = MaskImage.On;
    }

    private static void FillDisc(MaskImage m, int cx, int cy, int r)
    {
        for (int y = cy - r; y <= cy + r; y++)
            for (int x = cx - r; x <= cx + r; x++)
            {
                if (x < 0 || x >= m.Width || y < 0 || y >= m.Height) continue;
                int dx = x - cx, dy = y - cy;
                if (dx * dx + dy * dy <= r * r) m.Data[y * m.Width + x] = MaskImage.On;
            }
    }

    // --- 色空間 ---

    private static void TestColorSpace()
    {
        // 代表的な色で RGB -> HSV -> RGB が戻ること。整数演算なので少しの誤差は許す。
        var samples = new (byte r, byte g, byte b, int h)[]
        {
            (255, 0, 0, 0), (0, 255, 0, 120), (0, 0, 255, 240),
            (255, 255, 0, 60), (0, 255, 255, 180), (255, 0, 255, 300),
            (128, 128, 128, 0), (30, 90, 200, 0),
        };

        int worst = 0;
        foreach (var s in samples)
        {
            var hsv = ColorSpace.RgbToHsv(s.r, s.g, s.b);
            ColorSpace.HsvToRgb(hsv.H, hsv.S, hsv.V, out byte r, out byte g, out byte b);
            worst = Math.Max(worst, Math.Max(Math.Abs(r - s.r), Math.Max(Math.Abs(g - s.g), Math.Abs(b - s.b))));
        }
        Expect("hsv round-trip within 3/255", worst <= 3, $"max delta {worst}");

        // 純色の色相が規定値どおりか（範囲判定がここに依存する）。
        foreach (var s in samples.Take(6))
        {
            var hsv = ColorSpace.RgbToHsv(s.r, s.g, s.b);
            if (hsv.H != s.h) { Expect($"hue of ({s.r},{s.g},{s.b})", false, $"got {hsv.H}, want {s.h}"); return; }
        }
        Expect("primary/secondary hues exact", true);

        // 無彩色は彩度 0。
        var grayHsv = ColorSpace.RgbToHsv(128, 128, 128);
        Expect("gray has zero saturation", grayHsv.S == 0 && grayHsv.V == 128);
    }

    // --- しきい値 ---

    private static void TestThreshold()
    {
        // 40 と 200 の二山。大津のしきい値はその間に落ちるはず。
        var g = Gray(64, 64, 40);
        FillRect(g, 0, 0, 64, 24, 200);

        int t = Threshold.OtsuThreshold(g);
        Expect("otsu splits bimodal histogram", t > 40 && t < 200, $"threshold {t}");

        var mask = Threshold.Otsu(g);
        int on = mask.Data.Count(v => v == MaskImage.On);
        Expect("otsu mask covers the bright band", on == 64 * 24, $"{on} px on (want {64 * 24})");

        var inverted = Threshold.Otsu(g, invert: true);
        int invOn = inverted.Data.Count(v => v == MaskImage.On);
        Expect("otsu invert is the complement", invOn == 64 * 64 - on, $"{invOn} px on");

        // 一様な画像でも落ちないこと（ヒストグラムが一山）。
        var flat = Gray(16, 16, 77);
        int flatT = Threshold.OtsuThreshold(flat);
        Expect("otsu survives a flat image", flatT >= 0 && flatT <= 255, $"threshold {flatT}");
    }

    private static void TestHsvRange()
    {
        // 色相の巻き戻り（赤は 350..10）が効くか。
        var img = new ColorImage(30, 10);
        for (int x = 0; x < 10; x++) for (int y = 0; y < 10; y++) img.Set(x, y, 255, 0, 0);     // hue 0
        for (int x = 10; x < 20; x++) for (int y = 0; y < 10; y++) img.Set(x, y, 255, 0, 40);   // hue ~350
        for (int x = 20; x < 30; x++) for (int y = 0; y < 10; y++) img.Set(x, y, 0, 0, 255);    // hue 240

        var mask = Threshold.HsvRange(img, 340, 20, 80, 255, 80, 255);
        int left = 0, mid = 0, right = 0;
        for (int y = 0; y < 10; y++)
            for (int x = 0; x < 30; x++)
            {
                if (mask.Data[y * 30 + x] == MaskImage.Off) continue;
                if (x < 10) left++; else if (x < 20) mid++; else right++;
            }
        Expect("hsv range wraps around hue 0", left == 100 && mid == 100 && right == 0,
               $"red={left} nearRed={mid} blue={right}");
    }

    // --- モルフォロジー ---

    private static void TestMorphology()
    {
        var mask = new MaskImage(64, 64);
        FillRect(mask, 20, 20, 20, 20);
        mask.Data[5 * 64 + 5] = MaskImage.On;                 // 孤立点（ノイズ）
        mask.Data[30 * 64 + 30] = MaskImage.Off;              // 矩形内の穴

        var opened = Morphology.Open(mask, 1);
        Expect("open removes an isolated pixel", opened.Data[5 * 64 + 5] == MaskImage.Off);

        var closed = Morphology.Close(mask, 1);
        Expect("close fills a single-pixel hole", closed.Data[30 * 64 + 30] == MaskImage.On);

        // 半径 r の収縮は、20x20 の矩形を (20-2r)^2 まで削る。
        // 穴があると内側からも削れるので、穴なしの矩形で見る。
        var clean = new MaskImage(64, 64);
        FillRect(clean, 20, 20, 20, 20);
        var eroded = Morphology.Erode(clean, 2);
        int area = eroded.Data.Count(v => v == MaskImage.On);
        Expect("erode(2) shrinks 20x20 to 16x16", area == 16 * 16, $"{area} px (want {16 * 16})");

        // 分離実装が矩形カーネルと一致すること。
        var dilated = Morphology.Dilate(clean, 3);
        int dilatedArea = dilated.Data.Count(v => v == MaskImage.On);
        Expect("dilate(3) grows 20x20 to 26x26", dilatedArea == 26 * 26, $"{dilatedArea} px (want {26 * 26})");
    }

    // --- 連結成分 ---

    private static void TestConnectedComponents()
    {
        var mask = new MaskImage(128, 128);
        FillRect(mask, 10, 10, 40, 30);     // 面積 1200
        FillDisc(mask, 90, 90, 12);
        FillRect(mask, 70, 10, 2, 2);       // 小さすぎるので minArea で落ちる

        var result = ConnectedComponents.Label(mask, minArea: 20);
        Expect("labels two blobs above minArea", result.Blobs.Count == 2, $"{result.Blobs.Count} blobs");

        var largest = result.Largest();
        Expect("largest is the rectangle", largest != null && largest.Area == 40 * 30,
               $"area {largest?.Area}");
        Near("rectangle centroid x", largest.CentroidX, 29.5, 0.5);
        Near("rectangle centroid y", largest.CentroidY, 24.5, 0.5);
        Near("rectangle fill ratio", largest.Fill, 1.0, 0.001);
        Near("rectangle aspect", largest.Aspect, 40.0 / 30.0, 0.02);

        // 円の外接矩形は (2r+1) 角なので、充填率は pi*r^2/(2r+1)^2 に近づく。
        var disc = result.Blobs.First(b => b != largest);
        Near("disc fill ratio matches a rasterised circle", disc.Fill, Math.PI * 12 * 12 / (25.0 * 25.0), 0.03);

        var only = result.MaskOf(largest);
        int onlyArea = only.Data.Count(v => v == MaskImage.On);
        Expect("MaskOf isolates one blob", onlyArea == largest.Area, $"{onlyArea} px");

        // 大きな領域でもスタックが溢れないこと（空のマスクはこれくらいの規模になる）。
        var big = new MaskImage(400, 400);
        FillRect(big, 0, 0, 400, 400);
        var bigResult = ConnectedComponents.Label(big);
        Expect("labels a 160k-pixel region without overflow",
               bigResult.Blobs.Count == 1 && bigResult.Blobs[0].Area == 160000,
               $"{bigResult.Blobs.Count} blobs, area {bigResult.Blobs.FirstOrDefault()?.Area}");
    }

    // --- エッジ ---

    private static void TestEdges()
    {
        // 垂直な段差。勾配は縁だけに出るはず。
        var g = Gray(64, 64, 30);
        FillRect(g, 32, 0, 32, 64, 220);

        var field = EdgeDetector.Sobel(g);
        int mid = 32 * 64 + 32;
        int flat = 32 * 64 + 10;
        Expect("sobel responds at the step", field.Magnitude[mid] > 100, $"{field.Magnitude[mid]}");
        Expect("sobel is quiet on flat area", field.Magnitude[flat] < 10, $"{field.Magnitude[flat]}");

        var edges = EdgeDetector.Canny(g, 40, 90);
        // 縁は縦一本なので、各行につき数画素だけ立つ。
        int edgeCount = edges.Data.Count(v => v == MaskImage.On);
        Expect("canny finds a thin vertical edge", edgeCount > 40 && edgeCount < 64 * 4,
               $"{edgeCount} edge px");

        // 立った画素が縁の近くに集中していること。
        bool nearStep = true;
        for (int y = 0; y < 64 && nearStep; y++)
            for (int x = 0; x < 64; x++)
                if (edges.Data[y * 64 + x] == MaskImage.On && Math.Abs(x - 32) > 2) { nearStep = false; break; }
        Expect("canny edges sit on the step", nearStep);
    }

    // --- 輪郭 ---

    private static void TestContours()
    {
        var mask = new MaskImage(160, 160);
        FillRect(mask, 20, 20, 60, 60);
        FillDisc(mask, 120, 120, 25);

        var contours = Contours.FindExternal(mask);
        Expect("traces two external contours", contours.Count == 2, $"{contours.Count} contours");

        var square = contours.OrderBy(c => c.Points[0].X).First();
        Near("square contour area", square.Area(), 60 * 60, 60 * 60 * 0.06);
        Near("square perimeter", square.Perimeter(), 4 * 60, 4 * 60 * 0.08);

        var poly = Contours.ApproximatePolygon(square, square.Perimeter() * 0.02);
        Expect("square approximates to 4 vertices", poly.Count == 4, $"{poly.Count} vertices");
        Expect("square classifies as square", Contours.ClassifyShape(square) == "square",
               Contours.ClassifyShape(square));

        var circle = contours.First(c => c != square);
        Near("circle circularity approaches 1", circle.Circularity(), 1.0, 0.18);
        Expect("circle classifies as circle", Contours.ClassifyShape(circle) == "circle",
               Contours.ClassifyShape(circle));
    }

    // --- テンプレートマッチング ---

    private static void TestTemplateMatching()
    {
        var scene = Gray(200, 150, 60);
        // 探す図形。周囲と紛れないよう構造を持たせる。
        for (int y = 0; y < 20; y++)
            for (int x = 0; x < 20; x++)
                scene.Data[(70 + y) * 200 + (110 + x)] = (byte)(40 + x * 8 + y * 2);

        var template = new GrayImage(20, 20);
        for (int y = 0; y < 20; y++)
            for (int x = 0; x < 20; x++)
                template.Data[y * 20 + x] = (byte)(40 + x * 8 + y * 2);

        var match = TemplateMatcher.Match(scene, template, minScore: 0.8);
        Expect("template found", match.Found, $"score {match.Score:F3}");
        Expect("template at the right place", match.X == 110 && match.Y == 70, $"({match.X},{match.Y})");
        Near("exact match scores 1", match.Score, 1.0, 0.001);

        // NCC は明るさ・コントラストの変化に不変。
        var brighter = new GrayImage(200, 150);
        for (int i = 0; i < scene.Data.Length; i++)
            brighter.Data[i] = (byte)Math.Min(255, 30 + scene.Data[i] * 0.7);
        var shifted = TemplateMatcher.Match(brighter, template, minScore: 0.8);
        Expect("ncc is invariant to gain and offset",
               shifted.Found && shifted.X == 110 && shifted.Y == 70,
               $"({shifted.X},{shifted.Y}) score {shifted.Score:F3}");

        // 無いものは見つけないこと。
        var absent = TemplateMatcher.Match(Gray(200, 150, 60), template, minScore: 0.8);
        Expect("no false positive on a flat scene", !absent.Found, $"score {absent.Score:F3}");
    }

    // --- 空の抽出 ---

    /// <summary>上が空、下が地面の合成風景。</summary>
    /// <param name="skyLevel">空の明るさ。195 が昼、80 前後で薄暗い空になる。</param>
    /// <param name="groundLevel">地面の明るさ。空より暗くないと境界が出ない。</param>
    private static ColorImage MakeScene(
        int w, int h, double skyRatio, bool cloudy, int skyLevel = 195, int groundLevel = 50)
    {
        var img = new ColorImage(w, h);
        int horizon = (int)(h * skyRatio);   // 行は下から上なので、これより上が空

        var rng = new Random(7);
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                if (y > horizon)
                {
                    if (cloudy)
                    {
                        // 曇り空: 明るくて彩度が低く、ゆるやかな濃淡がある。
                        byte v = (byte)Clamp(skyLevel + Math.Sin(x * 0.05) * 12 + Math.Sin(y * 0.07) * 10);
                        img.Set(x, y, v, v, (byte)Math.Min(255, v + 6));
                    }
                    else
                    {
                        double dim = skyLevel / 195.0;
                        img.Set(x, y, (byte)Clamp(110 * dim), (byte)Clamp(160 * dim), (byte)Clamp(230 * dim));
                    }
                }
                else
                {
                    // 地面: 暗く、細かい模様があるので勾配が大きい。
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

    private static void TestSkySegmentation()
    {
        int w = 240, h = 180;
        double skyRatio = 0.6;
        var scene = MakeScene(w, h, skyRatio, cloudy: true);

        var sky = SkySegmenter.Segment(scene);
        Expect("sky found in a cloudy scene", sky.Found, $"coverage {sky.Coverage:F3} grad {sky.MeanGradient:F2}");
        Near("sky coverage matches the synthetic horizon", sky.Coverage, 1.0 - skyRatio, 0.06);

        // 空の画素が本当に上側にあるか。
        int horizon = (int)(h * skyRatio);
        int below = 0;
        for (int y = 0; y < horizon - 2; y++)
            for (int x = 0; x < w; x++)
                if (sky.Mask.Data[y * w + x] == MaskImage.On) below++;
        Expect("no sky pixels below the horizon", below == 0, $"{below} px below");

        // 地面だけの画像では空を見つけないこと（誤検出のほうが害が大きい）。
        var ground = new ColorImage(w, h);
        var rng = new Random(11);
        for (int i = 0; i < ground.PixelCount; i++)
        {
            byte n = (byte)rng.Next(0, 60);
            ground.Data[i * 3] = (byte)(50 + n);
            ground.Data[i * 3 + 1] = (byte)(70 + n);
            ground.Data[i * 3 + 2] = (byte)(40 + n);
        }
        var none = SkySegmenter.Segment(ground);
        Expect("no sky in a ground-only image", !none.Found, $"coverage {none.Coverage:F3} grad {none.MeanGradient:F2}");

        // 全面が空の画像は、ほぼ全部が空になること。
        var allSky = MakeScene(w, h, 0.0, cloudy: true);
        var full = SkySegmenter.Segment(allSky);
        Expect("full-frame sky is nearly all sky", full.Coverage > 0.9, $"coverage {full.Coverage:F3}");
    }

    /// <summary>
    /// 薄暗い空。固定のしきい値で切ると、夕方や曇りの濃い日の空がまるごと落ちる。
    /// 空かどうかを決めるのは絶対的な明るさではなく「地面より明るく、平坦で、上にある」こと。
    /// </summary>
    private static void TestDimSky()
    {
        int w = 240, h = 180;

        // 明るい昼から、ほとんど夜と言える暗さまで。どこでも同じだけ空が取れること。
        foreach (var level in new[] { 195, 140, 110, 90, 70, 55, 40, 30 })
        {
            var scene = MakeScene(w, h, 0.6, cloudy: true,
                                  skyLevel: level, groundLevel: Math.Max(10, level - 130));
            var sky = SkySegmenter.Segment(scene);
            bool ok = sky.Found && Math.Abs(sky.Coverage - 0.4) <= 0.06;
            Expect($"dim sky is still found at level {level}", ok,
                   $"found={sky.Found} coverage={sky.Coverage:F3} threshold={sky.MinBrightnessUsed}");
        }

        // しきい値が画像に追随していること。昼は従来どおり 90 で頭打ち。
        var bright = SkySegmenter.Segment(MakeScene(w, h, 0.6, cloudy: true, skyLevel: 195));
        var dim = SkySegmenter.Segment(MakeScene(w, h, 0.6, cloudy: true, skyLevel: 60, groundLevel: 10));
        Expect("a bright scene keeps the fixed threshold", bright.MinBrightnessUsed == 90,
               $"{bright.MinBrightnessUsed}");
        Expect("a dim scene lowers the threshold", dim.MinBrightnessUsed < 45,
               $"{dim.MinBrightnessUsed}");

        // 暗い空でも、塗り替えた結果はちゃんと明るい青になること。
        // shade を空自身の平均輝度で正規化しているので、元の暗さは持ち越さない。
        foreach (var level in new[] { 195, 90, 40 })
        {
            var scene = MakeScene(w, h, 0.6, cloudy: true,
                                  skyLevel: level, groundLevel: Math.Max(10, level - 130));
            var sky = SkySegmenter.Segment(scene);
            var painted = SkySegmenter.Repaint(scene, sky);

            long b = 0; int n = 0;
            for (int i = 0; i < scene.PixelCount; i++)
            {
                if (sky.Mask.Data[i] == MaskImage.Off) continue;
                b += painted.Data[i * 3 + 2]; n++;
            }
            double meanB = n > 0 ? (double)b / n : 0;
            Expect($"a dim sky is repainted bright at level {level}", meanB > 200, $"meanB {meanB:F0}");
        }

        // 暗い場面ではセンサーノイズが乗って空でも勾配が上がる。絶対値だけで切ると
        // 夕方の空が落ちるので、地面よりはっきり平坦なら空と認めること。
        var noisy = MakeScene(w, h, 0.6, cloudy: true, skyLevel: 60, groundLevel: 12);
        var noise = new Random(23);
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int i = (y * w + x) * 3;
                int amount = y > (int)(h * 0.6) ? 40 : 120;   // 空にも強く乗るが、地面はもっと荒い
                for (int c = 0; c < 3; c++)
                {
                    noisy.Data[i + c] = (byte)Clamp(noisy.Data[i + c] + noise.Next(-amount, amount + 1));
                }
            }
        }
        var noisySky = SkySegmenter.Segment(noisy);
        Expect("a noisy dim sky is accepted for being flatter than the ground", noisySky.Found,
               $"sky {noisySky.MeanGradient:F1} vs ground {noisySky.MeanGroundGradient:F1}");
        Expect("the noisy sky really did exceed the absolute gate",
               noisySky.MeanGradient > 8.0,
               $"{noisySky.MeanGradient:F1} — if this drops below 8 the relative rule is no longer under test");

        // 相対の門を足しても、地面しか写っていない画像は空にならないこと。
        var groundOnly = new ColorImage(w, h);
        var groundNoise = new Random(29);
        for (int i = 0; i < groundOnly.PixelCount; i++)
        {
            byte n = (byte)groundNoise.Next(0, 60);
            groundOnly.Data[i * 3] = (byte)(50 + n);
            groundOnly.Data[i * 3 + 1] = (byte)(70 + n);
            groundOnly.Data[i * 3 + 2] = (byte)(40 + n);
        }
        var noSky = SkySegmenter.Segment(groundOnly);
        Expect("the relative rule does not let a ground-only image through", !noSky.Found,
               $"coverage {noSky.Coverage:F3} sky {noSky.MeanGradient:F1} ground {noSky.MeanGroundGradient:F1}");

        // 明るさではなく彩度で曇り／晴れを分けること。
        // 夕方の青空は暗いが青いままなので、明るさで分けると曇り扱いになってしまう。
        var duskClear = SkySegmenter.Segment(MakeScene(w, h, 0.6, cloudy: false, skyLevel: 70, groundLevel: 10));
        var duskCloudy = SkySegmenter.Segment(MakeScene(w, h, 0.6, cloudy: true, skyLevel: 70, groundLevel: 10));
        Expect("a dim blue sky keeps its saturation", duskClear.MeanSaturation > 100,
               $"{duskClear.MeanSaturation:F0}");
        Expect("a dim grey sky has almost none", duskCloudy.MeanSaturation < 60,
               $"{duskCloudy.MeanSaturation:F0}");
    }

    private static void TestSkyRepaint()
    {
        int w = 240, h = 180;
        var scene = MakeScene(w, h, 0.6, cloudy: true);
        var sky = SkySegmenter.Segment(scene);
        var painted = SkySegmenter.Repaint(scene, sky);

        // 空は青くなる: B > R が成り立つこと。
        long r = 0, b = 0; int n = 0;
        for (int i = 0; i < scene.PixelCount; i++)
        {
            if (sky.Mask.Data[i] == MaskImage.Off) continue;
            r += painted.Data[i * 3];
            b += painted.Data[i * 3 + 2];
            n++;
        }
        Expect("repainted sky is blue", n > 0 && b > r * 1.3, $"meanR={r / Math.Max(1, n)} meanB={b / Math.Max(1, n)}");

        // 空でない画素は 1 バイトも変わらないこと。
        bool groundUntouched = true;
        for (int i = 0; i < scene.PixelCount && groundUntouched; i++)
        {
            if (sky.Mask.Data[i] == MaskImage.On) continue;
            for (int c = 0; c < 3; c++)
                if (painted.Data[i * 3 + c] != scene.Data[i * 3 + c]) { groundUntouched = false; break; }
        }
        Expect("repaint leaves non-sky pixels untouched", groundUntouched);

        // 雲の濃淡が残ること: 塗った空にも輝度のばらつきがある。
        double mean = 0; int count = 0;
        for (int i = 0; i < scene.PixelCount; i++)
        {
            if (sky.Mask.Data[i] == MaskImage.Off) continue;
            mean += painted.Data[i * 3 + 2]; count++;
        }
        mean /= Math.Max(1, count);
        double variance = 0;
        for (int i = 0; i < scene.PixelCount; i++)
        {
            if (sky.Mask.Data[i] == MaskImage.Off) continue;
            double d = painted.Data[i * 3 + 2] - mean;
            variance += d * d;
        }
        variance /= Math.Max(1, count);
        Expect("repaint keeps cloud texture", variance > 4.0, $"variance {variance:F2}");

        // strength=0 は何も変えない。
        var untouched = SkySegmenter.Repaint(scene, sky, 0.0);
        Expect("strength 0 is a no-op", untouched.Data.SequenceEqual(scene.Data));
    }

    // --- 解析タスクの窓口 ---

    private static void TestAnalyzer()
    {
        // 代表色: 赤が多数派、緑が少数派。平均ではなく多数派の色が返るべき。
        var swatch = new ColorImage(80, 60);
        for (int y = 0; y < 60; y++)
            for (int x = 0; x < 80; x++)
                swatch.Set(x, y, x < 60 ? (byte)220 : (byte)20, x < 60 ? (byte)30 : (byte)200, (byte)30);

        var color = ClassicAnalyzer.Analyze(swatch, new ClassicAnalysisConfig { Kind = ClassicAnalysisKind.Color });
        Expect("colour analysis reports the dominant hue, not the mean",
               color.Ok && (string)color.Values["name"] == "red", $"{color.Values["name"]} {color.Values["hex"]}");

        // 無彩色は名前が gray/white/black になること（色相は当てにならない）。
        var grayPatch = new ColorImage(40, 40);
        for (int i = 0; i < grayPatch.PixelCount; i++)
        { grayPatch.Data[i * 3] = 128; grayPatch.Data[i * 3 + 1] = 128; grayPatch.Data[i * 3 + 2] = 128; }
        var grayResult = ClassicAnalyzer.Analyze(grayPatch, new ClassicAnalysisConfig { Kind = ClassicAnalysisKind.Color });
        Expect("achromatic patch is named gray", (string)grayResult.Values["name"] == "gray",
               (string)grayResult.Values["name"]);

        // 塊: 黒地に赤い四角ふたつ。
        var scene = new ColorImage(200, 150);
        for (int y = 20; y < 60; y++) for (int x = 20; x < 70; x++) scene.Set(x, y, 220, 20, 20);
        for (int y = 90; y < 120; y++) for (int x = 120; x < 160; x++) scene.Set(x, y, 220, 20, 20);
        var blobs = ClassicAnalyzer.Analyze(scene, new ClassicAnalysisConfig
        {
            Kind = ClassicAnalysisKind.Blobs,
            HueMin = 340, HueMax = 20, SatMin = 80, ValMin = 80,
            MinArea = 20, MaxWidth = 0,
        });
        Expect("blob analysis counts two patches", blobs.Ok && (int)blobs.Values["count"] == 2,
               $"count {blobs.Values["count"]}");
        var items = (System.Collections.Generic.List<object>)blobs.Values["items"];
        var first = (System.Collections.Generic.Dictionary<string, object>)items[0];
        Near("largest blob centre x is normalised", (double)first["x"], 44.5 / 200, 0.02);

        // 形: 白地の四角と円。
        var shapes = new ColorImage(220, 180);
        for (int i = 0; i < shapes.PixelCount; i++)
        { shapes.Data[i * 3] = 20; shapes.Data[i * 3 + 1] = 20; shapes.Data[i * 3 + 2] = 20; }
        for (int y = 20; y < 80; y++) for (int x = 20; x < 80; x++) shapes.Set(x, y, 240, 240, 240);
        for (int y = 90; y < 170; y++)
            for (int x = 120; x < 200; x++)
            {
                int dx = x - 160, dy = y - 130;
                if (dx * dx + dy * dy <= 38 * 38) shapes.Set(x, y, 240, 240, 240);
            }
        var shapeResult = ClassicAnalyzer.Analyze(shapes, new ClassicAnalysisConfig
        {
            Kind = ClassicAnalysisKind.Shapes, MinArea = 200, MaxWidth = 0,
        });
        Expect("shape analysis finds a square and a circle",
               shapeResult.Ok && shapeResult.Values.ContainsKey("square") && shapeResult.Values.ContainsKey("circle"),
               string.Join(",", shapeResult.Values.Keys));

        // 空。
        var sky = ClassicAnalyzer.Analyze(MakeScene(240, 180, 0.6, cloudy: true),
                                          new ClassicAnalysisConfig { Kind = ClassicAnalysisKind.Sky, MaxWidth = 0 });
        Expect("sky analysis reports overcast",
               sky.Ok && (bool)sky.Values["found"] && (string)sky.Values["condition"] == "overcast",
               $"{sky.Values["condition"]} coverage {sky.Values["coverage"]}");

        // 画が無いときは素直に失敗すること。
        Expect("analyzer rejects a missing image",
               !ClassicAnalyzer.Analyze(null, null).Ok, ClassicAnalyzer.Analyze(null, null).Error);
    }

    // --- DataStore のパス解決 ---
    // 解析結果は「辞書ひとつ」で書く。ここが崩れると、bind した UI が無言で空になる。

    private static void TestDataStorePaths()
    {
        var store = Arsist.Runtime.DataFlow.ArsistDataStore.Instance;
        store.SetValue("sky", new System.Collections.Generic.Dictionary<string, object>
        {
            ["status"] = "ok",
            ["condition"] = "overcast",
            ["items"] = new System.Collections.Generic.List<object>
            {
                new System.Collections.Generic.Dictionary<string, object> { ["x"] = 0.25, ["shape"] = "circle" },
                new System.Collections.Generic.Dictionary<string, object> { ["x"] = 0.75, ["shape"] = "square" },
            },
        });

        Expect("path reaches a nested value",
               store.TryGetValueByPath("sky.condition", out var condition) && (string)condition == "overcast");
        Expect("path indexes a list with brackets",
               store.TryGetValueByPath("sky.items[1].shape", out var shape) && (string)shape == "square");
        Expect("path indexes a list with dots",
               store.TryGetValueByPath("sky.items.0.x", out var x) && (double)x == 0.25);
        Expect("out-of-range index fails instead of throwing",
               !store.TryGetValueByPath("sky.items[9].shape", out _));
        Expect("a missing key fails",
               !store.TryGetValueByPath("sky.nothing", out _));
    }

    // --- 現実に重ねるための換算 ---
    // ここを間違えると、青空が空からずれた場所に貼り付く。実機でしか気付けないので数値で見る。

    private static void TestViewportMapping()
    {
        var full = new CameraIntrinsics { Fx = 800, Fy = 800, Cx = 639.5, Cy = 479.5 };

        // 切り出しも縮小もしなければ、そのまま。
        var same = ViewportMapping.ForCrop(full, 0, 0, 1.0);
        Expect("no crop and no scale is a no-op",
               same.Fx == full.Fx && same.Cy == full.Cy, $"{same.Fx} {same.Cy}");

        // 往復で元の画素に戻ること。これが本命。
        // 切り出し (100, 60) から 2 倍縮小した画の (pu, pv) は、
        // 元画像の (100 + pu*2, 60 + pv*2) と同じ光線を指すはず。
        int cropX = 100, cropY = 60;
        double scale = 0.5;
        var cropped = ViewportMapping.ForCrop(full, cropX, cropY, scale);

        double worst = 0;
        foreach (var (pu, pv) in new[] { (0.0, 0.0), (50.0, 30.0), (199.0, 149.0) })
        {
            // 縮小後の画素 -> カメラ光線
            double x = (pu - cropped.Cx) / cropped.Fx;
            double y = (pv - cropped.Cy) / cropped.Fy;

            // 同じ点を元画像の画素として辿ったときの光線。
            // 縮小後の 1 画素は元画像の 1/scale 画素を覆うので、その中心を採る。
            double u = cropX + (pu + 0.5) / scale - 0.5;
            double v = cropY + (pv + 0.5) / scale - 0.5;
            double xFull = (u - full.Cx) / full.Fx;
            double yFull = (v - full.Cy) / full.Fy;

            worst = Math.Max(worst, Math.Max(Math.Abs(x - xFull), Math.Abs(y - yFull)));
        }
        Check("cropped intrinsics point at the same rays", worst, 1e-12);

        // 板の範囲は画の縁 (-0.5 と width-0.5) に合うこと。
        // width/2 で済ませると端が半画素ぶんずれる。
        var centred = new CameraIntrinsics { Fx = 400, Fy = 400, Cx = 319.5, Cy = 239.5 };
        ViewportMapping.PlaneExtents(centred, 640, 480, 10.0,
                                     out double left, out double right, out double bottom, out double top);
        Check("plane is centred when the principal point is", Math.Abs(left + right), 1e-9);
        Check("plane is centred vertically too", Math.Abs(bottom + top), 1e-9);
        // 水平半画角: atan(320/400) -> 半幅 = 10 * 320/400 = 8
        Check("plane half-width matches the focal length", Math.Abs(right - 8.0), 1e-9);

        // 主点がずれていれば板もずれること（対称にしてはいけない）。
        var offset = new CameraIntrinsics { Fx = 400, Fy = 400, Cx = 200, Cy = 239.5 };
        ViewportMapping.PlaneExtents(offset, 640, 480, 10.0,
                                     out double l2, out double r2, out _, out _);
        Expect("an off-centre principal point shifts the plane", Math.Abs(l2 + r2) > 1.0,
               $"left {l2:F3} right {r2:F3}");

        // 縮小しても同じ立体角を覆うこと。テクスチャの解像度を落としても
        // 空の貼り付く位置は変わってはいけない。
        var half = ViewportMapping.ForCrop(full, 0, 0, 0.5);
        ViewportMapping.PlaneExtents(full, 1280, 960, 10.0, out double lf, out double rf, out _, out _);
        ViewportMapping.PlaneExtents(half, 640, 480, 10.0, out double lh, out double rh, out _, out _);
        Check("downscaling does not move the plane (left)", Math.Abs(lf - lh), 1e-9);
        Check("downscaling does not move the plane (right)", Math.Abs(rf - rh), 1e-9);
    }

    /// <summary>現実に重ねる RGBA。空だけ不透明であること。</summary>
    private static void TestCompose()
    {
        int w = 240, h = 180;
        var scene = MakeScene(w, h, 0.6, cloudy: true);
        var sky = SkySegmenter.Segment(scene);
        var painted = SkySegmenter.Repaint(scene, sky);

        var rgba = SkySegmenter.Compose(painted, sky.Mask, featherPasses: 3);
        Expect("compose returns RGBA for every pixel", rgba != null && rgba.Length == w * h * 4,
               $"{rgba?.Length}");

        // 空の真ん中は不透明、地面の真ん中は透明。
        int skyIndex = (h - 10) * w + w / 2;
        int groundIndex = 10 * w + w / 2;
        Expect("the middle of the sky is opaque", rgba[skyIndex * 4 + 3] > 240, $"{rgba[skyIndex * 4 + 3]}");
        Expect("the ground is fully transparent", rgba[groundIndex * 4 + 3] == 0, $"{rgba[groundIndex * 4 + 3]}");

        // ぼかしのおかげで境界に中間の alpha があること（そこが階段状に見えないため）。
        int soft = 0;
        for (int i = 0; i < w * h; i++)
        {
            byte alpha = rgba[i * 4 + 3];
            if (alpha > 20 && alpha < 235) soft++;
        }
        Expect("the edge is feathered, not a hard cut", soft > w / 2, $"{soft} soft px");

        // ぼかし 0 なら中間値は出ないこと。
        var hard = SkySegmenter.Compose(painted, sky.Mask, featherPasses: 0);
        int hardSoft = 0;
        for (int i = 0; i < w * h; i++)
        {
            byte alpha = hard[i * 4 + 3];
            if (alpha != 0 && alpha != 255) hardSoft++;
        }
        Expect("no feathering means no intermediate alpha", hardSoft == 0, $"{hardSoft} soft px");

        // 大きさが合わないものは弾くこと。
        Expect("mismatched sizes are rejected",
               SkySegmenter.Compose(painted, new MaskImage(10, 10), 1) == null);
    }

    public static int Run()
    {
        _failures = 0;

        Console.WriteLine("\n--- classic: colour space ---");
        TestColorSpace();

        Console.WriteLine("\n--- classic: threshold ---");
        TestThreshold();
        TestHsvRange();

        Console.WriteLine("\n--- classic: morphology ---");
        TestMorphology();

        Console.WriteLine("\n--- classic: connected components ---");
        TestConnectedComponents();

        Console.WriteLine("\n--- classic: edges ---");
        TestEdges();

        Console.WriteLine("\n--- classic: contours ---");
        TestContours();

        Console.WriteLine("\n--- classic: template matching ---");
        TestTemplateMatching();

        Console.WriteLine("\n--- classic: sky segmentation ---");
        TestSkySegmentation();
        TestSkyRepaint();
        TestDimSky();

        Console.WriteLine("\n--- classic: analyzer ---");
        TestAnalyzer();

        Console.WriteLine("\n--- classic: world overlay ---");
        TestViewportMapping();
        TestCompose();

        Console.WriteLine("\n--- classic: DataStore paths ---");
        TestDataStorePaths();

        return _failures;
    }
}
