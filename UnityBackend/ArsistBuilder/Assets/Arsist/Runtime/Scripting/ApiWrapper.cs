using System.Collections;
using UnityEngine;
using UnityEngine.Networking;
using Jint;
using Jint.Native;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// JS から api.get / api.post を呼び出すためのラッパー。
    /// 非同期処理は UnityWebRequest + Coroutine で実装。
    /// IL2CPP / IL2CPP AOT 両対応。
    /// 使用例 (JS):
    ///   api.get('https://api.example.com/data', function(res) { log(res.value); });
    ///   api.post('https://api.example.com/endpoint', JSON.stringify({key:'val'}), function(res) { log(res); });
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class ApiWrapper
    {
        private readonly Engine _engine;

        public ApiWrapper(Engine engine)
        {
            _engine = engine;
        }

        /// <summary>HTTP GET リクエスト</summary>
        [UnityEngine.Scripting.Preserve]
        public void get(string url, JsValue callback)
        {
            CoroutineRunner.Instance.StartCoroutine(GetCoroutine(url, callback));
        }

        /// <summary>HTTP POST リクエスト</summary>
        [UnityEngine.Scripting.Preserve]
        public void post(string url, string bodyJson, JsValue callback)
        {
            CoroutineRunner.Instance.StartCoroutine(PostCoroutine(url, bodyJson, callback));
        }

        private IEnumerator GetCoroutine(string url, JsValue callback)
        {
            using var req = UnityWebRequest.Get(url);
            req.timeout = 10;
            yield return req.SendWebRequest();

            InvokeCallback(callback, req, url);
        }

        private IEnumerator PostCoroutine(string url, string bodyJson, JsValue callback)
        {
            byte[] bodyRaw = System.Text.Encoding.UTF8.GetBytes(bodyJson ?? "{}");
            using var req = new UnityWebRequest(url, "POST");
            req.uploadHandler = new UploadHandlerRaw(bodyRaw);
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            req.timeout = 10;
            yield return req.SendWebRequest();

            InvokeCallback(callback, req, url);
        }

        private void InvokeCallback(JsValue callback, UnityWebRequest req, string url)
        {
            if (!IsCallable(callback)) return;

            if (req.result != UnityWebRequest.Result.Success)
            {
                Debug.LogWarning($"[ArsistScript/api] リクエスト失敗 ({url}): {req.error}");
                _engine.Invoke(callback, new object[] { (object)null });
                return;
            }

            // テキストをそのまま文字列として渡す (JS側で JSON.parse() 可能)
            _engine.Invoke(callback, new object[] { req.downloadHandler.text });
        }

        private static bool IsCallable(JsValue val)
        {
            return val != null && val.Type == Jint.Runtime.Types.Object;
        }
    }
}
