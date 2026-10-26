// ==============================================
// Arsist Engine - スクリプトの cameras (シーンに置いた仮想カメラ)
// Assets/Arsist/Runtime/Scripting/CamerasWrapper.cs
//
//   cameras.list()                                → ["Cam", …]  (IR の物の id)
//   cameras.setPose(id, x, y, z, rx, ry, rz)      位置と向き (度)
//   cameras.getPose(id)                           → { x, y, z, rx, ry, rz, fov } | null
//   cameras.lookAt(id, x, y, z)                   そちらを向く
//   cameras.setFov(id, deg)                       縦の画角
//   cameras.snapshot(id, fn)                      今の画を JPEG で fn({ ok, mime, width, height, data (base64), error })
//
// 座標は scene.setPosition と同じ実行時の Unity ワールド (x = 右、メートル)。id は IR の物の id でも assetId でもよい。
// カメラ本体は Runtime/Media (ArsistVirtualCamera / ArsistCameras)。doc/23-cameras-media.md。
// (頭のカメラの画は別の `camera` (CameraWrapper))
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Media;
using Jint.Native;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;

namespace Arsist.Runtime.Scripting
{
    [UnityEngine.Scripting.Preserve]
    public sealed class CamerasWrapper
    {
        private const float SnapshotTimeoutSeconds = 5f;
        private readonly JsBridge _js;
        // 読み出しの行順を測るためだけに使う (RenderTexture の行の向きはグラフィックス API で違う。GpuFrameReader)
        private static Perception.Sources.GpuFrameReader _probe;

