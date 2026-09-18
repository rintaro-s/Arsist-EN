// ==============================================
// Arsist Engine - Perception / Vision / Classic
// マスクの中を塗り替える
//
// 一様な色で塗り潰すと「塗った」ようにしか見えないので、元の輝度の揺らぎを残す。
// 曇り空を青くすれば雲がそのまま残り、壁を塗り替えれば汚れや影が残る。
//
// 上下で色を変えられるようにしてあるのは、空のように「上ほど濃い」ものが
// 珍しくないため。同じ色を2つ渡せば単色になる。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public static class Recolor
    {
        /// <param name="topColor">画の上端で使う色 (#RRGGBB)。</param>
        /// <param name="bottomColor">下端で使う色。</param>
        /// <param name="strength">0 = 変えない、1 = 完全に置き換える。</param>
        /// <param name="preserveLuminance">元の明暗を残すか。切ると平板になる。</param>
        public static ColorImage Apply(
            ColorImage image, MaskImage mask,
            string topColor, string bottomColor,
            double strength, bool preserveLuminance)
        {
            var result = image.Clone();
            if (mask == null) return result;

            ParseHex(topColor, out byte topR, out byte topG, out byte topB);
            ParseHex(bottomColor, out byte bottomR, out byte bottomG, out byte bottomB);
            strength = Math.Max(0, Math.Min(1, strength));

            // 明暗を残すには基準が要る。マスク内の平均を「ちょうど中間の明るさ」とみなす。
            // 元が暗くても、出てくる色は基準どおりの明るさになる。
            double meanLuminance = 1.0;
            if (preserveLuminance)
            {
                long sum = 0;
                int count = 0;
                for (int i = 0, p = 0; i < image.PixelCount; i++, p += 3)
                {
                    if (mask.Data[i] == MaskImage.Off) continue;
                    sum += (long)Luminance(image.Data[p], image.Data[p + 1], image.Data[p + 2]);
                    count++;
                }
                meanLuminance = count > 0 ? Math.Max(1.0, (double)sum / count) : 1.0;
            }

            int w = image.Width, h = image.Height;
            for (int y = 0; y < h; y++)
            {
                double t = h > 1 ? (double)y / (h - 1) : 0;   // 0 = 下端, 1 = 上端
                byte baseR = (byte)(bottomR + (topR - bottomR) * t);
                byte baseG = (byte)(bottomG + (topG - bottomG) * t);
                byte baseB = (byte)(bottomB + (topB - bottomB) * t);

                for (int x = 0; x < w; x++)
                {
                    int i = y * w + x;
                    if (mask.Data[i] == MaskImage.Off) continue;

                    int p = i * 3;
                    double shade = 1.0;
                    if (preserveLuminance)
                    {
                        double luminance = Luminance(image.Data[p], image.Data[p + 1], image.Data[p + 2]);
                        shade = 0.65 + 0.55 * (luminance / meanLuminance);
                        shade = Math.Max(0.4, Math.Min(1.6, shade));
                    }

                    result.Data[p] = Blend(image.Data[p], baseR * shade, strength);
                    result.Data[p + 1] = Blend(image.Data[p + 1], baseG * shade, strength);
                    result.Data[p + 2] = Blend(image.Data[p + 2], baseB * shade, strength);
                }
            }
            return result;
        }

        private static double Luminance(byte r, byte g, byte b) =>
            (r * 19595 + g * 38470 + b * 7471) / 65536.0;

        private static byte Blend(byte original, double target, double strength)
        {
            double value = original + (target - original) * strength;
            return (byte)(value < 0 ? 0 : (value > 255 ? 255 : value));
        }

        /// <summary>"#RRGGBB" を読む。読めなければ灰色にして落とさない。</summary>
        public static void ParseHex(string hex, out byte r, out byte g, out byte b)
        {
            r = g = b = 128;
            if (string.IsNullOrEmpty(hex)) return;

            var text = hex.TrimStart('#');
            if (text.Length < 6) return;

            try
            {
                r = Convert.ToByte(text.Substring(0, 2), 16);
                g = Convert.ToByte(text.Substring(2, 2), 16);
                b = Convert.ToByte(text.Substring(4, 2), 16);
            }
            catch
            {
                r = g = b = 128;
            }
        }
    }
}
