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
//
// 読み出し: GetPixels32 (同期、フル解像度) ではなく GpuFrameReader を使う。
//   - GPU で要る大きさに縮めてから読む (1280x720 → 640x360 なら運ぶ画素は 1/4)
//   - 非同期なので描画を止めない (GetPixels32 は呼ぶたびに GPU の完了を待っていた)
//   - 回転・輝度・色の変換はワーカースレッド
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
        private Camera _camera;
        private readonly GpuFrameReader _reader = new GpuFrameReader();

        public string Description =>
            (ArsistDeviceCamera.Instance != null ? "Device camera (phone, shared)" : "WebCamTexture (editor)") +
            (_reader.AsyncSupported ? ", async GPU readback" : ", sync readback");

        public bool IsSupported =>
            ArsistDeviceCamera.Instance != null
            || (WebCamTexture.devices != null && WebCamTexture.devices.Length > 0);

        /// <summary>色つきの画も作るか。Manager が必要なフレームだけ立てる。</summary>
        public bool CaptureColor { get; set; }

        /// <summary>読み出す幅。0 はフル。Manager が FrameBudget で決める。</summary>
        public int RequestedMaxWidth { get; set; }

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

        // ---- 非同期の流れ ----
        //
        //   TryAcquire (メイン) → GpuFrameReader: Blit で縮小 → 非同期読み出し
        //     → OnFrame (メイン、読み出し完了) → ワーカー: 回転 + 輝度 / 色の変換
        //     → 次の TryAcquire で完成品を渡す
        //
        // Unity の API に触るのは Blit と読み出しだけで、それも非同期。
        // 変換中 (_converting) は次を取らない。読み出しバッファは GpuFrameReader が使い回すため。

        private readonly object _gate = new object();
        private bool _converting;
        private bool _hasReady;
        private ArsistCameraFrame _ready;
        private bool _readyHasColor;

        private int _lastLoggedWidth = -1;

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
            if (_reader.Busy) return false;

            var texture = Texture;
            if (texture == null || !texture.isPlaying || !texture.didUpdateThisFrame) return false;

            int w = texture.width, h = texture.height;
            if (w <= 16 || h <= 16) return false;

            // GPU で縮めてから読む。フル解像度が要るとき (OCR) は RequestedMaxWidth が 0。
            FrameBudget.ScaledSize(w, h, RequestedMaxWidth, out int readWidth, out int readHeight);

            // 撮った瞬間の値をまとめて持っていく。ワーカーから Unity の API は触れない。
            int turns = PhoneCameraMath.QuarterTurns(texture.videoRotationAngle);
            bool mirrored = texture.videoVerticallyMirrored;
            bool wantColor = CaptureColor;
            float fov = PhoneCameraSettings.HorizontalFovDegrees;
            var cam = _camera != null ? _camera : Camera.main;
            var pose = cam != null ? new Pose(cam.transform.position, cam.transform.rotation) : Pose.identity;
            double timestamp = Time.realtimeSinceStartupAsDouble;

            _reader.TryRequest(texture, readWidth, readHeight, (pixels, pw, ph, rowsTopDown) =>
            {
                if (_lastLoggedWidth != pw)
                {
                    _lastLoggedWidth = pw;
                    PerceptionStats.SetPath(_reader.AsyncSupported ? "gpu-async" : "gpu-sync", w, h, pw, ph);
                    Debug.Log($"[Arsist] Camera frames read back at {pw}x{ph} (native {w}x{h}, " +
                              $"{(_reader.AsyncSupported ? "async" : "sync")}, rotation {turns * 90}°).");
                }

                lock (_gate) _converting = true;
                System.Threading.ThreadPool.QueueUserWorkItem(_ =>
                {
                    var started = DateTime.UtcNow;
                    try
                    {
                        // 読み出しの行順 (上から下なら反転) と、映像自体の鏡写しは、どちらも回す前の画の上下反転。
                        bool flip = rowsTopDown != mirrored;
                        var oriented = Orient(pixels, pw, ph, turns, flip, out int ow, out int oh);
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
                        PerceptionStats.Convert((DateTime.UtcNow - started).TotalMilliseconds);
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
            });

            // 読み出しは非同期。完成品は次以降の TryAcquire で渡す。
            return false;
        }

        /// <summary>
        /// センサーの向きの画素を、画面に映っている向きに並べ替える。
        /// ワーカーから呼ばれるので、共有の作業配列は使わず毎回確保する
        /// (source は GpuFrameReader の使い回しバッファなので、そのまま返してはいけない)。
        /// </summary>
        private static Color32[] Orient(Color32[] source, int width, int height, int turns, bool flip,
                                        out int outWidth, out int outHeight)
        {
            PhoneCameraMath.RotatedSize(width, height, turns, out outWidth, out outHeight);

            var rotated = new Color32[width * height];
            if (turns == 0 && !flip)
            {
                Array.Copy(source, rotated, rotated.Length);
                return rotated;
            }

            for (int y = 0; y < outHeight; y++)
            {
                for (int x = 0; x < outWidth; x++)
                {
                    PhoneCameraMath.SourceOf(x, y, width, height, turns, out int sx, out int sy);
                    // 鏡写し / 行順の反転は回す前の画での上下反転 (背景の uvRect と同じ扱い)。
                    if (flip) sy = height - 1 - sy;
                    rotated[y * outWidth + x] = source[sy * width + sx];
                }
            }
            return rotated;
        }

        public void Shutdown()
        {
            _reader.Dispose();
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
