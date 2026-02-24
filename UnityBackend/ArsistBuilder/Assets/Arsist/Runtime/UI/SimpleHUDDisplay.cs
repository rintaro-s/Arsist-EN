using UnityEngine;
using UnityEngine.UI;
using System.Collections;
using System.Linq;

namespace Arsist.Runtime.UI
{
    /// <summary>
    /// Simple, guaranteed-working HUD display.
    /// Creates a WorldSpace Canvas with visible text at runtime.
    /// This is the most reliable way to ensure UI is visible on device.
    /// </summary>
    public class SimpleHUDDisplay : MonoBehaviour
    {
        private static SimpleHUDDisplay _instance;
        private Canvas _canvas;
        private bool _initialized = false;

        private void Start()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(gameObject);
                return;
            }
            _instance = this;

            StartCoroutine(InitializeHUD());
        }

        private IEnumerator InitializeHUD()
        {
            if (_initialized) yield break;

            Debug.Log("[SimpleHUDDisplay] Starting HUD initialization...");

            // Wait for scene to fully load
            yield return new WaitForSeconds(0.5f);

            // Find camera with extended retry (XR cameras take time to initialize)
            Camera camera = null;
            float elapsed = 0f;
            float maxWait = 15f; // Extended to 15 seconds for XR devices
            
            while (camera == null && elapsed < maxWait)
            {
                camera = FindCamera();
                if (camera != null) break;
                
                if (elapsed % 2f < 0.1f) // Log every 2 seconds
                {
                    Debug.Log($"[SimpleHUDDisplay] Waiting for camera... ({elapsed:F1}s / {maxWait}s)");
                }
                
                yield return new WaitForSeconds(0.5f);
                elapsed += 0.5f;
            }

            if (camera == null)
            {
                Debug.LogError("[SimpleHUDDisplay] ❌ No camera found after 15s!");
                Debug.LogError("[SimpleHUDDisplay] Available cameras in scene:");
                foreach (var cam in FindObjectsOfType<Camera>())
                {
                    Debug.LogError($"  - {cam.name} (enabled={cam.enabled}, tag={cam.tag})");
                }
                yield break;
            }

            Debug.Log($"[SimpleHUDDisplay] ✅ Found camera: {camera.name} (tag={camera.tag})");

            // Create Canvas
            var canvasGO = new GameObject("SimpleHUD_Canvas");
            _canvas = canvasGO.AddComponent<Canvas>();
            _canvas.renderMode = RenderMode.WorldSpace;
            _canvas.worldCamera = camera;
            _canvas.sortingOrder = 1000;

            // Position as child of camera for head-locked display
            canvasGO.transform.SetParent(camera.transform);
            canvasGO.transform.localPosition = new Vector3(0, 0, 1.5f);
            canvasGO.transform.localRotation = Quaternion.identity;

            // Configure RectTransform
            var rectTransform = canvasGO.GetComponent<RectTransform>();
            rectTransform.sizeDelta = new Vector2(1920, 1080);
            rectTransform.localScale = new Vector3(0.001f, 0.001f, 0.001f);

            // Add CanvasScaler
            canvasGO.AddComponent<CanvasScaler>();

            // Add GraphicRaycaster
            canvasGO.AddComponent<GraphicRaycaster>();

            // Add CanvasGroup for visibility control
            var canvasGroup = canvasGO.AddComponent<CanvasGroup>();
            canvasGroup.alpha = 1f;
            canvasGroup.blocksRaycasts = true;
            canvasGroup.interactable = true;

            // Set layer to match camera
            canvasGO.layer = camera.gameObject.layer;

            // Create background panel
            var panelGO = new GameObject("Panel");
            panelGO.transform.SetParent(canvasGO.transform, false);
            var panelImage = panelGO.AddComponent<Image>();
            panelImage.color = new Color(0.1f, 0.1f, 0.1f, 0.8f);
            var panelRect = panelGO.GetComponent<RectTransform>();
            panelRect.anchorMin = Vector2.zero;
            panelRect.anchorMax = Vector2.one;
            panelRect.offsetMin = Vector2.zero;
            panelRect.offsetMax = Vector2.zero;

            // Create text
            var textGO = new GameObject("HUDText");
            textGO.transform.SetParent(panelGO.transform, false);
            var text = textGO.AddComponent<Text>();
            text.text = "Arsist AR Engine\n\nCanvas Initialized\nText Rendering\nReady for Content";
            
            // Try multiple font sources
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (text.font == null)
            {
                Debug.LogWarning("[SimpleHUDDisplay] LegacyRuntime.ttf not found, trying Arial.ttf");
                text.font = Resources.GetBuiltinResource<Font>("Arial.ttf");
            }
            if (text.font == null)
            {
                Debug.LogError("[SimpleHUDDisplay] ❌ No built-in font found! Text may not render.");
                // Try to find any font in Resources
                text.font = Resources.FindObjectsOfTypeAll<Font>().FirstOrDefault();
            }
            
            Debug.Log($"[SimpleHUDDisplay] Using font: {(text.font != null ? text.font.name : "NULL")}");
            
            text.fontSize = 48;
            text.fontStyle = FontStyle.Bold;
            text.color = Color.white;
            text.alignment = TextAnchor.MiddleCenter;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            text.raycastTarget = false; // Disable raycasting for performance

            var textRect = textGO.GetComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = new Vector2(50, 50);
            textRect.offsetMax = new Vector2(-50, -50);

            canvasGO.SetActive(true);
            _initialized = true;

            Debug.Log("[SimpleHUDDisplay] ✅ HUD initialized successfully!");
            Debug.Log($"[SimpleHUDDisplay] Canvas: {canvasGO.name}");
            Debug.Log($"[SimpleHUDDisplay] Camera: {camera.name}");
            Debug.Log($"[SimpleHUDDisplay] Layer: {LayerMask.LayerToName(camera.gameObject.layer)}");
        }

        private Camera FindCamera()
        {
            // 1. Main camera
            var cam = Camera.main;
            if (cam != null) return cam;

            // 2. XR Origin
            var xrOrigin = GameObject.Find("XR Origin");
            if (xrOrigin != null)
            {
                cam = xrOrigin.GetComponentInChildren<Camera>();
                if (cam != null) return cam;
            }

            // 3. XREAL_Rig
            var xrealRig = GameObject.Find("XREAL_Rig");
            if (xrealRig != null)
            {
                cam = xrealRig.GetComponentInChildren<Camera>();
                if (cam != null) return cam;
            }

            // 4. Any camera
#if UNITY_2023_1_OR_NEWER
            cam = FindFirstObjectByType<Camera>();
#else
            cam = FindObjectOfType<Camera>();
#endif
            return cam;
        }
    }
}
