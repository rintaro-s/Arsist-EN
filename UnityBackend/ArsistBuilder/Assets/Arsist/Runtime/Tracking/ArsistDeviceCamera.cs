// ==============================================
// Arsist Engine - Tracking
// スマホの背面カメラをひとつだけ開いて、みんなで使う
//
// Android は同じカメラを同時に一度しか開けない。背景表示と画像認識がそれぞれ
// WebCamTexture を作ると、後から開いた方が黙って真っ黒になる。
// なのでカメラはここで一度だけ開き、使う側は Texture を借りるだけにする。
// ==============================================

using UnityEngine;

namespace Arsist.Runtime.Tracking
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistDeviceCamera : MonoBehaviour
    {
        public static ArsistDeviceCamera Instance { get; private set; }

        /// <summary>要求する解像度。端末が持っていなければ近いものが選ばれる。</summary>
        public int RequestWidth = 1280;
        public int RequestHeight = 720;
        public int RequestFps = 30;

        public WebCamTexture Texture { get; private set; }

        /// <summary>映像が実際に流れ始めたか。開いた直後はしばらく 16x16 のままのことがある。</summary>
        public bool IsStreaming => Texture != null && Texture.isPlaying && Texture.width > 16;

        private bool _permissionRequested;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
        }

        private void Update()
        {
            if (Texture != null) return;

#if UNITY_ANDROID && !UNITY_EDITOR
            // 権限が無いまま開くと、例外も出さずに真っ黒な映像が来る。
            if (!UnityEngine.Android.Permission.HasUserAuthorizedPermission(UnityEngine.Android.Permission.Camera))
            {
                if (!_permissionRequested)
                {
                    _permissionRequested = true;
                    UnityEngine.Android.Permission.RequestUserPermission(UnityEngine.Android.Permission.Camera);
                }
                return;
            }
#endif
            Open();
        }

        private void Open()
        {
            var devices = WebCamTexture.devices;
            if (devices == null || devices.Length == 0)
            {
                Debug.LogWarning("[Arsist] No camera on this device; AR background and image tasks will be idle.");
                enabled = false;
                return;
            }

            // 背面カメラを優先する。前面カメラで AR をすると、景色が鏡写しになる。
            string name = devices[0].name;
            foreach (var device in devices)
            {
                if (!device.isFrontFacing) { name = device.name; break; }
            }

            Texture = new WebCamTexture(name, RequestWidth, RequestHeight, RequestFps);
            Texture.Play();
            Debug.Log($"[Arsist] Device camera opened: {name}");
        }

        private void OnApplicationPause(bool paused)
        {
            // バックグラウンドで開きっぱなしにすると、他のアプリがカメラを使えなくなる。
            if (Texture == null) return;
            if (paused) Texture.Pause();
            else Texture.Play();
        }

        private void OnDestroy()
        {
            if (Texture != null)
            {
                Texture.Stop();
                Destroy(Texture);
                Texture = null;
            }
            if (Instance == this) Instance = null;
        }
    }
}
