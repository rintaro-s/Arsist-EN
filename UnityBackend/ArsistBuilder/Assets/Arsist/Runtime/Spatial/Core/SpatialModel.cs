// ==============================================
// Arsist Engine - Layster.Spatial core: spatial.json を読む
// Assets/Arsist/Runtime/Spatial/Core/SpatialModel.cs
//
// ビルドが書き出す spatial.json (形式 layster.spatial.runtime/1、doc/19-layster.md §4.1) を型にする。
// IR の形の元は src/shared/layster/spatial/types.ts。ここは読むだけで、足りない項目は types.ts の既定で埋める。
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;
using System.Globalization;
using Arsist.Runtime.Inference;

namespace Arsist.Runtime.Spatial.Core
{
    /// <summary>素の木 (MiniJson) を読む小道具。</summary>
    public static class J
    {
        public static Dictionary<string, object> Obj(object v) => v as Dictionary<string, object>;
        public static List<object> List(object v) => v as List<object>;

        public static Dictionary<string, object> Obj(Dictionary<string, object> d, string key) => MiniJson.Obj(d, key);
        public static List<object> List(Dictionary<string, object> d, string key) => MiniJson.List(d, key);
        public static string Str(Dictionary<string, object> d, string key, string fallback = null) => MiniJson.Text(d, key, fallback);
        public static double Num(Dictionary<string, object> d, string key, double fallback) => MiniJson.Number(d, key, fallback);
        public static bool Bool(Dictionary<string, object> d, string key, bool fallback) => MiniJson.Bool(d, key, fallback);
        public static bool Has(Dictionary<string, object> d, string key) => d != null && d.TryGetValue(key, out var v) && v != null;

        public static double? NumOrNull(Dictionary<string, object> d, string key)
        {
            if (!Has(d, key)) return null;
            var v = d[key];
            if (v is double x) return x;
            return double.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out var p) ? p : (double?)null;
        }

        public static List<string> Strings(Dictionary<string, object> d, string key)
        {
            var list = List(d, key);
            if (list == null) return null;
            var result = new List<string>(list.Count);
            foreach (var item in list) if (item != null) result.Add(item as string ?? Convert.ToString(item, CultureInfo.InvariantCulture));
            return result;
        }

        public static bool TryVec3(object raw, out Vec3 v)
        {
            v = Vec3.Zero;
            var list = raw as List<object>;
            if (list == null || list.Count < 3) return false;
            v = new Vec3(ToNum(list[0]), ToNum(list[1]), ToNum(list[2]));
            return true;
        }

        public static Vec3 V3(Dictionary<string, object> d, string key, Vec3 fallback)
        {
            return d != null && d.TryGetValue(key, out var raw) && TryVec3(raw, out var v) ? v : fallback;
        }

        /// <summary>[min, max]。無ければ null。</summary>
        public static double[] Range(Dictionary<string, object> d, string key)
        {
            var list = List(d, key);
            if (list == null || list.Count < 2) return null;
            return new[] { ToNum(list[0]), ToNum(list[1]) };
        }

