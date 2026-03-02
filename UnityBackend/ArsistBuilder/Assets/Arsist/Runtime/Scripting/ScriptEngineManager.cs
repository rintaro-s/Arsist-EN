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
        private SceneWrapper _sceneWrapper;
        private VRMWrapper _vrmWrapper;
        private RemoteControlWrapper _remoteControlWrapper;

        /// <summary>
        /// 非同期ロード結果を保持するフィールド
        /// </summary>
        private ScriptEntry[] _loadedScripts;
        private bool _scriptsLoaded;

        public Engine Engine => _engine;
        public SceneWrapper SceneWrapper => _sceneWrapper;
        public VRMWrapper VRMWrapper => _vrmWrapper;

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

            _apiWrapper = new ApiWrapper(_engine);
            _uiWrapper = new UiWrapper();
            _sceneWrapper = new SceneWrapper();
            _vrmWrapper = new VRMWrapper();
            _remoteControlWrapper = new RemoteControlWrapper();

            // JS 環境に安全なラッパーのみを公開
            _engine.SetValue("api", _apiWrapper);
            _engine.SetValue("ui", _uiWrapper);
            _engine.SetValue("scene", _sceneWrapper);
            _engine.SetValue("vrm", _vrmWrapper);
            _engine.SetValue("remote", _remoteControlWrapper);
            _engine.SetValue("log", new Action<object>(msg =>
                Debug.Log($"[ArsistJS] {msg}")));
            _engine.SetValue("error", new Action<object>(msg =>
                Debug.LogError($"[ArsistJS] {msg}")));

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
