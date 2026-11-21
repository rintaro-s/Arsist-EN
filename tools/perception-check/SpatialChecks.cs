// Layster.Spatial のランタイム (Runtime/Spatial/Core) のうち、実機を使わずに確かめられる部分。
//
//   - 置き方 (PlacementSolver): src/shared/layster/spatial/solver-cases.json の表を解き、TS (solver.ts) と
//     同じ答え (規則・載せた面・frame・位置 ±5 mm・向き ±0.05°) になるか。ずれると、エディタの Space Lab で
//     見た置き場所と実機の置き場所が違う
//   - 世界の状態 (WorldState): 推測の確かさが時間で下がる・見えた / 見失ったの出来事
//   - 安全の門 (SafetyGate): 動ける範囲・手の近さ・回数・確認
//   - Mind との話し方 (MindProtocol): 返事の文から JSON を拾う、{edge} の置き換え、指示文の形
//   - 観測 (ObservationBuilder): observe.ts と同じ frame への直し方
using System;
using System.Collections.Generic;
using System.IO;
using Arsist.Runtime.Inference;
using Arsist.Runtime.Spatial.Core;

internal static class SpatialChecks
{
    private static int _failures;

    private static void Expect(string label, bool ok, string detail = null)
    {
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}{(detail != null ? $": {detail}" : "")}");
        if (!ok) _failures++;
    }

    private static string FindRepoFile(string relative)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            var candidate = Path.Combine(dir.FullName, relative);
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        var cwd = Path.Combine(Directory.GetCurrentDirectory(), relative);
        return File.Exists(cwd) ? cwd : null;
    }

    public static int Run()
    {
        Console.WriteLine("\n== Layster.Spatial ==");
        SolverTable();
        WorldStateChecks();
        SafetyChecks();
        ProtocolChecks();
        ObservationChecks();
        return _failures;
    }

    // ---- 置き方 ----

    private static void SolverTable()
    {
        var path = FindRepoFile(Path.Combine("src", "shared", "layster", "spatial", "solver-cases.json"));
        if (path == null) { Expect("solver-cases.json found", false); return; }
        var root = MiniJson.ParseObject(File.ReadAllText(path));
        var vocab = Vocabulary.FromPlain(J.List(root, "vocabulary"));
        var solver = new PlacementSolver(vocab);
        int compared = 0, mismatched = 0;
        foreach (var rawCase in J.List(root, "cases"))
        {
            var c = J.Obj(rawCase);
            var name = J.Str(c, "name");
            var world = new SolveWorld();
            var user = J.Obj(c, "user");
            world.User = new SolveUser { At = J.V3(user, "at", Vec3.Zero), Yaw = J.Num(user, "yaw", 0), EyeHeight = J.Num(user, "eyeHeight", 1.6) };
            var hands = J.Obj(c, "hands");
            if (hands != null)
            {
                if (hands.TryGetValue("left", out var l) && J.TryVec3(l, out var lv)) world.LeftHand = lv;
                if (hands.TryGetValue("right", out var r) && J.TryVec3(r, out var rv)) world.RightHand = rv;
            }
            foreach (var e in J.List(c, "entities")) world.Entities.Add(Entity.FromPlain(J.Obj(e), "space"));
            var things = new List<ThingDef>();
            foreach (var t in J.List(c, "things"))
            {
                var td = J.Obj(t);
                var visual = J.Obj(td, "visual");
                things.Add(new ThingDef
                {
                    Id = J.Str(td, "id"),
                    Kind = J.Str(visual, "kind"),
                    Size = PlacementSolver.ThingSize(visual),
                    Place = Placement.FromPlain(J.Obj(td, "place")),
                });
            }
            var results = solver.SolveAll(things, world);
            var expected = J.List(c, "expected");
            for (int i = 0; i < expected.Count; i++)
            {
                var ex = J.Obj(expected[i]);
                var got = results[i];
                compared++;
                var exRule = ex["rule"] is string ? -1 : (int)J.Num(ex, "rule", -2);
                var exHost = J.Str(ex, "host");
                var exAt = J.V3(ex, "at", Vec3.Zero);
                double exYaw = J.Num(ex, "yaw", 0);
                double dPos = (got.Pose.At - exAt).Length;
                double dYaw = Math.Abs(SpatialMath.NormYaw(got.Pose.Yaw - exYaw));
                bool ok = got.Rule == exRule && got.Host == exHost && got.Frame == J.Str(ex, "frame") && dPos <= 0.005 && dYaw <= 0.05;
                if (!ok)
                {
                    mismatched++;
                    Expect($"solver {name}/{got.Thing}", false,
                        $"rule {got.Rule} host {got.Host ?? "-"} {got.Frame} at {got.Pose.At} yaw {got.Pose.Yaw} — expected rule {exRule} host {exHost ?? "-"} {J.Str(ex, "frame")} at {exAt} yaw {exYaw} ({string.Join(" | ", got.Notes)})");
                }
            }
        }
        Expect($"solver matches solver-cases.json ({compared} placements)", mismatched == 0 && compared > 0, mismatched > 0 ? $"{mismatched} differ" : null);
    }

    // ---- 世界の状態 ----

    private static void WorldStateChecks()
    {
        var vocab = Vocabulary.FromPlain(null);
        var world = new WorldState(vocab);
        var seen = new List<string>();
        var lost = new List<string>();
        world.Seen += e => seen.Add(e.Id);
        world.Lost += e => lost.Add(e.Id);
        world.Upsert(new Entity { Id = "cup", Is = { "cup" }, At = new Vec3(0, 0.8, 1), Size = new Vec3(0.08, 0.1, 0.08), Confidence = 0.8, Source = "mind:helper" }, 0);
        Expect("belief becomes seen", seen.Contains("cup"));
        world.Tick(10);
        var cup = world.Get("cup");
        Expect("belief confidence fades over time", cup != null && cup.Confidence < 0.8 && cup.Confidence > 0.3, cup != null ? cup.Confidence.ToString("0.000") : "gone");
        world.Tick(60);
        Expect("faded belief is lost and removed", world.Get("cup") == null && lost.Contains("cup"));

        world.Upsert(new Entity { Id = "desk", Is = { "desk" }, At = new Vec3(0, 0.36, 1), Size = new Vec3(1.2, 0.72, 0.6), Confidence = 0.95, Source = "scan" }, 0);
        world.Tick(600);
        Expect("scanned entities do not fade", world.Get("desk") != null && Math.Abs(world.Get("desk").Confidence - 0.95) < 1e-9);
        // 推測は確かな観測を上書きしない
        world.Upsert(new Entity { Id = "desk", Is = { "desk" }, At = new Vec3(5, 0.36, 5), Size = new Vec3(1, 1, 1), Confidence = 0.4, Source = "mind:x" }, 601);
        Expect("a weaker belief does not move a scanned entity", world.Get("desk").At.X == 0);
        world.Remove("desk");
        Expect("remove", world.Get("desk") == null && lost.Contains("desk"));
    }

    // ---- 安全の門 ----

    private static void SafetyChecks()
    {
        var body = new BodyDef
        {
            Id = "arm",
            WorkspaceCenter = new Vec3(0, 0.15, 0.2),
            WorkspaceSize = new Vec3(0.5, 0.4, 0.4),
            StopIfHandWithin = 0.25,
            MaxPerSecond = 2,
        };
        body.Commands.Add(new BodyCommandDef { Name = "pick", Confirm = "always" });
        body.Commands.Add(new BodyCommandDef { Name = "home" });
        var gate = new SafetyGate(body);
        var basePose = new SpatialPose(new Vec3(1, 0.7, 1), 90); // 根元は (1, 0.7, 1)、+X を向く
        // 体の frame で (0, 0.1, 0.25) → world では根元から +X に 0.25
        var inside = SpatialMath.FrameToWorld(new Vec3(0, 0.1, 0.25), basePose.At, basePose.Yaw);
        Expect("frame→world of a body point", Math.Abs(inside.X - 1.25) < 1e-9 && Math.Abs(inside.Z - 1) < 1e-9);

        var v = gate.Check("pick", inside, basePose, new Vec3?[] { new Vec3(0, 1, 0) }, 0);
        Expect("pick inside the workspace needs confirmation", v.Allowed && v.NeedsConfirm, v.Reason);
        v = gate.Check("pick", SpatialMath.FrameToWorld(new Vec3(0, 0.1, 0.9), basePose.At, basePose.Yaw), basePose, new Vec3?[0], 0.1);
        Expect("pick outside the workspace is blocked", !v.Allowed && v.Reason == "outsideWorkspace", v.Reason);
        v = gate.Check("pick", inside, basePose, new Vec3?[] { inside + new Vec3(0.1, 0, 0) }, 0.2);
        Expect("pick near the user's hand is blocked", !v.Allowed && v.Reason == "handTooClose", v.Reason);
        v = gate.Check("home", null, basePose, new Vec3?[0], 0.3);
        Expect("home without a target passes", v.Allowed && !v.NeedsConfirm, v.Reason);
        gate.Sent(0.3);
        gate.Sent(0.4);
        v = gate.Check("home", null, basePose, new Vec3?[0], 0.5);
        Expect("rate limit (2 per second)", !v.Allowed && v.Reason == "tooFrequent", v.Reason);
        v = gate.Check("home", null, basePose, new Vec3?[0], 1.5);
        Expect("rate limit releases after a second", v.Allowed, v.Reason);
        v = gate.Check("dance", null, basePose, new Vec3?[0], 2);
        Expect("unknown command is blocked", !v.Allowed && v.Reason == "unknownCommand", v.Reason);
    }

    // ---- Mind との話し方 ----

    private static void ProtocolChecks()
    {
        var reply = MindProtocol.ParseOpenAiChatReply(MiniJson.Parse(
            "{\"choices\":[{\"message\":{\"content\":\"<think>hmm {not json}</think>Sure:\\n```json\\n{\\\"actions\\\":[{\\\"do\\\":\\\"say\\\",\\\"text\\\":\\\"hi\\\"},{\\\"x\\\":1}],\\\"text\\\":\\\"ok\\\"}\\n```\"}}]}"));
        Expect("openai reply: think + fences stripped, JSON found", reply.Actions.Count == 1 && reply.Text == "ok", $"{reply.Actions.Count} actions, text {reply.Text}");
        var plain = MindProtocol.ParseOpenAiChatReply(MiniJson.Parse("{\"choices\":[{\"message\":{\"content\":\"just words\"}}]}"));
        Expect("openai reply without JSON becomes text", plain.Actions.Count == 0 && plain.Text == "just words");
        var lay = MindProtocol.ParseLaysterReply(MiniJson.Parse("{\"actions\":[{\"do\":\"highlight\"}],\"beliefs\":[{\"id\":\"b1\"},{\"no\":1}],\"nextInMs\":2000}"));
        Expect("layster reply", lay.Actions.Count == 1 && lay.Beliefs.Count == 1 && lay.NextInMs == 2000);
        Expect("resolveEdge {edge}", MindProtocol.ResolveEdge("http://{edge}/v1", "http://192.168.0.23:8000/") == "http://192.168.0.23:8000/v1");
        Expect("resolveEdge {edge-host}", MindProtocol.ResolveEdge("ws://{edge-host}:8766", "192.168.0.23:8000") == "ws://192.168.0.23:8766");

        var mind = new MindDef { Id = "m", Role = "decide", Instructions = "Help.", OutputActions = { "say", "highlight" }, OutputBeliefs = true, Model = "qwen" };
        var system = MindProtocol.SystemPromptFor(mind, "user");
        Expect("system prompt lists allowed actions only", system.StartsWith("Help.\n\nYou are connected") && system.Contains("\"do\":\"say\"") && !system.Contains("\"do\":\"command\"") && system.Contains("Beliefs:"));
        var body = MindProtocol.OpenAiChatBody(mind, new Dictionary<string, object> { ["protocol"] = "layster.mind/1", ["frame"] = "user", ["camera"] = new Dictionary<string, object> { ["mime"] = "image/jpeg", ["data"] = "AAA" } });
        var messages = J.List(body, "messages");
        var userContent = J.List(J.Obj(messages[1]), "content");
        Expect("camera goes as image_url, not in the JSON text", userContent != null && userContent.Count == 2 && !J.Str(J.Obj(userContent[0]), "text").Contains("AAA"));
        var filtered = ActionModel.FilterForMind(mind, new List<Dictionary<string, object>> { new Dictionary<string, object> { ["do"] = "say" }, new Dictionary<string, object> { ["do"] = "command" } }, out var dropped);
        Expect("mind may return only its allowed actions", filtered.Count == 1 && dropped.Count == 1);
    }

    // ---- 観測 ----

    private static void ObservationChecks()
    {
        var vocab = Vocabulary.FromPlain(MiniJson.Parse("[{\"word\":\"desk\",\"synonyms\":[],\"has\":[\"support\",\"obstacle\"],\"vertical\":false,\"broader\":[\"table\"]}]") as List<object>);
        var world = new SolveWorld { User = new SolveUser { At = new Vec3(1, 0, 1), Yaw = 90, EyeHeight = 1.6 } };
        world.Entities.Add(new Entity { Id = "desk", Is = { "desk" }, At = new Vec3(2, 0.36, 1), Size = new Vec3(1.2, 0.72, 0.6), Yaw = 90, Confidence = 0.9, Source = "scan" });
        world.Entities.Add(new Entity { Id = "ghost", Is = { "cup" }, At = new Vec3(0, 0, 0), Size = new Vec3(0.1, 0.1, 0.1), Confidence = 0.1, Source = "mind:x" });
        var mind = new MindDef { Id = "m", Observe = MiniJson.ParseObject("{\"frame\":\"user\",\"world\":{\"is\":[\"table\"]},\"user\":[\"head\"]}"), OutputActions = { "say" } };
        var req = ObservationBuilder.Build(new ObservationInput { Mind = mind, World = world, Vocabulary = vocab, Tick = 3, Time = 1.23456 });
        var entities = J.List(req, "world");
        Expect("observation keeps confident matching entities only", entities.Count == 1);
        var desk = J.Obj(entities[0]);
        J.TryVec3(desk["at"], out var at);
        // ユーザーは (1,0,1) で +X を向いている → 机 (2, .36, 1) は正面 1 m
        Expect("entity expressed in the user frame", Math.Abs(at.X) < 1e-9 && Math.Abs(at.Z - 1) < 1e-9 && Math.Abs(J.Num(desk, "yaw", 99)) < 1e-9, at.ToString());
        var has = J.Strings(desk, "has");
        Expect("affordances filled from the vocabulary", has != null && has.Contains("support"));
        Expect("request header", J.Str(req, "protocol") == "layster.mind/1" && J.Str(req, "frame") == "user" && Math.Abs(J.Num(req, "time", 0) - 1.235) < 1e-9);
    }
}
