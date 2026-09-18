// スマホのジャイロ → カメラ回転の数値検証。
//
// 実機では「首を振ると逆に回る」「下を向くと空が映る」という形でしか分からないので、
// 端末の姿勢を合成して、カメラがどこを向くかを確かめる。
//
// ジャイロの姿勢は Android のセンサー座標 (右手系):
//   端末: +X = 画面の右, +Y = 画面の上, +Z = 画面から手前 (見ている人の方)
//   基準: 端末を平らに置き、画面が上、端末の上端が北を向いた状態が単位回転
using System;
using Arsist.Runtime.Tracking;

internal static class GyroChecks
{
    private static int _failures;

    private static void Expect(string label, bool ok, string detail = null)
    {
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}{(detail != null ? $": {detail}" : "")}");
        if (!ok) _failures++;
    }

    /// <summary>右手系のセンサー座標での回転 (軸と角度)。</summary>
    private static Quat Sensor(double ax, double ay, double az, double degrees) =>
        Quat.AxisAngle(ax, ay, az, degrees);

    private static string Vec(double x, double y, double z) => $"({x:F3},{y:F3},{z:F3})";

    public static int Run()
    {
        _failures = 0;
        Console.WriteLine("\n--- gyro: phone attitude -> camera ---");

        // 1. 平らに置いて画面が上 → 背面カメラは真下を向く。
        {
            var camera = GyroMath.DeviceToCamera(Quat.Identity, GyroScreenOrientation.Portrait);
            GyroMath.Forward(camera, out var x, out var y, out var z);
            Expect("a phone lying screen-up looks straight down", y < -0.999, Vec(x, y, z));
        }

        // 2. 縦持ちで画面をこちらに向けて立てる → 背面カメラは水平。
        //    平置きから端末の X 軸まわりに +90° 起こした姿勢。
        var upright = Sensor(1, 0, 0, 90);
        {
            var camera = GyroMath.DeviceToCamera(upright, GyroScreenOrientation.Portrait);
            GyroMath.Forward(camera, out var x, out var y, out var z);
            Expect("an upright phone looks at the horizon", Math.Abs(y) < 1e-6, Vec(x, y, z));

            // カメラの上は画面の上 = 空の方。逆だと映像が上下逆さまになる。
            GyroMath.Up(camera, out var ux, out var uy, out var uz);
            Expect("an upright phone keeps the sky up", uy > 0.999, Vec(ux, uy, uz));
        }

        // 3. 立てた端末の上端を奥へ 30° 倒す → カメラは 30° 上を見る。
        {
            var camera = GyroMath.DeviceToCamera(Sensor(1, 0, 0, 120), GyroScreenOrientation.Portrait);
            GyroMath.Forward(camera, out var x, out var y, out var z);
            Expect("tilting the top away looks up", Math.Abs(y - 0.5) < 1e-6, Vec(x, y, z));
        }

        // 4. 手前に 30° 倒す → カメラは 30° 下を見る。
        {
            var camera = GyroMath.DeviceToCamera(Sensor(1, 0, 0, 60), GyroScreenOrientation.Portrait);
            GyroMath.Forward(camera, out var x, out var y, out var z);
            Expect("tilting the top towards you looks down", Math.Abs(y + 0.5) < 1e-6, Vec(x, y, z));
        }

        // 5. 立てたまま左を向く (上から見て反時計回り = 世界の +Z 軸まわりに正) →
        //    カメラも左 (Unity では -X) へ回る。逆だと首を振った方向と逆に景色が流れる。
        {
            var before = GyroMath.DeviceToCamera(upright, GyroScreenOrientation.Portrait);
            var turned = GyroMath.DeviceToCamera(Sensor(0, 0, 1, 30) * upright, GyroScreenOrientation.Portrait);

            // 正面合わせをしてから比べる。方位の絶対値は端末ごとに違うので意味が無い。
            var recenter = GyroMath.RecenterFor(before);
            GyroMath.Forward(recenter * before, out var bx, out _, out var bz);
            GyroMath.Forward(recenter * turned, out var tx, out var ty, out var tz);

            Expect("before turning, recentring faces +Z", Math.Abs(bx) < 1e-6 && bz > 0.999, Vec(bx, 0, bz));
            Expect("turning left makes the camera turn left (-X)", tx < -0.49 && tx > -0.51,
                   Vec(tx, ty, tz));
        }

        // 6. 横持ち (左) の補正は、見ている方向を変えずに視線まわりに回すだけ。
        {
            var portrait = GyroMath.DeviceToCamera(upright, GyroScreenOrientation.Portrait);
            var landscape = GyroMath.DeviceToCamera(upright, GyroScreenOrientation.LandscapeLeft);
            GyroMath.Forward(portrait, out var px, out var py, out var pz);
            GyroMath.Forward(landscape, out var lx, out var ly, out var lz);
            double drift = Math.Abs(px - lx) + Math.Abs(py - ly) + Math.Abs(pz - lz);
            Expect("the landscape fix only rolls, it does not change where you look", drift < 1e-9,
                   $"drift {drift:E2}");
        }

        // 7. 横持ち (左) で持ったとき、画面の上が空を向くこと。
        //    横持ち左 = 縦持ちから端末を反時計回りに 90° 寝かせた (端末の +Z 軸まわりに +90°)。
        //    この補正の符号を間違えると、横持ちで映像が 180° ひっくり返る。
        {
            var landscapeHeld = upright * Sensor(0, 0, 1, 90);
            var camera = GyroMath.DeviceToCamera(landscapeHeld, GyroScreenOrientation.LandscapeLeft);
            GyroMath.Up(camera, out var ux, out var uy, out var uz);
            GyroMath.Forward(camera, out var fx, out var fy, out var fz);
            Expect("landscape-left keeps the sky at the top of the screen", uy > 0.999, Vec(ux, uy, uz));
            Expect("landscape-left still looks at the horizon", Math.Abs(fy) < 1e-6, Vec(fx, fy, fz));
        }

        // 8. 正面合わせは方位だけを打ち消し、上下の傾きは残すこと。
        //    傾きまで打ち消すと、下を向いたまま正面合わせしたときに地平線が傾く。
        {
            var lookingDown = GyroMath.DeviceToCamera(Sensor(1, 0, 0, 60), GyroScreenOrientation.Portrait);
            var recentered = GyroMath.RecenterFor(lookingDown) * lookingDown;
            GyroMath.Forward(recentered, out var x, out var y, out var z);
            Expect("recentring keeps the pitch", Math.Abs(y + 0.5) < 1e-6 && Math.Abs(x) < 1e-6,
                   Vec(x, y, z));
        }

        // 9. 真下を向いているときは方位が決まらないので、正面合わせは何もしない。
        {
            var down = GyroMath.DeviceToCamera(Quat.Identity, GyroScreenOrientation.Portrait);
            var recenter = GyroMath.RecenterFor(down);
            Expect("recentring while looking straight down is a no-op",
                   Math.Abs(recenter.W - 1) < 1e-9, $"w={recenter.W:F6}");
        }

        return _failures;
    }
}

