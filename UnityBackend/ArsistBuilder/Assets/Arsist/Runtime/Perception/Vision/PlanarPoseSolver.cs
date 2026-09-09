// ==============================================
// Arsist Engine - Perception / Vision
// 平面ターゲットの姿勢推定
//
//  1. ホモグラフィ + 内部パラメータから初期姿勢を閉形式で得る
//  2. 平面ターゲット固有の二重解（傾きの符号があいまい）を明示的に作る
//  3. 両方を Levenberg-Marquardt で再投影誤差最小化し、良い方を採る
//
// 精度はほぼ 3 で決まる。閉形式解は数度ずれることが普通にあるので、
// 全インライアを使った非線形最適化まで必ず通す。
//
// 座標系:
//   カメラ空間 = Unity のカメラローカル (x=右, y=上, z=前方)
//   画像座標   = 左下原点 (y は上向き)、u = fx*X/Z + cx, v = fy*Y/Z + cy
//   ターゲット = (x = 印刷面の右, y = 印刷面の上, z = 面の裏側へ)
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision
{
    public struct CameraIntrinsics
    {
        public double Fx, Fy, Cx, Cy;
    }

    internal sealed class PlanarPose
    {
        /// <summary>row-major 3x3。ターゲット座標 → カメラ座標の回転。</summary>
        public double[] R;
        /// <summary>カメラ座標でのターゲット原点。</summary>
        public double Tx, Ty, Tz;
        /// <summary>インライアの再投影 RMSE (px)。</summary>
        public double Rmse;
    }

    internal static class PlanarPoseSolver
    {
        /// <summary>
        /// ホモグラフィと対応点から姿勢を解く。
        /// </summary>
        /// <param name="objXY">ターゲット平面上のメートル座標 (x, y) — インライアのみ</param>
        /// <param name="imgUV">対応する画像ピクセル — インライアのみ</param>
        public static PlanarPose Solve(double[] h, in CameraIntrinsics k, double[] objXY, double[] imgUV, int n)
        {
            if (h == null || n < 4) return null;

            var seed = FromHomography(h, k);
            if (seed == null) return null;

            var twin = MakeTwin(seed);

            var a = Refine(seed, k, objXY, imgUV, n);
            var b = twin != null ? Refine(twin, k, objXY, imgUV, n) : null;

            if (a == null) return b;
            if (b == null) return a;
            return a.Rmse <= b.Rmse ? a : b;
        }

        /// <summary>閉形式の初期解。A = K⁻¹H の 1,2 列がスケール込みの r1, r2。</summary>
        private static PlanarPose FromHomography(double[] h, in CameraIntrinsics k)
        {
            // K⁻¹ = [[1/fx, 0, -cx/fx], [0, 1/fy, -cy/fy], [0,0,1]]
            var a = new double[9];
            for (int c = 0; c < 3; c++)
            {
                a[0 * 3 + c] = (h[0 * 3 + c] - k.Cx * h[2 * 3 + c]) / k.Fx;
                a[1 * 3 + c] = (h[1 * 3 + c] - k.Cy * h[2 * 3 + c]) / k.Fy;
                a[2 * 3 + c] = h[2 * 3 + c];
            }

            double n1 = Math.Sqrt(a[0] * a[0] + a[3] * a[3] + a[6] * a[6]);
            double n2 = Math.Sqrt(a[1] * a[1] + a[4] * a[4] + a[7] * a[7]);
            if (n1 < 1e-12 || n2 < 1e-12) return null;

            double lambda = 2.0 / (n1 + n2);

            double tz = a[8] * lambda;
            // ターゲットはカメラの前方 (z > 0) にあるはず
            if (tz < 0) lambda = -lambda;

            var r1 = new[] { a[0] * lambda, a[3] * lambda, a[6] * lambda };
            var r2 = new[] { a[1] * lambda, a[4] * lambda, a[7] * lambda };
            var t = new[] { a[2] * lambda, a[5] * lambda, a[8] * lambda };
            if (t[2] <= 1e-6) return null;

            var r3 = new[]
            {
                r1[1] * r2[2] - r1[2] * r2[1],
                r1[2] * r2[0] - r1[0] * r2[2],
                r1[0] * r2[1] - r1[1] * r2[0],
            };

            var m = new double[9]
            {
                r1[0], r2[0], r3[0],
                r1[1], r2[1], r3[1],
                r1[2], r2[2], r3[2],
            };

            return new PlanarPose { R = LinAlg.NearestRotation(m), Tx = t[0], Ty = t[1], Tz = t[2] };
        }

        /// <summary>
        /// 平面ターゲットの二重解。視線方向を軸に面法線を鏡映した姿勢が、
        /// ほぼ同じ再投影を与えるもう一方の解になる（IPPE のいう twin solution）。
        /// 遠距離・小面積のときに実際に取り違えるので、必ず両方評価する。
        /// </summary>
        private static PlanarPose MakeTwin(PlanarPose p)
        {
            double len = Math.Sqrt(p.Tx * p.Tx + p.Ty * p.Ty + p.Tz * p.Tz);
            if (len < 1e-9) return null;
            double vx = p.Tx / len, vy = p.Ty / len, vz = p.Tz / len;

            // 面法線 = R の3列目
            double nx = p.R[2], ny = p.R[5], nz = p.R[8];

            double dot = vx * nx + vy * ny + vz * nz;
            double mx = 2 * dot * vx - nx;
            double my = 2 * dot * vy - ny;
            double mz = 2 * dot * vz - nz;

            // n → m の回転
            double ax = ny * mz - nz * my;
            double ay = nz * mx - nx * mz;
            double az = nx * my - ny * mx;
            double axisLen = Math.Sqrt(ax * ax + ay * ay + az * az);
            if (axisLen < 1e-9) return null;

            double cos = nx * mx + ny * my + nz * mz;
            if (cos > 1) cos = 1; else if (cos < -1) cos = -1;
            double angle = Math.Acos(cos);
            if (angle < 1e-4) return null;

            var delta = LinAlg.Rodrigues(ax / axisLen * angle, ay / axisLen * angle, az / axisLen * angle);
            return new PlanarPose
            {
                R = LinAlg.NearestRotation(LinAlg.Mul3(delta, p.R)),
                Tx = p.Tx, Ty = p.Ty, Tz = p.Tz,
            };
        }

        /// <summary>Levenberg-Marquardt による再投影誤差最小化 (Huber ロバスト)。</summary>
        private static PlanarPose Refine(PlanarPose init, in CameraIntrinsics k, double[] objXY, double[] imgUV, int n)
        {
            const double HuberDelta = 2.0; // px
            var r = (double[])init.R.Clone();
            double tx = init.Tx, ty = init.Ty, tz = init.Tz;

            double lambda = 1e-3;
            double prevCost = Cost(r, tx, ty, tz, k, objXY, imgUV, n, HuberDelta, out _);

            var jtj = new double[36];
            var jtr = new double[6];
            var delta = new double[6];
            var jRow = new double[6]; // 行ごとの再確保を避ける（ワーカースレッドで毎秒回るため）

            for (int iter = 0; iter < 20; iter++)
            {
                Array.Clear(jtj, 0, 36);
                Array.Clear(jtr, 0, 6);

                for (int i = 0; i < n; i++)
                {
                    double ox = objXY[i * 2], oy = objXY[i * 2 + 1];
                    double px = r[0] * ox + r[1] * oy + tx;
                    double py = r[3] * ox + r[4] * oy + ty;
                    double pz = r[6] * ox + r[7] * oy + tz;
                    if (pz < 1e-6) continue;

                    double invZ = 1.0 / pz;
                    double u = k.Fx * px * invZ + k.Cx;
                    double v = k.Fy * py * invZ + k.Cy;
                    double ru = u - imgUV[i * 2];
                    double rv = v - imgUV[i * 2 + 1];

                    double err = Math.Sqrt(ru * ru + rv * rv);
                    double weight = err <= HuberDelta ? 1.0 : HuberDelta / err;

                    // dP/dω = -[P - t]×  （回転のみを左から摂動）
                    double qx = px - tx, qy = py - ty, qz = pz - tz;

                    // du/dP, dv/dP
                    double a0 = k.Fx * invZ, a2 = -k.Fx * px * invZ * invZ;
                    double b1 = k.Fy * invZ, b2 = -k.Fy * py * invZ * invZ;

                    // J_u = [du/dω(3), du/dt(3)]
                    // dP/dω rows: [[0, qz, -qy], [-qz, 0, qx], [qy, -qx, 0]]
                    double ju0 = a0 * 0 + a2 * qy;
                    double ju1 = a0 * qz + a2 * (-qx);
                    double ju2 = a0 * (-qy) + a2 * 0;
                    double ju3 = a0, ju4 = 0, ju5 = a2;

                    double jv0 = b1 * (-qz) + b2 * qy;
                    double jv1 = b1 * 0 + b2 * (-qx);
                    double jv2 = b1 * qx + b2 * 0;
                    double jv3 = 0, jv4 = b1, jv5 = b2;

                    jRow[0] = ju0; jRow[1] = ju1; jRow[2] = ju2; jRow[3] = ju3; jRow[4] = ju4; jRow[5] = ju5;
                    AccumulateRow(jtj, jtr, jRow, ru, weight);
                    jRow[0] = jv0; jRow[1] = jv1; jRow[2] = jv2; jRow[3] = jv3; jRow[4] = jv4; jRow[5] = jv5;
                    AccumulateRow(jtj, jtr, jRow, rv, weight);
                }

                bool improved = false;
                for (int attempt = 0; attempt < 6; attempt++)
                {
                    var a = (double[])jtj.Clone();
                    for (int d = 0; d < 6; d++) a[d * 6 + d] *= (1.0 + lambda);
                    var b = new double[6];
                    for (int d = 0; d < 6; d++) b[d] = -jtr[d];

                    if (!LinAlg.SolveLinear(a, b, 6, delta)) { lambda *= 10; continue; }

                    var rNew = LinAlg.Mul3(LinAlg.Rodrigues(delta[0], delta[1], delta[2]), r);
                    rNew = LinAlg.NearestRotation(rNew);
                    double txNew = tx + delta[3], tyNew = ty + delta[4], tzNew = tz + delta[5];
                    if (tzNew <= 1e-6) { lambda *= 10; continue; }

                    double cost = Cost(rNew, txNew, tyNew, tzNew, k, objXY, imgUV, n, HuberDelta, out _);
                    if (cost < prevCost)
                    {
                        r = rNew; tx = txNew; ty = tyNew; tz = tzNew;
                        double gain = prevCost - cost;
                        prevCost = cost;
                        lambda = Math.Max(lambda * 0.3, 1e-9);
                        improved = true;
                        if (gain < 1e-9) { attempt = 6; iter = 20; }
                        break;
                    }
                    lambda *= 10;
                }
                if (!improved) break;
            }

            Cost(r, tx, ty, tz, k, objXY, imgUV, n, HuberDelta, out double rmse);
            return new PlanarPose { R = r, Tx = tx, Ty = ty, Tz = tz, Rmse = rmse };
        }

        private static void AccumulateRow(double[] jtj, double[] jtr, double[] j, double residual, double weight)
        {
            for (int a = 0; a < 6; a++)
            {
                jtr[a] += weight * j[a] * residual;
                for (int b = 0; b < 6; b++) jtj[a * 6 + b] += weight * j[a] * j[b];
            }
        }

        private static double Cost(
            double[] r, double tx, double ty, double tz, in CameraIntrinsics k,
            double[] objXY, double[] imgUV, int n, double huber, out double rmse)
        {
            double cost = 0, sqSum = 0;
            int used = 0;
            for (int i = 0; i < n; i++)
            {
                double ox = objXY[i * 2], oy = objXY[i * 2 + 1];
                double px = r[0] * ox + r[1] * oy + tx;
                double py = r[3] * ox + r[4] * oy + ty;
                double pz = r[6] * ox + r[7] * oy + tz;
                if (pz < 1e-6) { cost += 1e6; continue; }

                double u = k.Fx * px / pz + k.Cx;
                double v = k.Fy * py / pz + k.Cy;
                double du = u - imgUV[i * 2];
                double dv = v - imgUV[i * 2 + 1];
                double e2 = du * du + dv * dv;
                double e = Math.Sqrt(e2);

                cost += e <= huber ? e2 : (2 * huber * e - huber * huber);
                sqSum += e2;
                used++;
            }
            rmse = used > 0 ? Math.Sqrt(sqSum / used) : double.MaxValue;
            return cost;
        }
    }
}
