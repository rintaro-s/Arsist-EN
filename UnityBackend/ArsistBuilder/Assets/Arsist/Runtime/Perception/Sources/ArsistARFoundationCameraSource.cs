// ==============================================
// Arsist Engine - Perception / Sources
// AR Foundation 経由のカメラ供給 (XREAL / ARCore)
//
// XREAL SDK は XREALCameraSubsystem を提供しているので、ARCameraManager が
// そのまま使える。ARCore 端末も同じ経路。
// ==============================================

using System;
using Arsist.Runtime.Perception.Vision;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace Arsist.Runtime.Perception.Sources
{
    public sealed class ArsistARFoundationCameraSource : IArsistCameraFrameSource
    {
        private ARCameraManager _manager;
        private Camera _camera;
        private byte[] _buffer;

        public string Description => "AR Foundation camera";

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

        public bool TryAcquire(out ArsistCameraFrame frame)
        {
            frame = default;
            if (_manager == null || _camera == null) return false;

            if (!_manager.TryGetIntrinsics(out XRCameraIntrinsics intrinsics)) return false;
            if (!_manager.TryAcquireLatestCpuImage(out XRCpuImage image)) return false;

            try
            {
                int w = image.width, h = image.height;
                if (w <= 0 || h <= 0) return false;

                var plane = image.GetPlane(0); // YUV / YpCbCr のどちらでも plane 0 は輝度
                int needed = w * h;
                if (_buffer == null || _buffer.Length < needed) _buffer = new byte[needed];

                // AR Foundation の CPU 画像は上から下。Arsist の規約は下から上なので反転する。
                var data = plane.data;
                int stride = plane.rowStride;
                int pixelStride = plane.pixelStride;
                for (int y = 0; y < h; y++)
                {
                    int srcRow = (h - 1 - y) * stride;
                    int dstRow = y * w;
                    if (pixelStride == 1)
                    {
                        for (int x = 0; x < w; x++) _buffer[dstRow + x] = data[srcRow + x];
                    }
                    else
                    {
                        for (int x = 0; x < w; x++) _buffer[dstRow + x] = data[srcRow + x * pixelStride];
                    }
                }

                var gray = new GrayImage((byte[])_buffer.Clone(), w, h);

                // XRCameraIntrinsics は intrinsics.resolution 基準・左上原点。
                // 画像側の解像度に合わせてから、原点を左下に付け替える。
                double sx = (double)w / Mathf.Max(1, intrinsics.resolution.x);
                double sy = (double)h / Mathf.Max(1, intrinsics.resolution.y);
                var k = new CameraIntrinsics
                {
                    Fx = intrinsics.focalLength.x * sx,
                    Fy = intrinsics.focalLength.y * sy,
                    Cx = (intrinsics.principalPoint.x + 0.5) * sx - 0.5,
                    Cy = (h - 1) - ((intrinsics.principalPoint.y + 0.5) * sy - 0.5),
                };

                frame = new ArsistCameraFrame
                {
                    Image = gray,
                    Intrinsics = k,
                    // CPU 画像の取得は同フレーム内なので、現在のカメラ姿勢を使う。
                    CameraPose = new Pose(_camera.transform.position, _camera.transform.rotation),
                    TimestampSeconds = Time.realtimeSinceStartupAsDouble,
                };
                return true;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] AR Foundation frame conversion failed: {e.Message}");
                return false;
            }
            finally
            {
                image.Dispose();
            }
        }

        public void Shutdown()
        {
            _manager = null;
            _camera = null;
        }
    }
}