internal static class PhoneCameraChecks
{
    private static int _failures;

    private static void Expect(string label, bool ok, string detail = null)
    {
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}{(detail != null ? $": {detail}" : "")}");
        if (!ok) _failures++;
    }

    public static int Run()
    {
        _failures = 0;
        Console.WriteLine("\n--- phone camera: rotation and field of view ---");

        Expect("0 degrees is no turn", PhoneCameraMath.QuarterTurns(0) == 0);
        Expect("90 degrees is one quarter turn", PhoneCameraMath.QuarterTurns(90) == 1);
        Expect("270 degrees is three", PhoneCameraMath.QuarterTurns(270) == 3);
        Expect("negative angles wrap", PhoneCameraMath.QuarterTurns(-90) == 3);

        PhoneCameraMath.RotatedSize(640, 480, 1, out int rw, out int rh);
        Expect("a quarter turn swaps width and height", rw == 480 && rh == 640, $"{rw}x{rh}");

        // 目印の画素がどこへ行くか。4x3 の画の「右下」(x=3, y=0) に印をつけ、
        // 時計回りに 90° 回したら、回した画の「左下」に来るはず。
        //   元 (下から上):          回した後 (幅 3, 高さ 4):
        //   y=2  . . . .            y=3  . . .
        //   y=1  . . . .            ...
        //   y=0  . . . X            y=0  X . .
        int width = 4, height = 3;
        int foundX = -1, foundY = -1;
        PhoneCameraMath.RotatedSize(width, height, 1, out int w1, out int h1);
        for (int y = 0; y < h1; y++)
            for (int x = 0; x < w1; x++)
            {
                PhoneCameraMath.SourceOf(x, y, width, height, 1, out int sx, out int sy);
                if (sx == 3 && sy == 0) { foundX = x; foundY = y; }
            }
        Expect("clockwise 90: bottom-right goes to bottom-left", foundX == 0 && foundY == 0,
               $"landed at ({foundX},{foundY})");

        // 同じく「左下」(0,0) は回した画の「左上」へ。
        foundX = foundY = -1;
        for (int y = 0; y < h1; y++)
            for (int x = 0; x < w1; x++)
            {
                PhoneCameraMath.SourceOf(x, y, width, height, 1, out int sx, out int sy);
                if (sx == 0 && sy == 0) { foundX = x; foundY = y; }
            }
        Expect("clockwise 90: bottom-left goes to top-left", foundX == 0 && foundY == h1 - 1,
               $"landed at ({foundX},{foundY})");

        // 4 回回すと元に戻ること (どれかの回転の式が崩れていると戻らない)。
        bool roundTrip = true;
        for (int y = 0; y < height && roundTrip; y++)
            for (int x = 0; x < width; x++)
            {
                int cx = x, cy = y, cw = width, ch = height;
                for (int turn = 0; turn < 4; turn++)
                {
                    // 回した画の (cx, cy) を元の座標へ戻す逆写像を、全画素探索で求める。
                    PhoneCameraMath.RotatedSize(cw, ch, 1, out int nw, out int nh);
                    int nx = -1, ny = -1;
                    for (int yy = 0; yy < nh && nx < 0; yy++)
                        for (int xx = 0; xx < nw; xx++)
                        {
                            PhoneCameraMath.SourceOf(xx, yy, cw, ch, 1, out int sx, out int sy);
                            if (sx == cx && sy == cy) { nx = xx; ny = yy; break; }
                        }
                    cx = nx; cy = ny; cw = nw; ch = nh;
                }
                if (cx != x || cy != y) { roundTrip = false; break; }
            }
        Expect("four quarter turns return every pixel home", roundTrip);

        // 画角: 映像と画面の縦横比が同じなら、縦の画角は映像そのものの縦の画角。
        //   横 60° の 16:9 映像 → 縦の画角 = 2 atan(tan30 * 9/16)
        double expected = 2 * Math.Atan(Math.Tan(30 * Math.PI / 180) * 9.0 / 16.0) * 180 / Math.PI;
        double same = PhoneCameraMath.VisibleVerticalFov(1280, 720, 60, 1920, 1080);
        Expect("matching aspect keeps the full vertical FOV", Math.Abs(same - expected) < 1e-9,
               $"{same:F4} vs {expected:F4}");

        // 画面の方が横長 (21:9) だと、映像は横に合わせて拡大され、上下が切れる。
        // 見えている縦の画角は、映像全体の縦の画角より狭くなるはず。
        double wide = PhoneCameraMath.VisibleVerticalFov(1280, 720, 60, 2520, 1080);
        Expect("a wider screen crops top and bottom, narrowing the FOV", wide < same - 1,
               $"{wide:F3} < {same:F3}");

        // 画面の方が縦長 (4:3) だと、上下はそのまま、左右が切れる。縦の画角は変わらない。
        double tall = PhoneCameraMath.VisibleVerticalFov(1280, 720, 60, 1440, 1080);
        Expect("a narrower screen crops the sides, keeping the vertical FOV",
               Math.Abs(tall - same) < 1e-9, $"{tall:F4} vs {same:F4}");

        TestOverlayLandsOnBackground();
        return _failures;
    }

    /// <summary>
    /// 端から端までの検証: カメラ画像のある画素が、
    ///   (a) 背景として画面いっぱいに拡大されて映る位置 と
    ///   (b) 画像処理の結果として 60m 先の板に貼られ、Unity カメラで写る位置
    /// で一致すること。一致しなければ、スマホで描いた青は映像の空からずれる。
    ///
    /// 実機の値 (XIG04 の画面 2712x1220、カメラ 1280x720、切り出し y 0.3..1.0、縮小 640) を使う。
    /// </summary>
    private static void TestOverlayLandsOnBackground()
    {
        int screenW = 2712, screenH = 1220;
        int camW = 1280, camH = 720;
        double hfov = 63;

        // (a) 背景: 中央に置いて、はみ出す方に合わせて拡大
        double fill = Math.Max((double)screenW / camW, (double)screenH / camH);

        // Unity カメラの画角は背景が決める
        double vfov = PhoneCameraMath.VisibleVerticalFov(camW, camH, hfov, screenW, screenH);
        double tanV = Math.Tan(vfov * Math.PI / 360.0);
        double tanH = tanV * screenW / screenH;

        // (b) 画像処理: ビューポート (0, 0.3, 1, 0.7) を切り出し、幅 640 に縮小
        double focal = PhoneCameraMath.FocalFromHorizontalFov(camW, hfov);
        var full = new Arsist.Runtime.Perception.Vision.CameraIntrinsics
        {
            Fx = focal, Fy = focal, Cx = (camW - 1) * 0.5, Cy = (camH - 1) * 0.5,
        };
        int cropX = 0, cropY = (int)Math.Round(0.3 * camH), cropW = camW;
        double scale = 640.0 / cropW;
        var k = Arsist.Runtime.Perception.Vision.ViewportMapping.ForCrop(full, cropX, cropY, scale);

        double worst = 0;
        foreach (var (pu, pv) in new[] { (0.0, 0.0), (320.0, 126.0), (639.0, 251.0), (600.0, 10.0), (15.0, 240.0) })
        {
            // (b) 板の上の点 → Unity カメラで画面へ
            double x = (pu - k.Cx) / k.Fx, y = (pv - k.Cy) / k.Fy;
            double bx = screenW * 0.5 + x / tanH * screenW * 0.5;
            double by = screenH * 0.5 + y / tanV * screenH * 0.5;

            // (a) 同じ点を元の画素として背景で映す位置
            double u = cropX + (pu + 0.5) / scale - 0.5;
            double v = cropY + (pv + 0.5) / scale - 0.5;
            double ax = screenW * 0.5 + (u + 0.5 - camW * 0.5) * fill;
            double ay = screenH * 0.5 + (v + 0.5 - camH * 0.5) * fill;

            worst = Math.Max(worst, Math.Max(Math.Abs(ax - bx), Math.Abs(ay - by)));
        }
        Expect("an overlaid pixel lands where the background shows it (phone, landscape)", worst < 0.5,
               $"worst {worst:F3} screen px");

        // 縦持ちでも同じこと。画面 1220x2712、カメラは 90° 回って 720x1280 として扱われる。
        {
            int sw = 1220, sh = 2712, w = 720, h = 1280;
            double f2 = Math.Max((double)sw / w, (double)sh / h);
            double v2 = PhoneCameraMath.VisibleVerticalFov(w, h, hfov, sw, sh);
            double tv = Math.Tan(v2 * Math.PI / 360.0), th = tv * sw / sh;
            double fo = PhoneCameraMath.FocalFromHorizontalFov(w, hfov);
            var kf = new Arsist.Runtime.Perception.Vision.CameraIntrinsics
            {
                Fx = fo, Fy = fo, Cx = (w - 1) * 0.5, Cy = (h - 1) * 0.5,
            };
            int cy = (int)Math.Round(0.3 * h);
            double sc = 480.0 / w;
            var k2 = Arsist.Runtime.Perception.Vision.ViewportMapping.ForCrop(kf, 0, cy, sc);

            double worstPortrait = 0;
            foreach (var (pu, pv) in new[] { (0.0, 0.0), (240.0, 300.0), (479.0, 670.0) })
            {
                double x = (pu - k2.Cx) / k2.Fx, y = (pv - k2.Cy) / k2.Fy;
                double bx = sw * 0.5 + x / th * sw * 0.5;
                double by = sh * 0.5 + y / tv * sh * 0.5;
                double u = (pu + 0.5) / sc - 0.5;
                double v = cy + (pv + 0.5) / sc - 0.5;
                double ax = sw * 0.5 + (u + 0.5 - w * 0.5) * f2;
                double ay = sh * 0.5 + (v + 0.5 - h * 0.5) * f2;
                worstPortrait = Math.Max(worstPortrait, Math.Max(Math.Abs(ax - bx), Math.Abs(ay - by)));
            }
            Expect("an overlaid pixel lands where the background shows it (phone, portrait)", worstPortrait < 0.5,
                   $"worst {worstPortrait:F3} screen px");
        }
    }
}

internal static class FramePacingChecks
{
    public static int Run()
    {
        int failures = 0;
        Console.WriteLine("\n--- phone: frame pacing ---");
        foreach (var (hz, expected) in new[] { (60.0, 60), (120.0, 60), (90.0, 90), (144.0, 72), (165.0, 82),
                                               (30.0, 30), (0.0, 60), (59.94, 60), (120.02, 60) })
        {
            int fps = FramePacing.TargetFor(hz);
            // 60 以上 (画面が 60 未満ならその上限)、かつリフレッシュレートをほぼ割り切ること。
            bool divides = hz <= 1 || Math.Abs(hz / fps - Math.Round(hz / fps)) < 0.02;
            bool ok = fps == expected && divides;
            Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {hz}Hz display -> {fps} fps (want {expected})");
            if (!ok) failures++;
        }
        return failures;
    }
}
