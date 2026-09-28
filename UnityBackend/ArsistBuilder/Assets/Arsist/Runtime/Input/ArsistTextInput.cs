// ==============================================
// Arsist Engine - Input
// 文字を打つ欄 (IR の Input 要素)
//
// 押されたら「文字を打つ」を始める。何で打つかは端末に任せる (ArsistTextEntry):
//   端末に入力方式 (IME) があれば   → その端末のキーボード。日本語も、音声入力も、予測変換もそのまま
//   無ければ                        → アプリの中のキーボードが下から出る
// どちらでも、この欄から見た約束は同じ:
//   打った文字 → DataStore の bind.key (他の UI に bind すればそのまま出る)
//   確定       → イベント "<bindingId>:submit"
// 端末ごとに書き分けないのは、同じプロジェクトが Quest でも XREAL でもスマホでも
// 同じ動きをしなければならないため。
// ==============================================

using System;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Scripting;
using TMPro;
using UnityEngine;

namespace Arsist.Runtime.Input
{
    [UnityEngine.Scripting.Preserve]
    public class ArsistTextInput : MonoBehaviour
    {
        [Tooltip("打った文字を出すところ。ビルド時に入る。")]
        [SerializeField] private TMP_Text _textComponent;
        [Tooltip("何も打っていないときに出す薄い文字。ビルド時に入る。")]
        [SerializeField] private GameObject _placeholder;
        [Tooltip("打った文字の書き込み先 (DataStore のキー)。IR の bind.key から入る。")]
        [SerializeField] private string _bindKey;
        [Tooltip("確定したときに鳴らすイベントの元になる名前。IR の bindingId から入る。")]
        [SerializeField] private string _bindingId;
        [Tooltip("確定したら欄を空にする。")]
        [SerializeField] private bool _clearOnSubmit = true;

        private string _value = "";
        private string _lastSeenInStore;
        private bool _editing;
        private float _caretPhase;

        public string BindKey => _bindKey;
        public string BindingId => _bindingId;
        public bool IsEditing => _editing;

        /// <summary>いま入っている文字。入れ直すと表示も DataStore も追従する。</summary>
        public string Value
        {
            get => _value;
            set
            {
                var text = value ?? "";
                if (_value == text) return;
                _value = text;
                WriteBack();
                Refresh();
            }
        }

        /// <summary>いま入っている文字の長さ (ログ用)。</summary>
        public int Length => _value.Length;

        private void Start()
        {
            // スクリプトが先に下書きを入れていれば拾う
            if (TryReadStore(out var existing) && !string.IsNullOrEmpty(existing)) _value = existing;
            _lastSeenInStore = _value;
            Refresh();
        }

        private void Update()
        {
            // スクリプトが DataStore 側を書き換えたら (送信後に空にした等) それに合わせる。
            //
            // 「まだ入っていない」と「空にされた」を必ず区別する。区別せずに
            // 「読めなければ空」としてしまうと、打った文字を毎フレーム自分で消してしまう
            // (2026-09 に踏んだ: 打っても入力欄に何も出ない)。
            if (TryReadStore(out var current) && current != _lastSeenInStore && current != _value)
            {
                _value = current ?? "";
                _lastSeenInStore = _value;
                Refresh();
            }

            // 打っている間は、末尾の棒を点滅させる (どこに入るか分かるように)
            if (!_editing) return;
            var phase = Mathf.Repeat(Time.unscaledTime * 1.6f, 1f) < 0.5f ? 1f : 0f;
            if (!Mathf.Approximately(phase, _caretPhase))
            {
                _caretPhase = phase;
                Refresh();
            }
        }

        // ---- 押されたとき (視線 / コントローラーレイ / ハンドトラッキングは同じ道を通る) ----

        public void OnGazeDwellSelect(Vector3 hitPoint) => BeginEditing();
        public void OnGazeSelect() => BeginEditing();

        /// <summary>文字を打ち始める。スクリプトからも呼べる。</summary>
        public void BeginEditing()
        {
            // 実機で「押しても何も出ない」ときに、押せていないのか、
            // キーボードが出ないのかを切り分けられるようにする。
            Debug.Log($"[Arsist] Text field '{(!string.IsNullOrEmpty(_bindingId) ? _bindingId : name)}' selected; starting text entry.");
            ArsistTextEntry.Begin(this);
        }

        /// <summary>ArsistTextEntry から呼ばれる。</summary>
        internal void SetEditing(bool editing)
        {
            _editing = editing;
            _caretPhase = editing ? 1f : 0f;
            Refresh();
        }

        /// <summary>確定。イベントを鳴らし、必要なら欄を空にする。</summary>
        public void Submit()
        {
            WriteBack();
            var eventName = string.IsNullOrEmpty(_bindingId) ? null : _bindingId + ":submit";
            Debug.Log($"[Arsist] Text field submitted: {_value.Length} character(s)" +
                      (string.IsNullOrEmpty(_bindKey) ? "" : $", stored in '{_bindKey}'") +
                      (eventName == null
                          ? " (no bindingId, so no event is fired — scripts cannot react to this field)"
                          : $", firing '{eventName}'"));
            if (eventName != null) ArsistScriptEvent.Fire(eventName, warnIfUnhandled: true);
            if (_clearOnSubmit)
            {
                _value = "";
                WriteBack();
            }
            Refresh();
        }

        // ---- 見た目 ----

        private void Refresh()
        {
            if (_textComponent != null)
            {
                var caret = _editing && _caretPhase > 0.5f ? "|" : "";
                _textComponent.text = _value + caret;
            }
            if (_placeholder != null) _placeholder.SetActive(!_editing && string.IsNullOrEmpty(_value));
        }

        /// <summary>DataStore に値が入っていれば true。入っていなければ false (「空」ではない)。</summary>
        private bool TryReadStore(out string text)
        {
            text = null;
            if (string.IsNullOrEmpty(_bindKey)) return false;
            var store = ArsistDataStore.Instance;
            if (store == null) return false;
            if (!store.TryGetValueByPath(_bindKey, out var value)) return false;
            text = Convert.ToString(value) ?? "";
            return true;
        }

        private void WriteBack()
        {
            _lastSeenInStore = _value;
            if (string.IsNullOrEmpty(_bindKey)) return;
            ArsistDataStore.Instance?.SetValue(_bindKey, _value);
        }
    }
}
