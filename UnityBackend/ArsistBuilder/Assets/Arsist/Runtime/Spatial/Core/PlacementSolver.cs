// ==============================================
// Arsist Engine - Layster.Spatial core: 置き方を解く
// Assets/Arsist/Runtime/Spatial/Core/PlacementSolver.cs
//
// src/shared/layster/spatial/solver.ts の写し。同じ表 (solver-cases.json) を
// tools/perception-check の SpatialChecks が解いて、TS と同じ答えになることを確かめている。
// 片方だけ直すと、エディタの Space Lab で見た置き場所と実機の置き場所がずれる。
// 写すときの約束 (solver.ts の頭と同じ):
//   - 候補を作る順番を固定し、同点は先の候補 (score < best - EPS のときだけ入れ替える)
//   - 出力は Round3 で丸める
//   - 浮動小数の足し込み (for (r = a; r <= b + EPS; r += step)) も TS と同じ形で書く
// ==============================================

using System;
using System.Collections.Generic;
using System.Text;

namespace Arsist.Runtime.Spatial.Core
{
    public sealed class SolveUser
    {
        /// <summary>足元 (world)</summary>
        public Vec3 At;
        /// <summary>頭の水平の向き (度)</summary>
        public double Yaw;
        /// <summary>足元から目までの高さ (m)</summary>
        public double EyeHeight = 1.6;
    }

    public sealed class PlacedThing
    {
        public SpatialPose Pose;
        public Vec3 Size;
    }

    public sealed class SolveWorld
    {
        public List<Entity> Entities = new List<Entity>();
        public SolveUser User = new SolveUser();
        /// <summary>もう置いた物 (挿入順 = TS の Object.entries の順)</summary>
        public List<KeyValuePair<string, PlacedThing>> Things = new List<KeyValuePair<string, PlacedThing>>();
        public Vec3? LeftHand;
        public Vec3? RightHand;

        public PlacedThing Thing(string id)
        {
            foreach (var pair in Things) if (pair.Key == id) return pair.Value;
            return null;
        }

        public void SetThing(string id, PlacedThing placed)
        {
            for (int i = 0; i < Things.Count; i++)
            {
                if (Things[i].Key != id) continue;
                Things[i] = new KeyValuePair<string, PlacedThing>(id, placed);
                return;
            }
            Things.Add(new KeyValuePair<string, PlacedThing>(id, placed));
        }

        public void RemoveThing(string id)
        {
            for (int i = Things.Count - 1; i >= 0; i--) if (Things[i].Key == id) Things.RemoveAt(i);
        }

        public Vec3 Head => new Vec3(User.At.X, User.At.Y + User.EyeHeight, User.At.Z);
    }

    public sealed class SolveResult
    {
        public string Thing;
        public string Mode = "world";
        /// <summary>pose の frame。world / body は "world"、それ以外は head / hand.left / hand.right</summary>
        public string Frame = "world";
        public SpatialPose Pose;
        /// <summary>0 = 本来の置き方、1.. = fallback、-1 = default (どれでも置けなかった)</summary>
        public int Rule;
        public string Host;
        public List<string> Notes = new List<string>();

        public bool IsDefault => Rule < 0;
        public object RuleValue => Rule < 0 ? (object)"default" : (double)Rule;
    }

    public sealed class PlacementSolver
    {
        public const double DefaultViewHalfAngle = 35;
        public const double AvoidGap = 0.3;
        private const double GridStep = 0.1;
        private const double RingStep = 0.15;
        private const int MaxCandidatesPerHost = 400;
        private static readonly double[] DefaultFloorRange = { 0.6, 2.5 };
        private static readonly double[] DefaultAround = { 0.3, 1.0 };
        private const double Eps = SpatialMath.Eps;

        private readonly Vocabulary _vocab;

        public PlacementSolver(Vocabulary vocabulary)
        {
            _vocab = vocabulary ?? new Vocabulary();
        }

        // ========================================
        // 物の大きさ
        // ========================================

