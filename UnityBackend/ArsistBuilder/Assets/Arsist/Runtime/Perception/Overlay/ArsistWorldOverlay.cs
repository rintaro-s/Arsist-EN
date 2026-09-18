// ==============================================
// Arsist Engine - Perception / Overlay
// 加工した画を、現実の上に直接描く
//
// AR なので Canvas に小さく映しても意味がない。パススルーで見えているもの自体が
// 変わらないといけない。
//
// やり方:
//   1. パイプラインが出した色の画とマスクを受け取る
//   2. マスクの外を透明にした RGBA テクスチャを作る
//   3. 撮影時のカメラ姿勢と内部パラメータから、その画がちょうど収まる板を
//      遠くにワールド固定で置き、テクスチャを貼る
//
// 「空を青くする」に限らない。壁の色を変える、看板を差し替える、
// 見つけた領域を光らせる — マスクと色の画を渡せば何でも同じように乗る。
//
// 遠くにワールド固定するので、対象が十分遠ければ頭を振っても貼り付いたままになる。
// 近くのものに使うと視差でずれる: そのときは板ではなく、姿勢推定した
// 3D オブジェクト (ImageAnchor) を使うのが筋。
// ==============================================

using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Vision.Classic;
using UnityEngine;

namespace Arsist.Runtime.Perception.Overlay
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistWorldOverlay : MonoBehaviour
    {
        public static ArsistWorldOverlay Instance { get; private set; }

        /// <summary>
        /// 板を置く距離 (m)。遠いものに重ねる前提なので、頭の移動による視差が
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
            var go = new GameObject("OverlayPlane");
            go.transform.SetParent(transform, false);
            _plane = go.transform;

            _mesh = new Mesh { name = "ArsistOverlayPlane" };
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
                Debug.LogError("[Arsist] Unlit/Transparent not found; the world overlay will not draw.");
                return;
            }
            _material = new Material(shader) { name = "ArsistWorldOverlay" };
            _renderer.sharedMaterial = _material;

            Hide();
        }

        public void Hide()
        {
            if (_renderer != null) _renderer.enabled = false;
        }

        /// <summary>
        /// 加工した画を現実に重ねる。
        /// </summary>
        /// <param name="painted">パイプラインが出した色の画。</param>
        /// <param name="mask">描く範囲。null なら全面。painted と同じ大きさであること。</param>
        /// <param name="intrinsics">painted の画素系に換算済みの内部パラメータ。</param>
        /// <param name="cameraPose">撮影した瞬間のカメラのワールド姿勢。</param>
        public void Show(ColorImage painted, MaskImage mask, CameraIntrinsics intrinsics, Pose cameraPose)
        {
            if (_renderer == null || _material == null) return;
            if (painted == null) { Hide(); return; }

            var rgba = Composite.ToRgba(painted, mask, FeatherPasses);
            if (rgba == null) { Hide(); return; }

            ShowRgba(rgba, painted.Width, painted.Height, intrinsics, cameraPose);
        }

        /// <summary>
        /// 作り済みの RGBA (アルファ付き) を現実に重ねる。
        /// 画像処理のワーカーで RGBA まで作っておけば、メインスレッドはテクスチャの転送だけで済む。
        /// </summary>
        public void ShowRgba(byte[] rgba, int width, int height, CameraIntrinsics intrinsics, Pose cameraPose)
        {
            if (_renderer == null || _material == null) return;
            if (rgba == null || rgba.Length != width * height * 4) { Hide(); return; }

            UploadTexture(rgba, width, height);
            ShapePlane(intrinsics, width, height);

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