        public static double ToNum(object v)
        {
            if (v is double d) return d;
            if (v is bool b) return b ? 1 : 0;
            return double.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out var p) ? p : 0;
        }
    }

    // ========================================
    // 世界の状態
    // ========================================

    public sealed class Entity
    {
        public string Id;
        public List<string> Is = new List<string>();
        public Vec3 At;
        public double Yaw;
        public Vec3 Size;
        /// <summary>書かれていた affordance (無ければ null = 語彙から)</summary>
        public List<string> Has;
        public double Confidence = 1;
        public double? SeenAt;
        public string Source = "scan";
        public Dictionary<string, object> Data;

        public Entity Clone()
        {
            return new Entity
            {
                Id = Id, Is = new List<string>(Is), At = At, Yaw = Yaw, Size = Size,
                Has = Has != null ? new List<string>(Has) : null,
                Confidence = Confidence, SeenAt = SeenAt, Source = Source, Data = Data,
            };
        }

        public static Entity FromPlain(Dictionary<string, object> d, string defaultSource = "scan")
        {
            if (d == null) return null;
            var id = J.Str(d, "id");
            if (string.IsNullOrEmpty(id)) return null;
            return new Entity
            {
                Id = id,
                Is = J.Strings(d, "is") ?? new List<string>(),
                At = J.V3(d, "at", Vec3.Zero),
                Yaw = J.Num(d, "yaw", 0),
                Size = J.V3(d, "size", new Vec3(0.1, 0.1, 0.1)),
                Has = J.Strings(d, "has"),
                Confidence = J.Num(d, "confidence", 1),
                SeenAt = J.NumOrNull(d, "seenAt"),
                Source = J.Str(d, "source", defaultSource),
                Data = J.Obj(d, "data"),
            };
        }
    }

    /// <summary>entity を選ぶ条件。</summary>
    public sealed class EntityQuery
    {
        public string Id;
        public List<string> Is;
        public List<string> Not;
        public List<string> Has;
        public double[] MinSize;
        public double? Within;
        public double? MinConfidence;

        public static EntityQuery FromPlain(Dictionary<string, object> d)
        {
            if (d == null) return null;
            return new EntityQuery
            {
                Id = J.Str(d, "id"),
                Is = J.Strings(d, "is"),
                Not = J.Strings(d, "not"),
                Has = J.Strings(d, "has"),
                MinSize = J.Range(d, "minSize"),
                Within = J.NumOrNull(d, "within"),
                MinConfidence = J.NumOrNull(d, "minConfidence"),
            };
        }

        public static EntityQuery Words(params string[] words) => new EntityQuery { Is = new List<string>(words) };
    }

    public enum TargetKind { Thing, Entity, Frame, User }

    public sealed class Target
    {
        public TargetKind Kind;
        public string Thing;
        public EntityQuery Entity;
        public string Frame;
        public Vec3? At;
        /// <summary>head / feet / hand.left / hand.right</summary>
        public string User;

        public static Target FromPlain(Dictionary<string, object> d)
        {
            if (d == null) return null;
            if (J.Has(d, "thing")) return new Target { Kind = TargetKind.Thing, Thing = J.Str(d, "thing") };
            if (J.Has(d, "entity")) return new Target { Kind = TargetKind.Entity, Entity = EntityQuery.FromPlain(J.Obj(d, "entity")) ?? new EntityQuery() };
            if (J.Has(d, "frame"))
            {
                Vec3? at = null;
                if (d.TryGetValue("at", out var raw) && J.TryVec3(raw, out var v)) at = v;
                return new Target { Kind = TargetKind.Frame, Frame = J.Str(d, "frame"), At = at };
            }
            if (J.Has(d, "user")) return new Target { Kind = TargetKind.User, User = J.Str(d, "user") };
            return null;
        }
    }

    public sealed class Offset
    {
        public string Frame = "user";
        public Vec3 At;
        public double? Yaw;

        public static Offset FromPlain(Dictionary<string, object> d)
        {
            if (d == null) return null;
            return new Offset { Frame = J.Str(d, "frame", "user"), At = J.V3(d, "at", Vec3.Zero), Yaw = J.NumOrNull(d, "yaw") };
        }
    }

    // ========================================
    // 置き方
    // ========================================

    public sealed class Placement
    {
        /// <summary>world / body / head / hand</summary>
        public string Mode = "world";
        public EntityQuery On;
        public Target Near;
        public Offset At;
        public double[] Distance;
        public double[] Height;
        /// <summary>user / away / surface / keep</summary>
        public string Facing = "user";
        /// <summary>視界の半角 (度)。null = 見なくてよい</summary>
        public double? Visible;
        public double[] Clearance;
        public List<string> Avoid;
        /// <summary>closest / farthest / largest / center / inView</summary>
        public string Prefer = "closest";
        public double[] Around;
        public List<Placement> Fallback = new List<Placement>();
        /// <summary>none / session / forever</summary>
        public string Keep = "session";

        public static Placement FromPlain(Dictionary<string, object> d)
        {
            if (d == null) return new Placement();
            var p = new Placement
            {
                Mode = J.Str(d, "mode", "world"),
                On = EntityQuery.FromPlain(J.Obj(d, "on")),
                Near = Target.FromPlain(J.Obj(d, "near")),
                At = Offset.FromPlain(J.Obj(d, "at")),
                Distance = J.Range(d, "distance"),
                Height = J.Range(d, "height"),
                Facing = J.Str(d, "facing", "user"),
                Clearance = J.Range(d, "clearance"),
                Avoid = J.Strings(d, "avoid"),
                Prefer = J.Str(d, "prefer", "closest"),
                Around = J.Range(d, "around"),
                Keep = J.Str(d, "keep", "session"),
            };
            if (d.TryGetValue("visible", out var vis) && vis != null)
            {
                if (vis is bool b) p.Visible = b ? PlacementSolver.DefaultViewHalfAngle : (double?)null;
                else p.Visible = J.ToNum(vis);
            }
            var fb = J.List(d, "fallback");
            if (fb != null) foreach (var f in fb) if (f is Dictionary<string, object> fd) p.Fallback.Add(FromPlain(fd));
            return p;
        }
    }

    // ========================================
    // 物・Mind・体・規則・記録
    // ========================================

    public sealed class ThingDef
    {
        public string Id;
        public string Name;
        /// <summary>shape / model / character / panel / label / marker</summary>
        public string Kind;
        /// <summary>scenes.json の物の id (= thing の id)</summary>
        public string Object;
        public Vec3 Size;
        public Placement Place;
        public bool VisibleAtStart = true;
        public string Occlusion = "auto";
        public bool Grabbable;
        public double ModelHeight;
        public double CharacterHeight = 1.5;
        public string LayoutId;
        /// <summary>パネルの項目 id → bindingId</summary>
        public Dictionary<string, string> Bindings = new Dictionary<string, string>();
        public Dictionary<string, object> Raw;

        public bool IsCanvas => Kind == "panel" || Kind == "label";

        public static ThingDef FromPlain(Dictionary<string, object> d)
        {
            var t = new ThingDef
            {
                Id = J.Str(d, "id"),
                Name = J.Str(d, "name"),
                Kind = J.Str(d, "kind", "marker"),
                Size = J.V3(d, "size", new Vec3(0.1, 0.1, 0.1)),
                Place = Placement.FromPlain(J.Obj(d, "place")),
                VisibleAtStart = J.Bool(d, "visibleAtStart", true),
                Occlusion = J.Str(d, "occlusion", "auto"),
                Grabbable = J.Bool(d, "grabbable", false),
                Raw = d,
            };
            t.Object = J.Str(d, "object", t.Id);
            t.Name = t.Name ?? t.Id;
            var model = J.Obj(d, "model");
            if (model != null) t.ModelHeight = J.Num(model, "height", 0);
            var character = J.Obj(d, "character");
            if (character != null) t.CharacterHeight = J.Num(character, "height", 1.5);
            var panel = J.Obj(d, "panel");
            if (panel != null)
            {
                t.LayoutId = J.Str(panel, "layoutId");
                var b = J.Obj(panel, "bindings");
                if (b != null) foreach (var pair in b) if (pair.Value is string s) t.Bindings[pair.Key] = s;
            }
            return t;
        }
    }

    public sealed class MindDef
    {
        public string Id;
        public string Role = "decide";
        public string Where = "edge";
        /// <summary>layster / openai-chat</summary>
        public string Protocol = "openai-chat";
        public string Endpoint;
        public string Model;
        /// <summary>解決済みの鍵 (header と value)。無ければ null</summary>
        public string AuthHeader;
        public string AuthValue;
        public string Instructions;
        public Dictionary<string, object> Observe = new Dictionary<string, object>();
        public List<string> OutputActions = new List<string>();
        public bool OutputBeliefs;
        public string OutputText;
        /// <summary>interval / change / event / manual</summary>
        public string RunOn = "manual";
        public double EveryMs;
        public string RunEvent;
        public double MinGapMs = 1000;
        public double TimeoutMs = 10000;
        public Dictionary<string, object> Extra;
        public string OnFailUse;
        public string OnFailSay;
        public Dictionary<string, object> Raw;

        public static MindDef FromPlain(Dictionary<string, object> d)
        {
            var m = new MindDef
            {
                Id = J.Str(d, "id"),
                Role = J.Str(d, "role", "decide"),
                Where = J.Str(d, "where", "edge"),
                Protocol = J.Str(d, "protocol", "openai-chat"),
                Endpoint = J.Str(d, "endpoint", ""),
                Model = J.Str(d, "model"),
                Instructions = J.Str(d, "instructions", ""),
                Observe = J.Obj(d, "observe") ?? new Dictionary<string, object>(),
                Extra = J.Obj(d, "extra"),
                Raw = d,
            };
            var auth = J.Obj(d, "auth");
            if (auth != null && J.Has(auth, "value"))
            {
                m.AuthHeader = J.Str(auth, "header", "Authorization");
                m.AuthValue = J.Str(auth, "value");
            }
            var output = J.Obj(d, "output");
            if (output != null)
            {
                m.OutputActions = J.Strings(output, "actions") ?? new List<string>();
                m.OutputBeliefs = J.Bool(output, "beliefs", false);
                m.OutputText = J.Str(output, "text");
            }
            var run = J.Obj(d, "run");
            if (run != null)
            {
                m.RunOn = J.Str(run, "on", "manual");
                m.EveryMs = J.Num(run, "everyMs", 0);
                m.RunEvent = J.Str(run, "event");
                m.MinGapMs = J.Num(run, "minGapMs", 1000);
                m.TimeoutMs = J.Num(run, "timeoutMs", 10000);
            }
            var onFail = J.Obj(d, "onFail");
            if (onFail != null)
            {
                m.OnFailUse = J.Str(onFail, "use");
                m.OnFailSay = J.Str(onFail, "say");
            }
            return m;
        }
    }

    public sealed class BodyCommandDef
    {
        public string Name;
        public string Description;
        /// <summary>引数の名前 → number / string / boolean / pose / target</summary>
        public Dictionary<string, string> Args = new Dictionary<string, string>();
        public string Confirm = "never";
        public string RosTopic;
        public string RosType;
    }

    public sealed class BodyDef
    {
        public string Id;
        public string Kind = "arm";
        /// <summary>layster-body / rosbridge</summary>
        public string Protocol = "layster-body";
        public string Url;
        public string BaseThing;
        public Vec3 WorkspaceCenter;
        public Vec3 WorkspaceSize = new Vec3(0.5, 0.4, 0.4);
        public List<BodyCommandDef> Commands = new List<BodyCommandDef>();
        public double StopIfHandWithin = 0.25;
        public double MaxPerSecond = 2;
        public bool ShowWorkspace;
        public string Store;

        public BodyCommandDef Command(string name)
        {
            foreach (var c in Commands) if (c.Name == name) return c;
            return null;
        }

        public static BodyDef FromPlain(Dictionary<string, object> d)
        {
            var b = new BodyDef { Id = J.Str(d, "id"), Kind = J.Str(d, "kind", "arm") };
            var link = J.Obj(d, "link");
            b.Protocol = J.Str(link, "protocol", "layster-body");
            b.Url = J.Str(link, "url", "");
            b.BaseThing = J.Str(J.Obj(d, "base"), "thing");
            var ws = J.Obj(d, "workspace");
            b.WorkspaceCenter = J.V3(ws, "center", Vec3.Zero);
            b.WorkspaceSize = J.V3(ws, "size", b.WorkspaceSize);
            var safety = J.Obj(d, "safety");
            b.StopIfHandWithin = J.Num(safety, "stopIfHandWithin", 0.25);
            b.MaxPerSecond = J.Num(safety, "maxPerSecond", 2);
            b.ShowWorkspace = J.Bool(J.Obj(d, "twin"), "showWorkspace", false);
            b.Store = J.Str(d, "store", "body." + b.Id);
            var commands = J.List(d, "commands");
            if (commands != null)
            {
                foreach (var raw in commands)
                {
                    var c = J.Obj(raw);
                    if (c == null) continue;
                    var cmd = new BodyCommandDef
                    {
                        Name = J.Str(c, "name"),
                        Description = J.Str(c, "description"),
                        Confirm = J.Str(c, "confirm", "never"),
                    };
                    var args = J.Obj(c, "args");
                    if (args != null) foreach (var pair in args) cmd.Args[pair.Key] = Convert.ToString(pair.Value, CultureInfo.InvariantCulture);
                    var ros = J.Obj(c, "ros");
                    if (ros != null) { cmd.RosTopic = J.Str(ros, "topic"); cmd.RosType = J.Str(ros, "type"); }
                    if (!string.IsNullOrEmpty(cmd.Name)) b.Commands.Add(cmd);
                }
            }
            return b;
        }
    }

    public sealed class RuleDef
    {
        public string Id;
        public Dictionary<string, object> When;
        public List<Dictionary<string, object>> If = new List<Dictionary<string, object>>();
        public List<Dictionary<string, object>> Do = new List<Dictionary<string, object>>();
        public double CooldownMs;
        public bool Enabled = true;

        public static RuleDef FromPlain(Dictionary<string, object> d)
        {
            var r = new RuleDef
            {
                Id = J.Str(d, "id"),
                When = J.Obj(d, "when") ?? new Dictionary<string, object>(),
                CooldownMs = J.Num(d, "cooldownMs", 0),
                Enabled = J.Bool(d, "enabled", true),
            };
            var conds = J.List(d, "if");
            if (conds != null) foreach (var c in conds) if (c is Dictionary<string, object> cd) r.If.Add(cd);
            var actions = J.List(d, "do");
            if (actions != null) foreach (var a in actions) if (a is Dictionary<string, object> ad) r.Do.Add(ad);
            return r;
        }
    }

    public sealed class RecordingDef
    {
        public bool Enabled;
        public List<string> Streams = new List<string>();
        public double Hz = 10;
        public int CameraWidth;
        public double CameraEveryMs;
        public double MaxMinutes;
        public string ConsentText = "";
        public string SendUrl;

        public bool Has(string stream) => Streams.Contains(stream);

        public static RecordingDef FromPlain(Dictionary<string, object> d)
        {
            var r = new RecordingDef();
            if (d == null) return r;
            r.Enabled = J.Bool(d, "enabled", false);
            r.Streams = J.Strings(d, "streams") ?? new List<string>();
            r.Hz = J.Num(d, "hz", 10);
            var cam = J.Obj(d, "camera");
            if (cam != null) { r.CameraWidth = (int)J.Num(cam, "width", 320); r.CameraEveryMs = J.Num(cam, "everyMs", 1000); }
            else if (r.Has("camera")) { r.CameraWidth = 320; r.CameraEveryMs = 1000; }
            r.MaxMinutes = J.Num(d, "maxMinutes", 0);
            r.ConsentText = J.Str(J.Obj(d, "consent"), "text", "");
            r.SendUrl = J.Str(J.Obj(d, "send"), "url");
            return r;
        }
    }

    /// <summary>spatial.json 全体。</summary>
    public sealed class SpatialModel
    {
        public const string Format = "layster.spatial.runtime/1";

        public string Name = "";
        public string LaysterVersion = "";
        public string Edge = "";
        public string Reality = "passthrough";
        public double AssumedEyeHeight = 1.5;
        /// <summary>reality が virtual-room のときの仮の部屋の色 (src/shared/layster/spatial/virtualRoom.ts)。無ければ null</summary>
        public Dictionary<string, object> VirtualRoom;
        public bool Controllers = true;
        public bool Hands = true;
        public Vocabulary Vocabulary = new Vocabulary();
        public List<ThingDef> Things = new List<ThingDef>();
        public List<MindDef> Minds = new List<MindDef>();
        public List<BodyDef> Bodies = new List<BodyDef>();
        public List<RuleDef> Rules = new List<RuleDef>();
        public RecordingDef Recording = new RecordingDef();
        public List<string> Persist = new List<string>();
        public List<string> Warnings = new List<string>();

        public ThingDef Thing(string id)
        {
            foreach (var t in Things) if (t.Id == id) return t;
            return null;
        }

        public MindDef Mind(string id)
        {
            foreach (var m in Minds) if (m.Id == id) return m;
            return null;
        }

        public BodyDef Body(string id)
        {
            foreach (var b in Bodies) if (b.Id == id) return b;
            return null;
        }

        public static SpatialModel Parse(string json)
        {
            var root = MiniJson.ParseObject(json);
            var model = new SpatialModel();
            var format = J.Str(root, "format", "");
            if (format != Format) model.Warnings.Add($"spatial.json format is '{format}', this runtime reads '{Format}'");
            var header = J.Obj(root, "layster");
            model.LaysterVersion = $"{J.Str(header, "stage", "beta")} {J.Str(header, "version", "?")}";
            model.Name = J.Str(root, "name", "");
            model.Edge = J.Str(root, "edge", "");
            var presentation = J.Obj(root, "presentation");
            model.Reality = J.Str(presentation, "reality", "passthrough");
            model.AssumedEyeHeight = J.Num(presentation, "assumedEyeHeight", 1.5);
            model.VirtualRoom = J.Obj(root, "virtualRoom");
            var interaction = J.Obj(root, "interaction");
            model.Controllers = J.Bool(interaction, "controllers", true);
            model.Hands = J.Bool(interaction, "hands", true);
            model.Vocabulary = Vocabulary.FromPlain(J.List(root, "vocabulary"));
            foreach (var raw in J.List(root, "things") ?? new List<object>())
                if (raw is Dictionary<string, object> d && J.Has(d, "id")) model.Things.Add(ThingDef.FromPlain(d));
            foreach (var raw in J.List(root, "minds") ?? new List<object>())
                if (raw is Dictionary<string, object> d && J.Has(d, "id")) model.Minds.Add(MindDef.FromPlain(d));
            foreach (var raw in J.List(root, "bodies") ?? new List<object>())
                if (raw is Dictionary<string, object> d && J.Has(d, "id")) model.Bodies.Add(BodyDef.FromPlain(d));
            foreach (var raw in J.List(root, "rules") ?? new List<object>())
                if (raw is Dictionary<string, object> d && J.Has(d, "id")) model.Rules.Add(RuleDef.FromPlain(d));
            model.Recording = RecordingDef.FromPlain(J.Obj(root, "recording"));
            model.Persist = J.Strings(J.Obj(root, "memory"), "persist") ?? new List<string>();
            return model;
        }
    }
}
