// ==============================================
// Arsist Engine - Layster.Spatial: 行動を実行する
// Assets/Arsist/Runtime/Spatial/ActionExecutor.cs
//
// 規則・Mind の返事・スクリプト (world.act) は、すべてここを通る (doc/19-layster.md §3.6)。
//   place     置き直す (place の条件か at)
//   move      動かす。キャラクターは歩く (ArsistCharacter.WalkTo)、他は 0.7 m/s で滑らせる
//   look      キャラクターは体ごと向き、目もそちらを見る。他の物はそちらを向く
//   say       store の say.text に文、say.thing に話す物の id を入れ、seconds (既定 1.2 + 0.12/文字、最大 12)
//             たったら say.text を "" に戻す (後の say に置き換わっていなければ)。audio があれば話す物の位置で鳴らす。
//             say.text を表示するパネルがプロジェクトに無ければ、視界の下に字幕を 1 行出す
//   animate   キャラクターの動き (then: "stand" で立ち姿に戻る)
//   show/hide 見せる / 隠す
//   highlight entity か物を枠で囲み、label があれば上に札を出す (seconds、既定 5)
//   set       store に入れる (UI の bind はその場で追従する)
//   emit      出来事を鳴らす (規則・event の Mind・world.on・{ type: "event" } のスクリプト)
//   believe / forget   世界の状態に足す / 消す
//   ask       Mind を今すぐ走らせる
//   command   体への命令 (安全の門を通る)
// Mind の返事の位置 (believe の at) は観測の frame で書かれているので、frame を渡されたら world に戻す。
// 実行したものはすべて action:<do> の出来事になり、記録にも残る。
// ==============================================

