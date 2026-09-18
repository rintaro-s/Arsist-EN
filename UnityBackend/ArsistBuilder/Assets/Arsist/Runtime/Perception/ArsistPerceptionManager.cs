// ==============================================
// Arsist Engine - Perception
// 画像アンカーのランタイム制御
//
// 役割:
//  - StreamingAssets/Perception/perception.json と参照写真を読む
//  - 端末に合ったフレーム供給を選ぶ (Quest → AR Foundation → Webcam)
//  - ワーカースレッドで認識を回す（メインスレッドは止めない）
//  - 観測をワールド座標に直し、複数観測を融合して姿勢を確定する
//
// 検出レートを上げないのは意図的。ターゲットは現実世界で静止していて、
// ヘッドセット側が 6DoF で自分を追っているので、一度ワールド座標を
// 決めてしまえば以後はプラットフォームの追跡が保持してくれる。
// 何度も観測するのは精度を上げるためであって、追従のためではない。
// ==============================================

using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using Arsist.Runtime.Perception.Sources;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Scripting;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace Arsist.Runtime.Perception
{
    /// <summary>1ターゲットのランタイム状態。</summary>
    /// <summary>参照写真上の正規化矩形 (原点は写真の左下)。</summary>
    public struct PerceptionRegionRect
    {
        public float X, Y, Width, Height;
    }

    /// <summary>タスクに渡すための1枚の静止画（フル解像度）。</summary>
    public struct PerceptionStill
    {
        public GrayImage Image;
        /// <summary>色つきの同じ画。色を要求した RequestStill でのみ入る。</summary>
        public Vision.Classic.ColorImage Color;
        public CameraIntrinsics Intrinsics;
        public Pose CameraPose;
        public bool Valid;
    }

    public sealed class PerceptionTargetState
    {
        public string Id;
        public string Name;
        public float HoldSeconds = 2f;
        /// <summary>実物の寸法 (m)。領域をワールドへ投影するのに要る。</summary>
        public float PhysicalWidth;
        public float PhysicalHeight;
        /// <summary>写真の上に定義された領域。id → 正規化矩形。</summary>
        public readonly Dictionary<string, PerceptionRegionRect> Regions =
            new Dictionary<string, PerceptionRegionRect>();

        /// <summary>一度でも姿勢が確定したか。ワールド固定なので以後 false に戻らない。</summary>
        public bool Localized;
        /// <summary>直近 HoldSeconds 以内に観測されたか。</summary>
        public bool Visible;

        public Vector3 Position;
        public Quaternion Rotation = Quaternion.identity;

        public int ObservationCount;
        public float LastSeenTime = -999f;
        public double LastRmse;

        /// <summary>融合用の重み付き累積。</summary>
        internal double WeightSum;
        internal Vector3 WeightedPosition;
        internal Vector4 WeightedRotation;
    }

    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistPerceptionManager : MonoBehaviour
    {
        public static ArsistPerceptionManager Instance { get; private set; }

        [Tooltip("1秒あたりの検出試行回数。上げても精度は上がらず電力だけ食う。")]
        public float DetectionRate = 6f;

        [Tooltip("十分な観測が溜まった後の検出レート。姿勢はワールドに固定済みなので下げてよい。")]
        public float SettledDetectionRate = 1f;

        /// <summary>
        /// 検出に使う最大幅。カメラからはフル解像度で受け取り、ここまで縮めてから
        /// 特徴抽出する。OCR 用の切り出しは縮める前の画像から行うので、
        /// 小さな文字を潰さずに検出だけ軽くできる。
        /// </summary>
        private const int DetectionMaxWidth = 640;

        /// <summary>この回数を超えたら「十分観測した」とみなしてレートを落とす。</summary>
        private const int SettledObservationCount = 8;

        private readonly Dictionary<string, PerceptionTargetState> _states =
            new Dictionary<string, PerceptionTargetState>();
        private readonly List<ReferenceTarget> _references = new List<ReferenceTarget>();

        private IArsistCameraFrameSource _source;
        private ImageRecognizer _recognizer;
        private bool _sourceReady;
        private float _nextDetectionTime;
        private bool _referencesReady;

        // ワーカースレッドとの受け渡し
        private readonly object _gate = new object();
        private Thread _worker;
        private volatile bool _running;
        private ArsistCameraFrame _pendingFrame;
        private bool _hasPendingFrame;
        private readonly List<Action<PerceptionStill>> _stillRequests = new List<Action<PerceptionStill>>();
        /// <summary>いま待っている静止画の要求の中に、色つきを求めたものがあるか。</summary>
        private bool _colorWanted;
        private readonly List<PendingResult> _results = new List<PendingResult>();

        private struct PendingResult
        {
            public Detection Detection;
            public Pose CameraPose;
        }

        public IReadOnlyDictionary<string, PerceptionTargetState> States => _states;

        public PerceptionTargetState GetState(string targetId)
        {
            if (string.IsNullOrEmpty(targetId)) return null;
            return _states.TryGetValue(targetId, out var s) ? s : null;
        }

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
        }

        private void Start()
        {
            _recognizer = new ImageRecognizer(new RecognizerSettings());
            StartCoroutine(LoadAndStart());
        }

        private IEnumerator LoadAndStart()
        {
            var dir = Path.Combine(Application.streamingAssetsPath, "Perception");
            var configUrl = ToUrl(Path.Combine(dir, "perception.json"));

            string json = null;
            using (var req = UnityWebRequest.Get(configUrl))
            {
                req.timeout = 10;
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success)
                {
                    Debug.LogWarning($"[Arsist] perception.json not found ({req.error}). Image anchors disabled.");
                    yield break;
                }
                json = req.downloadHandler.text;
            }

            JArray targets;
            try
            {
                targets = JObject.Parse(json)["targets"] as JArray;
            }
            catch (Exception e)
            {
                Debug.LogError($"[Arsist] perception.json is malformed: {e.Message}");
                yield break;
            }
            if (targets == null || targets.Count == 0) yield break;

            // 参照写真を読み込み、特徴抽出はワーカースレッドに逃がす
            var pending = new List<(string id, GrayImage image, float w, float h)>();

            foreach (JObject t in targets)
            {
                var id = t["id"]?.ToString();
                var file = t["image"]?.ToString();
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(file)) continue;

                float widthMeters = t["widthMeters"]?.Value<float>() ?? 0f;
                float heightMeters = t["heightMeters"]?.Value<float>() ?? 0f;
                if (widthMeters <= 0f)
                {
                    Debug.LogError($"[Arsist] Perception target '{id}' has no physical width; skipped.");
                    continue;
                }

                var state = new PerceptionTargetState
                {
                    Id = id,
                    Name = t["name"]?.ToString() ?? id,
                    HoldSeconds = Mathf.Max(0.1f, (t["holdMs"]?.Value<float>() ?? 2000f) / 1000f),
                    PhysicalWidth = widthMeters,
                    PhysicalHeight = heightMeters,
                };

                if (t["regions"] is JArray regions)
                {
                    foreach (JObject region in regions)
                    {
                        var regionId = region["id"]?.ToString();
                        var rect = region["rect"] as JObject;
                        if (string.IsNullOrEmpty(regionId) || rect == null) continue;
                        state.Regions[regionId] = new PerceptionRegionRect
                        {
                            X = rect["x"]?.Value<float>() ?? 0f,
                            Y = rect["y"]?.Value<float>() ?? 0f,
                            Width = rect["width"]?.Value<float>() ?? 1f,
                            Height = rect["height"]?.Value<float>() ?? 1f,
                        };
                    }
                }

                _states[id] = state;

                var imageUrl = ToUrl(Path.Combine(dir, file));
                using (var req = UnityWebRequest.Get(imageUrl))
                {
                    req.timeout = 20;
                    yield return req.SendWebRequest();
                    if (req.result != UnityWebRequest.Result.Success)
                    {
                        Debug.LogError($"[Arsist] Reference image not found for '{id}': {req.error}");
                        continue;
                    }

                    var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                    if (!texture.LoadImage(req.downloadHandler.data))
                    {
                        Debug.LogError($"[Arsist] Reference image for '{id}' could not be decoded.");
                        Destroy(texture);
                        continue;
                    }

                    var gray = GrayImageUnity.FromColor32(texture.GetPixels32(), texture.width, texture.height);
                    Destroy(texture);
                    pending.Add((id, gray, widthMeters, heightMeters));
                }
            }

            if (pending.Count == 0) yield break;

            // 特徴抽出は数百 ms かかるのでメインスレッドから外す
            var settings = new FeatureExtractorSettings();
            var built = new List<ReferenceTarget>();
            var buildThread = new Thread(() =>
            {
                foreach (var p in pending)
                {
                    try
                    {
                        built.Add(ReferenceTarget.Build(p.id, p.image, p.w, p.h, settings));
                    }
                    catch (Exception e)
                    {
                        Debug.LogError($"[Arsist] Failed to prepare target '{p.id}': {e.Message}");
                    }
                }
            }) { IsBackground = true, Name = "ArsistPerceptionPrepare" };
            buildThread.Start();
            while (buildThread.IsAlive) yield return null;

            foreach (var target in built)
            {
                // 高さは写真の比率から決まることがあるので、確定値を state に戻す
                if (_states.TryGetValue(target.Id, out var state))
                {
                    state.PhysicalWidth = target.PhysicalWidth;
                    state.PhysicalHeight = target.PhysicalHeight;
                }

                if (!target.IsUsable)
                {
                    Debug.LogWarning(
                        $"[Arsist] Reference image for '{target.Id}' has too few features " +
                        $"({target.Features.Count}); it will probably never be detected. " +
                        "Use a sharper, higher-contrast, less repetitive photo.");
                }
                _references.Add(target);
                Debug.Log($"[Arsist] Perception target ready: {target.Id} " +
                          $"({target.Features.Count} features, {target.PhysicalWidth:F3}x{target.PhysicalHeight:F3} m)");
            }
            _referencesReady = _references.Count > 0;

            StartWorker();
        }

        private static string ToUrl(string path)
        {
            var url = path.Replace('\\', '/');
            if (!url.StartsWith("jar:") && !url.StartsWith("http") && !url.StartsWith("file://"))
                url = "file://" + url;
            return url;
        }

        private void StartWorker()
        {
            _running = true;
            _worker = new Thread(WorkerLoop) { IsBackground = true, Name = "ArsistPerception" };
            _worker.Start();
        }

        private void WorkerLoop()
        {
            while (_running)
            {
                ArsistCameraFrame frame;
                lock (_gate)
                {
                    if (!_hasPendingFrame)
                    {
                        Monitor.Wait(_gate, 50);
                        continue;
                    }
                    frame = _pendingFrame;
                    _hasPendingFrame = false;
                    _pendingFrame = default;
                }

                try
                {
                    var detections = _recognizer.Detect(frame.Image, frame.Intrinsics, _references);
                    if (detections.Count > 0)
                    {
                        lock (_gate)
                        {
                            foreach (var d in detections)
                                _results.Add(new PendingResult { Detection = d, CameraPose = frame.CameraPose });
                        }
                    }
                }
                catch (Exception e)
                {
                    Debug.LogError($"[Arsist] Perception worker failed: {e}");
                }
            }
        }

        private void Update()
        {
            bool wantStill = _stillRequests.Count > 0;

            // 参照画像が1枚も無いプロジェクトでもカメラは要る。
            // viewport ソースのタスクは「カメラ画像の矩形」を読むので、
            // 追跡対象が無くても静止画の供給だけは動いている必要がある。
            if (!_referencesReady && !wantStill) return;

            EnsureSource();

            if (_referencesReady)
            {
                DrainResults();
                UpdateVisibility();
            }

            if (!_sourceReady) return;

            bool workerBusy;
            lock (_gate) workerBusy = _hasPendingFrame;

            bool wantDetection = _referencesReady && !workerBusy && Time.time >= _nextDetectionTime;
            if (!wantStill && !wantDetection) return;

            // 色の変換は静止画を求められたフレームだけ。追跡は輝度で足りる。
            _source.CaptureColor = wantStill && _colorWanted;

            if (!_source.TryAcquire(out var frame) || frame.Image == null) return;

            // 静止画は縮める前のフル解像度で渡す。OCR は枠を切り出して拡大するので、
            // ここで縮めると小さい文字が先に潰れてしまう。
            if (wantStill) DeliverStill(frame);

            if (!wantDetection) return;

            _nextDetectionTime = Time.time + 1f / Mathf.Max(0.2f, CurrentDetectionRate());

            var detectionFrame = Downscale(frame, DetectionMaxWidth);
            lock (_gate)
            {
                _pendingFrame = detectionFrame;
                _hasPendingFrame = true;
                Monitor.Pulse(_gate);
            }
        }

        /// <summary>検出用に縮める。内部パラメータも同じ写像で換算する。</summary>
        private static ArsistCameraFrame Downscale(ArsistCameraFrame frame, int maxWidth)
        {
            if (frame.Image == null || frame.Image.Width <= maxWidth) return frame;

            float scale = (float)maxWidth / frame.Image.Width;
            var scaled = frame.Image.Scaled(scale);
            frame.Intrinsics = ArsistQuestCameraSource.ScaleIntrinsics(
                frame.Intrinsics,
                (double)scaled.Width / frame.Image.Width,
                (double)scaled.Height / frame.Image.Height);
            frame.Image = scaled;
            return frame;
        }

        /// <summary>
        /// 次に取得したフレームを1枚渡す。タスク（OCR 等）が「今の見え方」を
        /// 必要とするときに使う。検出用のフレームを使い回さないのは、
        /// 落ち着いた後は 1Hz まで落ちていて内容が古いことがあるため。
        /// </summary>
        public void RequestStill(Action<PerceptionStill> callback, bool wantColor = false)
        {
            if (callback == null) return;
            // 色の変換は安くないので、要求している間だけ立てる。
            if (wantColor) _colorWanted = true;
            // ここでは可否を判断しない。カメラの用意はこの後 Update が行うので、
            // 早すぎる呼び出しでも次にフレームが取れた時点で応える。
            _stillRequests.Add(callback);
        }

        private void FailPendingStills()
        {
            if (_stillRequests.Count == 0) return;
            var pending = new List<Action<PerceptionStill>>(_stillRequests);
            _stillRequests.Clear();
            _colorWanted = false;
            foreach (var callback in pending)
            {
                try { callback(new PerceptionStill { Valid = false }); }
                catch (Exception e) { Debug.LogError($"[Arsist] Still callback failed: {e}"); }
            }
        }

        private void DeliverStill(ArsistCameraFrame frame)
        {
            var still = new PerceptionStill
            {
                Image = frame.Image,
                Color = frame.Color,
                Intrinsics = frame.Intrinsics,
                CameraPose = frame.CameraPose,
                Valid = true,
            };

            var pending = new List<Action<PerceptionStill>>(_stillRequests);
            _stillRequests.Clear();
            _colorWanted = false;
            foreach (var callback in pending)
            {
                try { callback(still); }
                catch (Exception e) { Debug.LogError($"[Arsist] Still callback failed: {e}"); }
            }
        }

        /// <summary>
        /// ターゲット上の領域を、静止画のピクセル座標の四角形として返す。
        /// 順序は印刷面の 左下・右下・右上・左上（RegionRectifier の規約）。
        /// </summary>
        public bool TryGetRegionQuad(
            string targetId, string regionId, in PerceptionStill still, double[] quad, out string error)
        {
            error = string.Empty;
            if (quad == null || quad.Length < 8) { error = "internal"; return false; }
            if (!still.Valid || still.Image == null) { error = "noFrame"; return false; }

            var state = GetState(targetId);
            if (state == null) { error = "unknownTarget"; return false; }
            if (!state.Localized) { error = "notTracked"; return false; }

            var rect = new PerceptionRegionRect { X = 0, Y = 0, Width = 1, Height = 1 };
            if (!string.IsNullOrEmpty(regionId) && !state.Regions.TryGetValue(regionId, out rect))
            {
                error = "unknownRegion";
                return false;
            }

            // 印刷面での相対位置 (0..1) → 中心原点のメートル
            float x0 = (rect.X - 0.5f) * state.PhysicalWidth;
            float x1 = (rect.X + rect.Width - 0.5f) * state.PhysicalWidth;
            float y0 = (rect.Y - 0.5f) * state.PhysicalHeight;
            float y1 = (rect.Y + rect.Height - 0.5f) * state.PhysicalHeight;

            // 左下・右下・右上・左上（印刷面基準）
            var corners = new[]
            {
                new Vector2(x0, y0), new Vector2(x1, y0),
                new Vector2(x1, y1), new Vector2(x0, y1),
            };

            var inverseCamera = Quaternion.Inverse(still.CameraPose.rotation);

            for (int i = 0; i < 4; i++)
            {
                // アンカーノードのローカル +X は「印刷面の左」なので符号を反転する。
                // （エディタ→Unity の X 反転と辻褄を合わせるため。doc/11-perception.md §3.3）
                var local = new Vector3(-corners[i].x, corners[i].y, 0f);
                var world = state.Position + state.Rotation * local;
                var inCamera = inverseCamera * (world - still.CameraPose.position);

                if (inCamera.z <= 1e-4f) { error = "outOfView"; return false; }

                quad[i * 2] = still.Intrinsics.Fx * inCamera.x / inCamera.z + still.Intrinsics.Cx;
                quad[i * 2 + 1] = still.Intrinsics.Fy * inCamera.y / inCamera.z + still.Intrinsics.Cy;
            }
            return true;
        }

        /// <summary>
        /// 全ターゲットが十分な回数観測されたら、検出レートを落とす。
        /// 姿勢は既にワールドに固定されていて追従の必要が無く、観測を足しても
        /// 平均がほとんど動かなくなるため、そこから先は電力の無駄でしかない。
        /// </summary>
        private float CurrentDetectionRate()
        {
            foreach (var state in _states.Values)
            {
                if (state.ObservationCount < SettledObservationCount) return DetectionRate;
            }
            return SettledDetectionRate;
        }

        private void EnsureSource()
        {
            if (_sourceReady) return;

            if (_source == null)
            {
                _source = SelectSource();
                if (_source == null)
                {
                    // 対応する供給が無いなら諦める（毎フレーム探し続けない）。
                    // 待っている静止画要求にも、黙って放置せず失敗を返す。
                    _referencesReady = false;
                    FailPendingStills();
                    Debug.LogWarning("[Arsist] No camera frame source available on this device; " +
                                     "image anchors and perception tasks will not activate.");
                    return;
                }
                Debug.Log($"[Arsist] Perception camera source: {_source.Description}");
            }

            // Quest はカメラ権限が下りるまで Initialize が false を返し続ける
            if (_source.Initialize()) _sourceReady = true;
        }

        private static IArsistCameraFrameSource SelectSource()
        {
            var quest = new ArsistQuestCameraSource();
            if (quest.IsSupported) return quest;

            var arf = new ArsistARFoundationCameraSource();
            if (arf.IsSupported) return arf;

            // スマホ (Android_Phone) では ArsistDeviceCamera が背面カメラを開いているので、それを借りる。
            // 以前はここ全体が #if UNITY_EDITOR || UNITY_STANDALONE の中にあり、Android では
            // 候補から丸ごと消えていた。スマホで画像処理が一度も動かなかった原因。
            //
            // ヘッドセット (Quest / XREAL) では ArsistDeviceCamera を置かないので、ここには来ない。
            // XREAL の Beam Pro が勝手に手元の端末のカメラを開く、ということは起きない。
            if (Tracking.ArsistDeviceCamera.Instance != null)
            {
                return new ArsistWebcamCameraSource();
            }

#if UNITY_EDITOR || UNITY_STANDALONE
            // エディタとデスクトップでは、手元のウェブカメラで確認できるようにしておく。
            var webcam = new ArsistWebcamCameraSource();
            if (webcam.IsSupported) return webcam;
#endif
            return null;
        }

        private void DrainResults()
        {
            List<PendingResult> batch = null;
            lock (_gate)
            {
                if (_results.Count > 0)
                {
                    batch = new List<PendingResult>(_results);
                    _results.Clear();
                }
            }
            if (batch == null) return;

            foreach (var r in batch) Integrate(r.Detection, r.CameraPose);
        }

        /// <summary>
        /// カメラ座標の検出結果をワールド姿勢に直し、既存の推定に融合する。
        /// </summary>
        private void Integrate(Detection d, Pose cameraPose)
        {
            if (!_states.TryGetValue(d.TargetId, out var state)) return;

            // ソルバのターゲット系: x = 印刷面の右, y = 印刷面の上, z = 面の裏側
            var up = cameraPose.rotation * new Vector3((float)d.Rotation[1], (float)d.Rotation[4], (float)d.Rotation[7]);
            var back = cameraPose.rotation * new Vector3((float)d.Rotation[2], (float)d.Rotation[5], (float)d.Rotation[8]);
            var normal = -back; // 面から手前（見る側）へ

            var position = cameraPose.position + cameraPose.rotation *
                           new Vector3((float)d.Tx, (float)d.Ty, (float)d.Tz);

            // アンカーノードの回転は LookRotation(法線, 印刷面の上)。
            // これで right = -印刷面の右 になり、エディタ→Unity の X 反転と辻褄が合う。
            // 詳細は doc/11-perception.md の「handedness trap」。
            var rotation = Quaternion.LookRotation(normal, up);

            float distance = Vector3.Distance(position, cameraPose.position);

            // 重み: インライアが多く、再投影誤差が小さく、近いほど信頼できる
            double weight = d.InlierCount / (1.0 + d.Rmse * d.Rmse) / (1.0 + distance * distance);
            if (weight <= 0) return;

            // 十分な観測が溜まった後に大きく外れた観測は、誤検出とみなして捨てる
            if (state.ObservationCount >= 3)
            {
                if (Vector3.Distance(position, state.Position) > 0.25f) return;
                if (Quaternion.Angle(rotation, state.Rotation) > 25f) return;
            }

            state.WeightSum += weight;
            state.WeightedPosition += position * (float)weight;

            // クォータニオンの重み付き平均。符号を揃えてから足す。
            var q = new Vector4(rotation.x, rotation.y, rotation.z, rotation.w);
            if (state.ObservationCount > 0 && Vector4.Dot(q, state.WeightedRotation) < 0) q = -q;
            state.WeightedRotation += q * (float)weight;

            state.ObservationCount++;
            state.LastSeenTime = Time.time;
            state.LastRmse = d.Rmse;

            state.Position = state.WeightedPosition / (float)state.WeightSum;
            var acc = state.WeightedRotation;
            float len = acc.magnitude;
            if (len > 1e-6f)
            {
                acc /= len;
                state.Rotation = new Quaternion(acc.x, acc.y, acc.z, acc.w);
            }

            if (!state.Localized)
            {
                state.Localized = true;
                Debug.Log($"[Arsist] Perception target localized: {state.Id} " +
                          $"(inliers={d.InlierCount}, rmse={d.Rmse:F2}px, distance={distance:F2}m)");
            }
        }

        private void UpdateVisibility()
        {
            foreach (var state in _states.Values)
            {
                bool visible = state.Localized && (Time.time - state.LastSeenTime) <= state.HoldSeconds;
                if (visible == state.Visible) continue;

                state.Visible = visible;
                // ハンドラが無いのが普通なので、未登録警告は出さない
                ArsistScriptEvent.Fire(
                    visible ? $"perception.found:{state.Id}" : $"perception.lost:{state.Id}",
                    warnIfUnhandled: false);
            }
        }

        private void OnDestroy()
        {
            _running = false;
            lock (_gate) Monitor.PulseAll(_gate);
            _source?.Shutdown();
            if (Instance == this) Instance = null;
        }
    }
}
