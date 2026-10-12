// ==============================================
// Arsist Engine - スクリプトの camera (カメラの画)
//
//   camera.available()
//   camera.capture([{ maxWidth, quality, around: { x, y, z, size } }], fn(r))
//       r = { ok, image (base64 JPEG), mime, width, height, pose, region, error }
//   camera.project(x, y, z) → { x, y, inView, ready }   (x, y は画の左上が 0、右下が 1)
//
// 画は認識と同じ供給 (ArsistPerceptionManager.RequestStill) から取る。Quest 3/3S はパススルーカメラ。
// マネージャはビルドが「カメラを使うプロジェクト」(feature:camera / 画像処理 / 画像アンカー) のときだけ積む。
// 無ければ { ok: false, error: 'noCamera' }。
//
// around: そのワールドの点のまわり size m 四方が写っている部分だけを切り出す (机の上だけを画像 API に送る、など)。
// 切り出し・縮小はワーカーで、JPEG にするのはメインスレッド (ImageConversion)。
// 幾何は CameraRegionMath (tools/perception-check で検証)。
// ==============================================

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Arsist.Runtime.Perception;
using Jint.Native;
using UnityEngine;
using UnityEngine.Experimental.Rendering;

namespace Arsist.Runtime.Scripting
{
    [UnityEngine.Scripting.Preserve]
    public sealed class CameraWrapper
    {
        private const float CaptureTimeoutSeconds = 10f;

        private readonly JsBridge _js;
        private readonly ViewerWrapper _viewer;

        // camera.project のための較正 (最後に撮れた画から): 頭に対するカメラの位置・向きと、内部パラメータ (画の大きさで割ったもの)
        private bool _calibrated;
        private Vector3 _cameraOffset;
        private Quaternion _cameraRotationOffset = Quaternion.identity;
        private double _fxN, _fyN, _cxN, _cyN;
        private bool _calibrating;

        public CameraWrapper(JsBridge js, ViewerWrapper viewer)
        {
            _js = js;
            _viewer = viewer;
        }

        [UnityEngine.Scripting.Preserve]
        public bool available()
        {
            if (ArsistPerceptionManager.Instance == null) return false;
            try
            {
                if (new Perception.Sources.ArsistQuestCameraSource().IsSupported) return true;
                if (new Perception.Sources.ArsistARFoundationCameraSource().IsSupported) return true;
                if (Tracking.ArsistDeviceCamera.Instance != null) return true;
#if UNITY_EDITOR || UNITY_STANDALONE
                if (new Perception.Sources.ArsistWebcamCameraSource().IsSupported) return true;
#endif
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[ArsistJS] camera.available: {e.Message}");
            }
            return false;
        }

