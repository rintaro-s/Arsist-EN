// ==============================================
// Arsist Engine - Script Trigger Manager
// Assets/Arsist/Runtime/Scripting/ScriptTriggerManager.cs
// ==============================================
using System;
using System.Collections;
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

            var scripts = engine.LoadScripts();
            foreach (var script in scripts)
            {
                var triggerType = script.trigger?["type"]?.ToString() ?? "awake";
                var triggerValue = script.trigger?["value"]?.ToString() ?? "0";

                switch (triggerType.ToLowerInvariant())
                {
                    case "awake":
                    case "start":
                        StartCoroutine(RunOnce(script.id, script.code));
                        break;

                    case "interval":
                        if (float.TryParse(triggerValue, out var ms) && ms > 0f)
                            StartCoroutine(RunInterval(script.id, script.code, ms / 1000f));
                        else
                            Debug.LogWarning($"[Arsist] Script '{script.id}': invalid interval value '{triggerValue}'");
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
