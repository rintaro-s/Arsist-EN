// ==============================================
// Arsist Engine - Perception / Vision / Classic
// ColorImage と Unity の型の橋渡し
//
// ColorImage 側を UnityEngine から切り離しておくと、tools/perception-check で
// 素の .NET のまま数値検証できる。Unity に触る部分だけをここに置く。
// ==============================================

using UnityEngine;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public static class ColorImageUnity
    {
        /// <summary>Color32 の配列から作る。GetPixels32 は左下原点なので通常は反転不要。</summary>
        public static ColorImage FromColor32(Color32[] pixels, int width, int height, bool flipVertically = false)
        {
            var image = new ColorImage(width, height);
            for (int y = 0; y < height; y++)
            {
                int sourceRow = (flipVertically ? height - 1 - y : y) * width;
                int targetRow = y * width * 3;
                for (int x = 0; x < width; x++)
                {
                    var c = pixels[sourceRow + x];
                    int p = targetRow + x * 3;
                    image.Data[p] = c.r;
                    image.Data[p + 1] = c.g;
                    image.Data[p + 2] = c.b;
                }
            }
            return image;
        }

        /// <summary>Texture2D (RGBA32) に書き戻す。Apply は呼び出し側で行う。</summary>
        public static void WriteTo(ColorImage image, Texture2D texture)
        {
            var pixels = new Color32[image.PixelCount];
            for (int i = 0, p = 0; i < pixels.Length; i++, p += 3)
            {
                pixels[i] = new Color32(image.Data[p], image.Data[p + 1], image.Data[p + 2], 255);
            }
            texture.SetPixels32(pixels);
        }

        /// <summary>マスクを可視化する（デバッグ用）。</summary>
        public static Texture2D DebugTexture(MaskImage mask)
        {
            var texture = new Texture2D(mask.Width, mask.Height, TextureFormat.RGBA32, false);
            var pixels = new Color32[mask.Data.Length];
            for (int i = 0; i < pixels.Length; i++)
            {
                byte v = mask.Data[i];
                pixels[i] = new Color32(v, v, v, 255);
            }
            texture.SetPixels32(pixels);
            texture.Apply();
            return texture;
        }
    }
}
