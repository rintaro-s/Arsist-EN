using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// UI GameObject を ID で管理するレジストリ。
    /// この MonoBehaviour を UI GameObject にアタッチすることで、
    /// スクリプトから ui.setText(id, ...) などで参照できるようになる。
    /// </summary>
    public class UiBindingRegistry : MonoBehaviour
    {
        private static readonly Dictionary<string, GameObject> _registry
            = new Dictionary<string, GameObject>();

        [Tooltip("スクリプトから参照する一意のID")]
        [SerializeField] public string bindingId;

        private void OnEnable()
        {
            if (string.IsNullOrWhiteSpace(bindingId)) return;
            _registry[bindingId] = gameObject;
        }

        private void OnDisable()
        {
            if (string.IsNullOrWhiteSpace(bindingId)) return;
            if (_registry.TryGetValue(bindingId, out var go) && go == gameObject)
            {
                _registry.Remove(bindingId);
            }
        }

        /// <summary>指定IDの GameObject を取得する</summary>
        public static GameObject Find(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) return null;
            _registry.TryGetValue(id, out var result);
            return result;
        }

        /// <summary>
        /// 実行時に動的に登録する (プレハブ生成後など)
        /// </summary>
        public static void Register(string id, GameObject go)
        {
            if (string.IsNullOrWhiteSpace(id) || go == null) return;
            _registry[id] = go;
        }

        /// <summary>登録を解除する</summary>
        public static void Unregister(string id)
        {
            _registry.Remove(id);
        }

        /// <summary>全レジストリをクリアする (シーン切り替え時など)</summary>
        public static void Clear()
        {
            _registry.Clear();
        }
    }
}
