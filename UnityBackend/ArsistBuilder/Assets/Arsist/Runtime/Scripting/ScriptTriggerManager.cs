// ==============================================
// Arsist Engine - Script Trigger Manager
// Assets/Arsist/Runtime/Scripting/ScriptTriggerManager.cs
// ==============================================
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// scripts.json のトリガー定義を読み込み、適切なタイミングでスクリプトを実行する。
    ///
    /// サポートトリガータイプ:
    ///   - "awake"    : 起動時に 1 回実行
    ///   - "interval" : 指定ミリ秒ごとに繰り返し実行
    ///   - "event"    : ArsistEvent.Fire(eventName) で実行
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class ScriptTriggerManager : MonoBehaviour
    {
        public static ScriptTriggerManager Instance { get; private set; }
        private readonly List<(string id, string code)> _updateScripts = new List<(string id, string code)>();

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

        private IEnumerator Start()
        {
            // ScriptEngineManager が初期化されるまで 1 フレーム待機
            yield return null;

            var engine = ScriptEngineManager.Instance;
            if (engine == null)
            {
                Debug.LogError("[Arsist] ScriptTriggerManager: ScriptEngineManager not found.");
                yield break;
            }

            // Android 対応: UnityWebRequest で非同期にscripts.jsonを読み込む
            Debug.Log("[Arsist] ScriptTriggerManager: starting async script load...");
            yield return engine.StartCoroutine(engine.LoadScriptsAsync());

            // VRM ロード完了を待機（VRM がある場合のみ）
            if (Arsist.Runtime.VRM.ArsistVRMLoaderTask.PendingCount > 0)
            {
                Debug.Log($"[Arsist] ScriptTriggerManager: waiting for {Arsist.Runtime.VRM.ArsistVRMLoaderTask.PendingCount} VRM(s) to load...");
                float vrmTimeout = 30f;
                float vrmElapsed = 0f;
                while (Arsist.Runtime.VRM.ArsistVRMLoaderTask.PendingCount > 0 && vrmElapsed < vrmTimeout)
                {
                    vrmElapsed += Time.unscaledDeltaTime;
                    yield return null;
                }
                if (vrmElapsed >= vrmTimeout)
                {
                    Debug.LogWarning("[Arsist] ScriptTriggerManager: VRM load timeout. Proceeding with script execution.");
                }
                else
                {
                    Debug.Log($"[Arsist] ScriptTriggerManager: All VRM(s) loaded ({vrmElapsed:F1}s)");
                }
                // 追加の1フレーム待機 - VRM 登録処理の完了を保証
                yield return null;
            }

            var scripts = engine.GetLoadedScripts();
            Debug.Log($"[Arsist] ScriptTriggerManager: {scripts.Length} script(s) to register.");

            foreach (var script in scripts)
            {
                var triggerType = script.trigger?["type"]?.ToString() ?? "awake";
                var triggerValue = script.trigger?["value"]?.ToString() ?? "1000";

                switch (triggerType.ToLowerInvariant())
                {
                    case "awake":
                    case "start":
                    case "onstart":
                        StartCoroutine(RunOnce(script.id, script.code));
                        break;

                    case "onupdate":
                        _updateScripts.Add((script.id, script.code));
                        Debug.Log($"[Arsist] Script '{script.id}' registered for onUpdate");
                        break;

                    case "interval":
                        const float defaultIntervalMs = 1000f;
                        float intervalMs;

                        if (!float.TryParse(triggerValue, out intervalMs) || intervalMs <= 0f)
                        {
                            intervalMs = defaultIntervalMs;
                            Debug.LogWarning($"[Arsist] Script '{script.id}': invalid interval value '{triggerValue}', fallback to {defaultIntervalMs}ms");
                        }

                        StartCoroutine(RunInterval(script.id, script.code, intervalMs / 1000f));
                        break;

                    case "event":
                        var eventName = triggerValue;
                        ArsistScriptEvent.Register(eventName, () =>
                            ScriptEngineManager.Instance.ExecuteScript(script.id, script.code));
                        Debug.Log($"[Arsist] Script '{script.id}' registered for event '{eventName}'");
                        break;

                    default:
                        Debug.LogWarning($"[Arsist] Script '{script.id}': unknown trigger type '{triggerType}'");
                        break;
                }
            }
        }

        private void Update()
        {
            if (_updateScripts.Count == 0) return;

            var engine = ScriptEngineManager.Instance;
            if (engine == null) return;

            for (int i = 0; i < _updateScripts.Count; i++)
            {
                var entry = _updateScripts[i];
                engine.ExecuteScript(entry.id, entry.code);
            }
        }

        private IEnumerator RunOnce(string id, string code)
        {
            ScriptEngineManager.Instance.ExecuteScript(id, code);
            yield break;
        }

        private IEnumerator RunInterval(string id, string code, float intervalSec)
        {
            var wait = new WaitForSeconds(intervalSec);
            while (true)
            {
                ScriptEngineManager.Instance.ExecuteScript(id, code);
                yield return wait;
            }
        }
    }
}