        /// <summary>thingSize (solver.ts) の写し。spatial.json には書き出し済みなので、ランタイムでは通常使わない。</summary>
        public static Vec3 ThingSize(Dictionary<string, object> visual)
        {
            var kind = J.Str(visual, "kind", "marker");
            switch (kind)
            {
                case "shape": return J.V3(visual, "size", new Vec3(0.1, 0.1, 0.1));
                case "panel":
                {
                    var r = J.Range(visual, "size") ?? new[] { 0.4, 0.25 };
                    return new Vec3(r[0], r[1], 0.01);
                }
                case "label":
                {
                    double h = J.Num(visual, "height", 0.04);
                    var text = J.Str(visual, "text", "");
                    return new Vec3(Math.Max(h, text.Length * h * 0.6), h, 0.01);
                }
                case "character":
                {
                    double h = J.Num(visual, "height", 1.5);
                    return new Vec3(h * 0.3, h, h * 0.2);
                }
                case "model":
                {
                    double h = J.Num(visual, "height", 0.3);
                    return new Vec3(h, h, h);
                }
                default: return new Vec3(0.05, 0.05, 0.05);
            }
        }

        // ========================================
        // frame と target
        // ========================================

        public static bool FramePose(string frame, SolveWorld world, out Vec3 origin, out double yaw)
        {
            origin = Vec3.Zero; yaw = 0;
            switch (frame)
            {
                case "world": return true;
                case "user": origin = world.User.At; yaw = world.User.Yaw; return true;
                case "head": origin = world.Head; yaw = world.User.Yaw; return true;
                case "hand.left":
                    if (world.LeftHand == null) return false;
                    origin = world.LeftHand.Value; yaw = world.User.Yaw; return true;
                case "hand.right":
                    if (world.RightHand == null) return false;
                    origin = world.RightHand.Value; yaw = world.User.Yaw; return true;
            }
            if (frame != null && frame.StartsWith("thing:", StringComparison.Ordinal))
            {
                var t = world.Thing(frame.Substring(6));
                if (t == null) return false;
                origin = t.Pose.At; yaw = t.Pose.Yaw; return true;
            }
            if (frame != null && frame.StartsWith("entity:", StringComparison.Ordinal))
            {
                var id = frame.Substring(7);
                foreach (var e in world.Entities)
                {
                    if (e.Id != id) continue;
                    origin = e.At; yaw = e.Yaw; return true;
                }
                return false;
            }
            return false; // body:<id> はランタイムが thing の姿勢に直してから渡す
        }

        public static bool OffsetToWorld(Offset offset, SolveWorld world, out SpatialPose pose)
        {
            pose = default;
            if (offset == null || !FramePose(offset.Frame, world, out var origin, out var fyaw)) return false;
            SpatialMath.Rotate(offset.At.X, offset.At.Z, fyaw, out var x, out var z);
            pose = new SpatialPose(new Vec3(origin.X + x, origin.Y + offset.At.Y, origin.Z + z), SpatialMath.NormYaw(fyaw + (offset.Yaw ?? 0)));
            return true;
        }

        public List<Entity> FindEntities(EntityQuery query, SolveWorld world)
        {
            var result = new List<Entity>();
            foreach (var e in world.Entities)
            {
                if (!_vocab.MatchesWords(e, query)) continue;
                if (query.Within.HasValue && SpatialMath.HorizontalDistance(e.At, world.User.At) > query.Within.Value) continue;
                if (query.MinSize != null)
                {
                    bool vertical = _vocab.IsVertical(e);
                    double a = e.Size.X;
                    double b = vertical ? e.Size.Y : e.Size.Z;
                    if (a < query.MinSize[0] || b < query.MinSize[1]) continue;
                }
                result.Add(e);
            }
            return result;
        }

