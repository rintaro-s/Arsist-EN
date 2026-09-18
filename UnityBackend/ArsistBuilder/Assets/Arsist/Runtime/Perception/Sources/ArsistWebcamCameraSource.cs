// ==============================================
// Arsist Engine - Perception / Sources
// スマホ / エディタ / デスクトップ用 WebCamTexture 供給
//
// スマホでは ArsistDeviceCamera が開いたカメラを借りる。Android は同じカメラを
// 同時に一度しか開けないので、ここで別に開くと背景か認識のどちらかが真っ黒になる。
// エディタやデスクトップのように ArsistDeviceCamera が居ない場合だけ、自分で開く。
//
// 焦点距離は WebCamTexture からは取れないので、PhoneCameraSettings の画角から仮定する。
// 背景 (ArsistCameraBackground) も同じ値を使うので、現実に重ねた絵と映像は揃う。
//
// 画素はセンサーの向きのまま来る (多くの端末で 90° 回っている)。画面に映っている
// 向きに回してから渡さないと、現実に重ねた絵が 90° 回った場所に出る。
// ==============================================

using System;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Vision.Classic;
using Arsist.Runtime.Tracking;
using UnityEngine;

namespace Arsist.Runtime.Perception.Sources
{
    public sealed class ArsistWebcamCameraSource : IArsistCameraFrameSource
    {
        private WebCamTexture _ownTexture;
        private Color32[] _pixels;
        private Camera _camera;

        public string Description =>
            ArsistDeviceCamera.Instance != null ? "Device camera (phone, shared)" : "WebCamTexture (editor)";

        public bool IsSupported =>
            ArsistDeviceCamera.Instance != null
            || (WebCamTexture.devices != null && WebCamTexture.devices.Length > 0);

        /// <summary>色つきの画も作るか。Manager が必要なフレームだけ立てる。</summary>
        public bool CaptureColor { get; set; }

        private WebCamTexture Texture =>
            ArsistDeviceCamera.Instance != null ? ArsistDeviceCamera.Instance.Texture : _ownTexture;

        public bool Initialize()
        {
            _camera = Camera.main;

            // スマホではカメラを共有する。開くのは ArsistDeviceCamera の役目。
            if (ArsistDeviceCamera.Instance != null)
            {
                Debug.Log("[Arsist] Webcam source uses the shared device camera.");
                return true;
            }

            if (WebCamTexture.devices == null || WebCamTexture.devices.Length == 0) return false;
            _ownTexture = new WebCamTexture(WebCamTexture.devices[0].name, 1280, 720, 30);
            _ownTexture.Play();
            Debug.Log($"[Arsist] Webcam source initialized: {WebCamTexture.devices[0].name}");
            return true;
        }

        // ---- ここから非同期化 ----
        //
        // 画素の並べ替え (回転) と、輝度・色の画への変換は 1280x720 で数十 ms かかる。
        // これをメインスレッドでやると、画を取るたびに描画が止まってカクつく。
        // Unity の API が要るのは GetPixels32 だけなので、それ以外はワーカーに出す。
        // (Quest の供給も AsyncGPUReadback で同じ形にしてある。)

        private readonly object _gate = new object();
        private bool _converting;
        private bool _hasReady;
        private ArsistCameraFrame _ready;
        private bool _readyHasColor;

        public bool TryAcquire(out ArsistCameraFrame frame)
        {
            frame = default;

            lock (_gate)
            {
                if (_hasReady)
                {
                    // 色が要るのに色なしで仕上がった画は捨てて撮り直す。
                    // そのまま渡すと画像処理が noColorFrame で失敗し、1 回分遅れる。
                    if (CaptureColor && !_readyHasColor)
                    {
                        _hasReady = false;
                    }
                    else
                    {
                        frame = _ready;
                        _hasReady = false;
                        _ready = default;
                        return true;
                    }
                }
                if (_converting) return false;
            }

            var texture = Texture;
            if (texture == null || !texture.isPlaying || !texture.didUpdateThisFrame) return false;

            int w = texture.width, h = texture.height;
            if (w <= 16 || h <= 16) return false;

            // GetPixels32 だけはメインスレッドで。ワーカーが読んでいる間に次の GetPixels32 が
            // 同じ配列を上書きしないよう、変換中は次を取らない (_converting)。
            if (_pixels == null || _pixels.Length != w * h) _pixels = new Color32[w * h];
            texture.GetPixels32(_pixels);

            // 撮った瞬間の値をまとめて持っていく。ワーカーから Unity の API は触れない。
            int turns = PhoneCameraMath.QuarterTurns(texture.videoRotationAngle);
            bool mirrored = texture.videoVerticallyMirrored;
            bool wantColor = CaptureColor;
            float fov = PhoneCameraSettings.HorizontalFovDegrees;
            var cam = _camera != null ? _camera : Camera.main;
            var pose = cam != null ? new Pose(cam.transform.position, cam.transform.rotation) : Pose.identity;
            double timestamp = Time.realtimeSinceStartupAsDouble;
            var pixels = _pixels;

            lock (_gate) _converting = true;

            System.Threading.ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    var oriented = Orient(pixels, w, h, turns, mirrored, out int ow, out int oh);
                    var gray = GrayImageUnity.FromColor32(oriented, ow, oh);
                    var color = wantColor ? ColorImageUnity.FromColor32(oriented, ow, oh) : null;

                    double focal = PhoneCameraMath.FocalFromHorizontalFov(ow, fov);
                    var k = new CameraIntrinsics { Fx = focal, Fy = focal, Cx = (ow - 1) * 0.5, Cy = (oh - 1) * 0.5 };

                    lock (_gate)
                    {
                        _ready = new ArsistCameraFrame
                        {
                            Image = gray,
                            Color = color,
                            Intrinsics = k,
                            CameraPose = pose,
                            TimestampSeconds = timestamp,
                        };
                        _readyHasColor = color != null;
                        _hasReady = true;
                    }
                }
                catch (Exception e)
                {
                    // ワーカーの例外は握りつぶされやすいので必ず残す。
                    Debug.LogWarning($"[Arsist] Camera frame conversion failed: {e.Message}");
                }
                finally
                {
                    lock (_gate) _converting = false;
                }
            });

            return false;
        }

        /// <summary>
        /// センサーの向きの画素を、画面に映っている向きに並べ替える。
        /// ワーカーから呼ばれるので、共有の作業配列は使わず毎回確保する。
        /// </summary>
        private static Color32[] Orient(Color32[] source, int width, int height, int turns, bool mirrored,
                                        out int outWidth, out int outHeight)
        {
            PhoneCameraMath.RotatedSize(width, height, turns, out outWidth, out outHeight);
            if (turns == 0 && !mirrored) return source;

            var rotated = new Color32[source.Length];
            for (int y = 0; y < outHeight; y++)
            {
                for (int x = 0; x < outWidth; x++)
                {
                    PhoneCameraMath.SourceOf(x, y, width, height, turns, out int sx, out int sy);
                    // 鏡写しは回す前の画での上下反転 (背景の uvRect と同じ扱い)。
                    if (mirrored) sy = height - 1 - sy;
                    rotated[y * outWidth + x] = source[sy * width + sx];
                }
            }
            return rotated;
        }

        public void Shutdown()
        {
            // 借りたカメラは止めない。持ち主 (ArsistDeviceCamera) が止める。
            if (_ownTexture != null)
            {
                _ownTexture.Stop();
                UnityEngine.Object.Destroy(_ownTexture);
                _ownTexture = null;
            }
        }
    }
}
