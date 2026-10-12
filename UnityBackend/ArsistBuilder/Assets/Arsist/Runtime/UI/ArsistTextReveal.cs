// ==============================================
// Arsist Engine - 文字を「書いていくように」出す
// Assets/Arsist/Runtime/UI/ArsistTextReveal.cs
//
// UI の要素の reveal { speed } (IR v5) が付いた Text / Button の文字に、ビルドが付ける。
// 文字が変わるたびに先頭から 1 秒に speed 文字ずつ現れる。
//   - 文字の差し替えは ui.setText でも、store の bind でも、何でもよい (毎フレーム text を見比べる)
//   - 前の文字の続きに書き足された (LLM の返事を 1 語ずつ足していく等) ときは、書いたところから続ける
//   - 色付けなどのタグは数えない (TMP の maxVisibleCharacters は見える文字だけを数える)
// ==============================================
using TMPro;
using UnityEngine;

namespace Arsist.Runtime.UI
{
    [DisallowMultipleComponent]
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistTextReveal : MonoBehaviour
    {
        /// <summary>1 秒に出す文字数 (ビルドが IR の reveal.speed から入れる)</summary>
        public float charactersPerSecond = 12f;

        private const int All = 99999;

        private TMP_Text _text;
        private string _last;
        private float _shown;

        private void Awake()
        {
            _text = GetComponent<TMP_Text>();
            if (_text == null) _text = GetComponentInChildren<TMP_Text>(true);
        }

        private void OnEnable()
        {
            // 出し直されたら、その時点の文字を最初から書く
            _last = null;
            _shown = 0f;
            if (_text != null) _text.maxVisibleCharacters = 0;
        }

        private void LateUpdate()
        {
            if (_text == null) return;
            var current = _text.text ?? string.Empty;
            if (!string.Equals(current, _last, System.StringComparison.Ordinal))
            {
                // 書き足しなら続きから、別の文なら最初から
                bool appended = _last != null && _last.Length > 0 && current.StartsWith(_last, System.StringComparison.Ordinal);
                if (!appended) _shown = 0f;
                _last = current;
            }

            var total = VisibleLength();
            if (_shown >= total)
            {
                if (_text.maxVisibleCharacters != All) _text.maxVisibleCharacters = All;
                return;
            }
            _shown += Mathf.Max(0.1f, charactersPerSecond) * Time.deltaTime;
            _text.maxVisibleCharacters = _shown >= total ? All : Mathf.FloorToInt(_shown);
        }

        /// <summary>見える文字の数 (タグを除く)。まだ組まれていなければ文字列の長さで見積もる。</summary>
        private int VisibleLength()
        {
            var info = _text.textInfo;
            if (info != null && info.characterCount > 0) return info.characterCount;
            return _last?.Length ?? 0;
        }
    }
}
