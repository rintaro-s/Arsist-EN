// ==============================================
// Arsist Engine - Perception / Vision / Classic
// 輪郭追跡と多角形近似
//
// 塊の「形」を取り出す。頂点数まで落とせば、三角/四角/丸の判別ができる。
// マーカーを使わない図形認識の古典的な入口。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public struct Point2
    {
        public int X;
        public int Y;
        public Point2(int x, int y) { X = x; Y = y; }
    }

    public sealed class Contour
    {
        public List<Point2> Points = new List<Point2>();

        /// <summary>周囲長（隣接点の距離の総和）。</summary>
        public double Perimeter()
        {
            double total = 0;
            for (int i = 0; i < Points.Count; i++)
            {
                var a = Points[i];
                var b = Points[(i + 1) % Points.Count];
                int dx = b.X - a.X, dy = b.Y - a.Y;
                total += Math.Sqrt(dx * dx + dy * dy);
            }
            return total;
        }

        /// <summary>符号なし面積（靴紐公式）。</summary>
        public double Area()
        {
            double area = 0;
            for (int i = 0; i < Points.Count; i++)
            {
                var a = Points[i];
                var b = Points[(i + 1) % Points.Count];
                area += (double)a.X * b.Y - (double)b.X * a.Y;
            }
            return Math.Abs(area) * 0.5;
        }

        /// <summary>
        /// 円形度 4πA/P²。1 に近いほど円、四角で約 0.785、細長いほど 0 に近づく。
        /// </summary>
        public double Circularity()
        {
            double p = Perimeter();
            if (p <= 0) return 0;
            return 4 * Math.PI * Area() / (p * p);
        }
    }

    public static class Contours
    {
        /// <summary>
        /// マスクから外側輪郭を追う（Moore 近傍追跡）。
        /// 穴の輪郭は追わない。外形が分かれば足りる用途に絞ってある。
        /// </summary>
        /// <param name="minPerimeterPoints">これより点数が少ない輪郭は捨てる。</param>
        public static List<Contour> FindExternal(MaskImage mask, int minPerimeterPoints = 16)
        {
            var contours = new List<Contour>();
            var visited = new bool[mask.Width * mask.Height];
            int w = mask.Width, h = mask.Height;

            // 8近傍を時計回りに並べたもの
            int[] dx = { 1, 1, 0, -1, -1, -1, 0, 1 };
            int[] dy = { 0, -1, -1, -1, 0, 1, 1, 1 };

            for (int y = 0; y < h; y++)
            {
                for (int x = 0; x < w; x++)
                {
                    int index = y * w + x;
                    if (mask.Data[index] == MaskImage.Off || visited[index]) continue;

                    // 左隣が背景 = ここが外側輪郭の開始点
                    bool leftIsBackground = x == 0 || mask.Data[index - 1] == MaskImage.Off;
                    if (!leftIsBackground) continue;

                    var contour = TraceFrom(mask, x, y, dx, dy, visited);
                    if (contour.Points.Count >= minPerimeterPoints) contours.Add(contour);
                }
            }
            return contours;
        }

        private static Contour TraceFrom(MaskImage mask, int startX, int startY, int[] dx, int[] dy, bool[] visited)
        {
            var contour = new Contour();
            int w = mask.Width, h = mask.Height;
            int x = startX, y = startY;
            int direction = 0;
            // 一周して戻るはずだが、壊れたマスクで無限に回らないよう上限を置く
            int limit = w * h * 4;

            do
            {
                contour.Points.Add(new Point2(x, y));
                visited[y * w + x] = true;

                bool moved = false;
                // 直前に来た向きの少し手前から時計回りに探すと、輪郭に沿って進める
                int begin = (direction + 6) % 8;
                for (int step = 0; step < 8; step++)
                {
                    int d = (begin + step) % 8;
                    int nx = x + dx[d], ny = y + dy[d];
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    if (mask.Data[ny * w + nx] == MaskImage.Off) continue;

                    x = nx; y = ny; direction = d;
                    moved = true;
                    break;
                }
                if (!moved) break;   // 孤立した点

            } while ((x != startX || y != startY) && contour.Points.Count < limit);

            return contour;
        }

        /// <summary>
        /// Douglas-Peucker で多角形に近似する。
        /// epsilon は周囲長に対する割合で渡すのが実用的（0.02 前後）。
        /// </summary>
        public static List<Point2> ApproximatePolygon(Contour contour, double epsilon)
        {
            var points = contour.Points;
            if (points.Count < 3) return new List<Point2>(points);

            // 輪郭は閉じているのに、素の Douglas-Peucker は始点と終点を必ず残す。
            // 追跡を始めた場所は辺の途中でもありうるので、そこに偽の頂点ができてしまう
            // (正方形が五角形になる)。始点から最も遠い点をもう一方の錨にして、
            // 輪郭を二つの弧に分けてから簡略化する。
            int far = 0;
            double farthest = -1;
            var origin = points[0];
            for (int i = 1; i < points.Count; i++)
            {
                double dx = points[i].X - origin.X, dy = points[i].Y - origin.Y;
                double d = dx * dx + dy * dy;
                if (d > farthest) { farthest = d; far = i; }
            }
            if (far <= 0 || far >= points.Count - 1) far = points.Count / 2;

            var keep = new bool[points.Count];
            keep[0] = true;
            keep[far] = true;

            // 前半の弧はそのまま。
            Simplify(points, 0, far, epsilon, keep);

            // 後半の弧は始点に巻き戻るので、並べ直してから掛けて結果を戻す。
            int wrapCount = points.Count - far + 1;
            var wrapped = new List<Point2>(wrapCount);
            for (int i = far; i < points.Count; i++) wrapped.Add(points[i]);
            wrapped.Add(points[0]);

            var wrappedKeep = new bool[wrapCount];
            wrappedKeep[0] = true;
            wrappedKeep[wrapCount - 1] = true;
            Simplify(wrapped, 0, wrapCount - 1, epsilon, wrappedKeep);
            for (int i = 1; i < wrapCount - 1; i++)
            {
                if (wrappedKeep[i]) keep[far + i] = true;
            }

            var result = new List<Point2>();
            for (int i = 0; i < points.Count; i++)
            {
                if (keep[i]) result.Add(points[i]);
            }
            return result;
        }

        private static void Simplify(List<Point2> points, int first, int last, double epsilon, bool[] keep)
        {
            if (last <= first + 1) return;

            double maxDistance = 0;
            int maxIndex = first;

            var a = points[first];
            var b = points[last];
            double dx = b.X - a.X, dy = b.Y - a.Y;
            double length = Math.Sqrt(dx * dx + dy * dy);

            for (int i = first + 1; i < last; i++)
            {
                var p = points[i];
                double distance = length < 1e-9
                    ? Math.Sqrt((p.X - a.X) * (double)(p.X - a.X) + (p.Y - a.Y) * (double)(p.Y - a.Y))
                    : Math.Abs(dy * (p.X - a.X) - dx * (p.Y - a.Y)) / length;

                if (distance > maxDistance)
                {
                    maxDistance = distance;
                    maxIndex = i;
                }
            }

            if (maxDistance <= epsilon) return;

            keep[maxIndex] = true;
            Simplify(points, first, maxIndex, epsilon, keep);
            Simplify(points, maxIndex, last, epsilon, keep);
        }

        /// <summary>頂点数と円形度からざっくり形を言う。</summary>
        public static string ClassifyShape(Contour contour, double epsilonRatio = 0.02)
        {
            var polygon = ApproximatePolygon(contour, contour.Perimeter() * epsilonRatio);
            int corners = polygon.Count;
            // 追跡の始点と終点が重なるので、閉じている分を1つ引く
            if (corners > 1 && polygon[0].X == polygon[corners - 1].X && polygon[0].Y == polygon[corners - 1].Y)
            {
                corners--;
            }

            switch (corners)
            {
                case 3: return "triangle";
                case 4: return contour.Circularity() > 0.7 ? "square" : "quad";
                case 5: return "pentagon";
                default:
                    return contour.Circularity() > 0.78 ? "circle" : "polygon";
            }
        }
    }
}