        public bool TargetPoint(Target target, SolveWorld world, out Vec3 point)
        {
            point = Vec3.Zero;
            if (target == null) return false;
            switch (target.Kind)
            {
                case TargetKind.Thing:
                {
                    var t = world.Thing(target.Thing);
                    if (t == null) return false;
                    point = t.Pose.At; return true;
                }
                case TargetKind.Entity:
                {
                    Entity best = null;
                    double bestD = double.PositiveInfinity;
                    foreach (var e in FindEntities(target.Entity ?? new EntityQuery(), world))
                    {
                        double d = SpatialMath.HorizontalDistance(e.At, world.User.At);
                        if (d < bestD - Eps) { best = e; bestD = d; }
                    }
                    if (best == null) return false;
                    point = best.At; return true;
                }
                case TargetKind.Frame:
                {
                    var off = new Offset { Frame = target.Frame, At = target.At ?? Vec3.Zero };
                    if (!OffsetToWorld(off, world, out var pose)) return false;
                    point = pose.At; return true;
                }
                case TargetKind.User:
                    switch (target.User)
                    {
                        case "head": point = world.Head; return true;
                        case "feet": point = world.User.At; return true;
                        case "hand.left": if (world.LeftHand == null) return false; point = world.LeftHand.Value; return true;
                        case "hand.right": if (world.RightHand == null) return false; point = world.RightHand.Value; return true;
                    }
                    return false;
            }
            return false;
        }

        // ========================================
        // 候補
        // ========================================

        private sealed class Candidate
        {
            public Vec3 At;
            public double? SurfaceYaw;
            public Entity Host;
        }

        private static List<double> Span(double half, double step)
        {
            var output = new List<double>();
            if (half <= Eps) { output.Add(0); return output; }
            int n = (int)Math.Floor((2 * half) / step + Eps);
            double used = n * step;
            for (int i = 0; i <= n; i++) output.Add(-used / 2 + i * step);
            return output;
        }

        private static double GridStepFor(double a, double b)
        {
            double count = (Math.Floor(a / GridStep + Eps) + 1) * (Math.Floor(b / GridStep + Eps) + 1);
            if (count <= MaxCandidatesPerHost) return GridStep;
            return Math.Max(GridStep, Math.Sqrt((a * b) / MaxCandidatesPerHost) + 0.01);
        }

        private static readonly double[] RingAngles = BuildRingAngles();

        private static double[] BuildRingAngles()
        {
            var output = new List<double> { 0 };
            for (int a = 15; a < 180; a += 15) { output.Add(a); output.Add(-a); }
            output.Add(180);
            return output.ToArray();
        }

        private static double TopOf(Entity e) => e.At.Y + e.Size.Y / 2;

