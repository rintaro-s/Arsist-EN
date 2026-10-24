// ==============================================
// Arsist Engine - Layster.Spatial: spatial の world ↔ Unity の world
// Assets/Arsist/Runtime/Spatial/SpatialFrames.cs
//
// 変換はここ 1 か所だけで行う (doc/19-layster.md §4.1、doc/20-spatial-runtime.md §2)。
//
//   spatial の world: 原点 = 起動したときのユーザーの足元 (床の高さ)、+Z = 起動したときの水平の向き
//   Unity の world  : 原点 = 起動したときの頭 (PinSpawnViewpointToOrigin)。端末によっては床が原点のこともある
//
// どちらも右・上・前 (RUF) で、yaw の向きも同じ (Unity の Quaternion.Euler(0, yaw, 0) * forward = (sin, 0, cos))。
// 違うのは原点と向きだけなので、起動したときの頭の位置・水平の向きと床の高さを覚えておけば足りる。
// 床の高さは、分かる端末 (Floor の追跡・部屋のスキャン) ならそれ、分からなければ頭 − assumedEyeHeight。
// 後から床が分かったら (部屋のスキャンが届いたら) 高さだけ直し、Changed で知らせる。
// ==============================================

using System;
using Arsist.Runtime.Spatial.Core;
using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    public sealed class SpatialFrames
    {
        private Vector3 _origin;
        private float _yaw0;

        public bool Initialized { get; private set; }
        public float FloorY => _origin.y;
        public bool FloorKnown { get; private set; }
        public double FloorConfidence { get; private set; }
        /// <summary>起動したときの頭の Unity での位置 (原点の上の目)</summary>
        public Vector3 StartHead { get; private set; }

        /// <summary>床の高さが変わった (置いた物の Unity での位置を直す)。</summary>
        public event Action Changed;

        public void Initialize(Vector3 headPosition, Vector3 headForward, double assumedEyeHeight)
        {
            var f = new Vector3(headForward.x, 0, headForward.z);
            _yaw0 = f.sqrMagnitude > 1e-6f ? Mathf.Atan2(f.x, f.z) * Mathf.Rad2Deg : 0f;
            StartHead = headPosition;
            _origin = new Vector3(headPosition.x, headPosition.y - (float)assumedEyeHeight, headPosition.z);
            FloorKnown = false;
            FloorConfidence = 0.3;
            Initialized = true;
            Debug.Log($"[Layster] frames: origin {_origin} yaw {_yaw0:0.0}° (floor assumed {assumedEyeHeight:0.00} m below the eyes)");
        }

        /// <summary>
        /// 床の Unity での高さを知らせる。今より確かなときだけ使う。
        /// 目の高さとして無理な値 (0.5 m 未満・2.3 m 超) は捨てる (別の部屋の床・天井を掴んだときなど)。
        /// </summary>
        public bool ReportFloor(float unityY, double confidence, string from)
        {
            if (!Initialized) return false;
            if (confidence <= FloorConfidence + 1e-6) return false;
            float eye = StartHead.y - unityY;
            if (eye < 0.5f || eye > 2.3f)
            {
                Debug.LogWarning($"[Layster] frames: ignored a floor from {from} at {unityY:0.00} (eyes would be {eye:0.00} m above it)");
                return false;
            }
            bool moved = Mathf.Abs(unityY - _origin.y) > 0.005f;
            _origin.y = unityY;
            FloorKnown = true;
            FloorConfidence = confidence;
            Debug.Log($"[Layster] frames: floor from {from} at Unity y {unityY:0.000} (eyes {eye:0.00} m, confidence {confidence:0.00})");
            if (moved) Changed?.Invoke();
            return true;
        }

        public Vector3 ToUnity(Vec3 p)
        {
            SpatialMath.Rotate(p.X, p.Z, _yaw0, out var x, out var z);
            return new Vector3(_origin.x + (float)x, _origin.y + (float)p.Y, _origin.z + (float)z);
        }

        public Vec3 FromUnity(Vector3 u)
        {
            SpatialMath.Rotate(u.x - _origin.x, u.z - _origin.z, -_yaw0, out var x, out var z);
            return new Vec3(x, u.y - _origin.y, z);
        }

        /// <summary>向き (方向ベクトル) を spatial に。</summary>
        public Vec3 DirectionFromUnity(Vector3 d)
        {
            SpatialMath.Rotate(d.x, d.z, -_yaw0, out var x, out var z);
            return new Vec3(x, d.y, z);
        }

        public float YawToUnity(double yaw) => (float)(yaw + _yaw0);

        public double YawFromUnity(float unityYaw) => SpatialMath.NormYaw(unityYaw - _yaw0);

        /// <summary>前の向き (Unity) から spatial の yaw。真上・真下を向いていると 0。</summary>
        public double YawFromForward(Vector3 forward)
        {
            var f = new Vector3(forward.x, 0, forward.z);
            if (f.sqrMagnitude < 1e-8f) return 0;
            return SpatialMath.NormYaw(Mathf.Atan2(f.x, f.z) * Mathf.Rad2Deg - _yaw0);
        }

        public Quaternion RotationToUnity(double yaw) => Quaternion.Euler(0, YawToUnity(yaw), 0);
    }
}
