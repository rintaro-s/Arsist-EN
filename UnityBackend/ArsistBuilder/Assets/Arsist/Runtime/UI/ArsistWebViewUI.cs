// ==============================================
// Arsist Engine - XR HUD UI Component
// UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/UI/ArsistWebViewUI.cs
// ==============================================

using System;
using System.Collections;
using System.IO;
using System.Text.RegularExpressions;
using Arsist.Runtime.DataFlow;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.Networking;

namespace Arsist.Runtime.UI
{
    /// <summary>
    /// HTML/CSS/JSで定義されたUIをWorld Space Canvasで表示するコンポーネント
    /// XRグラス上に表示するため、ネイティブWebViewではなくUnity Canvasを使用
    /// </summary>
    public class ArsistWebViewUI : MonoBehaviour
    {
        [Header("WebView Settings")]
        [Tooltip("表示するHTMLファイルのパス（StreamingAssets相対）")]
        public string htmlPath = "ArsistUI/index.html";

        [Tooltip("WebViewの表示幅（ピクセル）")]
        public int width = 1920;

        [Tooltip("WebViewの表示高さ（ピクセル）")]
        public int height = 1080;

        [Tooltip("ユーザー視野からの距離（メートル）")]
        public float distance = 2f;

        [Tooltip("Head-Locked: ユーザーの視野に追従")]
        public bool headLocked = true;

        [Tooltip("AndroidではネイティブWebViewでHTMLを描画")]
        public bool preferNativeWebView = false;

        [Tooltip("追従のスムーズさ（小さいほど滑らか）")]
        public float followSmoothness = 5f;

        [Header("Auto Setup")]
        [Tooltip("Start時に自動で初期化")]
        public bool autoInitialize = true;

        private Camera _xrCamera;
        private GameObject _canvas;
        private bool _initialized;
        private Texture2D _webViewTexture;
        private UnityEngine.UI.RawImage _webViewImage;
        private bool _dataSubscribed;

#if UNITY_ANDROID && !UNITY_EDITOR
        private AndroidJavaObject _androidWebView;
        private AndroidJavaObject _androidContentView;
        private bool _webViewTextureInitialized = false;
#endif

        private void Start()
        {
            if (autoInitialize)
            {
                StartCoroutine(InitializeWithRetry());
            }
        }

        /// <summary>
        /// XRカメラの準備を待ってから初期化（XR環境では初期化に時間がかかる場合がある）
        /// </summary>
        private IEnumerator InitializeWithRetry()
        {
            Debug.Log("[ArsistWebViewUI] Initializing HUD...");

            // First, try to find existing Canvas from build-time
            var existingCanvas = FindExistingCanvas();
            if (existingCanvas != null)
            {
                Debug.Log($"[ArsistWebViewUI] ✅ Found existing Canvas from build-time: {existingCanvas.name}");
                _canvas = existingCanvas;
                _initialized = true;
                TrySubscribeDataStore();
                Debug.Log("[ArsistWebViewUI] ✅ Using existing Canvas - HUD ready");
                yield break;
            }

            Debug.Log("[ArsistWebViewUI] No existing Canvas found. Creating new one...");

            // Fallback: Wait for XR camera and create new Canvas
            float elapsed = 0f;
            float maxWaitTime = 10f;
            while (elapsed < maxWaitTime)
            {
                _xrCamera = FindXRCamera();
                if (_xrCamera != null) break;
                yield return new WaitForSeconds(0.5f);
                elapsed += 0.5f;
                
                if ((int)elapsed % 2 == 0)
                {
                    Debug.Log($"[ArsistWebViewUI] Waiting for camera... ({elapsed:F1}s / {maxWaitTime}s)");
                }
            }

            if (_xrCamera == null)
            {
                Debug.LogError("[ArsistWebViewUI] ❌ No camera found after 10s. HUD will not be created.");
                yield break;
            }

            Debug.Log($"[ArsistWebViewUI] ✅ Camera found: {_xrCamera.name}");

            // HTMLコンテンツを読み込み
            string htmlContent = null;
            yield return StartCoroutine(LoadHTMLContentCoroutine(result => htmlContent = result));

            if (string.IsNullOrEmpty(htmlContent))
            {
                htmlContent = GetDefaultHTML();
            }

            CreateXRHUD(htmlContent);
            _initialized = true;
            TrySubscribeDataStore();
            Debug.Log("[ArsistWebViewUI] ✅ HUD initialized successfully");
        }

