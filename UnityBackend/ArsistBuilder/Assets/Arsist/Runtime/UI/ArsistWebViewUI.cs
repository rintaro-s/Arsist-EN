// ==============================================
// Arsist Engine - XR HUD UI Component
// UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/UI/ArsistWebViewUI.cs
// ==============================================

using System;
using System.Collections;
using System.IO;
using System.Text.RegularExpressions;
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

        [Tooltip("追従のスムーズさ（小さいほど滑らか）")]
        public float followSmoothness = 5f;

        [Header("Auto Setup")]
        [Tooltip("Start時に自動で初期化")]
        public bool autoInitialize = true;

        private Camera _xrCamera;
        private GameObject _canvas;
        private bool _initialized;

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
            Debug.Log("[ArsistWebViewUI] Waiting for XR camera...");

            // 最大5秒待機してカメラを探す
            float elapsed = 0f;
            while (elapsed < 5f)
            {
                _xrCamera = FindXRCamera();
                if (_xrCamera != null) break;
                yield return new WaitForSeconds(0.5f);
                elapsed += 0.5f;
            }

            if (_xrCamera == null)
            {
                Debug.LogError("[ArsistWebViewUI] No camera found after 5s. HUD will not be created.");
                yield break;
            }

            Debug.Log($"[ArsistWebViewUI] Camera found: {_xrCamera.name} (tag={_xrCamera.tag})");

            // HTMLコンテンツを読み込み（Androidはコルーチン経由）
            string htmlContent = null;
            yield return StartCoroutine(LoadHTMLContentCoroutine(result => htmlContent = result));

            CreateXRHUD(htmlContent ?? GetDefaultHTML());
            _initialized = true;
            Debug.Log("[ArsistWebViewUI] HUD initialized successfully");
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
            _canvas = new GameObject("ArsistXRHUD");

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

            // --- 背景（半透明黒） ---
            var bgObj = new GameObject("Background");
            bgObj.transform.SetParent(_canvas.transform, false);
            bgObj.layer = _canvas.layer;

            var bgRect = bgObj.AddComponent<RectTransform>();
            bgRect.anchorMin = Vector2.zero;
            bgRect.anchorMax = Vector2.one;
            bgRect.sizeDelta = Vector2.zero;

            var bgImage = bgObj.AddComponent<UnityEngine.UI.Image>();
            bgImage.color = new Color(0, 0, 0, 0.3f);

            // --- テキスト表示 ---
            var textObj = new GameObject("HUDText");
            textObj.transform.SetParent(_canvas.transform, false);
            textObj.layer = _canvas.layer;

            var textRect = textObj.AddComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = new Vector2(40, 40);
            textRect.offsetMax = new Vector2(-40, -40);

            // Unity標準のUI.Textを使用（TextMeshPro Resources不要）
            var text = textObj.AddComponent<UnityEngine.UI.Text>();
            text.text = ExtractTextFromHTML(htmlContent);
            text.fontSize = 42;
            text.color = Color.white;
            text.alignment = TextAnchor.MiddleCenter;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            text.font = Resources.GetBuiltinResource<Font>("Arial.ttf");

            Debug.Log($"[ArsistWebViewUI] XR HUD created (headLocked={headLocked}, distance={distance}m, camera={_xrCamera.name})");
        }

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
                
                // テキストが長すぎれば最初の200文字まで
                if (text.Length > 200)
                    text = text.Substring(0, 200) + "...";
                
                Debug.Log($"[ArsistWebViewUI] Extracted text: '{text}'");
                return string.IsNullOrWhiteSpace(text) ? "Arsist UI" : text;
            }
            catch (Exception e)
            {
                Debug.LogError($"[ArsistWebViewUI] Failed to extract text: {e.Message}");
                return "Arsist UI";
            }
        }

        private string GetDefaultHTML()
        {
            return @"<!DOCTYPE html><html><body><div><h1>Arsist UI</h1><p>Content loaded</p></div></body></html>";
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
            if (_canvas != null)
            {
                Destroy(_canvas);
                _canvas = null;
            }
        }
    }
}
