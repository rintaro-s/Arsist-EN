// ==============================================
// Arsist Engine - Layster.Spatial: 本物の物の陰に隠れる (things[].occlusion)
// Assets/Arsist/Runtime/Spatial/SpatialOcclusion.cs
//
// 部屋の形を知っている provider (ISpatialOccluderSource。見本は quest-room の MRUK) が出した箱を、
// 「深度だけ書く」箱としてシーンに置く (Resources/ArsistSpatialOccluder.shader、Queue Geometry-10)。
//   occlusion: "auto" (既定)  何もしない。箱より先には描かれないので、本物の壁・家具の向こうにあると深度で負けて隠れる
//   occlusion: "off"          不透明な部分 (renderQueue < 2500) を Queue 1985 へ移し、箱より先に描く → 隠れない
//                             (半透明の部分と、パネル・札の Canvas は Transparent の列で描かれるので、まだ隠れうる)
// 箱を出す provider が無ければ何も置かない (現実が分からない端末では、何も隠れない)。
// presentation.reality = "virtual-room" では置かない (仮の部屋の面が、普通の深度で同じことをする)。
// 当たり判定は付けない。層は Ignore Raycast (UI を指すレイを止めない)。
// ==============================================

using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    public sealed class SpatialOcclusion
    {
        private const string ShaderName = "ArsistSpatialOccluder";
        /// <summary>occlusion: "off" の物を描く列 (箱は Geometry-10 = 1990)</summary>
        private const int BeforeOccluders = 1985;
        private const int IgnoreRaycastLayer = 2;

        private sealed class SourceState
        {
            public int Version = int.MinValue;
            public readonly List<GameObject> Boxes = new List<GameObject>();
        }

        private readonly ArsistSpatialRuntime _rt;
        private readonly Dictionary<ISpatialOccluderSource, SourceState> _sources = new Dictionary<ISpatialOccluderSource, SourceState>();
        private readonly List<SpatialOccluder> _buffer = new List<SpatialOccluder>();
        private readonly HashSet<int> _lifted = new HashSet<int>();
        private readonly bool _anyAuto;
        private readonly bool _anyOff;
        private Material _material;
        private Mesh _cube;
        private bool _failed;
        private double _nextLift;
        private GameObject _root;

        public int OccluderCount { get; private set; }

        public SpatialOcclusion(ArsistSpatialRuntime runtime)
        {
            _rt = runtime;
            foreach (var t in runtime.Model.Things)
            {
                if (t.Occlusion == "off") _anyOff = true;
                else _anyAuto = true;
            }
        }

        public void Tick()
        {
            if (_failed || !_anyAuto || _rt.Model.Reality == "virtual-room") return;
            foreach (var p in SpatialProviders.All)
            {
                if (!(p is ISpatialOccluderSource source)) continue;
                if (!_sources.TryGetValue(source, out var state)) _sources[source] = state = new SourceState();
                int version;
                try { version = source.OccluderVersion; }
                catch (System.Exception e) { Debug.LogWarning($"[Layster] occluders from {p.Id}: {e.Message}"); continue; }
                if (version == state.Version) continue;
                state.Version = version;
                Rebuild(p.Id, source, state);
            }
            if (_anyOff && OccluderCount > 0 && _rt.Now >= _nextLift)
            {
                // VRM やモデルは後から読み込まれるので、ときどき見直す
                _nextLift = _rt.Now + 1.0;
                LiftOffThings();
            }
        }

        private void Rebuild(string id, ISpatialOccluderSource source, SourceState state)
        {
            foreach (var go in state.Boxes) if (go != null) Object.Destroy(go);
            OccluderCount -= state.Boxes.Count;
            state.Boxes.Clear();
            _buffer.Clear();
            try { source.CollectOccluders(_buffer); }
            catch (System.Exception e) { Debug.LogWarning($"[Layster] occluders from {id}: {e.GetType().Name}: {e.Message}"); return; }
            if (_buffer.Count == 0) return;
            if (!EnsureResources()) return;
            foreach (var o in _buffer)
            {
                var go = new GameObject("[Layster Occluder]") { layer = IgnoreRaycastLayer };
                go.transform.SetParent(o.Parent != null ? o.Parent : _root.transform, false);
                go.transform.localPosition = o.Center;
                go.transform.localRotation = o.Rotation;
                go.transform.localScale = new Vector3(Mathf.Max(o.Size.x, 0.001f), Mathf.Max(o.Size.y, 0.001f), Mathf.Max(o.Size.z, 0.001f));
                go.AddComponent<MeshFilter>().sharedMesh = _cube;
                var renderer = go.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = _material;
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                renderer.receiveShadows = false;
                state.Boxes.Add(go);
            }
            OccluderCount += state.Boxes.Count;
            Debug.Log($"[Layster] occlusion: {state.Boxes.Count} occluder box(es) from {id}");
        }

        private bool EnsureResources()
        {
            if (_material != null) return true;
            var shader = Resources.Load<Shader>(ShaderName);
            if (shader == null)
            {
                _failed = true;
                Debug.LogWarning($"[Layster] occlusion: the shader Resources/{ShaderName} is missing from the build; nothing is hidden behind real objects");
                return false;
            }
            _material = new Material(shader) { name = "[Layster Occluder]" };
            var tmp = GameObject.CreatePrimitive(PrimitiveType.Cube);
            tmp.SetActive(false);
            _cube = tmp.GetComponent<MeshFilter>().sharedMesh;
            Object.Destroy(tmp);
            _root = new GameObject("[Layster Occluders]");
            return true;
        }

        /// <summary>occlusion: "off" の物の不透明な部分を、隠す箱より先に描く列へ。</summary>
        private void LiftOffThings()
        {
            foreach (var b in _rt.Placer.Bindings)
            {
                if (b.Def.Occlusion != "off" || b.Root == null) continue;
                foreach (var r in b.Root.GetComponentsInChildren<Renderer>(true))
                {
                    if (r == null || !_lifted.Add(r.GetInstanceID())) continue;
                    // renderer.materials はこの renderer だけの写しを作る (共有のマテリアルを汚さない)
                    foreach (var m in r.materials)
                        if (m != null && m.renderQueue < 2500) m.renderQueue = BeforeOccluders;
                }
            }
        }
    }
}
