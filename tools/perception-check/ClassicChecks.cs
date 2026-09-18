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

    // --- 解析タスクの窓口 ---

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

    /// <summary>現実に重ねる RGBA。マスクの中だけ不透明であること。</summary>
    private static void TestCompose()
    {
        int w = 120, h = 90;
        var image = new ColorImage(w, h);
        for (int i = 0; i < image.PixelCount; i++)
        {
            image.Data[i * 3] = 40; image.Data[i * 3 + 1] = 90; image.Data[i * 3 + 2] = 200;
        }
        var mask = new MaskImage(w, h);
        FillRect(mask, 0, 45, w, 45);    // 上半分

        var rgba = Composite.ToRgba(image, mask, featherPasses: 3);
        Expect("compose returns RGBA for every pixel", rgba != null && rgba.Length == w * h * 4,
               $"{rgba?.Length}");

        int inside = (h - 5) * w + w / 2;
        int outside = 5 * w + w / 2;
        Expect("inside the mask is opaque", rgba[inside * 4 + 3] > 240, $"{rgba[inside * 4 + 3]}");
        Expect("outside the mask is fully transparent", rgba[outside * 4 + 3] == 0, $"{rgba[outside * 4 + 3]}");

        // ぼかしのおかげで境界に中間の alpha があること（そこが階段状に見えないため）。
        int soft = 0;
        for (int i = 0; i < w * h; i++)
        {
            byte alpha = rgba[i * 4 + 3];
            if (alpha > 20 && alpha < 235) soft++;
        }
        Expect("the edge is feathered, not a hard cut", soft > w / 2, $"{soft} soft px");

        var hard = Composite.ToRgba(image, mask, featherPasses: 0);
        int hardSoft = 0;
        for (int i = 0; i < w * h; i++)
        {
            byte alpha = hard[i * 4 + 3];
            if (alpha != 0 && alpha != 255) hardSoft++;
        }
        Expect("no feathering means no intermediate alpha", hardSoft == 0, $"{hardSoft} soft px");

        // マスクが無ければ全面不透明。
        var full = Composite.ToRgba(image, null, 3);
        Expect("no mask means draw everything", full[outside * 4 + 3] == 255);

        Expect("mismatched sizes are rejected",
               Composite.ToRgba(image, new MaskImage(10, 10), 1) == null);
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



        Console.WriteLine("\n--- classic: world overlay ---");
        TestViewportMapping();
        TestCompose();

        Console.WriteLine("\n--- classic: DataStore paths ---");
        TestDataStorePaths();

        return _failures;
    }
}
