// ==============================================
// Arsist Extension: quest-input — hand gesture maths (UnityEngine-free)
// samples/extensions/quest-input/Runtime/HandGestureMath.cs
//
// 指の関節の位置 (XR Hands の XRHandJointID と同じ並び) から、ジェスチャーを決める。
// UnityEngine に依存しないので、tools/perception-check で合成した手の形で数値検証している
// (npm run test:perception の HandGestureChecks)。しきい値をいじったら必ず回すこと —
// 実機では「グーがパーに見える」としか分からない。
//
// 指の「曲がり」は、中手骨 → 基節の向きと、基節 → 指先の向きのなす角 (度) で見る。
//   まっすぐ伸ばす ≈ 0°、軽く曲げる ≈ 40〜70°、握る ≈ 150° 以上
// 角度で見るのは、手の大きさや手首の向きに左右されないため。
// ==============================================

using System;

namespace Arsist.Extensions.QuestInput
{
    public struct V3
    {
        public float X, Y, Z;
        public V3(float x, float y, float z) { X = x; Y = y; Z = z; }
        public static V3 operator -(V3 a, V3 b) => new V3(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
        public static V3 operator +(V3 a, V3 b) => new V3(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
        public static V3 operator *(V3 a, float s) => new V3(a.X * s, a.Y * s, a.Z * s);
        public float Length => (float)Math.Sqrt(X * X + Y * Y + Z * Z);
        public static float Dot(V3 a, V3 b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;
        public static float Distance(V3 a, V3 b) => (a - b).Length;
        public V3 Normalized
        {
            get { var l = Length; return l > 1e-6f ? new V3(X / l, Y / l, Z / l) : new V3(0, 0, 0); }
        }

        /// <summary>2 つの向きのなす角 (度)。どちらかの長さが 0 なら 0。</summary>
        public static float Angle(V3 a, V3 b)
        {
            var la = a.Length;
            var lb = b.Length;
            if (la < 1e-6f || lb < 1e-6f) return 0f;
            var c = Dot(a, b) / (la * lb);
            if (c > 1f) c = 1f;
            if (c < -1f) c = -1f;
            return (float)(Math.Acos(c) * 180.0 / Math.PI);
        }
    }

    /// <summary>XR Hands の XRHandJointID と同じ番号 (Wrist = 1 … LittleTip = 26)。</summary>
    public static class Joint
    {
        public const int Wrist = 1, Palm = 2;
        public const int ThumbMetacarpal = 3, ThumbProximal = 4, ThumbDistal = 5, ThumbTip = 6;
        public const int IndexMetacarpal = 7, IndexProximal = 8, IndexIntermediate = 9, IndexDistal = 10, IndexTip = 11;
        public const int MiddleMetacarpal = 12, MiddleProximal = 13, MiddleIntermediate = 14, MiddleDistal = 15, MiddleTip = 16;
        public const int RingMetacarpal = 17, RingProximal = 18, RingIntermediate = 19, RingDistal = 20, RingTip = 21;
        public const int LittleMetacarpal = 22, LittleProximal = 23, LittleIntermediate = 24, LittleDistal = 25, LittleTip = 26;
        public const int Count = 27;
    }

    public enum Finger { Thumb, Index, Middle, Ring, Little }

    public static class HandGestureMath
    {
        // 伸びている / 握っている の境目 (度)。間はどちらでもない (ジェスチャーとしては数えない)。
        public const float ExtendedBelow = 50f;
        public const float CurledAbove = 100f;
        public const float ThumbExtendedBelow = 35f;

        // ピンチ (親指と人差し指の指先の距離, m)。始まりと終わりで差を付け、境目で点滅しないようにする。
        public const float PinchStart = 0.02f;
        public const float PinchEnd = 0.035f;
        public const float PinchNone = 0.07f;

        private static int Metacarpal(Finger f) => f switch
        {
            Finger.Thumb => Joint.ThumbMetacarpal,
            Finger.Index => Joint.IndexMetacarpal,
            Finger.Middle => Joint.MiddleMetacarpal,
            Finger.Ring => Joint.RingMetacarpal,
            _ => Joint.LittleMetacarpal,
        };

        private static int Proximal(Finger f) => Metacarpal(f) + 1;

        private static int Tip(Finger f) => f == Finger.Thumb ? Joint.ThumbTip : Metacarpal(f) + 4;

        /// <summary>指の曲がり (度)。0 = まっすぐ。</summary>
        public static float Bend(V3[] joints, Finger finger)
        {
            var m = joints[Metacarpal(finger)];
            var p = joints[Proximal(finger)];
            var t = joints[Tip(finger)];
            return V3.Angle(p - m, t - p);
        }

        public static bool IsExtended(V3[] joints, Finger finger) =>
            Bend(joints, finger) < (finger == Finger.Thumb ? ThumbExtendedBelow : ExtendedBelow);

        public static bool IsCurled(V3[] joints, Finger finger) => Bend(joints, finger) > CurledAbove;

        public static float PinchDistance(V3[] joints) => V3.Distance(joints[Joint.ThumbTip], joints[Joint.IndexTip]);

        /// <summary>ピンチの強さ 0..1 (PinchNone で 0、PinchStart 以下で 1)。</summary>
        public static float PinchStrength(V3[] joints)
        {
            var d = PinchDistance(joints);
            var s = (PinchNone - d) / (PinchNone - PinchStart);
            return s < 0f ? 0f : s > 1f ? 1f : s;
        }

        /// <summary>ピンチ中か (前のフレームの状態を渡すと、ヒステリシスが掛かる)。</summary>
        public static bool IsPinching(V3[] joints, bool wasPinching) =>
            PinchDistance(joints) <= (wasPinching ? PinchEnd : PinchStart);

        /// <summary>
        /// ジェスチャーの名前: fist / thumbsUp / pinch / point / peace / open / none。
        /// up は世界の上向き (重力の反対)。
        /// </summary>
        public static string Classify(V3[] joints, bool pinching, V3 up)
        {
            if (joints == null || joints.Length < Joint.Count) return "none";

            bool iCurl = IsCurled(joints, Finger.Index);
            bool mCurl = IsCurled(joints, Finger.Middle);
            bool rCurl = IsCurled(joints, Finger.Ring);
            bool lCurl = IsCurled(joints, Finger.Little);
            bool iExt = IsExtended(joints, Finger.Index);
            bool mExt = IsExtended(joints, Finger.Middle);
            bool rExt = IsExtended(joints, Finger.Ring);
            bool lExt = IsExtended(joints, Finger.Little);

            if (iCurl && mCurl && rCurl && lCurl)
            {
                var thumbDir = (joints[Joint.ThumbTip] - joints[Joint.ThumbProximal]).Normalized;
                bool thumbOut = IsExtended(joints, Finger.Thumb);
                if (thumbOut && V3.Dot(thumbDir, up.Normalized) > 0.7f) return "thumbsUp";
                return "fist";
            }
            if (pinching) return "pinch";
            if (iExt && mCurl && rCurl && lCurl) return "point";
            if (iExt && mExt && rCurl && lCurl) return "peace";
            if (iExt && mExt && rExt && lExt) return "open";
            return "none";
        }
    }
}
