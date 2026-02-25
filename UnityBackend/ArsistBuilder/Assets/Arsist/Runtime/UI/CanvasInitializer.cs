using UnityEngine;
using UnityEngine.UI;
using System.Collections;

namespace Arsist.Runtime.UI
{
    /// <summary>
    /// Canvas built at build-time needs proper initialization at runtime.
    /// This component ensures Canvas is visible by:
    /// 1. Setting worldCamera correctly
    /// 2. Ensuring all Text components have fonts
    /// 3. Guaranteeing visibility through CanvasGroup
    /// 4. Verifying layer settings match camera
    /// </summary>
    public class CanvasInitializer : MonoBehaviour
    {
        private Canvas _canvas;
        private Camera _xrCamera;
        private bool _initialized = false;

        private void Start()
        {
            StartCoroutine(InitializeAsync());
        }

        private IEnumerator InitializeAsync()
        {
            if (_initialized) yield break;
            
            _canvas = GetComponent<Canvas>();
            if (_canvas == null)
            {
                Debug.LogError("[CanvasInitializer] No Canvas component found on " + gameObject.name);
                yield break;
            }

            // Wait a frame for scene to fully load
            yield return null;

            // Find XR camera with retries
            float elapsed = 0f;
            while (_xrCamera == null && elapsed < 5f)
            {
                _xrCamera = FindXRCamera();
                if (_xrCamera == null)
                {
                    yield return new WaitForSeconds(0.1f);
                    elapsed += 0.1f;
                }
            }

            if (_xrCamera == null)
            {
                Debug.LogError("[CanvasInitializer] No XR camera found after 5s. Canvas will not render.");
                yield break;
            }

            Debug.Log($"[CanvasInitializer] Found camera: {_xrCamera.name}");

            // === CRITICAL: Find UI camera (created at build time) ===
            Camera uiCamera = null;
            foreach (var cam in FindObjectsOfType<Camera>())
            {
                if (cam.name.Contains("UICamera") && cam.depth > _xrCamera.depth)
                {
                    uiCamera = cam;
                    break;
                }
            }
            
            if (uiCamera != null)
            {
                _canvas.worldCamera = uiCamera;
                Debug.Log($"[CanvasInitializer] Set worldCamera to UI camera: {uiCamera.name}");
            }
            else
            {
                _canvas.worldCamera = _xrCamera;
                Debug.LogWarning($"[CanvasInitializer] UI camera not found, using main camera: {_xrCamera.name}");
            }
            
            // Ensure Canvas is in WorldSpace mode
            _canvas.renderMode = RenderMode.WorldSpace;
            _canvas.sortingOrder = 9999;
            _canvas.overrideSorting = true;

            // Ensure Canvas is active and enabled
            gameObject.SetActive(true);
            _canvas.enabled = true;

            // === CRITICAL: Ensure visibility through CanvasGroup ===
            var canvasGroup = GetComponent<CanvasGroup>();
            if (canvasGroup == null)
            {
                canvasGroup = gameObject.AddComponent<CanvasGroup>();
            }
            canvasGroup.alpha = 1f;
            canvasGroup.blocksRaycasts = true;
            canvasGroup.interactable = true;
            Debug.Log("[CanvasInitializer] CanvasGroup configured");

            // === CRITICAL: Ensure all 3D TextMesh components are visible ===
            var textMeshes = GetComponentsInChildren<TextMesh>(true);
            Debug.Log($"[CanvasInitializer] Found {textMeshes.Length} TextMesh components");
            
            foreach (var tm in textMeshes)
            {
                if (tm.color.a < 0.5f)
                {
                    tm.color = Color.white;
                }
                
                // Ensure MeshRenderer is present and enabled
                var meshRenderer = tm.GetComponent<MeshRenderer>();
                if (meshRenderer != null)
                {
                    meshRenderer.enabled = true;
                }
                
                tm.gameObject.SetActive(true);
                
                Debug.Log($"[CanvasInitializer] ✅ Configured TextMesh: {tm.gameObject.name} (text='{tm.text}')");
            }

            // === CRITICAL: Set to UI layer for UI camera rendering ===
            int uiLayer = LayerMask.NameToLayer("UI");
            gameObject.layer = uiLayer;
            SetLayerRecursively(gameObject, uiLayer);
            Debug.Log($"[CanvasInitializer] Set layer to UI: {uiLayer}");

            // === CRITICAL: Ensure RectTransform is valid ===
            var rectTransform = GetComponent<RectTransform>();
            if (rectTransform != null)
            {
                // Ensure Canvas has proper size
                if (rectTransform.sizeDelta.magnitude < 1f)
                {
                    rectTransform.sizeDelta = new Vector2(1920, 1080);
                    Debug.Log("[CanvasInitializer] Set Canvas size to 1920x1080");
                }
                
                // Ensure scale matches engine coordinate system (1 Unity unit = 1000 pixels)
                if (rectTransform.localScale.magnitude < 0.0001f)
                {
                    rectTransform.localScale = new Vector3(0.001f, 0.001f, 0.001f);
                    Debug.Log("[CanvasInitializer] Set Canvas scale to 0.001");
                }
            }

            Debug.Log($"[CanvasInitializer] ✅ Canvas fully initialized and visible: {gameObject.name}");
            _initialized = true;
        }

        private Camera FindXRCamera()
        {
            // 1. Camera.main (MainCamera tag)
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

            // 4. Any active camera in scene
#if UNITY_2023_1_OR_NEWER
            cam = FindFirstObjectByType<Camera>();
#else
            cam = FindObjectOfType<Camera>();
#endif
            return cam;
        }

        private void SetLayerRecursively(GameObject obj, int layer)
        {
            obj.layer = layer;
            foreach (Transform child in obj.transform)
            {
                SetLayerRecursively(child.gameObject, layer);
            }
        }
    }
}
