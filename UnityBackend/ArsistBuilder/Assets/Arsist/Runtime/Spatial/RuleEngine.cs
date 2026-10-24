// ==============================================
// Arsist Engine - Layster.Spatial: 規則
// Assets/Arsist/Runtime/Spatial/RuleEngine.cs
//
// when (きっかけ) → if (条件) → do (行動の並び)。doc/19-layster.md §3.7。
//   出来事で決まるきっかけ  select / event / mind / placed / fallback / seen / lost   … SpatialEvents から
//   時間で見るきっかけ      start / every / gaze / near                                 … Tick で
// near / gaze は「そうでなかった → そうなった」ときに 1 回 (ずっと近くにいる間、鳴り続けない)。
// cooldownMs の間は同じ規則をもう一度動かさない。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Spatial.Core;
using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    public sealed class RuleEngine
    {
        private sealed class State
        {
            public RuleDef Rule;
            public double LastRun = -1e9;
            public double NextEvery;
            public bool Was;
            public double GazeSince = -1;
            public bool StartDone;
            /// <summary>select / event のとき、待つ出来事の名前</summary>
            public string EventName;
        }

        private readonly ArsistSpatialRuntime _rt;
        private readonly List<State> _states = new List<State>();

        public RuleEngine(ArsistSpatialRuntime runtime)
        {
            _rt = runtime;
            foreach (var r in runtime.Model.Rules)
            {
                var s = new State { Rule = r };
                if (r.When.TryGetValue("select", out var sel) && sel is string selName) s.EventName = SelectEventName(selName);
                else if (r.When.TryGetValue("event", out var ev) && ev is string evName) s.EventName = evName;
                if (s.EventName != null) runtime.Events.Listen(s.EventName);
                if (r.When.ContainsKey("every")) s.NextEvery = J.Num(r.When, "every", 1000) / 1000.0;
                _states.Add(s);
            }
            runtime.Events.Raised += OnEvent;
        }

        /// <summary>select の値 ("quiz.ok") → 鳴る出来事の名前 (パネルの bindingId)。</summary>
        public string SelectEventName(string select)
        {
            int dot = select.IndexOf('.');
            if (dot <= 0) return select;
            var thing = _rt.Model.Thing(select.Substring(0, dot));
            if (thing != null && thing.Bindings.TryGetValue(select.Substring(dot + 1), out var binding)) return binding;
            return select;
        }

        private void OnEvent(string name, object data, string subject)
        {
            foreach (var s in _states)
            {
                var w = s.Rule.When;
                bool hit = false;
                if (s.EventName != null) hit = name == s.EventName;
                else if (w.TryGetValue("mind", out var m) && m is string mind) hit = name == "mind" && subject == mind;
                else if (w.TryGetValue("placed", out var p) && p is string placed) hit = name == "placed" && subject == placed;
                else if (w.TryGetValue("fallback", out var f) && f is string fb) hit = name == "fallback" && subject == fb;
                else if (w.TryGetValue("seen", out var sq) && sq is Dictionary<string, object> seenQ) hit = name == "seen" && EntityMatches(data, seenQ);
                else if (w.TryGetValue("lost", out var lq) && lq is Dictionary<string, object> lostQ) hit = name == "lost" && EntityMatches(data, lostQ);
                if (hit) Run(s, $"{name}", data);
            }
        }

        private bool EntityMatches(object data, Dictionary<string, object> query)
        {
            var d = data as Dictionary<string, object>;
            var id = J.Str(d, "id");
            var e = id != null ? _rt.World.Get(id) : null;
            if (e == null && d != null) e = Entity.FromPlain(d);
            if (e == null) return false;
            var q = EntityQuery.FromPlain(query);
            if (!_rt.Model.Vocabulary.MatchesWords(e, new EntityQuery { Id = q.Id, Is = q.Is, Not = q.Not, Has = q.Has, MinConfidence = 0 })) return false;
            if (q.Within.HasValue && SpatialMath.HorizontalDistance(e.At, _rt.User.Feet) > q.Within.Value) return false;
            return true;
        }

        public void Tick()
        {
            double now = _rt.Now;
            foreach (var s in _states)
            {
                var w = s.Rule.When;
                if (w.ContainsKey("start"))
                {
                    if (!s.StartDone && _rt.Placer.Bindings.TrueForAll(b => b.Placed || b.Root == null))
                    {
                        s.StartDone = true;
                        Run(s, "start", null);
                    }
                }
                else if (w.ContainsKey("every"))
                {
                    if (now >= s.NextEvery)
                    {
                        s.NextEvery = now + Math.Max(0.1, J.Num(w, "every", 1000) / 1000.0);
                        Run(s, "every", null);
                    }
                }
                else if (w.TryGetValue("gaze", out var g) && g is string gazeThing)
                {
                    bool looking = _rt.Gaze.Thing == gazeThing;
                    if (!looking) { s.GazeSince = -1; s.Was = false; continue; }
                    if (s.GazeSince < 0) s.GazeSince = now;
                    double need = J.Num(w, "seconds", 1.0);
                    if (!s.Was && now - s.GazeSince >= need)
                    {
                        s.Was = true;
                        Run(s, "gaze", new Dictionary<string, object> { ["thing"] = gazeThing });
                    }
                }
                else if (w.TryGetValue("near", out var n) && n is string nearWho)
                {
                    bool near = IsNear(nearWho, Target.FromPlain(J.Obj(w, "to")), J.Num(w, "within", 1));
                    if (near && !s.Was) Run(s, "near", new Dictionary<string, object> { ["who"] = nearWho });
                    s.Was = near;
                }
            }
        }

        private bool IsNear(string who, Target to, double within)
        {
            if (to == null) return false;
            Vec3 a;
            if (who == "user") a = _rt.User.Feet;
            else
            {
                var b = _rt.Placer.Get(who);
                if (b == null || !b.Placed) return false;
                a = b.Pose.At;
            }
            var world = _rt.Placer.CurrentWorld();
            if (!_rt.Placer.Solver.TargetPoint(to, world, out var point)) return false;
            return SpatialMath.HorizontalDistance(a, point) <= within;
        }

        private void Run(State s, string cause, object data)
        {
            var r = s.Rule;
            if (!r.Enabled) return;
            double now = _rt.Now;
            if (r.CooldownMs > 0 && (now - s.LastRun) * 1000 < r.CooldownMs) return;
            foreach (var c in r.If)
            {
                bool ok = ActionModel.Evaluate(c,
                    key => ArsistDataStore.Instance.TryGetValueByPath(key, out var v) ? v : null,
                    q => _rt.Placer.Solver.FindEntities(q, _rt.Placer.CurrentWorld()).Count > 0);
                if (!ok) return;
            }
            s.LastRun = now;
            Debug.Log($"[Layster] rule {r.Id} ({cause}): {r.Do.Count} action(s)");
            _rt.Actions.ExecuteAll(r.Do, "rule:" + r.Id, null);
        }
    }
}
