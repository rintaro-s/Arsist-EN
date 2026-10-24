// ==============================================
// Arsist Engine - Layster.Spatial core: Mind が受け取る観測
// Assets/Arsist/Runtime/Spatial/Core/ObservationBuilder.cs
//
// src/shared/layster/spatial/observe.ts (buildMindRequest) の写し。規則は向こうの頭に書いてある:
//   - 位置は observe.frame (既定 user) で。frame の原点と水平の向き (yaw) だけを使う
//     thing:<id> は置いた姿勢、body:<id> は体の根元 (base.thing) の置いた姿勢。分からなければ user
//   - world は確かさ・言葉・距離で絞り、近い順に max (既定 30)
//   - entity の has は語彙から補う。数は Round3
// ランタイムでは置いた物の姿勢を world に直したもの (Placed) を渡す。UnityEngine に依存しない。
// ==============================================

using System.Collections.Generic;
using System.Globalization;

namespace Arsist.Runtime.Spatial.Core
{
    public sealed class ObservedThing
    {
        public string Id;
        /// <summary>置けていれば world の姿勢</summary>
        public SpatialPose? Pose;
        public bool Visible;
    }

    public sealed class ObservationInput
    {
        public MindDef Mind;
        public SolveWorld World;
        public Vocabulary Vocabulary;
        /// <summary>アプリの物 (IR の順)</summary>
        public List<ObservedThing> Things = new List<ObservedThing>();
        /// <summary>体の id → 根元にする thing の id</summary>
        public Dictionary<string, string> BodyBases = new Dictionary<string, string>();
        public double Tick;
        public double Time;
        /// <summary>出来事 (古い順)。{ t, name, data }</summary>
        public List<Dictionary<string, object>> Events;
        public Dictionary<string, object> Store;
        public Dictionary<string, object> Gaze;
        public Dictionary<string, object> Camera;
    }

    public static class ObservationBuilder
    {
        public const int DefaultMaxEntities = 30;
        public const double DefaultMinConfidence = 0.2;

        private static bool ResolveFrame(string frame, ObservationInput input, out Vec3 origin, out double yaw)
        {
            origin = Vec3.Zero; yaw = 0;
            if (frame.StartsWith("thing:"))
            {
                var t = FindThing(input, frame.Substring(6));
                if (t?.Pose == null) return false;
                origin = t.Pose.Value.At; yaw = t.Pose.Value.Yaw; return true;
            }
            if (frame.StartsWith("body:"))
            {
                if (!input.BodyBases.TryGetValue(frame.Substring(5), out var baseThing)) return false;
                var t = FindThing(input, baseThing);
                if (t?.Pose == null) return false;
                origin = t.Pose.Value.At; yaw = t.Pose.Value.Yaw; return true;
            }
            return PlacementSolver.FramePose(frame, input.World, out origin, out yaw);
        }

        private static ObservedThing FindThing(ObservationInput input, string id)
        {
            foreach (var t in input.Things) if (t.Id == id) return t;
            return null;
        }

        private static bool KeyWanted(string key, List<string> wanted)
        {
            var k = key.ToLowerInvariant();
            foreach (var raw in wanted)
            {
                var w = raw.ToLowerInvariant();
                if (w.EndsWith(".") ? k.StartsWith(w) : k == w) return true;
            }
            return false;
        }

        public static Dictionary<string, object> Build(ObservationInput input) => Build(input, out _, out _);

