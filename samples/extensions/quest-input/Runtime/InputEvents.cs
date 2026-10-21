// ==============================================
// Arsist Extension: quest-input — events
// samples/extensions/quest-input/Runtime/InputEvents.cs
//
// 入力の出来事 (ボタンを押した・ピンチした・話し終えた …) を 2 か所へ流す:
//   1. スクリプトの on(name, fn)       controller / hands / mic / keyboard / headset のどれの on でも同じ表
//   2. エンジンのスクリプトイベント    "quest-input:<name>"。trigger が { type: "event", value: … } の
//                                      スクリプトがそのまま走る (関数を書かずに使える)
//
// 表はスクリプトの登録 (Awake) より前から要るので、static に持つ。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Scripting;
using UnityEngine;

namespace Arsist.Extensions.QuestInput
{
    internal static class InputEvents
    {
        private static readonly Dictionary<string, List<Action<object[]>>> Listeners =
            new Dictionary<string, List<Action<object[]>>>(StringComparer.OrdinalIgnoreCase);

        /// <summary>エンジンのスクリプトイベントも鳴らすか (設定 scriptEvents)。</summary>
        public static bool FireScriptEvents = true;

        public static void On(string name, Action<object[]> listener)
        {
            if (string.IsNullOrEmpty(name) || listener == null) return;
            if (!Listeners.TryGetValue(name, out var list)) Listeners[name] = list = new List<Action<object[]>>();
            list.Add(listener);
        }

        public static void Off(string name)
        {
            if (!string.IsNullOrEmpty(name)) Listeners.Remove(name);
        }

        public static bool HasListeners(string name) =>
            Listeners.TryGetValue(name, out var list) && list.Count > 0;

        public static void Emit(string name, params object[] args)
        {
            if (Listeners.TryGetValue(name, out var list))
            {
                foreach (var listener in list.ToArray())
                {
                    try { listener(args); }
                    catch (Exception e) { Debug.LogError($"[Arsist:quest-input] listener for '{name}' failed: {e.Message}"); }
                }
            }
            if (FireScriptEvents) ArsistScriptEvent.Fire("quest-input:" + name, warnIfUnhandled: false);
        }
    }
}
