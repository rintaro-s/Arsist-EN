// ==============================================
// Arsist Engine - Layster.Spatial: 出来事
// Assets/Arsist/Runtime/Spatial/SpatialEvents.cs
//
// 出来事は 2 通りの道で入ってくるが、配る先は 1 つ (Raised):
//   アプリの出来事  パネルのボタン・emit の行動・拡張機能の FireEvent。どれも ArsistScriptEvent を通る
//                   (Virtual と同じ道。{ type: "event" } のスクリプトもそのまま動く)。
//                   規則・Mind・world.on が使う名前を ArsistScriptEvent に登録しておき、鳴ったらここで配る
//   エンジンの出来事 placed / fallback / seen / lost / mind / select / blocked / body:<id> / action:<kind>
//                   ArsistScriptEvent は通さず、直接ここで配る
// emit の data は ArsistScriptEvent では運べないので、鳴らす直前に預けておく (AppData)。
// 最近の 50 件は Mind の観測 (observe.events) と記録に使う。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Scripting;
using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    public sealed class SpatialEvents
    {
        public const int Keep = 50;

        private readonly ArsistSpatialRuntime _rt;
        private readonly Dictionary<string, Action> _registered = new Dictionary<string, Action>(StringComparer.Ordinal);
        private readonly Dictionary<string, object> _appData = new Dictionary<string, object>(StringComparer.Ordinal);
        /// <summary>パネルのボタンの bindingId → (thing, item)。鳴ったら select も配る</summary>
        private readonly Dictionary<string, KeyValuePair<string, string>> _selects = new Dictionary<string, KeyValuePair<string, string>>(StringComparer.Ordinal);

        public readonly List<Dictionary<string, object>> Recent = new List<Dictionary<string, object>>();

        /// <summary>(名前, data, 主語 (thing / mind / body の id。無ければ null))</summary>
        public event Action<string, object, string> Raised;

        public SpatialEvents(ArsistSpatialRuntime runtime)
        {
            _rt = runtime;
        }

        /// <summary>エンジンの出来事を配る。</summary>
        public void Emit(string name, object data, string subject = null)
        {
            if (string.IsNullOrEmpty(name)) return;
            Recent.Add(new Dictionary<string, object> { ["t"] = Core.SpatialMath.Round3(_rt.Now), ["name"] = name, ["data"] = data });
            if (Recent.Count > Keep) Recent.RemoveAt(0);
            _rt.Recorder?.Event(name, data);
            try
            {
                Raised?.Invoke(name, data, subject);
            }
            catch (Exception e)
            {
                Debug.LogError($"[Layster] event '{name}' handler failed: {e.GetType().Name}: {e.Message}\n{e.StackTrace}");
            }
        }

        /// <summary>アプリの出来事を鳴らす (emit の行動)。ArsistScriptEvent を通るので、Virtual 式のスクリプトも動く。</summary>
        public void EmitApp(string name, object data)
        {
            if (string.IsNullOrEmpty(name)) return;
            _appData[name] = data;
            Listen(name);
            ArsistScriptEvent.Fire(name, false);
        }

        /// <summary>この名前のアプリの出来事を受ける (同じ名前は 1 回だけ登録する)。</summary>
        public void Listen(string name)
        {
            if (string.IsNullOrEmpty(name) || _registered.ContainsKey(name)) return;
            Action handler = () => OnAppEvent(name);
            _registered[name] = handler;
            ArsistScriptEvent.Register(name, handler);
        }

        /// <summary>パネルのボタンを登録する (鳴ったら、その名前の出来事に加えて select を配る)。</summary>
        public void ListenSelect(string bindingId, string thing, string item)
        {
            if (string.IsNullOrEmpty(bindingId)) return;
            _selects[bindingId] = new KeyValuePair<string, string>(thing, item);
            Listen(bindingId);
        }

        private void OnAppEvent(string name)
        {
            _appData.TryGetValue(name, out var data);
            _appData.Remove(name);
            Emit(name, data, null);
            if (_selects.TryGetValue(name, out var sel))
            {
                Emit("select", new Dictionary<string, object> { ["thing"] = sel.Key, ["item"] = sel.Value, ["event"] = name }, sel.Key);
            }
        }

        public void Dispose()
        {
            foreach (var pair in _registered) ArsistScriptEvent.Unregister(pair.Key, pair.Value);
            _registered.Clear();
        }
    }
}
