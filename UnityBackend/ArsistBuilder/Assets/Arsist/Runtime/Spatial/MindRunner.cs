// ==============================================
// Arsist Engine - Layster.Spatial: Mind を動かす
// Assets/Arsist/Runtime/Spatial/MindRunner.cs
//
// Mind (doc/19-layster.md §3.5) ごとに:
//   いつ    run.on = interval (everyMs、返事の nextInMs があればそれ) / change (世界の状態が変わったら) /
//           event (その出来事で) / manual (ask の行動・world.ask だけ)。どれも前回から minGapMs は空ける。
//           1 つの Mind は同時に 1 つしか走らない (返事待ちの間の呼び出しは捨てる)
//   何を    Core/ObservationBuilder で観測を作る (observe.camera があれば静止画を添える)
//   どこへ  endpoint ({edge} は store の layster.edge → 無ければ spatial.json の edge) に UnityWebRequest で POST
//   返事    belief は観測の frame から world に戻して世界の状態へ (出どころ mind:<id>)、
//           行動は output.actions にあるものだけ実行、text は output.text の store へ
//   失敗    onFail.use の Mind を走らせる / onFail.say を話す
// store: mind.<id>.status ("ok" / "error: …" / "thinking") ・ mind.<id>.text ・ mind.<id>.ms
// ==============================================

using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Inference;
using Arsist.Runtime.Spatial.Core;
using UnityEngine;
using UnityEngine.Networking;

namespace Arsist.Runtime.Spatial
{
    public sealed class MindRunner
    {
        private sealed class State
        {
            public MindDef Mind;
            public bool Running;
            public double LastStart = -1e9;
            public double NextDue;
            public int SeenVersion = -1;
            public int Tick;
        }

        private readonly ArsistSpatialRuntime _rt;
        private readonly Dictionary<string, State> _states = new Dictionary<string, State>(StringComparer.Ordinal);

        public MindRunner(ArsistSpatialRuntime runtime)
        {
            _rt = runtime;
            foreach (var m in runtime.Model.Minds)
            {
                _states[m.Id] = new State { Mind = m, NextDue = m.RunOn == "interval" ? 2.0 : double.MaxValue };
                if (m.RunOn == "event" && !string.IsNullOrEmpty(m.RunEvent)) runtime.Events.Listen(m.RunEvent);
            }
            runtime.Events.Raised += (name, data, subject) =>
            {
                foreach (var s in _states.Values)
                    if (s.Mind.RunOn == "event" && s.Mind.RunEvent == name) Request(s, null, $"event {name}", null);
            };
        }

        public string Edge()
        {
            if (ArsistDataStore.Instance.TryGetValueByPath("layster.edge", out var v) && v is string s && s.Trim().Length > 0) return s.Trim();
            return _rt.Model.Edge ?? "";
        }

        public void Tick()
        {
            double now = _rt.Now;
            foreach (var s in _states.Values)
            {
                if (s.Running) continue;
                switch (s.Mind.RunOn)
                {
                    case "interval":
                        if (now >= s.NextDue) Request(s, null, "interval", null);
                        break;
                    case "change":
                        if (_rt.World.Version != s.SeenVersion && now - s.LastStart >= s.Mind.MinGapMs / 1000.0)
                            Request(s, null, "world changed", null);
                        break;
                }
            }
        }

        /// <summary>今すぐ走らせる (ask の行動・world.ask)。done は返事 (失敗も) を受ける。</summary>
        public bool Ask(string mindId, string text, Action<Dictionary<string, object>> done)
        {
            if (!_states.TryGetValue(mindId ?? "", out var s))
            {
                Debug.LogWarning($"[Layster] ask: no mind '{mindId}'");
                done?.Invoke(new Dictionary<string, object> { ["ok"] = false, ["error"] = "noMind" });
                return false;
            }
            return Request(s, text, "ask", done, force: true);
        }

