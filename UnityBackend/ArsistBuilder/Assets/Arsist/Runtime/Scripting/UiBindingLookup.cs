// ==============================================
// Arsist Engine - UI Binding Lookup Table
// Assets/Arsist/Runtime/Scripting/UiBindingLookup.cs
// ==============================================
using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// bindingId → GameObject の静的ルックアップテーブル。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public static class UiBindingLookup
    {
        private static readonly Dictionary<string, GameObject> _table = new();

        public static void Register(string id, GameObject go)
        {
            _table[id] = go;
        }

        public static void Unregister(string id)
        {
            _table.Remove(id);
        }

        /// <summary>その id がまだこの物を指しているときだけ外す (同じ id の別の要素を消さない)。</summary>
        public static void Unregister(string id, GameObject go)
        {
            if (_table.TryGetValue(id, out var current) && (current == go || current == null)) _table.Remove(id);
        }

        public static GameObject Find(string id)
        {
            if (!_table.TryGetValue(id, out var go)) return null;
            if (go == null)
            {
                // 壊された物 (Unity の null) は表から外す
                _table.Remove(id);
                return null;
            }
            return go;
        }

        public static void Clear() => _table.Clear();
    }
}
