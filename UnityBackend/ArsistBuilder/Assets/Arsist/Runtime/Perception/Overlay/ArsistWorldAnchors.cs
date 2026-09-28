// ==============================================
// Arsist Engine - Perception / Overlay
// 見つけた物の位置に、札 (ラベル) やシーンオブジェクトを置く
//
// AR の核はここ。「見つけた」で終わらせず、その場所に何かを出す。
//   - 画素 → 光線: 撮影時の内部パラメータ (ViewportMapping.RayFromNormalized)
//   - 光線 → 位置: 撮影時のカメラ姿勢で回し、指定の距離 (m) だけ進める
//     (深度が取れない端末が多いので、距離は出力の設定。物が同じくらいの距離にある前提)
//   - 札は常にユーザーの方を向く小さな板 + 文字 (TextMesh)。追跡 (track op) の ID ごとに
//     使い回すので、フレームをまたいで同じ札が動く
//   - objectId が指定されていれば、最初の項目の位置へそのシーンオブジェクトを動かす
//     (スクリプトの scene.setPosition と同じ経路)
//
// 札の文字は TextMeshPro (3D)。UI と同じ既定フォントとシェーダー (Always Included 済み) を使う。
// 組み込みの TextMesh + GUI/Text Shader は使わない: そのシェーダーを Always Included に足すと
// BuildPlayer が unity_builtin_extra の書き出しで落ちる (実際に踏んだ)。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Perception.Pipeline;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Vision.Classic;
using Arsist.Runtime.Scripting;
using TMPro;
using UnityEngine;

