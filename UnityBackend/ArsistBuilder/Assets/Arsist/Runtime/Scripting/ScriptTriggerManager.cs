using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Arsist.Runtime.Events;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// scripts.json (Script Bundle JSON IR) を読み込み、
    /// トリガー条件に応じてスクリプトを登録・実行する管理クラス。
    ///
    /// 読み込み順序:
    ///   1. StreamingAssets/scripts.json (ビルド時に配置)
    ///   2. なければ Application.persistentDataPath/scripts.json (実行時書き込み)
    ///
    /// トリガー種別:
    ///   onStart  — Start() 時に 1 回実行
    ///   onUpdate — Update() 毎フレーム実行
    ///   interval — 指定ミリ秒ごとにコルーチンで実行
    ///   event    — ArsistEventBus のイベント発火時に実行
    /// </summary>
    public class ScriptTriggerManager : MonoBehaviour
    {
        public static ScriptTriggerManager Instance { get; private set; }

        [Header("Script Bundle")]
        [Tooltip("StreamingAssets 内のスクリプトバンドル JSON ファイル名")]
        [SerializeField] private string scriptBundleFileName = "scripts.json";

        [Tooltip("インライン JSON (ファイルより優先)")]
        [TextArea(3, 20)]
        [SerializeField] private string inlineScriptJson = "";

        [Header("Debug")]
        [SerializeField] private bool verbose = false;

        // パース済みスクリプトエントリリスト
        private List<ScriptEntry> _entries = new List<ScriptEntry>();

        // onUpdate 用スクリプト (毎フレーム実行)
        private List<ScriptEntry> _updateEntries = new List<ScriptEntry>();

        // ArsistEventBus 登録済みハンドラ (解除用)
        private readonly Dictionary<string, Action<JObject>> _eventHandlers
            = new Dictionary<string, Action<JObject>>();

        // ─────────────────────────────────────────

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        private void Start()
        {
            var json = LoadBundleJson();
            if (string.IsNullOrWhiteSpace(json))
            {
                if (verbose) Debug.Log("[ScriptTriggerManager] スクリプトバンドルなし — スキップ");
                return;
            }

            ParseBundle(json);
            RegisterTriggers();
        }

        private void Update()
        {
            if (_updateEntries.Count == 0) return;
            var mgr = ScriptEngineManager.Instance;
            if (mgr == null) return;

            foreach (var entry in _updateEntries)
            {
                mgr.Execute(entry.id, entry.code);
            }
        }

        private void OnDestroy()
        {
            UnregisterEventHandlers();
            if (Instance == this) Instance = null;
        }

        // ─────────────────────────────────────────
        // JSON 読み込み
        // ─────────────────────────────────────────

        private string LoadBundleJson()
        {
            // 1. インライン JSON (インスペクタから設定)
            if (!string.IsNullOrWhiteSpace(inlineScriptJson))
            {
                if (verbose) Debug.Log("[ScriptTriggerManager] インライン JSON を使用");
                return inlineScriptJson;
            }

            // 2. StreamingAssets
            var streamingPath = Path.Combine(Application.streamingAssetsPath, scriptBundleFileName);

#if UNITY_ANDROID && !UNITY_EDITOR
            // Android では UnityWebRequest でアクセスする必要があるが、
            // Start() の同期処理では使えないため、CoroutineRunner 経由で非同期ロード
            CoroutineRunner.Instance.StartCoroutine(LoadAndroidStreamingAssets(streamingPath));
            return null; // コルーチンで処理
#else
            if (File.Exists(streamingPath))
            {
                if (verbose) Debug.Log($"[ScriptTriggerManager] StreamingAssets から読み込み: {streamingPath}");
                return File.ReadAllText(streamingPath);
            }
#endif

            // 3. persistentDataPath (実行時書き込み分)
            var persistentPath = Path.Combine(Application.persistentDataPath, scriptBundleFileName);
            if (File.Exists(persistentPath))
            {
                if (verbose) Debug.Log($"[ScriptTriggerManager] persistentDataPath から読み込み: {persistentPath}");
                return File.ReadAllText(persistentPath);
            }

            return null;
        }

#if UNITY_ANDROID && !UNITY_EDITOR
        private IEnumerator LoadAndroidStreamingAssets(string path)
        {
            using var req = UnityEngine.Networking.UnityWebRequest.Get(path);
            yield return req.SendWebRequest();

            if (req.result == UnityEngine.Networking.UnityWebRequest.Result.Success)
            {
                ParseBundle(req.downloadHandler.text);
                RegisterTriggers();
            }
            else
            {
                Debug.LogWarning($"[ScriptTriggerManager] Android StreamingAssets 読み込み失敗: {req.error}");
            }
        }
#endif

        // ─────────────────────────────────────────
        // パース
        // ─────────────────────────────────────────

        private void ParseBundle(string json)
        {
            try
            {
                var bundle = JObject.Parse(json);
                var scripts = bundle["scripts"] as JArray;
                if (scripts == null)
                {
                    Debug.LogWarning("[ScriptTriggerManager] 'scripts' フィールドが見つかりません");
                    return;
                }

                foreach (JObject sc in scripts)
                {
                    var enabled = sc["enabled"]?.Value<bool>() ?? true;
                    if (!enabled) continue;

                    var trigger = sc["trigger"] as JObject;
                    if (trigger == null) continue;

                    var entry = new ScriptEntry
                    {
                        id = sc["id"]?.Value<string>() ?? Guid.NewGuid().ToString(),
                        code = sc["code"]?.Value<string>() ?? "",
                        triggerType = trigger["type"]?.Value<string>() ?? "onStart",
                        triggerValue = trigger["value"],
                    };

                    if (string.IsNullOrWhiteSpace(entry.code)) continue;
                    _entries.Add(entry);
                }

                if (verbose) Debug.Log($"[ScriptTriggerManager] {_entries.Count} 件のスクリプトをパース");
            }
            catch (Exception ex)
            {
                Debug.LogError($"[ScriptTriggerManager] JSON パースエラー: {ex.Message}");
            }
        }

        // ─────────────────────────────────────────
        // トリガー登録
        // ─────────────────────────────────────────

        private void RegisterTriggers()
        {
            var mgr = ScriptEngineManager.Instance;
            if (mgr == null)
            {
                Debug.LogError("[ScriptTriggerManager] ScriptEngineManager が見つかりません");
                return;
            }

            foreach (var entry in _entries)
            {
                switch (entry.triggerType)
                {
                    case "onStart":
                        mgr.Execute(entry.id, entry.code);
                        break;

                    case "onUpdate":
                        _updateEntries.Add(entry);
                        break;

                    case "interval":
                        var ms = entry.triggerValue?.Value<int>() ?? 1000;
                        CoroutineRunner.Instance.StartCoroutine(IntervalCoroutine(entry, ms));
                        break;

                    case "event":
                        var eventName = entry.triggerValue?.Value<string>() ?? "";
                        if (!string.IsNullOrWhiteSpace(eventName))
                        {
                            RegisterEventTrigger(entry, eventName);
                        }
                        break;

                    default:
                        Debug.LogWarning($"[ScriptTriggerManager] 不明なトリガー種別: '{entry.triggerType}' (id={entry.id})");
                        break;
                }
            }

            if (verbose) Debug.Log("[ScriptTriggerManager] トリガー登録完了");
        }

        private IEnumerator IntervalCoroutine(ScriptEntry entry, int intervalMs)
        {
            var wait = new WaitForSeconds(intervalMs / 1000f);
            var mgr = ScriptEngineManager.Instance;

            while (mgr != null)
            {
                yield return wait;
                mgr.Execute(entry.id, entry.code);
            }
        }

        private void RegisterEventTrigger(ScriptEntry entry, string eventName)
        {
            var bus = ArsistEventBus.Instance;
            if (bus == null)
            {
                Debug.LogWarning("[ScriptTriggerManager] ArsistEventBus が見つかりません (event トリガー登録失敗)");
                return;
            }

            Action<JObject> handler = (payload) =>
            {
                var mgr = ScriptEngineManager.Instance;
                if (mgr == null) return;

                // ペイロードを JSON 文字列としてグローバル変数 __eventPayload に注入
                var payloadJson = payload?.ToString(Formatting.None) ?? "{}";
                var wrappedCode = $"var __eventPayload = JSON.parse('{EscapeForJs(payloadJson)}');\n{entry.code}";
                mgr.Execute(entry.id, wrappedCode);
            };

            _eventHandlers[entry.id] = handler;
            bus.Subscribe(eventName, handler);

            if (verbose) Debug.Log($"[ScriptTriggerManager] イベント '{eventName}' に登録 (id={entry.id})");
        }

        private void UnregisterEventHandlers()
        {
            var bus = ArsistEventBus.Instance;
            if (bus == null) return;

            foreach (var kvp in _eventHandlers)
            {
                bus.Unsubscribe(kvp.Key, kvp.Value);
            }
            _eventHandlers.Clear();
        }

        private static string EscapeForJs(string s)
        {
            return s.Replace("\\", "\\\\").Replace("'", "\\'").Replace("\n", "\\n").Replace("\r", "");
        }

        // ─────────────────────────────────────────
        // 実行時スクリプト書き込み (エディタから呼び出す)
        // ─────────────────────────────────────────

        /// <summary>
        /// 実行時にスクリプトバンドルを persistentDataPath に書き込み、再読み込みする。
        /// ビルド後にエディタからスクリプトを更新したい場合などに使用。
        /// </summary>
        public void LoadFromJson(string bundleJson)
        {
            _entries.Clear();
            _updateEntries.Clear();
            UnregisterEventHandlers();

            ParseBundle(bundleJson);
            RegisterTriggers();
        }

        // ─────────────────────────────────────────

        private class ScriptEntry
        {
            public string id;
            public string code;
            public string triggerType;
            public JToken triggerValue;
        }
    }
}
