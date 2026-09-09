// ==============================================
// Arsist Engine - Perception / Vision
// GrayImage の Unity 型との橋渡し
//
// GrayImage 本体は UnityEngine 非依存に保ちたい（素の .NET でテストするため）。
// Color32 のような Unity 型を使う変換だけをここに分ける。
// ==============================================

using UnityEngine;

namespace Arsist.Runtime.Perception.Vision
{
    public static class GrayImageUnity
    {
        /// <summary>
        /// Color32 バッファをグレースケール化する。
        /// 係数は Rec.601 (0.299 / 0.587 / 0.114) を 16bit 固定小数で近似。
        /// </summary>
        /// <param name="flipVertically">
        /// 入力が上から下の場合に true。GrayImage の規約は下から上。
        /// </param>
        public static GrayImage FromColor32(Color32[] pixels, int width, int height, bool flipVertically = false)
        {
            var img = new GrayImage(width, height);
            var dst = img.Data;

            for (int y = 0; y < height; y++)
            {
                int src = (flipVertically ? (height - 1 - y) : y) * width;
                int row = y * width;
                for (int x = 0; x < width; x++)
                {
                    var c = pixels[src + x];
                    dst[row + x] = (byte)((c.r * 19595 + c.g * 38470 + c.b * 7471) >> 16);
                }
            }
            return img;
        }

        /// <summary>
        /// グレースケールを RGBA8888 に展開する。行順は上から下（Android の Bitmap 規約）。
        /// ここで反転するのは、Unity のテクスチャが下から上、Android の Bitmap が
        /// 上から下だから。忘れると「検出はされるが文字にならない」形で静かに失敗する。
        /// </summary>
        public static byte[] ToRgbaTopDown(GrayImage image)
        {
            int w = image.Width, h = image.Height;
            var rgba = new byte[w * h * 4];
            var src = image.Data;

            for (int y = 0; y < h; y++)
            {
                int srcRow = (h - 1 - y) * w;
                int dstRow = y * w * 4;
                for (int x = 0; x < w; x++)
                {
                    byte v = src[srcRow + x];
                    int o = dstRow + x * 4;
                    rgba[o] = v;
                    rgba[o + 1] = v;
                    rgba[o + 2] = v;
                    rgba[o + 3] = 255;
                }
            }
            return rgba;
        }
    }
}
