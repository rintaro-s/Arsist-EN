// ==============================================
// Arsist Engine - スクリプトの storage (端末に残す値)
//
//   storage.save()              今すぐ書き出す (普段は自動)
//   storage.forget(keyOrPrefix) ストアと端末から消す ("memory." なら memory.〜 すべて)
//   storage.keys([prefix])      保存されているキーの配列
//   storage.isSaved(key)        このキーが端末に残る指定か
//
// どのキーを残すかは project.storage.persist。仕組みは Data/ArsistPersistentStore。
// ==============================================

using System.Collections.Generic;
using Arsist.Runtime.Data;
using Jint.Native;
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    [UnityEngine.Scripting.Preserve]
    public sealed class StorageWrapper
    {
        private readonly JsBridge _js;

        public StorageWrapper(JsBridge js)
        {
            _js = js;
        }

        private static ArsistPersistentStore Store => ArsistPersistentStore.Instance;

        [UnityEngine.Scripting.Preserve]
        public bool save()
        {
            if (Store == null || !Store.Enabled)
            {
                Debug.LogWarning("[ArsistJS] storage.save: no keys are set to be kept on the device (Data tab → Saved on the device)");
                return false;
            }
            return Store.Save();
        }

        [UnityEngine.Scripting.Preserve]
        public double forget(string keyOrPrefix)
        {
            if (string.IsNullOrEmpty(keyOrPrefix)) return 0;
            if (Store == null)
            {
                // 保存の仕組みが無くても、ストアからは消す
                int removed = 0;
                foreach (var key in DataFlow.ArsistDataStore.Instance.GetSnapshot().Keys)
                {
                    if (!PersistentValues.MatchesForget(key, keyOrPrefix)) continue;
                    DataFlow.ArsistDataStore.Instance.RemoveValue(key);
                    removed++;
                }
                return removed;
            }
            return Store.Forget(keyOrPrefix);
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue keys(string prefix = null)
        {
            var list = Store != null ? Store.SavedKeys(prefix) : new List<string>();
            return _js.ToJs(list);
        }

        [UnityEngine.Scripting.Preserve]
        public bool isSaved(string key)
        {
            return Store != null && Store.IsPersisted(key);
        }
    }
}
