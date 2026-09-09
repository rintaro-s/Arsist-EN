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
using Arsist.Runtime.Scripting;
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

            public bool Running;
            public float NextRunTime;
            public TextResult LastResult;
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

            if (entry["engine"] is JObject engine)
            {
                task.EngineKind = engine["kind"]?.ToString() ?? "mlkit";
                task.Script = engine["script"]?.ToString() ?? "japanese";
                task.MockText = engine["mockText"]?.ToString();
            }

            return task;
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

            manager.RequestStill((still) => OnStill(task, still, callback));
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

            SetStatus(task, result.Ok ? "ok" : "error", result);

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
        private static void SetStatus(TaskDefinition task, string status, TextResult result)
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
            if (Instance == this) Instance = null;
        }
    }
}