        /// <summary>
        /// Find Canvas created at build-time
        /// </summary>
        private GameObject FindExistingCanvas()
        {
            // Look for Canvas with CanvasInitializer (created at build-time)
            var canvases = FindObjectsOfType<Canvas>();
            foreach (var canvas in canvases)
            {
                if (canvas.renderMode == RenderMode.WorldSpace && canvas.GetComponent<CanvasInitializer>() != null)
                {
                    return canvas.gameObject;
                }
            }

            // Fallback: Look for any WorldSpace Canvas
            foreach (var canvas in canvases)
            {
                if (canvas.renderMode == RenderMode.WorldSpace && canvas.gameObject.name.Contains("HUD"))
                {
                    return canvas.gameObject;
                }
            }

            return null;
        }

        /// <summary>
        /// XRカメラを探索（複数の方法でフォールバック）
        /// </summary>
        private Camera FindXRCamera()
        {
            // 1. Camera.main（MainCameraタグ）
            var cam = Camera.main;
            if (cam != null) return cam;

            // 2. XR Origin配下のカメラを探す
            var xrOrigin = GameObject.Find("XR Origin");
            if (xrOrigin != null)
            {
                cam = xrOrigin.GetComponentInChildren<Camera>();
                if (cam != null) return cam;
            }

            // 3. XREAL_Rig配下
            var xrealRig = GameObject.Find("XREAL_Rig");
            if (xrealRig != null)
            {
                cam = xrealRig.GetComponentInChildren<Camera>();
                if (cam != null) return cam;
            }

            // 4. シーン内の全カメラから最初のアクティブなものを取得
#if UNITY_2023_1_OR_NEWER
            cam = FindFirstObjectByType<Camera>();
#else
            cam = FindObjectOfType<Camera>();
#endif
            return cam;
        }

        /// <summary>
        /// HTMLコンテンツをコルーチンで読み込み（Android StreamingAssets対応）
        /// </summary>
        private IEnumerator LoadHTMLContentCoroutine(Action<string> callback)
        {
            string fullPath;
            if (Application.streamingAssetsPath.Contains("://") ||
                Application.streamingAssetsPath.Contains("jar:"))
            {
                // Android: UnityWebRequest経由で読む
                fullPath = Application.streamingAssetsPath;
                if (!fullPath.EndsWith("/")) fullPath += "/";
                fullPath += htmlPath;
            }
            else
            {
                fullPath = Path.Combine(Application.streamingAssetsPath, htmlPath);
                // PC/Editor: 直接読める
                if (File.Exists(fullPath))
                {
                    callback(File.ReadAllText(fullPath));
                    yield break;
                }
                Debug.LogWarning($"[ArsistWebViewUI] HTML not found: {fullPath}");
                callback(null);
                yield break;
            }

            Debug.Log($"[ArsistWebViewUI] Loading HTML via UnityWebRequest: {fullPath}");
            using (var req = UnityWebRequest.Get(fullPath))
            {
                yield return req.SendWebRequest();
                if (req.result == UnityWebRequest.Result.Success)
                {
                    callback(req.downloadHandler.text);
                }
                else
                {
                    Debug.LogWarning($"[ArsistWebViewUI] HTML load failed: {req.error}");
                    callback(null);
                }
            }
        }

