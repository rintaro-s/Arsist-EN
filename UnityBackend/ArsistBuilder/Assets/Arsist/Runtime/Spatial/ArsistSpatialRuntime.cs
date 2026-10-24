// ==============================================
// Arsist Engine - Layster.Spatial: ランタイムの本体
// Assets/Arsist/Runtime/Spatial/ArsistSpatialRuntime.cs
//
// spatial.json (Resources/ArsistSpatial) があるビルドに、ビルドが 1 つだけ置く (ArsistBuildPipeline.CreateRuntimeSystems)。
// 中身は doc/20-spatial-runtime.md。1 フレームの流れ:
//
//   frames   起動して頭が取れたら、そこを spatial の原点にする (SpatialFrames)
//   user     頭・手・視線 (SpatialUser / SpatialGaze)
//   world    provider が entity を書く (仮の床 + 拡張機能の provider)。推測は時間で薄れる (Core/WorldState)
//   things   置き方を解いて置く (ThingPlacer + Core/PlacementSolver)。つかんで動かす (SpatialGrab)
//   room     本物の物の陰に隠す (SpatialOcclusion) / 仮の部屋を描く (SpatialVirtualRoom、reality = virtual-room)
//   rules    規則 (RuleEngine)
//   minds    Mind (MindRunner) → 行動 (ActionExecutor) → 体 (BodyLinks、安全の門)
//   record   記録 (SpatialRecorder)
//
// エンジンの他の部品 (VRM・キャラクター・UI・スクリプト・store・音) は Virtual と同じものをそのまま使う。
// ==============================================

using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Spatial.Core;
using UnityEngine;
using UnityEngine.XR;

namespace Arsist.Runtime.Spatial
{
    [UnityEngine.Scripting.Preserve]
    [DefaultExecutionOrder(-50)]
    public sealed class ArsistSpatialRuntime : MonoBehaviour
    {
        public static ArsistSpatialRuntime Instance { get; private set; }

        /// <summary>ランタイムが動き出した (world.on をそれより前に呼んだスクリプトがつなぎ直す)。</summary>
        public static event Action Started;

        public SpatialModel Model { get; private set; }
        public SpatialFrames Frames { get; } = new SpatialFrames();
        public SpatialUser User { get; } = new SpatialUser();
        public SpatialGaze Gaze { get; private set; }
        public WorldState World { get; private set; }
        public SpatialEvents Events { get; private set; }
        public ThingPlacer Placer { get; private set; }
        public RuleEngine Rules { get; private set; }
        public MindRunner Minds { get; private set; }
        public ActionExecutor Actions { get; private set; }
        public BodyLinks Bodies { get; private set; }
        public SpatialUi Ui { get; private set; }
        public SpatialRecorder Recorder { get; private set; }
        public SpatialGrab Grab { get; private set; }
        public SpatialOcclusion Occlusion { get; private set; }
        public SpatialVirtualRoom VirtualRoom { get; private set; }

        /// <summary>動き出してからの秒</summary>
        public double Now => Time.realtimeSinceStartup - _startTime;

        /// <summary>部屋が読めるのを待っている間 (この間は世界が変わるたびに全部を置き直す)。</summary>
        public bool Settling { get; private set; } = true;