        /// <summary>origin / yaw = 観測を書いた frame (返事の belief をこの frame から world に戻すのに使う)。</summary>
        public static Dictionary<string, object> Build(ObservationInput input, out Vec3 frameOrigin, out double frameYaw)
        {
            var mind = input.Mind;
            var world = input.World;
            var vocab = input.Vocabulary ?? new Vocabulary();
            var observe = mind.Observe ?? new Dictionary<string, object>();
            var wantedFrame = J.Str(observe, "frame", "user");
            string frame;
            if (ResolveFrame(wantedFrame, input, out var origin, out var fyaw)) frame = wantedFrame;
            else { frame = "user"; origin = world.User.At; fyaw = world.User.Yaw; }
            frameOrigin = origin;
            frameYaw = fyaw;

            var actions = new List<object>();
            foreach (var a in mind.OutputActions) actions.Add(a);
            var request = new Dictionary<string, object>
            {
                ["protocol"] = MindProtocol.Protocol,
                ["mind"] = mind.Id,
                ["tick"] = input.Tick,
                ["time"] = SpatialMath.Round3(input.Time),
                ["frame"] = frame,
                ["actions"] = actions,
            };

            var w = J.Obj(observe, "world");
            if (w != null)
            {
                double minConfidence = J.Num(w, "minConfidence", DefaultMinConfidence);
                double? within = J.NumOrNull(w, "within");
                var isWords = J.Strings(w, "is");
                int max = (int)J.Num(w, "max", DefaultMaxEntities);
                var rows = new List<KeyValuePair<double, int>>();
                for (int i = 0; i < world.Entities.Count; i++)
                {
                    var e = world.Entities[i];
                    double d = SpatialMath.HorizontalDistance(e.At, world.User.At);
                    if (e.Confidence < minConfidence) continue;
                    if (within.HasValue && d > within.Value) continue;
                    if (isWords != null && isWords.Count > 0 && !vocab.MatchesWords(e, new EntityQuery { Is = isWords, MinConfidence = 0 })) continue;
                    rows.Add(new KeyValuePair<double, int>(d, i));
                }
                rows.Sort((a, b) => a.Key != b.Key ? a.Key.CompareTo(b.Key) : a.Value.CompareTo(b.Value));
                var list = new List<object>();
                for (int i = 0; i < rows.Count && i < max; i++) list.Add(EntityInFrame(world.Entities[rows[i].Value], origin, fyaw, vocab));
                request["world"] = list;
            }

            if (observe.TryGetValue("things", out var thingsRaw) && thingsRaw != null && !(thingsRaw is bool tb && !tb))
            {
                HashSet<string> wanted = null;
                if (thingsRaw is List<object> wl)
                {
                    wanted = new HashSet<string>();
                    foreach (var x in wl) if (x is string s) wanted.Add(s);
                }
                var list = new List<object>();
                foreach (var t in input.Things)
                {
                    if (wanted != null && !wanted.Contains(t.Id)) continue;
                    if (t.Pose == null)
                    {
                        list.Add(new Dictionary<string, object> { ["id"] = t.Id, ["at"] = Vec3.Zero.ToPlain(), ["yaw"] = 0.0, ["placed"] = false, ["visible"] = false });
                        continue;
                    }
                    var p = t.Pose.Value;
                    list.Add(new Dictionary<string, object>
                    {
                        ["id"] = t.Id,
                        ["at"] = SpatialMath.PointToFrame(p.At, origin, fyaw).ToPlainRounded(),
                        ["yaw"] = SpatialMath.Round3(SpatialMath.NormYaw(p.Yaw - fyaw)),
                        ["placed"] = true,
                        ["visible"] = t.Visible,
                    });
                }
                request["things"] = list;
            }

            var userParts = J.Strings(observe, "user");
            if (userParts != null && userParts.Count > 0)
            {
                var user = new Dictionary<string, object>();
                if (userParts.Contains("head"))
                {
                    var head = world.Head;
                    var forward = new Vec3(System.Math.Sin(world.User.Yaw * SpatialMath.Deg), 0, System.Math.Cos(world.User.Yaw * SpatialMath.Deg));
                    user["head"] = new Dictionary<string, object>
                    {
                        ["at"] = SpatialMath.PointToFrame(head, origin, fyaw).ToPlainRounded(),
                        ["forward"] = SpatialMath.DirectionToFrame(forward, fyaw).ToPlainRounded(),
                    };
                }
                if (userParts.Contains("hands"))
                {
                    object Hand(Vec3? h) => h.HasValue
                        ? new Dictionary<string, object> { ["at"] = SpatialMath.PointToFrame(h.Value, origin, fyaw).ToPlainRounded() }
                        : null;
                    user["hands"] = new Dictionary<string, object> { ["left"] = Hand(world.LeftHand), ["right"] = Hand(world.RightHand) };
                }
                if (userParts.Contains("gaze")) user["gaze"] = input.Gaze;
                request["user"] = user;
            }

            if (J.Obj(observe, "camera") != null && input.Camera != null) request["camera"] = input.Camera;

            int events = (int)J.Num(observe, "events", 0);
            if (events > 0 && input.Events != null)
            {
                int from = System.Math.Max(0, input.Events.Count - events);
                var list = new List<object>();
                for (int i = from; i < input.Events.Count; i++) list.Add(input.Events[i]);
                request["events"] = list;
            }

            var storeKeys = J.Strings(observe, "store");
            if (storeKeys != null && storeKeys.Count > 0 && input.Store != null)
            {
                var output = new Dictionary<string, object>();
                foreach (var pair in input.Store) if (KeyWanted(pair.Key, storeKeys)) output[pair.Key] = pair.Value;
                request["store"] = output;
            }

            var goal = (mind.Instructions ?? "").Trim();
            if (goal.Length > 0) request["goal"] = goal;
            return request;
        }

        private static Dictionary<string, object> EntityInFrame(Entity e, Vec3 origin, double fyaw, Vocabulary vocab)
        {
            var d = new Dictionary<string, object>
            {
                ["id"] = e.Id,
                ["is"] = new List<object>(e.Is),
                ["at"] = SpatialMath.PointToFrame(e.At, origin, fyaw).ToPlainRounded(),
                ["yaw"] = SpatialMath.Round3(SpatialMath.NormYaw(e.Yaw - fyaw)),
                ["size"] = e.Size.ToPlainRounded(),
                ["has"] = new List<object>(vocab.AffordancesOf(e)),
                ["confidence"] = SpatialMath.Round3(e.Confidence),
                ["source"] = e.Source,
            };
            if (e.SeenAt.HasValue) d["seenAt"] = SpatialMath.Round3(e.SeenAt.Value);
            if (e.Data != null) d["data"] = e.Data;
            return d;
        }

        public static string Describe(Dictionary<string, object> request) =>
            string.Format(CultureInfo.InvariantCulture, "frame {0}, {1} entities", J.Str(request, "frame"), J.List(request, "world")?.Count ?? 0);
    }
}