        /// <summary>
        /// XRカメラに追従するWorld Space HUDを作成
        /// </summary>
        private void CreateXRHUD(string htmlContent)
        {
            // **診断ログ：HTML読み込み状況**
            Debug.Log($"[ArsistWebViewUI] CreateXRHUD called");
            Debug.Log($"[ArsistWebViewUI] HTML Content Status:");
            Debug.Log($"  - Content length: {(htmlContent?.Length ?? 0)} bytes");
            Debug.Log($"  - Content null: {htmlContent == null}");
            Debug.Log($"  - Content empty string: {htmlContent == ""}");
            if (htmlContent != null && htmlContent.Length > 100)
            {
                Debug.Log($"  - First 100 chars: {htmlContent.Substring(0, Math.Min(100, htmlContent.Length))}");
            }

            // 安定性優先: Unity Canvas + Text を基本経路とする
            // （ネイティブWebViewのTexture取り込みは端末差で不安定）
            CreateXRHUDWithText(htmlContent);
        }

        /// <summary>
        /// Android WebViewからTextureを取得してUnity CanvasのRawImageに表示（XREAL One対応）
        /// </summary>
        private void CreateXRHUDWithWebViewTexture()
        {
            _canvas = new GameObject("ArsistXRHUD_WebView");

            // headLocked の場合はカメラの子にして常に視野内に表示
            if (headLocked)
            {
                _canvas.transform.SetParent(_xrCamera.transform);
                _canvas.transform.localPosition = new Vector3(0, 0, distance);
                _canvas.transform.localRotation = Quaternion.identity;
                _canvas.transform.localScale = Vector3.one;
            }
            else
            {
                // ワールド空間に配置（カメラの前方に初期配置）
                _canvas.transform.position = _xrCamera.transform.position +
                                             _xrCamera.transform.forward * distance;
                _canvas.transform.rotation = Quaternion.LookRotation(
                    _canvas.transform.position - _xrCamera.transform.position);
            }

            // Canvas設定
            var canvas = _canvas.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.sortingOrder = 999;
            _canvas.layer = _xrCamera.gameObject.layer;

            var canvasScaler = _canvas.AddComponent<UnityEngine.UI.CanvasScaler>();
            canvasScaler.dynamicPixelsPerUnit = 100;

            _canvas.AddComponent<UnityEngine.UI.GraphicRaycaster>();

            var rectTransform = _canvas.GetComponent<RectTransform>();
            rectTransform.sizeDelta = new Vector2(width, height);
            rectTransform.localScale = new Vector3(0.001f, 0.001f, 0.001f);

            // RawImage for WebView Texture
            var imageObj = new GameObject("WebViewTexture");
            imageObj.transform.SetParent(_canvas.transform, false);
            imageObj.layer = _canvas.layer;

            var imageRect = imageObj.AddComponent<RectTransform>();
            imageRect.anchorMin = Vector2.zero;
            imageRect.anchorMax = Vector2.one;
            imageRect.sizeDelta = Vector2.zero;

            _webViewImage = imageObj.AddComponent<UnityEngine.UI.RawImage>();
            
            // Textureは後でWebViewから取得して設定
            _webViewTexture = new Texture2D(width, height, TextureFormat.RGBA32, false);
            _webViewImage.texture = _webViewTexture;

            Debug.Log($"[ArsistWebViewUI] ✅ XR HUD with WebView texture created (headLocked={headLocked}, distance={distance}m)");
            
            // WebViewからTextureを定期的に更新するコルーチンを開始
            StartCoroutine(UpdateWebViewTexture());
        }

        /// <summary>
        /// WebViewの描画内容をTextureに定期的にコピー
        /// </summary>
        private IEnumerator UpdateWebViewTexture()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            // WebViewの初期化を待つ
            float waitTime = 0f;
            while (!_webViewTextureInitialized && waitTime < 5f)
            {
                yield return new WaitForSeconds(0.1f);
                waitTime += 0.1f;
            }

            if (!_webViewTextureInitialized)
            {
                Debug.LogError("[ArsistWebViewUI] ❌ WebView initialization timeout, texture update aborted");
                yield break;
            }

            Debug.Log("[ArsistWebViewUI] WebView initialized, starting texture updates...");

