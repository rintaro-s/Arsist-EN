// ==============================================
// Arsist Engine - API Wrapper (HTTP)
// Assets/Arsist/Runtime/Scripting/ApiWrapper.cs
// ==============================================
using System.Collections;
using Jint;
using Jint.Native;
using UnityEngine;
using UnityEngine.Networking;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// スクリプト上の api オブジェクト。HTTP GET / POST を提供する。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class ApiWrapper
    {
        private readonly Engine _engine;

        public ApiWrapper(Engine engine)
        {
            _engine = engine;
        }

        /// <summary>
        /// api.get(url, callback) — HTTP GET を実行しコールバックに結果を渡す。
        /// 失敗時は callback(null) を呼び出す。
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public void get(string url, JsValue callback)
        {
            if (CoroutineRunner.Instance == null)
            {
                Debug.LogError("[Arsist] CoroutineRunner not found. Cannot execute api.get.");
                return;
            }
            CoroutineRunner.Instance.StartCoroutine(GetCoroutine(url, callback));
        }

        /// <summary>
        /// api.post(url, bodyJson, callback) — HTTP POST を実行しコールバックに結果を渡す。
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public void post(string url, string bodyJson, JsValue callback)
        {
            if (CoroutineRunner.Instance == null)
            {
                Debug.LogError("[Arsist] CoroutineRunner not found. Cannot execute api.post.");
                return;
            }
            CoroutineRunner.Instance.StartCoroutine(PostCoroutine(url, bodyJson, callback));
        }

        private IEnumerator GetCoroutine(string url, JsValue callback)
        {
            Debug.Log($"[Arsist] api.get request: {url}");
            using var req = UnityWebRequest.Get(url);
            req.timeout = 10;
            yield return req.SendWebRequest();

            if (req.result == UnityWebRequest.Result.Success)
            {
                Debug.Log($"[Arsist] api.get success: {url} (status={req.responseCode})");
                InvokeCallback(callback, req.downloadHandler.text);
            }
            else
            {
                Debug.LogWarning($"[Arsist] api.get failed: {req.error} ({url})");
                InvokeCallback(callback, null);
            }
        }

        private IEnumerator PostCoroutine(string url, string bodyJson, JsValue callback)
        {
            Debug.Log($"[Arsist] api.post request: {url}");
            var data = System.Text.Encoding.UTF8.GetBytes(bodyJson);
            using var req = new UnityWebRequest(url, UnityWebRequest.kHttpVerbPOST);
            req.uploadHandler = new UploadHandlerRaw(data);
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            req.timeout = 10;
            yield return req.SendWebRequest();

            if (req.result == UnityWebRequest.Result.Success)
            {
                Debug.Log($"[Arsist] api.post success: {url} (status={req.responseCode})");
                InvokeCallback(callback, req.downloadHandler.text);
            }
            else
            {
                Debug.LogWarning($"[Arsist] api.post failed: {req.error} ({url})");
                InvokeCallback(callback, null);
            }
        }

        private void InvokeCallback(JsValue callback, string result)
        {
            if (callback == null || callback.IsUndefined() || callback.IsNull()) return;
            try
            {
                var arg = result != null
                    ? JsValue.FromObject(_engine, result)
                    : JsValue.Null;
                // Jint 4.x: engine.Invoke(callable, thisValue, arguments)
                _engine.Invoke(callback, JsValue.Undefined, new[] { arg });
            }
            catch (System.Exception ex)
            {
                Debug.LogError($"[Arsist] api callback error: {ex.Message}");
            }
        }
    }
}
