// 合成データによる姿勢推定の数値検証。
// 既知の姿勢からターゲット平面上の点を投影し、推定結果が元の姿勢に戻るかを見る。
using System;
using System.IO;
using Arsist.Runtime.Perception.Vision;

internal static class Program
{
    private static int _failures;

    private static void Check(string label, double value, double limit)
    {
        bool ok = value <= limit && !double.IsNaN(value);
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}: {value:F4} (limit {limit})");
        if (!ok) _failures++;
    }

    private static double[] Rot(double rx, double ry, double rz) => LinAlg.Rodrigues(rx, ry, rz);

    /// <summary>点群をターゲット平面上に並べる（メートル）。</summary>
    private static (double[] obj, double[] img) Project(
        double[] r, double tx, double ty, double tz, CameraIntrinsics k,
        double width, double height, int gridN, double noisePx, int seed, double outlierRatio = 0)
    {
        var rng = new Random(seed);
        int n = gridN * gridN;
        var obj = new double[n * 2];
        var img = new double[n * 2];

        for (int i = 0; i < n; i++)
        {
            int gx = i % gridN, gy = i / gridN;
            double ox = (gx / (double)(gridN - 1) - 0.5) * width;
            double oy = (gy / (double)(gridN - 1) - 0.5) * height;

            double px = r[0] * ox + r[1] * oy + tx;
            double py = r[3] * ox + r[4] * oy + ty;
            double pz = r[6] * ox + r[7] * oy + tz;

            double u = k.Fx * px / pz + k.Cx;
            double v = k.Fy * py / pz + k.Cy;

            if (noisePx > 0)
            {
                u += Gauss(rng) * noisePx;
                v += Gauss(rng) * noisePx;
            }
            if (outlierRatio > 0 && rng.NextDouble() < outlierRatio)
            {
                u = rng.NextDouble() * 640;
                v = rng.NextDouble() * 480;
            }

            obj[i * 2] = ox; obj[i * 2 + 1] = oy;
            img[i * 2] = u; img[i * 2 + 1] = v;
        }
        return (obj, img);
    }

    private static double Gauss(Random rng)
    {
        double u1 = 1.0 - rng.NextDouble();
        double u2 = rng.NextDouble();
        return Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2);
    }

    /// <summary>2つの回転行列の角度差（度）。</summary>
    private static double RotationAngleDegrees(double[] a, double[] b)
    {
        // trace(AᵀB) = 1 + 2cosθ
        double trace = 0;
        for (int i = 0; i < 3; i++)
            for (int j = 0; j < 3; j++)
                if (i == j)
                {
                    double s = 0;
                    for (int k = 0; k < 3; k++) s += a[k * 3 + i] * b[k * 3 + j];
                    trace += s;
                }
        double cos = (trace - 1.0) / 2.0;
        if (cos > 1) cos = 1; else if (cos < -1) cos = -1;
        return Math.Acos(cos) * 180.0 / Math.PI;
    }

    private static void RunCase(
        string label, double[] r, double tx, double ty, double tz,
        double noisePx, double outlierRatio, int seed,
        double rotLimitDeg, double posLimitMm)
    {
        var k = new CameraIntrinsics { Fx = 480, Fy = 480, Cx = 319.5, Cy = 239.5 };
        var (obj, img) = Project(r, tx, ty, tz, k, 0.30, 0.20, 8, noisePx, seed, outlierRatio);
        int n = obj.Length / 2;

        var h = Homography.Estimate(obj, img, n, 3.0, 2000, seed + 7);
        if (h == null)
        {
            Console.WriteLine($"FAIL  {label}: homography could not be estimated");
            _failures++;
            return;
        }

        int m = h.Inliers.Count;
        var inObj = new double[m * 2];
        var inImg = new double[m * 2];
        for (int i = 0; i < m; i++)
        {
            int idx = h.Inliers[i];
            inObj[i * 2] = obj[idx * 2]; inObj[i * 2 + 1] = obj[idx * 2 + 1];
            inImg[i * 2] = img[idx * 2]; inImg[i * 2 + 1] = img[idx * 2 + 1];
        }

        var pose = PlanarPoseSolver.Solve(h.H, k, inObj, inImg, m);
        if (pose == null)
        {
            Console.WriteLine($"FAIL  {label}: pose could not be solved");
            _failures++;
            return;
        }

        double rotErr = RotationAngleDegrees(r, pose.R);
        double posErr = Math.Sqrt(
            (pose.Tx - tx) * (pose.Tx - tx) +
            (pose.Ty - ty) * (pose.Ty - ty) +
            (pose.Tz - tz) * (pose.Tz - tz)) * 1000.0;

        Console.WriteLine($"--- {label}  (inliers {m}/{n}, rmse {pose.Rmse:F2}px)");
        Check($"{label} rotation error (deg)", rotErr, rotLimitDeg);
        Check($"{label} position error (mm)", posErr, posLimitMm);
    }

    private static void TestHomographyExact()
    {
        // 既知の射影で写した点から H を復元できるか（ノイズ無し）
        var h = new double[9] { 1.2, 0.15, 30, -0.1, 1.05, -12, 0.0004, -0.0002, 1 };
        int n = 20;
        var src = new double[n * 2];
        var dst = new double[n * 2];
        var rng = new Random(3);
        for (int i = 0; i < n; i++)
        {
            double x = rng.NextDouble() * 200 - 100;
            double y = rng.NextDouble() * 200 - 100;
            double w = h[6] * x + h[7] * y + h[8];
            src[i * 2] = x; src[i * 2 + 1] = y;
            dst[i * 2] = (h[0] * x + h[1] * y + h[2]) / w;
            dst[i * 2 + 1] = (h[3] * x + h[4] * y + h[5]) / w;
        }

        var estimated = Homography.ComputeDlt(src, dst, n);
        double worst = 0;
        for (int i = 0; i < 9; i++) worst = Math.Max(worst, Math.Abs(estimated[i] - h[i]));
        Check("DLT recovers a known homography", worst, 1e-6);
    }

    private static void TestOrthonormalisation()
    {
        var r = Rot(0.3, -0.7, 0.2);
        // わざと崩した行列から最近傍回転を復元できるか
        var noisy = (double[])r.Clone();
        noisy[0] *= 1.05; noisy[4] *= 0.93; noisy[8] *= 1.02; noisy[1] += 0.04;
        var fixedR = LinAlg.NearestRotation(noisy);
        Check("NearestRotation determinant", Math.Abs(LinAlg.Det3(fixedR) - 1.0), 1e-9);
        Check("NearestRotation stays near the original", RotationAngleDegrees(r, fixedR), 4.0);
    }


    // ==========================================================
    // 領域の正対化 (RegionRectifier)
    // ==========================================================

    /// <summary>滑らかな模様。バイリニア再標本化の誤差だけを見たいので階段状の模様は使わない。</summary>
    private static double Pattern(double u, double v)
    {
        return 128.0 + 100.0 * Math.Sin(u * 3.0 * 2.0 * Math.PI) * Math.Cos(v * 2.0 * 2.0 * Math.PI);
    }

    /// <summary>単位正方形の模様を、指定した四角形に射影した「撮影画像」を合成する。</summary>
    private static GrayImage RenderWarped(double[] quad, int width, int height)
    {
        var unit = new double[8] { 0, 0, 1, 0, 1, 1, 0, 1 };
        var toUnit = Homography.ComputeDlt(quad, unit, 4);
        var image = new GrayImage(width, height);

        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                double w = toUnit[6] * x + toUnit[7] * y + toUnit[8];
                if (Math.Abs(w) < 1e-12) continue;
                double u = (toUnit[0] * x + toUnit[1] * y + toUnit[2]) / w;
                double v = (toUnit[3] * x + toUnit[4] * y + toUnit[5]) / w;
                if (u < 0 || u > 1 || v < 0 || v > 1) continue;
                image.Data[y * width + x] = (byte)Math.Clamp(Pattern(u, v), 0, 255);
            }
        }
        return image;
    }

    private static void TestRectifyRoundTrip(string label, double[] quad, double meanLimit)
    {
        var source = RenderWarped(quad, 640, 480);
        const int outW = 240, outH = 180;

        var status = RegionRectifier.TryRectify(source, quad, outW, outH, out var rectified);
        if (status != RectifyStatus.Ok)
        {
            Console.WriteLine($"FAIL  {label}: rectify returned {status}");
            _failures++;
            return;
        }

        // 端は元画像の外を掴みうるので少し内側だけ比べる
        double sum = 0;
        int count = 0;
        for (int y = 4; y < outH - 4; y++)
        {
            for (int x = 4; x < outW - 4; x++)
            {
                double expected = Pattern(x / (double)(outW - 1), y / (double)(outH - 1));
                sum += Math.Abs(rectified.Data[y * outW + x] - expected);
                count++;
            }
        }
        double mean = sum / count;
        Check($"{label} mean abs error (0-255)", mean, meanLimit);
    }

    private static void TestRectifyRejections()
    {
        var source = new GrayImage(640, 480);

        // 画面外にはみ出した枠は、欠けたまま読ませずに弾く
        var outside = new double[8] { -20, 10, 300, 10, 300, 200, -20, 200 };
        var status = RegionRectifier.TryRectify(source, outside, 200, 150, out _);
        Console.WriteLine($"{(status == RectifyStatus.OutOfView ? "PASS" : "FAIL")}  " +
                          $"quad outside the frame is rejected: {status}");
        if (status != RectifyStatus.OutOfView) _failures++;

        // ほぼ真横から見て潰れた枠
        var oblique = new double[8] { 100, 100, 118, 100, 118, 118, 100, 118 };
        status = RegionRectifier.TryRectify(source, oblique, 200, 150, out _);
        Console.WriteLine($"{(status == RectifyStatus.TooOblique ? "PASS" : "FAIL")}  " +
                          $"collapsed quad is rejected: {status}");
        if (status != RectifyStatus.TooOblique) _failures++;

        // 4点が一直線
        var degenerate = new double[8] { 10, 10, 200, 10, 400, 10, 600, 10 };
        status = RegionRectifier.TryRectify(source, degenerate, 200, 150, out _);
        Console.WriteLine($"{(status != RectifyStatus.Ok ? "PASS" : "FAIL")}  " +
                          $"collinear quad is rejected: {status}");
        if (status == RectifyStatus.Ok) _failures++;
    }

    private static void TestOutputSizing()
    {
        // 横長の枠は横長のまま起こす
        RegionRectifier.ChooseOutputSize(0.30, 0.10, 300 * 100, 900, out int w, out int h);
        Check("output keeps aspect (wide)", Math.Abs((double)w / h - 3.0), 0.05);

        // 縦長も同様
        RegionRectifier.ChooseOutputSize(0.10, 0.30, 100 * 300, 900, out w, out h);
        Check("output keeps aspect (tall)", Math.Abs((double)h / w - 3.0), 0.05);

        // 遠くの小さな枠を無理に拡大しない
        RegionRectifier.ChooseOutputSize(0.30, 0.20, 40 * 27, 900, out w, out h);
        Check("small quad is not upscaled past what was captured", w, 200);

        // 上限で頭打ち
        RegionRectifier.ChooseOutputSize(0.30, 0.20, 4000.0 * 2700.0, 900, out w, out h);
        Check("output is capped", w, 900);
    }


    // ==========================================================
    // 相対配置 (PlacementSolver)
    //
    // src/shared/placement.test.ts と同じ数値表。エディタのプレビュー (TS) と
    // ランタイム (C#) が別実装なので、同じ入力で同じ答えになることを両側で確かめる。
    // ==========================================================

    private static void CheckPlacement(
        string label, PlacementSide side, double gap, bool alignNear, int cross,
        PlacementBase basis, PlacementExtents extents,
        double expectedX, double expectedY, double expectedZ)
    {
        PlacementSolver.Resolve(side, gap, alignNear, cross, basis, extents,
            out double x, out double y, out double z);
        double error = Math.Abs(x - expectedX) + Math.Abs(y - expectedY) + Math.Abs(z - expectedZ);
        Check($"placement {label} -> ({x:F4}, {y:F4}, {z:F4})", error, 1e-9);
    }

    private static void TestPlacement()
    {
        // 30cm x 20cm のターゲット全体 / 10cm x 6cm x 2cm のオブジェクト
        var target = PlacementSolver.RegionToBase(0.30, 0.20, false, 0, 0, 0, 0);
        var obj = new PlacementExtents { HalfWidth = 0.05, HalfHeight = 0.03, HalfDepth = 0.01 };

        Check("whole target half width", Math.Abs(target.HalfWidth - 0.15), 1e-12);
        Check("whole target half height", Math.Abs(target.HalfHeight - 0.10), 1e-12);

        CheckPlacement("center ignores gap", PlacementSide.Center, 0.5, false, 0, target, obj, 0, 0, 0);
        CheckPlacement("right 10cm (centre)", PlacementSide.Right, 0.1, false, 0, target, obj, 0.25, 0, 0);
        CheckPlacement("right 10cm (edge to edge)", PlacementSide.Right, 0.1, true, 0, target, obj, 0.30, 0, 0);
        CheckPlacement("left mirrors right", PlacementSide.Left, 0.07, false, 0, target, obj, -0.22, 0, 0);
        CheckPlacement("above uses height", PlacementSide.Above, 0.02, false, 0, target, obj, 0, 0.12, 0);
        CheckPlacement("front measures from the surface", PlacementSide.Front, 0.1, false, 0, target, obj, 0, 0, 0.1);
        CheckPlacement("front (edge to edge) adds depth", PlacementSide.Front, 0.1, true, 0, target, obj, 0, 0, 0.11);
        CheckPlacement("behind mirrors front", PlacementSide.Behind, 0.1, false, 0, target, obj, 0, 0, -0.1);
        CheckPlacement("cross start bottom-aligns", PlacementSide.Right, 0, false, -1, target, obj, 0.15, -0.07, 0);
        CheckPlacement("cross end top-aligns", PlacementSide.Right, 0, false, 1, target, obj, 0.15, 0.07, 0);
        CheckPlacement("cross applies along X when above", PlacementSide.Above, 0, false, -1, target, obj, -0.10, 0.10, 0);
        CheckPlacement("cross does nothing for front", PlacementSide.Front, 0, false, -1, target, obj, 0, 0, 0);
        CheckPlacement("NaN gap is treated as zero", PlacementSide.Right, double.NaN, false, 0, target, obj, 0.15, 0, 0);
        CheckPlacement("unknown object size behaves as zero", PlacementSide.Right, 0.1, true, 0, target,
            new PlacementExtents(), 0.25, 0, 0);

        // 写真の右上 1/4 を基準にした場合
        var region = PlacementSolver.RegionToBase(0.30, 0.20, true, 0.5, 0.5, 0.5, 0.5);
        Check("region centre x", Math.Abs(region.CenterX - 0.075), 1e-12);
        Check("region centre y", Math.Abs(region.CenterY - 0.05), 1e-12);
        CheckPlacement("right of a region", PlacementSide.Right, 0.01, false, 0, region, obj, 0.16, 0.05, 0);

        // 中央にある領域は原点に戻る
        var centred = PlacementSolver.RegionToBase(0.30, 0.20, true, 0.25, 0.25, 0.5, 0.5);
        Check("centred region is at the origin", Math.Abs(centred.CenterX) + Math.Abs(centred.CenterY), 1e-12);
    }


    // ==========================================================
    // 特徴抽出 (FastDetector / OrbDescriptor / FeatureExtractor)
    //
    // 「参照写真から特徴が1つも取れない」は実機でしか気付けない壊れ方をするので、
    // ここで合成画像と実画像の両方について本数を確かめる。
    // ==========================================================

    /// <summary>ImageMagick で作った PGM (P5) を読む。PNG デコーダを持ち込まないため。</summary>
    private static GrayImage ReadPgm(string path)
    {
        using var stream = File.OpenRead(path);
        string ReadToken()
        {
            var sb = new System.Text.StringBuilder();
            int c;
            while ((c = stream.ReadByte()) >= 0)
            {
                if (c == '#') { while ((c = stream.ReadByte()) >= 0 && c != '\n') { } continue; }
                if (char.IsWhiteSpace((char)c)) { if (sb.Length > 0) break; continue; }
                sb.Append((char)c);
            }
            return sb.ToString();
        }

        if (ReadToken() != "P5") throw new InvalidDataException("not a binary PGM");
        int width = int.Parse(ReadToken());
        int height = int.Parse(ReadToken());
        ReadToken(); // maxval

        var image = new GrayImage(width, height);
        // PGM は上から下、GrayImage は下から上
        var row = new byte[width];
        for (int y = height - 1; y >= 0; y--)
        {
            int read = 0;
            while (read < width) read += stream.Read(row, read, width - read);
            Array.Copy(row, 0, image.Data, y * width, width);
        }
        return image;
    }

    /// <summary>写真らしい画像。細かい模様がたくさんある＝特徴が取れるはずのもの。</summary>
    private static GrayImage SyntheticTexture(int width, int height)
    {
        var image = new GrayImage(width, height);
        var rng = new Random(11);
        for (int i = 0; i < image.Data.Length; i++) image.Data[i] = 210;

        for (int i = 0; i < 220; i++)
        {
            int w = rng.Next(6, 24), h = rng.Next(6, 24);
            int x0 = rng.Next(0, width - w), y0 = rng.Next(0, height - h);
            byte v = (byte)rng.Next(10, 90);
            for (int y = y0; y < y0 + h; y++)
                for (int x = x0; x < x0 + w; x++)
                    image.Data[y * width + x] = v;
        }
        return image;
    }

    private static void TestFeatureExtraction()
    {
        var settings = new FeatureExtractorSettings();

        var flat = new GrayImage(400, 300);
        for (int i = 0; i < flat.Data.Length; i++) flat.Data[i] = 128;
        var none = FeatureExtractor.Extract(flat, settings);
        Console.WriteLine($"{(none.Count == 0 ? "PASS" : "FAIL")}  flat image yields no features: {none.Count}");
        if (none.Count != 0) _failures++;

        var textured = FeatureExtractor.Extract(SyntheticTexture(640, 480), settings);
        Console.WriteLine($"--- synthetic texture: {textured.Count} features");
        bool ok = textured.Count >= 200;
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  textured image yields plenty of features (>=200): {textured.Count}");
        if (!ok) _failures++;

        // 実画像があれば同じ尺度で測る（ARSIST_TEST_PGM に PGM のパス）
        var pgm = Environment.GetEnvironmentVariable("ARSIST_TEST_PGM");
        if (!string.IsNullOrEmpty(pgm) && File.Exists(pgm))
        {
            var image = ReadPgm(pgm);
            var features = FeatureExtractor.Extract(image, settings);
            var target = ReferenceTarget.Build("test", image, 0.25f, 0f, settings);
            Console.WriteLine($"--- {Path.GetFileName(pgm)} ({image.Width}x{image.Height}): " +
                              $"{features.Count} features, usable={target.IsUsable}");
        }
    }

    private static int Main()
    {
        Console.WriteLine("=== Arsist perception: planar pose numerical checks ===");

        TestHomographyExact();
        TestOrthonormalisation();

        // 正対、50cm。理想条件。
        RunCase("frontal 0.5m, no noise", Rot(0, 0, 0), 0, 0, 0.5, 0, 0, 11, 0.05, 0.5);

        // 斜め 35°、80cm。実際の使用に近い。
        RunCase("oblique 35deg 0.8m, no noise", Rot(0.61, 0.20, 0.1), 0.05, -0.02, 0.8, 0, 0, 12, 0.05, 0.5);

        // 0.5px のノイズ（サブピクセル検出の現実的な誤差）
        RunCase("oblique 35deg 0.8m, 0.5px noise", Rot(0.61, 0.20, 0.1), 0.05, -0.02, 0.8, 0.5, 0, 13, 1.5, 12);

        // 2m まで離れた、ほぼ正対の難しい条件（二重解を取り違えやすい）
        RunCase("near-frontal 2.0m, 0.5px noise", Rot(0.12, 0.05, 0), 0, 0, 2.0, 0.5, 0, 14, 6.0, 60);

        // 誤対応 25% 混入
        RunCase("oblique 0.8m, 25% outliers", Rot(0.61, 0.20, 0.1), 0.05, -0.02, 0.8, 0.3, 0.25, 15, 2.0, 15);

        Console.WriteLine("\n--- feature extraction ---");
        TestFeatureExtraction();

        Console.WriteLine("\n--- placement (mirrors src/shared/placement.test.ts) ---");
        TestPlacement();

        Console.WriteLine("\n--- region rectification ---");
        // 正対 / 斜め / かなり斜め
        TestRectifyRoundTrip("rectify frontal",
            new double[8] { 120, 100, 500, 100, 500, 380, 120, 380 }, 3.0);
        TestRectifyRoundTrip("rectify oblique",
            new double[8] { 140, 110, 520, 150, 495, 360, 165, 395 }, 4.0);
        TestRectifyRoundTrip("rectify strongly oblique",
            new double[8] { 90, 130, 540, 60, 560, 420, 110, 350 }, 6.0);
        TestRectifyRejections();
        TestOutputSizing();

        _failures += ClassicChecks.Run();
        _failures += PipelineChecks.Run();
        _failures += GyroChecks.Run();
        _failures += PhoneCameraChecks.Run();
        _failures += FramePacingChecks.Run();
        _failures += ModelChecks.Run();
        _failures += FrameBudgetChecks.Run();
        _failures += TemporalChecks.Run();
        _failures += InferenceChecks.Run();
        _failures += DataStoreChecks.Run();

        Console.WriteLine(_failures == 0 ? "\nALL CHECKS PASSED" : $"\n{_failures} CHECK(S) FAILED");
        return _failures == 0 ? 0 : 1;
    }
}
