// ==============================================
// Arsist Engine - Perception / Vision
// ホモグラフィ推定 (正規化DLT + RANSAC + 全インライア再推定)
//
// 対応は「ターゲット平面上のメートル座標 (X, Y)」→「観測画像のピクセル (u, v)」。
// 参照画像ピクセルを経由せずメートルで直接解くことで、後段の姿勢推定に
// そのまま渡せる（余計な合成を挟むと数値誤差が乗る）。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision
{
    internal sealed class HomographyResult
    {
        /// <summary>row-major 3x3。h[8] = 1 に正規化済み。</summary>
        public double[] H;
        public List<int> Inliers;
        public double InlierRmse;
    }

    internal static class Homography
    {
        /// <summary>
        /// RANSAC でホモグラフィを推定する。
        /// </summary>
        /// <param name="src">平面上のメートル座標 (x, y) の配列 (長さ n*2)</param>
        /// <param name="dst">対応する画像ピクセル (u, v) の配列 (長さ n*2)</param>
        /// <param name="threshold">インライア判定の再投影誤差 (px)</param>
        public static HomographyResult Estimate(
            double[] src, double[] dst, int n, double threshold, int maxIterations, int seed)
        {
            if (n < 4) return null;

            var rng = new Xorshift(seed);
            double thr2 = threshold * threshold;

            int[] bestInliers = null;
            int bestCount = 0;
            int iterations = maxIterations;

            var sample = new int[4];
            var sSrc = new double[8];
            var sDst = new double[8];

            for (int iter = 0; iter < iterations; iter++)
            {
                if (!PickDistinct(rng, n, sample)) break;
                for (int i = 0; i < 4; i++)
                {
                    sSrc[i * 2] = src[sample[i] * 2];
                    sSrc[i * 2 + 1] = src[sample[i] * 2 + 1];
                    sDst[i * 2] = dst[sample[i] * 2];
                    sDst[i * 2 + 1] = dst[sample[i] * 2 + 1];
                }

                var h = ComputeDlt(sSrc, sDst, 4);
                if (h == null) continue;

                int count = 0;
                for (int i = 0; i < n; i++)
                {
                    if (TransferError2(h, src[i * 2], src[i * 2 + 1], dst[i * 2], dst[i * 2 + 1]) <= thr2)
                        count++;
                }

                if (count > bestCount)
                {
                    bestCount = count;
                    bestInliers = new int[count];
                    int k = 0;
                    for (int i = 0; i < n; i++)
                    {
                        if (TransferError2(h, src[i * 2], src[i * 2 + 1], dst[i * 2], dst[i * 2 + 1]) <= thr2)
                            bestInliers[k++] = i;
                    }

                    // 適応的な打ち切り: 期待成功確率 99%
                    double w = (double)count / n;
                    if (w > 0.05)
                    {
                        double p = 1.0 - Math.Pow(w, 4);
                        if (p < 1e-9) { iterations = iter + 1; }
                        else
                        {
                            int need = (int)Math.Ceiling(Math.Log(0.01) / Math.Log(p));
                            if (need < iterations) iterations = Math.Max(iter + 1, need);
                        }
                    }
                }
            }

            if (bestInliers == null || bestCount < 4) return null;

            // 全インライアで再推定 → インライア再選択、を数回まわして安定させる
            var inliers = new List<int>(bestInliers);
            double[] best = null;
            for (int round = 0; round < 4; round++)
            {
                var subSrc = new double[inliers.Count * 2];
                var subDst = new double[inliers.Count * 2];
                for (int i = 0; i < inliers.Count; i++)
                {
                    subSrc[i * 2] = src[inliers[i] * 2];
                    subSrc[i * 2 + 1] = src[inliers[i] * 2 + 1];
                    subDst[i * 2] = dst[inliers[i] * 2];
                    subDst[i * 2 + 1] = dst[inliers[i] * 2 + 1];
                }

                var h = ComputeDlt(subSrc, subDst, inliers.Count);
                if (h == null) break;
                best = h;

                var next = new List<int>(inliers.Count);
                for (int i = 0; i < n; i++)
                {
                    if (TransferError2(h, src[i * 2], src[i * 2 + 1], dst[i * 2], dst[i * 2 + 1]) <= thr2)
                        next.Add(i);
                }
                if (next.Count < 4) break;
                bool same = next.Count == inliers.Count;
                inliers = next;
                if (same) break;
            }

            if (best == null) return null;

            double sum = 0;
            foreach (int i in inliers)
                sum += TransferError2(best, src[i * 2], src[i * 2 + 1], dst[i * 2], dst[i * 2 + 1]);

            return new HomographyResult
            {
                H = best,
                Inliers = inliers,
                InlierRmse = Math.Sqrt(sum / Math.Max(1, inliers.Count)),
            };
        }

        public static double TransferError2(double[] h, double x, double y, double u, double v)
        {
            double w = h[6] * x + h[7] * y + h[8];
            if (Math.Abs(w) < 1e-12) return double.MaxValue;
            double pu = (h[0] * x + h[1] * y + h[2]) / w;
            double pv = (h[3] * x + h[4] * y + h[5]) / w;
            double du = pu - u, dv = pv - v;
            return du * du + dv * dv;
        }

        /// <summary>Hartley 正規化つき DLT。</summary>
        public static double[] ComputeDlt(double[] src, double[] dst, int n)
        {
            if (n < 4) return null;

            Normalize(src, n, out var tSrc, out var nSrc);
            Normalize(dst, n, out var tDst, out var nDst);

            // A (2n x 9)
            int rows = 2 * n;
            var ata = new double[81];
            var row = new double[9];

            for (int i = 0; i < n; i++)
            {
                double x = nSrc[i * 2], y = nSrc[i * 2 + 1];
                double u = nDst[i * 2], v = nDst[i * 2 + 1];

                row[0] = -x; row[1] = -y; row[2] = -1; row[3] = 0; row[4] = 0; row[5] = 0;
                row[6] = u * x; row[7] = u * y; row[8] = u;
                Accumulate(ata, row);

                row[0] = 0; row[1] = 0; row[2] = 0; row[3] = -x; row[4] = -y; row[5] = -1;
                row[6] = v * x; row[7] = v * y; row[8] = v;
                Accumulate(ata, row);
            }
            _ = rows;

            LinAlg.SymmetricEigen(ata, 9, out var vals, out var vecs);
            _ = vals;

            // 最小固有値に対応する列（昇順ソート済みなので 0 列目）
            var hn = new double[9];
            for (int i = 0; i < 9; i++) hn[i] = vecs[i * 9 + 0];

            // 逆正規化: H = T_dst^-1 * Hn * T_src
            var invTDst = InvertSimilarity(tDst);
            var h = LinAlg.Mul3(invTDst, LinAlg.Mul3(hn, tSrc));

            if (Math.Abs(h[8]) < 1e-14) return null;
            for (int i = 0; i < 9; i++) h[i] /= h[8];
            return h;
        }

        private static void Accumulate(double[] ata, double[] row)
        {
            for (int i = 0; i < 9; i++)
            {
                double ri = row[i];
                if (ri == 0) continue;
                for (int j = 0; j < 9; j++) ata[i * 9 + j] += ri * row[j];
            }
        }

        /// <summary>重心を原点に、平均距離を √2 にする相似変換。</summary>
        private static void Normalize(double[] pts, int n, out double[] t, out double[] outPts)
        {
            double cx = 0, cy = 0;
            for (int i = 0; i < n; i++) { cx += pts[i * 2]; cy += pts[i * 2 + 1]; }
            cx /= n; cy /= n;

            double mean = 0;
            for (int i = 0; i < n; i++)
            {
                double dx = pts[i * 2] - cx, dy = pts[i * 2 + 1] - cy;
                mean += Math.Sqrt(dx * dx + dy * dy);
            }
            mean /= n;
            double scale = mean > 1e-12 ? Math.Sqrt(2.0) / mean : 1.0;

            t = new double[9] { scale, 0, -scale * cx, 0, scale, -scale * cy, 0, 0, 1 };
            outPts = new double[n * 2];
            for (int i = 0; i < n; i++)
            {
                outPts[i * 2] = (pts[i * 2] - cx) * scale;
                outPts[i * 2 + 1] = (pts[i * 2 + 1] - cy) * scale;
            }
        }

        private static double[] InvertSimilarity(double[] t)
        {
            double s = t[0];
            return new double[9] { 1 / s, 0, -t[2] / s, 0, 1 / s, -t[5] / s, 0, 0, 1 };
        }

        private static bool PickDistinct(Xorshift rng, int n, int[] outIdx)
        {
            if (n < outIdx.Length) return false;
            for (int i = 0; i < outIdx.Length; i++)
            {
                bool ok = false;
                for (int attempt = 0; attempt < 32 && !ok; attempt++)
                {
                    int v = (int)(rng.Next() % (uint)n);
                    ok = true;
                    for (int j = 0; j < i; j++) if (outIdx[j] == v) { ok = false; break; }
                    if (ok) outIdx[i] = v;
                }
                if (!ok) return false;
            }
            return true;
        }

        internal sealed class Xorshift
        {
            private uint _state;
            public Xorshift(int seed) { _state = seed == 0 ? 0x9E3779B9u : (uint)seed; }
            public uint Next()
            {
                _state ^= _state << 13;
                _state ^= _state >> 17;
                _state ^= _state << 5;
                return _state;
            }
        }
    }
}
