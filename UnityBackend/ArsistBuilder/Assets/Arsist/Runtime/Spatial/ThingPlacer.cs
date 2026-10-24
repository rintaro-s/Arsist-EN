// ==============================================
// Arsist Engine - Layster.Spatial: 物を置く
// Assets/Arsist/Runtime/Spatial/ThingPlacer.cs
//
// spatial.json の things を、シーンの物 (ArsistSpatialThing の付いた GameObject) と結び、
// 置き方を解いて (Core/PlacementSolver) Unity の world に置く。
//
//   いつ解くか
//     起動して頭が取れたら全部 (SolveAll)。そのあと「待ち時間」(部屋が読めるまで、最長 8 秒) の間は、
//     世界の状態が変わるたびに解き直す (部屋のスキャンは起動から数秒遅れて届くので)。
//     keep: none     … 待ち時間の後も、世界が変わるたびに解き直す (1 秒に 1 回まで)
//     keep: session  … 待ち時間の後は動かない (既定)
//     keep: forever  … 待ち時間の後、載せた面からの相対位置を store (layster.place.<id>) に残し、
//                      次の起動では、その面があればそこに戻す
//     mode: body     … ユーザーが 1.2 m 動くか 60° 向きを変えたら解き直し、0.6 秒かけて移る
//     mode: head / hand … 毎フレーム、頭 / 手に付いて行く
//   どう置くか
//     解いた姿勢は物の箱の中心。キャラクターは足元を箱の底に、モデルは見た目の範囲の底の中心を箱の底に合わせる。
//     物の「前」は +Z。Canvas (パネル・札) は +Z の側から読めないので 180° 回す。
//     キャラクターは ArsistCharacter.Forward (VRM の顔の向き) を前とみなす。
//   見えなくする
//     置くまで・hide の間は、Renderer / Canvas / Collider を切る (GameObject は止めない。
//     止めると VRM の読み込みと SceneWrapper への登録まで止まる)。後から読み込まれた VRM にも掛け直す。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Spatial.Core;
using Arsist.Runtime.VRM;
using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    public sealed class ThingBinding
    {
        public ThingDef Def;
        public GameObject Root;
        public SolveResult Result;
        public bool Placed;
        /// <summary>見せたいか (show / hide)。置くまでは実際には見せない</summary>
        public bool WantVisible = true;
        /// <summary>world に置いた物の、spatial の姿勢 (箱の中心)。head / hand は毎フレーム更新</summary>
        public SpatialPose Pose;

        internal bool AppliedVisible = true;
        internal double NextVisibilityRefresh;
        internal Vec3 SolveFeet;
        internal double SolveYaw;
        internal double LastSolve = -999;
        internal bool KeptRestored;
        internal bool KeepSaved;
        internal bool ModelFitted;
        internal bool CharacterBound;
        internal Vector3 ModelBottomLocal;
        internal Quaternion BaseRotation = Quaternion.identity;
        internal bool BaseCaptured;
        // 動かしている途中
        internal bool Moving;
        internal Vector3 MoveFrom, MoveTo;
        internal Quaternion RotFrom, RotTo;
        internal float MoveStart, MoveDuration;

        public bool IsAttached => Result != null && (Result.Mode == "head" || Result.Mode == "hand");

        /// <summary>動かす GameObject。キャラクターは読み込まれた VRM (歩くのはこちら)、それ以外は置き場所の物。</summary>
        public GameObject Target
        {
            get
            {
                if (Root == null) return null;
                if (Def.Kind == "character")
                {
                    var character = Root.GetComponentInChildren<ArsistCharacter>(true);
                    if (character != null) return character.gameObject;
                }
                return Root;
            }
        }

        public ArsistCharacter Character => Root != null ? Root.GetComponentInChildren<ArsistCharacter>(true) : null;
    }

    public sealed class ThingPlacer
    {
        public const double SettleSeconds = 8;
        private const string KeepPrefix = "layster.place.";

        private readonly ArsistSpatialRuntime _rt;
        private readonly PlacementSolver _solver;
        public readonly List<ThingBinding> Bindings = new List<ThingBinding>();
        private bool _initialSolved;
        private int _solvedVersion = -1;
        private double _lastResolve;

        public ThingPlacer(ArsistSpatialRuntime runtime)
        {
            _rt = runtime;
            _solver = new PlacementSolver(runtime.Model.Vocabulary);
            foreach (var def in runtime.Model.Things)
            {
                var tag = ArsistSpatialThing.Find(def.Object);
                if (tag == null) tag = ArsistSpatialThing.Find(def.Id);
                var binding = new ThingBinding { Def = def, Root = tag != null ? tag.gameObject : null, WantVisible = def.VisibleAtStart };
                if (binding.Root == null) Debug.LogWarning($"[Layster] thing '{def.Id}': no scene object (was it lowered into scenes.json?)");
                Bindings.Add(binding);
                SetVisible(binding, false);
            }
        }

        public PlacementSolver Solver => _solver;

        public ThingBinding Get(string id)
        {
            foreach (var b in Bindings) if (b.Def.Id == id) return b;
            return null;
        }

        // ========================================
        // 解く
        // ========================================

        /// <summary>今の世界 (この物以外の置いた物を含む)。</summary>
        public SolveWorld CurrentWorld(string except = null)
        {
            var w = _rt.World.ToSolveWorld(_rt.User.ToSolveUser(), _rt.User.LeftHand, _rt.User.RightHand);
            foreach (var b in Bindings)
            {
                if (!b.Placed || b.IsAttached || b.Def.Id == except) continue;
                w.SetThing(b.Def.Id, new PlacedThing { Pose = b.Pose, Size = b.Def.Size });
            }
            return w;
        }

        public void Tick()
        {
            if (!_rt.Frames.Initialized || !_rt.User.HasHead) return;
            double now = _rt.Now;
            bool settling = _rt.Settling;
            if (!_initialSolved)
            {
                _initialSolved = true;
                SolveEverything("start");
            }
            else if (_rt.World.Version != _solvedVersion && now - _lastResolve >= (settling ? 0.5 : 1.0))
            {
                _lastResolve = now;
                _solvedVersion = _rt.World.Version;
                if (settling) SolveEverything("room changed");
                else
                {
                    foreach (var b in Bindings)
                        if (b.Def.Place.Keep == "none" && !b.IsAttached) Resolve(b, null, "world changed", animate: true);
                }
            }

            foreach (var b in Bindings)
            {
                if (b.Root == null) continue;
                if (b.Def.Kind == "character") TrackCharacter(b);
                if (b.Placed && b.Result.Mode == "body") FollowBody(b);
                if (b.IsAttached) FollowAttached(b);
                else if (b.Moving) StepMove(b);
                RefreshVisibility(b, now);
                if (b.Def.Kind == "model" && !b.ModelFitted) FitModel(b);
            }
        }

        /// <summary>待ち時間が終わった (部屋を読み終えた・時間切れ)。forever の物の場所を残す。</summary>
        public void SettleEnded()
        {
            SolveEverything("settled");
            foreach (var b in Bindings) SaveKept(b);
        }

        private void SolveEverything(string why)
        {
            _solvedVersion = _rt.World.Version;
            var world = _rt.World.ToSolveWorld(_rt.User.ToSolveUser(), _rt.User.LeftHand, _rt.User.RightHand);
            // 前の起動で覚えた場所 (keep: forever) を先に置き、他の物の計算に入れる
            var toSolve = new List<ThingDef>();
            foreach (var b in Bindings)
            {
                // 前の起動の場所に戻した物は、もう解き直さない (待ち時間の間に何度も解くので)
                if (b.KeptRestored && b.Placed)
                {
                    world.SetThing(b.Def.Id, new PlacedThing { Pose = b.Pose, Size = b.Def.Size });
                    continue;
                }
                if (TryRestoreKept(b, world))
                {
                    world.SetThing(b.Def.Id, new PlacedThing { Pose = b.Pose, Size = b.Def.Size });
                    continue;
                }
                toSolve.Add(b.Def);
            }
            var results = _solver.SolveAll(toSolve, world);
            for (int i = 0; i < toSolve.Count; i++) Apply(Get(toSolve[i].Id), results[i], why, animate: _rt.Now > 1.5);
        }

        /// <summary>1 つを解き直す (world.place / place の行動)。place を渡せば、その置き方で。</summary>
        public SolveResult Resolve(ThingBinding b, Placement place, string why, bool animate)
        {
            if (b == null) return null;
            var world = CurrentWorld(b.Def.Id);
            var result = _solver.Solve(b.Def.Id, b.Def.Size, place ?? b.Def.Place, world);
            Apply(b, result, why, animate);
            return result;
        }

        /// <summary>姿勢を直接決める (place の行動の at、ユーザーがつかんで動かした後など)。</summary>
        public void PlaceAt(ThingBinding b, SpatialPose pose, string why, bool animate)
        {
            if (b == null) return;
            var result = new SolveResult { Thing = b.Def.Id, Mode = "world", Frame = "world", Pose = pose, Rule = 0 };
            Apply(b, result, why, animate);
        }

        private void Apply(ThingBinding b, SolveResult result, string why, bool animate)
        {
            if (b == null || result == null) return;
            bool first = !b.Placed;
            var previousRule = b.Result?.Rule;
            b.Result = result;
            b.Placed = true;
            b.LastSolve = _rt.Now;
            b.SolveFeet = _rt.User.Feet;
            b.SolveYaw = _rt.User.Yaw;
            if (result.Frame == "world") b.Pose = result.Pose;
            if (b.Root != null && result.Frame == "world") MoveTo(b, result.Pose, animate && !first);

            if (first || previousRule != result.Rule)
            {
                var note = result.Notes.Count > 0 ? $" ({string.Join(" | ", result.Notes)})" : "";
                Debug.Log($"[Layster] placed {b.Def.Id} ({why}): rule {(result.IsDefault ? "default" : result.Rule.ToString())}{(result.Host != null ? $" on {result.Host}" : "")} {result.Frame} {result.Pose.At} yaw {result.Pose.Yaw:0.#}{note}");
                var data = new Dictionary<string, object>
                {
                    ["thing"] = b.Def.Id, ["rule"] = result.RuleValue, ["host"] = result.Host, ["frame"] = result.Frame,
                    ["at"] = result.Pose.At.ToPlainRounded(), ["notes"] = new List<object>(result.Notes),
                };
                _rt.Events.Emit("placed", data, b.Def.Id);
                if (result.Rule != 0) _rt.Events.Emit("fallback", data, b.Def.Id);
            }
        }

        // ========================================
        // keep: forever
        // ========================================

        private bool TryRestoreKept(ThingBinding b, SolveWorld world)
        {
            if (b.KeptRestored || b.Def.Place.Keep != "forever" || (b.Def.Place.Mode ?? "world") != "world") return false;
            if (!ArsistDataStore.Instance.TryGetValueByPath(KeepPrefix + b.Def.Id, out var raw) || !(raw is Dictionary<string, object> d)) return false;
            var hostId = J.Str(d, "host");
            var host = _rt.World.Get(hostId);
            if (host == null) return false;
            if (!J.TryVec3(d.TryGetValue("local", out var l) ? l : null, out var local)) return false;
            var at = SpatialMath.FrameToWorld(local, host.At, host.Yaw);
            var pose = new SpatialPose(at, SpatialMath.NormYaw(host.Yaw + J.Num(d, "yaw", 0)));
            b.KeptRestored = true;
            b.KeepSaved = true;
            Apply(b, new SolveResult { Thing = b.Def.Id, Mode = "world", Frame = "world", Pose = pose, Rule = 0, Host = hostId, Notes = { "kept from the last launch" } }, "kept", animate: false);
            return true;
        }

        private void SaveKept(ThingBinding b)
        {
            if (b.KeepSaved || b.Def.Place.Keep != "forever" || !b.Placed || b.IsAttached || b.Result?.Host == null) return;
            var host = _rt.World.Get(b.Result.Host);
            if (host == null || WorldState.Fades(host.Source) || host.Source == "assumed") return;
            var local = SpatialMath.PointToFrame(b.Pose.At, host.At, host.Yaw);
            ArsistDataStore.Instance.SetValue(KeepPrefix + b.Def.Id, new Dictionary<string, object>
            {
                ["host"] = host.Id,
                ["local"] = local.ToPlainRounded(),
                ["yaw"] = SpatialMath.Round3(SpatialMath.NormYaw(b.Pose.Yaw - host.Yaw)),
            });
            b.KeepSaved = true;
            Debug.Log($"[Layster] kept {b.Def.Id} relative to {host.Id} for the next launch");
        }

        /// <summary>覚えた場所を忘れる (次の起動では解き直す)。</summary>
        public void Forget(string id)
        {
            ArsistDataStore.Instance.RemoveValue(KeepPrefix + id);
            var b = Get(id);
            if (b != null) b.KeepSaved = false;
        }

        // ========================================
        // Unity に置く
        // ========================================

        private void CaptureBase(ThingBinding b, GameObject target)
        {
            if (b.BaseCaptured || target == null) return;
            b.BaseCaptured = true;
            // ビルドが付けた傾き (立てた quad など) は残し、水平の向きだけ置き方で決める
            var e = target.transform.rotation.eulerAngles;
            b.BaseRotation = Quaternion.Euler(e.x, 0, e.z);
        }

        /// <summary>spatial の姿勢 (箱の中心) → 動かす GameObject の Unity の位置と回転。</summary>
        public void UnityPose(ThingBinding b, SpatialPose pose, out Vector3 position, out Quaternion rotation)
        {
            var target = b.Target;
            CaptureBase(b, target);
            double yaw = pose.Yaw;
            if (b.Def.IsCanvas) yaw += 180;
            rotation = _rt.Frames.RotationToUnity(yaw) * b.BaseRotation;
            var center = pose.At;
            if (b.Def.Kind == "character")
            {
                position = _rt.Frames.ToUnity(new Vec3(center.X, center.Y - b.Def.Size.Y / 2, center.Z));
                var character = b.Character;
                if (character != null && target != null)
                {
                    // 顔の向き (Forward) が yaw を向くように、根元の回り方を補う
                    var f = character.Forward;
                    var t = target.transform.forward;
                    float faceOffset = Mathf.DeltaAngle(Mathf.Atan2(t.x, t.z) * Mathf.Rad2Deg, Mathf.Atan2(f.x, f.z) * Mathf.Rad2Deg);
                    rotation = Quaternion.Euler(0, _rt.Frames.YawToUnity(yaw) - faceOffset, 0);
                }
                return;
            }
            if (b.Def.Kind == "model" && b.ModelFitted)
            {
                var bottom = _rt.Frames.ToUnity(new Vec3(center.X, center.Y - b.Def.Size.Y / 2, center.Z));
                position = bottom - rotation * b.ModelBottomLocal;
                return;
            }
            position = _rt.Frames.ToUnity(center);
        }

        private void MoveTo(ThingBinding b, SpatialPose pose, bool animate)
        {
            var target = b.Target;
            if (target == null) return;
            UnityPose(b, pose, out var position, out var rotation);
            if (!animate || !b.AppliedVisible)
            {
                b.Moving = false;
                target.transform.SetPositionAndRotation(position, rotation);
                return;
            }
            b.Moving = true;
            b.MoveFrom = target.transform.position;
            b.RotFrom = target.transform.rotation;
            b.MoveTo = position;
            b.RotTo = rotation;
            b.MoveStart = Time.unscaledTime;
            b.MoveDuration = 0.6f;
        }

        private void StepMove(ThingBinding b)
        {
            var target = b.Target;
            if (target == null) { b.Moving = false; return; }
            float k = Mathf.Clamp01((Time.unscaledTime - b.MoveStart) / Mathf.Max(0.01f, b.MoveDuration));
            float s = k * k * (3 - 2 * k);
            target.transform.SetPositionAndRotation(Vector3.Lerp(b.MoveFrom, b.MoveTo, s), Quaternion.Slerp(b.RotFrom, b.RotTo, s));
            if (k >= 1) b.Moving = false;
        }

        /// <summary>床の高さが変わった。world に置いた物を、spatial の姿勢のまま Unity で置き直す。</summary>
        public void ReapplyAll()
        {
            foreach (var b in Bindings)
                if (b.Placed && !b.IsAttached && b.Root != null) MoveTo(b, b.Pose, animate: false);
        }

        /// <summary>
        /// VRM が読み込まれたら (置き場所の物の子に出てくる)、顔の向きを合わせて置き直す。
        /// 歩いた後は、実際の足元から姿勢を取り直す (観測・near の基準がずれないように)。
        /// </summary>
        private void TrackCharacter(ThingBinding b)
        {
            var character = b.Character;
            if (character == null) return;
            if (!b.CharacterBound)
            {
                b.CharacterBound = true;
                if (b.Placed && !b.IsAttached) MoveTo(b, b.Pose, animate: false);
                RefreshVisibility(b, _rt.Now, force: true);
                return;
            }
            if (!b.Placed || b.IsAttached || b.Moving) return;
            var feet = _rt.Frames.FromUnity(character.transform.position);
            b.Pose = new SpatialPose(new Vec3(feet.X, feet.Y + b.Def.Size.Y / 2, feet.Z), _rt.Frames.YawFromForward(character.Forward));
        }

        private void FollowBody(ThingBinding b)
        {
            if (_rt.Now - b.LastSolve < 1.0) return;
            double moved = SpatialMath.HorizontalDistance(_rt.User.Feet, b.SolveFeet);
            double turned = Math.Abs(SpatialMath.NormYaw(_rt.User.Yaw - b.SolveYaw));
            if (moved < 1.2 && turned < 60) return;
            Resolve(b, null, "follow the user", animate: true);
        }

        private void FollowAttached(ThingBinding b)
        {
            var target = b.Target;
            var head = _rt.User.Head;
            if (target == null || head == null) return;
            var at = b.Result.Pose.At;
            double yaw = b.Result.Pose.Yaw + (b.Def.IsCanvas ? 180 : 0);
            CaptureBase(b, target);
            if (b.Result.Mode == "head")
            {
                var position = head.TransformPoint(new Vector3((float)at.X, (float)at.Y, (float)at.Z));
                var rotation = head.rotation * Quaternion.Euler(0, (float)yaw, 0) * b.BaseRotation;
                target.transform.SetPositionAndRotation(position, rotation);
                b.Pose = new SpatialPose(_rt.Frames.FromUnity(position), _rt.Frames.YawFromForward(rotation * Vector3.forward));
                return;
            }
            // hand: 手のひらの位置から、ユーザーの水平の向きで at だけずらす。こちら (頭) を向く
            var hand = b.Result.Frame == "hand.left" ? _rt.User.LeftHandUnity : _rt.User.RightHandUnity;
            if (!hand.HasValue)
            {
                if (b.AppliedVisible) SetVisible(b, false);
                return;
            }
            var userYaw = Quaternion.Euler(0, _rt.Frames.YawToUnity(_rt.User.Yaw), 0);
            var pos = hand.Value + userYaw * new Vector3((float)at.X, (float)at.Y, (float)at.Z);
            var toHead = head.position - pos;
            toHead.y = 0;
            float faceYaw = toHead.sqrMagnitude > 1e-6f ? Mathf.Atan2(toHead.x, toHead.z) * Mathf.Rad2Deg : 0;
            target.transform.SetPositionAndRotation(pos, Quaternion.Euler(0, faceYaw + (b.Def.IsCanvas ? 180 : 0) + (float)b.Result.Pose.Yaw, 0) * b.BaseRotation);
            b.Pose = new SpatialPose(_rt.Frames.FromUnity(pos), _rt.Frames.YawFromUnity(faceYaw));
        }

        // ========================================
        // 見せる・隠す
        // ========================================

        public void SetWanted(ThingBinding b, bool visible)
        {
            if (b == null) return;
            b.WantVisible = visible;
            RefreshVisibility(b, _rt.Now, force: true);
        }

        private void RefreshVisibility(ThingBinding b, double now, bool force = false)
        {
            bool should = b.WantVisible && b.Placed;
            if (b.IsAttached && b.Result.Mode == "hand")
            {
                var hand = b.Result.Frame == "hand.left" ? _rt.User.LeftHandUnity : _rt.User.RightHandUnity;
                should &= hand.HasValue;
            }
            // 後から読み込まれる物 (VRM) にも掛かるよう、隠している間は 0.5 秒ごとに掛け直す
            if (!force && should == b.AppliedVisible && (should || now < b.NextVisibilityRefresh)) return;
            b.NextVisibilityRefresh = now + 0.5;
            SetVisible(b, should);
        }

        private static void SetVisible(ThingBinding b, bool visible)
        {
            b.AppliedVisible = visible;
            if (b.Root == null) return;
            foreach (var r in b.Root.GetComponentsInChildren<Renderer>(true)) r.enabled = visible;
            foreach (var c in b.Root.GetComponentsInChildren<Canvas>(true)) c.enabled = visible;
            foreach (var c in b.Root.GetComponentsInChildren<Collider>(true)) c.enabled = visible;
        }

        // ========================================
        // モデルの大きさ
        // ========================================

        private void FitModel(ThingBinding b)
        {
            var target = b.Target;
            if (target == null) return;
            var renderers = target.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return; // まだ読み込み中
            var bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            if (bounds.size.y < 1e-4f) return;
            if (b.Def.ModelHeight > 0)
            {
                float k = (float)b.Def.ModelHeight / bounds.size.y;
                target.transform.localScale *= k;
                bounds = renderers[0].bounds;
                for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            }
            var bottom = new Vector3(bounds.center.x, bounds.min.y, bounds.center.z);
            b.ModelBottomLocal = Quaternion.Inverse(target.transform.rotation) * (bottom - target.transform.position);
            b.ModelFitted = true;
            if (b.Placed && !b.IsAttached) MoveTo(b, b.Pose, animate: false);
        }
    }
}
