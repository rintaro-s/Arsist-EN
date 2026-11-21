// ==============================================
// Arsist Engine - Layster.Spatial: スクリプトの `world`
// Assets/Arsist/Runtime/Spatial/WorldWrapper.cs
//
// 一覧と説明は src/shared/layster/spatial/scriptApi.ts (WORLD_SCRIPT_API) が唯一の元。ここに足したら向こうにも足す。
// 位置はすべて spatial の world (メートル、x 右・y 上・z 前、原点は起動したときの足元)。
// Jint はメソッドをリフレクションで呼ぶので、すべて [Preserve] (と link.xml) で残す。
// ランタイムがまだ無い (起動直後) ときは、読むものは null / [] を、するものは false を返す。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Scripting;
using Arsist.Runtime.Spatial.Core;
using Jint.Native;
using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    [UnityEngine.Scripting.Preserve]
    public sealed class WorldWrapper
    {
        private readonly JsBridge _js;
        private readonly Dictionary<string, List<JsValue>> _listeners = new Dictionary<string, List<JsValue>>(StringComparer.Ordinal);
        private bool _hooked;

        [UnityEngine.Scripting.Preserve]
        public RecordApi record { get; }

        public WorldWrapper(JsBridge js)
        {
            _js = js;
            record = new RecordApi();
        }

        // MonoBehaviour に ?. を使わない (壊された物も null に見えない)。ここで本物の null にそろえる
        private static ArsistSpatialRuntime Rt => ArsistSpatialRuntime.Instance != null ? ArsistSpatialRuntime.Instance : null;

        private Dictionary<string, object> Obj(JsValue v) => _js.FromJs(v) as Dictionary<string, object>;

        private JsValue EntityJs(Entity e) => e == null ? JsValue.Null : _js.ToJs(WorldState.ToPlain(e, Rt?.Model.Vocabulary));

        // ---- entity ----

        [UnityEngine.Scripting.Preserve]
        public JsValue find(JsValue query)
        {
            var rt = Rt;
            if (rt == null) return JsValue.Null;
            var q = EntityQuery.FromPlain(Obj(query)) ?? new EntityQuery();
            Entity best = null;
            double bestD = double.MaxValue;
            foreach (var e in rt.Placer.Solver.FindEntities(q, rt.Placer.CurrentWorld()))
            {
                double d = SpatialMath.HorizontalDistance(e.At, rt.User.Feet);
                if (d < bestD - SpatialMath.Eps) { best = e; bestD = d; }
            }
            return EntityJs(best);
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue entities() => entities(JsValue.Undefined);

        [UnityEngine.Scripting.Preserve]
        public JsValue entities(JsValue query)
        {
            var rt = Rt;
            var list = new List<object>();
            if (rt != null)
            {
                var q = EntityQuery.FromPlain(Obj(query)) ?? new EntityQuery { MinConfidence = 0 };
                foreach (var e in rt.Placer.Solver.FindEntities(q, rt.Placer.CurrentWorld())) list.Add(WorldState.ToPlain(e, rt.Model.Vocabulary));
            }
            return _js.ToJs(list);
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue get(string id) => EntityJs(Rt?.World.Get(id));

        [UnityEngine.Scripting.Preserve]
        public bool believe(JsValue entity)
        {
            var rt = Rt;
            var raw = Obj(entity);
            if (rt == null || raw == null) return false;
            var e = MindRunner.BeliefToWorld(raw, Vec3.Zero, 0, J.Str(raw, "source", "script"));
            if (e == null) return false;
            if (!WorldState.Fades(e.Source) && e.Source != "user") e.Source = "script";
            return rt.World.Upsert(e, rt.Now);
        }

        [UnityEngine.Scripting.Preserve]
        public bool forget(string id) => Rt != null && Rt.World.Remove(id);

        // ---- ユーザーと物 ----

        [UnityEngine.Scripting.Preserve]
        public JsValue user()
        {
            var rt = Rt;
            if (rt == null || !rt.User.HasHead) return JsValue.Null;
            var u = rt.User;
            return _js.ToJs(new Dictionary<string, object>
            {
                ["head"] = new Dictionary<string, object> { ["at"] = u.HeadAt.ToPlainRounded(), ["forward"] = u.Forward.ToPlainRounded() },
                ["feet"] = u.Feet.ToPlainRounded(),
                ["yaw"] = SpatialMath.Round3(u.Yaw),
                ["hands"] = new Dictionary<string, object>
                {
                    ["left"] = u.LeftHand.HasValue ? u.LeftHand.Value.ToPlainRounded() : null,
                    ["right"] = u.RightHand.HasValue ? u.RightHand.Value.ToPlainRounded() : null,
                },
                ["gaze"] = rt.Gaze.ToPlain(),
            });
        }

        private JsValue ThingJs(ThingBinding b)
        {
            if (b == null) return JsValue.Null;
            return _js.ToJs(new Dictionary<string, object>
            {
                ["id"] = b.Def.Id,
                ["at"] = b.Placed ? b.Pose.At.ToPlainRounded() : null,
                ["yaw"] = b.Placed ? SpatialMath.Round3(b.Pose.Yaw) : 0.0,
                ["placed"] = b.Placed,
                ["visible"] = b.AppliedVisible,
                ["rule"] = b.Result != null ? b.Result.RuleValue : null,
                ["host"] = b.Result?.Host,
                ["mode"] = b.Result?.Mode,
                ["notes"] = b.Result != null ? new List<object>(b.Result.Notes) : new List<object>(),
            });
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue thing(string id) => ThingJs(Rt?.Placer.Get(id));

        [UnityEngine.Scripting.Preserve]
        public JsValue place(string id) => place(id, JsValue.Undefined);

        [UnityEngine.Scripting.Preserve]
        public JsValue place(string id, JsValue placement)
        {
            var rt = Rt;
            var b = rt?.Placer.Get(id);
            if (b == null) return JsValue.Null;
            var raw = Obj(placement);
            rt.Placer.Resolve(b, raw != null ? Placement.FromPlain(raw) : null, "world.place", animate: true);
            return ThingJs(b);
        }

        // ---- 行動 ----

        /// <summary>world.act(action) / world.act([a, b]) — 問題があった行動の説明を配列で返す (無ければ空)。</summary>
        [UnityEngine.Scripting.Preserve]
        public JsValue act(JsValue actions)
        {
            var rt = Rt;
            var problems = new List<object>();
            if (rt == null) { problems.Add("the spatial runtime is not running yet"); return _js.ToJs(problems); }
            var plain = _js.FromJs(actions);
            var list = new List<Dictionary<string, object>>();
            if (plain is Dictionary<string, object> one) list.Add(one);
            else if (plain is List<object> many) foreach (var item in many) if (item is Dictionary<string, object> d) list.Add(d);
            foreach (var a in list)
            {
                var p = rt.Actions.Execute(a, "script", null);
                if (p != null) problems.Add(p);
            }
            return _js.ToJs(problems);
        }

        [UnityEngine.Scripting.Preserve]
        public bool ask(string mind) => ask(mind, JsValue.Undefined, JsValue.Undefined);

        [UnityEngine.Scripting.Preserve]
        public bool ask(string mind, JsValue extraOrCallback) =>
            _js.IsFunction(extraOrCallback) ? ask(mind, JsValue.Undefined, extraOrCallback) : ask(mind, extraOrCallback, JsValue.Undefined);

        /// <summary>world.ask("helper", { text }, function (reply) { … })</summary>
        [UnityEngine.Scripting.Preserve]
        public bool ask(string mind, JsValue extra, JsValue callback)
        {
            var rt = Rt;
            if (rt == null) return false;
            var text = J.Str(Obj(extra), "text");
            return rt.Minds.Ask(mind, text, reply => _js.Call(callback, $"world.ask('{mind}')", reply));
        }

        [UnityEngine.Scripting.Preserve]
        public void command(string body, string name) => command(body, name, JsValue.Undefined, JsValue.Undefined);

        [UnityEngine.Scripting.Preserve]
        public void command(string body, string name, JsValue args) =>
            command(body, name, _js.IsFunction(args) ? JsValue.Undefined : args, _js.IsFunction(args) ? args : JsValue.Undefined);

        /// <summary>world.command("arm", "pick", { target: … }, function (r) { … }) — r = { ok, blocked, reason }</summary>
        [UnityEngine.Scripting.Preserve]
        public void command(string body, string name, JsValue args, JsValue callback)
        {
            var rt = Rt;
            if (rt == null) { _js.Call(callback, "world.command", new Dictionary<string, object> { ["ok"] = false, ["reason"] = "notRunning" }); return; }
            rt.Bodies.Command(body, name, Obj(args), "script", r => _js.Call(callback, $"world.command('{body}', '{name}')", r));
        }

        // ---- 出来事 ----

        /// <summary>world.on(name, fn) — placed / fallback / seen / lost / mind / select / blocked / body:&lt;id&gt; / action:&lt;do&gt; / アプリの出来事</summary>
        [UnityEngine.Scripting.Preserve]
        public void on(string name, JsValue callback)
        {
            if (string.IsNullOrEmpty(name) || !_js.IsFunction(callback)) { Debug.LogWarning("[ArsistJS] world.on(name, fn): fn must be a function"); return; }
            if (!_listeners.TryGetValue(name, out var list)) _listeners[name] = list = new List<JsValue>();
            list.Add(callback);
            Hook();
            var rt = Rt;
            if (rt != null && !IsEngineEvent(name)) rt.Events.Listen(name);
            else if (rt == null && !IsEngineEvent(name)) PendingListen.Add(name);
        }

        internal static readonly List<string> PendingListen = new List<string>();

        private static bool IsEngineEvent(string name) =>
            name == "placed" || name == "fallback" || name == "seen" || name == "lost" || name == "mind" || name == "select"
            || name == "blocked" || name.StartsWith("body:", StringComparison.Ordinal) || name.StartsWith("action:", StringComparison.Ordinal);

        private void Hook()
        {
            if (_hooked) return;
            var rt = Rt;
            if (rt == null) { ArsistSpatialRuntime.Started += Hook; return; }
            _hooked = true;
            ArsistSpatialRuntime.Started -= Hook;
            foreach (var name in PendingListen) rt.Events.Listen(name);
            PendingListen.Clear();
            rt.Events.Raised += (name, data, subject) =>
            {
                if (!_listeners.TryGetValue(name, out var list)) return;
                foreach (var cb in list.ToArray()) _js.Call(cb, $"world.on('{name}')", data);
            };
        }

        // ---- その他 ----

        /// <summary>world.snapshot(frame) — Mind が受け取るのと同じ観測 (世界・物・ユーザー・最近の出来事)。</summary>
        [UnityEngine.Scripting.Preserve]
        public JsValue snapshot() => snapshot("user");

        [UnityEngine.Scripting.Preserve]
        public JsValue snapshot(string frame)
        {
            var rt = Rt;
            if (rt == null) return JsValue.Null;
            var mind = new MindDef
            {
                Id = "snapshot",
                Observe = new Dictionary<string, object>
                {
                    ["frame"] = string.IsNullOrEmpty(frame) ? "user" : frame,
                    ["world"] = new Dictionary<string, object> { ["max"] = 200.0 },
                    ["things"] = true,
                    ["user"] = new List<object> { "head", "hands", "gaze" },
                    ["events"] = 20.0,
                },
            };
            return _js.ToJs(ObservationBuilder.Build(rt.ObservationInput(mind)));
        }

        [UnityEngine.Scripting.Preserve]
        public string edge() => Rt != null ? Rt.Minds.Edge() : "";

        /// <summary>world.setEdge("192.168.0.23:8000") — Mind・体の {edge} の先 (端末に残る)。</summary>
        [UnityEngine.Scripting.Preserve]
        public void setEdge(string address)
        {
            ArsistDataStore.Instance.SetValue("layster.edge", (address ?? "").Trim());
            Debug.Log($"[Layster] edge address: {address}");
        }

        [UnityEngine.Scripting.Preserve]
        public sealed class RecordApi
        {
            [UnityEngine.Scripting.Preserve]
            public void start() { if (Rt != null) Rt.Recorder.Start(); }

            [UnityEngine.Scripting.Preserve]
            public void stop() { if (Rt != null) Rt.Recorder.Stop(); }

            [UnityEngine.Scripting.Preserve]
            public void mark(string label) { if (Rt != null) Rt.Recorder.Mark(label); }

            [UnityEngine.Scripting.Preserve]
            public bool active() => Rt != null && Rt.Recorder.Active;

            [UnityEngine.Scripting.Preserve]
            public string folder() => Rt != null ? Rt.Recorder.Directory ?? "" : "";
        }
    }
}