            // 注意: WebViewからTextureへのキャプチャは複雑な実装が必要
            // 本番環境では Vuplex WebView などの専用プラグインの使用を推奨
            Debug.LogWarning("[ArsistWebViewUI] ⚠️ WebView texture capture not fully implemented - requires native plugin");
            Debug.LogWarning("[ArsistWebViewUI] ⚠️ Consider using: Vuplex Web View for Unity (https://vuplex.com/)");
            
            yield break;
#else
            yield return null;
#endif
        }

        /// <summary>
        /// フォールバック: Unity Canvas + Text でHTML内容を表示
        /// </summary>
        private void CreateXRHUDWithText(string htmlContent)
        {
            _canvas = new GameObject("ArsistXRHUD_Text");

            // headLocked の場合はカメラの子にして常に視野内に表示
            if (headLocked)
            {
                _canvas.transform.SetParent(_xrCamera.transform);
                _canvas.transform.localPosition = new Vector3(0, 0, distance);
                _canvas.transform.localRotation = Quaternion.identity;
                _canvas.transform.localScale = Vector3.one;
            }
            else
            {
                // ワールド空間に配置（カメラの前方に初期配置）
                _canvas.transform.position = _xrCamera.transform.position +
                                             _xrCamera.transform.forward * distance;
                _canvas.transform.rotation = Quaternion.LookRotation(
                    _canvas.transform.position - _xrCamera.transform.position);
            }

            // Canvas設定
            var canvas = _canvas.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.sortingOrder = 999;
            // XRカメラがこのCanvasをレンダリングできるようレイヤーを合わせる
            _canvas.layer = _xrCamera.gameObject.layer;

            var canvasScaler = _canvas.AddComponent<UnityEngine.UI.CanvasScaler>();
            canvasScaler.dynamicPixelsPerUnit = 100;

            _canvas.AddComponent<UnityEngine.UI.GraphicRaycaster>();

            var rectTransform = _canvas.GetComponent<RectTransform>();
            rectTransform.sizeDelta = new Vector2(width, height);
            // 1920px → 1.92m にならないよう縮小（0.001 = 1px → 1mm）
            rectTransform.localScale = new Vector3(0.001f, 0.001f, 0.001f);

            // --- テキスト表示 ---
            var textObj = new GameObject("HUDText");
            textObj.transform.SetParent(_canvas.transform, false);
            textObj.layer = _canvas.layer;

            var textRect = textObj.AddComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = new Vector2(40, 40);
            textRect.offsetMax = new Vector2(-40, -40);

            // Unity標準のUI.Textを使用
            var text = textObj.AddComponent<UnityEngine.UI.Text>();
            text.text = ExtractTextFromHTML(htmlContent);
            text.fontSize = 42;
            text.color = Color.white;
            text.alignment = TextAnchor.MiddleCenter;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            
            // Use LegacyRuntime.ttf (the valid built-in font)
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (text.font == null)
            {
                Debug.LogWarning("[ArsistWebViewUI] LegacyRuntime.ttf not found, text may not render");
            }

            Debug.Log($"[ArsistWebViewUI] XR HUD created (headLocked={headLocked}, distance={distance}m, camera={_xrCamera.name})");
        }

        /// <summary>
        /// XREAL One用にAndroid WebViewをTextureとしてキャプチャし、Unity Canvasに表示
        /// （重要：XREAL Oneに表示されるのはUnityのレンダリングのみ。Android Viewはホストスマホにしか映らない）
        /// </summary>
        private bool TryCreateAndroidWebView(string htmlContent)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            if (!preferNativeWebView) return false;
            if (string.IsNullOrEmpty(htmlContent)) return false;

