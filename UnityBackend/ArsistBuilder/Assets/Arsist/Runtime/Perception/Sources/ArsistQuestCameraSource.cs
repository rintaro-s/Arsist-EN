// ==============================================
// Arsist Engine - Perception / Sources
// Meta Quest 3 / 3S : Passthrough Camera Access
//
// MRUK (com.meta.xr.mrutilitykit) の PassthroughCameraAccess をリフレクション越しに使う。
// 直接参照しないのは、XREAL 向けビルドでは MRUK がプロジェクトに入らないため
// （Assembly-CSharp が丸ごとコンパイルエラーになる）。
// ArsistBuildPipeline が OVR 型を扱うのと同じ方針。
//
// 画素の取り出しは PassthroughCameraAccess.GetColors() ではなく自前の
// AsyncGPUReadback を使う。GetColors() は WaitForCompletion で GPU を待つため、
// 呼ぶたびにフレームが止まる。
// ==============================================

using System;
using System.Reflection;
using Arsist.Runtime.Perception.Vision;
using UnityEngine;
using UnityEngine.Rendering;

namespace Arsist.Runtime.Perception.Sources
{
    public sealed class ArsistQuestCameraSource : IArsistCameraFrameSource
    {
        public const string CameraPermission = "horizonos.permission.HEADSET_CAMERA";
        // 名前空間は Meta.XR。パッケージ名 (com.meta.xr.mrutilitykit) やアセンブリ名
        // (meta.xr.mrutilitykit) とは一致しないので注意。
        // ここを Meta.XR.MRUtilityKit.PassthroughCameraAccess と書いていて、
        // 実機で「No camera frame source available」とだけ出る状態を作った。
        private const string TypeName = "Meta.XR.PassthroughCameraAccess";

        /// <summary>
        /// 要求する解像度。フル解像度のまま上位へ渡す。
        /// 検出用の縮小は ArsistPerceptionManager 側で行う。
        /// OCR は「枠を切り出して正対化する」ので、元が細かいほど小さな文字が残る。
        /// </summary>
        private const int RequestWidth = 1280;
        private const int RequestHeight = 960;

        /// <summary>
        /// 読み出した画素の行順を反転するか。
        ///
        /// Unity のテクスチャは下から上（左下原点）で、MRUK の内部パラメータも
        /// 左下原点のセンサー座標で表されているため、既定は反転なし。
        /// ただし AsyncGPUReadback の行順はグラフィックス API 実装に依存する部分があり、
        /// ここが逆だと「検出はできるのにアンカーが上下反転／鏡像で出る」という症状になる
        /// （縦反転もホモグラフィで表せてしまうので、再投影誤差では検出できない）。
        /// 実機でそうなったら、まずここを true にすること。
        /// </summary>
        private const bool FlipReadbackRows = false;

        private static Type _type;
        private static PropertyInfo _isSupported, _isPlaying, _currentResolution, _intrinsics, _isUpdatedThisFrame;
        private static FieldInfo _requestedResolution;
        private static MethodInfo _getTexture, _getCameraPose;
        private static FieldInfo _focalLength, _principalPoint, _sensorResolution;

        private GameObject _host;
        private Component _access;
        private bool _permissionRequested;

        private bool _readbackPending;
        private Pose _pendingPose;
        private double _pendingTimestamp;
        private int _pendingWidth, _pendingHeight;
        private Color32[] _pendingPixels;
        private ArsistCameraFrame _ready;
        private bool _hasReady;

        public string Description => "Meta Quest Passthrough Camera";

        public bool IsSupported
        {
            get
            {
                if (!Resolve()) return false;
                try { return (bool)_isSupported.GetValue(null); }
                catch (Exception e)
                {
                    Debug.LogWarning($"[Arsist] PassthroughCameraAccess.IsSupported threw: {e.Message}");
                    return false;
                }
            }
        }

