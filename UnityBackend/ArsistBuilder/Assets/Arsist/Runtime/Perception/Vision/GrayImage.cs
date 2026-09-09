// ==============================================
// Arsist Engine - Perception / Vision
// 8bit グレースケール画像とスケールピラミッド
//
// 【行順の規約】この層を通る画像はすべて「下から上」に並ぶ。
//   index = y * Width + x, y = 0 が画像の一番下の行。
// Unity の Texture2D.GetPixels32 / AsyncGPUReadback / MRUK の
// PassthroughCameraAccess はいずれもこの順なので、変換を挟まない。
// カメラ内部パラメータ (cx, cy) も同じ座標系で保持する。
//
// このファイルは UnityEngine に依存しない（tools/perception-check から
// 素の .NET でテストできる状態を保つため）。Color32 からの変換など
// Unity 型が要るものは GrayImageUnity.cs に置いてある。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision
{
    /// <summary>8bit 1チャンネル画像。行は下から上。</summary>
    public sealed class GrayImage
    {
        public readonly byte[] Data;
        public readonly int Width;
        public readonly int Height;

        public GrayImage(int width, int height)
        {
            if (width <= 0 || height <= 0) throw new ArgumentException("invalid size");
            Width = width;
            Height = height;
            Data = new byte[width * height];
        }

        public GrayImage(byte[] data, int width, int height)
        {
            if (data == null || data.Length < width * height) throw new ArgumentException("buffer too small");
            Data = data;
            Width = width;
            Height = height;
        }

        public byte this[int x, int y] => Data[y * Width + x];

        /// <summary>3x3 の簡易ガウシアン (1-2-1) を分離型で適用する。FAST 前のノイズ抑制用。</summary>
        public GrayImage Blur()
        {
            var tmp = new byte[Width * Height];
            var outData = new byte[Width * Height];

            // 横方向
            for (int y = 0; y < Height; y++)
            {
                int row = y * Width;
                for (int x = 0; x < Width; x++)
                {
                    int xm = x > 0 ? x - 1 : 0;
                    int xp = x < Width - 1 ? x + 1 : Width - 1;
                    tmp[row + x] = (byte)((Data[row + xm] + 2 * Data[row + x] + Data[row + xp]) >> 2);
                }
            }
            // 縦方向
            for (int y = 0; y < Height; y++)
            {
                int ym = (y > 0 ? y - 1 : 0) * Width;
                int yc = y * Width;
                int yp = (y < Height - 1 ? y + 1 : Height - 1) * Width;
                for (int x = 0; x < Width; x++)
                {
                    outData[yc + x] = (byte)((tmp[ym + x] + 2 * tmp[yc + x] + tmp[yp + x]) >> 2);
                }
            }
            return new GrayImage(outData, Width, Height);
        }

        /// <summary>
        /// 任意倍率の縮小（bilinear）。
        /// ORB ピラミッドは 1/1.2 のような非整数倍率を使うのでバイリニアで実装する。
        /// </summary>
        public GrayImage Scaled(float scale)
        {
            int w = Math.Max(1, (int)Math.Round(Width * scale));
            int h = Math.Max(1, (int)Math.Round(Height * scale));
            var dst = new GrayImage(w, h);

            float invX = (float)Width / w;
            float invY = (float)Height / h;

            for (int y = 0; y < h; y++)
            {
                float sy = (y + 0.5f) * invY - 0.5f;
                int y0 = (int)Math.Floor(sy);
                float fy = sy - y0;
                int y0c = Clamp(y0, 0, Height - 1);
                int y1c = Clamp(y0 + 1, 0, Height - 1);
                int r0 = y0c * Width;
                int r1 = y1c * Width;
                int dr = y * w;

                for (int x = 0; x < w; x++)
                {
                    float sx = (x + 0.5f) * invX - 0.5f;
                    int x0 = (int)Math.Floor(sx);
                    float fx = sx - x0;
                    int x0c = Clamp(x0, 0, Width - 1);
                    int x1c = Clamp(x0 + 1, 0, Width - 1);

                    float a = Data[r0 + x0c] + (Data[r0 + x1c] - Data[r0 + x0c]) * fx;
                    float b = Data[r1 + x0c] + (Data[r1 + x1c] - Data[r1 + x0c]) * fx;
                    dst.Data[dr + x] = (byte)(a + (b - a) * fy + 0.5f);
                }
            }
            return dst;
        }

        private static int Clamp(int v, int lo, int hi) => v < lo ? lo : (v > hi ? hi : v);
    }

    /// <summary>ORB 用のスケールピラミッド。Level 0 が原寸。</summary>
    public sealed class ImagePyramid
    {
        public readonly GrayImage[] Levels;
        /// <summary>Levels[i] の座標に掛けると Level 0 の座標になる係数。</summary>
        public readonly float[] LevelToBase;

        public int Count => Levels.Length;

        public ImagePyramid(GrayImage baseImage, int levels, float scaleFactor)
        {
            if (levels < 1) levels = 1;
            Levels = new GrayImage[levels];
            LevelToBase = new float[levels];

            Levels[0] = baseImage;
            LevelToBase[0] = 1f;

            float cumulative = 1f;
            for (int i = 1; i < levels; i++)
            {
                cumulative /= scaleFactor;
                // 常に原寸から作る（多段縮小の誤差累積を避ける）
                Levels[i] = baseImage.Scaled(cumulative);
                // 実際に丸められたサイズから正確な係数を復元する
                LevelToBase[i] = (float)baseImage.Width / Levels[i].Width;
            }
        }
    }
}
