using System;
using UnityEngine;
using Jint;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// Jint JavaScript インタープリタの初期化・サンドボックス管理。
    /// IL2CPP (Quest/XREAL One) 環境でも動作するよう設計。
    /// </summary>
    public class ScriptEngineManager : MonoBehaviour
    {
        public static ScriptEngineManager Instance { get; private set; }

        [Header("Sandbox Limits")]
        [SerializeField] private int memoryLimitMb = 8;
        [SerializeField] private int recursionLimit = 20;
        [SerializeField] private float timeoutSeconds = 3f;

        [Header("Debug")]
        [SerializeField] private bool verbose = false;

        private Engine _engine;

        private ApiWrapper _apiWrapper;
        private UiWrapper _uiWrapper;
        private EventWrapper _eventWrapper;
        private StoreWrapper _storeWrapper;

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
            // Engine を先に生成し、Jint API を使うラッパーに渡す
            _engine = new Engine(cfg => cfg
                .LimitMemory((long)memoryLimitMb * 1024 * 1024)
                .LimitRecursion(recursionLimit)
                .TimeoutInterval(TimeSpan.FromSeconds(timeoutSeconds))
            );

            _apiWrapper = new ApiWrapper(_engine);
            _uiWrapper = new UiWrapper();
            _eventWrapper = new EventWrapper(_engine);
            _storeWrapper = new StoreWrapper();

            _engine.SetValue("api", _apiWrapper);
            _engine.SetValue("ui", _uiWrapper);
            _engine.SetValue("event", _eventWrapper);
            _engine.SetValue("store", _storeWrapper);
            _engine.SetValue("log", new Action<object>(msg =>
            {
                Debug.Log($"[ArsistScript] {msg}");
            }));
            _engine.SetValue("error", new Action<object>(msg =>
            {
                Debug.LogError($"[ArsistScript] {msg}");
            }));

            if (verbose) Debug.Log("[ScriptEngineManager] Jint エンジン初期化完了");
        }

        /// <summary>
        /// JavaScriptコードを実行する。例外は安全にキャッチされる。
        /// </summary>
        public void Execute(string scriptId, string jsCode)
        {
            if (_engine == null)
            {
                Debug.LogError("[ScriptEngineManager] エンジンが初期化されていません");
                return;
            }

            if (string.IsNullOrWhiteSpace(jsCode)) return;

            try
            {
                _engine.Execute(jsCode);
            }
            catch (Jint.Runtime.JavaScriptException ex)
            {
                Debug.LogError($"[ArsistScript:{scriptId}] JS Runtime Error at line {ex.Location.Start.Line}: {ex.Message}");
            }
            catch (Jint.Runtime.ExecutionCanceledException)
            {
                Debug.LogError($"[ArsistScript:{scriptId}] タイムアウト: 無限ループまたは過剰な処理を検出し停止しました");
            }
            catch (Jint.Runtime.MemoryLimitExceededException)
            {
                Debug.LogError($"[ArsistScript:{scriptId}] メモリ制限超過: スクリプトを停止しました");
            }
            catch (Exception ex)
            {
                Debug.LogError($"[ArsistScript:{scriptId}] 実行エラー: {ex.Message}");
            }
        }

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }
    }
}
