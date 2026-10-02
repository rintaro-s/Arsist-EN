// ==============================================
// Arsist Extension: quest-input — grabbing objects (no code)
// Extensions/quest-input/Runtime/GrabSystem.cs
//
// 物のインスペクタで「つかめる」(ext.quest-input.grab = grab / throw) にした物を、
//   コントローラー: グリップを握る
//   手:            3D の物はつまむか握る / パネル (Canvas) は握る
//                  (パネルをつまむと、パネル上のボタンを押す操作とぶつかるため)
// で、手の届く距離 (見た目の範囲 + 6 cm) にあるときにつかんで動かせる。
// throw なら、離した瞬間の手の速さで投げる (重力つき。quest-room の当たり判定があれば本物の家具で止まる)。
//
// 当たり判定のコライダーは使わない (見た目の範囲で決める)。コライダーの無いパネルでもつかめるように。
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
        }

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
                    if (source.Active && source.Down)
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
