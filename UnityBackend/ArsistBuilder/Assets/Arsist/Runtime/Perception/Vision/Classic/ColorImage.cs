// ==============================================
// Arsist Engine - Perception / Vision / Classic
// カラー画像と色空間
//
// GrayImage と同じ規約: 行は下から上 (index = y * Width + x)。
// UnityEngine には依存しない（tools/perception-check から素の .NET で検証するため）。
//
// 保持は RGB24。カメラからは RGBA で来るが、アルファは使わないので詰めて持つ
// (1280x960 で 1.2MB 差。毎フレーム確保する場所なので効く)。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    /// <summary>8bit RGB 画像。行は下から上。</summary>
    public sealed class ColorImage
    {
        /// <summary>RGB が 3 バイトずつ。長さ = Width * Height * 3。</summary>
        public readonly byte[] Data;
        public readonly int Width;
        public readonly int Height;

        public ColorImage(int width, int height)
        {
            if (width <= 0 || height <= 0) throw new ArgumentException("invalid size");
            Width = width;
            Height = height;
            Data = new byte[width * height * 3];
        }

        public ColorImage(byte[] data, int width, int height)
        {
            if (data == null || data.Length < width * height * 3) throw new ArgumentException("buffer too small");
            Data = data;
            Width = width;
            Height = height;
        }

        public int PixelCount => Width * Height;

        public void Get(int x, int y, out byte r, out byte g, out byte b)
        {
            int i = (y * Width + x) * 3;
            r = Data[i]; g = Data[i + 1]; b = Data[i + 2];
        }

        public void Set(int x, int y, byte r, byte g, byte b)
        {
            int i = (y * Width + x) * 3;
            Data[i] = r; Data[i + 1] = g; Data[i + 2] = b;
        }

        /// <summary>RGBA バッファから作る。flipVertically は「入力が上から下」のとき。</summary>
        public static ColorImage FromRgba(byte[] rgba, int width, int height, bool flipVertically = false)
        {
            var image = new ColorImage(width, height);
            var dst = image.Data;

            for (int y = 0; y < height; y++)
            {
                int srcRow = (flipVertically ? (height - 1 - y) : y) * width * 4;
                int dstRow = y * width * 3;
                for (int x = 0; x < width; x++)
                {
                    int s = srcRow + x * 4;
                    int d = dstRow + x * 3;
                    dst[d] = rgba[s];
                    dst[d + 1] = rgba[s + 1];
                    dst[d + 2] = rgba[s + 2];
                }
            }
            return image;
        }

        /// <summary>RGBA8888 に展開する。flipVertically は「出力を上から下にする」とき。</summary>
        public byte[] ToRgba(bool flipVertically = false)
        {
            var rgba = new byte[Width * Height * 4];
            for (int y = 0; y < Height; y++)
            {
                int srcRow = y * Width * 3;
                int dstRow = (flipVertically ? (Height - 1 - y) : y) * Width * 4;
                for (int x = 0; x < Width; x++)
                {
                    int s = srcRow + x * 3;
                    int d = dstRow + x * 4;
                    rgba[d] = Data[s];
                    rgba[d + 1] = Data[s + 1];
                    rgba[d + 2] = Data[s + 2];
                    rgba[d + 3] = 255;
                }
            }
            return rgba;
        }

        /// <summary>Rec.601 の輝度でグレースケール化する（GrayImage と同じ係数）。</summary>
        public GrayImage ToGray()
        {
            var gray = new GrayImage(Width, Height);
            for (int i = 0, p = 0; i < gray.Data.Length; i++, p += 3)
            {
                gray.Data[i] = (byte)((Data[p] * 19595 + Data[p + 1] * 38470 + Data[p + 2] * 7471) >> 16);
            }
            return gray;
        }

        /// <summary>
        /// 1 チャンネルを GrayImage として取り出す。
        /// 正対化 (RegionRectifier) は輝度用に書かれているので、色を通したいときは
        /// チャンネルごとに掛けてから Combine で戻す。
        /// </summary>
        public GrayImage Channel(int index)
        {
            if (index < 0 || index > 2) throw new ArgumentOutOfRangeException(nameof(index));
            var channel = new GrayImage(Width, Height);
            for (int i = 0, p = index; i < channel.Data.Length; i++, p += 3)
            {
                channel.Data[i] = Data[p];
            }
            return channel;
        }

        /// <summary>Channel で分けた3枚を1枚に戻す。</summary>
        public static ColorImage Combine(GrayImage r, GrayImage g, GrayImage b)
        {
            if (r == null || g == null || b == null) return null;
            if (r.Width != g.Width || r.Width != b.Width || r.Height != g.Height || r.Height != b.Height)
                throw new ArgumentException("channels must have the same size");

            var image = new ColorImage(r.Width, r.Height);
            for (int i = 0, p = 0; i < r.Data.Length; i++, p += 3)
            {
                image.Data[p] = r.Data[i];
                image.Data[p + 1] = g.Data[i];
                image.Data[p + 2] = b.Data[i];
            }
            return image;
        }

        public ColorImage Clone()
        {
            return new ColorImage((byte[])Data.Clone(), Width, Height);
        }

        /// <summary>
        /// 指定の大きさにする (拡大も縮小も)。学習済みモデルの入力を作るときに使う。
        /// 双一次補間。縮小率が大きいときは画素を飛ばすことになるが、モデルの入力
        /// (224〜640px) に対しては十分。同じ大きさなら自分を返す。
        /// </summary>
        public ColorImage ScaledTo(int width, int height)
        {
            if (width <= 0 || height <= 0) throw new ArgumentException("invalid size");
            if (width == Width && height == Height) return this;

            var dst = new ColorImage(width, height);
            double sx = (double)Width / width;
            double sy = (double)Height / height;

            for (int y = 0; y < height; y++)
            {
                double fy = (y + 0.5) * sy - 0.5;
                int y0 = (int)Math.Floor(fy);
                double wy = fy - y0;
                int y1 = Math.Min(Height - 1, Math.Max(0, y0 + 1));
                y0 = Math.Min(Height - 1, Math.Max(0, y0));

                for (int x = 0; x < width; x++)
                {
                    double fx = (x + 0.5) * sx - 0.5;
                    int x0 = (int)Math.Floor(fx);
                    double wx = fx - x0;
                    int x1 = Math.Min(Width - 1, Math.Max(0, x0 + 1));
                    x0 = Math.Min(Width - 1, Math.Max(0, x0));

                    int p00 = (y0 * Width + x0) * 3, p01 = (y0 * Width + x1) * 3;
                    int p10 = (y1 * Width + x0) * 3, p11 = (y1 * Width + x1) * 3;
                    int d = (y * width + x) * 3;
                    for (int c = 0; c < 3; c++)
                    {
                        double top = Data[p00 + c] * (1 - wx) + Data[p01 + c] * wx;
                        double bottom = Data[p10 + c] * (1 - wx) + Data[p11 + c] * wx;
                        dst.Data[d + c] = (byte)Math.Round(top * (1 - wy) + bottom * wy);
                    }
                }
            }
            return dst;
        }

        /// <summary>最大幅に収まるよう縮小する（超えていなければ自分を返す）。</summary>
        public ColorImage ScaledToWidth(int maxWidth)
        {
            if (Width <= maxWidth) return this;

            double scale = (double)maxWidth / Width;
            int w = Math.Max(1, (int)Math.Round(Width * scale));
            int h = Math.Max(1, (int)Math.Round(Height * scale));
            var dst = new ColorImage(w, h);

            double invX = (double)Width / w;
            double invY = (double)Height / h;

            for (int y = 0; y < h; y++)
            {
                int sy = Math.Min(Height - 1, (int)((y + 0.5) * invY));
                for (int x = 0; x < w; x++)
                {
                    int sx = Math.Min(Width - 1, (int)((x + 0.5) * invX));
                    int s = (sy * Width + sx) * 3;
                    int d = (y * w + x) * 3;
                    dst.Data[d] = Data[s];
                    dst.Data[d + 1] = Data[s + 1];
                    dst.Data[d + 2] = Data[s + 2];
                }
            }
            return dst;
        }
    }

    /// <summary>HSV の1画素。H は 0-359 度、S と V は 0-255。</summary>
    public struct Hsv
    {
        public short H;
        public byte S;
        public byte V;
    }

    public static class ColorSpace
    {
        /// <summary>
        /// RGB → HSV。整数演算のみ。
        /// H は 0..359 度、S/V は 0..255（OpenCV の 0..180 ではなく素直な度数にしてある）。
        /// </summary>
        public static Hsv RgbToHsv(byte r, byte g, byte b)
        {
            int max = r > g ? (r > b ? r : b) : (g > b ? g : b);
            int min = r < g ? (r < b ? r : b) : (g < b ? g : b);
            int delta = max - min;

            var hsv = new Hsv { V = (byte)max, S = (byte)(max == 0 ? 0 : delta * 255 / max) };

            if (delta == 0)
            {
                hsv.H = 0;
                return hsv;
            }

            int hue;
            if (max == r) hue = 60 * (g - b) / delta;
            else if (max == g) hue = 120 + 60 * (b - r) / delta;
            else hue = 240 + 60 * (r - g) / delta;

            if (hue < 0) hue += 360;
            hsv.H = (short)hue;
            return hsv;
        }

        /// <summary>HSV → RGB。H は 0..359、S/V は 0..255。</summary>
        public static void HsvToRgb(int h, int s, int v, out byte r, out byte g, out byte b)
        {
            if (s == 0)
            {
                r = g = b = (byte)v;
                return;
            }

            h = ((h % 360) + 360) % 360;
            int sector = h / 60;
            int offset = h % 60;

            int p = v * (255 - s) / 255;
            int q = v * (255 - s * offset / 60) / 255;
            int t = v * (255 - s * (60 - offset) / 60) / 255;

            switch (sector)
            {
                case 0: r = (byte)v; g = (byte)t; b = (byte)p; break;
                case 1: r = (byte)q; g = (byte)v; b = (byte)p; break;
                case 2: r = (byte)p; g = (byte)v; b = (byte)t; break;
                case 3: r = (byte)p; g = (byte)q; b = (byte)v; break;
                case 4: r = (byte)t; g = (byte)p; b = (byte)v; break;
                default: r = (byte)v; g = (byte)p; b = (byte)q; break;
            }
        }
    }
}
