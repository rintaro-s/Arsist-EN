// ==============================================
// Arsist Engine - Layster.Spatial: ユーザー (頭・手・視線)
// Assets/Arsist/Runtime/Spatial/SpatialUser.cs
//
// 頭はメインカメラ (ViewerWrapper と同じ見つけ方)。手は
//   1. XR Hands (XR_HANDS のビルドだけ) の手のひら
//   2. XR の入力デバイス (手 / コントローラー) の位置
// の順。どちらも追跡空間の座標なので、カメラの親 (XR Origin の Camera Offset) で world に直す。
// 視線は頭の正面の光線が当たった物 (thing) か、正面 15° 以内で一番近い entity。
// ==============================================

using System.Collections.Generic;
using Arsist.Runtime.Spatial.Core;
using UnityEngine;
using UnityEngine.XR;
#if XR_HANDS
using UnityEngine.XR.Hands;
#endif

namespace Arsist.Runtime.Spatial
{
    public sealed class SpatialUser
    {
        private Camera _camera;
        private readonly List<InputDevice> _devices = new List<InputDevice>();
#if XR_HANDS
        private readonly List<XRHandSubsystem> _handSubsystems = new List<XRHandSubsystem>();
#endif

        public Transform Head { get; private set; }
        public bool HasHead => Head != null;

        // spatial の world
        public Vec3 HeadAt;
        public Vec3 Forward = new Vec3(0, 0, 1);
        public Vec3 Feet;
        public double Yaw;
        public Vec3? LeftHand;
        public Vec3? RightHand;
        public double EyeHeight = 1.6;
        /// <summary>手の Unity での位置 (安全の門・描画用)</summary>
        public Vector3? LeftHandUnity;
        public Vector3? RightHandUnity;

        public Camera Camera => ResolveCamera();

        private Camera ResolveCamera()
        {
            if (_camera != null && _camera.isActiveAndEnabled) return _camera;
            _camera = Camera.main;
            if (_camera == null)
            {
#if UNITY_2023_1_OR_NEWER
                _camera = Object.FindFirstObjectByType<Camera>();
#else
                _camera = Object.FindObjectOfType<Camera>();
#endif
            }
            Head = _camera != null ? _camera.transform : null;
            return _camera;
        }

        /// <summary>追跡空間 → world (カメラの親)。親が無ければそのまま。</summary>
        private Vector3 TrackingToWorld(Vector3 p)
        {
            var parent = Head != null ? Head.parent : null;
            return parent != null ? parent.TransformPoint(p) : p;
        }

        public void Update(SpatialFrames frames)
        {
            if (ResolveCamera() == null) return;
            if (!frames.Initialized) return;
            var hp = Head.position;
            HeadAt = frames.FromUnity(hp);
            Forward = frames.DirectionFromUnity(Head.forward);
            Yaw = frames.YawFromForward(Head.forward);
            Feet = new Vec3(HeadAt.X, 0, HeadAt.Z);
            EyeHeight = System.Math.Max(0.3, HeadAt.Y);

            LeftHandUnity = null;
            RightHandUnity = null;
#if XR_HANDS
            ReadXrHands();
#endif
            if (LeftHandUnity == null) LeftHandUnity = DevicePosition(InputDeviceCharacteristics.Left);
            if (RightHandUnity == null) RightHandUnity = DevicePosition(InputDeviceCharacteristics.Right);
            LeftHand = LeftHandUnity.HasValue ? frames.FromUnity(LeftHandUnity.Value) : (Vec3?)null;
            RightHand = RightHandUnity.HasValue ? frames.FromUnity(RightHandUnity.Value) : (Vec3?)null;
        }

#if XR_HANDS
        private void ReadXrHands()
        {
            _handSubsystems.Clear();
            SubsystemManager.GetSubsystems(_handSubsystems);
            foreach (var s in _handSubsystems)
            {
                if (s == null || !s.running) continue;
                if (s.leftHand.isTracked && s.leftHand.GetJoint(XRHandJointID.Palm).TryGetPose(out var l)) LeftHandUnity = TrackingToWorld(l.position);
                if (s.rightHand.isTracked && s.rightHand.GetJoint(XRHandJointID.Palm).TryGetPose(out var r)) RightHandUnity = TrackingToWorld(r.position);
                return;
            }
        }
#endif

        private Vector3? DevicePosition(InputDeviceCharacteristics side)
        {
            _devices.Clear();
            InputDevices.GetDevicesWithCharacteristics(side | InputDeviceCharacteristics.HandTracking, _devices);
            if (_devices.Count == 0) InputDevices.GetDevicesWithCharacteristics(side | InputDeviceCharacteristics.Controller, _devices);
            foreach (var d in _devices)
            {
                if (!d.isValid) continue;
                if (d.TryGetFeatureValue(CommonUsages.isTracked, out var tracked) && !tracked) continue;
                if (d.TryGetFeatureValue(CommonUsages.devicePosition, out var p)) return TrackingToWorld(p);
            }
            return null;
        }

        /// <summary>手 (両方、分からない手は null) を spatial で。</summary>
        public Vec3?[] Hands => new[] { LeftHand, RightHand };

        public SolveUser ToSolveUser() => new SolveUser { At = Feet, Yaw = Yaw, EyeHeight = EyeHeight };
    }
}
