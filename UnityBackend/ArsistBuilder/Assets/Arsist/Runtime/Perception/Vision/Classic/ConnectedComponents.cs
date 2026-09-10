// ==============================================
// Arsist Engine - Perception / Vision / Classic
// 連結成分のラベリングと領域の統計
//
// マスクを「塊」に分ける。ここまで来ると「一番大きい塊はどこか」「その形は」
// といった問いに答えられるようになり、認識らしくなる。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    /// <summary>ひとつの塊。座標は画像画素、行は下から上。</summary>
    public sealed class Blob
    {
        public int Label;
        public int Area;
        public int MinX, MinY, MaxX, MaxY;
        public double CentroidX, CentroidY;

        public int BoundsWidth => MaxX - MinX + 1;
        public int BoundsHeight => MaxY - MinY + 1;

        /// <summary>外接矩形をどれだけ埋めているか (0..1)。丸や四角の判別に使う。</summary>
        public double Fill => (double)Area / Math.Max(1, BoundsWidth * BoundsHeight);

        /// <summary>縦横比。1 に近いほど正方形に近い。</summary>
        public double Aspect => (double)BoundsWidth / Math.Max(1, BoundsHeight);
    }

    public sealed class LabelResult
    {
        /// <summary>画素ごとのラベル。0 = 背景。</summary>
        public int[] Labels;
        public int Width;
        public int Height;
        public List<Blob> Blobs = new List<Blob>();

        /// <summary>面積が最大の塊。何も無ければ null。</summary>
        public Blob Largest()
        {
            Blob best = null;
            foreach (var blob in Blobs)
            {
                if (best == null || blob.Area > best.Area) best = blob;
            }
            return best;
        }

        /// <summary>指定した塊だけを残したマスクを作る。</summary>
        public MaskImage MaskOf(Blob blob)
        {
            var mask = new MaskImage(Width, Height);
            if (blob == null) return mask;
            for (int i = 0; i < Labels.Length; i++)
            {
                if (Labels[i] == blob.Label) mask.Data[i] = MaskImage.On;
            }
            return mask;
        }
    }

    public static class ConnectedComponents
    {
        /// <summary>
        /// 4連結でラベリングする。
        ///
        /// 再帰も Union-Find も使わず、明示的なスタックで塗りつぶす。
        /// 再帰だと大きな領域（空など画面の半分を占めるもの）でスタックが溢れるため。
        /// </summary>
        /// <param name="minArea">これより小さい塊は捨てる（ノイズ除去）。</param>
        public static LabelResult Label(MaskImage mask, int minArea = 1)
        {
            var result = new LabelResult
            {
                Labels = new int[mask.Width * mask.Height],
                Width = mask.Width,
                Height = mask.Height,
            };

            int width = mask.Width, height = mask.Height;
            int nextLabel = 0;
            var stack = new Stack<int>();

            for (int start = 0; start < mask.Data.Length; start++)
            {
                if (mask.Data[start] == MaskImage.Off) continue;
                if (result.Labels[start] != 0) continue;

                nextLabel++;
                var blob = new Blob
                {
                    Label = nextLabel,
                    MinX = int.MaxValue, MinY = int.MaxValue,
                    MaxX = int.MinValue, MaxY = int.MinValue,
                };
                long sumX = 0, sumY = 0;

                stack.Push(start);
                result.Labels[start] = nextLabel;

                while (stack.Count > 0)
                {
                    int index = stack.Pop();
                    int x = index % width;
                    int y = index / width;

                    blob.Area++;
                    sumX += x; sumY += y;
                    if (x < blob.MinX) blob.MinX = x;
                    if (x > blob.MaxX) blob.MaxX = x;
                    if (y < blob.MinY) blob.MinY = y;
                    if (y > blob.MaxY) blob.MaxY = y;

                    if (x > 0) Visit(index - 1);
                    if (x < width - 1) Visit(index + 1);
                    if (y > 0) Visit(index - width);
                    if (y < height - 1) Visit(index + width);
                }

                blob.CentroidX = (double)sumX / blob.Area;
                blob.CentroidY = (double)sumY / blob.Area;

                if (blob.Area >= minArea)
                {
                    result.Blobs.Add(blob);
                }
                else
                {
                    // 小さすぎる塊はラベルごと消して背景に戻す。
                    // 外接矩形の中だけ見れば足りる（塊はその外には出ない）。
                    for (int y = blob.MinY; y <= blob.MaxY; y++)
                    {
                        int row = y * width;
                        for (int x = blob.MinX; x <= blob.MaxX; x++)
                        {
                            if (result.Labels[row + x] == nextLabel) result.Labels[row + x] = 0;
                        }
                    }
                    nextLabel--;
                }

                void Visit(int neighbour)
                {
                    if (mask.Data[neighbour] == MaskImage.Off) return;
                    if (result.Labels[neighbour] != 0) return;
                    result.Labels[neighbour] = nextLabel;
                    stack.Push(neighbour);
                }
            }

            return result;
        }
    }
}