        private List<Candidate> HostCandidates(Entity host, Vec3 size, Placement place, SolveWorld world)
        {
            var output = new List<Candidate>();
            double yaw = host.Yaw;
            if (_vocab.IsVertical(host))
            {
                double halfW = host.Size.X / 2 - size.X / 2;
                double halfH = host.Size.Y / 2 - size.Y / 2;
                if (halfW < -Eps || halfH < -Eps) return output;
                double step = GridStepFor(Math.Max(0, halfW) * 2, Math.Max(0, halfH) * 2);
                var xs = Span(Math.Max(0, halfW), step);
                var ys = Span(Math.Max(0, halfH), step);
                double push = host.Size.Z / 2 + size.Z / 2 + 0.01;
                foreach (var ly in ys)
                {
                    foreach (var lx in xs)
                    {
                        SpatialMath.Rotate(lx, push, yaw, out var wx, out var wz);
                        output.Add(new Candidate { At = new Vec3(host.At.X + wx, host.At.Y + ly, host.At.Z + wz), SurfaceYaw = SpatialMath.NormYaw(yaw), Host = host });
                    }
                }
                return output;
            }

            double top = TopOf(host);
            double cy = top + size.Y / 2;
            var affordances = _vocab.AffordancesOf(host);
            if (affordances.Contains("walk") && _vocab.IsStructural(host))
            {
                var range = place.Distance ?? DefaultFloorRange;
                int rings = Math.Max(1, MaxCandidatesPerHost / RingAngles.Length);
                double step = Math.Max(RingStep, (range[1] - range[0]) / Math.Max(1, rings - 1));
                for (int i = 0; range[0] + i * step <= range[1] + Eps; i++)
                {
                    double r = range[0] + i * step;
                    foreach (var a in RingAngles)
                    {
                        SpatialMath.Rotate(0, r, world.User.Yaw + a, out var dx, out var dz);
                        double x = world.User.At.X + dx;
                        double z = world.User.At.Z + dz;
                        SpatialMath.ToLocal(host.At, host.Yaw, x, z, out var lx, out var lz);
                        if (Math.Abs(lx) > host.Size.X / 2 || Math.Abs(lz) > host.Size.Z / 2) continue;
                        output.Add(new Candidate { At = new Vec3(x, cy, z), Host = host });
                    }
                }
                return output;
            }

            double rr = Math.Max(size.X, size.Z) / 2;
            double cw = place.Clearance != null ? place.Clearance[0] / 2 : 0;
            double cd = place.Clearance != null ? place.Clearance[1] / 2 : 0;
            double halfX = host.Size.X / 2 - Math.Max(rr, cw);
            double halfZ = host.Size.Z / 2 - Math.Max(rr, cd);
            if (halfX < -Eps || halfZ < -Eps) return output;
            double gstep = GridStepFor(Math.Max(0, halfX) * 2, Math.Max(0, halfZ) * 2);
            foreach (var lz in Span(Math.Max(0, halfZ), gstep))
            {
                foreach (var lx in Span(Math.Max(0, halfX), gstep))
                {
                    SpatialMath.Rotate(lx, lz, yaw, out var wx, out var wz);
                    output.Add(new Candidate { At = new Vec3(host.At.X + wx, cy, host.At.Z + wz), Host = host });
                }
            }
            return output;
        }

        private static List<Candidate> NearCandidates(Vec3 point, Vec3 size, Placement place, SolveWorld world, bool targetIsHead)
        {
            var output = new List<Candidate>();
            var around = place.Around ?? DefaultAround;
            double cy;
            if (place.Height != null) cy = (place.Height[0] + place.Height[1]) / 2 + size.Y / 2;
            else if (size.Y >= 1.0) cy = size.Y / 2;
            else if (targetIsHead) cy = point.Y - 0.15;
            else cy = point.Y;
            double toUser = SpatialMath.HorizontalDistance(point, world.User.At) > 0.05
                ? SpatialMath.YawToward(world.User.At.X - point.X, world.User.At.Z - point.Z)
                : world.User.Yaw;
            for (double r = around[0]; r <= around[1] + Eps; r += GridStep)
            {
                foreach (var a in RingAngles)
                {
                    SpatialMath.Rotate(0, r, toUser + a, out var dx, out var dz);
                    output.Add(new Candidate { At = new Vec3(point.X + dx, cy, point.Z + dz) });
                }
            }
            return output;
        }

        // ========================================
        // 条件
        // ========================================

        private static double FacingYaw(string facing, Candidate c, SolveWorld world, double keepYaw)
        {
            if (c.SurfaceYaw.HasValue) return c.SurfaceYaw.Value;
            double toUser = SpatialMath.YawToward(world.User.At.X - c.At.X, world.User.At.Z - c.At.Z);
            switch (facing)
            {
                case "away": return SpatialMath.NormYaw(toUser + 180);
                case "keep": return SpatialMath.NormYaw(keepYaw);
                case "surface":
                {
                    if (c.Host == null) return SpatialMath.NormYaw(toUser);
                    double baseYaw = c.Host.Yaw;
                    double best = baseYaw;
                    double bestDiff = double.PositiveInfinity;
                    for (int k = 0; k < 4; k++)
                    {
                        double y = baseYaw + k * 90;
                        double diff = Math.Abs(SpatialMath.NormYaw(y - toUser));
                        if (diff < bestDiff - Eps) { best = y; bestDiff = diff; }
                    }
                    return SpatialMath.NormYaw(best);
                }
                default: return SpatialMath.NormYaw(toUser);
            }
        }

