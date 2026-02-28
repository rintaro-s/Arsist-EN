using UnityEngine;
using UnityEngine.UI;
using System.Collections;
using System.IO;
using Arsist.Runtime.Events;
using TMPro;

namespace Arsist.Runtime.UI
{
    /// <summary>
    /// Canvas built at build-time needs proper initialization at runtime.
    /// This component ensures Canvas is visible by:
    /// 1. Setting worldCamera correctly
    /// 2. Ensuring all text components (TMP/TextMesh) have valid fonts/materials
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
            Debug.LogError($"[CanvasInitializer] ========== START CALLED on {gameObject.name} ==========");
            Debug.LogError($"[CanvasInitializer] GameObject active: {gameObject.activeInHierarchy}");
            Debug.LogError($"[CanvasInitializer] GameObject layer: {gameObject.layer}");
            StartCoroutine(InitializeAsync());
        }

        private IEnumerator InitializeAsync()
        {
            Debug.LogError("[CanvasInitializer] ========== InitializeAsync START ==========");
            if (_initialized)
            {
                Debug.LogError("[CanvasInitializer] Already initialized, skipping");
                yield break;
            }
            
            _canvas = GetComponent<Canvas>();
            if (_canvas == null)
            {
                Debug.LogError("[CanvasInitializer] ❌ No Canvas component found on " + gameObject.name);
                yield break;
            }
            Debug.LogError($"[CanvasInitializer] ✅ Canvas found: renderMode={_canvas.renderMode}");

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
                Debug.LogError("[CanvasInitializer] ❌ No XR camera found after 5s. Canvas will not render.");
                yield break;
            }
            Debug.LogError($"[CanvasInitializer] ✅ XR Camera found: {_xrCamera.name}");

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

            // Ensure UI layer exists; fallback to Default if missing
            int uiLayer = LayerMask.NameToLayer("UI");
            if (uiLayer < 0)
            {
                uiLayer = 0;
                Debug.LogWarning("[CanvasInitializer] UI layer missing; falling back to Default layer (0)");
            }

            // Ensure camera renders UI layer
            if (_canvas.worldCamera != null)
            {
                _canvas.worldCamera.cullingMask |= (1 << uiLayer);
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

            // === CRITICAL: Ensure all TextMeshProUGUI components are visible and have a font ===
            var tmpTexts = GetComponentsInChildren<TextMeshProUGUI>(true);
            Debug.Log($"[CanvasInitializer] Found {tmpTexts.Length} TextMeshProUGUI components");

            // Try load project-provided Meiryo font first (repo root: src/MEIRYO.TTC)
            TMP_FontAsset defaultFont = null;
            Material defaultMat = null;
            var meiryoPath = Path.Combine(Application.dataPath, "../../../src/MEIRYO.TTC");
            if (File.Exists(meiryoPath))
            {
                try
                {
                    var meiryoFont = new Font(meiryoPath);
                    defaultFont = TMP_FontAsset.CreateFontAsset(meiryoFont);
                    defaultFont.name = "Meiryo SDF (Runtime)";
                    Debug.Log($"[CanvasInitializer] Using MEIRYO.TTC from src: {meiryoPath}");
                }
                catch (System.Exception ex)
                {
                    Debug.LogWarning($"[CanvasInitializer] Failed to create TMP font from MEIRYO.TTC: {ex.Message}");
                }
            }

            // Load default TMP font/material from Resources if available
            if (defaultFont == null)
            {
                defaultFont = Resources.Load<TMP_FontAsset>("LiberationSans SDF");
                defaultMat = Resources.Load<Material>("LiberationSans SDF - Material");
            }

            Debug.LogError($"[CanvasInitializer] ========== FONT SEARCH START ==========");
            Debug.LogError($"[CanvasInitializer] Initial Resources.Load result: {(defaultFont != null ? defaultFont.name : "not found")}");

            // Fallback 1: TMP Settings default font (static)
            Debug.LogError($"[CanvasInitializer] Trying TMP_Settings.defaultFontAsset...");
            Debug.LogError($"[CanvasInitializer] TMP_Settings.instance: {(TMP_Settings.instance != null ? "exists" : "NULL")}");
            if (defaultFont == null && TMP_Settings.instance != null && TMP_Settings.defaultFontAsset != null)
            {
                defaultFont = TMP_Settings.defaultFontAsset;
                Debug.LogError($"[CanvasInitializer] ✅ Using TMP_Settings.defaultFontAsset: {defaultFont.name}");
            }

            // Fallback 2: Search all Resources for any TMP_FontAsset
            if (defaultFont == null)
            {
                var allFonts = Resources.LoadAll<TMP_FontAsset>("");
                if (allFonts != null && allFonts.Length > 0)
                {
                    defaultFont = allFonts[0];
                    Debug.Log($"[CanvasInitializer] Using fallback TMP font from Resources: {defaultFont.name}");
                }
            }

            // Fallback 3: Search scene for any TMP_FontAsset
            if (defaultFont == null)
            {
                var allFonts = FindObjectsOfType<TMP_FontAsset>();
                if (allFonts != null && allFonts.Length > 0)
                {
                    defaultFont = allFonts[0];
                    Debug.Log($"[CanvasInitializer] Using fallback TMP font from scene: {defaultFont.name}");
                }
            }

            // Fallback 4: Check if any TMP component already has a valid font
            if (defaultFont == null)
            {
                foreach (var tmp in tmpTexts)
                {
                    if (tmp.font != null && tmp.font.name != "")
                    {
                        defaultFont = tmp.font;
                        Debug.Log($"[CanvasInitializer] Using font from existing TMP component: {defaultFont.name}");
                        break;
                    }
                }
            }

            // Fallback 5: Generate TMP font from system font at runtime
            if (defaultFont == null)
            {
                Debug.LogError("[CanvasInitializer] No TMP font found. Attempting to generate from system font...");
                try
                {
                    // Try to create a dynamic font from OS fonts (works in Unity 6)
                    var fontNames = new[] { "Arial", "Helvetica", "sans-serif", "Roboto", "Droid Sans" };
                    Font systemFont = null;
                    
                    foreach (var fontName in fontNames)
                    {
                        systemFont = Font.CreateDynamicFontFromOSFont(fontName, 16);
                        if (systemFont != null)
                        {
                            Debug.LogError($"[CanvasInitializer] Found system font: {fontName}");
                            break;
                        }
                    }
                    
                    if (systemFont != null)
                    {
                        Debug.LogError($"[CanvasInitializer] Creating TMP font from system font: {systemFont.name}...");
                        defaultFont = TMP_FontAsset.CreateFontAsset(systemFont);
                        if (defaultFont != null)
                        {
                            defaultFont.name = $"{systemFont.name} SDF (Runtime)";
                            Debug.LogError($"[CanvasInitializer] ✅ Successfully created runtime TMP font: {defaultFont.name}");
                        }
                        else
                        {
                            Debug.LogError("[CanvasInitializer] Failed to create TMP font from system font");
                        }
                    }
                    else
                    {
                        Debug.LogError("[CanvasInitializer] No system fonts available");
                    }
                }
                catch (System.Exception ex)
                {
                    Debug.LogError($"[CanvasInitializer] Failed to generate TMP font: {ex.Message}");
                }
            }

            if (defaultFont == null)
            {
                Debug.LogError("[CanvasInitializer] ========== FONT SEARCH FAILED ==========");
                Debug.LogError("[CanvasInitializer] ❌ CRITICAL: No TMP font found! Text will not render.");
                Debug.LogError("[CanvasInitializer] All fallback methods exhausted.");
            }
            else
            {
                Debug.LogError($"[CanvasInitializer] ========== FONT FOUND: {defaultFont.name} ==========");
            }

            // Apply font to all TextMeshProUGUI components
            Debug.LogError($"[CanvasInitializer] ========== APPLYING FONTS TO {tmpTexts.Length} TMP COMPONENTS ==========");
            int successCount = 0;
            foreach (var tmp in tmpTexts)
            {
                Debug.LogError($"[CanvasInitializer] Processing TMP: '{tmp.text}' on {tmp.gameObject.name}");
                
                // Try to assign font if missing
                if (tmp.font == null && defaultFont != null)
                {
                    tmp.font = defaultFont;
                    Debug.LogError($"[CanvasInitializer] ✅ Assigned font to '{tmp.text}'");
                    successCount++;
                }
                else if (tmp.font == null)
                {
                    Debug.LogError($"[CanvasInitializer] ❌ Cannot assign font (defaultFont is null) to '{tmp.text}'");
                }
                else
                {
                    Debug.LogError($"[CanvasInitializer] ℹ️ '{tmp.text}' already has font: {tmp.font.name}");
                }

                // Try to assign material if missing
                if (tmp.fontSharedMaterial == null)
                {
                    if (defaultMat != null)
                    {
                        tmp.fontSharedMaterial = defaultMat;
                        Debug.Log($"[CanvasInitializer] Assigned material '{defaultMat.name}' to TMP: {tmp.gameObject.name}");
                    }
                    else if (tmp.font != null && tmp.font.material != null)
                    {
                        tmp.fontSharedMaterial = tmp.font.material;
                        Debug.Log($"[CanvasInitializer] Assigned font's material to TMP: {tmp.gameObject.name}");
                    }
                    else
                    {
                        Debug.LogWarning($"[CanvasInitializer] ⚠️ No material available for TMP: {tmp.gameObject.name}");
                    }
                }

                // Ensure text is visible
                if (tmp.color.a < 0.5f)
                {
                    tmp.color = Color.white;
                }

                tmp.enabled = true;
                tmp.gameObject.SetActive(true);
                tmp.ForceMeshUpdate(true, true); // Important for immediate rendering
                Debug.LogError($"[CanvasInitializer] Final state - font: {(tmp.font != null ? tmp.font.name : "NULL")}, enabled: {tmp.enabled}, active: {tmp.gameObject.activeSelf}");
            }
            Debug.LogError($"[CanvasInitializer] ========== FONT ASSIGNMENT COMPLETE: {successCount}/{tmpTexts.Length} ==========");

            // === Ensure legacy TextMesh (3D) components remain visible (fallback) ===
            var textMeshes = GetComponentsInChildren<TextMesh>(true);
            Debug.Log($"[CanvasInitializer] Found {textMeshes.Length} TextMesh components");
            foreach (var tm in textMeshes)
            {
                if (tm.color.a < 0.5f)
                {
                    tm.color = Color.white;
                }

                var meshRenderer = tm.GetComponent<MeshRenderer>();
                if (meshRenderer != null)
                {
                    meshRenderer.enabled = true;
                }

                tm.gameObject.SetActive(true);
                Debug.Log($"[CanvasInitializer] ✅ Configured TextMesh: {tm.gameObject.name} (text='{tm.text}')");
            }

            // === Ensure legacy uGUI Text components (auto-placed) are visible ===
            var legacyTexts = GetComponentsInChildren<Text>(true);
            Debug.Log($"[CanvasInitializer] Found {legacyTexts.Length} legacy Text components");

            Font fallbackFont = null;
            // Prefer bundled MEIRYO.TTC for CJK glyph coverage
            if (File.Exists(meiryoPath))
            {
                try
                {
                    fallbackFont = new Font(meiryoPath);
                    Debug.Log($"[CanvasInitializer] Using MEIRYO.TTC as fallback for legacy Text: {meiryoPath}");
                }
                catch (System.Exception ex)
                {
                    Debug.LogWarning($"[CanvasInitializer] Failed to load MEIRYO.TTC for legacy Text: {ex.Message}");
                }
            }
            if (fallbackFont == null)
            {
                fallbackFont = Resources.GetBuiltinResource<Font>("Arial.ttf");
            }
            foreach (var uiText in legacyTexts)
            {
                if (uiText.font == null)
                {
                    uiText.font = fallbackFont;
                    Debug.Log($"[CanvasInitializer] Assigned fallback font to Text: {uiText.gameObject.name}");
                }

                if (uiText.color.a < 0.5f)
                {
                    uiText.color = Color.white;
                }

                uiText.enabled = true;
                uiText.gameObject.SetActive(true);
            }

            // === CRITICAL: Set to UI layer for UI camera rendering ===
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
            Debug.LogError($"[CanvasInitializer] ========== INITIALIZATION COMPLETE for '{gameObject.name}' ==========");
            Debug.LogError($"[CanvasInitializer] Canvas.worldCamera: {(_canvas.worldCamera != null ? _canvas.worldCamera.name : "NULL")}");
            Debug.LogError($"[CanvasInitializer] Canvas.renderMode: {_canvas.renderMode}");
            Debug.LogError($"[CanvasInitializer] Canvas layer: {gameObject.layer}");
            Debug.LogError($"[CanvasInitializer] ========================================");
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
