// ==============================================
// Arsist Engine - Layster.Spatial: Mind に添えるカメラの静止画
// Assets/Arsist/Runtime/Spatial/SpatialCamera.cs
//
// カメラの画は ArsistPerceptionManager (camera.capture と同じ係) から取る。係がいないビルド
// (カメラを使う指定が無い) では null を返し、Mind は画無しで呼ばれる。
// 縮めるのは別のスレッド、JPEG にするのはメインスレッド (ImageConversion はメインスレッドだけ)。
// ==============================================

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Arsist.Runtime.Perception;
using Arsist.Runtime.Scripting;
using UnityEngine;
using UnityEngine.Experimental.Rendering;

namespace Arsist.Runtime.Spatial
{
    public static class SpatialCamera
    {
        public static bool Available => ArsistPerceptionManager.Instance != null;

        /// <summary>done は必ず 1 回、メインスレッドで呼ばれる (撮れなければ null)。</summary>
        public static void Capture(int maxWidth, int quality, Action<Dictionary<string, object>> done)
        {
            var manager = ArsistPerceptionManager.Instance;
            var runtime = ArsistSpatialRuntime.Instance;
            if (manager == null || runtime == null) { done?.Invoke(null); return; }
            manager.RequestStill(still =>
            {
                if (!still.Valid || still.Color == null) { done?.Invoke(null); return; }
                var color = still.Color;
                int width = color.Width, height = color.Height;
                var rgb = new byte[width * height * 3];
                Buffer.BlockCopy(color.Data, 0, rgb, 0, rgb.Length);
                var camPos = still.CameraPose.position;
                var camFwd = still.CameraPose.rotation * Vector3.forward;
                // 縦の画角 (主点が真ん中にある前提で 2·atan(cy / fy))
                double fov = still.Intrinsics.Fy > 0 ? 2 * Math.Atan(still.Intrinsics.Cy / still.Intrinsics.Fy) * 180 / Math.PI : 0;
                Task.Run(() =>
                {
                    byte[] pixels = null;
                    int w = 0, h = 0;
                    try { pixels = CameraRegionMath.DownscaleRgb(rgb, width, height, Math.Max(16, maxWidth), out w, out h); }
                    catch (Exception e) { Debug.LogWarning($"[Layster] camera downscale failed: {e.Message}"); }
                    runtime.Post(() =>
                    {
                        if (pixels == null) { done?.Invoke(null); return; }
                        try
                        {
                            var jpeg = ImageConversion.EncodeArrayToJPG(pixels, GraphicsFormat.R8G8B8_SRGB, (uint)w, (uint)h, 0, Mathf.Clamp(quality, 1, 100));
                            var frames = runtime.Frames;
                            var result = new Dictionary<string, object>
                            {
                                ["mime"] = "image/jpeg",
                                ["width"] = (double)w,
                                ["height"] = (double)h,
                                ["data"] = Convert.ToBase64String(jpeg),
                                ["pose"] = new Dictionary<string, object>
                                {
                                    ["at"] = frames.FromUnity(camPos).ToPlainRounded(),
                                    ["forward"] = frames.DirectionFromUnity(camFwd).ToPlainRounded(),
                                },
                            };
                            if (fov > 0) result["fov"] = Math.Round(fov, 1);
                            done?.Invoke(result);
                        }
                        catch (Exception e)
                        {
                            Debug.LogWarning($"[Layster] camera jpeg failed: {e.Message}");
                            done?.Invoke(null);
                        }
                    });
                });
            }, wantColor: true, maxWidth: maxWidth);
        }
    }
}