        private bool IsBehindWall(Vec3 at, Vec3 size, double yaw, SolveWorld world)
        {
            foreach (var e in world.Entities)
            {
                if (!_vocab.IsStructural(e) || !_vocab.IsVertical(e)) continue;
                SpatialMath.ToLocal(e.At, e.Yaw, at.X, at.Z, out var lx, out var lz);
                if (Math.Abs(lx) > e.Size.X / 2) continue;
                if (at.Y < e.At.Y - e.Size.Y / 2 || at.Y > e.At.Y + e.Size.Y / 2) continue;
                double d = (yaw - e.Yaw) * SpatialMath.Deg;
                double reach = Math.Abs((size.X / 2) * Math.Sin(d)) + Math.Abs((size.Z / 2) * Math.Cos(d));
                if (lz - reach < -0.02) return true;
            }
            return false;
        }

        private List<Aabb> AvoidBoxes(List<string> names, SolveWorld world, string self)
        {
            var output = new List<Aabb>();
            foreach (var name in names)
            {
                var t = world.Thing(name);
                if (t != null && name != self) { output.Add(SpatialMath.AabbOf(t.Pose.At, t.Size, t.Pose.Yaw)); continue; }
                foreach (var e in FindEntities(EntityQuery.Words(name), world)) output.Add(SpatialMath.AabbOf(e.At, e.Size, e.Yaw));
            }
            return output;
        }

        private string CheckCandidate(string thing, Candidate c, double yaw, Vec3 size, Placement place, SolveWorld world)
        {
            var head = world.Head;
            if (place.Distance != null)
            {
                double d = SpatialMath.HorizontalDistance(c.At, world.User.At);
                if (d < place.Distance[0] - Eps || d > place.Distance[1] + Eps) return "distance";
            }
            double bottom = c.At.Y - size.Y / 2;
            if (place.Height != null)
            {
                if (bottom < place.Height[0] - Eps || bottom > place.Height[1] + Eps) return "height";
            }
            if (place.Visible.HasValue)
            {
                double half = place.Visible.Value;
                double toward = SpatialMath.YawToward(c.At.X - head.X, c.At.Z - head.Z);
                if (Math.Abs(SpatialMath.NormYaw(toward - world.User.Yaw)) > half + Eps) return "visible";
            }
            if (IsBehindWall(c.At, size, yaw, world)) return "wall";

            var box = SpatialMath.AabbOf(c.At, size, yaw);
            var front = box;
            if (c.SurfaceYaw.HasValue)
            {
                SpatialMath.Rotate(0, 0.05, yaw, out var fx, out var fz);
                front = SpatialMath.AabbOf(new Vec3(c.At.X + fx, c.At.Y, c.At.Z + fz), new Vec3(size.X, size.Y, size.Z + 0.1), yaw);
            }
            if (bottom < 0.05)
            {
                bool anyFloor = false, onFloor = false;
                foreach (var f in world.Entities)
                {
                    if (!_vocab.IsStructural(f) || !_vocab.AffordancesOf(f).Contains("walk")) continue;
                    anyFloor = true;
                    SpatialMath.ToLocal(f.At, f.Yaw, c.At.X, c.At.Z, out var lx, out var lz);
                    if (Math.Abs(lx) <= f.Size.X / 2 && Math.Abs(lz) <= f.Size.Z / 2) { onFloor = true; break; }
                }
                if (anyFloor && !onFloor) return "floor";
            }
            foreach (var e in world.Entities)
            {
                if (ReferenceEquals(e, c.Host) || _vocab.IsStructural(e)) continue;
                if (SpatialMath.Overlaps(front, SpatialMath.AabbOf(e.At, e.Size, e.Yaw))) return "collision";
            }
            foreach (var pair in world.Things)
            {
                if (pair.Key == thing) continue;
                var t = pair.Value;
                if (SpatialMath.Overlaps(front, SpatialMath.AabbOf(t.Pose.At, t.Size, t.Pose.Yaw))) return "collision";
            }
            if (place.Clearance != null && c.Host != null && !_vocab.IsVertical(c.Host))
            {
                SpatialMath.ToLocal(c.Host.At, c.Host.Yaw, c.At.X, c.At.Z, out var lx, out var lz);
                if (Math.Abs(lx) > c.Host.Size.X / 2 - place.Clearance[0] / 2 + Eps
                    || Math.Abs(lz) > c.Host.Size.Z / 2 - place.Clearance[1] / 2 + Eps) return "clearance";
                double top = TopOf(c.Host);
                var area = SpatialMath.AabbOf(new Vec3(c.At.X, top + 0.15, c.At.Z), new Vec3(place.Clearance[0], 0.3, place.Clearance[1]), c.Host.Yaw);
                foreach (var e in world.Entities)
                {
                    if (ReferenceEquals(e, c.Host) || _vocab.IsStructural(e)) continue;
                    if (SpatialMath.Overlaps(area, SpatialMath.AabbOf(e.At, e.Size, e.Yaw))) return "clearance";
                }
            }
            if (place.Avoid != null && place.Avoid.Count > 0)
            {
                foreach (var other in AvoidBoxes(place.Avoid, world, thing))
                    if (SpatialMath.HorizontalGap(box, other) < AvoidGap - Eps) return "avoid";
            }
            return null;
        }