        private static bool Resolve()
        {
            if (_type != null) return true;

            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                var t = asm.GetType(TypeName, false);
                if (t == null) continue;
                _type = t;
                break;
            }
            if (_type == null)
            {
                // 「見つからない」で終わらせない。MRUK 自体が入っていないのか、
                // 型名が変わったのかで対処がまったく違う。
                bool mrukPresent = false;
                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    if (asm.GetName().Name.IndexOf("mrutilitykit", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    mrukPresent = true;
                    break;
                }
                Debug.LogWarning(mrukPresent
                    ? $"[Arsist] MRUK is loaded but '{TypeName}' was not found in it. " +
                      "Meta may have moved the type, or IL2CPP stripped it (see Assets/Arsist/link.xml)."
                    : $"[Arsist] '{TypeName}' not found and MRUK is not loaded at all; " +
                      "this build has no Passthrough Camera Access.");
                return false;
            }

            const BindingFlags Pub = BindingFlags.Public | BindingFlags.Instance;
            _isSupported = _type.GetProperty("IsSupported", BindingFlags.Public | BindingFlags.Static);
            _isPlaying = _type.GetProperty("IsPlaying", Pub);
            _currentResolution = _type.GetProperty("CurrentResolution", Pub);
            _intrinsics = _type.GetProperty("Intrinsics", Pub);
            _isUpdatedThisFrame = _type.GetProperty("IsUpdatedThisFrame", Pub);
            _requestedResolution = _type.GetField("RequestedResolution", Pub);
            _getTexture = _type.GetMethod("GetTexture", Pub, null, Type.EmptyTypes, null);
            _getCameraPose = _type.GetMethod("GetCameraPose", Pub, null, Type.EmptyTypes, null);

            var intrinsicsType = _type.GetNestedType("CameraIntrinsics", BindingFlags.Public);
            if (intrinsicsType != null)
            {
                _focalLength = intrinsicsType.GetField("FocalLength");
                _principalPoint = intrinsicsType.GetField("PrincipalPoint");
                _sensorResolution = intrinsicsType.GetField("SensorResolution");
            }

            bool ok = _isSupported != null && _isPlaying != null && _currentResolution != null
                      && _intrinsics != null && _isUpdatedThisFrame != null && _getTexture != null
                      && _getCameraPose != null && _focalLength != null && _principalPoint != null
                      && _sensorResolution != null;
            if (!ok)
            {
                Debug.LogWarning("[Arsist] PassthroughCameraAccess was found but its API does not match " +
                                 "what Arsist expects. Image anchors will be disabled on this device.");
                _type = null;
            }
            return ok;
        }

        public bool Initialize()
        {
            if (!Resolve()) return false;

            if (!HasPermission())
            {
                if (!_permissionRequested)
                {
                    _permissionRequested = true;
#if UNITY_ANDROID && !UNITY_EDITOR
                    UnityEngine.Android.Permission.RequestUserPermission(CameraPermission);
#endif
                    Debug.Log($"[Arsist] Requested {CameraPermission} for image anchors.");
                }
                return false; // 許可が下りた次のフレーム以降で再試行される
            }

            _host = new GameObject("ArsistPassthroughCamera");
            _host.transform.SetParent(null);
            UnityEngine.Object.DontDestroyOnLoad(_host);
            _access = _host.AddComponent(_type);

            try
            {
                _requestedResolution?.SetValue(_access, new Vector2Int(RequestWidth, RequestHeight));
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Could not set RequestedResolution: {e.Message}");
            }

            Debug.Log($"[Arsist] Passthrough camera source initialized (flipReadbackRows={FlipReadbackRows}).");
            return true;
        }

        public static bool HasPermission()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            return UnityEngine.Android.Permission.HasUserAuthorizedPermission(CameraPermission);
#else
            return true;
#endif
        }

