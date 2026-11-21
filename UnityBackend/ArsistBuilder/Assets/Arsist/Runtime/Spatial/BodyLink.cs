// ==============================================
// Arsist Engine - Layster.Spatial: 現実の体 (ロボット) とつなぐ
// Assets/Arsist/Runtime/Spatial/BodyLink.cs
//
// 体 (doc/19-layster.md §3.8) ごとに WebSocket を 1 本張る (System.Net.WebSockets.ClientWebSocket)。
//   layster-body  Layster Body Protocol (layster.body/1、doc/20-spatial-runtime.md §4)
//   rosbridge     ROS / ROS 2 の rosbridge の JSON (命令ごとの ros.topic へ publish)
// 命令はすべて安全の門 (Core/SafetyGate) を通る: 動ける範囲・ユーザーの手・回数・確認 (confirm: always)。
// 動いている間 (busy) にユーザーの手が目標に近づいたら stop を送る。
// 受け取りは別のスレッドで、中身はメインスレッドに戻してから扱う (Unity と store はメインスレッドだけ)。
// store (body.store、既定 body.<id>):
//   .connected (bool) ・ .status (短い文: connected / picking / blocked: hand too close …) ・ .busy (bool) ・ .state (最後の state をそのまま)
// 出来事: body:<id> (state が来た・結果が来た)、blocked (安全の門が止めた)
// ==============================================

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Inference;
using Arsist.Runtime.Spatial.Core;
using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    public sealed class BodyLinks
    {
        private readonly ArsistSpatialRuntime _rt;
        private readonly Dictionary<string, BodyLink> _links = new Dictionary<string, BodyLink>(StringComparer.Ordinal);

        public BodyLinks(ArsistSpatialRuntime runtime)
        {
            _rt = runtime;
            foreach (var b in runtime.Model.Bodies) _links[b.Id] = new BodyLink(runtime, b);
        }

        public BodyLink Get(string id) => id != null && _links.TryGetValue(id, out var l) ? l : null;

        public void Tick()
        {
            foreach (var l in _links.Values) l.Tick();
        }

        public void Command(string body, string name, Dictionary<string, object> args, string source, Action<Dictionary<string, object>> done)
        {
            var link = Get(body);
            if (link == null)
            {
                Debug.LogWarning($"[Layster] {source}: no body '{body}'");
                done?.Invoke(new Dictionary<string, object> { ["ok"] = false, ["blocked"] = true, ["reason"] = "noBody" });
                return;
            }
            link.Command(name, args, source, done);
        }

        public void Dispose()
        {
            foreach (var l in _links.Values) l.Dispose();
        }
    }

    public sealed class BodyLink
    {
        public const string Protocol = "layster.body/1";

        private readonly ArsistSpatialRuntime _rt;
        private readonly BodyDef _def;
        private readonly SafetyGate _gate;
        private readonly ConcurrentQueue<string> _incoming = new ConcurrentQueue<string>();
        private readonly ConcurrentQueue<string> _outgoing = new ConcurrentQueue<string>();
        private readonly Dictionary<string, Action<Dictionary<string, object>>> _pending = new Dictionary<string, Action<Dictionary<string, object>>>();
        private readonly HashSet<string> _advertised = new HashSet<string>();
        private CancellationTokenSource _cts;
        private volatile bool _connected;
        private bool _wasConnected;
        private double _nextConnect;
        private int _nextId;
        private Vec3? _activeTarget;
        private bool _busy;
        private bool _confirming;

        public BodyLink(ArsistSpatialRuntime runtime, BodyDef def)
        {
            _rt = runtime;
            _def = def;
            _gate = new SafetyGate(def);
            SetStore("connected", false);
            SetStore("busy", false);
            SetStore("status", "connecting");
        }

        public BodyDef Def => _def;
        public bool Connected => _connected;

        private void SetStore(string field, object value) => ArsistDataStore.Instance.SetValue($"{_def.Store}.{field}", value);

        /// <summary>体の根元の姿勢 (spatial)。根元の物がまだ置かれていなければ null。</summary>
        public SpatialPose? BasePose()
        {
            var b = _rt.Placer.Get(_def.BaseThing);
            return b != null && b.Placed ? b.Pose : (SpatialPose?)null;
        }

        // ---- つなぐ ----

        public void Tick()
        {
            double now = _rt.Now;
            if (!_connected && _cts == null && now >= _nextConnect) Connect();
            if (_connected != _wasConnected)
            {
                _wasConnected = _connected;
                SetStore("connected", _connected);
                SetStore("status", _connected ? "connected" : "disconnected");
                _rt.Events.Emit("body:" + _def.Id, new Dictionary<string, object> { ["connected"] = _connected }, _def.Id);
                if (_connected) Hello();
            }
            while (_incoming.TryDequeue(out var text)) Receive(text);

            // 動いている間の見張り: 手が近づいたら止める
            if (_busy && _activeTarget.HasValue && _gate.HandTooClose(_activeTarget.Value, _rt.User.Hands))
            {
                Send(new Dictionary<string, object> { ["type"] = "stop", ["id"] = "s" + (++_nextId), ["reason"] = "handTooClose" });
                _activeTarget = null;
                SetStore("status", SafetyGate.Explain("handTooClose"));
                _rt.Events.Emit("blocked", new Dictionary<string, object> { ["body"] = _def.Id, ["reason"] = "handTooClose", ["while"] = "moving" }, _def.Id);
                Debug.LogWarning($"[Layster] body {_def.Id}: the user's hand came close while moving; sent stop");
            }
        }

        private void Connect()
        {
            var edge = _rt.Minds.Edge();
            var url = MindProtocol.ResolveEdge(_def.Url, edge);
            if (string.IsNullOrEmpty(url) || url.Contains("{") || (_def.Url.Contains("{edge") && string.IsNullOrWhiteSpace(edge)))
            {
                _nextConnect = _rt.Now + 10;
                SetStore("status", "no address (set the PC address)");
                return;
            }
            _cts = new CancellationTokenSource();
            var token = _cts.Token;
            Task.Run(async () =>
            {
                using (var ws = new ClientWebSocket())
                {
                    try
                    {
                        using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(token))
                        {
                            timeout.CancelAfter(5000);
                            await ws.ConnectAsync(new Uri(url), timeout.Token);
                        }
                        _connected = true;
                        var send = SendLoop(ws, token);
                        var buffer = new byte[64 * 1024];
                        var message = new StringBuilder();
                        while (!token.IsCancellationRequested && ws.State == WebSocketState.Open)
                        {
                            var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                            if (result.MessageType == WebSocketMessageType.Close) break;
                            message.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                            if (!result.EndOfMessage) continue;
                            _incoming.Enqueue(message.ToString());
                            message.Clear();
                        }
                    }
                    catch (Exception e)
                    {
                        if (!token.IsCancellationRequested) Debug.LogWarning($"[Layster] body {_def.Id}: {url}: {e.GetType().Name}: {e.Message}");
                    }
                    finally
                    {
                        _connected = false;
                    }
                }
            }).ContinueWith(_ => _rt.Post(() =>
            {
                _cts = null;
                _nextConnect = _rt.Now + 3;
                _busy = false;
                _activeTarget = null;
                SetStore("busy", false);
                foreach (var p in _pending.Values) p?.Invoke(new Dictionary<string, object> { ["ok"] = false, ["reason"] = "disconnected" });
                _pending.Clear();
                _advertised.Clear();
            }));
        }

        private async Task SendLoop(ClientWebSocket ws, CancellationToken token)
        {
            while (!token.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                if (_outgoing.TryDequeue(out var text))
                {
                    var bytes = Encoding.UTF8.GetBytes(text);
                    await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, token);
                    continue;
                }
                await Task.Delay(10, token);
            }
        }

        private void Send(Dictionary<string, object> message) => _outgoing.Enqueue(MiniJson.Write(message));

        private void Hello()
        {
            if (_def.Protocol == "rosbridge") return;
            var commands = new List<object>();
            foreach (var c in _def.Commands) commands.Add(c.Name);
            Send(new Dictionary<string, object>
            {
                ["type"] = "hello",
                ["protocol"] = Protocol,
                ["body"] = _def.Id,
                ["app"] = _rt.Model.Name,
                ["commands"] = commands,
                ["workspace"] = new Dictionary<string, object> { ["center"] = _def.WorkspaceCenter.ToPlain(), ["size"] = _def.WorkspaceSize.ToPlain() },
            });
        }

        private void Receive(string text)
        {
            Dictionary<string, object> msg;
            try { msg = MiniJson.Parse(text) as Dictionary<string, object>; }
            catch (Exception) { Debug.LogWarning($"[Layster] body {_def.Id}: unreadable message"); return; }
            if (msg == null) return;
            switch (J.Str(msg, "type", J.Str(msg, "op", "")))
            {
                case "state":
                {
                    SetStore("state", msg);
                    if (J.Has(msg, "status")) SetStore("status", J.Str(msg, "status"));
                    if (J.Has(msg, "busy")) { _busy = J.Bool(msg, "busy", false); SetStore("busy", _busy); if (!_busy) _activeTarget = null; }
                    _rt.Recorder?.Event("body:" + _def.Id, msg);
                    _rt.Events.Emit("body:" + _def.Id, msg, _def.Id);
                    break;
                }
                case "result":
                {
                    var id = J.Str(msg, "id");
                    bool ok = J.Bool(msg, "ok", false);
                    if (!ok && J.Has(msg, "error")) SetStore("status", "error: " + J.Str(msg, "error"));
                    if (id != null && _pending.TryGetValue(id, out var done))
                    {
                        _pending.Remove(id);
                        done?.Invoke(new Dictionary<string, object> { ["ok"] = ok, ["error"] = J.Str(msg, "error"), ["result"] = msg });
                    }
                    _rt.Events.Emit("body:" + _def.Id, msg, _def.Id);
                    break;
                }
                case "hello":
                    Debug.Log($"[Layster] body {_def.Id}: bridge '{J.Str(msg, "name", "?")}' says hello");
                    break;
                default:
                    _rt.Events.Emit("body:" + _def.Id, msg, _def.Id);
                    break;
            }
        }

        // ---- 命令 ----

        /// <summary>引数の target / pose を体の frame の { at, yaw } に直す。最初の target は安全の門で見る。</summary>
        private Dictionary<string, object> ResolveArgs(BodyCommandDef cmd, Dictionary<string, object> args, SpatialPose basePose, out Vec3? targetWorld)
        {
            targetWorld = null;
            var output = new Dictionary<string, object>();
            if (args == null) return output;
            foreach (var pair in args)
            {
                cmd.Args.TryGetValue(pair.Key, out var type);
                if ((type == "target" || type == "pose") && pair.Value is Dictionary<string, object> raw)
                {
                    Vec3 point;
                    double yaw = 0;
                    if (raw.TryGetValue("at", out var at) && J.TryVec3(at, out var local) && !J.Has(raw, "frame") && !J.Has(raw, "thing") && !J.Has(raw, "entity") && !J.Has(raw, "user"))
                    {
                        // { at: [...] } だけなら、もう体の frame
                        point = SpatialMath.FrameToWorld(local, basePose.At, basePose.Yaw);
                        yaw = basePose.Yaw + J.Num(raw, "yaw", 0);
                    }
                    else
                    {
                        var world = _rt.Placer.CurrentWorld();
                        var t = Target.FromPlain(raw);
                        if (t == null || !_rt.Placer.Solver.TargetPoint(t, world, out point))
                            throw new InvalidOperationException($"{pair.Key}: the target is not known here");
                        if (t.Kind == TargetKind.Thing) yaw = _rt.Placer.Get(t.Thing)?.Pose.Yaw ?? 0;
                    }
                    if (!targetWorld.HasValue) targetWorld = point;
                    output[pair.Key] = new Dictionary<string, object>
                    {
                        ["at"] = SpatialMath.PointToFrame(point, basePose.At, basePose.Yaw).ToPlainRounded(),
                        ["yaw"] = SpatialMath.Round3(SpatialMath.NormYaw(yaw - basePose.Yaw)),
                        ["frame"] = "body",
                    };
                    continue;
                }
                output[pair.Key] = pair.Value;
            }
            return output;
        }

        public void Command(string name, Dictionary<string, object> args, string source, Action<Dictionary<string, object>> done)
        {
            void Block(string reason, string detail = null)
            {
                SetStore("status", SafetyGate.Explain(reason));
                var data = new Dictionary<string, object> { ["body"] = _def.Id, ["command"] = name, ["reason"] = reason, ["source"] = source };
                _rt.Events.Emit("blocked", data, _def.Id);
                _rt.Recorder?.Event("blocked", data);
                Debug.LogWarning($"[Layster] body {_def.Id}: {name} from {source} blocked: {reason}{(detail != null ? $" ({detail})" : "")}");
                done?.Invoke(new Dictionary<string, object> { ["ok"] = false, ["blocked"] = true, ["reason"] = reason });
            }

            var cmd = _def.Command(name);
            if (cmd == null) { Block("unknownCommand"); return; }
            if (!_connected) { Block("notConnected"); return; }
            var basePose = BasePose();
            if (basePose == null) { Block("noBase", $"the base thing '{_def.BaseThing}' is not placed"); return; }

            Dictionary<string, object> resolved;
            Vec3? target;
            try { resolved = ResolveArgs(cmd, args, basePose.Value, out target); }
            catch (Exception e) { Block("badTarget", e.Message); return; }

            var verdict = _gate.Check(name, target, basePose.Value, _rt.User.Hands, _rt.Now);
            if (!verdict.Allowed) { Block(verdict.Reason); return; }

            void SendNow()
            {
                // 確認を待つ間に状況が変わったかもしれないので、もう一度門を通す
                var again = _gate.Check(name, target, basePose.Value, _rt.User.Hands, _rt.Now);
                if (!again.Allowed) { Block(again.Reason); return; }
                _gate.Sent(_rt.Now);
                var id = "c" + (++_nextId);
                if (_def.Protocol == "rosbridge")
                {
                    if (string.IsNullOrEmpty(cmd.RosTopic)) { Block("noRosTopic"); return; }
                    if (_advertised.Add(cmd.RosTopic))
                        Send(new Dictionary<string, object> { ["op"] = "advertise", ["topic"] = cmd.RosTopic, ["type"] = cmd.RosType ?? "std_msgs/String" });
                    Send(new Dictionary<string, object> { ["op"] = "publish", ["topic"] = cmd.RosTopic, ["msg"] = resolved, ["id"] = id });
                    done?.Invoke(new Dictionary<string, object> { ["ok"] = true });
                }
                else
                {
                    _pending[id] = done;
                    Send(new Dictionary<string, object> { ["type"] = "command", ["id"] = id, ["name"] = name, ["args"] = resolved, ["frame"] = "body" });
                }
                _activeTarget = target;
                SetStore("status", name);
                _rt.Recorder?.Event("command", new Dictionary<string, object> { ["body"] = _def.Id, ["name"] = name, ["args"] = resolved, ["id"] = id });
                Debug.Log($"[Layster] body {_def.Id}: {name} ({source}) sent as {id}");
            }

            if (verdict.NeedsConfirm)
            {
                if (_confirming) { Block("busy", "another confirmation is open"); return; }
                _confirming = true;
                var text = string.IsNullOrEmpty(cmd.Description) ? $"{_def.Id}: {name}?" : $"{_def.Id}: {cmd.Description}?";
                _rt.Ui.Confirm(text, ok =>
                {
                    _confirming = false;
                    if (ok) SendNow();
                    else Block("declined");
                });
                return;
            }
            SendNow();
        }

        public void Dispose()
        {
            try { _cts?.Cancel(); } catch (Exception) { }
        }
    }
}