        private double ScoreOf(Placement place, Candidate c, Vec3 reference, SolveWorld world)
        {
            double d = SpatialMath.HorizontalDistance(c.At, reference);
            double score;
            switch (place.Prefer ?? "closest")
            {
                case "farthest": score = -d; break;
                case "largest":
                    score = (c.Host != null ? -(c.Host.Size.X * (_vocab.IsVertical(c.Host) ? c.Host.Size.Y : c.Host.Size.Z)) : 0) + d * 0.01;
                    break;
                case "center":
                    score = c.Host != null
                        ? SpatialMath.HorizontalDistance(c.At, c.Host.At) + Math.Abs(c.At.Y - c.Host.At.Y) * (_vocab.IsVertical(c.Host) ? 1 : 0)
                        : d;
                    break;
                case "inView":
                {
                    var head = world.Head;
                    double angle = Math.Abs(SpatialMath.NormYaw(SpatialMath.YawToward(c.At.X - head.X, c.At.Z - head.Z) - world.User.Yaw));
                    score = angle / 45 + d * 0.1;
                    break;
                }
                default: score = d; break;
            }
            if (c.Host != null && _vocab.IsVertical(c.Host)) score += Math.Abs(c.At.Y - (world.Head.Y - 0.1)) * 0.5;
            return score;
        }

        // ========================================
        // 解く
        // ========================================

