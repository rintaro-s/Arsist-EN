// ==============================================
// Arsist Engine - Layster.Spatial: つかんで動かす (things[].grabbable)
// Assets/Arsist/Runtime/Spatial/SpatialGrab.cs
//
// grabbable: true の物 (world に置いた物だけ。head / hand に付く物はつかめない) を、
//   コントローラー  グリップを握る (トリガーは UI を押す方なので使わない)
//   手 (XR Hands)   親指と人差し指でつまむ
// でつかむ。手 / コントローラーが物の箱 (+6 cm) の中にあればそのまま、無ければ前へのレイ (5 m) が当たった物。
// 持っている間は、つかんだときの「手から見た物の位置と水平の向き」を保って付いて来る (重力に沿ったまま。傾けない)。
// 離したら、そこが新しい置き場所 (ThingPlacer.Released)。載っている面を探して host にし、keep: forever なら覚え直す。
//
// 端末に依らない: 位置は XR の入力デバイス (UnityEngine.XR.InputDevices) と XR Hands (XR_HANDS のビルドだけ) から読む。
// 当たり判定のコライダーは使わない (置いた姿勢と箱の大きさで決める。パネルや目印でもつかめるように)。
// 手でパネルをつまむとき、レイがボタンなど押せる UI に当たっていれば、つかまない (押す方を優先する)。
//
// 出来事: grabbed / released (data = { thing, hand, by, at, yaw[, host] }) と、物ごとの grabbed:<id> / released:<id>。
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
    public sealed class SpatialGrab
    {
        private const float Reach = 0.06f;
        private const float RayLength = 5f;
        private const float PinchOn = 0.025f;
        private const float PinchOff = 0.035f;

        private sealed class Source
        {
            public bool Active;
            public bool Down;
            public string By;          // "controller" / "hand"
            public Vector3 Position;   // Unity
            public Vector3 Direction;  // Unity。レイの向き
            public InputDevice Device;
        }

        private sealed class Hand
        {
            public readonly string Name;
            public bool WasDown;
            public bool Pinching;
            public ThingBinding Held;
            public string By;
            /// <summary>つかんだときの、手 (位置と水平の向き) から見た物の中心と向き</summary>
            public Vec3 Offset;
            public double YawOffset;

            public Hand(string name) { Name = name; }
        }

        private readonly ArsistSpatialRuntime _rt;
        private readonly Hand[] _hands = { new Hand("left"), new Hand("right") };
        private readonly List<InputDevice> _devices = new List<InputDevice>();
        private readonly bool _any;
#if XR_HANDS
        private readonly List<XRHandSubsystem> _handSubsystems = new List<XRHandSubsystem>();
#endif

        public SpatialGrab(ArsistSpatialRuntime runtime)
        {
            _rt = runtime;
            foreach (var t in runtime.Model.Things)
            {
                if (!t.Grabbable) continue;
                var mode = t.Place?.Mode ?? "world";
                if (mode == "head" || mode == "hand")
                {
                    Debug.LogWarning($"[Layster] thing '{t.Id}' is grabbable but attached to the {mode}; it cannot be grabbed");
                    continue;
                }
                _any = true;
            }
            if (_any) Debug.Log($"[Layster] grab: on (controllers: grip, hands: pinch){(runtime.Model.Controllers ? "" : " — controllers off")}{(runtime.Model.Hands ? "" : " — hands off")}");
        }

        /// <summary>今つかんでいる物の id (無ければ null)。</summary>
        public string HeldBy(string hand)
        {
            foreach (var h in _hands) if (h.Name == hand && h.Held != null) return h.Held.Def.Id;
            return null;
        }

        public void Tick()
        {
            if (!_any || !_rt.Frames.Initialized || _rt.User.Head == null) return;
            foreach (var hand in _hands)
            {
                var source = Read(hand);
                bool pressed = source.Active && source.Down && !hand.WasDown;
                hand.WasDown = source.Active && source.Down;

                if (hand.Held != null)
                {
                    if (hand.Held.Root == null) { hand.Held.Held = false; hand.Held = null; continue; }
                    if (source.Active && source.Down) Follow(hand, source);
                    else Release(hand, source);
                    continue;
                }
                if (pressed) TryGrab(hand, source);
            }
        }

        // ========================================
        // 入力
        // ========================================

        private Source Read(Hand hand)
        {
            var side = hand.Name == "left" ? InputDeviceCharacteristics.Left : InputDeviceCharacteristics.Right;
            var s = new Source();
            if (_rt.Model.Controllers)
            {
                _devices.Clear();
                InputDevices.GetDevicesWithCharacteristics(side | InputDeviceCharacteristics.Controller, _devices);
                foreach (var d in _devices)
                {
                    if (!d.isValid || (d.characteristics & InputDeviceCharacteristics.HandTracking) != 0) continue;
                    if (d.TryGetFeatureValue(CommonUsages.isTracked, out var tracked) && !tracked) continue;
                    if (!d.TryGetFeatureValue(CommonUsages.devicePosition, out var p) || !d.TryGetFeatureValue(CommonUsages.deviceRotation, out var r)) continue;
                    s.Active = true;
                    s.By = "controller";
                    s.Device = d;
                    s.Position = TrackingToWorld(p);
                    s.Direction = TrackingRotation() * (r * Vector3.forward);
                    bool grip = d.TryGetFeatureValue(CommonUsages.gripButton, out var g) && g;
                    if (!grip && d.TryGetFeatureValue(CommonUsages.grip, out float amount)) grip = amount > 0.55f;
                    s.Down = grip;
                    return s;
                }
            }
#if XR_HANDS
            if (_rt.Model.Hands) ReadHand(hand, s);
#endif
            return s;
        }

#if XR_HANDS
        private void ReadHand(Hand hand, Source s)
        {
            _handSubsystems.Clear();
            SubsystemManager.GetSubsystems(_handSubsystems);
            foreach (var sub in _handSubsystems)
            {
                if (sub == null || !sub.running) continue;
                var h = hand.Name == "left" ? sub.leftHand : sub.rightHand;
                if (!h.isTracked
                    || !h.GetJoint(XRHandJointID.ThumbTip).TryGetPose(out var thumb)
                    || !h.GetJoint(XRHandJointID.IndexTip).TryGetPose(out var tip)
                    || !h.GetJoint(XRHandJointID.IndexProximal).TryGetPose(out var proximal))
                {
                    hand.Pinching = false;
                    return;
                }
                float gap = Vector3.Distance(thumb.position, tip.position);
                hand.Pinching = hand.Pinching ? gap <= PinchOff : gap <= PinchOn;
                s.Active = true;
                s.By = "hand";
                s.Down = hand.Pinching;
                s.Position = TrackingToWorld((thumb.position + tip.position) * 0.5f);
                var dir = TrackingToWorld(tip.position) - TrackingToWorld(proximal.position);
                s.Direction = dir.sqrMagnitude > 1e-8f ? dir.normalized : _rt.User.Head.forward;
                return;
            }
            hand.Pinching = false;
        }
#endif

        /// <summary>追跡空間 → world (カメラの親。SpatialUser と同じ)。</summary>
        private Vector3 TrackingToWorld(Vector3 p)
        {
            var parent = _rt.User.Head != null ? _rt.User.Head.parent : null;
            return parent != null ? parent.TransformPoint(p) : p;
        }

        private Quaternion TrackingRotation()
        {
            var parent = _rt.User.Head != null ? _rt.User.Head.parent : null;
            return parent != null ? parent.rotation : Quaternion.identity;
        }

        // ========================================
        // つかむ・動かす・離す
        // ========================================

        private void TryGrab(Hand hand, Source source)
        {
            var frames = _rt.Frames;
            var at = frames.FromUnity(source.Position);
            var dir = frames.DirectionFromUnity(source.Direction);
            ThingBinding best = null;
            double bestScore = double.MaxValue;
            bool uiChecked = false, onUi = false;
            foreach (var b in _rt.Placer.Bindings)
            {
                if (!b.Def.Grabbable || !b.Placed || b.Held || b.IsAttached || !b.AppliedVisible || b.Root == null) continue;
                if (IsHeldElsewhere(b)) continue;
                double score;
                if (Inside(b, at, Reach)) score = 0;               // 手の中 (一番先)
                else if (RayHit(b, at, dir, out var t)) score = 1 + t; // レイの当たり (近い順)
                else continue;
                // 手でパネルをつまんだとき、押せる UI を指していれば押す方を優先する
                if (source.By == "hand" && b.Def.IsCanvas)
                {
                    if (!uiChecked) { uiChecked = true; onUi = PointsAtInteractiveUi(source); }
                    if (onUi) continue;
                }
                if (score < bestScore) { bestScore = score; best = b; }
            }
            if (best == null) return;

            double sourceYaw = SourceYaw(source);
            hand.Held = best;
            hand.By = source.By;
            hand.Offset = SpatialMath.PointToFrame(best.Pose.At, at, sourceYaw);
            hand.YawOffset = SpatialMath.NormYaw(best.Pose.Yaw - sourceYaw);
            best.Held = true;
            if (source.By == "controller" && source.Device.isValid) source.Device.SendHapticImpulse(0, 0.35f, 0.05f);
            Debug.Log($"[Layster] grabbed {best.Def.Id} with the {hand.Name} {source.By}");
            Fire("grabbed", best, hand, null);
        }

        private bool IsHeldElsewhere(ThingBinding b)
        {
            foreach (var h in _hands) if (h.Held == b) return true;
            return false;
        }

        private void Follow(Hand hand, Source source)
        {
            var b = hand.Held;
            var at = _rt.Frames.FromUnity(source.Position);
            double sourceYaw = SourceYaw(source);
            var center = SpatialMath.FrameToWorld(hand.Offset, at, sourceYaw);
            // 床より下には沈めない (箱の底が床の上)
            double half = b.Def.Size.Y / 2;
            if (center.Y < half) center = new Vec3(center.X, half, center.Z);
            _rt.Placer.HoldAt(b, new SpatialPose(center, SpatialMath.NormYaw(sourceYaw + hand.YawOffset)));
        }

        private void Release(Hand hand, Source source)
        {
            var b = hand.Held;
            hand.Held = null;
            var host = SupportUnder(b);
            _rt.Placer.Released(b, b.Pose, host);
            if (source.Active && source.By == "controller" && source.Device.isValid) source.Device.SendHapticImpulse(0, 0.2f, 0.03f);
            Debug.Log($"[Layster] released {b.Def.Id} at {b.Pose.At}{(host != null ? $" on {host}" : "")}");
            Fire("released", b, hand, host);
        }

        private void Fire(string name, ThingBinding b, Hand hand, string host)
        {
            var data = new Dictionary<string, object>
            {
                ["thing"] = b.Def.Id,
                ["hand"] = hand.Name,
                ["by"] = hand.By,
                ["at"] = b.Pose.At.ToPlainRounded(),
                ["yaw"] = SpatialMath.Round3(b.Pose.Yaw),
            };
            if (host != null) data["host"] = host;
            _rt.Events.Emit(name, data, b.Def.Id);
            _rt.Events.Emit($"{name}:{b.Def.Id}", data, b.Def.Id);
        }

        /// <summary>手の水平の向き (spatial の yaw)。真上・真下を向いているときは頭の向き。</summary>
        private double SourceYaw(Source source)
        {
            var f = source.Direction;
            f.y = 0;
            if (f.sqrMagnitude < 1e-4f) return _rt.User.Yaw;
            return _rt.Frames.YawFromForward(f);
        }

        // ========================================
        // 形の計算 (spatial の world。箱の中心 = 置いた姿勢)
        // ========================================

        private static bool Inside(ThingBinding b, Vec3 p, double margin)
        {
            var l = SpatialMath.PointToFrame(p, b.Pose.At, b.Pose.Yaw);
            var s = b.Def.Size;
            return System.Math.Abs(l.X) <= s.X / 2 + margin && System.Math.Abs(l.Y) <= s.Y / 2 + margin && System.Math.Abs(l.Z) <= s.Z / 2 + margin;
        }

        /// <summary>レイと向きのある箱 (slab 法)。t はレイの原点からの距離。</summary>
        private static bool RayHit(ThingBinding b, Vec3 origin, Vec3 direction, out double t)
        {
            t = 0;
            var o = SpatialMath.PointToFrame(origin, b.Pose.At, b.Pose.Yaw);
            var d = SpatialMath.DirectionToFrame(direction, b.Pose.Yaw);
            // 薄い物 (パネル・札・目印) も指せるように、少し厚みを持たせる
            var s = b.Def.Size;
            double[] half = { System.Math.Max(s.X / 2, 0.03), System.Math.Max(s.Y / 2, 0.03), System.Math.Max(s.Z / 2, 0.03) };
            double[] oo = { o.X, o.Y, o.Z };
            double[] dd = { d.X, d.Y, d.Z };
            double near = 0, far = RayLength;
            for (int i = 0; i < 3; i++)
            {
                if (System.Math.Abs(dd[i]) < 1e-9)
                {
                    if (System.Math.Abs(oo[i]) > half[i]) return false;
                    continue;
                }
                double t1 = (-half[i] - oo[i]) / dd[i];
                double t2 = (half[i] - oo[i]) / dd[i];
                if (t1 > t2) { var x = t1; t1 = t2; t2 = x; }
                if (t1 > near) near = t1;
                if (t2 < far) far = t2;
                if (near > far) return false;
            }
            t = near;
            return true;
        }

        private bool PointsAtInteractiveUi(Source source)
        {
            if (!UI.ArsistUiPointer.RaycastScene(new Ray(source.Position, source.Direction), RayLength, out var hit, out _) || hit == null) return false;
            return hit.GetComponent<Input.ArsistGazeTarget>() != null || hit.GetComponent<UnityEngine.UI.Selectable>() != null;
        }

        /// <summary>
        /// 離した物が載っている面 (keep: forever の基準・観測の host)。箱の底が上面から -5 〜 +15 cm にあり、
        /// 中心が上面の範囲にある、水平な entity のうち一番高いもの。無ければ、表から 15 cm 以内にある縦の面 (壁)。
        /// </summary>
        private string SupportUnder(ThingBinding b)
        {
            var vocab = _rt.Model.Vocabulary;
            var p = b.Pose.At;
            double bottom = p.Y - b.Def.Size.Y / 2;
            string best = null;
            double bestTop = double.MinValue;
            string wall = null;
            double wallGap = double.MaxValue;
            foreach (var e in _rt.World.Entities())
            {
                var l = SpatialMath.PointToFrame(p, e.At, e.Yaw);
                if (vocab.IsVertical(e))
                {
                    if (System.Math.Abs(l.X) > e.Size.X / 2 || System.Math.Abs(l.Y) > e.Size.Y / 2) continue;
                    double gap = l.Z - e.Size.Z / 2;
                    if (gap < -0.05 || gap > 0.15) continue;
                    if (gap < wallGap) { wallGap = gap; wall = e.Id; }
                    continue;
                }
                if (System.Math.Abs(l.X) > e.Size.X / 2 || System.Math.Abs(l.Z) > e.Size.Z / 2) continue;
                double top = e.At.Y + e.Size.Y / 2;
                if (bottom < top - 0.05 || bottom > top + 0.15) continue;
                if (top > bestTop) { bestTop = top; best = e.Id; }
            }
            return best ?? wall;
        }
    }
}
