// ==============================================
// Arsist Engine - Perception
// 画像アンカーに貼り付いたオブジェクト
//
// 2通りの置き方がある:
//  - オフセット指定 (placement 無し): エディタで作った transform をそのまま
//    ターゲット座標系のローカル姿勢として使う。
//  - 相対配置 (placement あり): 「その物の右に10cm」を、ターゲットと自分の
//    実寸から計算する。生の座標と違い、どちらの大きさが変わっても
//    「横に並ぶ」という意味を保てる。transform は微調整として上に乗る。
//
// 計算規則は src/shared/placement.ts の写し。エディタのビューポートプレビューが
// 同じ計算を必要とするので、片方だけ直すと見た目と実機がずれる。
// placement.test.ts の表と同じ値を返すこと。
// ==============================================

using Arsist.Runtime.Perception.Vision;
using UnityEngine;

namespace Arsist.Runtime.Perception
{
    /// <summary>未検出のときの見せ方。IR の ObjectAnchor.whenNotFound と対応。</summary>
    public enum AnchorFallback
    {
        /// <summary>見えていない間は非表示。</summary>
        Hidden = 0,
        /// <summary>見失っても最後に確定した姿勢のまま表示し続ける（初回検出までは非表示）。</summary>
        LastKnown = 1,
        /// <summary>初回検出前から表示する（そのときは XR 原点基準）。</summary>
        AlwaysVisible = 2,
    }

    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistImageAnchor : MonoBehaviour
    {
        public string TargetId;
        public AnchorFallback Fallback = AnchorFallback.LastKnown;

        [Header("Placement (UsePlacement = false ならオフセット指定)")]
        public bool UsePlacement;
        public string RegionId;
        public PlacementSide Side = PlacementSide.Right;
        public float Gap = 0.05f;
        /// <summary>true = 自分の手前の縁を基準の縁に合わせる ('near')。</summary>
        public bool AlignNear = true;
        /// <summary>-1 = start, 0 = center, 1 = end。</summary>
        public int Cross;
        /// <summary>true なら常にユーザーの方を向く。</summary>
        public bool FaceUser = true;

        /// <summary>作者が指定したターゲット座標系でのオフセット（X 反転済み）。</summary>
        private Vector3 _localPosition;
        private Quaternion _localRotation;
        private Vector3 _localScale;
        private bool _captured;

        private bool _lastActive;
        private Vector3 _extents;
        private int _extentsSignature = -1;
        private Camera _camera;

        private void Awake()
        {
            _localPosition = transform.localPosition;
            _localRotation = transform.localRotation;
            _localScale = transform.localScale;
            _captured = true;
            _lastActive = true;
        }

        private void Start()
        {
            var state = ResolveState();
            bool show = Fallback == AnchorFallback.AlwaysVisible || (state != null && state.Localized);
            SetVisible(show);
            _lastActive = show;
        }

        private void LateUpdate()
        {
            if (!_captured) return;

            var state = ResolveState();
            bool hasPose = state != null && state.Localized;

            bool show = Fallback switch
            {
                AnchorFallback.Hidden => state != null && state.Visible,
                AnchorFallback.LastKnown => hasPose,
                _ => true,
            };

            if (hasPose)
            {
                var localOffset = UsePlacement ? ResolveOffset(state) : _localPosition;

                transform.SetPositionAndRotation(
                    state.Position + state.Rotation * localOffset,
                    ResolveRotation(state));
                transform.localScale = _localScale;
            }

            if (show != _lastActive)
            {
                SetVisible(show);
                _lastActive = show;
            }
        }

        private PerceptionTargetState ResolveState()
        {
            var manager = ArsistPerceptionManager.Instance;
            return manager != null ? manager.GetState(TargetId) : null;
        }

        private Quaternion ResolveRotation(PerceptionTargetState state)
        {
            if (!UsePlacement || !FaceUser) return state.Rotation * _localRotation;

            // ラベル用のビルボード。ポスターと一緒に転ぶと読めないので、
            // 上方向はワールドの上に固定して首振りだけ追従させる。
            var camera = ResolveCamera();
            if (camera == null) return state.Rotation * _localRotation;

            var toCamera = camera.transform.position - transform.position;
            toCamera.y = 0f;
            if (toCamera.sqrMagnitude < 1e-6f) return state.Rotation * _localRotation;

            return Quaternion.LookRotation(-toCamera.normalized, Vector3.up) * _localRotation;
        }

        private Camera ResolveCamera()
        {
            if (_camera != null && _camera.isActiveAndEnabled) return _camera;
            _camera = Camera.main;
            if (_camera == null) _camera = Object.FindFirstObjectByType<Camera>();
            return _camera;
        }

        /// <summary>
        /// placement をターゲット座標系のオフセットに解決する。
        /// 算術は PlacementSolver（UnityEngine 非依存・数値検証つき）に委ねる。
        /// </summary>
        private Vector3 ResolveOffset(PerceptionTargetState state)
        {
            PerceptionRegionRect rect = default;
            bool hasRegion = !string.IsNullOrEmpty(RegionId)
                             && state.Regions.TryGetValue(RegionId, out rect);

            var basis = PlacementSolver.RegionToBase(
                state.PhysicalWidth, state.PhysicalHeight,
                hasRegion, rect.X, rect.Y, rect.Width, rect.Height);

            var extents = ResolveExtents();
            PlacementSolver.Resolve(
                Side, Gap, AlignNear, Cross, basis,
                new PlacementExtents
                {
                    HalfWidth = extents.x,
                    HalfHeight = extents.y,
                    HalfDepth = extents.z,
                },
                out double x, out double y, out double z);

            // ここまでは「印刷面基準」(+X = 印刷面の右)。
            // アンカーノードのローカル +X は印刷面の左なので、X だけ反転して渡す。
            // （エディタ→Unity の X 反転と同じ変換。doc/11-perception.md §3.3）
            return new Vector3((float)-x, (float)y, (float)z) + _localPosition;
        }

        /// <summary>
        /// 自分の半サイズ（アンカー座標系）。
        /// モデルは非同期で読み込まれて後から子が増えるので、構成が変わったら測り直す。
        /// </summary>
        private Vector3 ResolveExtents()
        {
            int signature = transform.childCount * 397 + GetComponentsInChildren<Renderer>(true).Length;
            if (signature == _extentsSignature) return _extents;
            _extentsSignature = signature;

            var local = ComputeLocalBounds();
            // 自分のローカル回転ぶんだけ回してから軸に投影する（OBB → AABB）
            var e = local;
            var ax = _localRotation * new Vector3(e.x, 0, 0);
            var ay = _localRotation * new Vector3(0, e.y, 0);
            var az = _localRotation * new Vector3(0, 0, e.z);

            _extents = new Vector3(
                Mathf.Abs(ax.x) + Mathf.Abs(ay.x) + Mathf.Abs(az.x),
                Mathf.Abs(ax.y) + Mathf.Abs(ay.y) + Mathf.Abs(az.y),
                Mathf.Abs(ax.z) + Mathf.Abs(ay.z) + Mathf.Abs(az.z));
            return _extents;
        }

        /// <summary>
        /// 自分の外形の半サイズをメートルで返す（自分のローカル回転を基準にした軸で）。
        ///
        /// worldToLocalMatrix ではなく「回転だけの逆変換」を使うのが要点。
        /// 前者はスケールも打ち消すので、値がメートルではなくローカル単位になり、
        /// 縮尺のかかったオブジェクトで隙間の計算がずれる。
        /// </summary>
        private Vector3 ComputeLocalBounds()
        {
            var renderers = GetComponentsInChildren<Renderer>(true);
            if (renderers.Length > 0)
            {
                bool any = false;
                var min = Vector3.zero;
                var max = Vector3.zero;
                var toLocal = Matrix4x4.TRS(transform.position, transform.rotation, Vector3.one).inverse;

                foreach (var renderer in renderers)
                {
                    var bounds = renderer.localBounds;
                    var toWorld = renderer.transform.localToWorldMatrix;
                    for (int corner = 0; corner < 8; corner++)
                    {
                        var offset = new Vector3(
                            (corner & 1) == 0 ? -bounds.extents.x : bounds.extents.x,
                            (corner & 2) == 0 ? -bounds.extents.y : bounds.extents.y,
                            (corner & 4) == 0 ? -bounds.extents.z : bounds.extents.z);
                        var point = toLocal.MultiplyPoint3x4(toWorld.MultiplyPoint3x4(bounds.center + offset));
                        if (!any) { min = max = point; any = true; }
                        else { min = Vector3.Min(min, point); max = Vector3.Max(max, point); }
                    }
                }
                if (any) return (max - min) * 0.5f;
            }

            // Canvas（UIサーフェス）は Renderer を持たないので RectTransform から測る
            if (transform is RectTransform rectTransform)
            {
                var size = rectTransform.rect.size;
                var scale = transform.lossyScale;
                return new Vector3(size.x * scale.x * 0.5f, size.y * scale.y * 0.5f, 0f);
            }

            return Vector3.zero;
        }

        private void SetVisible(bool visible)
        {
            // モデルは非同期で読み込まれて子が後から増えるので、都度取り直す
            // （切り替えは検出/消失のタイミングだけなので頻度は低い）
            foreach (var t in GetComponentsInChildren<Transform>(true))
            {
                if (t == null) continue;
                foreach (var r in t.GetComponents<Renderer>()) r.enabled = visible;
                foreach (var c in t.GetComponents<Canvas>()) c.enabled = visible;
            }
        }
    }
}
