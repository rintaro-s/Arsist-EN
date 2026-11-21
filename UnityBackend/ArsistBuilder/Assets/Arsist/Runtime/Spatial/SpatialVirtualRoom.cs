// ==============================================
// Arsist Engine - Layster.Spatial: 仮の部屋 (presentation.reality = "virtual-room")
// Assets/Arsist/Runtime/Spatial/SpatialVirtualRoom.cs
//
// 現実を見せない (背景は暗い単色。lower.ts が backgroundMode を solidColor にする) とき、世界の状態から
// 簡単な部屋を描く。ユーザーが机や壁にぶつからず、置いた物が「何の上にあるか」が分かるように。
//   床      平らな面 + 格子 (箱の中心から gridCell ごと)。仮の床 (assumed) も描く (足元 8 m 四方)
//   壁      面の裏 (部屋の外) に 2 cm の厚み
//   家具    箱 (上の面ほど明るい)
//   描かない 天井・検出・Mind の推測 (薄れる出どころ)
// 何をどの色で描くかは src/shared/layster/spatial/virtualRoom.ts と同じ (エディタの 3D も同じ見た目)。色は spatial.json の
// virtualRoom から読む。面は Resources/ArsistSpatialRoom.shader (光を使わない単色 + 格子)。
// 当たり判定は付けない (UI を指すレイを止めない)。層は Ignore Raycast。
// ==============================================

