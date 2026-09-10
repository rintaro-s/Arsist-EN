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

            // "items[0]" を "items.0" に均してから分解する。
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

        public Dictionary<string, object> GetSnapshot()
        {
            return new Dictionary<string, object>(_values, StringComparer.OrdinalIgnoreCase);
        }
    }
}
