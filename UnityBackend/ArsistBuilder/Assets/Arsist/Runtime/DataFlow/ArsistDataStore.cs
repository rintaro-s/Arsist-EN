using System;
using System.Collections.Generic;

namespace Arsist.Runtime.DataFlow
{
    public class ArsistDataStore
    {
        public static ArsistDataStore Instance { get; } = new ArsistDataStore();

        private readonly Dictionary<string, object> _values = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

        public event Action<string, object> OnValueChanged;

        public void SetValue(string key, object value)
        {
            if (string.IsNullOrWhiteSpace(key)) return;
            _values[key] = value;
            OnValueChanged?.Invoke(key, value);
        }

        public object GetValue(string key)
        {
            if (string.IsNullOrWhiteSpace(key)) return null;
            _values.TryGetValue(key, out var value);
            return value;
        }

        public bool TryGetValue<T>(string key, out T value)
        {
            value = default;
            if (string.IsNullOrWhiteSpace(key)) return false;
            if (!_values.TryGetValue(key, out var raw)) return false;
            if (raw is T typed)
            {
                value = typed;
                return true;
            }
            return false;
        }

        /// <summary>
        /// ドット区切りで入れ子の値をたどる。
        /// 認識タスクが辞書ひとつを書けば <storeAs>.text / .status がそのまま bind できるのは、これのおかげ。
        ///
        /// 配列も添字でたどれる。書き方は "items[0].x" でも "items.0.x" でもよい
        /// （色の塊や形は件数が可変なので、先頭だけ出したいことが多い）。
        /// </summary>
        public bool TryGetValueByPath(string path, out object value)
        {
            value = null;
            if (string.IsNullOrWhiteSpace(path)) return false;

            // まず「そのままの名前」で引く。
            // SetValue("chat.input", ...) は "chat.input" という 1 つの名前で入れるので、
            // ドットを入れ子とみなして辿ると**必ず外れる**。読み書きで食い違うと、
            // 「打った文字が消える」「スクリプトが値を受け取れない」という形で出る
            // (2026-09 に踏んだ: キーボードで打っても入力欄に出ず、確定しても応答が無い)。
            if (_values.TryGetValue(path, out value)) return true;

            // 入れ子 (認識タスクが辞書ごと書いたもの) を辿る。
            // "items[0]" を "items.0" に均してから分解する。
            value = null;
            var parts = path.Replace("[", ".").Replace("]", string.Empty).Split('.');
            object current = _values;
            for (var i = 0; i < parts.Length; i++)
            {
                var part = parts[i];
                if (part.Length == 0) continue;   // "items[0]" -> "items", "0", "" になる場合がある

                if (current is Dictionary<string, object> dict)
                {
                    if (!dict.TryGetValue(part, out current)) return false;
                    continue;
                }

                if (current is IDictionary<string, object> genericDict)
                {
                    if (!genericDict.TryGetValue(part, out current)) return false;
                    continue;
                }

                if (current is System.Collections.IList list)
                {
                    if (!int.TryParse(part, out int index)) return false;
                    if (index < 0 || index >= list.Count) return false;
                    current = list[index];
                    continue;
                }

                return false;
            }

            value = current;
            return true;
        }

        /// <summary>名前を 1 つ消す。bind している UI にも知らせる。</summary>
        public void RemoveValue(string key)
        {
            if (string.IsNullOrWhiteSpace(key)) return;
            if (!_values.Remove(key)) return;
            OnValueChanged?.Invoke(key, null);
        }

        /// <summary>全部消す。bind している UI にも知らせる。</summary>
        public void Clear()
        {
            if (_values.Count == 0) return;
            var keys = new List<string>(_values.Keys);
            _values.Clear();
            foreach (var key in keys) OnValueChanged?.Invoke(key, null);
        }

        public Dictionary<string, object> GetSnapshot()
        {
            return new Dictionary<string, object>(_values, StringComparer.OrdinalIgnoreCase);
        }
    }
}
