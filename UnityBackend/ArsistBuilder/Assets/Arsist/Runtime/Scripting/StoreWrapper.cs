using UnityEngine;
using Arsist.Runtime.Data;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// JS から永続データストアにアクセスするためのラッパー。
    /// ArsistDataManager の薄いラッパーとして機能する。
    /// 使用例 (JS):
    ///   store.set('score', 100);
    ///   var score = store.get('score');
    ///   store.set('playerName', 'Taro');
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class StoreWrapper
    {
        /// <summary>永続データを取得する。キーが存在しなければ null を返す。</summary>
        [UnityEngine.Scripting.Preserve]
        public object get(string key)
        {
            var mgr = ArsistDataManager.Instance;
            if (mgr == null)
            {
                Debug.LogWarning("[ArsistScript/store] ArsistDataManager が見つかりません");
                return null;
            }
            if (!mgr.HasKey(key)) return null;
            return mgr.Get<object>(key);
        }

        /// <summary>永続データを保存する。</summary>
        [UnityEngine.Scripting.Preserve]
        public void set(string key, object value)
        {
            var mgr = ArsistDataManager.Instance;
            if (mgr == null)
            {
                Debug.LogWarning("[ArsistScript/store] ArsistDataManager が見つかりません");
                return;
            }
            mgr.Set(key, value);
        }

        /// <summary>キーが存在するか確認する。</summary>
        [UnityEngine.Scripting.Preserve]
        public bool has(string key)
        {
            var mgr = ArsistDataManager.Instance;
            return mgr != null && mgr.HasKey(key);
        }

        /// <summary>キーを削除する。</summary>
        [UnityEngine.Scripting.Preserve]
        public void remove(string key)
        {
            var mgr = ArsistDataManager.Instance;
            mgr?.DeleteKey(key);
        }
    }
}
