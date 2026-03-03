using System.Collections.Generic;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// スクリプト上の store オブジェクト。
    /// store.get(key), store.set(key, value) で軽量な状態保持を提供する。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class StoreWrapper
    {
        private readonly Dictionary<string, object> _store = new();

        [UnityEngine.Scripting.Preserve]
        public object get(string key)
        {
            if (string.IsNullOrEmpty(key)) return null;
            return _store.TryGetValue(key, out var value) ? value : null;
        }

        [UnityEngine.Scripting.Preserve]
        public void set(string key, object value)
        {
            if (string.IsNullOrEmpty(key)) return;
            _store[key] = value;
        }

        [UnityEngine.Scripting.Preserve]
        public bool has(string key)
        {
            if (string.IsNullOrEmpty(key)) return false;
            return _store.ContainsKey(key);
        }

        [UnityEngine.Scripting.Preserve]
        public void remove(string key)
        {
            if (string.IsNullOrEmpty(key)) return;
            _store.Remove(key);
        }

        [UnityEngine.Scripting.Preserve]
        public void clear()
        {
            _store.Clear();
        }
    }
}