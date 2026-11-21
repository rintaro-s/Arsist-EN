// ==============================================
// Arsist Engine - Layster.Spatial: 何を見ているか
// Assets/Arsist/Runtime/Spatial/SpatialGaze.cs
//
// 頭の正面 (目の向きではない) から:
//   thing   見えている物のうち、正面との角度が「物の見かけの半径 (最低 4°)」以内で一番正面に近いもの
//   entity  正面 12° 以内で一番近い entity (床・壁・天井は除く)
//   point   見ている物 / entity の中心 (spatial)
// 規則の gaze と、Mind の観測の user.gaze が使う。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Spatial.Core;
using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    public sealed class SpatialGaze
    {
        private readonly ArsistSpatialRuntime _rt;

        public string Thing { get; private set; }
        public string Entity { get; private set; }
        public Vec3? Point { get; private set; }

        public SpatialGaze(ArsistSpatialRuntime runtime)
        {
            _rt = runtime;
        }

        public void Update()
        {
            Thing = null;
            Entity = null;
            Point = null;
            var head = _rt.User.Head;
            if (head == null || _rt.Placer == null || !_rt.Frames.Initialized) return;
            var origin = head.position;
            var forward = head.forward;

            float best = float.MaxValue;
            foreach (var b in _rt.Placer.Bindings)
            {
                if (!b.Placed || !b.AppliedVisible || b.IsAttached) continue;
                var c = _rt.Frames.ToUnity(b.Pose.At);
                var to = c - origin;
                float dist = to.magnitude;
                if (dist < 0.05f) continue;
                float radius = (float)Math.Max(b.Def.Size.X, b.Def.Size.Y) / 2;
                float limit = Mathf.Max(4f, Mathf.Atan2(radius, dist) * Mathf.Rad2Deg);
                float angle = Vector3.Angle(forward, to);
                if (angle <= limit && angle < best) { best = angle; Thing = b.Def.Id; Point = b.Pose.At; }
            }
            if (Thing != null) return;

            float bestDist = float.MaxValue;
            foreach (var e in _rt.World.Entities())
            {
                if (e.Is.Count > 0)
                {
                    var w = _rt.Model.Vocabulary.Lookup(e.Is[0]);
                    if (w != null && w.Structural) continue;
                }
                var c = _rt.Frames.ToUnity(e.At);
                var to = c - origin;
                float dist = to.magnitude;
                if (dist < 0.05f || Vector3.Angle(forward, to) > 12f) continue;
                if (dist < bestDist) { bestDist = dist; Entity = e.Id; Point = e.At; }
            }
        }

        public Dictionary<string, object> ToPlain()
        {
            if (Thing == null && Entity == null) return null;
            return new Dictionary<string, object>
            {
                ["thing"] = Thing,
                ["entity"] = Entity,
                ["point"] = Point.HasValue ? Point.Value.ToPlainRounded() : null,
            };
        }
    }
}
