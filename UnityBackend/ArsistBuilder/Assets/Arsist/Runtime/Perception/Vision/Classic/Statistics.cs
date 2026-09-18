// ==============================================
// Arsist Engine - Perception / Vision / Classic
// マスクした領域の統計
//
// 「見つけた」で終わらせず、確からしさを数で持つための道具。
// マスクの中と外を両方測るのが肝で、「周りと比べてどうか」が言えるようになる。
// 絶対値だけで判断すると、明るさや粗さが変わっただけで破綻する。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public static class Statistics
    {
        /// <summary>
        /// マスクの面積比と、マスクの中・外それぞれの平均を返す。
        /// </summary>
        /// <param name="sample">平均を取る対象。null なら面積比だけ。</param>
        public static Dictionary<string, object> Describe(MaskImage mask, GrayImage sample)
        {
            var record = new Dictionary<string, object>();
            if (mask == null) return record;

            long inside = 0, outside = 0;
            long insideSum = 0, outsideSum = 0;

            for (int i = 0; i < mask.Data.Length; i++)
            {
                bool on = mask.Data[i] != MaskImage.Off;
                int value = sample != null ? sample.Data[i] : 0;

                if (on) { inside++; insideSum += value; }
                else { outside++; outsideSum += value; }
            }

            record["coverage"] = Math.Round((double)inside / Math.Max(1, mask.Data.Length), 4);
            record["area"] = (int)inside;

            if (sample != null)
            {
                double meanInside = inside > 0 ? (double)insideSum / inside : 0;
                double meanOutside = outside > 0 ? (double)outsideSum / outside : 0;
                record["mean"] = Math.Round(meanInside, 3);
                record["meanOutside"] = Math.Round(meanOutside, 3);
                // 「周りと比べて」を一発で書けるように比も出しておく。
                record["ratio"] = Math.Round(meanInside / Math.Max(1e-6, meanOutside), 4);
            }

            return record;
        }

        /// <summary>マスク内の輝度の中央値。外れ値に引きずられない基準値が要るとき。</summary>
        public static int Median(GrayImage image, MaskImage within)
        {
            if (image == null) return 0;

            var histogram = new int[256];
            int total = 0;
            for (int i = 0; i < image.Data.Length; i++)
            {
                if (within != null && within.Data[i] == MaskImage.Off) continue;
                histogram[image.Data[i]]++;
                total++;
            }
            if (total == 0) return 0;

            int half = total / 2;
            int running = 0;
            for (int v = 0; v < 256; v++)
            {
                running += histogram[v];
                if (running > half) return v;
            }
            return 255;
        }

        /// <summary>勾配の強さを輝度画像として扱う。統計を取り回すため。</summary>
        public static GrayImage AsGray(GradientField field)
        {
            if (field == null) return null;
            var gray = new GrayImage(field.Width, field.Height);
            Array.Copy(field.Magnitude, gray.Data, field.Magnitude.Length);
            return gray;
        }
    }
}