            try
            {
                Debug.Log("[ArsistWebViewUI] Creating Android WebView as offscreen texture for XR");
                
                var unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
                var activity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity");
                if (activity == null) 
                {
                    Debug.LogWarning("[ArsistWebViewUI] Activity is null, cannot create WebView");
                    return false;
                }

                // WebViewをオフスクリーン（非表示）で作成し、Textureとしてキャプチャする
                activity.Call("runOnUiThread", new AndroidJavaRunnable(() =>
                {
                    try
                    {
                        var webView = new AndroidJavaObject("android.webkit.WebView", activity);
                        var settings = webView.Call<AndroidJavaObject>("getSettings");
                        settings.Call("setJavaScriptEnabled", true);
                        settings.Call("setDomStorageEnabled", true);
                        settings.Call("setAllowFileAccess", true);
                        settings.Call("setAllowContentAccess", true);
                        settings.Call("setLoadWithOverviewMode", true);
                        settings.Call("setUseWideViewPort", true);

                        // 透明背景（XR HUD用）
                        webView.Call("setBackgroundColor", 0x00000000);
                        webView.Call("setLayerType", 2, null); // LAYER_TYPE_HARDWARE

                        // サイズを設定（測定用）
                        var measureSpecClass = new AndroidJavaClass("android.view.View$MeasureSpec");
                        int widthMeasureSpec = measureSpecClass.CallStatic<int>("makeMeasureSpec", width, 1073741824); // MeasureSpec.EXACTLY
                        int heightMeasureSpec = measureSpecClass.CallStatic<int>("makeMeasureSpec", height, 1073741824); // MeasureSpec.EXACTLY
                        webView.Call("measure", widthMeasureSpec, heightMeasureSpec);
                        webView.Call("layout", 0, 0, width, height);

                        string baseUrl = "file:///android_asset/";
                        webView.Call("loadDataWithBaseURL", baseUrl, htmlContent, "text/html", "UTF-8", null);

                        // WebViewClient を設定してロード完了を検知
                        var webViewClient = new WebViewClientProxy(this);
                        webView.Call("setWebViewClient", webViewClient); // AndroidJavaProxyを直接渡す

                        _androidWebView = webView;
                        Debug.Log("[ArsistWebViewUI] ✅ Android WebView created as offscreen texture source");
                    }
                    catch (Exception e)
                    {
                        Debug.LogError($"[ArsistWebViewUI] ❌ Android WebView UI thread failed: {e.Message}\n{e.StackTrace}");
                    }
                }));

                return true;
            }
            catch (Exception e)
            {
                Debug.LogError($"[ArsistWebViewUI] ❌ Android WebView creation failed: {e.Message}\n{e.StackTrace}");
                return false;
            }
#else
            return false;
#endif
        }

#if UNITY_ANDROID && !UNITY_EDITOR
        /// <summary>
        /// WebViewClientのプロキシ（ページロード完了の検知用）
        /// </summary>
        private class WebViewClientProxy : AndroidJavaProxy
        {
            private ArsistWebViewUI _owner;

            public WebViewClientProxy(ArsistWebViewUI owner) : base("android.webkit.WebViewClient")
            {
                _owner = owner;
            }

            // Java側から呼ばれるコールバック
            public void onPageFinished(AndroidJavaObject view, string url)
            {
                Debug.Log($"[ArsistWebViewUI] WebView page loaded: {url}");
                _owner._webViewTextureInitialized = true;
                _owner.TrySubscribeDataStore();
            }
        }