        public bool TryAcquire(out ArsistCameraFrame frame)
        {
            frame = default;
            if (_access == null) return false;

            if (_hasReady)
            {
                frame = _ready;
                _hasReady = false;
                _ready = default;
                return true;
            }

            if (_readbackPending) return false;

            try
            {
                if (!(bool)_isPlaying.GetValue(_access)) return false;
                if (!(bool)_isUpdatedThisFrame.GetValue(_access)) return false;

                var texture = _getTexture.Invoke(_access, null) as Texture;
                if (texture == null) return false;

                var resolution = (Vector2Int)_currentResolution.GetValue(_access);
                if (resolution.x <= 0 || resolution.y <= 0) return false;

                // 姿勢は「今この画像が撮られた時刻」のもの。読み出し完了まで持ち越す。
                _pendingPose = (Pose)_getCameraPose.Invoke(_access, null);
                _pendingTimestamp = Time.realtimeSinceStartupAsDouble;
                _pendingWidth = resolution.x;
                _pendingHeight = resolution.y;
                _readbackPending = true;

                AsyncGPUReadback.Request(texture, 0, TextureFormat.RGBA32, OnReadback);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Passthrough camera read failed: {e.Message}");
                _readbackPending = false;
                return false;
            }

            return false;
        }

        private void OnReadback(AsyncGPUReadbackRequest request)
        {
            _readbackPending = false;
            if (request.hasError || _access == null) return;

            try
            {
                var data = request.GetData<Color32>();
                int needed = _pendingWidth * _pendingHeight;
                if (data.Length < needed) return;

                if (_pendingPixels == null || _pendingPixels.Length < needed)
                    _pendingPixels = new Color32[needed];
                data.GetSubArray(0, needed).CopyTo(_pendingPixels);

                var gray = GrayImageUnity.FromColor32(_pendingPixels, _pendingWidth, _pendingHeight, FlipReadbackRows);
                var intrinsics = ReadIntrinsics(_pendingWidth, _pendingHeight);

                _ready = new ArsistCameraFrame
                {
                    Image = gray,
                    Intrinsics = intrinsics,
                    CameraPose = _pendingPose,
                    TimestampSeconds = _pendingTimestamp,
                };
                _hasReady = true;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Passthrough readback conversion failed: {e.Message}");
            }
        }

        /// <summary>
        /// センサー解像度基準の内部パラメータを、実際に受け取った画像のピクセル系に換算する。
        /// PassthroughCameraAccess.CalcSensorCropRegion と同じ切り出しを再現している。
        /// </summary>
        private CameraIntrinsics ReadIntrinsics(int width, int height)
        {
            var raw = _intrinsics.GetValue(_access);
            var focal = (Vector2)_focalLength.GetValue(raw);
            var principal = (Vector2)_principalPoint.GetValue(raw);
            var sensor = (Vector2Int)_sensorResolution.GetValue(raw);

            float sx = (float)width / sensor.x;
            float sy = (float)height / sensor.y;
            float m = Mathf.Max(sx, sy);
            sx /= m; sy /= m;

            float cropX = sensor.x * (1f - sx) * 0.5f;
            float cropY = sensor.y * (1f - sy) * 0.5f;
            float cropW = sensor.x * sx;
            float cropH = sensor.y * sy;

            return new CameraIntrinsics
            {
                Fx = focal.x * width / cropW,
                Fy = focal.y * height / cropH,
                Cx = (principal.x - cropX) * width / cropW,
                Cy = (principal.y - cropY) * height / cropH,
            };
        }

        /// <summary>
        /// 縮小に伴う内部パラメータの換算。
        /// GrayImage.Scaled は画素中心を (x+0.5)*s-0.5 に写すので、主点も同じ式で移す。
        /// </summary>
        public static CameraIntrinsics ScaleIntrinsics(CameraIntrinsics k, double sx, double sy)
        {
            return new CameraIntrinsics
            {
                Fx = k.Fx * sx,
                Fy = k.Fy * sy,
                Cx = (k.Cx + 0.5) * sx - 0.5,
                Cy = (k.Cy + 0.5) * sy - 0.5,
            };
        }

        public void Shutdown()
        {
            if (_host != null)
            {
                UnityEngine.Object.Destroy(_host);
                _host = null;
                _access = null;
            }
            _hasReady = false;
            _readbackPending = false;
        }
    }
}
