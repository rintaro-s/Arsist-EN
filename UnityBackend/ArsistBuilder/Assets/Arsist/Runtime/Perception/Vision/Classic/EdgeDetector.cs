// ==============================================
// Arsist Engine - Perception / Vision / Classic
// 勾配とエッジ (Sobel / Canny)
//
// 「どこで何かが変わっているか」を出す。色で拾えないものを形で拾うための入口。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    /// <summary>勾配の強さと向き。</summary>
    public sealed class GradientField
    {
        /// <summary>勾配の大きさ。0-255 に丸めてある。</summary>
        public readonly byte[] Magnitude;
        /// <summary>勾配の向きを 0-3 に量子化したもの (0=横, 1=45度, 2=縦, 3=135度)。</summary>
        public readonly byte[] Direction;
        public readonly int Width;
        public readonly int Height;

        public GradientField(int width, int height)
        {
            Width = width;
            Height = height;
            Magnitude = new byte[width * height];
            Direction = new byte[width * height];
        }

        public GrayImage MagnitudeImage() => new GrayImage((byte[])Magnitude.Clone(), Width, Height);
    }

    public static class EdgeDetector
    {
        /// <summary>Sobel で勾配を求める。外周1画素は 0 のまま。</summary>
        public static GradientField Sobel(GrayImage image)
        {
            var field = new GradientField(image.Width, image.Height);
            int w = image.Width, h = image.Height;
            var src = image.Data;

            for (int y = 1; y < h - 1; y++)
            {
                int row = y * w;
                for (int x = 1; x < w - 1; x++)
                {
                    int i = row + x;

                    int gx = -src[i - w - 1] + src[i - w + 1]
                             - 2 * src[i - 1] + 2 * src[i + 1]
                             - src[i + w - 1] + src[i + w + 1];

                    int gy = -src[i - w - 1] - 2 * src[i - w] - src[i - w + 1]
                             + src[i + w - 1] + 2 * src[i + w] + src[i + w + 1];

                    // sqrt を避けて |gx|+|gy| で近似する。エッジの有無を見るには十分で、
                    // 毎画素の平方根はモバイルでは無視できない負荷になる。
                    int magnitude = (Math.Abs(gx) + Math.Abs(gy)) >> 2;
                    field.Magnitude[i] = (byte)(magnitude > 255 ? 255 : magnitude);
                    field.Direction[i] = QuantiseDirection(gx, gy);
                }
            }
            return field;
        }

        /// <summary>
        /// 勾配の向きを 4 方向に量子化する（非極大抑制で使う）。
        /// 0 = 横 / 1 = 45度 / 2 = 縦 / 3 = 135度。
        /// 境目は tan(22.5°) ≈ 0.4142 と tan(67.5°) ≈ 2.4142。
        /// </summary>
        private static byte QuantiseDirection(int gx, int gy)
        {
            int ax = Math.Abs(gx), ay = Math.Abs(gy);
            if (ax == 0) return 2;
            if (ay == 0) return 0;

            double ratio = (double)ay / ax;
            if (ratio < 0.4142) return 0;
            if (ratio > 2.4142) return 2;
            return (gx > 0) == (gy > 0) ? (byte)1 : (byte)3;
        }

        /// <summary>
        /// Canny。ぼかし → Sobel → 非極大抑制 → ヒステリシスしきい値。
        /// 出るのは「細い線」のマスクで、Sobel をそのまま二値化したものより後段が楽になる。
        /// </summary>
        public static MaskImage Canny(GrayImage image, int lowThreshold = 40, int highThreshold = 90)
        {
            var blurred = image.Blur();
            var field = Sobel(blurred);
            int w = field.Width, h = field.Height;

            // 非極大抑制: 勾配方向に見て極大でない画素を落とす
            var thin = new byte[w * h];
            for (int y = 1; y < h - 1; y++)
            {
                int row = y * w;
                for (int x = 1; x < w - 1; x++)
                {
                    int i = row + x;
                    int m = field.Magnitude[i];
                    if (m < lowThreshold) continue;

                    int a, b;
                    switch (field.Direction[i])
                    {
                        case 0: a = field.Magnitude[i - 1]; b = field.Magnitude[i + 1]; break;
                        case 1: a = field.Magnitude[i - w - 1]; b = field.Magnitude[i + w + 1]; break;
                        case 2: a = field.Magnitude[i - w]; b = field.Magnitude[i + w]; break;
                        default: a = field.Magnitude[i - w + 1]; b = field.Magnitude[i + w - 1]; break;
                    }
                    if (m >= a && m >= b) thin[i] = (byte)m;
                }
            }

            // ヒステリシス: 強い画素から辿れる弱い画素だけを残す
            var mask = new MaskImage(w, h);
            var stack = new System.Collections.Generic.Stack<int>();

            for (int i = 0; i < thin.Length; i++)
            {
                if (thin[i] >= highThreshold && mask.Data[i] == MaskImage.Off)
                {
                    mask.Data[i] = MaskImage.On;
                    stack.Push(i);
                }
            }

            while (stack.Count > 0)
            {
                int i = stack.Pop();
                int x = i % w, y = i / w;

                for (int dy = -1; dy <= 1; dy++)
                {
                    int ny = y + dy;
                    if (ny < 0 || ny >= h) continue;
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        int nx = x + dx;
                        if (nx < 0 || nx >= w) continue;
                        int n = ny * w + nx;
                        if (mask.Data[n] != MaskImage.Off) continue;
                        if (thin[n] < lowThreshold) continue;
                        mask.Data[n] = MaskImage.On;
                        stack.Push(n);
                    }
                }
            }

            return mask;
        }
    }
}
