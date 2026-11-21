// ==============================================
// Arsist Engine - Media: 仮想カメラ 1 台
// Assets/Arsist/Runtime/Media/ArsistVirtualCamera.cs
//
// IR の type: "camera" の物 (doc/23-cameras-media.md)。ビルドが付けて、camera の設定を入れる。
//
//   - Camera は普段は止めておき (enabled = false)、使う人 (ArsistCameras.Require) がいる間だけ
//     fps の間隔で Render() する。撮る先は作業用の RenderTexture で、撮れたら公開の Texture に写す
//     (このカメラの画を映した板をこのカメラ自身が撮っても、読みながら書くことにならない)。
//   - 撮るのは全部の物の後 (DefaultExecutionOrder 20000: 体の IK・揺れもの (11000) の後)。
//   - カメラの前は物のローカル +Z。XR のときも片目用でなく普通のカメラとして撮る (stereoTargetEye = None)。
//   - カメラの形と撮る範囲 (showGizmo) は ArsistCameraGizmo レイヤー。頭のカメラにだけ写る。
//
// 直列化するフィールドは #if の中に置かない (CLAUDE.md)。
// ==============================================

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Arsist.Runtime.Media
{
    [UnityEngine.Scripting.Preserve]
    [DefaultExecutionOrder(20000)]
    [DisallowMultipleComponent]
    public sealed class ArsistVirtualCamera : MonoBehaviour
    {
        // ---- ビルドが入れる (IR の camera) ----
        [SerializeField] public string objectId = "";
        [SerializeField] public string assetId = "";
        [SerializeField] public float fov = 50f;
        [SerializeField] public int width = 1920;
        [SerializeField] public int height = 1080;
        [SerializeField] public float fps = 30f;
        [SerializeField] public Color backgroundColor = new Color(0.118f, 0.141f, 0.188f, 1f);
        [SerializeField] public float near = 0.05f;
        [SerializeField] public float far = 100f;
        [SerializeField] public bool showSelf = true;
        [SerializeField] public bool showGizmo = true;

        public Camera Camera { get; private set; }
        /// <summary>撮れた画。大きさは width x height、sRGB、深度なし。中身は最後に撮ったとき。</summary>
        public RenderTexture Texture { get; private set; }

        public string Id => string.IsNullOrEmpty(objectId) ? (string.IsNullOrEmpty(assetId) ? name : assetId) : objectId;

        /// <summary>撮った回数。</summary>
        public long Frames { get; private set; }

        private RenderTexture _work;
        private readonly HashSet<object> _users = new HashSet<object>();
        private float _nextAt;
        private bool _renderNow;
        private GameObject _gizmo;
        private LineRenderer _frustum;
        private float _gizmoFov = -1f, _gizmoAspect = -1f;

        public int UserCount => _users.Count;

        private void Awake()
        {
            width = Mathf.Clamp(width, 16, 4096);
            height = Mathf.Clamp(height, 16, 4096);
            if (fps <= 0f) fps = 30f;

            Camera = GetComponent<Camera>();
            if (Camera == null) Camera = gameObject.AddComponent<Camera>();
            Camera.enabled = false;
            Camera.stereoTargetEye = StereoTargetEyeMask.None;
            Camera.clearFlags = CameraClearFlags.SolidColor;
            Camera.backgroundColor = backgroundColor;
            Camera.fieldOfView = Mathf.Clamp(fov, 1f, 170f);
            Camera.nearClipPlane = Mathf.Max(0.001f, near);
            Camera.farClipPlane = Mathf.Max(Camera.nearClipPlane + 0.01f, far);
            Camera.aspect = (float)width / height;
            Camera.allowHDR = false;
            Camera.allowMSAA = false;
            Camera.useOcclusionCulling = false;
            Camera.depth = -50;
            ApplyMask();

            // 公開する画 (録画・UI が使う) と、撮る先 (作業用)
            Texture = NewTexture(depth: 0, name: $"ArsistCamera_{Id}");
            _work = NewTexture(depth: 24, name: $"ArsistCamera_{Id}_work");
            Camera.targetTexture = _work;
            // 撮る前の最初の画は背景の色にしておく (黒い板が一瞬出ないように)
            Clear(Texture, backgroundColor);

            // カメラ自身が写る物の当たり判定などは持たない。形は別のレイヤーに作る
            if (showGizmo) BuildGizmo();

            ArsistCameras.Instance.Register(this, Id, assetId);
            Debug.Log($"[Arsist] virtual camera '{Id}' (asset '{assetId}'): {width}x{height} @ {fps} fps, fov {Camera.fieldOfView}°, showSelf={showSelf}, gizmo={showGizmo}");
        }

        private RenderTexture NewTexture(int depth, string name)
        {
            var rt = new RenderTexture(width, height, depth, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB)
            {
                name = name,
                antiAliasing = 1,
                useMipMap = false,
                autoGenerateMips = false,
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp,
            };
            rt.Create();
            return rt;
        }

        private static void Clear(RenderTexture rt, Color color)
        {
            var previous = RenderTexture.active;
            RenderTexture.active = rt;
            GL.Clear(true, true, color);
            RenderTexture.active = previous;
        }

        private void ApplyMask()
        {
            if (Camera != null) Camera.cullingMask = ArsistMediaLayers.VirtualCameraMask(showSelf);
        }

        // ---- 使う人 ----

        public void AddUser(object owner)
        {
            if (owner == null) return;
            if (_users.Add(owner) && _users.Count == 1)
            {
                _nextAt = 0f; // すぐ 1 枚撮る
                Debug.Log($"[Arsist] virtual camera '{Id}' started ({owner.GetType().Name})");
            }
        }

        public void RemoveUser(object owner)
        {
            if (owner == null) return;
            if (_users.Remove(owner) && _users.Count == 0) Debug.Log($"[Arsist] virtual camera '{Id}' stopped");
        }

        /// <summary>次の LateUpdate で、使う人がいなくても 1 枚撮る (スナップショット)。</summary>
        public void RenderOnce() => _renderNow = true;

        // ---- 設定の変更 (スクリプト) ----

        public void SetFov(float degrees)
        {
            fov = Mathf.Clamp(degrees, 1f, 170f);
            if (Camera != null) Camera.fieldOfView = fov;
        }

        public void SetShowSelf(bool on)
        {
            showSelf = on;
            ApplyMask();
        }

        // ---- 毎フレーム ----

        private void LateUpdate()
        {
            ArsistMediaLayers.EnsureHeadCamera();
            UpdateGizmo();

            if (Camera == null || _work == null) return;
            bool due = _users.Count > 0 && Time.unscaledTime >= _nextAt;
            if (!due && !_renderNow) return;
            _renderNow = false;

            if (due)
            {
                float interval = 1f / Mathf.Max(1f, fps);
                // 遅れても溜めない (追いつこうとして毎フレーム撮らない)
                _nextAt = Mathf.Max(_nextAt + interval, Time.unscaledTime + interval * 0.5f);
            }

            Camera.backgroundColor = backgroundColor;
            Camera.aspect = (float)width / height;
            Camera.Render();
            if (SystemInfo.copyTextureSupport != CopyTextureSupport.None) Graphics.CopyTexture(_work, 0, 0, Texture, 0, 0);
            else Graphics.Blit(_work, Texture);
            Frames++;
            ArsistCameras.Instance.NotifyRendered(Id, Texture);
        }

        // ---- カメラの形と撮る範囲 (頭のカメラにだけ写る) ----

        private void BuildGizmo()
        {
            int layer = ArsistMediaLayers.Gizmo;
            _gizmo = new GameObject("CameraGizmo");
            _gizmo.transform.SetParent(transform, false);
            _gizmo.layer = layer;

            var bodyMat = NewMaterial(new Color(0.16f, 0.17f, 0.2f, 1f));
            var lensMat = NewMaterial(new Color(0.35f, 0.75f, 1f, 1f));

            // 体 (撮る向き = +Z の後ろ側に置く)
            var body = GameObject.CreatePrimitive(PrimitiveType.Cube);
            body.name = "Body";
            Object.Destroy(body.GetComponent<Collider>());
            body.transform.SetParent(_gizmo.transform, false);
            body.transform.localPosition = new Vector3(0f, 0f, -0.05f);
            body.transform.localScale = new Vector3(0.12f, 0.08f, 0.07f);
            body.GetComponent<Renderer>().sharedMaterial = bodyMat;

            // レンズ
            var lens = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            lens.name = "Lens";
            Object.Destroy(lens.GetComponent<Collider>());
            lens.transform.SetParent(_gizmo.transform, false);
            lens.transform.localPosition = new Vector3(0f, 0f, -0.0f);
            lens.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            lens.transform.localScale = new Vector3(0.05f, 0.015f, 0.05f);
            lens.GetComponent<Renderer>().sharedMaterial = lensMat;

            // 撮る範囲 (0.6 m 先までの四角錐の辺)
            var lines = new GameObject("Frustum");
            lines.transform.SetParent(_gizmo.transform, false);
            _frustum = lines.AddComponent<LineRenderer>();
            _frustum.useWorldSpace = false;
            _frustum.loop = false;
            _frustum.startWidth = _frustum.endWidth = 0.004f;
            _frustum.material = NewMaterial(new Color(0.35f, 0.75f, 1f, 0.9f), "Sprites/Default");
            _frustum.startColor = _frustum.endColor = new Color(0.35f, 0.75f, 1f, 0.9f);
            _frustum.shadowCastingMode = ShadowCastingMode.Off;
            _frustum.receiveShadows = false;

            ArsistMediaLayers.SetLayerRecursively(_gizmo, layer);
        }

        private static Material NewMaterial(Color color, string preferred = "Unlit/Color")
        {
            Shader shader = null;
            foreach (var n in new[] { preferred, "Unlit/Color", "Sprites/Default", "Standard" })
            {
                shader = Shader.Find(n);
                if (shader != null) break;
            }
            var mat = new Material(shader != null ? shader : Shader.Find("Hidden/Internal-Colored")) { color = color };
            return mat;
        }

        private void UpdateGizmo()
        {
            if (_frustum == null || Camera == null) return;
            float aspect = (float)width / height;
            if (Mathf.Approximately(_gizmoFov, Camera.fieldOfView) && Mathf.Approximately(_gizmoAspect, aspect)) return;
            _gizmoFov = Camera.fieldOfView;
            _gizmoAspect = aspect;
            const float d = 0.6f;
            float h = Mathf.Tan(_gizmoFov * 0.5f * Mathf.Deg2Rad) * d;
            float w = h * aspect;
            // 物の大きさ (scale) に関係なく 0.6 m に見えるよう、ローカルを割る
            var s = transform.lossyScale;
            Vector3 L(float x, float y, float z) => new Vector3(x / Mathf.Max(1e-4f, s.x), y / Mathf.Max(1e-4f, s.y), z / Mathf.Max(1e-4f, s.z));
            var o = L(0, 0, 0);
            var tl = L(-w, h, d); var tr = L(w, h, d); var br = L(w, -h, d); var bl = L(-w, -h, d);
            var pts = new[] { o, tl, tr, o, br, bl, o, tl, bl, br, tr };
            _frustum.positionCount = pts.Length;
            _frustum.SetPositions(pts);
        }

        private void OnDestroy()
        {
            ArsistCameras.Instance.Unregister(Id);
            if (Camera != null) Camera.targetTexture = null;
            if (_work != null) { _work.Release(); Destroy(_work); }
            if (Texture != null) { Texture.Release(); Destroy(Texture); }
        }
    }
}
