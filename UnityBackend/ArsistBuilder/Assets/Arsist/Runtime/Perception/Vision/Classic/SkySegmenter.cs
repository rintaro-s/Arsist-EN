// ==============================================
// Arsist Engine - Perception / Vision / Classic
// 空領域の抽出と塗り替え
//
// 学習モデルを使わない古典的な手法。空には次の性質があるので、これを順に使う:
//   1. 画像の上側にある
//   2. 平坦（雲があっても、建物や木に比べれば勾配がはるかに小さい）
//   3. 明るい
//   4. 列ごとに見ると、上から降りて最初にぶつかる強いエッジが空の境界になる
//
// 手順:
//   勾配を出す → 列ごとに境界を探す → 境界線をならす → 色で仕上げる
//
// 曇り空は「白くて平坦」なので 2 と 3 がよく効く。逆に、霧や白い壁が
// 画面いっぱいのときは境界が見つからず、素直に「空なし」を返す。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public sealed class SkySegmentation
    {
        public MaskImage Mask;
        /// <summary>列ごとの空の下端（行番号、下から上の座標系）。空が無い列は -1。</summary>
        public int[] Horizon;
        /// <summary>空と判定された画素の割合 (0..1)。</summary>
        public double Coverage;
        /// <summary>空領域の平均輝度。塗り替えで雲の濃淡を残すのに使う。</summary>
        public double MeanLuminance;
        /// <summary>空領域の平均勾配。空は平坦なので、これが大きい判定は信用できない。</summary>
        public double MeanGradient;
        /// <summary>実際に使った明るさのしきい値。暗い空で何が起きたかを追うため。</summary>
        public int MinBrightnessUsed;
        /// <summary>空領域の平均彩度。曇りか晴れかはここで分かれる（明るさでは分からない）。</summary>
        public double MeanSaturation;
        /// <summary>判定に使ったしきい値（Found の説明用に持っておく）。</summary>
        public double MinCoverage = 0.02;
        public double MaxGradient = 8.0;

        /// <summary>境界より下（地面側）の平均勾配。空の平坦さを相対的に見るための基準。</summary>
        public double MeanGroundGradient;
        /// <summary>地面の何倍まで平坦とみなすか。</summary>
        public double RelativeFlatness = 0.6;

        /// <summary>
        /// 空と呼べるだけの広さがあり、かつ十分に平坦か。
        ///
        /// 面積だけで見ると、細かい模様のある地面の上端がそのまま空に化ける。
        /// 空は平坦だという性質を最後にもう一度使って弾く。
        ///
        /// 平坦さは絶対値だけでは決められない。暗い場面ではセンサーノイズが乗って
        /// 空でも勾配が上がるので、そこで切ると夕方の空がまるごと落ちる。
        /// 地面よりはっきり平坦なら、絶対値が大きくても空とみなす。
        /// </summary>
        public bool Found =>
            Coverage > MinCoverage &&
            (MeanGradient <= MaxGradient ||
             (MeanGroundGradient > 0 && MeanGradient <= MeanGroundGradient * RelativeFlatness));
    }

    public sealed class SkySegmenterSettings
    {
        /// <summary>これを超える勾配を「空ではない何か」の縁とみなす。</summary>
        public int EdgeThreshold = 22;
        /// <summary>
        /// 明るさの下限。ただしこれは「一番厳しくてもここまで」という上限側の意味で、
        /// 実際のしきい値は候補領域の明るさから決める (AdaptiveBrightness)。
        /// 昼の空ではこの値がそのまま使われる。
        /// </summary>
        public int MinBrightness = 90;

        /// <summary>
        /// 明るさのしきい値を画像から決めるか。
        ///
        /// 固定の 90 だと、夕方や曇りの濃い日の「暗いが確かに空」がまるごと落ちる。
        /// 空かどうかを決めるのは絶対的な明るさではなく、地面より明るく、平坦で、
        /// 上にあること。なので候補領域自身の明るさを基準にする。
        /// </summary>
        public bool AdaptiveBrightness = true;

        /// <summary>
        /// 適応時でもこれ未満は空としない。真っ暗な壁まで空にしないための床。
        /// </summary>
        public int MinBrightnessFloor = 20;
        /// <summary>この彩度を超える画素は空とみなさない（曇天も晴天も彩度は高くない）。</summary>
        public int MaxSaturation = 140;
        /// <summary>境界線をならす窓の半径（列数）。大きいほど滑らかで、細い柱を無視する。</summary>
        public int HorizonSmoothing = 12;
        /// <summary>空は画像の上側にあるはず。下端がこの割合より下の列は捨てる。</summary>
        public double MaxHorizonRatio = 0.95;
        /// <summary>これ未満の面積しか取れなければ「空なし」とする。</summary>
        public double MinCoverage = 0.02;
        /// <summary>抽出した領域の平均勾配がこれを超えたら、空ではなく模様のある物体とみなす。</summary>
        public double MaxSkyGradient = 8.0;

        /// <summary>
        /// 絶対値の門を越えていても、地面のこの割合より平坦なら空と認める。
        /// 暗い場面のノイズで空を取りこぼさないため。
        ///
        /// 合成データでの実測: ノイズの乗った薄暗い空は 0.45、地面しか写っていない
        /// 誤検出の場合は 0.94。その間を取っている。
        /// </summary>
        public double RelativeFlatness = 0.6;
    }

    public static class SkySegmenter
    {
        /// <summary>空を抽出する。</summary>
        public static SkySegmentation Segment(ColorImage image, SkySegmenterSettings settings = null)
        {
            settings ??= new SkySegmenterSettings();

            var gray = image.ToGray();
            var field = EdgeDetector.Sobel(gray.Blur());
            int w = image.Width, h = image.Height;

            // --- 1. 列ごとに、上から降りて最初の強いエッジを探す ---
            // 行は下から上なので「上から」は y = h-1 から下る向き。
            var horizon = new int[w];
            int limit = (int)(h * (1.0 - settings.MaxHorizonRatio));

            for (int x = 0; x < w; x++)
            {
                horizon[x] = limit;
                // 最上行は Sobel の窓が画像外に出るため勾配が必ず 0 になる。そこから
                // 数え始めると、地面しか写っていない画像でも上端の 1 行が空に化ける。
                for (int y = h - 2; y >= limit; y--)
                {
                    int i = y * w + x;
                    if (field.Magnitude[i] >= settings.EdgeThreshold)
                    {
                        horizon[x] = y;
                        break;
                    }
                }
            }

            // --- 2. 境界線をならす ---
            // 木の枝や電線で1列だけ跳ね上がるのを、中央値で落ち着かせる。
            horizon = MedianSmooth(horizon, settings.HorizonSmoothing);

            // --- 3. 明るさのしきい値を決める ---
            int minBrightness = ResolveMinBrightness(gray, horizon, settings);

            // --- 4. 境界より上を候補にし、色で仕上げる ---
            var mask = new MaskImage(w, h);
            long sumLuminance = 0;
            long sumGradient = 0;
            long sumSaturation = 0;
            long sumGroundGradient = 0;
            int groundCount = 0;
            int count = 0;

            for (int x = 0; x < w; x++)
            {
                // 境界より下は地面。空の平坦さを比べる基準として勾配だけ集める。
                for (int y = 0; y <= horizon[x] && y < h; y++)
                {
                    sumGroundGradient += field.Magnitude[y * w + x];
                    groundCount++;
                }

                for (int y = horizon[x] + 1; y < h; y++)
                {
                    int i = y * w + x;
                    int p = i * 3;
                    var hsv = ColorSpace.RgbToHsv(image.Data[p], image.Data[p + 1], image.Data[p + 2]);

                    if (hsv.V < minBrightness) continue;
                    if (hsv.S > settings.MaxSaturation) continue;

                    mask.Data[i] = MaskImage.On;
                    sumLuminance += gray.Data[i];
                    sumGradient += field.Magnitude[i];
                    sumSaturation += hsv.S;
                    count++;
                }
            }

            // --- 5. 穴と欠けを整える ---
            // 電線や鳥で開いた小さな穴を埋め、外に飛んだ点を落とす。
            mask = Morphology.Close(mask, 2);
            mask = Morphology.Open(mask, 1);

            return new SkySegmentation
            {
                Mask = mask,
                Horizon = horizon,
                Coverage = (double)count / (w * h),
                MeanLuminance = count > 0 ? (double)sumLuminance / count : 0,
                MeanGradient = count > 0 ? (double)sumGradient / count : 0,
                MinBrightnessUsed = minBrightness,
                MeanSaturation = count > 0 ? (double)sumSaturation / count : 0,
                MeanGroundGradient = groundCount > 0 ? (double)sumGroundGradient / groundCount : 0,
                RelativeFlatness = settings.RelativeFlatness,
                MinCoverage = settings.MinCoverage,
                MaxGradient = settings.MaxSkyGradient,
            };
        }

        /// <summary>
        /// 明るさのしきい値を、境界より上の領域そのものから決める。
        ///
        /// 中央値の半分を採る。空は境界より上のほとんどを占めるので中央値はほぼ空の明るさで、
        /// その半分なら、雲の暗い側や地平線際の減光は残しつつ、紛れ込んだ暗い物体は落ちる。
        /// 昼の空では MinBrightness (既定 90) で頭打ちにして、従来の挙動をそのまま保つ。
        /// </summary>
        private static int ResolveMinBrightness(GrayImage gray, int[] horizon, SkySegmenterSettings settings)
        {
            if (!settings.AdaptiveBrightness) return settings.MinBrightness;

            int w = gray.Width, h = gray.Height;
            var histogram = new int[256];
            int total = 0;

            for (int x = 0; x < w; x++)
            {
                for (int y = horizon[x] + 1; y < h; y++)
                {
                    histogram[gray.Data[y * w + x]]++;
                    total++;
                }
            }
            if (total == 0) return settings.MinBrightness;

            int half = total / 2;
            int running = 0;
            int median = 255;
            for (int v = 0; v < 256; v++)
            {
                running += histogram[v];
                if (running > half) { median = v; break; }
            }

            int threshold = median / 2;
            if (threshold > settings.MinBrightness) threshold = settings.MinBrightness;
            if (threshold < settings.MinBrightnessFloor) threshold = settings.MinBrightnessFloor;
            return threshold;
        }

        /// <summary>窓内の中央値で平滑化する。外れ値に強いので境界線向き。</summary>
        private static int[] MedianSmooth(int[] values, int radius)
        {
            if (radius < 1) return values;

            var result = new int[values.Length];
            var window = new int[radius * 2 + 1];

            for (int i = 0; i < values.Length; i++)
            {
                int n = 0;
                for (int k = -radius; k <= radius; k++)
                {
                    int j = i + k;
                    if (j < 0 || j >= values.Length) continue;
                    window[n++] = values[j];
                }
                Array.Sort(window, 0, n);
                result[i] = window[n / 2];
            }
            return result;
        }

        /// <summary>
        /// 空を青く塗り替える。
        ///
        /// 一様な青で塗り潰すと「空を塗った」ようにしか見えないので、
        /// 元の輝度の揺らぎを残す。曇り空の雲がそのまま青空の雲になる。
        /// 上ほど濃く、地平線に近いほど淡くするのも、本物の空の見え方に合わせるため。
        /// </summary>
        /// <param name="strength">0 = 変えない、1 = 完全に置き換える。</param>
        public static ColorImage Repaint(
            ColorImage image, SkySegmentation sky, double strength = 1.0,
            byte zenithR = 32, byte zenithG = 96, byte zenithB = 210,
            byte horizonR = 158, byte horizonG = 200, byte horizonB = 242)
        {
            var result = image.Clone();
            if (sky?.Mask == null || !sky.Found) return result;

            int w = image.Width, h = image.Height;
            double meanLuminance = Math.Max(1.0, sky.MeanLuminance);
            strength = Math.Max(0, Math.Min(1, strength));

            for (int y = 0; y < h; y++)
            {
                // 空が写っている範囲の中での高さ。上端で 1、地平線で 0。
                double height = (double)y / Math.Max(1, h - 1);
                double t = Math.Max(0, Math.Min(1, (height - 0.35) / 0.65));

                byte baseR = (byte)(horizonR + (zenithR - horizonR) * t);
                byte baseG = (byte)(horizonG + (zenithG - horizonG) * t);
                byte baseB = (byte)(horizonB + (zenithB - horizonB) * t);

                for (int x = 0; x < w; x++)
                {
                    int i = y * w + x;
                    if (sky.Mask.Data[i] == MaskImage.Off) continue;

                    int p = i * 3;
                    // 元画素の輝度が平均よりどれだけ明るいか。雲はここに残る。
                    double luminance =
                        (image.Data[p] * 19595 + image.Data[p + 1] * 38470 + image.Data[p + 2] * 7471) / 65536.0;
                    double shade = 0.65 + 0.55 * (luminance / meanLuminance);
                    shade = Math.Max(0.4, Math.Min(1.6, shade));

                    result.Data[p] = Blend(image.Data[p], baseR * shade, strength);
                    result.Data[p + 1] = Blend(image.Data[p + 1], baseG * shade, strength);
                    result.Data[p + 2] = Blend(image.Data[p + 2], baseB * shade, strength);
                }
            }
            return result;
        }

        /// <summary>
        /// 現実に重ねるための RGBA を作る。空だけ不透明、それ以外は透明。
        ///
        /// パススルーの上に直接描くので、空でない画素は透明にしておかないと
        /// 建物や木まで青く塗り潰してしまう。マスクをそのまま alpha にすると
        /// 輪郭が階段状に見えるため、少しぼかして境界をなじませる。
        /// </summary>
        /// <param name="featherPasses">境界をぼかす回数。0 で切りっぱなし。</param>
        public static byte[] Compose(ColorImage painted, MaskImage mask, int featherPasses = 3)
        {
            if (painted == null || mask == null) return null;
            if (painted.Width != mask.Width || painted.Height != mask.Height) return null;

            // マスクを輝度画像に移してぼかす。GrayImage.Blur は 3x3 なので数回かける。
            var alpha = new GrayImage(mask.Width, mask.Height);
            Array.Copy(mask.Data, alpha.Data, mask.Data.Length);
            for (int i = 0; i < featherPasses; i++) alpha = alpha.Blur();

            var rgba = new byte[painted.PixelCount * 4];
            for (int i = 0, p = 0, q = 0; i < painted.PixelCount; i++, p += 3, q += 4)
            {
                rgba[q] = painted.Data[p];
                rgba[q + 1] = painted.Data[p + 1];
                rgba[q + 2] = painted.Data[p + 2];
                rgba[q + 3] = alpha.Data[i];
            }
            return rgba;
        }

        private static byte Blend(byte original, double target, double strength)
        {
            double value = original + (target - original) * strength;
            return (byte)(value < 0 ? 0 : (value > 255 ? 255 : value));
        }
    }
}
