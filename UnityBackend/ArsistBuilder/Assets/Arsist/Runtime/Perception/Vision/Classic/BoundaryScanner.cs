// ==============================================
// Arsist Engine - Perception / Vision / Classic
// 端から走査して境界を見つける
//
// 「画像の端から進んで、最初にぶつかる強い輪郭」を追う。地平線、机の縁、
// 瓶の中の液面、棚の段 — 「向こう側とこちら側を分ける線」は大体これで取れる。
//
// 空だけのための処理ではない。空を取るのはこの使い方のひとつでしかない。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public static class BoundaryScanner
    {
        /// <summary>
        /// 指定した端から走査して、最初に閾値を超える勾配の位置を返す。
        ///
        /// 返す配列の長さは、上下から走査なら幅、左右からなら高さ。
        /// 見つからなかった線は走査の終端 (= その方向いっぱいまで境界が無い) になる。
        /// </summary>
        /// <param name="from">走査を始める端。"top" / "bottom" / "left" / "right"</param>
        /// <param name="threshold">これを超える勾配を境界とみなす。</param>
        /// <param name="smooth">中央値で平滑化する窓の半径。電線や枝で1列だけ跳ねるのを抑える。</param>
        /// <param name="limit">走査する割合 (0..1)。端から見て、ここまでで諦める。</param>
        public static int[] Scan(GradientField field, string from, int threshold, int smooth, double limit)
        {
            if (field == null) return Array.Empty<int>();

            int w = field.Width, h = field.Height;
            bool vertical = from == "top" || from == "bottom";
            int lanes = vertical ? w : h;
            int depth = vertical ? h : w;

            // 走査を打ち切る位置。端から limit の割合だけ見る。
            int span = (int)Math.Round(depth * Math.Max(0.05, Math.Min(1.0, limit)));
            var result = new int[lanes];

            for (int lane = 0; lane < lanes; lane++)
            {
                // 見つからなければ「境界なし」= 走査しきった位置。
                result[lane] = EndOf(from, depth, span);

                for (int step = 0; step < span; step++)
                {
                    // 画像のいちばん外側の行/列は Sobel の窓が外に出るので勾配が必ず 0 になる。
                    // そこから数え始めると、模様だらけの画でも端の1行が「境界の向こう側」に化ける。
                    int position = PositionOf(from, depth, step);
                    if (position <= 0 || position >= depth - 1) continue;

                    int index = vertical ? position * w + lane : lane * w + position;
                    if (field.Magnitude[index] >= threshold)
                    {
                        result[lane] = position;
                        break;
                    }
                }
            }

            return MedianSmooth(result, smooth);
        }

        /// <summary>行は下から上なので、"top" は大きい方から降りる。</summary>
        private static int PositionOf(string from, int depth, int step)
        {
            switch (from)
            {
                case "bottom": return step;
                case "left": return step;
                case "right": return depth - 1 - step;
                default: return depth - 1 - step;   // top
            }
        }

        private static int EndOf(string from, int depth, int span)
        {
            switch (from)
            {
                case "bottom": return span - 1;
                case "left": return span - 1;
                case "right": return depth - span;
                default: return depth - span;       // top
            }
        }

        /// <summary>
        /// 境界の手前側 / 向こう側をマスクにする。
        /// </summary>
        /// <param name="keep">"before" = 走査を始めた端の側、"after" = 反対側。</param>
        public static MaskImage SideMask(int[] boundary, int width, int height, string from, string keep)
        {
            var mask = new MaskImage(width, height);
            if (boundary == null || boundary.Length == 0) return mask;

            bool vertical = from == "top" || from == "bottom";
            bool before = keep != "after";

            int lanes = vertical ? width : height;
            for (int lane = 0; lane < lanes && lane < boundary.Length; lane++)
            {
                int edge = boundary[lane];
                int depth = vertical ? height : width;

                for (int position = 0; position < depth; position++)
                {
                    bool onStartSide;
                    switch (from)
                    {
                        case "bottom": onStartSide = position < edge; break;
                        case "left": onStartSide = position < edge; break;
                        case "right": onStartSide = position > edge; break;
                        default: onStartSide = position > edge; break;   // top
                    }
                    if (onStartSide != before) continue;

                    int index = vertical ? position * width + lane : lane * width + position;
                    mask.Data[index] = MaskImage.On;
                }
            }
            return mask;
        }

        /// <summary>窓内の中央値で平滑化する。外れ値に強いので境界線向き。</summary>
        public static int[] MedianSmooth(int[] values, int radius)
        {
            if (radius < 1 || values.Length == 0) return values;

            var result = new int[values.Length];
            var window = new int[radius * 2 + 1];

            for (int i = 0; i < values.Length; i++)
            {
                int n = 0;
                for (int k = -radius; k <= radius; k++)
                {
                    int j = i + k;
                    if (j < 0 || j >= values.Length) continue;
                    window[n++] = values[j];
                }
                Array.Sort(window, 0, n);
                result[i] = window[n / 2];
            }
            return result;
        }
    }
}
