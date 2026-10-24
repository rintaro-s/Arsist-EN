// ==============================================
// Arsist Engine - Script Engine Manager (Jint)
// Assets/Arsist/Runtime/Scripting/ScriptEngineManager.cs
// ==============================================
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using Jint;
using Jint.Native;
using Jint.Runtime;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// Jint エンジンを管理するシングルトン。スクリプトの登録・実行を担う。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class ScriptEngineManager : MonoBehaviour
    {
        public static ScriptEngineManager Instance { get; private set; }

        /// <summary>
        /// スクリプトバンドル (scripts.json) を保持する内部クラス
        /// </summary>
        [Serializable]
        public class ScriptEntry
        {
            public string id;
            public JObject trigger;
            public string code;
            public bool enabled;
        }

        private Engine _engine;
        private ApiWrapper _apiWrapper;
        private UiWrapper _uiWrapper;
        private StoreWrapper _storeWrapper;
        private SceneWrapper _sceneWrapper;
        private VRMWrapper _vrmWrapper;
        private RemoteControlWrapper _remoteControlWrapper;
        private ViewerWrapper _viewerWrapper;
        private PerceptionWrapper _perceptionWrapper;
        private ModelWrapper _modelWrapper;
        private JsBridge _js;
        private AudioWrapper _audioWrapper;
        private CameraWrapper _cameraWrapper;
        private StorageWrapper _storageWrapper;

        /// <summary>
        /// 非同期ロード結果を保持するフィールド
        /// </summary>
        private ScriptEntry[] _loadedScripts;
        private bool _scriptsLoaded;

        public Engine Engine => _engine;
        public SceneWrapper SceneWrapper => _sceneWrapper;
        public VRMWrapper VRMWrapper => _vrmWrapper;
        public ViewerWrapper ViewerWrapper => _viewerWrapper;
        public PerceptionWrapper PerceptionWrapper => _perceptionWrapper;
        /// <summary>JS ⇄ C# の受け渡しとコールバック呼び出し (拡張機能からも使える)</summary>
        public JsBridge Js => _js;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);

            InitEngine();
        }

        private void InitEngine()
        {
            _engine = new Engine(cfg => cfg
                // NOTE: IL2CPP 環境では Jint のメモリトラッキングが壊れる
                // (288PB 等の不正値を報告する) ため、メモリ制限は無効化する。
                // タイムアウトと再帰制限で安全性を確保する。
                .LimitRecursion(64)           // 再帰深さ制限
                .TimeoutInterval(TimeSpan.FromSeconds(5)) // タイムアウト（無限ループ防止）
            );

            _js = new JsBridge(_engine);
            _apiWrapper = new ApiWrapper(_engine, _js);
            _uiWrapper = new UiWrapper(_js);
            _storeWrapper = new StoreWrapper(_js);
            _sceneWrapper = new SceneWrapper();
            _vrmWrapper = new VRMWrapper();
            _remoteControlWrapper = new RemoteControlWrapper();
            _viewerWrapper = new ViewerWrapper(_sceneWrapper);
            _perceptionWrapper = new PerceptionWrapper(_engine);
            _modelWrapper = new ModelWrapper(_engine);
            _sceneWrapper.Js = _js;
            _sceneWrapper.Viewer = _viewerWrapper;
            _viewerWrapper.Js = _js;
            _audioWrapper = new AudioWrapper(_js);
            _cameraWrapper = new CameraWrapper(_js, _viewerWrapper);
            _storageWrapper = new StorageWrapper(_js);

            // タイマー・後で呼ぶ仕事 (scene.moveTo など)・端末に保存する値は、この GameObject で回す
            ScriptRuntimeHost.Ensure(gameObject, _js);
            Arsist.Runtime.Data.ArsistPersistentStore.Ensure(gameObject);

            // JS 環境に安全なラッパーのみを公開
            _engine.SetValue("api", _apiWrapper);
            _engine.SetValue("ui", _uiWrapper);
            _engine.SetValue("store", _storeWrapper);
            _engine.SetValue("scene", _sceneWrapper);
            _engine.SetValue("vrm", _vrmWrapper);
            _engine.SetValue("remote", _remoteControlWrapper);
            _engine.SetValue("viewer", _viewerWrapper);
            _engine.SetValue("perception", _perceptionWrapper);
            _engine.SetValue("model", _modelWrapper);
            _engine.SetValue("audio", _audioWrapper);
            _engine.SetValue("camera", _cameraWrapper);
            _engine.SetValue("storage", _storageWrapper);
            _engine.SetValue("__arsistTimers", new TimersWrapper());
            _engine.SetValue("log", new Action<object>(msg =>
                Debug.Log($"[ArsistJS] {msg}")));
            _engine.SetValue("error", new Action<object>(msg =>
                Debug.LogError($"[ArsistJS] {msg}")));

            // 拡張機能が出す名前 (Extensions/<id>/extension.json の script.globals)。
            // 組み込みの名前は上書きできない (ArsistScriptBridge.Set が断る)。
            Arsist.Runtime.Extensions.ArsistExtensions.InstallScriptGlobals(_engine);

            // Layster.Spatial のプロジェクトだけ `world` を出す (Virtual では何もしない)
            Arsist.Runtime.Spatial.ArsistSpatialHooks.InstallScriptGlobals(_engine, _js);

            // 互換グローバルを提供（window / globalThis / console）
            // 既存サンプルやユーザースクリプトが browser-like API を使っても落ちないようにする
            _engine.Execute(@"
                var globalThis = this;
                var window = this;
                var console = {
                  log: function(m){ log(m); },
                  warn: function(m){ log('[warn] ' + m); },
                  error: function(m){ error(m); }
                };
                // ブラウザと同じタイマー。余分な引数は fn に渡す。呼ばれるのはメインスレッドの次のフレーム以降。
                var setTimeout = function (fn, ms) {
                  return __arsistTimers.add(fn, +ms || 0, false, Array.prototype.slice.call(arguments, 2));
                };
                var setInterval = function (fn, ms) {
                  return __arsistTimers.add(fn, +ms || 0, true, Array.prototype.slice.call(arguments, 2));
                };
                var clearTimeout = function (id) { if (id) __arsistTimers.clear(+id); };
                var clearInterval = clearTimeout;
            ");

            Debug.Log("[Arsist] ScriptEngineManager: Jint engine initialized.");
        }

        /// <summary>
        /// JavaScript コードを実行する
        /// </summary>
        public void ExecuteScript(string scriptId, string jsCode)
        {
            if (_engine == null)
            {
                Debug.LogError("[Arsist] ScriptEngineManager: engine not initialized.");
                return;
            }

            try
            {
                _engine.Execute(jsCode);
            }
            catch (JavaScriptException ex)
            {
                var location = ex.Location.Start.Line > 0
                    ? $" line={ex.Location.Start.Line}, col={ex.Location.Start.Column}"
                    : string.Empty;
                Debug.LogError($"[ArsistJS] Runtime error in '{scriptId}': {ex.Message}{location}");
            }
            catch (RecursionDepthOverflowException ex)
            {
                Debug.LogError($"[ArsistJS] Recursion limit exceeded in '{scriptId}': {ex.Message}");
            }
            catch (OperationCanceledException ex)
            {
                // Jint 4.x のタイムアウト / ExecutionCanceledException のベースクラス
                Debug.LogError($"[ArsistJS] Execution cancelled (timeout?) in '{scriptId}': {ex.Message}");
            }
            catch (Exception ex)
            {
                // MemoryLimitExceededException 含む残りすべてのエラーをキャッチ
                Debug.LogError($"[ArsistJS] Error in '{scriptId}' ({ex.GetType().Name}): {ex.Message}");
            }
        }

        /// <summary>
        /// StreamingAssets から scripts.json を非同期で読み込むコルーチン。
        /// Android では UnityWebRequest を使う必要がある（APK 内の jar ファイル）。
        /// 結果は _loadedScripts に格納される。
        /// </summary>
        public IEnumerator LoadScriptsAsync()
        {
            _scriptsLoaded = false;
            _loadedScripts = Array.Empty<ScriptEntry>();

            // Android / WebGL は UnityWebRequest 必須。他プラットフォームも統一して使う。
            var filePath = Path.Combine(Application.streamingAssetsPath, "ArsistScripts", "scripts.json");

            // Android の streamingAssetsPath は jar:file:// で始まるのでそのまま使える
            // 他プラットフォームでは file:// プレフィックスが必要
            var url = filePath;
            if (!url.StartsWith("jar:") && !url.StartsWith("http"))
            {
                url = "file://" + url;
            }

            Debug.Log($"[Arsist] LoadScriptsAsync: loading from {url}");

            using (var req = UnityWebRequest.Get(url))
            {
                req.timeout = 10;
                yield return req.SendWebRequest();

                if (req.result != UnityWebRequest.Result.Success)
                {
                    Debug.LogError($"[Arsist] scripts.json load failed: {req.error} (url: {url})");

                    // フォールバック: Resources/ArsistScripts.json を読む
                    var fallback = Resources.Load<TextAsset>("ArsistScripts");
                    if (fallback != null && !string.IsNullOrEmpty(fallback.text))
                    {
                        Debug.Log("[Arsist] Falling back to Resources/ArsistScripts");
                        try
                        {
                            ParseAndStoreScripts(fallback.text);
                        }
                        catch (Exception ex)
                        {
                            Debug.LogError($"[Arsist] Failed to parse fallback scripts: {ex.Message}");
                        }
                    }

                    _scriptsLoaded = true;
                    yield break;
                }

                var json = req.downloadHandler.text;
                Debug.Log($"[Arsist] scripts.json loaded, size={json.Length} bytes");

                try
                {
                    ParseAndStoreScripts(json);
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[Arsist] Failed to parse scripts.json: {ex.Message}");
                }
            }

            _scriptsLoaded = true;
        }

        private void ParseAndStoreScripts(string json)
        {
            var bundle = JObject.Parse(json);
            ApplyStorageSettings(bundle);
            var arr = bundle["scripts"] as JArray;
            if (arr == null)
            {
                Debug.LogWarning("[Arsist] scripts.json has no 'scripts' array.");
                _loadedScripts = Array.Empty<ScriptEntry>();
                return;
            }

            var list = new List<ScriptEntry>();
            foreach (JObject item in arr)
            {
                var entry = new ScriptEntry
                {
                    id = item["id"]?.ToString() ?? "(unnamed)",
                    trigger = item["trigger"] as JObject,
                    code = item["code"]?.ToString() ?? "",
                    enabled = item["enabled"]?.Value<bool>() ?? true,
                };
                if (entry.enabled && !string.IsNullOrEmpty(entry.code))
                    list.Add(entry);
            }

            _loadedScripts = list.ToArray();
            Debug.Log($"[Arsist] Loaded {_loadedScripts.Length} script(s).");
        }

        /// <summary>
        /// 端末に保存する値 (scripts.json の storage.persist) を設定し、保存してあった値をストアに戻す。
        /// スクリプトの登録 (ScriptTriggerManager) より前に呼ばれるので、onStart の時点で値は戻っている。
        /// </summary>
        private static void ApplyStorageSettings(JObject bundle)
        {
            var rules = new List<string>();
            if (bundle?["storage"]?["persist"] is JArray persist)
                foreach (var item in persist) { var rule = item?.ToString(); if (!string.IsNullOrWhiteSpace(rule)) rules.Add(rule); }
            // Layster.Spatial: PC のアドレスと keep: forever の置き場所 (layster.*) も残す
            Arsist.Runtime.Spatial.ArsistSpatialHooks.AddPersistRules(rules);
            Arsist.Runtime.Data.ArsistPersistentStore.Instance?.Configure(rules);
        }

        // ---- アプリが裏に回る / 戻る ----

        private bool _paused;

        private void OnApplicationPause(bool paused)
        {
            if (paused == _paused) return;
            _paused = paused;
            if (paused) Arsist.Runtime.Data.ArsistPersistentStore.Instance?.Save();
            // スクリプトのイベント。トリガー { type: "event", value: "app:pause" } で受けられる
            ArsistScriptEvent.Fire(paused ? "app:pause" : "app:resume", false);
        }

        /// <summary>
        /// 非同期ロード結果を取得する
        /// </summary>
        public ScriptEntry[] GetLoadedScripts()
        {
            return _loadedScripts ?? Array.Empty<ScriptEntry>();
        }

        /// <summary>
        /// スクリプトのロードが完了したかどうか
        /// </summary>
        public bool ScriptsLoaded => _scriptsLoaded;
    }
}