        private SolveResult SolveRule(string thing, Vec3 size, Placement place, SolveWorld world, out string note)
        {
            note = null;
            string mode = place.Mode ?? "world";
            string facing = place.Facing ?? "user";

            if (mode == "head" || mode == "hand")
            {
                string frame = mode == "head" ? "head" : (place.At != null && place.At.Frame == "hand.left" ? "hand.left" : "hand.right");
                Vec3 at = place.At != null ? place.At.At : (mode == "head" ? new Vec3(0, -0.1, 1.2) : new Vec3(0, 0.08, 0));
                double yaw = place.At != null && place.At.Yaw.HasValue ? place.At.Yaw.Value
                    : (mode == "head" && facing == "user" ? SpatialMath.NormYaw(SpatialMath.YawToward(-at.X, -at.Z)) : 0);
                return new SolveResult { Mode = mode, Frame = frame, Pose = new SpatialPose(at, yaw) };
            }

            var candidates = new List<Candidate>();
            Vec3 reference = world.User.At;
            bool hasAtPose = false;
            SpatialPose atPose = default;

            if (place.Near != null)
            {
                if (!TargetPoint(place.Near, world, out var point)) { note = "near: the target is not known here"; return null; }
                reference = point;
                if (place.On == null)
                {
                    bool targetIsHead = place.Near.Kind == TargetKind.User && place.Near.User == "head";
                    candidates = NearCandidates(point, size, place, world, targetIsHead);
                }
            }
            if (place.On != null)
            {
                var hosts = FindEntities(place.On, world);
                if (hosts.Count == 0) { note = "on: nothing matches"; return null; }
                foreach (var host in hosts) candidates.AddRange(HostCandidates(host, size, place, world));
                if (candidates.Count == 0) { note = "on: the matching surfaces are too small"; return null; }
            }
            if (place.On == null && place.Near == null)
            {
                if (place.At == null) { note = "nothing to place against (no on / near / at)"; return null; }
                if (!OffsetToWorld(place.At, world, out atPose)) { note = $"at: frame {place.At.Frame} is not known here"; return null; }
                hasAtPose = true;
                candidates.Add(new Candidate { At = atPose.At });
            }

            Candidate best = null;
            double bestYaw = 0, bestScore = 0;
            var reasons = new List<KeyValuePair<string, int>>();
            double keepYaw = hasAtPose ? atPose.Yaw : world.User.Yaw;
            foreach (var c in candidates)
            {
                double yaw = hasAtPose && place.At.Yaw.HasValue ? atPose.Yaw : FacingYaw(facing, c, world, keepYaw);
                var why = CheckCandidate(thing, c, yaw, size, place, world);
                if (why != null)
                {
                    int idx = reasons.FindIndex(p => p.Key == why);
                    if (idx < 0) reasons.Add(new KeyValuePair<string, int>(why, 1));
                    else reasons[idx] = new KeyValuePair<string, int>(why, reasons[idx].Value + 1);
                    continue;
                }
                double score = ScoreOf(place, c, reference, world);
                if (best == null || score < bestScore - Eps) { best = c; bestYaw = yaw; bestScore = score; }
            }
            if (best == null)
            {
                var sb = new StringBuilder();
                foreach (var pair in reasons)
                {
                    if (sb.Length > 0) sb.Append(", ");
                    sb.Append(pair.Key).Append(" ×").Append(pair.Value);
                }
                note = $"{candidates.Count} spots, none fit ({sb})";
                return null;
            }
            return new SolveResult { Mode = mode, Frame = "world", Pose = new SpatialPose(best.At, bestYaw), Host = best.Host?.Id };
        }

        private SolveResult DefaultPlacement(string thing, Vec3 size, SolveWorld world)
        {
            bool tall = size.Y >= 1.0;
            double cy = tall ? size.Y / 2 : world.User.At.Y + world.User.EyeHeight - 0.25;
            SpatialPose? fallback = null;
            foreach (var d in new[] { 1.2, 0.9, 0.6 })
            {
                foreach (var a in new[] { 0.0, -30.0, 30.0 })
                {
                    SpatialMath.Rotate(0, d, world.User.Yaw + a, out var dx, out var dz);
                    var at = new Vec3(world.User.At.X + dx, cy, world.User.At.Z + dz);
                    double yaw = SpatialMath.NormYaw(SpatialMath.YawToward(-dx, -dz));
                    if (fallback == null) fallback = new SpatialPose(at, yaw);
                    if (CheckCandidate(thing, new Candidate { At = at }, yaw, size, new Placement { Facing = "user" }, world) == null)
                        return new SolveResult { Pose = new SpatialPose(at, yaw) };
                }
            }
            SpatialMath.Rotate(0, 0.6, world.User.Yaw, out var fx, out var fz);
            return new SolveResult
            {
                Pose = fallback ?? new SpatialPose(new Vec3(world.User.At.X + fx, cy, world.User.At.Z + fz), SpatialMath.NormYaw(world.User.Yaw + 180)),
            };
        }

        private static SpatialPose RoundPose(SpatialPose pose)
        {
            return new SpatialPose(
                new Vec3(SpatialMath.Round3(pose.At.X), SpatialMath.Round3(pose.At.Y), SpatialMath.Round3(pose.At.Z)),
                SpatialMath.Round3(SpatialMath.NormYaw(pose.Yaw)));
        }

