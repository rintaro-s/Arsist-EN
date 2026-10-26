// ==============================================
// Arsist Extension: quest-input — grabbing objects (no code)
// samples/extensions/quest-input/Runtime/GrabSystem.cs
//
// 物のインスペクタで「つかめる」(ext.quest-input.grab = grab / throw) にした物を、
//   コントローラー: グリップを握る
//   手:            3D の物はつまむか握る / パネル (Canvas) は握る
//                  (パネルをつまむと、パネル上のボタンを押す操作とぶつかるため)
// で、手の届く距離 (見た目の範囲 + 6 cm) にあるときにつかんで動かせる。
// throw なら、離した瞬間の手の速さで投げる (重力つき。quest-room の当たり判定があれば本物の家具で止まる)。
//
// 当たり判定のコライダーは使わない (見た目の範囲で決める)。コライダーの無いパネルでもつかめるように。
//
// 遠くの物 (ext.quest-input.reach = far): 手の届く物が無いときに、コントローラーの向き (レイ、最長 20 m) で当たる物を
// グリップでつかむ。大きなスクリーンや奥の板の位置を微調整するためのもので、持っている間は
//   - 位置: コントローラーを動かした分 × 1〜2 倍 (遠いほど少し大きく) だけ動く (腕の振りで遠くの物が暴れない)
//   - 向き: コントローラーの水平の向きを変えた分だけ回る (傾かない。板は立ったまま)
//   - 持っている手のスティック上下: レイの向きに押す / 引く
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Extensions;
using Arsist.Runtime.Inference;
using UnityEngine;

namespace Arsist.Extensions.QuestInput
{
    internal sealed class GrabSystem
    {
        private const float Reach = 0.06f;

        private sealed class Held
        {
            public ArsistObjectExt Target;
            public Vector3 LocalPosition;
            public Quaternion LocalRotation;
            public bool WasKinematic;
            public bool HadBody;
            public string By;
            // 遠くからつかんだとき
            public bool Far;
            public Vector3 StartObject;
            public Quaternion StartRotation;
            public Vector3 StartController;
            public float StartYaw;
            public Vector3 PushDirection;
            public float Push;
            public float Gain = 1f;
        }

        private const float FarMaxDistance = 20f;

        private sealed class Source
        {
            public bool Active;
            public bool Down;
            public Pose Pose;
            public Vector3 Velocity;
            public string By;     // "controller" / "hand"
            public string HandGesture;
        }

        private readonly ArsistExtensionContext _ctx;
        private readonly Dictionary<string, Held> _held = new Dictionary<string, Held>();
        private readonly Dictionary<string, bool> _wasDown = new Dictionary<string, bool>();
        private readonly Dictionary<string, Vector3> _lastControllerPos = new Dictionary<string, Vector3>();
        private readonly Dictionary<string, Vector3> _controllerVelocity = new Dictionary<string, Vector3>();

        /// <summary>つかんだ (+1) / 離した (-1): (hand, object id, by)</summary>
        public event Action<int, string, string, string> Changed;

        public GrabSystem(ArsistExtensionContext ctx) { _ctx = ctx; }

        public string HeldBy(string hand) => _held.TryGetValue(hand, out var h) && h.Target != null ? IdOf(h.Target) : "";

        private static string IdOf(ArsistObjectExt obj) => !string.IsNullOrEmpty(obj.assetId) ? obj.assetId : obj.objectId;

        public void Update(ControllerReader controllers, HandReader hands, float dt)
        {
            foreach (var hand in new[] { "left", "right" })
            {
                var source = SourceFor(hand, controllers.Get(hand), hands.Get(hand), dt);
                _wasDown.TryGetValue(hand, out var wasDown);
                _wasDown[hand] = source.Down;

                if (_held.TryGetValue(hand, out var held) && held.Target == null) { _held.Remove(hand); held = null; }

                if (held != null)
                {
                    if (source.Active && source.Down && held.Far)
                    {
                        var c = controllers.Get(hand);
                        if (c != null) held.Push += c.Stick.y * 1.5f * dt;
                        var move = (source.Pose.position - held.StartController) * held.Gain + held.PushDirection * held.Push;
                        var yaw = Mathf.DeltaAngle(held.StartYaw, YawOf(source.Pose.rotation));
                        held.Target.transform.SetPositionAndRotation(
                            held.StartObject + move,
                            Quaternion.AngleAxis(yaw, Vector3.up) * held.StartRotation);
                    }
                    else if (source.Active && source.Down)
                    {
                        // 握っている間は手に付いてくる
                        held.Target.transform.SetPositionAndRotation(
                            source.Pose.position + source.Pose.rotation * held.LocalPosition,
                            source.Pose.rotation * held.LocalRotation);
                    }
                    else
                    {
                        Release(hand, held, source);
                    }
                    continue;
                }

                if (source.Active && source.Down && !wasDown)
                {
                    var target = FindTarget(source);
                    if (target != null) Grab(hand, target, source, controllers.Get(hand));
                    else if (source.By == "controller")
                    {
                        var c = controllers.Get(hand);
                        var aim = c != null && c.HasAim ? c.AimPose : source.Pose;
                        var far = FindFarTarget(new Ray(aim.position, aim.rotation * Vector3.forward), out var distance);
                        if (far != null) GrabFar(hand, far, source, aim, distance, c);
                    }
                }
            }
        }