        private bool Request(State s, string text, string why, Action<Dictionary<string, object>> done, bool force = false)
        {
            double now = _rt.Now;
            if (s.Running)
            {
                done?.Invoke(new Dictionary<string, object> { ["ok"] = false, ["error"] = "busy" });
                return false;
            }
            if (!force && now - s.LastStart < s.Mind.MinGapMs / 1000.0) return false;
            if (string.IsNullOrEmpty(s.Mind.Endpoint))
            {
                done?.Invoke(new Dictionary<string, object> { ["ok"] = false, ["error"] = "noEndpoint" });
                return false;
            }
            s.Running = true;
            s.LastStart = now;
            s.SeenVersion = _rt.World.Version;
            s.Tick++;
            _rt.StartCoroutine(Run(s, text, why, done));
            return true;
        }

        private IEnumerator Run(State s, string text, string why, Action<Dictionary<string, object>> done)
        {
            var mind = s.Mind;
            ArsistDataStore.Instance.SetValue($"mind.{mind.Id}.status", "thinking");

            // ---- 観測 ----
            Dictionary<string, object> camera = null;
            if (J.Obj(mind.Observe, "camera") != null)
            {
                bool finished = false;
                int width = (int)J.Num(J.Obj(mind.Observe, "camera"), "width", 512);
                int quality = (int)J.Num(J.Obj(mind.Observe, "camera"), "quality", 75);
                SpatialCamera.Capture(width, quality, c => { camera = c; finished = true; });
                float deadline = Time.unscaledTime + 3f;
                while (!finished && Time.unscaledTime < deadline) yield return null;
            }

            var input = _rt.ObservationInput(mind);
            input.Tick = s.Tick;
            input.Camera = camera;
            var request = ObservationBuilder.Build(input, out var frameOrigin, out var frameYaw);
            if (!string.IsNullOrEmpty(text)) request["goal"] = string.IsNullOrEmpty(J.Str(request, "goal")) ? text : J.Str(request, "goal") + "\n" + text;
            if (mind.Extra != null && mind.Protocol == "layster") request["extra"] = mind.Extra;

            string url = MindProtocol.ResolveEdge(mind.Endpoint, Edge());
            object body = mind.Protocol == "openai-chat" ? (object)MindProtocol.OpenAiChatBody(mind, request) : request;
            var json = MiniJson.Write(body);
            _rt.Recorder?.Mind(mind.Id, "request", new Dictionary<string, object> { ["url"] = url, ["frame"] = J.Str(request, "frame"), ["entities"] = (double)(J.List(request, "world")?.Count ?? 0), ["camera"] = camera != null, ["why"] = why });

            float started = Time.realtimeSinceStartup;
            string error = null;
            string responseText = null;
            using (var req = new UnityWebRequest(url, UnityWebRequest.kHttpVerbPOST))
            {
                req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                req.downloadHandler = new DownloadHandlerBuffer();
                req.SetRequestHeader("Content-Type", "application/json");
                // Groq などは Python-urllib のような既定の User-Agent を断る
                req.SetRequestHeader("User-Agent", "Layster/1.0 (Arsist)");
                if (!string.IsNullOrEmpty(mind.AuthValue)) req.SetRequestHeader(mind.AuthHeader ?? "Authorization", mind.AuthValue);
                req.timeout = Math.Max(1, (int)Math.Ceiling(mind.TimeoutMs / 1000.0));
                yield return req.SendWebRequest();
                responseText = req.downloadHandler?.text;
                if (req.result != UnityWebRequest.Result.Success)
                    error = $"{req.error}{(req.responseCode > 0 ? $" (HTTP {req.responseCode})" : "")}";
            }
            double ms = (Time.realtimeSinceStartup - started) * 1000.0;
            ArsistDataStore.Instance.SetValue($"mind.{mind.Id}.ms", Math.Round(ms));

            MindReply reply = null;
            if (error == null)
            {
                try
                {
                    var parsed = MiniJson.Parse(responseText ?? "");
                    reply = mind.Protocol == "openai-chat" ? MindProtocol.ParseOpenAiChatReply(parsed) : MindProtocol.ParseLaysterReply(parsed);
                }
                catch (Exception e)
                {
                    error = "unreadable reply: " + e.Message;
                }
            }

            s.Running = false;
            if (error != null)
            {
                Debug.LogWarning($"[Layster] mind {mind.Id} failed after {ms:0} ms ({url}): {error}{Snippet(responseText)}");
                ArsistDataStore.Instance.SetValue($"mind.{mind.Id}.status", "error: " + error);
                s.NextDue = _rt.Now + Math.Max(5.0, mind.EveryMs / 1000.0);
                var failure = new Dictionary<string, object> { ["mind"] = mind.Id, ["ok"] = false, ["error"] = error, ["ms"] = Math.Round(ms) };
                _rt.Recorder?.Mind(mind.Id, "error", failure);
                _rt.Events.Emit("mind", failure, mind.Id);
                done?.Invoke(failure);
                if (!string.IsNullOrEmpty(mind.OnFailSay))
                    _rt.Actions.Execute(new Dictionary<string, object> { ["do"] = "say", ["text"] = mind.OnFailSay }, "mind:" + mind.Id, null);
                if (!string.IsNullOrEmpty(mind.OnFailUse) && mind.OnFailUse != mind.Id) Ask(mind.OnFailUse, text, null);
                yield break;
            }

            ArsistDataStore.Instance.SetValue($"mind.{mind.Id}.status", "ok");
            double next = reply.NextInMs ?? mind.EveryMs;
            s.NextDue = _rt.Now + Math.Max(mind.MinGapMs, Math.Max(200, next)) / 1000.0;

            // ---- belief ----
            int believed = 0;
            if (mind.OutputBeliefs)
            {
                foreach (var raw in reply.Beliefs)
                {
                    var e = BeliefToWorld(raw, frameOrigin, frameYaw, "mind:" + mind.Id);
                    if (e != null && _rt.World.Upsert(e, _rt.Now)) believed++;
                }
            }
            // ---- text ----
            if (reply.Text != null)
            {
                ArsistDataStore.Instance.SetValue($"mind.{mind.Id}.text", reply.Text);
                if (!string.IsNullOrEmpty(mind.OutputText)) ArsistDataStore.Instance.SetValue(mind.OutputText, reply.Text);
            }
            // ---- 行動 ----
            var kept = ActionModel.FilterForMind(mind, reply.Actions, out var dropped);
            foreach (var d in dropped) Debug.LogWarning($"[Layster] mind {mind.Id} returned \"{ActionModel.KindOf(d)}\", which it may not (output.actions); ignored");

            Debug.Log($"[Layster] mind {mind.Id} ({why}) {ms:0} ms: {kept.Count} action(s), {believed} belief(s){(reply.Text != null ? $", text \"{Short(reply.Text)}\"" : "")}");
            var summary = new Dictionary<string, object>
            {
                ["mind"] = mind.Id, ["ok"] = true, ["ms"] = Math.Round(ms), ["text"] = reply.Text,
                ["actions"] = new List<object>(kept), ["beliefs"] = (double)believed,
            };
            _rt.Recorder?.Mind(mind.Id, "reply", summary);
            _rt.Actions.ExecuteAll(kept, "mind:" + mind.Id, new FrameXf { Origin = frameOrigin, Yaw = frameYaw });
            _rt.Events.Emit("mind", summary, mind.Id);
            var forCallback = reply.ToPlain();
            forCallback["ok"] = true;
            forCallback["actions"] = new List<object>(kept);
            done?.Invoke(forCallback);
        }

        /// <summary>belief (観測の frame) → world の entity。確かさが無ければ 0.5。</summary>
        public static Entity BeliefToWorld(Dictionary<string, object> raw, Vec3 origin, double yaw, string source)
        {
            if (raw == null || !J.Has(raw, "id")) return null;
            if (!raw.ContainsKey("confidence")) raw["confidence"] = 0.5;
            var e = Entity.FromPlain(raw, source);
            if (e == null) return null;
            e.Source = source;
            e.At = SpatialMath.FrameToWorld(e.At, origin, yaw);
            e.Yaw = SpatialMath.NormYaw(e.Yaw + yaw);
            e.SeenAt = null;
            if (!J.Has(raw, "size")) e.Size = new Vec3(0.1, 0.1, 0.1);
            return e;
        }

        private static string Short(string s) => s.Length <= 60 ? s : s.Substring(0, 60) + "…";

        private static string Snippet(string body) => string.IsNullOrEmpty(body) ? "" : " — " + Short(body.Replace("\n", " "));
    }

    /// <summary>行動の位置を書いた frame (Mind の返事は観測の frame で書かれている)。</summary>
    public sealed class FrameXf
    {
        public Vec3 Origin;
        public double Yaw;
    }
}