        /// <summary>1 つの物を置く。world.Things には足さない (SolveAll が足す)。</summary>
        public SolveResult Solve(string thing, Vec3 size, Placement place, SolveWorld world)
        {
            var rules = new List<Placement> { place ?? new Placement() };
            if (place?.Fallback != null) rules.AddRange(place.Fallback);
            var notes = new List<string>();
            for (int i = 0; i < rules.Count; i++)
            {
                var result = SolveRule(thing, size, rules[i], world, out var note);
                if (result != null)
                {
                    result.Thing = thing;
                    result.Rule = i;
                    result.Notes = notes;
                    result.Pose = RoundPose(result.Pose);
                    return result;
                }
                notes.Add($"{(i == 0 ? "place" : $"fallback {i}")}: {note}");
            }
            var d = DefaultPlacement(thing, size, world);
            d.Thing = thing;
            d.Rule = -1;
            d.Notes = notes;
            d.Pose = RoundPose(d.Pose);
            return d;
        }

        public static List<string> Dependencies(Placement place)
        {
            var output = new List<string>();
            void Add(string id) { if (!string.IsNullOrEmpty(id) && !output.Contains(id)) output.Add(id); }
            void Visit(Placement p)
            {
                if (p == null) return;
                if (p.Near != null && p.Near.Kind == TargetKind.Thing) Add(p.Near.Thing);
                if (p.Near != null && p.Near.Kind == TargetKind.Frame && p.Near.Frame != null && p.Near.Frame.StartsWith("thing:", StringComparison.Ordinal)) Add(p.Near.Frame.Substring(6));
                if (p.At != null && p.At.Frame != null && p.At.Frame.StartsWith("thing:", StringComparison.Ordinal)) Add(p.At.Frame.Substring(6));
                if (p.Avoid != null) foreach (var a in p.Avoid) Add(a);
                foreach (var f in p.Fallback) Visit(f);
            }
            Visit(place);
            return output;
        }

        /// <summary>置く順番。参照される物を先に。輪になっていたら元の順。</summary>
        public static List<T> Order<T>(List<T> things, Func<T, string> id, Func<T, Placement> place)
        {
            var byId = new Dictionary<string, T>();
            foreach (var t in things) if (!byId.ContainsKey(id(t))) byId[id(t)] = t;
            var done = new HashSet<string>();
            var visiting = new HashSet<string>();
            var order = new List<T>();
            void Visit(T t)
            {
                var key = id(t);
                if (done.Contains(key) || visiting.Contains(key)) return;
                visiting.Add(key);
                foreach (var dep in Dependencies(place(t)))
                    if (byId.TryGetValue(dep, out var d)) Visit(d);
                visiting.Remove(key);
                done.Add(key);
                order.Add(t);
            }
            foreach (var t in things) Visit(t);
            return order;
        }

        /// <summary>
        /// 物をすべて置く (solveAll)。world.Things は書き換えない (写しを使う)。
        /// head / hand に付く物は world に場所を持たないので、他の物の邪魔にならない。
        /// </summary>
        public List<SolveResult> SolveAll(List<ThingDef> things, SolveWorld world)
        {
            var w = new SolveWorld
            {
                Entities = world.Entities,
                User = world.User,
                Things = new List<KeyValuePair<string, PlacedThing>>(world.Things),
                LeftHand = world.LeftHand,
                RightHand = world.RightHand,
            };
            var results = new Dictionary<string, SolveResult>();
            foreach (var t in Order(things, x => x.Id, x => x.Place))
            {
                var r = Solve(t.Id, t.Size, t.Place, w);
                results[t.Id] = r;
                if (r.Frame == "world") w.SetThing(t.Id, new PlacedThing { Pose = r.Pose, Size = t.Size });
            }
            var output = new List<SolveResult>();
            foreach (var t in things) output.Add(results[t.Id]);
            return output;
        }
    }
}
