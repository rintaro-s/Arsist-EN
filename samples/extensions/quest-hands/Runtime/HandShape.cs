// ==============================================
// Arsist Extension: quest-hands — 片手の形
// samples/extensions/quest-hands/Runtime/HandShape.cs
//
// XR Hands の 26 関節から、指 (関節の間をつなぐカプセル) と手のひらを作り、毎フレーム実際の手に重ねる。
// メッシュを持たない (OpenXR の手のメッシュに頼らない) ので、関節が読めるどの手でも同じ形になる。
// 当たり判定は持たない (UI の指し示しや「つかめる物」を邪魔しない)。
// ==============================================

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.XR.Hands;

namespace Arsist.Extensions.QuestHands
{
    internal sealed class HandShape
    {
        // 関節 a → b をつなぐ骨と、その太さ (半径 m。XR Hands が関節の半径をくれればそちらを使う)
        private static readonly (XRHandJointID A, XRHandJointID B, float Radius)[] Bones =
        {
            (XRHandJointID.Wrist, XRHandJointID.ThumbMetacarpal, 0.017f),
            (XRHandJointID.ThumbMetacarpal, XRHandJointID.ThumbProximal, 0.0145f),
            (XRHandJointID.ThumbProximal, XRHandJointID.ThumbDistal, 0.0115f),
            (XRHandJointID.ThumbDistal, XRHandJointID.ThumbTip, 0.0098f),

            (XRHandJointID.IndexMetacarpal, XRHandJointID.IndexProximal, 0.0115f),
            (XRHandJointID.IndexProximal, XRHandJointID.IndexIntermediate, 0.0095f),
            (XRHandJointID.IndexIntermediate, XRHandJointID.IndexDistal, 0.0085f),
            (XRHandJointID.IndexDistal, XRHandJointID.IndexTip, 0.0075f),

            (XRHandJointID.MiddleMetacarpal, XRHandJointID.MiddleProximal, 0.0115f),
            (XRHandJointID.MiddleProximal, XRHandJointID.MiddleIntermediate, 0.0098f),
            (XRHandJointID.MiddleIntermediate, XRHandJointID.MiddleDistal, 0.0088f),
            (XRHandJointID.MiddleDistal, XRHandJointID.MiddleTip, 0.0077f),

            (XRHandJointID.RingMetacarpal, XRHandJointID.RingProximal, 0.011f),
            (XRHandJointID.RingProximal, XRHandJointID.RingIntermediate, 0.0092f),
            (XRHandJointID.RingIntermediate, XRHandJointID.RingDistal, 0.0083f),
            (XRHandJointID.RingDistal, XRHandJointID.RingTip, 0.0073f),

            (XRHandJointID.LittleMetacarpal, XRHandJointID.LittleProximal, 0.0105f),
            (XRHandJointID.LittleProximal, XRHandJointID.LittleIntermediate, 0.0082f),
            (XRHandJointID.LittleIntermediate, XRHandJointID.LittleDistal, 0.0074f),
            (XRHandJointID.LittleDistal, XRHandJointID.LittleTip, 0.0066f),

            // 手のひら: 手首から各指の付け根へ (隙間を埋める)、付け根の列
            (XRHandJointID.Wrist, XRHandJointID.IndexProximal, 0.012f),
            (XRHandJointID.Wrist, XRHandJointID.MiddleProximal, 0.013f),
            (XRHandJointID.Wrist, XRHandJointID.RingProximal, 0.013f),
            (XRHandJointID.Wrist, XRHandJointID.LittleProximal, 0.012f),
            (XRHandJointID.IndexProximal, XRHandJointID.LittleProximal, 0.011f),
        };

        private readonly GameObject _root;
        private readonly Transform[] _bones;
        private readonly Transform _palm;
        private readonly List<Renderer> _renderers = new List<Renderer>();
        private readonly Pose[] _poses = new Pose[XRHandJointID.EndMarker.ToIndex()];
        private readonly float[] _radii = new float[XRHandJointID.EndMarker.ToIndex()];
        private readonly bool[] _has = new bool[XRHandJointID.EndMarker.ToIndex()];

