// ==============================================
// Arsist Engine - Perception / Vision / Classic
// 2値マスクと、しきい値・モルフォロジー
//
// 「どの画素が対象か」を表す 0/255 の1チャンネル画像。
// 色で拾う → ノイズを削る → 領域に分ける、という古典的な流れの土台。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    /// <summary>2値マスク。0 = 対象外、255 = 対象。行は下から上。</summary>
    public sealed class MaskImage
    {
        public readonly byte[] Data;
        public readonly int Width;
        public readonly int Height;

        public const byte On = 255;
        public const byte Off = 0;

        public MaskImage(int width, int height)
        {
            if (width <= 0 || height <= 0) throw new ArgumentException("invalid size");
            Width = width;
            Height = height;
            Data = new byte[width * height];
        }

        public bool this[int x, int y] => Data[y * Width + x] != Off;

        /// <summary>対象画素の数。</summary>
        public int Count()
        {
            int count = 0;
            foreach (var v in Data) if (v != Off) count++;
            return count;
        }

        /// <summary>対象画素の割合 (0..1)。</summary>
        public double Coverage() => (double)Count() / (Width * Height);

        public MaskImage Clone()
        {
            var copy = new MaskImage(Width, Height);
            Array.Copy(Data, copy.Data, Data.Length);
            return copy;
        }

        public GrayImage ToGray() => new GrayImage((byte[])Data.Clone(), Width, Height);
    }

    public static class Threshold
    {
        /// <summary>固定しきい値。value >= threshold を対象にする。</summary>
        public static MaskImage Fixed(GrayImage image, int threshold, bool invert = false)
        {
            var mask = new MaskImage(image.Width, image.Height);
            for (int i = 0; i < image.Data.Length; i++)
            {
                bool on = image.Data[i] >= threshold;
                mask.Data[i] = (on ^ invert) ? MaskImage.On : MaskImage.Off;
            }
            return mask;
        }

        /// <summary>
        /// 大津の二値化。輝度ヒストグラムのクラス間分散を最大にするしきい値を選ぶ。
        /// 明暗がはっきり二山に分かれる画像で、しきい値を決め打ちしなくて済む。
        /// </summary>
        public static int OtsuThreshold(GrayImage image)
        {
            var histogram = new int[256];
            foreach (var v in image.Data) histogram[v]++;

            int total = image.Data.Length;
            long sum = 0;
            for (int i = 0; i < 256; i++) sum += (long)i * histogram[i];

            long sumBackground = 0;
            int countBackground = 0;
            double best = -1;
            int bestThreshold = 0;

            for (int t = 0; t < 256; t++)
            {
                countBackground += histogram[t];
                if (countBackground == 0) continue;

                int countForeground = total - countBackground;
                if (countForeground == 0) break;

                sumBackground += (long)t * histogram[t];

                double meanBackground = (double)sumBackground / countBackground;
                double meanForeground = (double)(sum - sumBackground) / countForeground;
                double delta = meanBackground - meanForeground;
                double variance = (double)countBackground * countForeground * delta * delta;

                if (variance > best)
                {
                    best = variance;
                    bestThreshold = t;
                }
            }
            // 大津法が選ぶ t は「背景 = t 以下」を意味する。Fixed は value >= threshold なので、
            // そのまま渡すと背景まで前景に入る。前景の下限に直して返す。
            return Math.Min(255, bestThreshold + 1);
        }

        public static MaskImage Otsu(GrayImage image, bool invert = false)
        {
            return Fixed(image, OtsuThreshold(image), invert);
        }

        /// <summary>
        /// HSV の範囲で拾う。色で対象を選ぶときの基本手段。
        /// hueMin &gt; hueMax の場合は 0 度をまたぐ範囲（赤など）として扱う。
        /// </summary>
        public static MaskImage HsvRange(
            ColorImage image,
            int hueMin, int hueMax,
            int satMin, int satMax,
            int valMin, int valMax)
        {
            var mask = new MaskImage(image.Width, image.Height);
            bool wraps = hueMin > hueMax;

            for (int i = 0, p = 0; i < mask.Data.Length; i++, p += 3)
            {
                var hsv = ColorSpace.RgbToHsv(image.Data[p], image.Data[p + 1], image.Data[p + 2]);
                if (hsv.S < satMin || hsv.S > satMax) continue;
                if (hsv.V < valMin || hsv.V > valMax) continue;

                bool hueOk = wraps
                    ? (hsv.H >= hueMin || hsv.H <= hueMax)
                    : (hsv.H >= hueMin && hsv.H <= hueMax);
                if (hueOk) mask.Data[i] = MaskImage.On;
            }
            return mask;
        }
    }

    /// <summary>
    /// モルフォロジー。しきい値処理で出たマスクは、ぽつぽつした誤検出と穴だらけなのが普通で、
    /// これを掛けないと後段の領域分割がゴミだらけになる。
    /// </summary>
    public static class Morphology
    {
        public static MaskImage Erode(MaskImage mask, int radius = 1) => Apply(mask, radius, erode: true);
        public static MaskImage Dilate(MaskImage mask, int radius = 1) => Apply(mask, radius, erode: false);

        /// <summary>開く = 収縮→膨張。小さな点状のノイズを消す。</summary>
        public static MaskImage Open(MaskImage mask, int radius = 1)
            => Dilate(Erode(mask, radius), radius);

        /// <summary>閉じる = 膨張→収縮。小さな穴を埋める。</summary>
        public static MaskImage Close(MaskImage mask, int radius = 1)
            => Erode(Dilate(mask, radius), radius);

        /// <summary>
        /// 矩形カーネルで分離型に適用する。半径 r の 2 次元走査 (O(r²)) ではなく
        /// 横・縦の 2 パス (O(r)) にしてある。半径が大きいと効いてくる。
        /// </summary>
        private static MaskImage Apply(MaskImage mask, int radius, bool erode)
        {
            if (radius < 1) return mask.Clone();

            var horizontal = new MaskImage(mask.Width, mask.Height);
            var result = new MaskImage(mask.Width, mask.Height);
            byte hit = erode ? MaskImage.Off : MaskImage.On;
            byte miss = erode ? MaskImage.On : MaskImage.Off;

            for (int y = 0; y < mask.Height; y++)
            {
                int row = y * mask.Width;
                for (int x = 0; x < mask.Width; x++)
                {
                    byte value = miss;
                    int from = Math.Max(0, x - radius);
                    int to = Math.Min(mask.Width - 1, x + radius);
                    for (int k = from; k <= to; k++)
                    {
                        bool on = mask.Data[row + k] != MaskImage.Off;
                        // 収縮なら「1つでも消えていれば消える」、膨張なら「1つでも点いていれば点く」
                        if (on == !erode) { value = hit; break; }
                    }
                    horizontal.Data[row + x] = value;
                }
            }

            for (int y = 0; y < mask.Height; y++)
            {
                int from = Math.Max(0, y - radius);
                int to = Math.Min(mask.Height - 1, y + radius);
                for (int x = 0; x < mask.Width; x++)
                {
                    byte value = miss;
                    for (int k = from; k <= to; k++)
                    {
                        bool on = horizontal.Data[k * mask.Width + x] != MaskImage.Off;
                        if (on == !erode) { value = hit; break; }
                    }
                    result.Data[y * mask.Width + x] = value;
                }
            }
            return result;
        }
    }
}