        private Source SourceFor(string hand, ControllerState controller, HandState handState, float dt)
        {
            var s = new Source();
            if (controller != null && controller.Connected && controller.Tracked)
            {
                s.Active = true;
                s.By = "controller";
                s.Pose = controller.GripPose;
                s.Down = controller.Pressed.TryGetValue("grip", out var g) && g;
                var p = s.Pose.position;
                if (_lastControllerPos.TryGetValue(hand, out var last) && dt > 1e-4f)
                {
                    var v = (p - last) / dt;
                    _controllerVelocity.TryGetValue(hand, out var prev);
                    _controllerVelocity[hand] = Vector3.Lerp(prev, v, 0.5f);
                }
                _lastControllerPos[hand] = p;
                _controllerVelocity.TryGetValue(hand, out s.Velocity);
                return s;
            }
            _lastControllerPos.Remove(hand);

            if (handState != null && handState.Tracked)
            {
                s.Active = true;
                s.By = "hand";
                s.HandGesture = handState.Pinching ? "pinch" : handState.Gesture;
                s.Down = handState.Pinching || handState.Gesture == "fist";
                // つまんでいるならつまんだ点、握っているなら手のひら
                s.Pose = handState.Pinching ? new Pose(handState.PinchPoint, handState.Palm.rotation) : handState.Palm;
                s.Velocity = handState.Velocity;
            }
            return s;
        }

        private ArsistObjectExt FindTarget(Source source)
        {
            ArsistObjectExt best = null;
            float bestDistance = float.MaxValue;
            foreach (var obj in _ctx.ObjectsWithData())
            {
                if (IsHeld(obj)) continue;
                var data = _ctx.ObjectData(obj);
                var mode = MiniJson.Text(data, "grab", "none");
                if (mode != "grab" && mode != "throw") continue;
                var with = MiniJson.Text(data, "grabWith", "both");
                if (with == "controller" && source.By != "controller") continue;
                if (with == "hand" && source.By != "hand") continue;
                // パネルはつまんでは持たない (パネル上のボタンを押す操作とぶつかる)
                if (source.By == "hand" && source.HandGesture == "pinch" && obj.GetComponentInChildren<Canvas>() != null) continue;

                if (!TryWorldBounds(obj.gameObject, out var bounds)) continue;
                bounds.Expand(Reach * 2f);
                if (!bounds.Contains(source.Pose.position)) continue;
                var d = (bounds.center - source.Pose.position).sqrMagnitude;
                if (d < bestDistance) { best = obj; bestDistance = d; }
            }
            return best;
        }

        /// <summary>レイが当たる「遠くからつかめる」物のうち一番手前。</summary>
        private ArsistObjectExt FindFarTarget(Ray ray, out float distance)
        {
            ArsistObjectExt best = null;
            distance = float.MaxValue;
            foreach (var obj in _ctx.ObjectsWithData())
            {
                if (IsHeld(obj)) continue;
                var data = _ctx.ObjectData(obj);
                var mode = MiniJson.Text(data, "grab", "none");
                if (mode != "grab") continue; // 投げる物は遠くからは持たない
                if (MiniJson.Text(data, "reach", "near") != "far") continue;
                if (MiniJson.Text(data, "grabWith", "both") == "hand") continue;
                if (!TryWorldBounds(obj.gameObject, out var bounds)) continue;
                bounds.Expand(0.04f);
                if (!bounds.IntersectRay(ray, out var d) || d > FarMaxDistance) continue;
                if (d < distance) { best = obj; distance = d; }
            }
            return best;
        }

        private static float YawOf(Quaternion q)
        {
            var f = q * Vector3.forward;
            f.y = 0f;
            return f.sqrMagnitude < 1e-6f ? 0f : Mathf.Atan2(f.x, f.z) * Mathf.Rad2Deg;
        }

