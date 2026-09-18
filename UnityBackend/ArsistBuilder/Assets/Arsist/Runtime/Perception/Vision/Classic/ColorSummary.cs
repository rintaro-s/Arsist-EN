// ==============================================
// Arsist Engine - Perception / Vision / Classic
// 代表色を言葉にする
//
// 平均を取ると、赤と緑が混ざって灰色になるという嘘をつく。
// 色相のヒストグラムで一番多い山を採り、その山の中だけで平均する。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public static class ColorSummary
    {
        /// <param name="within">測る範囲。null なら画全体。</param>
        public static Dictionary<string, object> Describe(
            ColorImage image, MaskImage within, int minSaturation, int minValue)
        {
            var histogram = new int[360];
            int colorful = 0;
            int considered = 0;

            for (int i = 0, p = 0; i < image.PixelCount; i++, p += 3)
            {
                if (within != null && within.Data[i] == MaskImage.Off) continue;
                considered++;

                var hsv = ColorSpace.RgbToHsv(image.Data[p], image.Data[p + 1], image.Data[p + 2]);
                // 無彩色・暗すぎる画素は色相が当てにならない。
                if (hsv.S < minSaturation || hsv.V < minValue) continue;
                histogram[hsv.H]++;
                colorful++;
            }

            long sumR = 0, sumG = 0, sumB = 0;
            int count = 0;
            int dominantHue = -1;

            if (considered > 0 && colorful > considered / 20)
            {
                // 色相は環状なので、幅 30 度の窓を回して一番多いところを採る。
                int best = -1, bestStart = 0;
                for (int start = 0; start < 360; start++)
                {
                    int total = 0;
                    for (int k = 0; k < 30; k++) total += histogram[(start + k) % 360];
                    if (total > best) { best = total; bestStart = start; }
                }

                // 窓の中心をそのまま採ると、真っ赤のように色相が一点に固まった画で
                // 最大 15 度ずれ、赤がオレンジと呼ばれる。窓の中で重み付き平均を取る。
                double offset = 0;
                int weight = 0;
                for (int k = 0; k < 30; k++)
                {
                    int n = histogram[(bestStart + k) % 360];
                    offset += (double)k * n;
                    weight += n;
                }
                dominantHue = weight > 0
                    ? (int)Math.Round(bestStart + offset / weight) % 360
                    : (bestStart + 15) % 360;

                for (int i = 0, p = 0; i < image.PixelCount; i++, p += 3)
                {
                    if (within != null && within.Data[i] == MaskImage.Off) continue;
                    var hsv = ColorSpace.RgbToHsv(image.Data[p], image.Data[p + 1], image.Data[p + 2]);
                    if (hsv.S < minSaturation || hsv.V < minValue) continue;

                    int delta = Math.Abs(hsv.H - dominantHue);
                    if (delta > 180) delta = 360 - delta;
                    if (delta > 15) continue;

                    sumR += image.Data[p]; sumG += image.Data[p + 1]; sumB += image.Data[p + 2];
                    count++;
                }
            }

            if (count == 0)
            {
                // 有彩色が乏しい。素直に平均を返す（灰色や白黒の被写体）。
                for (int i = 0, p = 0; i < image.PixelCount; i++, p += 3)
                {
                    if (within != null && within.Data[i] == MaskImage.Off) continue;
                    sumR += image.Data[p]; sumG += image.Data[p + 1]; sumB += image.Data[p + 2];
                    count++;
                }
                if (count == 0) count = 1;
            }

            byte r = (byte)(sumR / count), g = (byte)(sumG / count), b = (byte)(sumB / count);
            var mean = ColorSpace.RgbToHsv(r, g, b);

            return new Dictionary<string, object>
            {
                ["r"] = (int)r,
                ["g"] = (int)g,
                ["b"] = (int)b,
                ["hex"] = $"#{r:X2}{g:X2}{b:X2}",
                ["hue"] = dominantHue >= 0 ? dominantHue : (int)mean.H,
                ["saturation"] = (int)mean.S,
                ["value"] = (int)mean.V,
                ["name"] = NameOf(mean, dominantHue),
            };
        }

        /// <summary>人が言う色の名前に落とす。UI にそのまま出せるようにするため。</summary>
        public static string NameOf(Hsv hsv, int dominantHue)
        {
            if (hsv.V < 45) return "black";
            if (hsv.S < 40) return hsv.V > 190 ? "white" : "gray";

            int hue = dominantHue >= 0 ? dominantHue : hsv.H;
            if (hue < 15 || hue >= 345) return "red";
            if (hue < 45) return "orange";
            if (hue < 70) return "yellow";
            if (hue < 160) return "green";
            if (hue < 200) return "cyan";
            if (hue < 260) return "blue";
            if (hue < 290) return "purple";
            return "magenta";
        }
    }
}