        public CamerasWrapper(JsBridge js)
        {
            _js = js;
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue list()
        {
            var ids = new List<object>();
            foreach (var id in ArsistCameras.Instance.Ids) ids.Add(id);
            return _js.ToJs(ids);
        }

        [UnityEngine.Scripting.Preserve]
        public void setPose(string id, double x, double y, double z, double rx = 0, double ry = 0, double rz = 0)
        {
            var cam = Find(id, "setPose");
            if (cam == null) return;
            cam.transform.SetPositionAndRotation(new Vector3((float)x, (float)y, (float)z), Quaternion.Euler((float)rx, (float)ry, (float)rz));
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue getPose(string id)
        {
            var cam = ArsistCameras.Instance.Find(id);
            if (cam == null) return JsValue.Null;
            var p = cam.transform.position;
            var e = cam.transform.eulerAngles;
            return _js.ToJs(new Dictionary<string, object>
            {
                ["x"] = (double)p.x, ["y"] = (double)p.y, ["z"] = (double)p.z,
                ["rx"] = (double)Mathf.DeltaAngle(0f, e.x), ["ry"] = (double)Mathf.DeltaAngle(0f, e.y), ["rz"] = (double)Mathf.DeltaAngle(0f, e.z),
                ["fov"] = (double)(cam.Camera != null ? cam.Camera.fieldOfView : cam.fov),
            });
        }

        [UnityEngine.Scripting.Preserve]
        public void lookAt(string id, double x, double y, double z)
        {
            var cam = Find(id, "lookAt");
            if (cam == null) return;
            var target = new Vector3((float)x, (float)y, (float)z);
            if ((target - cam.transform.position).sqrMagnitude < 1e-8f) return;
            cam.transform.LookAt(target, Vector3.up);
        }

        [UnityEngine.Scripting.Preserve]
        public void setFov(string id, double degrees)
        {
            var cam = Find(id, "setFov");
            if (cam != null) cam.SetFov((float)degrees);
        }

        [UnityEngine.Scripting.Preserve]
        public void snapshot(string id, JsValue callback = null)
        {
            var cam = ArsistCameras.Instance.Find(id);
            var host = ScriptRuntimeHost.Instance;
            if (cam == null || cam.Texture == null) { Reply(callback, Failure($"noCamera:{id}")); return; }
            if (host == null) { Reply(callback, Failure("notReady")); return; }

            if (_probe == null) _probe = new Perception.Sources.GpuFrameReader();
            _probe.EnsureProbe();

            // 次に撮れたとき (使う人がいなければ 1 枚だけ撮らせる) の画を読む
            bool settled = false;
            float deadline = Time.unscaledTime + SnapshotTimeoutSeconds;
            Action<string, RenderTexture> onRendered = null;
            void Done(Dictionary<string, object> result)
            {
                if (settled) return;
                settled = true;
                ArsistCameras.Instance.Rendered -= onRendered;
                Reply(callback, result);
            }
            onRendered = (renderedId, rt) =>
            {
                if (settled || ArsistCameras.Instance.Find(renderedId) != cam) return;
                ArsistCameras.Instance.Rendered -= onRendered;
                Read(rt, Done);
            };
            ArsistCameras.Instance.Rendered += onRendered;
            cam.RenderOnce();
            host.AddTicker(() =>
            {
                if (settled) return false;
                if (Time.unscaledTime < deadline) return true;
                Done(Failure("timeout"));
                return false;
            });
        }

        private static void Read(RenderTexture rt, Action<Dictionary<string, object>> done)
        {
            int w = rt.width, h = rt.height;
            if (SystemInfo.supportsAsyncGPUReadback)
            {
                AsyncGPUReadback.Request(rt, 0, TextureFormat.RGBA32, req =>
                {
                    if (req.hasError) { done(Failure("readback")); return; }
                    var data = req.GetData<byte>().ToArray();
                    done(Encode(data, w, h, _probe != null && _probe.RowsTopDown == true));
                });
                return;
            }
            try
            {
                var tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
                var previous = RenderTexture.active;
                RenderTexture.active = rt;
                tex.ReadPixels(new Rect(0, 0, w, h), 0, 0, false);
                RenderTexture.active = previous;
                var data = tex.GetRawTextureData();
                UnityEngine.Object.Destroy(tex);
                done(Encode(data, w, h, false)); // ReadPixels は下から上
            }
            catch (Exception e)
            {
                done(Failure("readback: " + e.Message));
            }
        }

        private static Dictionary<string, object> Encode(byte[] rgba, int w, int h, bool rowsTopDown)
        {
            try
            {
                if (rowsTopDown) FlipRows(rgba, w * 4, h);
                // RenderTexture は sRGB で持っているので、読んだバイトはそのまま画面の色
                var jpeg = ImageConversion.EncodeArrayToJPG(rgba, GraphicsFormat.R8G8B8A8_SRGB, (uint)w, (uint)h, 0, 90);
                return new Dictionary<string, object>
                {
                    ["ok"] = true,
                    ["mime"] = "image/jpeg",
                    ["width"] = (double)w,
                    ["height"] = (double)h,
                    ["data"] = Convert.ToBase64String(jpeg),
                    ["error"] = null,
                };
            }
            catch (Exception e)
            {
                return Failure("jpeg: " + e.Message);
            }
        }

        private static void FlipRows(byte[] data, int stride, int rows)
        {
            var tmp = new byte[stride];
            for (int top = 0, bottom = rows - 1; top < bottom; top++, bottom--)
            {
                Buffer.BlockCopy(data, top * stride, tmp, 0, stride);
                Buffer.BlockCopy(data, bottom * stride, data, top * stride, stride);
                Buffer.BlockCopy(tmp, 0, data, bottom * stride, stride);
            }
        }

        private static ArsistVirtualCamera Find(string id, string op)
        {
            var cam = ArsistCameras.Instance.Find(id);
            if (cam == null) Debug.LogWarning($"[ArsistJS] cameras.{op}: no camera '{id}' (have: {string.Join(", ", ArsistCameras.Instance.Ids)})");
            return cam;
        }

        private static Dictionary<string, object> Failure(string error) => new Dictionary<string, object>
        {
            ["ok"] = false,
            ["error"] = error,
        };

        private void Reply(JsValue callback, Dictionary<string, object> result)
        {
            if (_js.IsFunction(callback)) _js.Call(callback, "cameras.snapshot callback", result);
            else if (result.TryGetValue("ok", out var ok) && ok is bool b && !b) Debug.LogWarning($"[ArsistJS] cameras.snapshot: {result["error"]}");
        }
    }
}
