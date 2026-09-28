// ==============================================
// Arsist Engine - UI
// アプリの中に出すキーボード
//
// 端末のキーボード (Input 要素 / ArsistTextInput) は OS の入力方式がそのまま使えるが、
// 目の前のパネルから離れた別のオーバーレイが出る。端末によっては出ないこともある。
// こちらはアプリの中に板として出るので、どの端末でも同じように押せる。
// Input 要素で端末のキーボードが使えないときも、ArsistTextEntry がこれをその場で出す。
//
// キーはこのコンポーネントが実行時に作る (ビルド時に 40 個のボタンを IR に並べない)。
// 押す仕組みはボタンと同じ: Image + Button + BoxCollider + ArsistGazeTarget。
// コントローラーのレイも、ハンドトラッキングも、視線も、同じ SendMessage の道を通る。
//
// スクリプトとのやり取りは Input 要素と同じ約束:
//   打った文字      → DataStore の bind.key (UI の Text に bind すればそのまま出る)
//   確定 (⏎)       → イベント "<bindingId>:submit"
// 文字を消したり先に入れたりするのも DataStore 側からできる (書き換えを見て追従する)。
//
// 日本語などの入力方式 (IME) は持たない。かな漢字変換が要るなら Input 要素を使う
// (端末のキーボードが開き、その端末が持っている日本語入力がそのまま使える)。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Scripting;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Arsist.Runtime.UI
{
    [UnityEngine.Scripting.Preserve]
    public class ArsistVirtualKeyboard : MonoBehaviour
    {
        /// <summary>行は "|" 区切り。空ならこの並び。</summary>
        public const string DefaultRows = "1234567890|qwertyuiop|asdfghjkl|zxcvbnm";

        [Tooltip("キーの並び。行は | 区切り。")]
        [SerializeField] private string _rows = DefaultRows;
        [Tooltip("打った文字の書き込み先 (DataStore のキー)。IR の bind.key から入る。")]
        [SerializeField] private string _bindKey;
        [Tooltip("確定したときに鳴らすイベントの元になる名前。IR の bindingId から入る。")]
        [SerializeField] private string _bindingId;
        [Tooltip("確定したら打った文字を消す。")]
        [SerializeField] private bool _clearOnSubmit = true;
        [SerializeField] private Color _keyColor = new Color(1f, 1f, 1f, 0.28f);
        [SerializeField] private Color _accentColor = new Color(0.34f, 0.61f, 0.84f, 0.9f);
        [SerializeField] private Color _textColor = Color.white;
        [SerializeField] private int _fontSize = 36;
        [SerializeField] private float _gap = 6f;

        private readonly List<TextMeshProUGUI> _letterLabels = new List<TextMeshProUGUI>();
        private string _text = "";
        private bool _shift;
        private string _lastSeenInStore;

        /// <summary>いま打ってある文字。</summary>
        public string Text => _text;

        // 文字入力 (ArsistTextEntry) が「端末のキーボードが無い / 出てこない」ときに
        // その場で作って使う口。DataStore を通さず、打った欄に直接返す。
        private System.Action<string> _onChanged;
        private System.Action<string> _onSubmit;
        private System.Action _onCancel;

        /// <summary>その場で作って使うときの設定。作った直後 (Start の前) に呼ぶ。</summary>
        public void Configure(string initial, System.Action<string> onChanged, System.Action<string> onSubmit, System.Action onCancel = null)
        {
            _bindKey = null;
            _bindingId = null;
            _clearOnSubmit = false;
            _text = initial ?? "";
            _onChanged = onChanged;
            _onSubmit = onSubmit;
            _onCancel = onCancel;
        }

        /// <summary>外から文字を入れ直す (物理キーボードで打たれたとき等)。</summary>
        public void SetText(string text)
        {
            _text = text ?? "";
            _lastSeenInStore = _text;
        }

        private bool _built;
        private int _waited;

        private void Start()
        {
            // 先に値が入っていれば拾う (スクリプトが用意した下書きなど)
            if (TryReadStore(out var existing) && !string.IsNullOrEmpty(existing)) _text = existing;
            _lastSeenInStore = _text;
            WriteBack();
        }

        private void Update()
        {
            if (!_built) return;
            // スクリプトが DataStore 側を書き換えたら (消した・入れ直した) それに合わせる。
            // 「まだ入っていない」を「空」と混同すると、打った文字を自分で消してしまう
            // (ArsistTextInput と同じ罠)。
            if (TryReadStore(out var current) && current != _lastSeenInStore && current != _text)
            {
                _text = current ?? "";
                _lastSeenInStore = _text;
            }
        }

        // ---- 組み立て ----

        private void Build()
        {
            var rect = GetComponent<RectTransform>();
            if (rect == null) rect = gameObject.AddComponent<RectTransform>();

            var rows = new List<string>((_rows ?? DefaultRows).Split('|'));
            rows.RemoveAll(string.IsNullOrEmpty);
            if (rows.Count == 0) rows.Add(DefaultRows);

            // 大きさが決まっていなければ、親 → キャンバスの順に借りる。
            // ここで適当な数を使うと、キーが板の外に並んで「出ていない」ように見える。
            float width = rect.rect.width;
            float height = rect.rect.height;
            if (width <= 1f || height <= 1f)
            {
                var parent = rect.parent as RectTransform;
                var canvas = GetComponentInParent<Canvas>();
                var reference = parent != null && parent.rect.width > 1f ? parent
                    : canvas != null ? canvas.transform as RectTransform : null;
                if (reference != null)
                {
                    if (width <= 1f) width = reference.rect.width;
                    if (height <= 1f) height = reference.rect.height * 0.4f;
                }
                if (width <= 1f) width = 1000f;
                if (height <= 1f) height = 400f;
                // 自分の大きさとしても入れておく (背景の板と当たり判定を合わせるため)
                rect.sizeDelta = new Vector2(width, height);
                Debug.LogWarning($"[Arsist] Keyboard had no size of its own; using {width}x{height} from its parent.");
            }

            // 一番下は 記号 / 空白 / 消す / 確定
            int rowCount = rows.Count + 1;
            float rowHeight = (height - _gap * (rowCount + 1)) / rowCount;

            for (int r = 0; r < rows.Count; r++)
            {
                var keys = rows[r];
                float keyWidth = (width - _gap * (keys.Length + 1)) / keys.Length;
                for (int c = 0; c < keys.Length; c++)
                {
                    var label = keys[c].ToString();
                    var key = MakeKey(label, label, rect, _keyColor);
                    Place(key, _gap + c * (keyWidth + _gap), _gap + (rowCount - 1 - r) * (rowHeight + _gap), keyWidth, rowHeight);
                    if (label.Length == 1 && char.IsLetter(label[0])) _letterLabels.Add(key.GetComponentInChildren<TextMeshProUGUI>());
                }
            }

            // 一番下の行: 幅の割合で置く
            // 記号の絵 (⇧ ␣ ⌫ ⏎) は、フォントに無いと □ になる。実際、既定のフォントには
            // ⏎ (U+23CE) が無く、ビルドのログにも出ていた。どのフォントにもある綴りにする。
            var bottom = new (string label, string action, float weight, bool accent)[]
            {
                ("Shift", "shift", 1.6f, false),
                (",", ",", 1f, false),
                ("Space", "space", 4f, false),
                (".", ".", 1f, false),
                ("?", "?", 1f, false),
                ("Del", "back", 1.6f, false),
                ("Enter", "submit", 2f, true),
            };
            if (_onCancel != null)
            {
                // その場で出したキーボードは、閉じる手立てが要る (確定せずに戻れるように)
                var withClose = new (string label, string action, float weight, bool accent)[bottom.Length + 1];
                withClose[0] = ("Close", "cancel", 1.6f, false);
                System.Array.Copy(bottom, 0, withClose, 1, bottom.Length);
                bottom = withClose;
            }

            float totalWeight = 0;
            foreach (var b in bottom) totalWeight += b.weight;
            float usable = width - _gap * (bottom.Length + 1);
            float x = _gap;
            foreach (var b in bottom)
            {
                float w = usable * (b.weight / totalWeight);
                var key = MakeKey(b.label, b.action, rect, b.accent ? _accentColor : _keyColor);
                Place(key, x, _gap, w, rowHeight);
                x += w + _gap;
            }
        }

        private GameObject MakeKey(string label, string action, RectTransform parent, Color color)
        {
            // レイヤーは親に合わせる。`new GameObject()` は親のレイヤーを継がないので、
            // ここを忘れると HUD 用のカメラに描かれず、**押せるのに見えないキー**になる
            // (ArsistUiLayers の説明を参照)。
            var go = ArsistUiLayers.CreateChild("Key " + action, parent);
            go.AddComponent<RectTransform>();

            var image = go.AddComponent<Image>();
            image.color = color;

            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            var captured = action;
            button.onClick.AddListener(() => Press(captured));

            // ボタンと同じ当たり判定 (コントローラーレイ / ハンドトラッキング / 視線)
            var collider = go.AddComponent<BoxCollider>();
            var gaze = go.AddComponent<Arsist.Runtime.Input.ArsistGazeTarget>();
            // 実行時に足したコンポーネントでは UnityEvent が空のことがある。1 つでも落ちると
            // そこでキーの生成が止まり、キーボードごと出てこない。
            if (gaze.onGazeSelect == null) gaze.onGazeSelect = new UnityEngine.Events.UnityEvent();
            gaze.onGazeSelect.AddListener(() => Press(captured));

            var textGO = ArsistUiLayers.CreateChild("Text", go.transform);
            var textRect = textGO.AddComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = Vector2.zero;
            textRect.offsetMax = Vector2.zero;

            var text = textGO.AddComponent<TextMeshProUGUI>();
            // 実行時に作る文字は、フォントを自分で入れる。既定が入っていないビルドでは
            // 何も出ず、キーが真っ黒な板に見える (ビルド時に作る文字も同じ扱いをしている)。
            if (TMP_Settings.defaultFontAsset != null) text.font = TMP_Settings.defaultFontAsset;
            text.text = label;
            text.fontSize = _fontSize;
            text.color = _textColor;
            text.alignment = TextAlignmentOptions.Center;
            text.raycastTarget = false;

            _pendingColliders.Add((go, collider));
            return go;
        }

        private readonly List<(GameObject go, BoxCollider collider)> _pendingColliders = new List<(GameObject, BoxCollider)>();

        private void Place(GameObject key, float left, float bottom, float width, float height)
        {
            var rect = key.GetComponent<RectTransform>();
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.zero;
            rect.pivot = Vector2.zero;
            rect.anchoredPosition = new Vector2(left, bottom);
            rect.sizeDelta = new Vector2(width, height);
        }

        private void LateUpdate()
        {
            // キーを作るのは、レイアウトが走って自分の大きさが決まってから。
            // Start の時点では RectTransform が 0 のことがあり、そこで並べると位置がずれる。
            if (!_built)
            {
                var rect = GetComponent<RectTransform>();
                bool sized = rect != null && rect.rect.width > 1f && rect.rect.height > 1f;
                if (!sized && _waited++ < 10) return; // 10 フレーム待っても決まらなければ、既定の大きさで作る
                Build();
                _built = true;
                // 親 (板) と同じレイヤーにそろえ直す。ここが Default のままだと、
                // HUD を描くカメラの対象から外れてキーが見えない。
                ArsistUiLayers.MatchParent(gameObject, transform.parent);
                Debug.Log($"[Arsist] Keyboard ready: {_pendingColliders.Count} keys, " +
                          $"{GetComponent<RectTransform>().rect.width:F0}x{GetComponent<RectTransform>().rect.height:F0}, " +
                          $"layer={LayerMask.LayerToName(gameObject.layer)}, " +
                          $"font={(TMP_Settings.defaultFontAsset != null ? TMP_Settings.defaultFontAsset.name : "(none)")}");
                return; // 当たり判定は次のフレーム (下) で、実際の大きさに合わせる
            }

            if (_pendingColliders.Count == 0) return;
            foreach (var (go, collider) in _pendingColliders)
            {
                if (go == null || collider == null) continue;
                var rect = go.GetComponent<RectTransform>();
                collider.size = new Vector3(rect.rect.width, rect.rect.height, 1f);
                collider.center = new Vector3(rect.rect.width * (0.5f - rect.pivot.x), rect.rect.height * (0.5f - rect.pivot.y), 0f);
            }
            _pendingColliders.Clear();
        }

        // ---- 押されたとき ----

        public void Press(string action)
        {
            switch (action)
            {
                case "shift":
                    _shift = !_shift;
                    foreach (var label in _letterLabels)
                    {
                        if (label == null) continue;
                        label.text = _shift ? label.text.ToUpperInvariant() : label.text.ToLowerInvariant();
                    }
                    return;

                case "space":
                    _text += " ";
                    break;

                case "back":
                    if (_text.Length > 0) _text = _text.Substring(0, _text.Length - 1);
                    break;

                case "cancel":
                    _onCancel?.Invoke();
                    return;

                case "submit":
                    Submit();
                    return;

                default:
                    if (string.IsNullOrEmpty(action)) return;
                    _text += _shift ? action.ToUpperInvariant() : action;
                    break;
            }
            WriteBack();
        }

        private void Submit()
        {
            WriteBack();
            Debug.Log($"[Arsist] Keyboard submitted: {_text.Length} character(s)" +
                      (string.IsNullOrEmpty(_bindKey) ? "" : $", stored in '{_bindKey}'") +
                      (string.IsNullOrEmpty(_bindingId) ? " (no bindingId, so no event is fired)" : $", firing '{_bindingId}:submit'"));
            if (!string.IsNullOrEmpty(_bindingId)) ArsistScriptEvent.Fire(_bindingId + ":submit", warnIfUnhandled: true);
            _onSubmit?.Invoke(_text);
            if (_clearOnSubmit)
            {
                _text = "";
                WriteBack();
            }
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
            _lastSeenInStore = _text;
            _onChanged?.Invoke(_text);
            if (string.IsNullOrEmpty(_bindKey)) return;
            ArsistDataStore.Instance?.SetValue(_bindKey, _text);
        }
    }
}