        private void GrabFar(string hand, ArsistObjectExt target, Source source, Pose aim, float distance, ControllerState controller)
        {
            var dir = aim.rotation * Vector3.forward;
            dir.y = 0f;
            dir = dir.sqrMagnitude < 1e-6f ? Vector3.forward : dir.normalized;
            var held = new Held
            {
                Target = target,
                By = source.By,
                Far = true,
                StartObject = target.transform.position,
                StartRotation = target.transform.rotation,
                StartController = source.Pose.position,
                StartYaw = YawOf(source.Pose.rotation),
                PushDirection = dir,
                Gain = Mathf.Clamp(1f + distance * 0.15f, 1f, 2f),
            };
            var body = target.GetComponent<Rigidbody>();
            if (body != null)
            {
                held.HadBody = true;
                held.WasKinematic = body.isKinematic;
                body.isKinematic = true;
            }
            _held[hand] = held;
            var data = _ctx.ObjectData(target);
            if (MiniJson.Bool(data, "hapticOnGrab", true)) controller?.Vibrate(0.35f, 0.05f);
            _ctx.Log($"'{target.name}' grabbed from {distance:F1} m with the {hand} controller (ray)");
            Changed?.Invoke(+1, hand, IdOf(target), "ray");
        }

        private bool IsHeld(ArsistObjectExt obj)
        {
            foreach (var h in _held.Values) if (h.Target == obj) return true;
            return false;
        }

        private void Grab(string hand, ArsistObjectExt target, Source source, ControllerState controller)
        {
            var inv = Quaternion.Inverse(source.Pose.rotation);
            var held = new Held
            {
                Target = target,
                LocalPosition = inv * (target.transform.position - source.Pose.position),
                LocalRotation = inv * target.transform.rotation,
                By = source.By,
            };
            var body = target.GetComponent<Rigidbody>();
            if (body != null)
            {
                held.HadBody = true;
                held.WasKinematic = body.isKinematic;
                body.isKinematic = true;
            }
            _held[hand] = held;

            var data = _ctx.ObjectData(target);
            if (source.By == "controller" && MiniJson.Bool(data, "hapticOnGrab", true)) controller?.Vibrate(0.35f, 0.05f);
            _ctx.Log($"'{target.name}' grabbed with the {hand} {source.By}");
            Changed?.Invoke(+1, hand, IdOf(target), source.By);
        }

        private void Release(string hand, Held held, Source source)
        {
            _held.Remove(hand);
            var target = held.Target;
            var data = _ctx.ObjectData(target);
            var mode = MiniJson.Text(data, "grab", "grab");

            var body = target.GetComponent<Rigidbody>();
            if (mode == "throw")
            {
                // 物理で飛ばす。コライダーが無ければ見た目の大きさで付ける
                if (target.GetComponentInChildren<Collider>() == null && TryWorldBounds(target.gameObject, out var b))
                {
                    var box = target.gameObject.AddComponent<BoxCollider>();
                    box.center = target.transform.InverseTransformPoint(b.center);
                    var ls = target.transform.lossyScale;
                    box.size = new Vector3(
                        b.size.x / Mathf.Max(1e-4f, Mathf.Abs(ls.x)),
                        b.size.y / Mathf.Max(1e-4f, Mathf.Abs(ls.y)),
                        b.size.z / Mathf.Max(1e-4f, Mathf.Abs(ls.z)));
                }
                if (body == null) body = target.gameObject.AddComponent<Rigidbody>();
                body.isKinematic = false;
                body.useGravity = true;
                body.linearVelocity = source.Active ? source.Velocity : Vector3.zero;
            }
            else if (body != null && held.HadBody)
            {
                body.isKinematic = held.WasKinematic;
            }

            _ctx.Log($"'{target.name}' released ({mode}{(mode == "throw" ? $", {source.Velocity.magnitude:F1} m/s" : "")})");
            Changed?.Invoke(-1, hand, IdOf(target), held.By);
        }

        /// <summary>物の見た目の範囲 (Renderer + World Space Canvas の矩形)。</summary>
        public static bool TryWorldBounds(GameObject go, out Bounds bounds)
        {
            bool any = false;
            bounds = default;
            foreach (var r in go.GetComponentsInChildren<Renderer>())
            {
                if (!r.enabled || r is ParticleSystemRenderer) continue;
                if (!any) { bounds = r.bounds; any = true; }
                else bounds.Encapsulate(r.bounds);
            }
            var corners = new Vector3[4];
            foreach (var canvas in go.GetComponentsInChildren<Canvas>())
            {
                if (canvas.renderMode != RenderMode.WorldSpace || !(canvas.transform is RectTransform rect)) continue;
                rect.GetWorldCorners(corners);
                foreach (var c in corners)
                {
                    if (!any) { bounds = new Bounds(c, Vector3.zero); any = true; }
                    else bounds.Encapsulate(c);
                }
            }
            return any;
        }
    }
}
