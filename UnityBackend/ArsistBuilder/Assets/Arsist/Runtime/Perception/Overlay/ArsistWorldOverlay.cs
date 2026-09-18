// ==============================================
// Arsist Engine - Perception / Overlay
// 現実の空の上に、直接それを描く
//
// AR なので Canvas に小さく映しても意味がない。パススルーで見えている空そのものが
// 青くならないといけない。
//
// やり方:
//   1. パススルーカメラの静止画から空を抽出し、青く塗り替える
//   2. 空でない画素を透明にした RGBA テクスチャを作る
//   3. 撮影時のカメラ姿勢と内部パラメータから、その画がちょうど収まる板を
//      遠くにワールド固定で置き、テクスチャを貼る
//
// 空は十分遠いので、頭を動かしても視差はほぼ出ない。板をワールドに固定しておけば、
// 次に撮り直すまでの間、首を振っても空に貼り付いたままになる。
// 建物や木はマスクで透明になっているので、そのまま透けて見える。
// ==============================================

using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Vision.Classic;
using UnityEngine;

namespace Arsist.Runtime.Perception.Overlay
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistSkyOverlay : MonoBehaviour
    {
        public static ArsistSkyOverlay Instance { get; private set; }

        /// <summary>
        /// 板を置く距離 (m)。空は事実上無限遠なので、頭の移動による視差が
        /// 気にならない程度に遠ければよい。遠くしすぎるとカメラの far clip に当たる。
        /// </summary>
        private const float PlaneDistance = 60f;

        /// <summary>境界をぼかす回数。切りっぱなしだと輪郭が階段状に見える。</summary>
        private const int FeatherPasses = 3;

        private Transform _plane;
        private MeshFilter _filter;
        private MeshRenderer _renderer;
        private Mesh _mesh;
        private Material _material;
        private Texture2D _texture;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            BuildPlane();
        }

        private void BuildPlane()
        {
            var go = new GameObject("SkyPlane");
            go.transform.SetParent(transform, false);
            _plane = go.transform;

            _mesh = new Mesh { name = "ArsistSkyPlane" };
            _filter = go.AddComponent<MeshFilter>();
            _filter.sharedMesh = _mesh;

            _renderer = go.AddComponent<MeshRenderer>();
            _renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            _renderer.receiveShadows = false;
            _renderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
            _renderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;

            // Unlit/Transparent は ArsistBuildPipeline.EnsureGltfastShaders が
            // Always Included Shaders に入れているので、IL2CPP でも残る。
            var shader = Shader.Find("Unlit/Transparent");
            if (shader == null)
            {
                Debug.LogError("[Arsist] Unlit/Transparent not found; the sky overlay will not draw.");
                return;
            }
            _material = new Material(shader) { name = "ArsistSkyOverlay" };
            _renderer.sharedMaterial = _material;

            Hide();
        }

        public void Hide()
        {
            if (_renderer != null) _renderer.enabled = false;
        }

        /// <summary>
        /// 空を現実に重ねる。
        /// </summary>
        /// <param name="painted">塗り替え済みの画 (解析に使ったのと同じ大きさ)。</param>
        /// <param name="mask">空のマスク。painted と同じ大きさ。</param>
        /// <param name="intrinsics">painted の画素系に換算済みの内部パラメータ。</param>
        /// <param name="cameraPose">撮影した瞬間のカメラのワールド姿勢。</param>
        public void Show(ColorImage painted, MaskImage mask, CameraIntrinsics intrinsics, Pose cameraPose)
        {
            if (_renderer == null || _material == null) return;
            if (painted == null || mask == null) { Hide(); return; }

            var rgba = SkySegmenter.Compose(painted, mask, FeatherPasses);
            if (rgba == null) { Hide(); return; }

            UploadTexture(rgba, painted.Width, painted.Height);
            ShapePlane(intrinsics, painted.Width, painted.Height);

            // 撮った瞬間の姿勢でワールドに固定する。今のカメラ姿勢を使うと、
            // 解析している間に首を振ったぶんだけ空からずれる。
            _plane.SetPositionAndRotation(cameraPose.position, cameraPose.rotation);
            _renderer.enabled = true;
        }

        private void UploadTexture(byte[] rgba, int width, int height)
        {
            if (_texture == null || _texture.width != width || _texture.height != height)
            {
                if (_texture != null) Destroy(_texture);
                _texture = new Texture2D(width, height, TextureFormat.RGBA32, false)
                {
                    // 端の画素が反対側に回り込むと、空の縁に線が出る。
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = FilterMode.Bilinear,
                };
                _material.mainTexture = _texture;
            }
            _texture.LoadRawTextureData(rgba);
            _texture.Apply(false);
        }

        /// <summary>
        /// 画がちょうど収まるように板の形を決める。
        /// 主点が画の中心とは限らないので、上下左右を別々に出す。
        /// </summary>
        private void ShapePlane(CameraIntrinsics k, int width, int height)
        {
            ViewportMapping.PlaneExtents(
                k, width, height, PlaneDistance,
                out double left, out double right, out double bottom, out double top);

            var vertices = new[]
            {
                new Vector3((float)left,  (float)bottom, PlaneDistance),
                new Vector3((float)right, (float)bottom, PlaneDistance),
                new Vector3((float)right, (float)top,    PlaneDistance),
                new Vector3((float)left,  (float)top,    PlaneDistance),
            };
            var uv = new[]
            {
                new Vector2(0f, 0f), new Vector2(1f, 0f),
                new Vector2(1f, 1f), new Vector2(0f, 1f),
            };

            // 両面に張る。板は必ずカメラの正面に来るので裏面が要ることはないが、
            // 巻き順を一つ間違えるだけで「何も映らない」になり、実機でしか気付けない。
            // 三角形 2 枚ぶんの負荷でその失敗を消せるなら安いもの。
            var triangles = new[]
            {
                0, 2, 1, 0, 3, 2,
                0, 1, 2, 0, 2, 3,
            };

            _mesh.Clear();
            _mesh.vertices = vertices;
            _mesh.uv = uv;
            _mesh.triangles = triangles;
            // 遠くに置くので、カリング用の境界を自前で与えておく (Recalculate だと十分)。
            _mesh.RecalculateBounds();
        }

        private void OnDestroy()
        {
            if (_texture != null) Destroy(_texture);
            if (_material != null) Destroy(_material);
            if (_mesh != null) Destroy(_mesh);
            if (Instance == this) Instance = null;
        }
    }
}
