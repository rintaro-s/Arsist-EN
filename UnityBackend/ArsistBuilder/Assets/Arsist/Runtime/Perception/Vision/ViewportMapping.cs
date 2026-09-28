// ==============================================
// Arsist Engine - Perception
// 切り出して縮めた画を、元のカメラの光線に戻すための換算
//
// 現実に重ねて描くには「この画素はどの向きか」が要る。ところが解析に渡す画は
//   静止画 → ビューポートの矩形で切り出し → 処理用に縮小
// と二段階で変形しているので、元の内部パラメータのままでは合わない。
// ここを間違えると、青空が空からずれた場所に貼り付く。
//
// UnityEngine に依存しないので tools/perception-check で数値検証できる。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision
{
    public static class ViewportMapping
    {
        /// <summary>
        /// 切り出しと縮小のあとの画に対応する内部パラメータを返す。
        ///
        /// 縮小後の画素 pu が覆うのは元画像の 1/scale 画素ぶんで、その「中心」が
        /// 対応点になる。つまり
        ///   u = cropX + (pu + 0.5) / scale - 0.5
        /// であって、u = cropX + pu / scale ではない
        /// (ColorImage.ScaledToWidth も (x + 0.5) * invX で標本を採っている)。
        /// これを u = Fx * x/z + Cx に代入して pu について解くと
        ///   Fx' = Fx * scale,  Cx' = scale * (Cx - cropX + 0.5) - 0.5
        /// になる。y も同様。
        ///
        /// 素直に scale を掛けるだけだと半画素ずれる。縮小率が大きいほど効いてきて、
        /// 空がわずかに横にずれた位置に貼り付く。
        /// </summary>
        /// <param name="source">静止画そのものの内部パラメータ。</param>
        /// <param name="cropX">切り出しの原点 (静止画のピクセル座標, 左下原点)。</param>
        /// <param name="cropY">同上。</param>
        /// <param name="scale">切り出したあとの縮小率 (処理後の幅 / 切り出し幅)。</param>
        public static CameraIntrinsics ForCrop(
            CameraIntrinsics source, double cropX, double cropY, double scale)
        {
            if (scale <= 0) throw new ArgumentOutOfRangeException(nameof(scale));

            return new CameraIntrinsics
            {
                Fx = source.Fx * scale,
                Fy = source.Fy * scale,
                Cx = scale * (source.Cx - cropX + 0.5) - 0.5,
                Cy = scale * (source.Cy - cropY + 0.5) - 0.5,
            };
        }

        /// <summary>
        /// 画像の四隅が、距離 distance の平面上でどの範囲になるかを返す。
        ///
        /// 画素の中心が 0..width-1 にあるので、画の縁は -0.5 と width-0.5。
        /// ここを width/2 で済ませると、画の端が半画素ぶんずれる。
        /// 返す値はカメラ座標 (右 +x, 上 +y, 前 +z)。
        /// </summary>
        /// <summary>
        /// 正規化した画素位置 (0..1、原点左下、blobs / infer の x, y) を、カメラ座標の方向にする。
        /// 画素の中心が 0..width-1 にあり、正規化は centroid / width なので u = nx * width。
        /// 返す方向は正規化しない (z = 1)。呼び出し側が距離を掛ける。
        /// </summary>
        public static void RayFromNormalized(
            CameraIntrinsics k, int width, int height, double nx, double ny,
            out double dx, out double dy, out double dz)
        {
            double u = nx * width;
            double v = ny * height;
            dx = (u - k.Cx) / k.Fx;
            dy = (v - k.Cy) / k.Fy;
            dz = 1.0;
        }

        public static void PlaneExtents(
            CameraIntrinsics k, int width, int height, double distance,
            out double left, out double right, out double bottom, out double top)
        {
            left = distance * (-0.5 - k.Cx) / k.Fx;
            right = distance * (width - 0.5 - k.Cx) / k.Fx;
            bottom = distance * (-0.5 - k.Cy) / k.Fy;
            top = distance * (height - 0.5 - k.Cy) / k.Fy;
        }
    }
}
