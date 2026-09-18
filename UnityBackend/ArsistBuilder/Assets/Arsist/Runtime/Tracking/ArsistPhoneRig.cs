// ==============================================
// Arsist Engine - Tracking
// スマホ用のカメラ一式の設定を、起動時に配る
//
// ビルド時の設定 (arSettings.phone) はここにシリアライズされて入り、
// Awake で静的な置き場 (PhoneCameraSettings) と画面の向きに反映される。
// 背景・画像処理・Unity カメラが同じ画角を見るのは、この一か所から配っているため。
// ==============================================

using UnityEngine;

namespace Arsist.Runtime.Tracking
{
    [UnityEngine.Scripting.Preserve]
    [DefaultExecutionOrder(-1000)]   // 背景や画像処理より先に画角を配る
    public sealed class ArsistPhoneRig : MonoBehaviour
    {
        /// <summary>実測の fps をログに出す間隔 (秒)。npm run logs で adb 無しに読める。</summary>
        private const float ReportInterval = 5f;

        private int _frames;
        private float _windowStart;
        private float _worstFrame;
        [SerializeField] public float CameraFovDegrees = 63f;
        [SerializeField] public bool Landscape = true;

        private void Awake()
        {
            PhoneCameraSettings.HorizontalFovDegrees = Mathf.Clamp(CameraFovDegrees, 20f, 140f);

            // 起動中に縦横が勝手に切り替わると、ジャイロの補正と背景の向きが一瞬ずれる。
            // 向きは固定する。
            Screen.orientation = Landscape ? ScreenOrientation.LandscapeLeft : ScreenOrientation.Portrait;
            Screen.sleepTimeout = SleepTimeout.NeverSleep;   // 見回している間に画面が消えないように

            // Android の既定は 30fps 固定 (Unity 公式リファレンス)。ヘッドセット用のリグ
            // (XROriginSetup) は 60 を指定しているが、スマホ用のリグには無く、30fps で動いていた。
            // vSyncCount が 0 でないと targetFrameRate は無視されるので、両方設定する。
            double refresh = Screen.currentResolution.refreshRateRatio.value;
            int fps = FramePacing.TargetFor(refresh);
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = fps;

            Debug.Log($"[Arsist] Phone rig: fov={PhoneCameraSettings.HorizontalFovDegrees:F1} " +
                      $"orientation={(Landscape ? "landscape" : "portrait")} " +
                      $"display={refresh:F1}Hz targetFps={fps}");
        }

        private void Update()
        {
            _frames++;
            _worstFrame = Mathf.Max(_worstFrame, Time.unscaledDeltaTime);

            float elapsed = Time.unscaledTime - _windowStart;
            if (elapsed < ReportInterval) return;

            // 平均だけだと「2 秒に 1 回止まる」が見えないので、一番長かったフレームも出す。
            Debug.Log($"[Arsist] Phone fps: {_frames / elapsed:F1} avg, worst frame {_worstFrame * 1000f:F0} ms");
            _frames = 0;
            _worstFrame = 0f;
            _windowStart = Time.unscaledTime;
        }
    }
}
