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
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Perception.Text;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Overlay;
using Arsist.Runtime.Perception.Pipeline;
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
            /// <summary>type == "vision" のときに流すパイプライン。</summary>
            public VisionPipelineSpec Pipeline;
            /// <summary>
            /// テンプレート画像。Texture2D の読み込みはメインスレッドでしかできないので、
            /// ワーカーに渡す前にここへ読んでおく (一度読めば使い回す)。
            /// </summary>
            public Dictionary<string, GrayImage> Templates;

            /// <summary>色つきの静止画が要るか。画像処理は色を見る。</summary>
            public bool NeedsColor => Type == "vision";

            public bool Running;
            public float NextRunTime;
            public TextResult LastResult;
            public VisionPipelineResult LastPipelineResult;
            public Texture2D PreviewTexture;
            public Sprite PreviewSprite;
            public Action EventHandler;
        }

        private readonly Dictionary<string, TaskDefinition> _tasks = new Dictionary<string, TaskDefinition>();

        /// <summary>
        /// ワーカーで終わった仕事の後始末 (テクスチャの更新、DataStore、イベント) を
        /// メインスレッドで行うためのキュー。Unity の API はメインスレッドからしか触れない。
        /// </summary>
        private readonly ConcurrentQueue<Action> _mainThreadWork = new ConcurrentQueue<Action>();
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
                        // ミリ秒指定。下限は 0.1 秒。
                        // 以前は 0.5 秒だったが、それは画像処理がメインスレッドで回っていた頃の
                        // 発熱と引っかかり対策。今はワーカーで回し、前の回が終わるまで次は起動しない
                        // (Running) ので、短くしても溜まらない。現実に重ねる用途では、
                        // 0.5 秒の遅れは「首を振っても追いつかない」として見えてしまう。
                        task.IntervalSeconds = Mathf.Max(0.1f, value.Value<float>() / 1000f);
                    }
                }
            }

            if (entry["pipeline"] is JObject pipeline)
            {
                task.Pipeline = ParsePipeline(pipeline);
            }

            if (entry["engine"] is JObject engine)
            {
                task.EngineKind = engine["kind"]?.ToString() ?? "mlkit";
                task.Script = engine["script"]?.ToString() ?? "japanese";
                task.MockText = engine["mockText"]?.ToString();
            }

            return task;
        }

        /// <summary>
        /// パイプラインを読む。中身の検証は VisionPipelineRunner.Validate に任せる
        /// (ビルド時にも同じものが走るので、実機に来る前に大半は落ちている)。
        /// </summary>
        private static VisionPipelineSpec ParsePipeline(JObject json)
        {
            var pipeline = new VisionPipelineSpec
            {
                Id = json["id"]?.ToString(),
                Name = json["name"]?.ToString(),
                MaxWidth = json["maxWidth"]?.Value<int>() ?? 480,
            };

            if (json["ops"] is JArray ops)
            {
                foreach (JObject entry in ops)
                {
                    var op = new VisionOpSpec
                    {
                        Id = entry["id"]?.ToString(),
                        Op = entry["op"]?.ToString(),
                        Out = entry["out"]?.ToString(),
                    };

                    if (entry["in"] is JArray inputs)
                    {
                        var names = new List<string>();
                        foreach (var name in inputs)
                        {
                            var text = name?.ToString();
                            if (!string.IsNullOrEmpty(text)) names.Add(text);
                        }
                        op.In = names.ToArray();
                    }

                    if (entry["params"] is JObject parameters)
                    {
                        foreach (var property in parameters.Properties())
                        {
                            op.Params[property.Name] = ToPlain(property.Value);
                        }
                    }
                    pipeline.Ops.Add(op);
                }
            }

            if (json["outputs"] is JArray outputs)
            {
                foreach (JObject entry in outputs)
                {
                    pipeline.Outputs.Add(new VisionOutputSpec
                    {
                        Kind = entry["kind"]?.ToString() ?? "store",
                        Value = entry["value"]?.ToString(),
                        Alpha = entry["alpha"]?.ToString(),
                        StoreAs = entry["storeAs"]?.ToString(),
                        BindingId = entry["bindingId"]?.ToString(),
                    });
                }
            }

            return pipeline;
        }

        /// <summary>JToken を素の値にする。op のパラメータは数・真偽・文字列しか取らない。</summary>
        private static object ToPlain(JToken token)
        {
            if (token == null) return null;
            switch (token.Type)
            {
                case JTokenType.Integer: return token.Value<long>();
                case JTokenType.Float: return token.Value<double>();
                case JTokenType.Boolean: return token.Value<bool>();
                case JTokenType.Null: return null;
                default: return token.ToString();
            }
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
            while (_mainThreadWork.TryDequeue(out var work))
            {
                try { work(); }
                catch (Exception e) { Debug.LogError($"[Arsist] Perception completion failed: {e}"); }
            }

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

            if (task.Type == "vision")
            {
                RunPipeline(task, still, callback);
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
        /// パイプラインを流す。
        ///
        /// エンジンはここで「何を探しているか」を一切知らない。op を順に適用して、
        /// 宣言された出力先に配るだけ。何が出来上がるかはプロジェクト側の組み方で決まる。
        /// </summary>
        private void RunPipeline(TaskDefinition task, in PerceptionStill still, Action<TextResult> callback)
        {
            if (task.Pipeline == null)
            {
                Finish(task, TextResult.Failure("noPipeline"), callback);
                return;
            }
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

            // パイプラインはワーカーで回す。
            //
            // 以前はここで同期的に回していて、1 回 100〜160ms (実機のログ) メインスレッドが止まり、
            // 更新のたびに画面がカクついた。VisionPipelineRunner は UnityEngine に触れないように
            // 作ってあるので、そのままスレッドに出せる。Unity に触る後始末だけメインに戻す。
            var templates = EnsureTemplates(task);
            var pipeline = task.Pipeline;
            var capturedStill = still;   // in 引数はラムダに持ち込めないので写す
            var started = DateTime.UtcNow;

            ThreadPool.QueueUserWorkItem(_ =>
            {
                VisionPipelineResult result = null;
                Exception failure = null;
                try
                {
                    result = VisionPipelineRunner.Run(pipeline, crop,
                        name => name != null && templates.TryGetValue(name, out var t) ? t : null);
                }
                catch (Exception e)
                {
                    failure = e;
                }

                int elapsedMs = (int)(DateTime.UtcNow - started).TotalMilliseconds;
                _mainThreadWork.Enqueue(() =>
                    CompletePipeline(task, capturedStill, crop, cropX, cropY, result, failure, elapsedMs, callback));
            });
        }

        /// <summary>ワーカーで回したパイプラインの後始末。メインスレッドで呼ばれる。</summary>
        private void CompletePipeline(
            TaskDefinition task, PerceptionStill still, ColorImage crop, int cropX, int cropY,
            VisionPipelineResult result, Exception failure, int elapsedMs, Action<TextResult> callback)
        {
            if (failure != null)
            {
                Debug.LogError($"[Arsist] Pipeline '{task.Id}' threw: {failure}");
                Finish(task, TextResult.Failure("pipelineFailed"), callback);
                return;
            }
            if (result == null || !result.Ok)
            {
                Finish(task, TextResult.Failure(result?.Error ?? "pipelineFailed"), callback);
                return;
            }

            task.LastPipelineResult = result;
            DrawOutputs(task, result, still, crop, cropX, cropY);

            // 門が閉じた（「見つからなかった」）のは失敗ではない。測った値は返す。
            var summary = result.Gated ? $"gated: {result.GateReason}" : Summarise(result);
            Finish(task, TextResult.Success(summary, elapsedMs), callback);
        }

        /// <summary>
        /// パイプラインが使うテンプレート画像を、メインスレッドで先に読んでおく。
        /// ワーカーから Texture2D を触ると落ちるため。
        /// </summary>
        private static Dictionary<string, GrayImage> EnsureTemplates(TaskDefinition task)
        {
            if (task.Templates != null) return task.Templates;

            var templates = new Dictionary<string, GrayImage>();
            foreach (var op in task.Pipeline.Ops)
            {
                if (!string.Equals(op.Op, "templateMatch", StringComparison.OrdinalIgnoreCase)) continue;
                var name = op.Text("template", null);
                if (string.IsNullOrEmpty(name) || templates.ContainsKey(name)) continue;

                var image = LoadTemplate(name);
                if (image != null) templates[name] = image;
            }
            task.Templates = templates;
            return templates;
        }

        /// <summary>パイプラインの出力を、宣言された先へ配る。</summary>
        private static void DrawOutputs(
            TaskDefinition task, VisionPipelineResult result, in PerceptionStill still,
            ColorImage crop, int cropX, int cropY)
        {
            for (int i = 0; i < task.Pipeline.Outputs.Count; i++)
            {
                var output = task.Pipeline.Outputs[i];
                result.PreparedRgba.TryGetValue(i, out var rgba);
                if (output.Kind == "world")
                {
                    DrawInWorld(task, result, still, crop, cropX, cropY, output, rgba);
                }
                else if (output.Kind == "image")
                {
                    DrawInCanvas(task, result, output, rgba);
                }
                // "store" は SetStatus がまとめて DataStore に入れる。
            }
        }

        /// <summary>
        /// 加工した画を、パススルーで見えているものの上に重ねる。
        ///
        /// パイプラインに渡した画は「静止画 → 矩形で切り出し → 縮小」と二段階で
        /// 変形しているので、内部パラメータもそのぶん換算しないと現実からずれる。
        /// </summary>
        private static void DrawInWorld(
            TaskDefinition task, VisionPipelineResult result, in PerceptionStill still,
            ColorImage crop, int cropX, int cropY, VisionOutputSpec output, byte[] preparedRgba)
        {
            var overlay = ArsistWorldOverlay.Instance;
            if (overlay == null)
            {
                Debug.LogWarning($"[Arsist] No ArsistWorldOverlay in the scene; task '{task.Id}' has nothing to draw into.");
                return;
            }

            if (result.Gated || !result.Named.TryGetValue(output.Value, out var painted) || painted.Color == null)
            {
                // 何も見つからなかったのに前の絵を残すと、明後日の方向に貼り付いたままになる。
                overlay.Hide();
                return;
            }

            if (task.SourceKind != "viewport")
            {
                // 領域ソースは正対化で幾何が変わるので、そのままでは現実に戻せない。
                Debug.LogWarning($"[Arsist] Task '{task.Id}' draws into the world but its source is a region; " +
                                 "use a viewport source for world output.");
                overlay.Hide();
                return;
            }

            MaskImage alpha = null;
            if (!string.IsNullOrEmpty(output.Alpha)
                && result.Named.TryGetValue(output.Alpha, out var alphaValue))
            {
                alpha = alphaValue.Mask;
            }

            double scale = (double)painted.Color.Width / Math.Max(1, crop.Width);
            var intrinsics = ViewportMapping.ForCrop(still.Intrinsics, cropX, cropY, scale);

            // ワーカーで作り済みならそれを使う (メインスレッドは転送だけ)。
            if (preparedRgba != null)
            {
                overlay.ShowRgba(preparedRgba, painted.Color.Width, painted.Color.Height, intrinsics, still.CameraPose);
            }
            else
            {
                overlay.Show(painted.Color, alpha, intrinsics, still.CameraPose);
            }
        }

        /// <summary>加工した画を Canvas の Image 要素に出す（確認用）。</summary>
        private static void DrawInCanvas(
            TaskDefinition task, VisionPipelineResult result, VisionOutputSpec output, byte[] preparedRgba)
        {
            if (string.IsNullOrEmpty(output.BindingId)) return;
            if (!result.Named.TryGetValue(output.Value, out var value) || value.Color == null) return;

            var target = UiBindingLookup.Find(output.BindingId);
            if (target == null)
            {
                Debug.LogWarning($"[Arsist] Preview target '{output.BindingId}' not found for task '{task.Id}'");
                return;
            }

            MaskImage alpha = null;
            if (!string.IsNullOrEmpty(output.Alpha)
                && result.Named.TryGetValue(output.Alpha, out var alphaValue))
            {
                alpha = alphaValue.Mask;
            }

            var rgba = preparedRgba ?? Composite.ToRgba(value.Color, alpha, 3);
            if (rgba == null) return;

            var raw = target.GetComponent<RawImage>();
            var image = raw == null ? target.GetComponent<Image>() : null;

            // 毎回 Texture2D を作ると溜まるので、大きさが同じなら使い回す。
            var texture = task.PreviewTexture;
            if (texture == null || texture.width != value.Color.Width || texture.height != value.Color.Height)
            {
                if (texture != null) Destroy(texture);
                texture = new Texture2D(value.Color.Width, value.Color.Height, TextureFormat.RGBA32, false);
                task.PreviewTexture = texture;
            }
            texture.LoadRawTextureData(rgba);
            texture.Apply(false);

            if (raw != null)
            {
                raw.texture = texture;
                raw.color = Color.white;
            }
            else if (image != null)
            {
                if (task.PreviewSprite != null) Destroy(task.PreviewSprite);
                task.PreviewSprite = Sprite.Create(
                    texture, new Rect(0, 0, texture.width, texture.height), new Vector2(0.5f, 0.5f));
                image.sprite = task.PreviewSprite;
                image.color = Color.white;
            }
            else
            {
                Debug.LogWarning($"[Arsist] '{output.BindingId}' has no Image/RawImage to draw into");
            }
        }

        /// <summary>ログと text バインドのための一行要約。</summary>
        private static string Summarise(VisionPipelineResult result)
        {
            if (result.Values.Count == 0) return "ok";

            var parts = new List<string>();
            foreach (var pair in result.Values)
            {
                if (pair.Value is Dictionary<string, object> record)
                {
                    // よく見る値をひとつだけ拾う。全部出すとログが読めなくなる。
                    foreach (var key in new[] { "name", "count", "coverage", "found", "pass" })
                    {
                        if (record.TryGetValue(key, out var value))
                        {
                            parts.Add($"{pair.Key}.{key}={value}");
                            break;
                        }
                    }
                }
                else if (pair.Value is List<object> items)
                {
                    parts.Add($"{pair.Key}={items.Count}");
                }
            }
            return parts.Count > 0 ? string.Join(" ", parts) : "ok";
        }

        /// <summary>テンプレート画像を StreamingAssets から読む。</summary>
        private static GrayImage LoadTemplate(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;

            // 参照画像と同じ置き場 (ArsistBuildPipeline.CopyPerceptionAssetsToStreamingAssets)。
            var path = Path.Combine(Application.streamingAssetsPath, "Perception", name);
            try
            {
                if (!File.Exists(path)) return null;
                var bytes = File.ReadAllBytes(path);
                var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                if (!texture.LoadImage(bytes)) return null;
                var gray = GrayImageUnity.FromColor32(texture.GetPixels32(), texture.width, texture.height);
                Destroy(texture);
                return gray;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Could not load template '{name}': {e.Message}");
                return null;
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
            if (!result.Ok) task.LastPipelineResult = null;

            SetStatus(task, result.Ok ? "ok" : "error", result, task.LastPipelineResult);

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
            VisionPipelineResult pipeline = null)
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

            // パイプラインの出力は同じ辞書に並べて入れる。<storeAs>.<key> のように
            // status/text と同じ書き方で bind できるようにするため。
            if (pipeline != null && pipeline.Ok && status == "ok")
            {
                payload["gated"] = pipeline.Gated;
                if (pipeline.Gated) payload["gateReason"] = pipeline.GateReason;

                foreach (var pair in pipeline.Values)
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