using System;
using System.Collections;
using System.Collections.Generic;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Scripting;
using Arsist.Runtime.Spatial.Core;
using Arsist.Runtime.UI;
using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    public sealed class ActionExecutor
    {
        private readonly ArsistSpatialRuntime _rt;
        private int _sayVersion;
        private bool? _sayBound;

        public ActionExecutor(ArsistSpatialRuntime runtime)
        {
            _rt = runtime;
        }

        public void ExecuteAll(List<Dictionary<string, object>> actions, string source, FrameXf frame)
        {
            if (actions == null) return;
            foreach (var a in actions) Execute(a, source, frame);
        }

        /// <summary>1 つ実行する。問題があればその説明を返す (実行しなかった)。</summary>
        public string Execute(Dictionary<string, object> a, string source, FrameXf frame, Action<Dictionary<string, object>> done = null)
        {
            var problem = ActionModel.Problem(a);
            if (problem != null)
            {
                Debug.LogWarning($"[Layster] {source}: {problem}");
                return problem;
            }
            var kind = ActionModel.KindOf(a);
            _rt.Recorder?.Action(source, a);
            try
            {
                switch (kind)
                {
                    case "place": Place(a); break;
                    case "move": Move(a); break;
                    case "look": Look(a); break;
                    case "say": Say(a); break;
                    case "animate": Animate(a); break;
                    case "show": _rt.Placer.SetWanted(_rt.Placer.Get(J.Str(a, "thing")), true); break;
                    case "hide": _rt.Placer.SetWanted(_rt.Placer.Get(J.Str(a, "thing")), false); break;
                    case "highlight": Highlight(a); break;
                    case "set": ArsistDataStore.Instance.SetValue(J.Str(a, "key"), JsBridge.Normalize(a.TryGetValue("value", out var v) ? v : null)); break;
                    case "emit": _rt.Events.EmitApp(J.Str(a, "event"), a.TryGetValue("data", out var d) ? d : null); break;
                    case "believe": Believe(a, source, frame); break;
                    case "forget": _rt.World.Remove(J.Str(a, "entity")); break;
                    case "ask": _rt.Minds.Ask(J.Str(a, "mind"), J.Str(a, "text"), null); break;
                    case "command": _rt.Bodies.Command(J.Str(a, "body"), J.Str(a, "name"), J.Obj(a, "args"), source, done); return null;
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[Layster] {source}: {kind} failed: {e.GetType().Name}: {e.Message}\n{e.StackTrace}");
                return e.Message;
            }
            _rt.Events.Emit("action:" + kind, a, J.Str(a, "thing"));
            done?.Invoke(new Dictionary<string, object> { ["ok"] = true });
            return null;
        }

        private ThingBinding Thing(Dictionary<string, object> a)
        {
            var id = J.Str(a, "thing");
            var b = _rt.Placer.Get(id);
            if (b == null) throw new InvalidOperationException($"no thing '{id}'");
            return b;
        }

        // ---- place / move / look ----

        private void Place(Dictionary<string, object> a)
        {
            var b = Thing(a);
            var at = J.Obj(a, "at");
            if (at != null)
            {
                var world = _rt.Placer.CurrentWorld(b.Def.Id);
                var offset = Offset.FromPlain(at);
                if (!PlacementSolver.OffsetToWorld(offset, world, out var pose)) throw new InvalidOperationException($"place: frame '{offset.Frame}' is not known");
                if (!offset.Yaw.HasValue) pose.Yaw = SpatialMath.NormYaw(SpatialMath.YawToward(_rt.User.Feet.X - pose.At.X, _rt.User.Feet.Z - pose.At.Z));
                _rt.Placer.PlaceAt(b, pose, "place action", animate: true);
                return;
            }
            var place = J.Obj(a, "place");
            _rt.Placer.Resolve(b, place != null ? Placement.FromPlain(place) : null, "place action", animate: true);
        }

        private bool TargetPoint(Dictionary<string, object> target, out Vec3 point, out Entity entity)
        {
            entity = null;
            var t = Target.FromPlain(target);
            var world = _rt.Placer.CurrentWorld();
            if (t != null && t.Kind == TargetKind.Entity)
            {
                Entity best = null;
                double bestD = double.MaxValue;
                foreach (var e in _rt.Placer.Solver.FindEntities(t.Entity, world))
                {
                    double dd = SpatialMath.HorizontalDistance(e.At, world.User.At);
                    if (dd < bestD - SpatialMath.Eps) { best = e; bestD = dd; }
                }
                entity = best;
            }
            return _rt.Placer.Solver.TargetPoint(t, world, out point);
        }

        private void Move(Dictionary<string, object> a)
        {
            var b = Thing(a);
            if (!TargetPoint(J.Obj(a, "to"), out var point, out var entity)) throw new InvalidOperationException("move: the target is not known here");
            double speed = J.Num(a, "speed", 0.7);
            var character = b.Character;
            if (character != null)
            {
                var unity = _rt.Frames.ToUnity(new Vec3(point.X, 0, point.Z));
                unity.y = character.transform.position.y;
                character.WalkTo(unity, (float)speed, null, null, (ok, reason) =>
                {
                    if (!ok) Debug.Log($"[Layster] move {b.Def.Id}: {reason}");
                });
                return;
            }
            // 物は、entity の上に載せるか、その点へ
            var center = entity != null
                ? new Vec3(point.X, entity.At.Y + entity.Size.Y / 2 + b.Def.Size.Y / 2, point.Z)
                : point;
            var yaw = SpatialMath.NormYaw(SpatialMath.YawToward(_rt.User.Feet.X - center.X, _rt.User.Feet.Z - center.Z));
            _rt.StartCoroutine(Glide(b, new SpatialPose(center, yaw), speed));
        }

        private IEnumerator Glide(ThingBinding b, SpatialPose to, double speed)
        {
            var target = b.Target;
            if (target == null) yield break;
            _rt.Placer.UnityPose(b, to, out var endPos, out var endRot);
            var startPos = target.transform.position;
            var startRot = target.transform.rotation;
            float duration = Mathf.Max(0.2f, Vector3.Distance(startPos, endPos) / Mathf.Max(0.05f, (float)speed));
            float t0 = Time.unscaledTime;
            while (true)
            {
                float k = Mathf.Clamp01((Time.unscaledTime - t0) / duration);
                float s = k * k * (3 - 2 * k);
                if (target == null) yield break;
                target.transform.SetPositionAndRotation(Vector3.Lerp(startPos, endPos, s), Quaternion.Slerp(startRot, endRot, s));
                if (k >= 1) break;
                yield return null;
            }
            _rt.Placer.PlaceAt(b, to, "move", animate: false);
        }

        private void Look(Dictionary<string, object> a)
        {
            var b = Thing(a);
            if (!TargetPoint(J.Obj(a, "at"), out var point, out _)) throw new InvalidOperationException("look: the target is not known here");
            var unity = _rt.Frames.ToUnity(point);
            var character = b.Character;
            if (character != null)
            {
                var flat = new Vector3(unity.x, character.transform.position.y, unity.z);
                character.TurnTo(flat, 0.4f, null);
                var vrm = ScriptEngineManager.Instance != null ? ScriptEngineManager.Instance.VRMWrapper : null;
                if (vrm != null && vrm.exists(b.Def.Id)) vrm.lookAt(b.Def.Id, unity.x, unity.y, unity.z);
                return;
            }
            var yaw = SpatialMath.NormYaw(SpatialMath.YawToward(point.X - b.Pose.At.X, point.Z - b.Pose.At.Z));
            _rt.Placer.PlaceAt(b, new SpatialPose(b.Pose.At, yaw), "look", animate: true);
        }

        // ---- say / animate ----

        private void Say(Dictionary<string, object> a)
        {
            var text = J.Str(a, "text", "");
            var thing = J.Str(a, "thing", "") ?? "";
            double seconds = J.Has(a, "seconds") ? J.Num(a, "seconds", 3) : Math.Min(12, 1.2 + 0.12 * text.Length);
            int version = ++_sayVersion;
            ArsistDataStore.Instance.SetValue("say.thing", thing);
            ArsistDataStore.Instance.SetValue("say.text", text);
            if (_sayBound == null) _sayBound = AnyBinding("say.text");
            if (_sayBound == false) _rt.Ui.Subtitle(text, (float)seconds);
            _rt.StartCoroutine(ClearSay(version, (float)seconds));

            var audio = J.Str(a, "audio");
            if (!string.IsNullOrEmpty(audio)) PlayAudio(audio, thing);
            Debug.Log($"[Layster] say{(thing.Length > 0 ? $" ({thing})" : "")}: {text}");
        }

        private IEnumerator ClearSay(int version, float seconds)
        {
            yield return new WaitForSecondsRealtime(seconds);
            if (version == _sayVersion) ArsistDataStore.Instance.SetValue("say.text", "");
        }

        private static bool AnyBinding(string key)
        {
#if UNITY_2023_1_OR_NEWER
            foreach (var b in UnityEngine.Object.FindObjectsByType<ArsistUIBinding>(FindObjectsInactive.Include, FindObjectsSortMode.None))
#else
            foreach (var b in UnityEngine.Object.FindObjectsOfType<ArsistUIBinding>(true))
#endif
                if (b != null && string.Equals(b.key, key, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>audio.play と同じ道で鳴らす (話す物があればその位置で、VRM なら口も動く)。</summary>
        private void PlayAudio(string source, string thing)
        {
            var engine = ScriptEngineManager.Instance != null ? ScriptEngineManager.Instance.Engine : null;
            if (engine == null) { Debug.LogWarning("[Layster] say: no script engine, cannot play audio"); return; }
            try
            {
                engine.SetValue("__laysterSaySource", source);
                engine.SetValue("__laysterSayAt", thing ?? "");
                engine.Execute("audio.play(__laysterSaySource, __laysterSayAt ? { at: __laysterSayAt } : {});");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Layster] say: audio failed: {e.Message}");
            }
        }

        private void Animate(Dictionary<string, object> a)
        {
            var b = Thing(a);
            var character = b.Character;
            if (character == null) throw new InvalidOperationException($"animate: '{b.Def.Id}' is not a loaded character");
            if (!character.Play(J.Str(a, "clip"), 0.25f, J.Str(a, "then"), (float)J.Num(a, "speed", 1), out var error))
                Debug.LogWarning($"[Layster] animate {b.Def.Id}: {error}");
        }

        // ---- highlight / believe ----

        private void Highlight(Dictionary<string, object> a)
        {
            var target = J.Obj(a, "target");
            var t = Target.FromPlain(target);
            if (t == null) throw new InvalidOperationException("highlight: bad target");
            Vec3 center, size;
            double yaw;
            if (t.Kind == TargetKind.Thing)
            {
                var b = _rt.Placer.Get(t.Thing);
                if (b == null || !b.Placed) throw new InvalidOperationException($"highlight: '{t.Thing}' is not placed");
                center = b.Pose.At; size = b.Def.Size; yaw = b.Pose.Yaw;
            }
            else if (TargetPoint(target, out var point, out var entity) && entity != null)
            {
                center = entity.At; size = entity.Size; yaw = entity.Yaw;
            }
            else if (TargetPoint(target, out point, out _))
            {
                center = point; size = new Vec3(0.1, 0.1, 0.1); yaw = 0;
            }
            else throw new InvalidOperationException("highlight: the target is not known here");
            var color = ParseColor(J.Str(a, "color"), new Color(0.31f, 0.79f, 0.69f));
            _rt.Ui.Highlight(center, size, yaw, J.Str(a, "label"), color, (float)J.Num(a, "seconds", 5));
        }

        private void Believe(Dictionary<string, object> a, string source, FrameXf frame)
        {
            var raw = J.Obj(a, "entity");
            var src = source != null && source.StartsWith("mind:", StringComparison.Ordinal) ? source : "script";
            Entity e = frame != null
                ? MindRunner.BeliefToWorld(new Dictionary<string, object>(raw), frame.Origin, frame.Yaw, src)
                : MindRunner.BeliefToWorld(new Dictionary<string, object>(raw), Vec3.Zero, 0, src);
            if (e != null) _rt.World.Upsert(e, _rt.Now);
        }

        public static Color ParseColor(string text, Color fallback)
        {
            if (!string.IsNullOrEmpty(text) && ColorUtility.TryParseHtmlString(text, out var c)) return c;
            return fallback;
        }
    }
}
