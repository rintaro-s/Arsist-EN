// ==============================================
// Arsist Engine - WebView UI Component
// UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/UI/ArsistWebViewUI.cs
// ==============================================

using UnityEngine;
using System.IO;

namespace Arsist.Runtime.UI
{
    /// <summary>
    /// HTML/CSS/JSで定義されたUIをWebViewで表示するコンポーネント
    /// StreamingAssetsからHTMLを読み込み、ユーザーの視野に常時表示する
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
        
        [Tooltip("追従のスムーズさ（小さいほど滑らか）")]
        public float followSmoothness = 5f;
        
        [Header("Auto Setup")]
        [Tooltip("Start時に自動で初期化")]
        public bool autoInitialize = true;

        private Transform _cameraTransform;
        private GameObject _canvas;
        
#if UNITY_ANDROID && !UNITY_EDITOR
        private AndroidJavaObject _webView;
        private AndroidJavaObject _webViewLayout;
        private AndroidJavaObject _activity;
#endif

        private void Start()
        {
            if (autoInitialize)
            {
                Initialize();
            }
        }

        /// <summary>
        /// WebView UIを初期化
        /// </summary>
        public void Initialize()
        {
            Debug.Log($"[ArsistWebViewUI] Initialize called with htmlPath={htmlPath}, width={width}, height={height}, headLocked={headLocked}");
            
            // メインカメラを取得
            var mainCam = Camera.main;
            if (mainCam != null)
            {
                _cameraTransform = mainCam.transform;
                Debug.Log("[ArsistWebViewUI] Main camera found");
            }
            else
            {
                Debug.LogWarning("[ArsistWebViewUI] Main camera not found");
                return;
            }

            // プラットフォーム別に初期化
#if UNITY_ANDROID && !UNITY_EDITOR
            Debug.Log("[ArsistWebViewUI] Initializing Canvas-based UI (Android AR)...");
            // Android AR では Canvas ベースの UI を使用（WebView はスマホ画面に表示されるため使いません）
            string htmlContent = LoadHTMLContent();
            InitializeFallbackCanvas(htmlContent);
#else
            Debug.Log("[ArsistWebViewUI] Initializing Fallback Canvas (Editor/PC)...");
            // エディタではHTMLの内容を読み込んで簡易表示
            string htmlContent = LoadHTMLContent();
            InitializeFallbackCanvas(htmlContent);
#endif

            // 初期位置を設定
            UpdatePosition(true);
            
            Debug.Log($"[ArsistWebViewUI] Initialized with HTML from: {htmlPath}");
        }

