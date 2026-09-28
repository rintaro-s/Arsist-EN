// ==============================================
// Arsist Engine - Perception / Vision / Classic
// マスクから四角形 (看板、画面、紙、マーカー) を見つける
//
// 輪郭を多角形に近似して、頂点が 4 つで凸のものだけ残す。
// 角の順序は RegionRectifier と同じ「左下・右下・右上・左上」(画は下から上) に揃えるので、
// そのまま正対化 (rectify) に渡せる。
//
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public static class Quads
    {
        /// <summary>
        /// 四角形の一覧を返す。各項目は blobs と同じ x / y / width / height (正規化、原点左下) に加えて、
        /// corners (正規化した 8 値) と px (画素座標の 8 値、rectify 用) を持つ。
        /// </summary>
        public static List<object> Find(MaskImage mask, double epsilonRatio, int minArea, int maxItems)
        {
            var items = new List<object>();
            if (mask == null) return items;

            var contours = Contours.FindExternal(mask);
            contours.Sort((a, b) => Math.Abs(b.Area()).CompareTo(Math.Abs(a.Area())));

            foreach (var contour in contours)
            {
                if (items.Count >= maxItems) break;
                double area = Math.Abs(contour.Area());
                if (area < minArea) continue;

                var polygon = Contours.ApproximatePolygon(contour, epsilonRatio * contour.Perimeter());
                if (polygon.Count != 4) continue;

                var corners = new double[8];
                for (int i = 0; i < 4; i++)
                {
                    corners[i * 2] = polygon[i].X;
                    corners[i * 2 + 1] = polygon[i].Y;
                }
                if (!IsConvex(corners)) continue;
                Order(corners);

                double minX = Math.Min(Math.Min(corners[0], corners[2]), Math.Min(corners[4], corners[6]));
                double maxX = Math.Max(Math.Max(corners[0], corners[2]), Math.Max(corners[4], corners[6]));
                double minY = Math.Min(Math.Min(corners[1], corners[3]), Math.Min(corners[5], corners[7]));
                double maxY = Math.Max(Math.Max(corners[1], corners[3]), Math.Max(corners[5], corners[7]));

                var normalized = new List<object>(8);
                var pixels = new List<object>(8);
                for (int i = 0; i < 8; i++)
                {
                    pixels.Add(corners[i]);
                    normalized.Add(Math.Round(corners[i] / (i % 2 == 0 ? mask.Width : mask.Height), 4));
                }

                items.Add(new Dictionary<string, object>
                {
                    ["x"] = Math.Round((minX + maxX) * 0.5 / mask.Width, 4),
                    ["y"] = Math.Round((minY + maxY) * 0.5 / mask.Height, 4),
                    ["width"] = Math.Round((maxX - minX) / mask.Width, 4),
                    ["height"] = Math.Round((maxY - minY) / mask.Height, 4),
                    ["area"] = (int)area,
                    ["corners"] = normalized,
                    ["px"] = pixels,
                });
            }
            return items;
        }

        /// <summary>凸か (隣り合う辺の外積の符号がすべて同じ)。</summary>
        public static bool IsConvex(double[] c)
        {
            int sign = 0;
            for (int i = 0; i < 4; i++)
            {
                int j = (i + 1) % 4, k = (i + 2) % 4;
                double ax = c[j * 2] - c[i * 2], ay = c[j * 2 + 1] - c[i * 2 + 1];
                double bx = c[k * 2] - c[j * 2], by = c[k * 2 + 1] - c[j * 2 + 1];
                double cross = ax * by - ay * bx;
                if (Math.Abs(cross) < 1e-9) return false;
                int s = cross > 0 ? 1 : -1;
                if (sign == 0) sign = s;
                else if (s != sign) return false;
            }
            return true;
        }

        /// <summary>
        /// 角を「左下・右下・右上・左上」に並べ替える (画は下から上なので、左下は x+y が最小の角)。
        /// 重心まわりの角度で反時計回りに並べ、左下から始める。
        /// </summary>
        public static void Order(double[] c)
        {
            double cx = (c[0] + c[2] + c[4] + c[6]) * 0.25;
            double cy = (c[1] + c[3] + c[5] + c[7]) * 0.25;
            var order = new[] { 0, 1, 2, 3 };
            Array.Sort(order, (a, b) =>
                Math.Atan2(c[a * 2 + 1] - cy, c[a * 2] - cx).CompareTo(Math.Atan2(c[b * 2 + 1] - cy, c[b * 2] - cx)));

            int start = 0;
            double best = double.MaxValue;
            for (int i = 0; i < 4; i++)
            {
                double s = c[order[i] * 2] + c[order[i] * 2 + 1];
                if (s < best) { best = s; start = i; }
            }

            var sorted = new double[8];
            for (int i = 0; i < 4; i++)
            {
                int from = order[(start + i) % 4];
                sorted[i * 2] = c[from * 2];
                sorted[i * 2 + 1] = c[from * 2 + 1];
            }
            Array.Copy(sorted, c, 8);
        }

        /// <summary>四角形の縦横比 (高さ / 幅)。正対化の出力の大きさを決めるのに使う。</summary>
        public static double AspectOf(double[] c)
        {
            double bottom = Distance(c[0], c[1], c[2], c[3]);
            double top = Distance(c[6], c[7], c[4], c[5]);
            double left = Distance(c[0], c[1], c[6], c[7]);
            double right = Distance(c[2], c[3], c[4], c[5]);
            double width = (bottom + top) * 0.5, height = (left + right) * 0.5;
            return width <= 1e-9 ? 1 : height / width;
        }

        private static double Distance(double x0, double y0, double x1, double y1) =>
            Math.Sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    }
}
