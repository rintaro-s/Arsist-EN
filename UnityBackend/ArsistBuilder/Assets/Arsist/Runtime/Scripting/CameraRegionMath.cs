// ==============================================
// Arsist Engine - camera.* の幾何 (UnityEngine に依存しない)
//
// ワールドの点 → カメラの画のピクセル、と「ワールドの点のまわり size m 四方」→ 画の切り出し枠。
// 規約は認識側 (ArsistPerceptionManager.TryGetRegionQuad) と同じ:
//   カメラ座標 = inverse(カメラの回転) * (ワールド - カメラの位置)   (Unity のカメラ空間: +x 右・+y 上・+z 前)
//   u = Fx * x / z + Cx,  v = Fy * y / z + Cy
//   画の行は「下から上」(ColorImage / GrayImage の規約。読み出しの行順は実行時に測って揃えてある)
// なので v は画の下端から数えたピクセル。スクリプトへ返すときは上端を 0 にする (画像の普通の向き)。
//
// tools/perception-check で検証している。
// ==============================================

using System;

namespace Arsist.Runtime.Scripting
{
    public struct CameraPoseData
    {
        public double Px, Py, Pz;
        /// <summary>回転 (クォータニオン x, y, z, w)</summary>
        public double Qx, Qy, Qz, Qw;
    }

    public struct PixelRect
    {
        /// <summary>左下の画素 (行は下から上)</summary>
        public int X, Y, Width, Height;
    }

    public static class CameraRegionMath
    {
        /// <summary>ワールドの点をカメラ座標へ。</summary>
        public static void WorldToCamera(in CameraPoseData pose, double wx, double wy, double wz,
            out double cx, out double cy, out double cz)
        {
            double dx = wx - pose.Px, dy = wy - pose.Py, dz = wz - pose.Pz;
            // 逆回転 = 共役クォータニオンで回す
            RotateByQuaternion(-pose.Qx, -pose.Qy, -pose.Qz, pose.Qw, dx, dy, dz, out cx, out cy, out cz);
        }

        /// <summary>v' = q v q* (q は単位クォータニオンとみなして正規化する)。</summary>
        public static void RotateByQuaternion(double qx, double qy, double qz, double qw,
            double vx, double vy, double vz, out double rx, out double ry, out double rz)
        {
            double n = Math.Sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
            if (n < 1e-12) { rx = vx; ry = vy; rz = vz; return; }
            qx /= n; qy /= n; qz /= n; qw /= n;
            // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
            double tx = 2 * (qy * vz - qz * vy);
            double ty = 2 * (qz * vx - qx * vz);
            double tz = 2 * (qx * vy - qy * vx);
            rx = vx + qw * tx + (qy * tz - qz * ty);
            ry = vy + qw * ty + (qz * tx - qx * tz);
            rz = vz + qw * tz + (qx * ty - qy * tx);
        }

        /// <summary>
        /// ワールドの点がどこに写るか。u, v はピクセル (v は下端から)。
        /// カメラの後ろ (z ≤ 0) なら false。画の外でも true を返す (inView で見分ける)。
        /// </summary>
        public static bool Project(in CameraPoseData pose, double fx, double fy, double cxPix, double cyPix,
            double wx, double wy, double wz, out double u, out double v, out double depth)
        {
            WorldToCamera(pose, wx, wy, wz, out var x, out var y, out var z);
            depth = z;
            if (z <= 1e-4) { u = v = double.NaN; return false; }
            u = fx * x / z + cxPix;
            v = fy * y / z + cyPix;
            return true;
        }

        /// <summary>
        /// ワールドの点のまわり size m 四方 (カメラに正対した正方形) が写っている枠。画の中に切り詰める。
        /// 点がカメラの後ろか、枠が画にまったく掛からなければ false。
        /// 小さすぎる枠 (8 px 未満) も false (送っても何も読めない)。
        /// </summary>
        public static bool RegionAround(in CameraPoseData pose, double fx, double fy, double cxPix, double cyPix,
            int imageWidth, int imageHeight, double wx, double wy, double wz, double size, out PixelRect rect)
        {
            rect = default;
            if (size <= 0 || imageWidth <= 0 || imageHeight <= 0) return false;
            if (!Project(pose, fx, fy, cxPix, cyPix, wx, wy, wz, out var u, out var v, out var depth)) return false;

            double halfU = Math.Abs(fx) * (size * 0.5) / depth;
            double halfV = Math.Abs(fy) * (size * 0.5) / depth;
            double x0 = Math.Max(0, Math.Floor(u - halfU));
            double x1 = Math.Min(imageWidth, Math.Ceiling(u + halfU));
            double y0 = Math.Max(0, Math.Floor(v - halfV));
            double y1 = Math.Min(imageHeight, Math.Ceiling(v + halfV));
            if (x1 - x0 < 8 || y1 - y0 < 8) return false;

            rect = new PixelRect { X = (int)x0, Y = (int)y0, Width = (int)(x1 - x0), Height = (int)(y1 - y0) };
            return true;
        }

        /// <summary>RGB24 (行は下から上) の一部を切り出す。</summary>
        public static byte[] CropRgb(byte[] rgb, int width, int height, PixelRect r)
        {
            if (r.X < 0 || r.Y < 0 || r.X + r.Width > width || r.Y + r.Height > height) throw new ArgumentException("rect out of image");
            var dst = new byte[r.Width * r.Height * 3];
            for (int row = 0; row < r.Height; row++)
                Buffer.BlockCopy(rgb, ((r.Y + row) * width + r.X) * 3, dst, row * r.Width * 3, r.Width * 3);
            return dst;
        }

        /// <summary>RGB24 を幅 maxWidth 以下に縮める (面積平均)。縮める必要が無ければそのまま返す。</summary>
        public static byte[] DownscaleRgb(byte[] rgb, int width, int height, int maxWidth, out int outWidth, out int outHeight)
        {
            if (maxWidth <= 0 || width <= maxWidth)
            {
                outWidth = width; outHeight = height;
                return rgb;
            }
            outWidth = maxWidth;
            outHeight = Math.Max(1, (int)Math.Round((double)height * maxWidth / width));
            var dst = new byte[outWidth * outHeight * 3];
            double sx = (double)width / outWidth, sy = (double)height / outHeight;
            for (int y = 0; y < outHeight; y++)
            {
                int y0 = (int)(y * sy), y1 = Math.Max(y0 + 1, Math.Min(height, (int)((y + 1) * sy)));
                for (int x = 0; x < outWidth; x++)
                {
                    int x0 = (int)(x * sx), x1 = Math.Max(x0 + 1, Math.Min(width, (int)((x + 1) * sx)));
                    int r = 0, g = 0, b = 0, n = 0;
                    for (int yy = y0; yy < y1; yy++)
                    {
                        int i = (yy * width + x0) * 3;
                        for (int xx = x0; xx < x1; xx++, i += 3) { r += rgb[i]; g += rgb[i + 1]; b += rgb[i + 2]; n++; }
                    }
                    int o = (y * outWidth + x) * 3;
                    dst[o] = (byte)(r / n); dst[o + 1] = (byte)(g / n); dst[o + 2] = (byte)(b / n);
                }
            }
            return dst;
        }
    }
}