        [UnityEngine.Scripting.Preserve]
        public void capture(JsValue optionsOrCallback = null, JsValue callback = null)
        {
            JsValue options = optionsOrCallback;
            if (_js.IsFunction(optionsOrCallback))
            {
                callback = optionsOrCallback;
                options = null;
            }
            var opts = _js.FromJs(options) as Dictionary<string, object>;
            int maxWidth = (int)Math.Max(16, JsBridge.Number(opts, "maxWidth", 1024));
            int quality = (int)Math.Max(1, Math.Min(100, JsBridge.Number(opts, "quality", 80)));
            var around = JsBridge.Obj(opts, "around");

            var host = ScriptRuntimeHost.Instance;
            var manager = ArsistPerceptionManager.Instance;
            if (manager == null || host == null)
            {
                Reply(callback, Failure(manager == null ? "noCamera" : "notReady"));
                return;
            }

            bool settled = false;
            float deadline = Time.unscaledTime + CaptureTimeoutSeconds;
            host.AddTicker(() =>
            {
                if (settled) return false;
                if (Time.unscaledTime < deadline) return true;
                settled = true;
                Reply(callback, Failure("timeout (no camera picture within 10 s — permission not granted?)"));
                return false;
            });

            // 切り出すなら細かい画 (フル) を取ってから縮める。でなければ要る幅だけ読む。
            manager.RequestStill(still =>
            {
                if (settled) return;
                settled = true;
                if (!still.Valid || still.Color == null) { Reply(callback, Failure("noFrame")); return; }
                Calibrate(still);
                Encode(still, around, maxWidth, quality, callback);
            }, wantColor: true, maxWidth: around != null ? 0 : maxWidth);
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue project(double x, double y, double z)
        {
            var result = new Dictionary<string, object> { ["inView"] = false, ["ready"] = _calibrated };
            var head = _viewer?.HeadTransform;
            if (!_calibrated || head == null)
            {
                RequestCalibration();
                result["x"] = null;
                result["y"] = null;
                return _js.ToJs(result);
            }

            var pose = PoseData(head.position + head.rotation * _cameraOffset, head.rotation * _cameraRotationOffset);
            // 正規化した内部パラメータ (画の幅・高さ = 1)
            if (CameraRegionMath.Project(pose, _fxN, _fyN, _cxN, _cyN, x, y, z, out var u, out var v, out _))
            {
                double top = 1 - v;   // v は下から。返すのは上から
                result["x"] = u;
                result["y"] = top;
                result["inView"] = u >= 0 && u <= 1 && top >= 0 && top <= 1;
            }
            else
            {
                result["x"] = null;
                result["y"] = null;
            }
            return _js.ToJs(result);
        }

        // ---- 内部 ----

        private void RequestCalibration()
        {
            var manager = ArsistPerceptionManager.Instance;
            if (_calibrating || manager == null) return;
            _calibrating = true;
            manager.RequestStill(still =>
            {
                _calibrating = false;
                if (still.Valid && still.Image != null) Calibrate(still);
            }, wantColor: false, maxWidth: 320);
        }

        private void Calibrate(in PerceptionStill still)
        {
            var head = _viewer?.HeadTransform;
            int w = still.Color != null ? still.Color.Width : still.Image?.Width ?? 0;
            int h = still.Color != null ? still.Color.Height : still.Image?.Height ?? 0;
            if (head == null || w <= 0 || h <= 0) return;
            var inverseHead = Quaternion.Inverse(head.rotation);
            _cameraOffset = inverseHead * (still.CameraPose.position - head.position);
            _cameraRotationOffset = inverseHead * still.CameraPose.rotation;
            var k = ScaledIntrinsics(still, w);
            _fxN = k.Fx / w; _fyN = k.Fy / h; _cxN = k.Cx / w; _cyN = k.Cy / h;
            _calibrated = true;
        }

        /// <summary>内部パラメータは灰色の画 (Image) の大きさに対するもの。色の画の大きさが違えば合わせる。</summary>
        private static Perception.Vision.CameraIntrinsics ScaledIntrinsics(in PerceptionStill still, int colorWidth)
        {
            var k = still.Intrinsics;
            int baseWidth = still.Image != null ? still.Image.Width : colorWidth;
            if (baseWidth <= 0 || baseWidth == colorWidth) return k;
            double s = (double)colorWidth / baseWidth;
            return new Perception.Vision.CameraIntrinsics { Fx = k.Fx * s, Fy = k.Fy * s, Cx = k.Cx * s, Cy = k.Cy * s };
        }

        private static CameraPoseData PoseData(Vector3 p, Quaternion q) => new CameraPoseData
        {
            Px = p.x, Py = p.y, Pz = p.z,
            Qx = q.x, Qy = q.y, Qz = q.z, Qw = q.w,
        };

        private void Encode(PerceptionStill still, Dictionary<string, object> around, int maxWidth, int quality, JsValue callback)
        {
            var color = still.Color;
            int width = color.Width, height = color.Height;
            var rgb = new byte[width * height * 3];
            Buffer.BlockCopy(color.Data, 0, rgb, 0, rgb.Length);
            var k = ScaledIntrinsics(still, width);
            var pose = PoseData(still.CameraPose.position, still.CameraPose.rotation);
            var forward = still.CameraPose.rotation * Vector3.forward;

            PixelRect rect = new PixelRect { X = 0, Y = 0, Width = width, Height = height };
            if (around != null)
            {
                double size = JsBridge.Number(around, "size", 0.5);
                if (!CameraRegionMath.RegionAround(pose, k.Fx, k.Fy, k.Cx, k.Cy, width, height,
                        JsBridge.Number(around, "x", 0), JsBridge.Number(around, "y", 0), JsBridge.Number(around, "z", 0),
                        size, out rect))
                {
                    Reply(callback, Failure("outOfView (that place is not in the camera picture now)"));
                    return;
                }
            }

            var host = ScriptRuntimeHost.Instance;
            Task.Run(() =>
            {
                byte[] pixels;
                int outW, outH;
                string error = null;
                try
                {
                    var cropped = around != null ? CameraRegionMath.CropRgb(rgb, width, height, rect) : rgb;
                    pixels = CameraRegionMath.DownscaleRgb(cropped, rect.Width, rect.Height, maxWidth, out outW, out outH);
                }
                catch (Exception e)
                {
                    pixels = null; outW = outH = 0; error = e.Message;
                }

                host?.Post(() =>
                {
                    if (pixels == null) { Reply(callback, Failure("crop: " + error)); return; }
                    byte[] jpeg;
                    try
                    {
                        // 行は下から上 = Unity のテクスチャと同じ並び。そのまま渡せば正立した JPEG になる
                        jpeg = ImageConversion.EncodeArrayToJPG(pixels, GraphicsFormat.R8G8B8_SRGB, (uint)outW, (uint)outH, 0, quality);
                    }
                    catch (Exception e)
                    {
                        Reply(callback, Failure("jpeg: " + e.Message));
                        return;
                    }
                    var result = new Dictionary<string, object>
                    {
                        ["ok"] = true,
                        ["image"] = Convert.ToBase64String(jpeg),
                        ["mime"] = "image/jpeg",
                        ["width"] = (double)outW,
                        ["height"] = (double)outH,
                        ["pose"] = new Dictionary<string, object>
                        {
                            ["x"] = (double)pose.Px, ["y"] = (double)pose.Py, ["z"] = (double)pose.Pz,
                            ["forward"] = new Dictionary<string, object> { ["x"] = (double)forward.x, ["y"] = (double)forward.y, ["z"] = (double)forward.z },
                        },
                        // 切り出した枠 (元の画に対する割合、左上が 0)
                        ["region"] = new Dictionary<string, object>
                        {
                            ["x"] = (double)rect.X / width,
                            ["y"] = 1.0 - (double)(rect.Y + rect.Height) / height,
                            ["width"] = (double)rect.Width / width,
                            ["height"] = (double)rect.Height / height,
                        },
                        ["error"] = null,
                    };
                    Reply(callback, result);
                });
            });
        }

        private static Dictionary<string, object> Failure(string error) => new Dictionary<string, object>
        {
            ["ok"] = false,
            ["error"] = error,
        };

        private void Reply(JsValue callback, Dictionary<string, object> result)
        {
            if (_js.IsFunction(callback)) _js.Call(callback, "camera.capture callback", result);
            else if (result.TryGetValue("ok", out var ok) && ok is bool b && !b) Debug.LogWarning($"[ArsistJS] camera.capture: {result["error"]}");
        }
    }
}