        private float _startTime;
        private bool _running;
        private int _waitFrames;
        private SpatialProviderContext _providerContext;
        private readonly List<ISpatialProvider> _begun = new List<ISpatialProvider>();
        private readonly ConcurrentQueue<Action> _mainThread = new ConcurrentQueue<Action>();
        private readonly Dictionary<string, GameObject> _workspaces = new Dictionary<string, GameObject>();
        private readonly Dictionary<string, Vec3> _workspaceAt = new Dictionary<string, Vec3>();
        private double _floorProbeAt = 0.5;
        private int _floorProbes;

        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(this); return; }
            var json = ArsistSpatialHooks.Json;
            if (json == null)
            {
                Debug.LogWarning("[Layster] ArsistSpatialRuntime is in the scene but there is no spatial.json; disabled");
                enabled = false;
                return;
            }
            try
            {
                Model = SpatialModel.Parse(json);
            }
            catch (Exception e)
            {
                Debug.LogError($"[Layster] spatial.json could not be read: {e.Message}");
                enabled = false;
                return;
            }
            Instance = this;
            foreach (var w in Model.Warnings) Debug.LogWarning("[Layster] " + w);
            _startTime = Time.realtimeSinceStartup;
            World = new WorldState(Model.Vocabulary);
            Events = new SpatialEvents(this);
            World.Seen += e => Events.Emit("seen", WorldState.ToPlain(e, Model.Vocabulary), e.Id);
            World.Lost += e => Events.Emit("lost", WorldState.ToPlain(e, Model.Vocabulary), e.Id);
            Gaze = new SpatialGaze(this);
            Ui = new SpatialUi(this);
            Debug.Log($"[Layster] Spatial runtime for '{Model.Name}' (Layster.Spatial {Model.LaysterVersion}): {Model.Things.Count} things, {Model.Minds.Count} minds, {Model.Bodies.Count} bodies, {Model.Rules.Count} rules");
        }

        private void Start()
        {
            if (Instance != this) return;
            // シーンの物は Awake で揃っている。ここから先は頭が取れるのを待つ (Update)
            Placer = new ThingPlacer(this);
            Actions = new ActionExecutor(this);
            Minds = new MindRunner(this);
            Bodies = new BodyLinks(this);
            Recorder = new SpatialRecorder(this);
            Rules = new RuleEngine(this);
            Grab = new SpatialGrab(this);
            Occlusion = new SpatialOcclusion(this);
            VirtualRoom = new SpatialVirtualRoom(this);
            // パネルのボタン: 鳴ったら select も配る
            foreach (var t in Model.Things)
                foreach (var pair in t.Bindings)
                    Events.ListenSelect(pair.Value, t.Id, pair.Key);
            _providerContext = new SpatialProviderContext(this);
            SpatialProviders.Add(new AssumedFloorProvider());
            SpatialProviders.Added += BeginProvider;
            Frames.Changed += () => { Placer.ReapplyAll(); DrawWorkspaces(force: true); };
        }

        private void OnDestroy()
        {
            if (Instance != this) return;
            SpatialProviders.Added -= BeginProvider;
            Recorder?.Stop();
            Bodies?.Dispose();
            Events?.Dispose();
            Instance = null;
        }

        private void OnApplicationPause(bool paused)
        {
            // 記録は途中までを確実に残す
            if (paused && Recorder != null && Recorder.Active) Recorder.Mark("paused");
        }

        /// <summary>別のスレッドからメインスレッドへ仕事を渡す。</summary>
        public void Post(Action action)
        {
            if (action != null) _mainThread.Enqueue(action);
        }

        private void BeginProvider(ISpatialProvider provider)
        {
            if (!_running || _begun.Contains(provider)) return;
            _begun.Add(provider);
            try { provider.Begin(_providerContext); }
            catch (Exception e) { Debug.LogError($"[Layster] provider {provider.Id} failed to begin: {e.Message}\n{e.StackTrace}"); }
        }

        /// <summary>provider が部屋を読み終えた。待ち時間を終える (少しだけ待って、続けて届く分を拾う)。</summary>
        public void ProviderReady(string from)
        {
            Debug.Log($"[Layster] room ready ({from})");
            if (Settling) StartCoroutine(EndSettleSoon(1.0f));
        }

        private IEnumerator EndSettleSoon(float seconds)
        {
            yield return new WaitForSecondsRealtime(seconds);
            EndSettle("room ready");
        }

        private void EndSettle(string why)
        {
            if (!Settling) return;
            Settling = false;
            Debug.Log($"[Layster] settled ({why}) at {Now:0.0} s with {World.Entities().Count} entities");
            Placer.SettleEnded();
        }

        private void Update()
        {
            if (Instance != this || Placer == null) return;
            while (_mainThread.TryDequeue(out var action))
            {
                try { action(); }
                catch (Exception e) { Debug.LogError($"[Layster] {e.GetType().Name}: {e.Message}\n{e.StackTrace}"); }
            }

            if (!_running)
            {
                // XR が頭の位置を出すまで少し待つ (最初の数フレームは原点のことがある)
                if (User.Camera == null || ++_waitFrames < 15) return;
                Frames.Initialize(User.Head.position, User.Head.forward, Model.AssumedEyeHeight);
                _running = true;
                foreach (var p in SpatialProviders.All) BeginProvider(p);
                Started?.Invoke();
                if (Model.Recording.Enabled) StartCoroutine(StartRecordingSoon());
            }

            User.Update(Frames);
            Gaze.Update();
            ProbeFloor();
            World.Tick(Now);
            foreach (var p in _begun.ToArray())
            {
                try { p.Tick(_providerContext); }
                catch (Exception e) { Debug.LogError($"[Layster] provider {p.Id}: {e.GetType().Name}: {e.Message}"); }
            }
            if (Settling && Now > ThingPlacer.SettleSeconds) EndSettle("time");
            Placer.Tick();
            Grab.Tick();
            Occlusion.Tick();
            VirtualRoom.Tick();
            Rules.Tick();
            Minds.Tick();
            Bodies.Tick();
            Ui.Tick();
            Recorder.Tick();
            DrawWorkspaces(force: false);
        }

        private IEnumerator StartRecordingSoon()
        {
            // 置き終わってから聞く (起動直後に目の前を塞がない)
            yield return new WaitForSecondsRealtime(2f);
            Recorder.Start();
        }

        /// <summary>
        /// 床の高さを XR から探す (起動から 0.5 秒・3 秒・8 秒)。Floor の追跡ならその原点、
        /// そうでなければ境界 (ガーディアン) の点の高さ。どちらも無ければ仮定のまま (部屋のスキャンが来ればそちら)。
        /// </summary>
        private void ProbeFloor()
        {
            if (_floorProbes >= 3 || Now < _floorProbeAt) return;
            _floorProbes++;
            _floorProbeAt = _floorProbes == 1 ? 3 : 8;
            var subsystems = new List<XRInputSubsystem>();
            SubsystemManager.GetSubsystems(subsystems);
            var tracking = User.Head != null ? User.Head.parent : null;
            foreach (var s in subsystems)
            {
                if (s == null || !s.running) continue;
                var mode = s.GetTrackingOriginMode();
                if ((mode & TrackingOriginModeFlags.Floor) != 0 && tracking != null)
                {
                    Frames.ReportFloor(tracking.TransformPoint(Vector3.zero).y, 0.8, "XR floor origin");
                    return;
                }
                var points = new List<Vector3>();
                if (s.TryGetBoundaryPoints(points) && points.Count >= 3)
                {
                    var p = tracking != null ? tracking.TransformPoint(points[0]) : points[0];
                    Frames.ReportFloor(p.y, 0.6, "XR boundary");
                    return;
                }
            }
        }

        private void DrawWorkspaces(bool force)
        {
            foreach (var body in Model.Bodies)
            {
                if (!body.ShowWorkspace) continue;
                var link = Bodies.Get(body.Id);
                var basePose = link?.BasePose();
                if (basePose == null) continue;
                if (!force && _workspaceAt.TryGetValue(body.Id, out var was) && (was - basePose.Value.At).Length < 0.005) continue;
                _workspaceAt[body.Id] = basePose.Value.At;
                _workspaces.TryGetValue(body.Id, out var previous);
                _workspaces[body.Id] = Ui.Workspace(previous, basePose.Value, body.WorkspaceCenter, body.WorkspaceSize);
            }
        }

        /// <summary>Mind の観測の材料 (今の世界・物・ユーザー・出来事・store)。</summary>
        public ObservationInput ObservationInput(MindDef mind)
        {
            var input = new ObservationInput
            {
                Mind = mind,
                World = Placer.CurrentWorld(),
                Vocabulary = Model.Vocabulary,
                Time = Now,
                Events = new List<Dictionary<string, object>>(Events.Recent),
                Store = ArsistDataStore.Instance.GetSnapshot(),
                Gaze = Gaze.ToPlain(),
            };
            foreach (var b in Placer.Bindings)
                input.Things.Add(new ObservedThing { Id = b.Def.Id, Pose = b.Placed ? b.Pose : (SpatialPose?)null, Visible = b.AppliedVisible });
            foreach (var body in Model.Bodies) input.BodyBases[body.Id] = body.BaseThing;
            return input;
        }
    }
}
