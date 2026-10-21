// ==============================================
// Arsist Engine - API Wrapper (HTTP)
// Assets/Arsist/Runtime/Scripting/ApiWrapper.cs
// ==============================================
using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using Arsist.Runtime.Audio;
using Arsist.Runtime.Inference;
using Jint;
using Jint.Native;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// スクリプト上の api オブジェクト。
    ///   api.get / api.post        短い形 (応答の文字列だけ。失敗は null)
    ///   api.request(options, fn)  何でも: メソッド・ヘッダー・JSON / 文字列 / マルチパート (ファイル付き)・
    ///                             応答を文字列 / JSON / base64 (音声や画像) で・タイムアウト
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class ApiWrapper
    {
        // LLM 呼び出し等、単純な取得より遅くなりがちなリクエストも通るように少し余裕を持たせる。
        private const int TimeoutSeconds = 30;

        /// <summary>api.request の既定のタイムアウト (秒)。LLM や読み上げは数十秒かかることがある。</summary>
        private const int RequestTimeoutSeconds = 60;

        private readonly Engine _engine;
        private readonly JsBridge _js;

        public ApiWrapper(Engine engine, JsBridge js)
        {
            _engine = engine;
            _js = js;
        }

        // ========================================
        // api.request
        // ========================================

        /// <summary>
        /// api.request({ url, method, headers, json | body | form, responseType, timeout }, fn(r))
        /// r = { ok, status, text, json, base64, type, error }。ok は 2xx のとき true。
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public void request(JsValue options, JsValue callback = null)
        {
            var plain = _js.FromJs(options) as Dictionary<string, object>;
            if (plain == null)
            {
                Reply(callback, Failure(0, "optionsMustBeObject"));
                return;
            }
            if (CoroutineRunner.Instance == null)
            {
                Debug.LogError("[Arsist] CoroutineRunner not found. Cannot execute api.request.");
                Reply(callback, Failure(0, "notReady"));
                return;
            }
            CoroutineRunner.Instance.StartCoroutine(RequestCoroutine(plain, callback));
        }

        private IEnumerator RequestCoroutine(Dictionary<string, object> options, JsValue callback)
        {
            var url = JsBridge.Text(options, "url");
            if (string.IsNullOrWhiteSpace(url))
            {
                Reply(callback, Failure(0, "noUrl"));
                yield break;
            }

            var headers = JsBridge.Obj(options, "headers");
            bool hasJson = JsBridge.Has(options, "json");
            bool hasBody = JsBridge.Has(options, "body") && options["body"] != null;
            var form = JsBridge.Obj(options, "form");
            var method = (JsBridge.Text(options, "method") ?? (hasJson || hasBody || form != null ? "POST" : "GET")).ToUpperInvariant();
            var responseType = (JsBridge.Text(options, "responseType") ?? "text").ToLowerInvariant();
            int timeout = (int)Math.Max(1, Math.Round(JsBridge.Number(options, "timeout", RequestTimeoutSeconds)));

            byte[] payload = null;
            string contentType = null;
            string buildError = null;
            try
            {
                if (form != null)
                {
                    payload = BuildMultipart(form, out contentType);
                }
                else if (hasJson)
                {
                    payload = Encoding.UTF8.GetBytes(MiniJson.Write(options["json"]));
                    contentType = "application/json";
                }
                else if (hasBody)
                {
                    var body = options["body"] as string ?? MiniJson.Write(options["body"]);
                    payload = Encoding.UTF8.GetBytes(body);
                    var trimmed = body.TrimStart();
                    contentType = trimmed.StartsWith("{") || trimmed.StartsWith("[") ? "application/json" : "text/plain; charset=utf-8";
                }
            }
            catch (Exception e)
            {
                buildError = e.Message;
            }
            if (buildError != null)
            {
                Reply(callback, Failure(0, "badRequest: " + buildError));
                yield break;
            }

            using var req = new UnityWebRequest(url, method);
            req.downloadHandler = new DownloadHandlerBuffer();
            if (payload != null)
            {
                req.uploadHandler = new UploadHandlerRaw(payload);
                req.SetRequestHeader("Content-Type", contentType);
            }
            if (headers != null)
            {
                foreach (var pair in headers)
                {
                    if (pair.Value == null) continue;
                    // マルチパートの境界を含む Content-Type は上書きさせない
                    if (form != null && string.Equals(pair.Key, "Content-Type", StringComparison.OrdinalIgnoreCase)) continue;
                    try { req.SetRequestHeader(pair.Key, Convert.ToString(pair.Value, System.Globalization.CultureInfo.InvariantCulture)); }
                    catch (Exception e) { Debug.LogWarning($"[Arsist] api.request: header '{pair.Key}' rejected: {e.Message}"); }
                }
            }
            req.timeout = timeout;

            Debug.Log($"[Arsist] api.request {method} {url}");
            yield return req.SendWebRequest();

            int status = (int)req.responseCode;
            bool ok = req.result == UnityWebRequest.Result.Success && status >= 200 && status < 300;
            var result = new Dictionary<string, object>
            {
                ["ok"] = ok,
                ["status"] = (double)status,
                ["type"] = req.GetResponseHeader("Content-Type"),
                ["error"] = ok ? null : (req.error ?? $"HTTP {status}"),
            };

            var bytes = req.downloadHandler?.data;
            if (responseType == "base64")
            {
                result["base64"] = bytes != null ? Convert.ToBase64String(bytes) : null;
                // 失敗の応答は大抵 JSON の説明なので、文字としても渡す
                if (!ok && bytes != null && bytes.Length < 64 * 1024) result["text"] = SafeText(bytes);
            }
            else
            {
                var text = bytes != null ? SafeText(bytes) : null;
                result["text"] = text;
                if (responseType == "json")
                {
                    object parsed = null;
                    if (!string.IsNullOrEmpty(text))
                    {
                        try { parsed = MiniJson.Parse(text); }
                        catch (Exception) { if (ok) result["error"] = "invalidJson"; }
                    }
                    result["json"] = parsed;
                }
            }

            if (!ok) Debug.LogWarning($"[Arsist] api.request failed: {result["error"]} ({method} {url})");
            Reply(callback, result);
        }

        private static string SafeText(byte[] bytes)
        {
            try { return Encoding.UTF8.GetString(bytes); }
            catch (Exception) { return null; }
        }

        /// <summary>
        /// form: { name: "文字", file: { base64, filename, type } } → multipart/form-data。
        /// 音声認識 API (Whisper 互換) はこの形でファイルを受け取る。
        /// </summary>
        private static byte[] BuildMultipart(Dictionary<string, object> form, out string contentType)
        {
            var sections = new List<IMultipartFormSection>();
            foreach (var pair in form)
            {
                if (pair.Value == null) continue;
                if (pair.Value is Dictionary<string, object> file)
                {
                    var base64 = JsBridge.Text(file, "base64") ?? JsBridge.Text(file, "data");
                    var data = AudioDecoding.DecodeBase64(base64, out var mime);
                    if (data == null) throw new ArgumentException($"form.{pair.Key}: base64 is missing or not valid");
                    var fileName = JsBridge.Text(file, "filename") ?? JsBridge.Text(file, "name") ?? pair.Key;
                    var type = JsBridge.Text(file, "type") ?? mime ?? "application/octet-stream";
                    sections.Add(new MultipartFormFileSection(pair.Key, data, fileName, type));
                }
                else
                {
                    var value = pair.Value as string ?? MiniJson.Write(pair.Value);
                    sections.Add(new MultipartFormDataSection(pair.Key, value));
                }
            }
            var boundary = UnityWebRequest.GenerateBoundary();
            var payload = UnityWebRequest.SerializeFormSections(sections, boundary);
            contentType = "multipart/form-data; boundary=" + Encoding.UTF8.GetString(boundary);
            return payload;
        }

        private static Dictionary<string, object> Failure(int status, string error) => new Dictionary<string, object>
        {
            ["ok"] = false,
            ["status"] = (double)status,
            ["error"] = error,
        };

        private void Reply(JsValue callback, Dictionary<string, object> result)
        {
            if (_js.IsFunction(callback)) _js.Call(callback, "api.request callback", result);
            else if (result.TryGetValue("ok", out var ok) && ok is bool b && !b)
                Debug.LogWarning($"[ArsistJS] api.request: {result["error"]}");
        }

        /// <summary>
        /// api.get(url, callback) — HTTP GET を実行しコールバックに結果を渡す。
        /// 失敗時は callback(null) を呼び出す。
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public void get(string url, JsValue callback)
        {
            get(url, null, callback);
        }

        /// <summary>
        /// api.get(url, headersJson, callback) — ヘッダー付き版。
        /// headersJson は {"Authorization": "Bearer xxx"} のようなフラットなJSONオブジェクト。null/空文字なら省略可。
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public void get(string url, string headersJson, JsValue callback)
        {
            if (CoroutineRunner.Instance == null)
            {
                Debug.LogError("[Arsist] CoroutineRunner not found. Cannot execute api.get.");
                return;
            }
            CoroutineRunner.Instance.StartCoroutine(GetCoroutine(url, headersJson, callback));
        }

        /// <summary>
        /// api.post(url, bodyJson, callback) — HTTP POST を実行しコールバックに結果を渡す。
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public void post(string url, string bodyJson, JsValue callback)
        {
            post(url, bodyJson, null, callback);
        }

        /// <summary>
        /// api.post(url, bodyJson, headersJson, callback) — ヘッダー付き版。
        /// Kimi/OpenAI互換APIの Authorization: Bearer ヘッダーなどはこちらを使う:
        ///   api.post(url, JSON.stringify(body), JSON.stringify({Authorization: "Bearer " + key}), cb)
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public void post(string url, string bodyJson, string headersJson, JsValue callback)
        {
            if (CoroutineRunner.Instance == null)
            {
                Debug.LogError("[Arsist] CoroutineRunner not found. Cannot execute api.post.");
                return;
            }
            CoroutineRunner.Instance.StartCoroutine(PostCoroutine(url, bodyJson, headersJson, callback));
        }

        /// <summary>{"Key":"Value",...} 形式の JSON をヘッダーとして適用する。壊れたJSONは無視して続行する。</summary>
        private static void ApplyHeaders(UnityWebRequest req, string headersJson)
        {
            if (string.IsNullOrWhiteSpace(headersJson)) return;
            try
            {
                var obj = JObject.Parse(headersJson);
                foreach (var prop in obj.Properties())
                {
                    req.SetRequestHeader(prop.Name, prop.Value?.ToString() ?? "");
                }
            }
            catch (System.Exception ex)
            {
                Debug.LogWarning($"[Arsist] api: invalid headersJson, ignoring headers: {ex.Message}");
            }
        }

        private IEnumerator GetCoroutine(string url, string headersJson, JsValue callback)
        {
            Debug.Log($"[Arsist] api.get request: {url}");
            using var req = UnityWebRequest.Get(url);
            ApplyHeaders(req, headersJson);
            req.timeout = TimeoutSeconds;
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

        private IEnumerator PostCoroutine(string url, string bodyJson, string headersJson, JsValue callback)
        {
            Debug.Log($"[Arsist] api.post request: {url}");
            var data = System.Text.Encoding.UTF8.GetBytes(bodyJson);
            using var req = new UnityWebRequest(url, UnityWebRequest.kHttpVerbPOST);
            req.uploadHandler = new UploadHandlerRaw(data);
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            ApplyHeaders(req, headersJson);
            req.timeout = TimeoutSeconds;
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
