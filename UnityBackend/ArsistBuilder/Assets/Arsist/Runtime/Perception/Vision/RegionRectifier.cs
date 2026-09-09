// ==============================================
// Arsist Engine - Perception / Vision
// 領域の正対化（射影歪みを取り除いて真正面から見た画像に起こす）
//
// OCR に「斜めから撮れた枠」をそのまま渡すと精度が出ない。
// 追跡で得た姿勢が分かっているので、枠の4隅を撮影画像上に投影し、
// その四角形を長方形に引き戻す（inverse warp）ことで、参照写真と
// 同じ見え方に直してから文字認識に渡せる。
//
// このファイルは UnityEngine に依存しない。姿勢や射影の符号を間違えても
// 実機ビルドは通ってしまうため、tools/perception-check から素の .NET で
// 検証できる状態を保つこと（doc/12-ar-behaviors.md §4）。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision
{
    public enum RectifyStatus
    {
        Ok = 0,
        /// <summary>枠が撮影画像の外に出ている。</summary>
        OutOfView,
        /// <summary>角度が浅すぎて面積が潰れている（ほぼ真横から見ている）。</summary>
        TooOblique,
        /// <summary>四角形が退化している / 射影が求まらない。</summary>
        Degenerate,
    }

    public static class RegionRectifier
    {
        /// <summary>これを下回る面積（px）の四角形は使い物にならないと判断する。</summary>
        private const double MinQuadArea = 400.0;

        /// <summary>
        /// 撮影画像上の四角形を、outWidth x outHeight の長方形に起こす。
        /// </summary>
        /// <param name="quad">
        /// 4隅の画像座標 (x, y) を 8 要素で。順序は左下・右下・右上・左上
        /// （出力画像の (0,0), (W,0), (W,H), (0,H) に対応。行は下から上）。
        /// </param>
        public static RectifyStatus TryRectify(
            GrayImage source, double[] quad, int outWidth, int outHeight, out GrayImage result)
        {
            result = null;
            if (source == null || quad == null || quad.Length < 8) return RectifyStatus.Degenerate;
            if (outWidth < 8 || outHeight < 8) return RectifyStatus.Degenerate;

            // はみ出しは「少しなら詰める」ではなく弾く。欠けた枠を読ませても
            // 何かしらの文字列は返ってしまい、静かに間違うため。
            for (int i = 0; i < 4; i++)
            {
                double x = quad[i * 2], y = quad[i * 2 + 1];
                if (x < 0 || y < 0 || x > source.Width - 1 || y > source.Height - 1)
                    return RectifyStatus.OutOfView;
            }

            if (Math.Abs(QuadArea(quad)) < MinQuadArea) return RectifyStatus.TooOblique;

            // 出力画像の角 → 撮影画像上の四角形、の射影を求める。
            // 出力側は下から上なので (0,0) が左下。
            var dstCorners = new double[8]
            {
                0, 0,
                outWidth - 1, 0,
                outWidth - 1, outHeight - 1,
                0, outHeight - 1,
            };

            var h = Homography.ComputeDlt(dstCorners, quad, 4);
            if (h == null) return RectifyStatus.Degenerate;

            var output = new GrayImage(outWidth, outHeight);
            var dst = output.Data;

            for (int y = 0; y < outHeight; y++)
            {
                // 行ごとに増分だけ足す（毎画素で3回の内積を回さない）
                double nx = h[1] * y + h[2];
                double ny = h[4] * y + h[5];
                double nw = h[7] * y + h[8];
                int row = y * outWidth;

                for (int x = 0; x < outWidth; x++)
                {
                    double w = nw + h[6] * x;
                    if (Math.Abs(w) < 1e-12) { dst[row + x] = 0; continue; }
                    double sx = (nx + h[0] * x) / w;
                    double sy = (ny + h[3] * x) / w;
                    dst[row + x] = SampleBilinear(source, sx, sy);
                }
            }

            result = output;
            return RectifyStatus.Ok;
        }

        /// <summary>
        /// 出力解像度の決め方。実寸から「1メートルあたり何ピクセル」で起こすかを決め、
        /// 元画像より細かくしても情報は増えないので上限で頭打ちにする。
        /// </summary>
        public static void ChooseOutputSize(
            double physicalWidth, double physicalHeight, double quadArea,
            int maxSide, out int outWidth, out int outHeight)
        {
            if (physicalWidth <= 0 || physicalHeight <= 0)
            {
                outWidth = outHeight = 0;
                return;
            }

            double aspect = physicalWidth / physicalHeight;

            // 撮影画像上での面積から、実際に取れている解像度を見積もる。
            // 遠くの小さな枠を無理に拡大しても文字は出てこない。
            double availableLong = Math.Sqrt(Math.Max(1.0, quadArea) * Math.Max(aspect, 1.0 / aspect));
            int longSide = (int)Math.Round(Math.Min(maxSide, Math.Max(64.0, availableLong)));

            if (aspect >= 1)
            {
                outWidth = longSide;
                outHeight = Math.Max(8, (int)Math.Round(longSide / aspect));
            }
            else
            {
                outHeight = longSide;
                outWidth = Math.Max(8, (int)Math.Round(longSide * aspect));
            }
        }

        /// <summary>四角形の符号付き面積（靴紐公式）。</summary>
        public static double QuadArea(double[] quad)
        {
            double area = 0;
            for (int i = 0; i < 4; i++)
            {
                int j = (i + 1) & 3;
                area += quad[i * 2] * quad[j * 2 + 1] - quad[j * 2] * quad[i * 2 + 1];
            }
            return area * 0.5;
        }

        private static byte SampleBilinear(GrayImage image, double x, double y)
        {
            if (x < 0) x = 0; else if (x > image.Width - 1) x = image.Width - 1;
            if (y < 0) y = 0; else if (y > image.Height - 1) y = image.Height - 1;

            int x0 = (int)x, y0 = (int)y;
            int x1 = x0 + 1 < image.Width ? x0 + 1 : x0;
            int y1 = y0 + 1 < image.Height ? y0 + 1 : y0;
            double fx = x - x0, fy = y - y0;

            var data = image.Data;
            int w = image.Width;
            double a = data[y0 * w + x0] + (data[y0 * w + x1] - data[y0 * w + x0]) * fx;
            double b = data[y1 * w + x0] + (data[y1 * w + x1] - data[y1 * w + x0]) * fx;
            double v = a + (b - a) * fy;
            return (byte)(v < 0 ? 0 : (v > 255 ? 255 : v + 0.5));
        }
    }
}
