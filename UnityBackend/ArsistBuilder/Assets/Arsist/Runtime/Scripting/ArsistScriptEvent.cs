// ==============================================
// Arsist Engine - Script Event Bus
// Assets/Arsist/Runtime/Scripting/ArsistScriptEvent.cs
// ==============================================
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// スクリプトのイベントトリガー用シンプルなイベントバス。
    /// UI ボタン等のコンポーネントから ArsistScriptEvent.Fire("btn_refresh") で発火できる。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public static class ArsistScriptEvent
    {
        private static readonly Dictionary<string, Action> _handlers = new();

        public static void Register(string eventName, Action handler)
        {
            if (_handlers.ContainsKey(eventName))
                _handlers[eventName] += handler;
            else
                _handlers[eventName] = handler;
        }

        public static void Unregister(string eventName, Action handler)
        {
            if (_handlers.ContainsKey(eventName))
                _handlers[eventName] -= handler;
        }

        public static void Fire(string eventName)
        {
            Fire(eventName, true);
        }

        /// <summary>
        /// warnIfUnhandled=false で「誰も購読していないのが正常」なイベントを発火する。
        /// 画像アンカーの found/lost のように、スクリプトが無くても毎回飛ぶものに使う。
        /// </summary>
        public static void Fire(string eventName, bool warnIfUnhandled)
        {
            if (_handlers.TryGetValue(eventName, out var handler))
            {
                Debug.Log($"[Arsist] Firing script event: {eventName}");
                handler?.Invoke();
            }
            else if (warnIfUnhandled)
            {
                Debug.LogWarning($"[Arsist] No handler registered for event: {eventName}");
            }
        }
    }
}
