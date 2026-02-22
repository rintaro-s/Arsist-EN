using System;
using System.Collections.Generic;
using UnityEngine;
using Jint;
using Jint.Native;
using Newtonsoft.Json.Linq;
using Arsist.Runtime.Events;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// JS から ArsistEventBus へのブリッジ。
    /// 使用例 (JS):
    ///   event.emit('my_event', { value: 42 });
    ///   event.on('btn_refresh', function(data) { log(data); });
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class EventWrapper
    {
        private readonly Engine _engine;
        private readonly Dictionary<string, Action<JObject>> _handlers
            = new Dictionary<string, Action<JObject>>();

        public EventWrapper(Engine engine)
        {
            _engine = engine;
        }

        /// <summary>イベントを発火する</summary>
        [UnityEngine.Scripting.Preserve]
        public void emit(string eventName, object payload = null)
        {
            if (string.IsNullOrWhiteSpace(eventName)) return;

            var bus = ArsistEventBus.Instance;
            if (bus == null)
            {
                Debug.LogWarning("[ArsistScript/event] ArsistEventBus が見つかりません");
                return;
            }

            JObject jPayload;
            if (payload == null)
            {
                jPayload = new JObject();
            }
            else
            {
                try
                {
                    jPayload = JObject.Parse(payload.ToString());
                }
                catch
                {
                    jPayload = new JObject { ["value"] = payload.ToString() };
                }
            }

            bus.Publish(eventName, jPayload);
        }

        /// <summary>イベントを購読する</summary>
        [UnityEngine.Scripting.Preserve]
        public void on(string eventName, JsValue callback)
        {
            if (string.IsNullOrWhiteSpace(eventName)) return;
            if (!IsCallable(callback)) return;

            var bus = ArsistEventBus.Instance;
            if (bus == null)
            {
                Debug.LogWarning("[ArsistScript/event] ArsistEventBus が見つかりません");
                return;
            }

            // 既存のハンドラがあれば一旦解除
            if (_handlers.TryGetValue(eventName, out var existing))
            {
                bus.Unsubscribe(eventName, existing);
            }

            Action<JObject> handler = (data) =>
            {
                try
                {
                    if (!IsCallable(callback)) return;
                    var json = data?.ToString() ?? "{}";
                    _engine.Invoke(callback, new object[] { json });
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[ArsistScript/event] '{eventName}' ハンドラでエラー: {ex.Message}");
                }
            };

            _handlers[eventName] = handler;
            bus.Subscribe(eventName, handler);
        }

        /// <summary>イベント購読を解除する</summary>
        [UnityEngine.Scripting.Preserve]
        public void off(string eventName)
        {
            if (string.IsNullOrWhiteSpace(eventName)) return;

            var bus = ArsistEventBus.Instance;
            if (bus == null) return;

            if (_handlers.TryGetValue(eventName, out var handler))
            {
                bus.Unsubscribe(eventName, handler);
                _handlers.Remove(eventName);
            }
        }

        private static bool IsCallable(JsValue val)
        {
            return val != null && val.Type == Jint.Runtime.Types.Object;
        }
    }
}
