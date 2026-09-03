// ==============================================
// Arsist Engine - Slider UI Interaction Target
// Assets/Arsist/Runtime/Input/ArsistSliderTarget.cs
// ==============================================
using UnityEngine;
using UnityEngine.UI;

namespace Arsist.Runtime.Input
{
    /// <summary>
    /// UIの Slider 要素（トラック＋フィル画像のバー）を、コントローラーレイ/ハンドトラッキングで
    /// 掴んで動かすためのターゲット。
    ///
    /// このエンジンの指し示し判定は UGUI 標準の EventSystem / GraphicRaycaster ではなく
    /// Physics.Raycast + SendMessage（ArsistGazeTarget と同じ経路）なので、UGUI 標準の Slider が
    /// 内蔵するドラッグハンドル機構とは噛み合わない。そのため Slider 用に単純な「トラックの矩形に
    /// 対する指し先のローカルX位置」でドラッグを実装する。
    ///
    /// XROriginSetup（コントローラーレイ）/ ArsistHandInteraction（ハンドトラッキング）が、
    /// トリガー/ピンチを押し続けている間、毎フレーム SendMessage("OnGazeDrag", ワールド座標のヒット点)
    /// を送ってくる。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class ArsistSliderTarget : MonoBehaviour
    {
        [Tooltip("値0..1をローカルX位置から計算する基準（バー全体のRectTransform）。ビルド時に自動設定される。")]
        [SerializeField] private RectTransform _trackRect;
        [Tooltip("フィル表示のImage（Type=Filled, FillMethod=Horizontal）。ビルド時に自動設定される。")]
        [SerializeField] private Image _fillImage;
        [Tooltip("値の書き戻し先キー。IR の bind.key から ArsistBuildPipeline が設定する。空なら書き戻さない。")]
        [SerializeField] private string _bindKey;

        /// <summary>現在の値 (0..1)。</summary>
        public float Value { get; private set; }

        private void Awake()
        {
            if (_fillImage != null) Value = Mathf.Clamp01(_fillImage.fillAmount);
        }

        /// <summary>コントローラーレイ/ハンドトラッキングから、押し続けている間毎フレーム呼ばれる。</summary>
        public void OnGazeDrag(Vector3 worldHitPoint)
        {
            if (_trackRect == null) return;

            var local = _trackRect.InverseTransformPoint(worldHitPoint);
            var rect = _trackRect.rect;
            if (rect.width <= 0f) return;

            SetValue(Mathf.InverseLerp(rect.xMin, rect.xMax, local.x));
        }

        public void SetValue(float value01)
        {
            value01 = Mathf.Clamp01(value01);
            if (Mathf.Approximately(value01, Value)) return;

            Value = value01;
            if (_fillImage != null) _fillImage.fillAmount = value01;

            if (!string.IsNullOrEmpty(_bindKey))
            {
                Arsist.Runtime.DataFlow.ArsistDataStore.Instance?.SetValue(_bindKey, value01 * 100f);
            }
        }
    }
}
