// ==============================================
// Arsist Engine - Perception / Vision / Classic
// 画とマスクから、重ねて描くための RGBA を作る
//
// 現実の上に描くには「どこを描かないか」が要る。マスクをそのまま alpha にすると
// 輪郭が階段状に見えるので、少しぼかして境界をなじませる。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public static class Composite
    {
        /// <param name="featherPasses">境界をぼかす回数。0 で切りっぱなし。</param>
        public static byte[] ToRgba(ColorImage image, MaskImage alpha, int featherPasses = 3)
        {
            if (image == null) return null;

            byte[] alphaData;
            if (alpha == null)
            {
                // マスクが無ければ全面不透明。
                alphaData = new byte[image.PixelCount];
                for (int i = 0; i < alphaData.Length; i++) alphaData[i] = 255;
            }
            else
            {
                if (image.Width != alpha.Width || image.Height != alpha.Height) return null;

                var soft = new GrayImage(alpha.Width, alpha.Height);
                Array.Copy(alpha.Data, soft.Data, alpha.Data.Length);
                for (int i = 0; i < featherPasses; i++) soft = soft.Blur();
                alphaData = soft.Data;
            }

            var rgba = new byte[image.PixelCount * 4];
            for (int i = 0, p = 0, q = 0; i < image.PixelCount; i++, p += 3, q += 4)
            {
                rgba[q] = image.Data[p];
                rgba[q + 1] = image.Data[p + 1];
                rgba[q + 2] = image.Data[p + 2];
                rgba[q + 3] = alphaData[i];
            }
            return rgba;
        }
    }
}
