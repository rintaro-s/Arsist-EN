// ==============================================
// Arsist Engine - Perception / Sources
// AR Foundation 経由のカメラ供給 (XREAL / ARCore)
//
// XREAL SDK は XREALCameraSubsystem を提供しているので、ARCameraManager が
// そのまま使える。ARCore 端末も同じ経路。
//
// ここは GPU テクスチャではなく CPU 画像 (YUV) が来る経路。縮小は XRCpuImage.Convert の
// outputDimensions に任せる (ネイティブ側で行われ、C# で全画素を舐めるより速い)。
// 要る幅 (RequestedMaxWidth) より大きい画素を C# に運ばない。
// 輝度は plane 0 をそのまま使う。色が要るときだけ RGBA に変換する。
// 変換したバイト列を GrayImage / ColorImage にするのはワーカースレッド。
// ==============================================

using System;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Vision.Classic;
using Unity.Collections;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace Arsist.Runtime.Perception.Sources
{
    public sealed class ArsistARFoundationCameraSource : IArsistCameraFrameSource
    {
        private ARCameraManager _manager;
        private Camera _camera;

        // 使い回すバッファ。毎フレーム 1〜4 MB を確保しない。
        private byte[] _grayScratch;
        private byte[] _rgbaScratch;

        private readonly object _gate = new object();
        private bool _converting;
        private bool _hasReady;
        private ArsistCameraFrame _ready;
        private bool _readyHasColor;
        private int _lastLoggedWidth = -1;

        public string Description => "AR Foundation camera (native downscale)";

        public bool IsSupported => FindManager() != null;

        private ARCameraManager FindManager()
        {
            if (_manager != null) return _manager;
            _manager = UnityEngine.Object.FindFirstObjectByType<ARCameraManager>();
            return _manager;
        }

        public bool Initialize()
        {
            var manager = FindManager();
            if (manager == null) return false;
            _camera = manager.GetComponent<Camera>();
            if (_camera == null) _camera = Camera.main;
            Debug.Log("[Arsist] AR Foundation camera source initialized.");
            return true;
        }

        /// <summary>
        /// 色つきの画も作るか。AR Foundation の CPU 画像は YUV なので、
        /// RGB が要るときだけ変換を通す。
        /// </summary>
        public bool CaptureColor { get; set; }

        /// <summary>読み出す幅。0 はフル。Manager が FrameBudget で決める。</summary>
        public int RequestedMaxWidth { get; set; }

        public bool TryAcquire(out ArsistCameraFrame frame)
        {
            frame = default;
            if (_manager == null || _camera == null) return false;

            lock (_gate)
            {
                if (_hasReady)
                {
                    if (CaptureColor && !_readyHasColor)
                    {
                        _hasReady = false; // 色が要るのに色なし: 撮り直す
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

            if (!_manager.TryGetIntrinsics(out XRCameraIntrinsics intrinsics)) return false;
            if (!_manager.TryAcquireLatestCpuImage(out XRCpuImage image)) return false;

            var started = Time.realtimeSinceStartupAsDouble;
            try
            {
                int nativeW = image.width, nativeH = image.height;
                if (nativeW <= 0 || nativeH <= 0) return false;

                FrameBudget.ScaledSize(nativeW, nativeH, RequestedMaxWidth, out int w, out int h);
                bool wantColor = CaptureColor;

                // ---- 輝度 ----
                bool grayFromRgba = false;
                if (w == nativeW && h == nativeH)
                {
                    // 縮めない: plane 0 (Y) をそのまま写す。上から下 → 下から上。
                    var plane = image.GetPlane(0);
                    int needed = w * h;
                    if (_grayScratch == null || _grayScratch.Length < needed) _grayScratch = new byte[needed];
                    var data = plane.data;
                    int stride = plane.rowStride;
                    int pixelStride = plane.pixelStride;
                    for (int y = 0; y < h; y++)
                    {
                        int srcRow = (h - 1 - y) * stride;
                        int dstRow = y * w;
                        if (pixelStride == 1)
                        {
                            NativeArray<byte>.Copy(data, srcRow, _grayScratch, dstRow, w);
                        }
                        else
                        {
                            for (int x = 0; x < w; x++) _grayScratch[dstRow + x] = data[srcRow + x * pixelStride];
                        }
                    }
                }
                else if (image.FormatSupported(TextureFormat.R8) && !wantColor)
                {
                    // 縮める: ネイティブ側で R8 (輝度) に変換しつつ縮小する。
                    ConvertInto(image, w, h, TextureFormat.R8, ref _grayScratch);
                }
                else
                {
                    // 縮めるが R8 が使えない (か、どうせ色も要る): RGBA に縮小変換して、輝度はそこから作る。
                    grayFromRgba = true;
                    wantColor = true;
                }

                // ---- 色 ----
                if (wantColor)
                {
                    ConvertInto(image, w, h, TextureFormat.RGBA32, ref _rgbaScratch);
                }

                // XRCameraIntrinsics は intrinsics.resolution 基準・左上原点。
                // 渡す画像の解像度に合わせてから、原点を左下に付け替える。
                double sx = (double)w / Mathf.Max(1, intrinsics.resolution.x);
                double sy = (double)h / Mathf.Max(1, intrinsics.resolution.y);
                var k = new CameraIntrinsics
                {
                    Fx = intrinsics.focalLength.x * sx,
                    Fy = intrinsics.focalLength.y * sy,
                    Cx = (intrinsics.principalPoint.x + 0.5) * sx - 0.5,
                    Cy = (h - 1) - ((intrinsics.principalPoint.y + 0.5) * sy - 0.5),
                };
                // CPU 画像の取得は同フレーム内なので、現在のカメラ姿勢を使う。
                var pose = new Pose(_camera.transform.position, _camera.transform.rotation);
                double timestamp = Time.realtimeSinceStartupAsDouble;

                PerceptionStats.Readback((Time.realtimeSinceStartupAsDouble - started) * 1000.0);
                if (_lastLoggedWidth != w)
                {
                    _lastLoggedWidth = w;
                    PerceptionStats.SetPath("cpu-yuv", nativeW, nativeH, w, h);
                    Debug.Log($"[Arsist] AR Foundation frames converted at {w}x{h} (native {nativeW}x{nativeH}).");
                }

                // 写し終えたバッファを持ってワーカーへ。ワーカーが終わるまで次の変換はしない (_converting)。
                var grayBytes = _grayScratch;
                var rgbaBytes = _rgbaScratch;
                bool colorReady = wantColor && rgbaBytes != null;
                bool grayViaRgba = grayFromRgba;
                bool keepColor = CaptureColor;

                lock (_gate) _converting = true;
                System.Threading.ThreadPool.QueueUserWorkItem(_ =>
                {
                    var convertStarted = DateTime.UtcNow;
                    try
                    {
                        ColorImage color = colorReady ? ColorImage.FromRgba(rgbaBytes, w, h) : null;
                        GrayImage gray;
                        if (grayViaRgba && color != null) gray = color.ToGray();
                        else
                        {
                            var copy = new byte[w * h];
                            Array.Copy(grayBytes, copy, copy.Length);
                            gray = new GrayImage(copy, w, h);
                        }

                        lock (_gate)
                        {
                            _ready = new ArsistCameraFrame
                            {
                                Image = gray,
                                Color = keepColor ? color : null,
                                Intrinsics = k,
                                CameraPose = pose,
                                TimestampSeconds = timestamp,
                            };
                            _readyHasColor = keepColor && color != null;
                            _hasReady = true;
                        }
                        PerceptionStats.Convert((DateTime.UtcNow - convertStarted).TotalMilliseconds);
                    }
                    catch (Exception e)
                    {
                        Debug.LogWarning($"[Arsist] AR Foundation frame conversion failed: {e.Message}");
                    }
                    finally
                    {
                        lock (_gate) _converting = false;
                    }
                });
                return false;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] AR Foundation frame acquisition failed: {e.Message}");
                return false;
            }
            finally
            {
                image.Dispose();
            }
        }

        /// <summary>
        /// CPU 画像を、指定の大きさ・形式に変換して使い回しのバッファへ写す。
        /// MirrorY で行順を下から上に揃える (Arsist の規約)。
        /// </summary>
        private static void ConvertInto(XRCpuImage image, int width, int height, TextureFormat format, ref byte[] scratch)
        {
            var parameters = new XRCpuImage.ConversionParams
            {
                inputRect = new RectInt(0, 0, image.width, image.height),
                outputDimensions = new Vector2Int(width, height),
                outputFormat = format,
                transformation = XRCpuImage.Transformation.MirrorY,
            };

            int size = image.GetConvertedDataSize(parameters);
            if (scratch == null || scratch.Length < size) scratch = new byte[size];

            var buffer = new NativeArray<byte>(size, Allocator.Temp);
            try
            {
                image.Convert(parameters, buffer);
                NativeArray<byte>.Copy(buffer, scratch, size);
            }
            finally { buffer.Dispose(); }
        }

        public void Shutdown()
        {
            _manager = null;
            _camera = null;
            lock (_gate)
            {
                _hasReady = false;
                _ready = default;
            }
        }
    }
}
