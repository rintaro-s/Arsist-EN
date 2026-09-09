// ==============================================
// Arsist Engine - Perception / Sources
// エディタ / デスクトップ用 WebCamTexture 供給
//
// 実機なしで認識器を動かせるようにするための経路。焦点距離は既知でないので
// 一般的な画角 (水平 60°) から仮定する。距離の絶対値は当てにならないが、
// 認識できるか・向きが合うかの確認には十分使える。
// ==============================================

using Arsist.Runtime.Perception.Vision;
using UnityEngine;

namespace Arsist.Runtime.Perception.Sources
{
    public sealed class ArsistWebcamCameraSource : IArsistCameraFrameSource
    {
        private const float AssumedHorizontalFovDegrees = 60f;

        private WebCamTexture _texture;
        private Color32[] _pixels;
        private Camera _camera;

        public string Description => "WebCamTexture (editor)";

        public bool IsSupported => WebCamTexture.devices != null && WebCamTexture.devices.Length > 0;

        public bool Initialize()
        {
            if (!IsSupported) return false;
            _texture = new WebCamTexture(WebCamTexture.devices[0].name, 1280, 720, 30);
            _texture.Play();
            _camera = Camera.main;
            Debug.Log($"[Arsist] Webcam source initialized: {WebCamTexture.devices[0].name}");
            return true;
        }

        public bool TryAcquire(out ArsistCameraFrame frame)
        {
            frame = default;
            if (_texture == null || !_texture.didUpdateThisFrame) return false;

            int w = _texture.width, h = _texture.height;
            if (w <= 16 || h <= 16) return false;

            if (_pixels == null || _pixels.Length < w * h) _pixels = new Color32[w * h];
            _texture.GetPixels32(_pixels); // GetPixels32 は左下原点なので反転不要

            var gray = GrayImageUnity.FromColor32(_pixels, w, h);
            double fx = w * 0.5 / Mathf.Tan(AssumedHorizontalFovDegrees * 0.5f * Mathf.Deg2Rad);
            var k = new CameraIntrinsics { Fx = fx, Fy = fx, Cx = (w - 1) * 0.5, Cy = (h - 1) * 0.5 };

            var cam = _camera != null ? _camera : Camera.main;
            frame = new ArsistCameraFrame
            {
                Image = gray,
                Intrinsics = k,
                CameraPose = cam != null
                    ? new Pose(cam.transform.position, cam.transform.rotation)
                    : Pose.identity,
                TimestampSeconds = Time.realtimeSinceStartupAsDouble,
            };
            return true;
        }

        public void Shutdown()
        {
            if (_texture != null)
            {
                _texture.Stop();
                UnityEngine.Object.Destroy(_texture);
                _texture = null;
            }
        }
    }
}
