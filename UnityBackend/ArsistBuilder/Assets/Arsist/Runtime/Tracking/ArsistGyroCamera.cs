// ==============================================
// Arsist Engine - Tracking
// スマホを振ると、カメラが同じように向きを変える
//
// ヘッドセットの頭の向きの代わりに、スマホの姿勢を使う。これで同じシーンが
// Quest でも XREAL でもスマホでも「見回せる」ようになる。
// 位置は追わない (3DoF)。スマホのジャイロだけでは歩いた距離は測れないため。
//
// 回転の式は GyroMath にあり、tools/perception-check で数値検証してある。
// ここでは Unity の値を詰め替えるだけにして、式をこちらに書かないこと。
// ==============================================

using UnityEngine;

// 注意: この名前空間の中で素の `Input` と書くと、using UnityEngine より先に
// 兄弟の名前空間 Arsist.Runtime.Input が見つかってコンパイルが通らない。
// 旧 Input は必ず UnityEngine.Input と書くこと。

namespace Arsist.Runtime.Tracking
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistGyroCamera : MonoBehaviour
    {
        public static ArsistGyroCamera Instance { get; private set; }

        /// <summary>
        /// 手ぶれを抑える度合い (0..1)。大きいほど滑らかだが、首振りに遅れる。
        /// 0.35 は「持っていて落ち着く」と「振って遅れを感じない」の間。
        /// </summary>
        [Range(0.05f, 1f)] public float Smoothing = 0.35f;

        /// <summary>ジャイロが無い端末 (エミュレータ等) では、画面をなぞって見回す。</summary>
        public float DragDegreesPerPixel = 0.2f;

        private Quat _recenter = Quat.Identity;
        private bool _recenterPending = true;
        private bool _gyroAvailable;
        private float _dragYaw, _dragPitch;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(this);
                return;
            }
            Instance = this;
        }

        private void Start()
        {
            try
            {
                _gyroAvailable = SystemInfo.supportsGyroscope;
                if (_gyroAvailable)
                {
                    UnityEngine.Input.gyro.enabled = true;
                    // 既定の更新間隔は端末任せで、遅い端末では首振りに遅れる。
                    // 描画 (60fps) より速く読めていれば十分なので 100Hz を頼む。
                    UnityEngine.Input.gyro.updateInterval = 0.01f;
                    Debug.Log($"[Arsist] Gyro on: updateInterval={UnityEngine.Input.gyro.updateInterval:F3}s");
                }
            }
            catch (System.InvalidOperationException)
            {
                // Player 設定が「Input System のみ」だと旧 Input は例外を投げる。
                // 落ちるより、なぞって見回せる方がまし。
                _gyroAvailable = false;
                Debug.LogWarning("[Arsist] Legacy Input is disabled; gyro look falls back to touch drag.");
            }

            if (!_gyroAvailable)
            {
                Debug.Log("[Arsist] No gyroscope; look around by dragging on the screen.");
            }
        }

        /// <summary>今向いている方向を正面にする。スクリプトからも呼べる (viewer.recenter)。</summary>
        public void Recenter() => _recenterPending = true;

        private void LateUpdate()
        {
            if (_gyroAvailable) ApplyGyro();
            else ApplyDrag();
        }

        private void ApplyGyro()
        {
            var raw = UnityEngine.Input.gyro.attitude;
            // 起動直後はまだ単位回転しか来ていないことがある。そこで正面合わせをすると
            // 「真下」を正面にしてしまうので、値が入るまで待つ。
            if (raw == Quaternion.identity) return;

            var camera = GyroMath.DeviceToCamera(
                new Quat(raw.x, raw.y, raw.z, raw.w), CurrentOrientation());

            if (_recenterPending)
            {
                _recenter = GyroMath.RecenterFor(camera);
                _recenterPending = false;
            }

            var target = _recenter * camera;
            var rotation = new Quaternion((float)target.X, (float)target.Y, (float)target.Z, (float)target.W);

            // 急に向きが飛んだ (正面合わせ直後など) ときは補間せずに合わせる。
            // 補間すると、ぐるっと回る様子が見えて酔う。
            float angle = Quaternion.Angle(transform.localRotation, rotation);
            transform.localRotation = angle > 45f
                ? rotation
                : Quaternion.Slerp(transform.localRotation, rotation, 1f - Mathf.Pow(1f - Smoothing, Time.deltaTime * 60f));
        }

        private void ApplyDrag()
        {
            if (UnityEngine.Input.touchCount == 1)
            {
                var delta = UnityEngine.Input.GetTouch(0).deltaPosition;
                _dragYaw += delta.x * DragDegreesPerPixel;
                _dragPitch = Mathf.Clamp(_dragPitch - delta.y * DragDegreesPerPixel, -85f, 85f);
            }
            else if (UnityEngine.Input.GetMouseButton(0))
            {
                _dragYaw += UnityEngine.Input.GetAxis("Mouse X") * 3f;
                _dragPitch = Mathf.Clamp(_dragPitch - UnityEngine.Input.GetAxis("Mouse Y") * 3f, -85f, 85f);
            }
            transform.localRotation = Quaternion.Euler(_dragPitch, _dragYaw, 0f);
        }

        private static GyroScreenOrientation CurrentOrientation()
        {
            switch (Screen.orientation)
            {
                case ScreenOrientation.LandscapeLeft: return GyroScreenOrientation.LandscapeLeft;
                case ScreenOrientation.LandscapeRight: return GyroScreenOrientation.LandscapeRight;
                case ScreenOrientation.PortraitUpsideDown: return GyroScreenOrientation.PortraitUpsideDown;
                default: return GyroScreenOrientation.Portrait;
            }
        }

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }
    }
}