using System.Collections.Generic;
using Arsist.Runtime.Spatial.Core;
using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    public sealed class SpatialVirtualRoom
    {
        private const string ShaderName = "ArsistSpatialRoom";
        private const float Thickness = 0.02f;
        private const int IgnoreRaycastLayer = 2;

        private readonly ArsistSpatialRuntime _rt;
        private readonly Dictionary<string, GameObject> _parts = new Dictionary<string, GameObject>();
        private readonly Dictionary<string, string> _shapes = new Dictionary<string, string>();
        private GameObject _root;
        private Material _floor, _wall, _furniture;
        private Mesh _cube;
        private int _drawnVersion = -1;
        private double _nextCheck;
        private bool _dirty = true;
        private bool _failed;

        public bool Active { get; }

        public SpatialVirtualRoom(ArsistSpatialRuntime runtime)
        {
            _rt = runtime;
            Active = runtime.Model.Reality == "virtual-room";
            if (!Active) return;
            runtime.Frames.Changed += () => _dirty = true;
            Debug.Log("[Layster] virtual room: drawing a stand-in room from the world state (reality = virtual-room)");
        }

        public void Tick()
        {
            if (!Active || _failed || !_rt.Frames.Initialized) return;
            if (!_dirty && (_rt.World.Version == _drawnVersion || _rt.Now < _nextCheck)) return;
            _nextCheck = _rt.Now + 0.5;
            _drawnVersion = _rt.World.Version;
            if (_root == null && !Setup()) return;
            if (_dirty)
            {
                // 床の高さが変わった: spatial の姿勢のまま、全部を Unity で置き直す
                foreach (var go in _parts.Values) if (go != null) Object.Destroy(go);
                _parts.Clear();
                _shapes.Clear();
                _dirty = false;
            }
            var seen = new HashSet<string>();
            foreach (var e in _rt.World.Entities())
            {
                var part = PartOf(e);
                if (part == null) continue;
                seen.Add(e.Id);
                var shape = $"{part}|{e.At}|{e.Yaw:0.###}|{e.Size}";
                if (_shapes.TryGetValue(e.Id, out var was) && was == shape) continue;
                if (_parts.TryGetValue(e.Id, out var old) && old != null) Object.Destroy(old);
                _parts[e.Id] = Build(e, part);
                _shapes[e.Id] = shape;
            }
            var gone = new List<string>();
            foreach (var id in _parts.Keys) if (!seen.Contains(id)) gone.Add(id);
            foreach (var id in gone)
            {
                if (_parts[id] != null) Object.Destroy(_parts[id]);
                _parts.Remove(id);
                _shapes.Remove(id);
            }
        }

        /// <summary>virtualRoom.ts の virtualRoomPart と同じ規則。</summary>
        private string PartOf(Entity e)
        {
            var source = e.Source ?? "";
            if (source.StartsWith("detector:") || source.StartsWith("mind:") || source == "script") return null;
            var vocab = _rt.Model.Vocabulary;
            var word = e.Is.Count > 0 ? vocab.Canonical(e.Is[0]) : "";
            if (word == "ceiling") return null;
            if (word == "floor") return "floor";
            var w = vocab.Lookup(word);
            if (w != null && w.Structural && vocab.IsVertical(e)) return "wall";
            return "furniture";
        }

        private bool Setup()
        {
            var shader = Resources.Load<Shader>(ShaderName);
            if (shader == null)
            {
                _failed = true;
                Debug.LogWarning($"[Layster] virtual room: the shader Resources/{ShaderName} is missing from the build; the room is not drawn");
                return false;
            }
            var style = _rt.Model.VirtualRoom;
            float cell = (float)J.Num(style, "gridCell", 0.5);
            _floor = NewMaterial(shader, "[Layster Room] floor", Hex(style, "floor", "#24272E"), Hex(style, "grid", "#3B404A"), cell, grid: true);
            _wall = NewMaterial(shader, "[Layster Room] wall", Hex(style, "wall", "#1D2026"), Color.black, cell, grid: false);
            _furniture = NewMaterial(shader, "[Layster Room] furniture", Hex(style, "furniture", "#363B45"), Color.black, cell, grid: false);
            var tmp = GameObject.CreatePrimitive(PrimitiveType.Cube);
            tmp.SetActive(false);
            _cube = tmp.GetComponent<MeshFilter>().sharedMesh;
            Object.Destroy(tmp);
            _root = new GameObject("[Layster Virtual Room]");
            return true;
        }

        private static Material NewMaterial(Shader shader, string name, Color color, Color gridColor, float cell, bool grid)
        {
            var m = new Material(shader) { name = name };
            m.SetColor("_Color", color);
            m.SetColor("_GridColor", gridColor);
            m.SetFloat("_Cell", cell);
            m.SetFloat("_GridOn", grid ? 1f : 0f);
            return m;
        }

        private static Color Hex(Dictionary<string, object> style, string key, string fallback)
        {
            var text = J.Str(style, key, fallback);
            return ColorUtility.TryParseHtmlString(text, out var c) ? c : (ColorUtility.TryParseHtmlString(fallback, out var f) ? f : Color.gray);
        }

        private GameObject Build(Entity e, string part)
        {
            var go = new GameObject($"[Layster Room] {part} {e.Id}") { layer = IgnoreRaycastLayer };
            go.transform.SetParent(_root.transform, false);
            go.transform.SetPositionAndRotation(_rt.Frames.ToUnity(e.At), _rt.Frames.RotationToUnity(e.Yaw));
            var box = new GameObject("Box") { layer = IgnoreRaycastLayer };
            box.transform.SetParent(go.transform, false);
            float w = Mathf.Max((float)e.Size.X, 0.01f), h = Mathf.Max((float)e.Size.Y, 0.01f), d = Mathf.Max((float)e.Size.Z, 0.01f);
            Material material;
            switch (part)
            {
                case "floor":
                    // 表 (上の面) が床の高さ。厚みは下へ
                    box.transform.localPosition = new Vector3(0, -Thickness / 2, 0);
                    h = Thickness;
                    material = _floor;
                    break;
                case "wall":
                    // 表が面 (箱の +Z が部屋の内側)。厚みは裏 (-Z) へ
                    if (e.Size.Z <= Thickness)
                    {
                        d = Thickness;
                        box.transform.localPosition = new Vector3(0, 0, -Thickness / 2);
                    }
                    material = _wall;
                    break;
                default:
                    material = _furniture;
                    break;
            }
            box.transform.localScale = new Vector3(w, h, d);
            box.AddComponent<MeshFilter>().sharedMesh = _cube;
            var renderer = box.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            // 格子の間隔はメートルで (箱ごとの大きさ)。共有のマテリアルを汚さないよう property block で渡す
            var block = new MaterialPropertyBlock();
            block.SetVector("_Size", new Vector4(w, h, d, 0));
            renderer.SetPropertyBlock(block);
            return go;
        }
    }
}