        private string LoadHTMLContent()
        {
            try
            {
                Debug.Log($"[ArsistWebViewUI] StreamingAssetsPath: {Application.streamingAssetsPath}");
                Debug.Log($"[ArsistWebViewUI] htmlPath: {htmlPath}");
                
                string fullPath = Path.Combine(Application.streamingAssetsPath, htmlPath);
                Debug.Log($"[ArsistWebViewUI] Attempting to load HTML from: {fullPath}");
                
                // PCではファイルシステムをチェック可能
#if !UNITY_ANDROID || UNITY_EDITOR
                if (File.Exists(fullPath))
                {
                    Debug.Log($"[ArsistWebViewUI] HTML file found, reading...");
                    return File.ReadAllText(fullPath);
                }
                else
                {
                    Debug.LogWarning($"[ArsistWebViewUI] HTML file not found at: {fullPath}");
                    // StreamingAssets ディレクトリの内容をログ出力
                    var baseDir = Path.Combine(Application.streamingAssetsPath, "ArsistUI");
                    Debug.LogWarning($"[ArsistWebViewUI] Checking ArsistUI directory: {baseDir}");
                    if (Directory.Exists(baseDir))
                    {
                        var files = Directory.GetFiles(baseDir);
                        Debug.LogWarning($"[ArsistWebViewUI] Files in ArsistUI: {string.Join(", ", files)}");
                    }
                    return GetDefaultHTML();
                }
#else
                // Android: ファイルチェック不可能かもしれないため、読み込みを試みる
                Debug.Log($"[ArsistWebViewUI] Android: Attempting to read HTML file directly");
                try
                {
                    return File.ReadAllText(fullPath);
                }
                catch
                {
                    Debug.LogWarning($"[ArsistWebViewUI] Android: Direct file read failed, using default HTML");
                    return GetDefaultHTML();
                }
#endif
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[ArsistWebViewUI] Error loading HTML: {e.Message}");
                Debug.LogException(e);
                return GetDefaultHTML();
            }
        }

#if UNITY_ANDROID && !UNITY_EDITOR
        private void InitializeAndroidWebView()
        {
            try
            {
                // AndroidのWebViewを初期化
                using (var unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                {
                    _activity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity");
                }

                if (_activity == null)
                {
                    Debug.LogError("[ArsistWebViewUI] Android activity not found");
                    return;
                }

                var url = GetAndroidWebViewUrl();
                _activity.Call("runOnUiThread", new AndroidJavaRunnable(() =>
                {
                    var layoutParamsClass = new AndroidJavaClass("android.widget.FrameLayout$LayoutParams");
                    int matchParent = layoutParamsClass.GetStatic<int>("MATCH_PARENT");
                    var layoutParams = new AndroidJavaObject("android.widget.FrameLayout$LayoutParams", matchParent, matchParent);

                    var gravityClass = new AndroidJavaClass("android.view.Gravity");
                    layoutParams.Set<int>("gravity", gravityClass.GetStatic<int>("CENTER"));

                    _webView = new AndroidJavaObject("android.webkit.WebView", _activity);

                    var settings = _webView.Call<AndroidJavaObject>("getSettings");
                    settings.Call("setJavaScriptEnabled", true);
                    settings.Call("setDomStorageEnabled", true);
                    settings.Call("setAllowFileAccessFromFileURLs", true);
                    settings.Call("setAllowUniversalAccessFromFileURLs", true);

                    // 透過背景
                    _webView.Call("setBackgroundColor", 0);

                    // Unityビューの上に重ねる
                    _webViewLayout = new AndroidJavaObject("android.widget.FrameLayout", _activity);
                    _webViewLayout.Call("addView", _webView, layoutParams);

                    _activity.Call("addContentView", _webViewLayout, layoutParams);
                    _webView.Call("loadUrl", url);

                    Debug.Log($"[ArsistWebViewUI] Android WebView initialized: {url}");
                }));
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[ArsistWebViewUI] Failed to initialize Android WebView: {e.Message}");
                InitializeFallbackCanvas(GetDefaultHTML());
            }
        }

        private string GetAndroidWebViewUrl()
        {
            // StreamingAssets は APK 内に展開されるため、android_asset から参照する
            var normalized = htmlPath.Replace("\\", "/");
            return $"file:///android_asset/{normalized}";
        }
#endif

        private void InitializeFallbackCanvas(string htmlContent)
        {
            // Fallback: Canvas + TextMeshProで簡易表示
            _canvas = new GameObject("ArsistWebViewCanvas");
            _canvas.transform.SetParent(transform);
            _canvas.transform.localPosition = Vector3.zero;
            _canvas.transform.localRotation = Quaternion.identity;
            _canvas.transform.localScale = Vector3.one;
            
            var canvas = _canvas.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            
            var canvasScaler = _canvas.AddComponent<UnityEngine.UI.CanvasScaler>();
            canvasScaler.dynamicPixelsPerUnit = 100;
            
            _canvas.AddComponent<UnityEngine.UI.GraphicRaycaster>();
            
            // Canvas の RectTransform を設定
            var rectTransform = _canvas.GetComponent<RectTransform>();
            rectTransform.sizeDelta = new Vector2(width, height);
            // グラス用に適切なスケール（メートル単位）
            // 1920x1080 の UI が距離 distance メートルで見やすいスケール
            float scale = distance / 1000f;  // distance メートルに応じたスケール
            _canvas.transform.localScale = new Vector3(scale, scale, scale);
            
            // テキストとして HTMLタイトルを表示（デバッグ用）
            var textObj = new GameObject("UIText");
            textObj.transform.SetParent(_canvas.transform, false);
            
            var textRect = textObj.AddComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.sizeDelta = Vector2.zero;
            
            var text = textObj.AddComponent<TMPro.TextMeshProUGUI>();
            text.text = "Arsist UI\n(AR Glasses Display)";
            text.fontSize = 48;
            text.color = Color.white;
            text.alignment = TMPro.TextAlignmentOptions.Center;
            
            // 背景を追加
            var bgObj = new GameObject("Background");
            bgObj.transform.SetParent(_canvas.transform, false);
            bgObj.transform.SetAsFirstSibling();
            
            var bgRect = bgObj.AddComponent<RectTransform>();
            bgRect.anchorMin = Vector2.zero;
            bgRect.anchorMax = Vector2.one;
            bgRect.sizeDelta = Vector2.zero;
            
            var bgImage = bgObj.AddComponent<UnityEngine.UI.Image>();
            bgImage.color = new Color(0, 0, 0, 0.4f);
            
            Debug.Log("[ArsistWebViewUI] Canvas initialized with WorldSpace rendering");
        }

        private string GetDefaultHTML()
        {
            return @"<!DOCTYPE html>
<html>
<head>
    <meta charset='utf-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: 'Inter', system-ui, sans-serif;
            color: #ffffff;
            background: transparent;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
        }
        .container {
            text-align: center;
            padding: 40px;
            background: rgba(0, 0, 0, 0.4);
            border-radius: 12px;
        }
        h1 {
            font-size: 36px;
            margin-bottom: 16px;
        }
        p {
            font-size: 18px;
            opacity: 0.8;
        }
    </style>
</head>
<body>
    <div class='container'>
        <h1>Arsist UI</h1>
        <p>WebView content not loaded</p>
    </div>
</body>
</html>";
        }

        private void Update()
        {
            if (headLocked && _cameraTransform != null)
            {
                UpdatePosition(false);
            }
        }

        private void UpdatePosition(bool immediate)
        {
            if (_cameraTransform == null) return;
            
            Vector3 targetPosition = _cameraTransform.position + _cameraTransform.forward * distance;
            Quaternion targetRotation = Quaternion.LookRotation(targetPosition - _cameraTransform.position);
            
            if (_canvas != null)
            {
                if (immediate)
                {
                    _canvas.transform.position = targetPosition;
                    _canvas.transform.rotation = targetRotation;
                }
                else
                {
                    _canvas.transform.position = Vector3.Lerp(
                        _canvas.transform.position, 
                        targetPosition, 
                        Time.deltaTime * followSmoothness
                    );
                    _canvas.transform.rotation = Quaternion.Slerp(
                        _canvas.transform.rotation, 
                        targetRotation, 
                        Time.deltaTime * followSmoothness
                    );
                }
            }
        }

        private void OnDestroy()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            if (_activity != null)
            {
                _activity.Call("runOnUiThread", new AndroidJavaRunnable(() =>
                {
                    if (_webViewLayout != null && _webView != null)
                    {
                        _webViewLayout.Call("removeView", _webView);
                    }

                    if (_webView != null)
                    {
                        _webView.Call("destroy");
                        _webView.Dispose();
                        _webView = null;
                    }

                    if (_webViewLayout != null)
                    {
                        _webViewLayout.Dispose();
                        _webViewLayout = null;
                    }
                }));
            }
#endif
        }
    }
}
