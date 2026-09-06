// ==============================================
// Arsist Engine - System Keyboard Bridge (Input UI element)
// Assets/Arsist/Runtime/Input/ArsistSystemKeyboardTarget.cs
// ==============================================
using TMPro;
using UnityEngine;

namespace Arsist.Runtime.Input
{
    /// <summary>
    /// Input UI要素をピンチ/トリガー/視線で選択すると、OS の
    /// 「システムキーボード オーバーレイ」(<see cref="TouchScreenKeyboard"/>) を呼び出す。
    ///
    /// 自前の仮想キーボードを作らない理由: OSが提供する入力方式（音声入力・予測変換・他言語も
    /// 全部含む）をそのまま使えるほうが、固定レイアウトの自作キーボードより実用性が高い。
    /// products/QuestAIChat（Unityを使わない別実装、自作ハンドトラッキングキーボード）とは
    /// 対照的な設計判断 — こちらは Arsist 本体で作る場合の選択。
    ///
    /// Quest での前提（実機確認は取れていない。参照: Meta公式ドキュメント
    /// "Enable Keyboard Overlay" https://developers.meta.com/horizon/documentation/unity/unity-keyboard-overlay/）:
    ///   - AndroidManifest.xml に uses-feature "oculus.software.overlay_keyboard" が必要
    ///     （Input要素がある場合、QuestBuildPatcher.ConfigureSystemKeyboard が自動で追加する）
    ///   - OVRManager の「Require System Keyboard」設定。com.meta.xr.sdk.core が入っていれば
    ///     TouchScreenKeyboard.Open() だけで動く想定（Meta公式サンプルコードもこれだけで完結している）
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class ArsistSystemKeyboardTarget : MonoBehaviour
    {
        [Tooltip("表示・編集するテキストコンポーネント。ビルド時に自動設定される。")]
        [SerializeField] private TMP_Text _textComponent;
        [Tooltip("値の書き戻し先キー。IR の bind.key から ArsistBuildPipeline が設定する。空なら書き戻さない。")]
        [SerializeField] private string _bindKey;

        private TouchScreenKeyboard _keyboard;
        private string _lastText = "";

        /// <summary>ArsistGazeInput / XROriginSetup / ArsistHandInteraction から SendMessage で呼ばれる。</summary>
        public void OnGazeDwellSelect(Vector3 hitPoint)
        {
            OpenKeyboard();
        }

        public void OpenKeyboard()
        {
            var initial = _textComponent != null ? _textComponent.text : "";
            _keyboard = TouchScreenKeyboard.Open(initial, TouchScreenKeyboardType.Default);
        }

        private void Update()
        {
            if (_keyboard == null) return;

            var text = _keyboard.text;
            if (text != _lastText)
            {
                _lastText = text;
                if (_textComponent != null) _textComponent.text = text;
                WriteBack(text);
            }

            switch (_keyboard.status)
            {
                case TouchScreenKeyboard.Status.Done:
                    FinishEditing(submitted: true);
                    break;
                case TouchScreenKeyboard.Status.Canceled:
                case TouchScreenKeyboard.Status.LostFocus:
                    FinishEditing(submitted: false);
                    break;
                // Visible: 入力継続中。何もしない。
            }
        }

        private void FinishEditing(bool submitted)
        {
            _keyboard = null;

            if (!submitted) return;

            // bindingId ベースのイベントで「確定した」ことをスクリプトに伝える。
            // 例: bindingId="chatInput" なら "chatInput:submit" を Fire する。
            // これで「Inputに書いて確定したら送信」のような流れをスクリプト側だけで組める。
            var binding = GetComponent<Arsist.Runtime.Scripting.UiBindingRegistry>();
            var bindingId = binding != null ? binding.bindingId : null;
            if (!string.IsNullOrEmpty(bindingId))
            {
                Arsist.Runtime.Scripting.ArsistScriptEvent.Fire(bindingId + ":submit");
            }
        }

        private void WriteBack(string text)
        {
            if (string.IsNullOrEmpty(_bindKey)) return;
            Arsist.Runtime.DataFlow.ArsistDataStore.Instance?.SetValue(_bindKey, text);
        }
    }
}