#endif

        private string ExtractTextFromHTML(string html)
        {
            if (string.IsNullOrEmpty(html)) return "Arsist UI";
            try
            {
                string text = html;
                // <style>...</style> を削除
                text = Regex.Replace(text, "<style[^>]*>.*?</style>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
                // <script>...</script> を削除
                text = Regex.Replace(text, "<script[^>]*>.*?</script>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
                
                // すべてのHTMLタグ（<...>）を削除
                text = Regex.Replace(text, "<[^>]*>", "");
                
                // HTMLエンティティのデコード
                text = text.Replace("&amp;", "&");
                text = text.Replace("&lt;", "<");
                text = text.Replace("&gt;", ">");
                text = text.Replace("&quot;", "\"");
                text = text.Replace("&#39;", "'");
                text = text.Replace("&nbsp;", " ");
                
                // 連続空白を1スペースに統一
                text = Regex.Replace(text, @"\s+", " ").Trim();
                
                // テキストが長すぎれば最初の500文字まで（改善：200→500）
                if (text.Length > 500)
                    text = text.Substring(0, 500) + "...";
                
                // **診断情報をログ出力**
                Debug.Log($"[ArsistWebViewUI] ===== HTML Content Analysis =====");
                Debug.Log($"[ArsistWebViewUI] Original HTML length: {html.Length} bytes");
                Debug.Log($"[ArsistWebViewUI] Extracted text length: {text.Length} chars");
                Debug.Log($"[ArsistWebViewUI] Extracted text: '{text}'");
                Debug.Log($"[ArsistWebViewUI] ===================================");
                
                return string.IsNullOrWhiteSpace(text) ? "Arsist UI (Empty)" : text;
            }
            catch (Exception e)
            {
                Debug.LogError($"[ArsistWebViewUI] Failed to extract text: {e.Message}");
                Debug.LogError($"[ArsistWebViewUI] Stack trace: {e.StackTrace}");
                return "Arsist UI (Error)";
            }
        }

        private string GetDefaultHTML()
        {
            return @"<!DOCTYPE html><html><body><div><h1>Arsist UI</h1><p>Content loaded</p></div></body></html>";
        }

        private void TrySubscribeDataStore()
        {
            if (_dataSubscribed) return;
            var store = ArsistDataStore.Instance;
            if (store == null) return;
            store.OnValueChanged += OnDataStoreValueChanged;
            _dataSubscribed = true;
            SendDataToWebView(store.GetSnapshot());
        }

        private void OnDataStoreValueChanged(string key, object value)
        {
            var payload = new System.Collections.Generic.Dictionary<string, object>
            {
                { key, value }
            };
            SendDataToWebView(payload);
        }

        private void SendDataToWebView(object payload)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            if (_androidWebView == null || payload == null) return;
            var json = JsonConvert.SerializeObject(payload);
            var script = $"window.ArsistBridge && ArsistBridge.updateData({json});";
            try
            {
                var unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
                var activity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity");
                if (activity == null) return;
                activity.Call("runOnUiThread", new AndroidJavaRunnable(() =>
                {
                    try
                    {
                        _androidWebView.Call("evaluateJavascript", script, null);
                    }
                    catch { }
                }));
            }
            catch { }
#endif
        }

        private void Update()
        {
            if (!_initialized || _canvas == null || _xrCamera == null) return;

            // headLocked=falseの場合のみワールド空間で緩やかに追従
            if (!headLocked)
            {
                Vector3 target = _xrCamera.transform.position + _xrCamera.transform.forward * distance;
                Quaternion targetRot = Quaternion.LookRotation(target - _xrCamera.transform.position);
                _canvas.transform.position = Vector3.Lerp(_canvas.transform.position, target, Time.deltaTime * followSmoothness);
                _canvas.transform.rotation = Quaternion.Slerp(_canvas.transform.rotation, targetRot, Time.deltaTime * followSmoothness);
            }
        }

        private void OnDestroy()
        {
            if (_dataSubscribed && ArsistDataStore.Instance != null)
            {
                ArsistDataStore.Instance.OnValueChanged -= OnDataStoreValueChanged;
            }
#if UNITY_ANDROID && !UNITY_EDITOR
            if (_androidWebView != null)
            {
                try
                {
                    var unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
                    var activity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity");
                    if (activity != null)
                    {
                        var webView = _androidWebView;
                        var contentView = _androidContentView;
                        activity.Call("runOnUiThread", new AndroidJavaRunnable(() =>
                        {
                            try
                            {
                                if (contentView != null)
                                {
                                    contentView.Call("removeView", webView);
                                }
                                webView.Call("destroy");
                            }
                            catch { }
                        }));
                    }
                }
                catch { }
            }
            _androidWebView = null;
            _androidContentView = null;
#endif

            if (_canvas != null)
            {
                Destroy(_canvas);
                _canvas = null;
            }
        }
    }
}
