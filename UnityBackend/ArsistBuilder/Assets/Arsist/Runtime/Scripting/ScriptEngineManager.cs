// ==============================================
// Arsist Engine - Script Engine Manager (Jint)
// Assets/Arsist/Runtime/Scripting/ScriptEngineManager.cs
// ==============================================
using System;
using System.IO;
using Jint;
using Jint.Native;
using Jint.Runtime;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

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

        public Engine Engine => _engine;

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
                .LimitMemory(8_000_000)       // 8 MB 上限
                .LimitRecursion(20)           // 再帰深さ制限
                .TimeoutInterval(TimeSpan.FromSeconds(3)) // タイムアウト（無限ループ防止）
            );

            _apiWrapper = new ApiWrapper(_engine);
            _uiWrapper = new UiWrapper();

            // JS 環境に安全なラッパーのみを公開
            _engine.SetValue("api", _apiWrapper);
            _engine.SetValue("ui", _uiWrapper);
            _engine.SetValue("log", new Action<object>(msg =>
                Debug.Log($"[ArsistJS] {msg}")));
            _engine.SetValue("error", new Action<object>(msg =>
                Debug.LogError($"[ArsistJS] {msg}")));

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
                Debug.LogError($"[ArsistJS] Runtime error in '{scriptId}': {ex.Message}");
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
        /// StreamingAssets から scripts.json を読み込んで配列で返す
        /// </summary>
        public ScriptEntry[] LoadScripts()
        {
            var path = Path.Combine(Application.streamingAssetsPath, "ArsistScripts", "scripts.json");
            if (!File.Exists(path))
            {
                Debug.Log("[Arsist] scripts.json not found in StreamingAssets.");
                return Array.Empty<ScriptEntry>();
            }

            try
            {
                var json = File.ReadAllText(path);
                var bundle = JObject.Parse(json);
                var arr = bundle["scripts"] as JArray;
                if (arr == null) return Array.Empty<ScriptEntry>();

                var list = new System.Collections.Generic.List<ScriptEntry>();
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

                Debug.Log($"[Arsist] Loaded {list.Count} script(s) from StreamingAssets.");
                return list.ToArray();
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Arsist] Failed to load scripts.json: {ex.Message}");
                return Array.Empty<ScriptEntry>();
            }
        }
    }
}
