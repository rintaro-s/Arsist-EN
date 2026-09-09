// ==============================================
// Arsist Engine - Perception / Vision
// 小規模な線形代数ユーティリティ
//
// 使うのは 9x9 以下なので、汎用ライブラリを持ち込まず自前で持つ。
//  - Jacobi 法による実対称行列の固有分解 (DLT の最小固有ベクトル / 極分解)
//  - 部分ピボット付き Gauss 消去 (LM の正規方程式)
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision
{
    internal static class LinAlg
    {
        /// <summary>
        /// 実対称行列 a (n x n, row-major) の固有分解。
        /// 固有値は values に昇順で、対応する固有ベクトルは vectors の「列」に入る。
        /// a は破壊されない。
        /// </summary>
        public static void SymmetricEigen(double[] a, int n, out double[] values, out double[] vectors)
        {
            var m = (double[])a.Clone();
            var v = new double[n * n];
            for (int i = 0; i < n; i++) v[i * n + i] = 1.0;

            for (int sweep = 0; sweep < 100; sweep++)
            {
                double off = 0;
                for (int p = 0; p < n; p++)
                    for (int q = p + 1; q < n; q++)
                        off += m[p * n + q] * m[p * n + q];
                if (off <= 1e-24) break;

                for (int p = 0; p < n; p++)
                {
                    for (int q = p + 1; q < n; q++)
                    {
                        double apq = m[p * n + q];
                        if (Math.Abs(apq) < 1e-18) continue;

                        double app = m[p * n + p];
                        double aqq = m[q * n + q];
                        double theta = (aqq - app) / (2.0 * apq);
                        double t = Math.Sign(theta) / (Math.Abs(theta) + Math.Sqrt(theta * theta + 1.0));
                        if (theta == 0) t = 1.0;
                        double c = 1.0 / Math.Sqrt(t * t + 1.0);
                        double s = t * c;

                        for (int k = 0; k < n; k++)
                        {
                            double akp = m[k * n + p];
                            double akq = m[k * n + q];
                            m[k * n + p] = c * akp - s * akq;
                            m[k * n + q] = s * akp + c * akq;
                        }
                        for (int k = 0; k < n; k++)
                        {
                            double apk = m[p * n + k];
                            double aqk = m[q * n + k];
                            m[p * n + k] = c * apk - s * aqk;
                            m[q * n + k] = s * apk + c * aqk;
                        }
                        for (int k = 0; k < n; k++)
                        {
                            double vkp = v[k * n + p];
                            double vkq = v[k * n + q];
                            v[k * n + p] = c * vkp - s * vkq;
                            v[k * n + q] = s * vkp + c * vkq;
                        }
                    }
                }
            }

            var vals = new double[n];
            for (int i = 0; i < n; i++) vals[i] = m[i * n + i];

            // 昇順ソート（列を入れ替える）
            var order = new int[n];
            for (int i = 0; i < n; i++) order[i] = i;
            Array.Sort(vals, order);

            var sortedVectors = new double[n * n];
            for (int col = 0; col < n; col++)
            {
                int src = order[col];
                for (int row = 0; row < n; row++)
                    sortedVectors[row * n + col] = v[row * n + src];
            }

            values = vals;
            vectors = sortedVectors;
        }

        /// <summary>
        /// A x = b を部分ピボット付き Gauss 消去で解く。A (n x n, row-major) は破壊される。
        /// 特異なら false。
        /// </summary>
        public static bool SolveLinear(double[] a, double[] b, int n, double[] x)
        {
            for (int col = 0; col < n; col++)
            {
                int pivot = col;
                double best = Math.Abs(a[col * n + col]);
                for (int r = col + 1; r < n; r++)
                {
                    double v = Math.Abs(a[r * n + col]);
                    if (v > best) { best = v; pivot = r; }
                }
                if (best < 1e-14) return false;

                if (pivot != col)
                {
                    for (int c = 0; c < n; c++)
                    {
                        double t = a[col * n + c]; a[col * n + c] = a[pivot * n + c]; a[pivot * n + c] = t;
                    }
                    double tb = b[col]; b[col] = b[pivot]; b[pivot] = tb;
                }

                double inv = 1.0 / a[col * n + col];
                for (int r = col + 1; r < n; r++)
                {
                    double f = a[r * n + col] * inv;
                    if (f == 0) continue;
                    for (int c = col; c < n; c++) a[r * n + c] -= f * a[col * n + c];
                    b[r] -= f * b[col];
                }
            }

            for (int r = n - 1; r >= 0; r--)
            {
                double sum = b[r];
                for (int c = r + 1; c < n; c++) sum -= a[r * n + c] * x[c];
                x[r] = sum / a[r * n + r];
            }
            return true;
        }

        /// <summary>
        /// 3x3 行列 m (row-major) に最も近い回転行列を極分解で求める。
        /// R = M (MᵀM)^(-1/2)。det が負なら軸を1本反転して det=+1 にする。
        /// </summary>
        public static double[] NearestRotation(double[] m)
        {
            var mtm = new double[9];
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++)
                {
                    double s = 0;
                    for (int k = 0; k < 3; k++) s += m[k * 3 + i] * m[k * 3 + j];
                    mtm[i * 3 + j] = s;
                }

            SymmetricEigen(mtm, 3, out var vals, out var vecs);

            // (MᵀM)^(-1/2) = V diag(1/sqrt(d)) Vᵀ
            var inv = new double[9];
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++)
                {
                    double s = 0;
                    for (int k = 0; k < 3; k++)
                    {
                        double d = vals[k];
                        if (d < 1e-18) d = 1e-18;
                        s += vecs[i * 3 + k] * (1.0 / Math.Sqrt(d)) * vecs[j * 3 + k];
                    }
                    inv[i * 3 + j] = s;
                }

            var r = new double[9];
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++)
                {
                    double s = 0;
                    for (int k = 0; k < 3; k++) s += m[i * 3 + k] * inv[k * 3 + j];
                    r[i * 3 + j] = s;
                }

            if (Det3(r) < 0)
            {
                for (int i = 0; i < 3; i++) r[i * 3 + 2] = -r[i * 3 + 2];
            }
            return r;
        }

        public static double Det3(double[] m)
        {
            return m[0] * (m[4] * m[8] - m[5] * m[7])
                 - m[1] * (m[3] * m[8] - m[5] * m[6])
                 + m[2] * (m[3] * m[7] - m[4] * m[6]);
        }

        /// <summary>row-major 3x3 同士の積。</summary>
        public static double[] Mul3(double[] a, double[] b)
        {
            var r = new double[9];
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++)
                {
                    double s = 0;
                    for (int k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
                    r[i * 3 + j] = s;
                }
            return r;
        }

        /// <summary>回転ベクトル (axis * angle) → 3x3 回転行列 (Rodrigues)。</summary>
        public static double[] Rodrigues(double wx, double wy, double wz)
        {
            double theta2 = wx * wx + wy * wy + wz * wz;
            var r = new double[9] { 1, 0, 0, 0, 1, 0, 0, 0, 1 };
            if (theta2 < 1e-24) 
            {
                // 一次近似 (I + w^) でも十分だが、GN の刻みが小さいときのみ通る
                r[1] = -wz; r[2] = wy;
                r[3] = wz;  r[5] = -wx;
                r[6] = -wy; r[7] = wx;
                return r;
            }

            double theta = Math.Sqrt(theta2);
            double c = Math.Cos(theta), s = Math.Sin(theta);
            double kx = wx / theta, ky = wy / theta, kz = wz / theta;
            double v = 1 - c;

            r[0] = c + kx * kx * v;      r[1] = kx * ky * v - kz * s; r[2] = kx * kz * v + ky * s;
            r[3] = ky * kx * v + kz * s; r[4] = c + ky * ky * v;      r[5] = ky * kz * v - kx * s;
            r[6] = kz * kx * v - ky * s; r[7] = kz * ky * v + kx * s; r[8] = c + kz * kz * v;
            return r;
        }
    }
}
