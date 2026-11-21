// ==============================================
// Arsist Engine - シミュレーター: 試す空間を世界の状態に入れる provider (doc/22-simulation.md)
// Assets/Arsist/Runtime/Simulation/SimulationSpaceProvider.cs
//
// 試す空間 (src/shared/layster/spatial/spaces.ts の fixture。scripts/sim/unity.mjs が JSON にして渡す) を、
// 部屋のスキャン (quest-room の MRUK) と同じ道で世界の状態に書く。置き方・規則・Mind は本物がそのまま動く。
// fixture は spatial の world (起動したときの足元が原点) で書かれているので、entity はそのまま入れる。
// 端末が部屋を知らない空間 (knows に 'scan' が無い) では何も書かない (床は組み込みの仮の床が出す)。
// Linux のプレイヤー (シミュレーター) にだけ入る。APK には入らない。
// ==============================================

#if UNITY_STANDALONE
using System.Collections.Generic;
using Arsist.Runtime.Spatial;
using Arsist.Runtime.Spatial.Core;
using UnityEngine;

namespace Arsist.Runtime.Simulation
{
    internal sealed class SimulationSpaceProvider : ISpatialProvider
    {
        private readonly List<Dictionary<string, object>> _entities;
        private readonly bool _scan;
        private readonly float _floorUnityY;
        private bool _written;

        public string Id => "simulation";

        public SimulationSpaceProvider(List<Dictionary<string, object>> entities, bool scan, float floorUnityY)
        {
            _entities = entities ?? new List<Dictionary<string, object>>();
            _scan = scan;
            _floorUnityY = floorUnityY;
        }

        public void Begin(SpatialProviderContext context)
        {
            // 床の高さはシミュレーターが決めている (頭 = Unity の原点、床 = -目の高さ)。部屋のスキャンと同じ確かさで伝える
            if (_scan) context.ReportFloor(_floorUnityY, 0.9, "simulation");
        }

        public void Tick(SpatialProviderContext context)
        {
            if (_written) return;
            _written = true;
            if (!_scan)
            {
                context.Log("simulation: this space has no room scan; only the assumed floor is known");
                context.Ready("simulation");
                return;
            }
            int n = 0;
            foreach (var d in _entities)
            {
                var e = Entity.FromPlain(d, "space");
                if (e == null) continue;
                var words = new List<string>();
                foreach (var w in e.Is) if (!string.IsNullOrEmpty(w)) words.Add(context.Canonical(w));
                e.Is = words;
                e.SeenAt = context.Now;
                context.Upsert(e);
                n++;
            }
            context.Log($"simulation: {n} entities from the test space");
            context.Ready("simulation");
        }
    }

    /// <summary>試す空間の箱を見えるように置く (パススルーの代わり。ArsistSimulator の別のカメラだけが描く)。当たり判定は付けない。</summary>
    internal static class SimulationRoom
    {
        public static GameObject Build(List<Dictionary<string, object>> entities, System.Func<Vec3, Vector3> toUnity, System.Func<double, Quaternion> yawToUnity)
        {
            var shader = Shader.Find("Hidden/ArsistSim/Room");
            if (shader == null)
            {
                Debug.LogWarning("[ArsistSim] room shader missing; the test space is not drawn");
                return null;
            }
            var root = new GameObject("[ArsistSim] test space");
            foreach (var d in entities)
            {
                var e = Entity.FromPlain(d, "space");
                if (e == null) continue;
                var word = e.Is.Count > 0 ? e.Is[0] : "";
                var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                go.name = "space:" + e.Id;
                Object.Destroy(go.GetComponent<Collider>());
                go.transform.SetParent(root.transform, false);
                go.layer = ArsistSimulator.RoomLayer;
                go.transform.position = toUnity(e.At);
                go.transform.rotation = yawToUnity(e.Yaw);
                go.transform.localScale = new Vector3(Thick(e.Size.X), Thick(e.Size.Y), Thick(e.Size.Z));
                var mat = new Material(shader) { color = ColorOf(word) };
                go.GetComponent<Renderer>().sharedMaterial = mat;
            }
            return root;
        }

        private static float Thick(double v) => Mathf.Max(0.01f, (float)v);

        private static Color ColorOf(string word)
        {
            switch ((word ?? "").ToLowerInvariant())
            {
                case "floor": return new Color(0.42f, 0.40f, 0.37f);
                case "wall": return new Color(0.80f, 0.78f, 0.74f);
                case "ceiling": return new Color(0.88f, 0.88f, 0.86f);
                case "desk":
                case "table": return new Color(0.58f, 0.40f, 0.25f);
                case "chair": return new Color(0.28f, 0.29f, 0.33f);
                case "bed": return new Color(0.62f, 0.67f, 0.78f);
                case "couch":
                case "sofa": return new Color(0.42f, 0.48f, 0.58f);
                case "shelf": return new Color(0.50f, 0.36f, 0.23f);
                case "screen":
                case "tv": return new Color(0.08f, 0.08f, 0.09f);
                case "laptop": return new Color(0.30f, 0.31f, 0.33f);
                case "plant": return new Color(0.25f, 0.50f, 0.25f);
                default: return new Color(0.62f, 0.62f, 0.60f);
            }
        }
    }
}
#endif
