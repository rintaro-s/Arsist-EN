// ==============================================
// Arsist Engine - Perception
// 「所定のアクションで、指定の枠の中を読む」の実行役
//
// 流れ:
//   トリガ (ボタン/スクリプト/定期/起動時)
//     → 静止画を1枚もらう
//     → 枠をワールドへ投影して正対化 (RegionRectifier)
//     → 文字認識 (IArsistTextRecognizer)
//     → DataStore に書く + イベントを発火
//
// 結果を DataStore に「辞書ひとつ」で書くのが肝で、UI の bind から
// <storeAs>.text / <storeAs>.status がそのまま読める。
// おかげでボタン→OCR→表示がスクリプト0行で成立する。
// ==============================================

using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Perception.Text;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Overlay;
using Arsist.Runtime.Perception.Vision.Classic;
using Arsist.Runtime.Scripting;
using UnityEngine.UI;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace Arsist.Runtime.Perception
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistPerceptionTaskRunner : MonoBehaviour
    {
        public static ArsistPerceptionTaskRunner Instance { get; private set; }

        /// <summary>正対化後の長辺の上限 (px)。大きくしても撮れていない解像度は戻らない。</summary>
        private const int MaxRectifiedSide = 900;

        private sealed class TaskDefinition
        {
            public string Id;
            public string Name;
            public string Type = "ocr";
            public string SourceKind = "region";
            public string TargetId;
            public string RegionId;
            public Rect ViewportRect = new Rect(0.25f, 0.35f, 0.5f, 0.3f);
            public string TriggerType = "manual";
            public string TriggerValue;
            public float IntervalSeconds;
            public string StoreAs;
            public string EngineKind = "mlkit";
            public string Script = "japanese";
            public string MockText;
            /// <summary>type == "analyze" のときの設定。</summary>
            public ClassicAnalysisConfig Analysis;
            /// <summary>空の塗り替え結果を出す Image 要素の bindingId ('image' 表示のとき)。</summary>
            public string PreviewBindingId;
            /// <summary>'world' = パススルーの上に直接重ねる。'image' = Canvas に出す。</summary>
            public string Display = "world";
            public double RepaintStrength = 1.0;

            /// <summary>色つきの静止画が要るか。古典的な処理は色を見る。</summary>
            public bool NeedsColor => Type == "analyze";

            public bool Running;
            public float NextRunTime;
            public TextResult LastResult;
            public ClassicAnalysisResult LastAnalysis;
            public Texture2D PreviewTexture;
            public Sprite PreviewSprite;
            public Action EventHandler;
        }

        private readonly Dictionary<string, TaskDefinition> _tasks = new Dictionary<string, TaskDefinition>();
        private readonly Dictionary<string, IArsistTextRecognizer> _recognizers =
            new Dictionary<string, IArsistTextRecognizer>();
        private bool _ready;

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
            StartCoroutine(LoadTasks());
        }

        private IEnumerator LoadTasks()
        {
            var path = Path.Combine(Application.streamingAssetsPath, "Perception", "perception.json");
            var url = path.Replace('\\', '/');
            if (!url.StartsWith("jar:") && !url.StartsWith("http") && !url.StartsWith("file://"))
                url = "file://" + url;

            string json = null;
            using (var request = UnityWebRequest.Get(url))
            {
                request.timeout = 10;
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success) yield break;
                json = request.downloadHandler.text;
            }

            JArray tasks;
            try
            {
                tasks = JObject.Parse(json)["tasks"] as JArray;
            }
            catch (Exception e)
            {
                Debug.LogError($"[Arsist] perception.json tasks are malformed: {e.Message}");
                yield break;
            }
            if (tasks == null || tasks.Count == 0) yield break;

            foreach (JObject entry in tasks)
            {
                var task = Parse(entry);
                if (task == null) continue;
                _tasks[task.Id] = task;
                SetStatus(task, "idle", null);
                RegisterTrigger(task);
                Debug.Log($"[Arsist] Perception task ready: {task.Id} " +
                          $"({task.Type}, trigger={task.TriggerType}{(task.TriggerValue != null ? ":" + task.TriggerValue : "")}, " +
                          $"engine={task.EngineKind}, storeAs={task.StoreAs})");
            }
            _ready = true;
        }

        private static TaskDefinition Parse(JObject entry)
        {
            var id = entry["id"]?.ToString();
            var storeAs = entry["storeAs"]?.ToString();
            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(storeAs))
            {
                Debug.LogWarning("[Arsist] Perception task without id/storeAs; skipped.");
                return null;
            }

            var task = new TaskDefinition
            {
                Id = id,
                Name = entry["name"]?.ToString() ?? id,
                Type = entry["type"]?.ToString() ?? "ocr",
                StoreAs = storeAs,
            };

            if (entry["source"] is JObject source)
            {
                task.SourceKind = source["kind"]?.ToString() ?? "region";
                task.TargetId = source["targetId"]?.ToString();
                task.RegionId = source["regionId"]?.ToString();
                if (source["rect"] is JObject rect)
                {
                    task.ViewportRect = new Rect(
                        rect["x"]?.Value<float>() ?? 0.25f,
                        rect["y"]?.Value<float>() ?? 0.35f,
                        rect["width"]?.Value<float>() ?? 0.5f,
                        rect["height"]?.Value<float>() ?? 0.3f);
                }
            }

            if (entry["trigger"] is JObject trigger)
            {
                task.TriggerType = trigger["type"]?.ToString() ?? "manual";
                var value = trigger["value"];
                if (value != null)
                {
                    task.TriggerValue = value.ToString();
                    if (task.TriggerType == "interval")
                    {
                        // ミリ秒指定。連射すると発熱するので下限を設ける。
                        task.IntervalSeconds = Mathf.Max(0.5f, value.Value<float>() / 1000f);
                    }
                }
            }

            if (entry["analysis"] is JObject analysis)
            {
                task.Analysis = ParseAnalysis(analysis);
                task.PreviewBindingId = analysis["previewBindingId"]?.ToString();
                task.Display = analysis["display"]?.ToString() == "image" ? "image" : "world";
                task.RepaintStrength = analysis["repaintStrength"]?.Value<double>() ?? 1.0;
            }
            else if (task.Type == "analyze")
            {
                task.Analysis = new ClassicAnalysisConfig();
            }

            if (entry["engine"] is JObject engine)
            {
                task.EngineKind = engine["kind"]?.ToString() ?? "mlkit";
                task.Script = engine["script"]?.ToString() ?? "japanese";
                task.MockText = engine["mockText"]?.ToString();
            }

            return task;
        }

        /// <summary>解析タスクの設定を読む。範囲は省略可で、既定は ClassicAnalysisConfig 側に置く。</summary>
        private static ClassicAnalysisConfig ParseAnalysis(JObject analysis)
        {
            var config = new ClassicAnalysisConfig();

            switch (analysis["kind"]?.ToString())
            {
                case "blobs": config.Kind = ClassicAnalysisKind.Blobs; break;
                case "shapes": config.Kind = ClassicAnalysisKind.Shapes; break;
                case "sky": config.Kind = ClassicAnalysisKind.Sky; break;
                default: config.Kind = ClassicAnalysisKind.Color; break;
            }

            if (analysis["hue"] is JObject hue)
            {
                config.HueMin = hue["min"]?.Value<int>() ?? config.HueMin;
                config.HueMax = hue["max"]?.Value<int>() ?? config.HueMax;
            }
            if (analysis["saturation"] is JObject saturation)
            {
                config.SatMin = saturation["min"]?.Value<int>() ?? config.SatMin;
                config.SatMax = saturation["max"]?.Value<int>() ?? config.SatMax;
            }
            if (analysis["value"] is JObject value)
            {
                config.ValMin = value["min"]?.Value<int>() ?? config.ValMin;
                config.ValMax = value["max"]?.Value<int>() ?? config.ValMax;
            }

            config.MinArea = analysis["minArea"]?.Value<int>() ?? config.MinArea;
            config.MaxItems = analysis["maxItems"]?.Value<int>() ?? config.MaxItems;
            config.MaxWidth = analysis["maxWidth"]?.Value<int>() ?? config.MaxWidth;
            return config;
        }

        private void RegisterTrigger(TaskDefinition task)
        {
            switch (task.TriggerType)
            {
                case "onStart":
                    Run(task.Id, null);
                    break;
                case "interval":
                    task.NextRunTime = Time.time + task.IntervalSeconds;
                    break;
                case "event":
                    if (!string.IsNullOrEmpty(task.TriggerValue))
                    {
                        // UI ボタンの bindingId をそのまま購読する。
                        // これがあるので「ボタン→OCR→表示」がスクリプト0行で組める。
                        task.EventHandler = () => Run(task.Id, null);
                        ArsistScriptEvent.Register(task.TriggerValue, task.EventHandler);
                    }
                    break;
            }
        }

        private void Update()
        {
            if (!_ready) return;
            foreach (var task in _tasks.Values)
            {
                if (task.TriggerType != "interval" || task.Running) continue;
                if (Time.time < task.NextRunTime) continue;
                task.NextRunTime = Time.time + task.IntervalSeconds;
                Run(task.Id, null);
            }
        }

        /// <summary>直近の結果。まだ実行していなければ null。</summary>
        public TextResult GetLastResult(string taskId)
        {
            return _tasks.TryGetValue(taskId, out var task) ? task.LastResult : null;
        }

        public bool HasTask(string taskId) => _tasks.ContainsKey(taskId);

        /// <summary>タスクを実行する。完了は callback / DataStore / イベントの3経路で分かる。</summary>
        public void Run(string taskId, Action<TextResult> callback)
        {
            if (!_tasks.TryGetValue(taskId, out var task))
            {
                Debug.LogWarning($"[Arsist] Unknown perception task: {taskId}");
                callback?.Invoke(TextResult.Failure("unknownTask"));
                return;
            }

            if (task.Running)
            {
                // 二重起動しない。ボタン連打で同じ認識を何度も走らせないため。
                callback?.Invoke(TextResult.Failure("busy"));
                return;
            }

            var manager = ArsistPerceptionManager.Instance;
            if (manager == null)
            {
                Finish(task, TextResult.Failure("noCamera"), callback);
                return;
            }

            task.Running = true;
            SetStatus(task, "running", null);

            manager.RequestStill((still) => OnStill(task, still, callback), task.NeedsColor);
        }

        private void OnStill(TaskDefinition task, PerceptionStill still, Action<TextResult> callback)
        {
            if (!still.Valid || still.Image == null)
            {
                Finish(task, TextResult.Failure("noFrame"), callback);
                return;
            }

            if (!TryCrop(task, still, out var crop, out var error))
            {
                Finish(task, TextResult.Failure(error), callback);
                return;
            }

            if (task.Type == "analyze")
            {
                RunAnalysis(task, still, callback);
                return;
            }

            if (task.Type == "capture")
            {
                // 画素を取るだけのタスク。文字認識は行わない。
                var result = TextResult.Success(string.Empty, 0);
                Debug.Log($"[Arsist] Task '{task.Id}' captured {crop.Width}x{crop.Height}");
                Finish(task, result, callback);
                return;
            }

            var recognizer = ResolveRecognizer(task);
            if (recognizer == null || !recognizer.IsAvailable)
            {
                Finish(task, TextResult.Failure("engineUnavailable"), callback);
                return;
            }

            var image = new RgbaImage
            {
                Pixels = GrayImageUnity.ToRgbaTopDown(crop),
                Width = crop.Width,
                Height = crop.Height,
            };
            recognizer.Recognize(image, task.Script, (result) => Finish(task, result, callback));
        }

        /// <summary>
        /// 古典的な画像処理を掛ける。OCR と違って端末側の実装に頼らないので、
        /// 対応端末かどうかを気にせず動く。
        /// </summary>
        private void RunAnalysis(TaskDefinition task, in PerceptionStill still, Action<TextResult> callback)
        {
            if (still.Color == null)
            {
                // 色の変換は要求されたフレームでしか行わない。撮り直せば次は入る。
                Finish(task, TextResult.Failure("noColorFrame"), callback);
                return;
            }

            if (!TryCropColor(task, still, out var crop, out int cropX, out int cropY, out var cropError))
            {
                Finish(task, TextResult.Failure(cropError), callback);
                return;
            }

            var started = DateTime.UtcNow;
            ClassicAnalysisResult analysis;
            try
            {
                analysis = ClassicAnalyzer.Analyze(crop, task.Analysis);
            }
            catch (Exception e)
            {
                Debug.LogError($"[Arsist] Analysis '{task.Id}' threw: {e}");
                Finish(task, TextResult.Failure("analysisFailed"), callback);
                return;
            }

            int elapsedMs = (int)(DateTime.UtcNow - started).TotalMilliseconds;
            if (!analysis.Ok)
            {
                Finish(task, TextResult.Failure(analysis.Error), callback);
                return;
            }

            if (task.Display == "image")
            {
                ShowPreview(task, analysis);
            }
            else
            {
                ShowOverlay(task, analysis, still, crop, cropX, cropY);
            }

            // 数値は辞書で、要約は text で返す。UI からはどちらでも bind できる。
            task.LastAnalysis = analysis;
            var summary = Summarise(task, analysis);
            var result = TextResult.Success(summary, elapsedMs);
            Finish(task, result, callback);
        }

        /// <summary>
        /// 塗り替えた空を、パススルーで見えている空そのものの上に重ねる。
        ///
        /// 解析に渡した画は「静止画 → 矩形で切り出し → 縮小」と二段階で変形しているので、
        /// 内部パラメータもそのぶん換算しないと、青空が空からずれた場所に貼り付く。
        /// </summary>
        private static void ShowOverlay(
            TaskDefinition task, ClassicAnalysisResult analysis, in PerceptionStill still,
            ColorImage crop, int cropX, int cropY)
        {
            var overlay = ArsistSkyOverlay.Instance;
            if (overlay == null)
            {
                Debug.LogWarning($"[Arsist] No ArsistSkyOverlay in the scene; task '{task.Id}' has nothing to draw into.");
                return;
            }

            if (analysis.Sky == null || analysis.Processed == null || !analysis.Sky.Found)
            {
                // 空が見つからないときに前の絵を残すと、明後日の方向に青が貼り付いたままになる。
                overlay.Hide();
                return;
            }

            if (task.SourceKind != "viewport")
            {
                // 領域ソースは正対化で幾何が変わるので、そのままでは現実に戻せない。
                Debug.LogWarning($"[Arsist] Task '{task.Id}' draws into the world but its source is a region; " +
                                 "use a viewport source for world overlays.");
                overlay.Hide();
                return;
            }

            double scale = (double)analysis.Processed.Width / Math.Max(1, crop.Width);
            var intrinsics = ViewportMapping.ForCrop(still.Intrinsics, cropX, cropY, scale);

            var painted = SkySegmenter.Repaint(analysis.Processed, analysis.Sky, task.RepaintStrength);
            overlay.Show(painted, analysis.Sky.Mask, intrinsics, still.CameraPose);
        }

        /// <summary>空の塗り替え結果を Image 要素に出す（確認用）。</summary>
        private static void ShowPreview(TaskDefinition task, ClassicAnalysisResult analysis)
        {
            if (string.IsNullOrEmpty(task.PreviewBindingId)) return;
            if (analysis.Sky == null || analysis.Processed == null) return;

            var target = UiBindingLookup.Find(task.PreviewBindingId);
            if (target == null)
            {
                Debug.LogWarning($"[Arsist] Preview target '{task.PreviewBindingId}' not found for task '{task.Id}'");
                return;
            }

            var painted = SkySegmenter.Repaint(analysis.Processed, analysis.Sky, task.RepaintStrength);

            // 毎回 Texture2D を作ると溜まるので、大きさが同じなら使い回す。
            var raw = target.GetComponent<RawImage>();
            var image = raw == null ? target.GetComponent<Image>() : null;

            var texture = task.PreviewTexture;
            if (texture == null || texture.width != painted.Width || texture.height != painted.Height)
            {
                if (texture != null) Destroy(texture);
                texture = new Texture2D(painted.Width, painted.Height, TextureFormat.RGBA32, false);
                task.PreviewTexture = texture;
            }
            ColorImageUnity.WriteTo(painted, texture);
            texture.Apply(false);

            if (raw != null)
            {
                raw.texture = texture;
                raw.color = Color.white;
            }
            else if (image != null)
            {
                // Image は Sprite しか受けない。Sprite も作り直しになるが、
                // 表示は毎フレームではないので実害はない。
                if (task.PreviewSprite != null) Destroy(task.PreviewSprite);
                task.PreviewSprite = Sprite.Create(
                    texture, new Rect(0, 0, texture.width, texture.height), new Vector2(0.5f, 0.5f));
                image.sprite = task.PreviewSprite;
                image.color = Color.white;
            }
            else
            {
                Debug.LogWarning($"[Arsist] '{task.PreviewBindingId}' has no Image/RawImage to draw into");
            }
        }

        /// <summary>ログと text バインドのための一行要約。</summary>
        private static string Summarise(TaskDefinition task, ClassicAnalysisResult analysis)
        {
            switch (task.Analysis.Kind)
            {
                case ClassicAnalysisKind.Color:
                    return $"{analysis.Values["name"]} {analysis.Values["hex"]}";
                case ClassicAnalysisKind.Blobs:
                    return $"{analysis.Values["count"]} blob(s)";
                case ClassicAnalysisKind.Shapes:
                    return $"{analysis.Values["count"]} shape(s)";
                case ClassicAnalysisKind.Sky:
                    return $"{analysis.Values["condition"]} ({analysis.Values["coverage"]})";
                default:
                    return string.Empty;
            }
        }

        /// <summary>
        /// 解析用に色つきで切り出す。正対化はチャンネルごとに掛けて戻す。
        ///
        /// cropX / cropY は切り出しの原点 (静止画のピクセル座標)。現実に重ねて描くとき、
        /// ここを渡さないと画素と光線の対応が取れず、青空が空からずれる。
        /// </summary>
        private bool TryCropColor(
            TaskDefinition task, in PerceptionStill still,
            out ColorImage crop, out int cropX, out int cropY, out string error)
        {
            crop = null;
            cropX = 0;
            cropY = 0;

            if (task.SourceKind == "viewport")
            {
                var image = still.Color;
                int x0 = Mathf.Clamp(Mathf.RoundToInt(task.ViewportRect.x * image.Width), 0, image.Width - 1);
                int y0 = Mathf.Clamp(Mathf.RoundToInt(task.ViewportRect.y * image.Height), 0, image.Height - 1);
                int w = Mathf.Clamp(Mathf.RoundToInt(task.ViewportRect.width * image.Width), 8, image.Width - x0);
                int h = Mathf.Clamp(Mathf.RoundToInt(task.ViewportRect.height * image.Height), 8, image.Height - y0);
                if (w < 8 || h < 8) { error = "regionTooSmall"; return false; }

                cropX = x0;
                cropY = y0;
                crop = new ColorImage(w, h);
                for (int y = 0; y < h; y++)
                {
                    Array.Copy(image.Data, ((y0 + y) * image.Width + x0) * 3, crop.Data, y * w * 3, w * 3);
                }
                error = string.Empty;
                return true;
            }

            // ターゲット上の領域。RegionRectifier は輝度用なので、R/G/B を別々に通す。
            var channels = new GrayImage[3];
            for (int c = 0; c < 3; c++)
            {
                var channel = still.Color.Channel(c);
                var monoStill = new PerceptionStill
                {
                    Image = channel,
                    Intrinsics = still.Intrinsics,
                    CameraPose = still.CameraPose,
                    Valid = true,
                };
                if (!TryCrop(task, monoStill, out channels[c], out error)) return false;
            }

            crop = ColorImage.Combine(channels[0], channels[1], channels[2]);
            error = string.Empty;
            return crop != null;
        }

        /// <summary>枠を切り出して正対化する。</summary>
        private bool TryCrop(
            TaskDefinition task, in PerceptionStill still,
            out GrayImage crop, out string error)
        {
            crop = null;
            error = string.Empty;

            if (task.SourceKind == "viewport")
            {
                // ターゲット不要。画面の枠をそのまま切り出す（正対化は不要）。
                return TryCropViewport(task, still, out crop, out error);
            }

            var manager = ArsistPerceptionManager.Instance;
            var quad = new double[8];
            if (!manager.TryGetRegionQuad(task.TargetId, task.RegionId, still, quad, out error)) return false;

            var state = manager.GetState(task.TargetId);
            double physicalWidth = state.PhysicalWidth;
            double physicalHeight = state.PhysicalHeight;
            if (!string.IsNullOrEmpty(task.RegionId) && state.Regions.TryGetValue(task.RegionId, out var rect))
            {
                physicalWidth *= rect.Width;
                physicalHeight *= rect.Height;
            }

            double area = Math.Abs(RegionRectifier.QuadArea(quad));
            RegionRectifier.ChooseOutputSize(physicalWidth, physicalHeight, area, MaxRectifiedSide,
                out int outWidth, out int outHeight);
            if (outWidth <= 0 || outHeight <= 0) { error = "badTargetSize"; return false; }

            var status = RegionRectifier.TryRectify(still.Image, quad, outWidth, outHeight, out crop);
            if (status != RectifyStatus.Ok)
            {
                error = status == RectifyStatus.OutOfView ? "outOfView"
                      : status == RectifyStatus.TooOblique ? "tooOblique"
                      : "degenerate";
                return false;
            }

            Debug.Log($"[Arsist] Task '{task.Id}' rectified {outWidth}x{outHeight} from a {area:F0}px quad");
            return true;
        }

        private static bool TryCropViewport(
            TaskDefinition task, in PerceptionStill still,
            out GrayImage crop, out string error)
        {
            crop = null;
            error = string.Empty;

            var image = still.Image;
            int x0 = Mathf.Clamp(Mathf.RoundToInt(task.ViewportRect.x * image.Width), 0, image.Width - 1);
            int y0 = Mathf.Clamp(Mathf.RoundToInt(task.ViewportRect.y * image.Height), 0, image.Height - 1);
            int w = Mathf.Clamp(Mathf.RoundToInt(task.ViewportRect.width * image.Width), 8, image.Width - x0);
            int h = Mathf.Clamp(Mathf.RoundToInt(task.ViewportRect.height * image.Height), 8, image.Height - y0);

            if (w < 8 || h < 8) { error = "regionTooSmall"; return false; }

            crop = new GrayImage(w, h);
            for (int y = 0; y < h; y++)
            {
                Array.Copy(image.Data, (y0 + y) * image.Width + x0, crop.Data, y * w, w);
            }
            return true;
        }

        private IArsistTextRecognizer ResolveRecognizer(TaskDefinition task)
        {
            var key = task.EngineKind == "mock" ? "mock:" + task.Id : task.EngineKind;
            if (_recognizers.TryGetValue(key, out var existing)) return existing;

            IArsistTextRecognizer recognizer = task.EngineKind == "mock"
                ? new MockTextRecognizer(task.MockText)
                : (IArsistTextRecognizer)new MlKitTextRecognizer();

            _recognizers[key] = recognizer;
            Debug.Log($"[Arsist] Perception engine for '{task.Id}': {recognizer.Description}");
            return recognizer;
        }

        private void Finish(TaskDefinition task, TextResult result, Action<TextResult> callback)
        {
            task.Running = false;
            task.LastResult = result;
            if (!result.Ok) task.LastAnalysis = null;

            SetStatus(task, result.Ok ? "ok" : "error", result, task.LastAnalysis);

            ArsistScriptEvent.Fire(
                result.Ok ? $"perception.task.done:{task.Id}" : $"perception.task.failed:{task.Id}",
                warnIfUnhandled: false);

            if (result.Ok)
            {
                Debug.Log($"[Arsist] Task '{task.Id}' -> \"{Shorten(result.Text)}\" ({result.ElapsedMs} ms)");
            }
            else
            {
                Debug.LogWarning($"[Arsist] Task '{task.Id}' failed: {result.Error}");
            }

            try { callback?.Invoke(result); }
            catch (Exception e) { Debug.LogError($"[Arsist] Task callback failed: {e}"); }
        }

        /// <summary>
        /// DataStore に辞書ひとつで書く。ArsistUIBinding はドットパスを辿るので、
        /// これだけで <storeAs>.text / .status / .error が UI から参照できる。
        /// </summary>
        private static void SetStatus(
            TaskDefinition task, string status, TextResult result,
            ClassicAnalysisResult analysis = null)
        {
            var payload = new Dictionary<string, object>
            {
                ["status"] = status,
                ["text"] = result != null && result.Ok ? result.Text : string.Empty,
                ["lines"] = result != null && result.Ok ? result.Lines : Array.Empty<string>(),
                ["error"] = result != null && !result.Ok ? result.Error : string.Empty,
                ["elapsedMs"] = result?.ElapsedMs ?? 0,
                ["at"] = DateTime.UtcNow.ToString("o"),
            };

            // 解析結果は同じ辞書に並べて入れる。<storeAs>.coverage のように
            // status/text と同じ書き方で bind できるようにするため。
            if (analysis != null && analysis.Ok && status == "ok")
            {
                foreach (var pair in analysis.Values)
                {
                    if (payload.ContainsKey(pair.Key)) continue;
                    payload[pair.Key] = pair.Value;
                }
            }

            ArsistDataStore.Instance.SetValue(task.StoreAs, payload);
        }

        private static string Shorten(string text)
        {
            if (string.IsNullOrEmpty(text)) return string.Empty;
            var single = text.Replace("\n", " / ");
            return single.Length <= 80 ? single : single.Substring(0, 80) + "...";
        }

        private void OnDestroy()
        {
            foreach (var task in _tasks.Values)
            {
                if (task.EventHandler != null && !string.IsNullOrEmpty(task.TriggerValue))
                {
                    ArsistScriptEvent.Unregister(task.TriggerValue, task.EventHandler);
                }
            }
            foreach (var task in _tasks.Values)
            {
                if (task.PreviewSprite != null) Destroy(task.PreviewSprite);
                if (task.PreviewTexture != null) Destroy(task.PreviewTexture);
            }
            if (Instance == this) Instance = null;
        }
    }
}