        public HandShape(string name, Transform parent, Material material)
        {
            _root = new GameObject(name);
            _root.transform.SetParent(parent, false);
            _bones = new Transform[Bones.Length];
            for (int i = 0; i < Bones.Length; i++) _bones[i] = Piece(PrimitiveType.Capsule, $"{Bones[i].A}-{Bones[i].B}", material);
            _palm = Piece(PrimitiveType.Cube, "Palm", material);
            _root.SetActive(false);
        }

        private Transform Piece(PrimitiveType type, string name, Material material)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            var collider = go.GetComponent<Collider>();
            if (collider != null) Object.Destroy(collider);
            var r = go.GetComponent<Renderer>();
            r.sharedMaterial = material;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            _renderers.Add(r);
            go.transform.SetParent(_root.transform, false);
            return go.transform;
        }

        public void SetMaterial(Material material)
        {
            foreach (var r in _renderers) if (r != null) r.sharedMaterial = material;
        }

        public void Hide()
        {
            if (_root.activeSelf) _root.SetActive(false);
        }

        /// <summary>関節を読んで形を重ねる。手が追跡できていなければ隠す。</summary>
        public void Update(XRHand hand, Transform space)
        {
            if (!hand.isTracked)
            {
                Hide();
                return;
            }

            for (int i = XRHandJointID.BeginMarker.ToIndex(); i < XRHandJointID.EndMarker.ToIndex(); i++)
            {
                var joint = hand.GetJoint(XRHandJointIDUtility.FromIndex(i));
                _has[i] = joint.TryGetPose(out var pose);
                if (!_has[i]) continue;
                _poses[i] = space != null ? new Pose(space.TransformPoint(pose.position), space.rotation * pose.rotation) : pose;
                _radii[i] = joint.TryGetRadius(out var radius) ? radius : 0f;
            }

            for (int i = 0; i < Bones.Length; i++)
            {
                var (a, b, fallback) = Bones[i];
                int ia = a.ToIndex(), ib = b.ToIndex();
                var t = _bones[i];
                if (!_has[ia] || !_has[ib])
                {
                    t.gameObject.SetActive(false);
                    continue;
                }
                t.gameObject.SetActive(true);
                // 実際の関節の半径は指先側が小さいので、骨の根元の半径を使う (細すぎ・太すぎは抑える)
                float radius = _radii[ia] > 0.003f ? Mathf.Clamp(_radii[ia], fallback * 0.7f, fallback * 1.4f) : fallback;
                PlaceCapsule(t, _poses[ia].position, _poses[ib].position, radius);
            }

            PlacePalm();
            if (!_root.activeSelf) _root.SetActive(true);
        }

        /// <summary>カプセル (高さ 2・半径 0.5、Y 軸向き) を a → b に、両端が丸く収まるように置く。</summary>
        private static void PlaceCapsule(Transform t, Vector3 a, Vector3 b, float radius)
        {
            var d = b - a;
            float length = d.magnitude;
            t.position = (a + b) * 0.5f;
            t.rotation = length > 1e-5f ? Quaternion.FromToRotation(Vector3.up, d / length) : Quaternion.identity;
            t.localScale = new Vector3(radius * 2f, (length + radius * 2f) * 0.5f, radius * 2f);
        }

        /// <summary>手のひらの板: 手首から指の付け根の列まで、人差し指から小指までの幅。</summary>
        private void PlacePalm()
        {
            int w = XRHandJointID.Wrist.ToIndex();
            int index = XRHandJointID.IndexProximal.ToIndex();
            int little = XRHandJointID.LittleProximal.ToIndex();
            if (!_has[w] || !_has[index] || !_has[little])
            {
                _palm.gameObject.SetActive(false);
                return;
            }
            _palm.gameObject.SetActive(true);
            var wrist = _poses[w].position;
            var knuckles = (_poses[index].position + _poses[little].position) * 0.5f;
            var forward = knuckles - wrist;
            var side = _poses[index].position - _poses[little].position;
            float length = forward.magnitude;
            if (length < 1e-4f || side.sqrMagnitude < 1e-8f) return;
            var up = Vector3.Cross(forward, side);
            _palm.SetPositionAndRotation((wrist + knuckles) * 0.5f, Quaternion.LookRotation(forward / length, up.normalized));
            _palm.localScale = new Vector3(side.magnitude + 0.006f, 0.02f, length * 0.92f);
        }
    }
}
