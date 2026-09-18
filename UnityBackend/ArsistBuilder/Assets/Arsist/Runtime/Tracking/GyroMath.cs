// ==============================================
// Arsist Engine - Tracking
// スマホのジャイロ姿勢を、Unity のカメラ回転に直す
//
// 符号をひとつ間違えても動いてしまい、実機で「首を振ると逆に回る」「下を向くと空が映る」
// という形でしか分からない。なのでここだけ UnityEngine から切り離し、
// tools/perception-check で数値検証している。触ったら必ず npm run test:perception。
//
// 式の出典:
//   - 右手系 → 左手系の変換 (x, y, -z, -w) は Unity 公式の Gyroscope リファレンス
//     https://docs.unity3d.com/ScriptReference/Gyroscope.html
//   - 背面カメラ向きへの基準回転 Euler(90,0,0) と、画面の向きごとの補正
//     (landscapeLeft = Euler(0,0,-90) など) は、広く使われている GyroController の形
//
// 合成の順:
//   camera = Recenter * BaseIdentity * Convert(attitude) * OrientationFix
//   - BaseIdentity   : 端末を平らに置いた状態 (画面が上) を、背面カメラが下を向く姿勢にする
//   - OrientationFix : 画面の向きに合わせて視線まわりに回す (後から掛ける = カメラ自身の軸で回る)
//   - Recenter       : 起動時に正面を +Z に揃える。方位は端末ごとにばらばらなので絶対値は使わない
// ==============================================

using System;

namespace Arsist.Runtime.Tracking
{
    /// <summary>UnityEngine.Quaternion と同じ規約の最小限の四元数。テストで使うため自前で持つ。</summary>
    public struct Quat
    {
        public double X, Y, Z, W;

        public Quat(double x, double y, double z, double w) { X = x; Y = y; Z = z; W = w; }

        public static readonly Quat Identity = new Quat(0, 0, 0, 1);

        public static Quat operator *(Quat a, Quat b) => new Quat(
            a.W * b.X + a.X * b.W + a.Y * b.Z - a.Z * b.Y,
            a.W * b.Y - a.X * b.Z + a.Y * b.W + a.Z * b.X,
            a.W * b.Z + a.X * b.Y - a.Y * b.X + a.Z * b.W,
            a.W * b.W - a.X * b.X - a.Y * b.Y - a.Z * b.Z);

        public static Quat AxisAngle(double ax, double ay, double az, double degrees)
        {
            double half = degrees * Math.PI / 360.0;
            double s = Math.Sin(half);
            double length = Math.Sqrt(ax * ax + ay * ay + az * az);
            return new Quat(ax / length * s, ay / length * s, az / length * s, Math.Cos(half));
        }

        /// <summary>
        /// Unity の Quaternion.Euler と同じ。Z → X → Y の順に回す (= qY * qX * qZ)。
        /// </summary>
        public static Quat Euler(double x, double y, double z) =>
            AxisAngle(0, 1, 0, y) * AxisAngle(1, 0, 0, x) * AxisAngle(0, 0, 1, z);

        /// <summary>ベクトルを回す。</summary>
        public void Rotate(double vx, double vy, double vz, out double rx, out double ry, out double rz)
        {
            // v' = q v q*
            double tx = 2 * (Y * vz - Z * vy);
            double ty = 2 * (Z * vx - X * vz);
            double tz = 2 * (X * vy - Y * vx);
            rx = vx + W * tx + (Y * tz - Z * ty);
            ry = vy + W * ty + (Z * tx - X * tz);
            rz = vz + W * tz + (X * ty - Y * tx);
        }
    }

    /// <summary>画面の向き。UnityEngine.ScreenOrientation と対応させる。</summary>
    public enum GyroScreenOrientation
    {
        Portrait,
        PortraitUpsideDown,
        LandscapeLeft,
        LandscapeRight,
    }

    public static class GyroMath
    {
        /// <summary>端末を平らに置いた状態 (画面が上) を、背面カメラが真下を向く姿勢にする。</summary>
        public static readonly Quat BaseIdentity = Quat.Euler(90, 0, 0);

        /// <summary>ジャイロの右手系を Unity の左手系に直す (Unity 公式リファレンスの式)。</summary>
        public static Quat Convert(Quat attitude) =>
            new Quat(attitude.X, attitude.Y, -attitude.Z, -attitude.W);

        /// <summary>
        /// 画面の向きに合わせた、視線まわりの補正。
        /// 後から掛けるのでカメラ自身の前向き軸で回り、見ている方向は変わらない。
        /// </summary>
        public static Quat OrientationFix(GyroScreenOrientation orientation)
        {
            switch (orientation)
            {
                case GyroScreenOrientation.LandscapeLeft: return Quat.Euler(0, 0, -90);
                case GyroScreenOrientation.LandscapeRight: return Quat.Euler(0, 0, 90);
                case GyroScreenOrientation.PortraitUpsideDown: return Quat.Euler(0, 0, 180);
                default: return Quat.Identity;
            }
        }

        /// <summary>ジャイロ姿勢 → カメラ回転 (正面合わせの前)。</summary>
        public static Quat DeviceToCamera(Quat attitude, GyroScreenOrientation orientation) =>
            BaseIdentity * Convert(attitude) * OrientationFix(orientation);

        /// <summary>
        /// 今の向きを正面 (+Z) にするための補正。方位 (Y 軸まわり) だけを打ち消す。
        ///
        /// 上下の傾きまで打ち消すと、下を向いた瞬間に正面合わせをしたときに
        /// 地平線が傾いたままになる。重力の向きは信用できるので、そちらは残す。
        /// </summary>
        public static Quat RecenterFor(Quat camera)
        {
            camera.Rotate(0, 0, 1, out double fx, out _, out double fz);
            // 真上・真下を向いているときは方位が決まらない。その場合は何もしない。
            if (fx * fx + fz * fz < 1e-6) return Quat.Identity;
            double yaw = Math.Atan2(fx, fz) * 180.0 / Math.PI;
            return Quat.Euler(0, -yaw, 0);
        }

        /// <summary>カメラの前向きベクトル (Unity の +Z を回したもの)。</summary>
        public static void Forward(Quat camera, out double x, out double y, out double z) =>
            camera.Rotate(0, 0, 1, out x, out y, out z);

        /// <summary>カメラの上向きベクトル (Unity の +Y を回したもの)。</summary>
        public static void Up(Quat camera, out double x, out double y, out double z) =>
            camera.Rotate(0, 1, 0, out x, out y, out z);
    }
}
