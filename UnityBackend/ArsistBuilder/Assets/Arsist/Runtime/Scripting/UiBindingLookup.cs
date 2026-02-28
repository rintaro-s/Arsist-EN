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

        public static GameObject Find(string id)
        {
            _table.TryGetValue(id, out var go);
            return go;
        }

        public static void Clear() => _table.Clear();
    }
}
