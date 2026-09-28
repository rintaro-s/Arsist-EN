// ==============================================
// Arsist Engine - Perception / Vision / Classic
// 見つけた物の枠を画に描く
//
// 検出の結果を現実に重ねるときの一番簡単な形。箱の線だけを描く (文字は描かない。
// フォントを持たない層なので、文字は anchor 出力のラベルか UI の bind に任せる)。
//
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public static class Annotate
    {
        /// <summary>
        /// items (x, y, width, height は正規化、原点左下) の枠を image の写しに描いて返す。
        /// mask には描いた画素を 255 で返す (world 出力の alpha にそのまま使える)。
        /// </summary>
        public static ColorImage Boxes(ColorImage image, List<object> items, string hex, int thickness, out MaskImage mask)
        {
            var output = image.Clone();
            mask = new MaskImage(image.Width, image.Height);
            Recolor.ParseHex(hex, out byte r, out byte g, out byte b);
            int t = Math.Max(1, Math.Min(16, thickness));

            foreach (var raw in items ?? new List<object>())
            {
                if (!(raw is Dictionary<string, object> item)) continue;
                double cx = Tracker.Number(item, "x") * image.Width;
                double cy = Tracker.Number(item, "y") * image.Height;
                double w = Tracker.Number(item, "width") * image.Width;
                double h = Tracker.Number(item, "height") * image.Height;
                int x0 = (int)Math.Round(cx - w / 2), x1 = (int)Math.Round(cx + w / 2);
                int y0 = (int)Math.Round(cy - h / 2), y1 = (int)Math.Round(cy + h / 2);
                Rect(output, mask, x0, y0, x1, y1, t, r, g, b);
            }
            return output;
        }

        private static void Rect(ColorImage img, MaskImage mask, int x0, int y0, int x1, int y1, int t, byte r, byte g, byte b)
        {
            x0 = Math.Max(0, Math.Min(img.Width - 1, x0));
            x1 = Math.Max(0, Math.Min(img.Width - 1, x1));
            y0 = Math.Max(0, Math.Min(img.Height - 1, y0));
            y1 = Math.Max(0, Math.Min(img.Height - 1, y1));
            if (x1 < x0) (x0, x1) = (x1, x0);
            if (y1 < y0) (y0, y1) = (y1, y0);

            for (int y = y0; y <= y1; y++)
            {
                for (int x = x0; x <= x1; x++)
                {
                    bool edge = x - x0 < t || x1 - x < t || y - y0 < t || y1 - y < t;
                    if (!edge) continue;
                    img.Set(x, y, r, g, b);
                    mask.Data[y * img.Width + x] = MaskImage.On;
                }
            }
        }
    }
}