namespace Arsist.Runtime.Perception.Overlay
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistWorldAnchors : MonoBehaviour
    {
        public static ArsistWorldAnchors Instance { get; private set; }

        /// <summary>札の文字の大きさ (m、1 行の高さの目安)。</summary>
        private const float LabelHeightMeters = 0.05f;

        private sealed class Marker
        {
            public GameObject Root;
            public TextMeshPro Text;
            public MeshRenderer Backing;
            public string Key;
            public float LastSeen;
        }

        private readonly Dictionary<string, Marker> _markers = new Dictionary<string, Marker>();
        private Material _backingMaterial;
        private Camera _camera;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            if (TMP_Settings.defaultFontAsset == null)
            {
                Debug.LogWarning("[Arsist] TextMeshPro has no default font asset; anchor labels will be blank boxes.");
            }
            var unlit = Shader.Find("Unlit/Color");
            if (unlit != null) _backingMaterial = new Material(unlit) { name = "ArsistAnchorBacking", color = new Color(0.08f, 0.1f, 0.14f, 1f) };
        }

        private void LateUpdate()
        {
            // 札はユーザーの方を向く。撮った瞬間の位置は動かさない (ワールド固定)。
            if (_camera == null) _camera = Camera.main;
            if (_camera == null) return;
            foreach (var marker in _markers.Values)
            {
                if (!marker.Root.activeSelf) continue;
                var toCamera = marker.Root.transform.position - _camera.transform.position;
                if (toCamera.sqrMagnitude < 1e-6f) continue;
                marker.Root.transform.rotation = Quaternion.LookRotation(toCamera, Vector3.up);
            }
        }

        /// <summary>
        /// 項目 (x, y は正規化、原点左下) を置く。前回置いたもののうち今回無いものは消す。
        /// </summary>
        public void Place(
            string taskId, VisionOutputSpec output, List<object> items,
            CameraIntrinsics intrinsics, int width, int height, Pose cameraPose)
        {
            string prefix = taskId + "/" + output.Value + "/";
            var seen = new HashSet<string>();
            int placed = 0;

            foreach (var raw in items)
            {
                if (placed >= Math.Max(1, output.MaxItems)) break;
                if (!(raw is Dictionary<string, object> item)) continue;
                if (item.TryGetValue("missing", out var missing) && missing is bool m && m) continue;

                double nx = Number(item, "x"), ny = Number(item, "y");
                ViewportMapping.RayFromNormalized(intrinsics, width, height, nx, ny, out double dx, out double dy, out double dz);
                var direction = new Vector3((float)dx, (float)dy, (float)dz).normalized;
                var position = cameraPose.position + cameraPose.rotation * direction * (float)Math.Max(0.1, output.Distance);

                // 追跡の ID があれば札を使い回す (同じ物は同じ札)。無ければ順番。
                string key = prefix + (item.TryGetValue("id", out var id) && id != null ? "id:" + id : "n:" + placed);
                seen.Add(key);

                if (placed == 0 && !string.IsNullOrEmpty(output.ObjectId))
                {
                    // 最初の項目の位置へシーンオブジェクトを動かす
                    var scene = ScriptEngineManager.Instance != null ? ScriptEngineManager.Instance.SceneWrapper : null;
                    if (scene != null && scene.exists(output.ObjectId))
                        scene.setPosition(output.ObjectId, position.x, position.y, position.z);
                }

                string text = LabelText(item, output.Label);
                if (text != null)
                {
                    var marker = GetOrCreate(key);
                    marker.Root.transform.position = position;
                    marker.Root.SetActive(true);
                    marker.LastSeen = Time.time;
                    if (marker.Text != null && marker.Text.text != text) marker.Text.text = text;
                    ResizeBacking(marker, text);
                }
                placed++;
            }

            // 今回置かなかった札は消す
            foreach (var pair in _markers)
            {
                if (!pair.Key.StartsWith(prefix, StringComparison.Ordinal)) continue;
                if (!seen.Contains(pair.Key)) pair.Value.Root.SetActive(false);
            }
        }

        public void Clear(string taskId, string valueName)
        {
            string prefix = taskId + "/" + valueName + "/";
            foreach (var pair in _markers)
            {
                if (pair.Key.StartsWith(prefix, StringComparison.Ordinal)) pair.Value.Root.SetActive(false);
            }
        }

        private static string LabelText(Dictionary<string, object> item, string field)
        {
            if (string.IsNullOrEmpty(field) || field == "none") return null;
            switch (field)
            {
                case "score":
                    return $"{Number(item, "score") * 100:F0}%";
                case "labelScore":
                {
                    var label = item.TryGetValue("label", out var l) ? l?.ToString() : null;
                    return string.IsNullOrEmpty(label) ? $"{Number(item, "score") * 100:F0}%" : $"{label} {Number(item, "score") * 100:F0}%";
                }
                default:
                    return item.TryGetValue(field, out var v) && v != null ? v.ToString() : "";
            }
        }

        private static double Number(Dictionary<string, object> item, string key)
        {
            if (!item.TryGetValue(key, out var raw) || raw == null) return 0;
            try { return Convert.ToDouble(raw); } catch { return 0; }
        }

        private Marker GetOrCreate(string key)
        {
            if (_markers.TryGetValue(key, out var existing)) return existing;

            var root = new GameObject("Anchor " + key);
            root.transform.SetParent(transform, false);

            // 背景の板
            var backing = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(backing.GetComponent<Collider>());
            backing.name = "Backing";
            backing.transform.SetParent(root.transform, false);
            backing.transform.localPosition = new Vector3(0, 0, 0.002f);
            var backingRenderer = backing.GetComponent<MeshRenderer>();
            if (_backingMaterial != null) backingRenderer.sharedMaterial = _backingMaterial;
            backingRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            backingRenderer.receiveShadows = false;

            // 文字 (TextMeshPro 3D)。fontSize 10 ≒ 1 unit なので、0.1 倍にして fontSize 5 ≒ 0.05 m
            TextMeshPro text = null;
            if (TMP_Settings.defaultFontAsset != null)
            {
                var textGo = new GameObject("Label");
                textGo.transform.SetParent(root.transform, false);
                text = textGo.AddComponent<TextMeshPro>();
                text.font = TMP_Settings.defaultFontAsset;
                text.fontSize = LabelHeightMeters * 100f; // 0.05 m → 5 (scale 0.1 と合わせて)
                text.alignment = TextAlignmentOptions.Center;
                text.enableWordWrapping = false;
                text.overflowMode = TextOverflowModes.Overflow;
                text.color = Color.white;
                text.rectTransform.sizeDelta = new Vector2(40f, 2f);
                textGo.transform.localScale = Vector3.one * 0.1f;
                var renderer = textGo.GetComponent<MeshRenderer>();
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                renderer.receiveShadows = false;
                // 板は +Z がカメラ側 (LookRotation の forward = toCamera) なので、文字は裏返して読めるようにする
                textGo.transform.localRotation = Quaternion.Euler(0, 180f, 0);
            }
            backing.transform.localRotation = Quaternion.Euler(0, 180f, 0);

            var marker = new Marker { Root = root, Text = text, Backing = backingRenderer, Key = key };
            _markers[key] = marker;
            return marker;
        }

        private static void ResizeBacking(Marker marker, string text)
        {
            if (marker.Backing == null) return;
            float width = Mathf.Max(LabelHeightMeters * 1.4f, LabelHeightMeters * 0.55f * Mathf.Max(1, text.Length) + LabelHeightMeters * 0.6f);
            marker.Backing.transform.localScale = new Vector3(width, LabelHeightMeters * 1.6f, 1f);
        }

        private void OnDestroy()
        {
            if (_backingMaterial != null) Destroy(_backingMaterial);
            if (Instance == this) Instance = null;
        }
    }
}
