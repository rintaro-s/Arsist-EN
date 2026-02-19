// ==============================================
// Arsist Engine - Unity Build Pipeline
// UnityProject/Assets/Arsist/Editor/ArsistBuildPipeline.cs
// ==============================================

using UnityEngine;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using System;
using System.IO;
using System.Collections.Generic;
using System.Reflection;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Arsist.Runtime.RemoteInput;
using UnityEditor.XR.Management;
using UnityEngine.XR.Management;
using UnityEngine.Rendering;

namespace Arsist.Builder
{
    /// <summary>
    /// Arsistエンジンからのビルドコマンドを処理するメインパイプライン
    /// </summary>
    public static class ArsistBuildPipeline
    {
        private static string _outputPath;
        private static string _targetDevice;
        private static bool _developmentBuild;
        private static BuildTarget _buildTarget = BuildTarget.Android;
        private static JObject _manifest;
        private static Dictionary<string, JObject> _uiLayoutCache;

        /// <summary>
        /// CLI経由でビルドを実行（Arsistエンジンから呼び出される）
        /// </summary>
        public static void BuildFromCLI()
        {
            // コマンドライン引数を解析
            ParseCommandLineArgs();

            // マニフェストを読み込み
            var manifestPath = Path.Combine(Application.dataPath, "ArsistGenerated", "manifest.json");
            if (!File.Exists(manifestPath))
            {
                Debug.LogError("[Arsist] manifest.json not found!");
                EditorApplication.Exit(1);
                return;
            }

            _manifest = JObject.Parse(File.ReadAllText(manifestPath));
            Debug.Log($"[Arsist] Building project: {_manifest["projectName"]}");

            // ランタイムでも参照できるよう Resources にコピー
            EnsureRuntimeManifestResource(_manifest);

            try
            {
                // Phase 1: シーン生成
                Debug.Log("[Arsist] Phase 1: Generating scenes...");
                GenerateScenes();

                // Phase 2: UI生成
                Debug.Log("[Arsist] Phase 2: Generating UI...");
                CopyUICodeToStreamingAssets();
                GenerateUI();

                // Phase 3: ビルド設定適用
                Debug.Log("[Arsist] Phase 3: Applying build settings...");
                ApplyBuildSettings(_manifest);

                // Phase 3.1: デバイス固有パッチ（Editorスクリプト）を実行
                Debug.Log("[Arsist] Phase 3.1: Applying device patches...");
                ApplyDevicePatches(_targetDevice);

                // Phase 3.2: ビルド前検証（ここで落とすことで“成功したけど動かない”を避ける）
                Debug.Log("[Arsist] Phase 3.2: Validating build readiness...");
                ValidateBuildReadiness(_targetDevice);

                // Phase 3.3: glTFast に必要なシェーダーを確実にビルドに含める
                Debug.Log("[Arsist] Phase 3.3: Ensuring required shaders...");
                EnsureGltfastShaders();

                // OpenXR は初回ロード直後だと Settings が未ロード扱いになり、BuildPlayer が失敗することがある。
                // Build 前に明示的にロードしておく。
                EnsureOpenXRPackageSettingsLoaded();
                EnsureOpenXRSettingsLoaded();

                // Phase 4: ビルド実行
                Debug.Log("[Arsist] Phase 4: Building APK...");
                ExecuteBuild(_manifest);

                Debug.Log("[Arsist] Build completed successfully!");
                EditorApplication.Exit(0);
            }
            catch (Exception e)
            {
                Debug.LogError($"[Arsist] Build failed: {e.Message}\n{e.StackTrace}");
                EditorApplication.Exit(1);
            }
        }

        private static void ParseCommandLineArgs()
        {
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "-buildTarget":
                        _buildTarget = ParseBuildTarget(args[++i]);
                        break;
                    case "-outputPath":
                        _outputPath = args[++i];
                        break;
                    case "-targetDevice":
                        _targetDevice = args[++i];
                        break;
                    case "-developmentBuild":
                        _developmentBuild = args[++i].ToLower() == "true";
                        break;
                }
            }

            Debug.Log($"[Arsist] Target: {_buildTarget}, Output: {_outputPath}, Device: {_targetDevice}, Dev: {_developmentBuild}");
        }

        private static BuildTarget ParseBuildTarget(string raw)
        {
            var v = (raw ?? "").Trim().ToLowerInvariant();
            return v switch
            {
                "android" => BuildTarget.Android,
                "ios" => BuildTarget.iOS,
                "windows" => BuildTarget.StandaloneWindows64,
                "macos" => BuildTarget.StandaloneOSX,
                _ => BuildTarget.Android,
            };
        }

        private static void EnsureUILayoutCache()
        {
            if (_uiLayoutCache != null) return;
            _uiLayoutCache = new Dictionary<string, JObject>();

            try
            {
                var uiPath = Path.Combine(Application.dataPath, "ArsistGenerated", "ui_layouts.json");
                if (!File.Exists(uiPath)) return;

                var uiJson = File.ReadAllText(uiPath);
                var layouts = JArray.Parse(uiJson);
                foreach (JObject layout in layouts)
                {
                    var id = layout["id"]?.ToString();
                    if (string.IsNullOrEmpty(id)) continue;
                    _uiLayoutCache[id] = layout;
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to load UI layout cache: {e.Message}");
            }
        }

        private static void GenerateScenes()
        {
            var scenesPath = Path.Combine(Application.dataPath, "ArsistGenerated", "scenes.json");
            if (!File.Exists(scenesPath)) return;

            var scenesJson = File.ReadAllText(scenesPath);
            var scenes = JArray.Parse(scenesJson);

            EnsureUILayoutCache();

            var buildScenes = new List<EditorBuildSettingsScene>();

            foreach (JObject scene in scenes)
            {
                var sceneName = scene["name"]?.ToString() ?? "MainScene";
                Debug.Log($"[Arsist] Processing scene: {sceneName}");

                // 新しいシーンを作成
                var newScene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                    UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
                    UnityEditor.SceneManagement.NewSceneMode.Single
                );

                // XR Origin を先に作成（デバイスに応じたプレハブを使用）
                CreateXROrigin();

                // XREAL_Rigを見つける（XRコンテンツの親として使用）
                var xrealRig = GameObject.Find("XREAL_Rig");
                Transform contentParent = xrealRig != null ? xrealRig.transform : null;

                // オブジェクトを生成（XREAL_Rigの子として配置）
                var objects = scene["objects"] as JArray;
                if (objects != null)
                {
                    foreach (JObject obj in objects)
                    {
                        var go = CreateGameObject(obj);
                        if (go != null && contentParent != null)
                        {
                            // **修正: 親に配置した後にトランスフォームを再適用**
                            // これにより、エディタで設定した回転/位置が確実に反映される
                            go.transform.SetParent(contentParent, false); // worldPositionStays = false
                            
                            // トランスフォームデータを再適用
                            var transformData = obj["transform"] as JObject;
                            if (transformData != null)
                            {
                                var pos = transformData["position"] as JObject;
                                var rot = transformData["rotation"] as JObject;
                                var scale = transformData["scale"] as JObject;

                                if (pos != null)
                                {
                                    go.transform.localPosition = new Vector3(
                                        pos["x"]?.Value<float>() ?? 0,
                                        pos["y"]?.Value<float>() ?? 0,
                                        pos["z"]?.Value<float>() ?? 0
                                    );
                                }

                                if (rot != null)
                                {
                                    go.transform.localEulerAngles = new Vector3(
                                        rot["x"]?.Value<float>() ?? 0,
                                        rot["y"]?.Value<float>() ?? 0,
                                        rot["z"]?.Value<float>() ?? 0
                                    );
                                }

                                if (scale != null)
                                {
                                    go.transform.localScale = new Vector3(
                                        scale["x"]?.Value<float>() ?? 1,
                                        scale["y"]?.Value<float>() ?? 1,
                                        scale["z"]?.Value<float>() ?? 1
                                    );
                                }
                            }
                        }
                    }
                }

                // Remote Input（UDP/TCP）を追加
                EnsureRemoteInputInScene(_manifest);

                // ランタイム基盤コンポーネントを追加
                CreateRuntimeSystems(_manifest);

                // シーンを保存
                var scenePath = $"Assets/Scenes/{sceneName}.unity";
                Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(Application.dataPath, "..", scenePath)));
                UnityEditor.SceneManagement.EditorSceneManager.SaveScene(newScene, scenePath);
                AssetDatabase.Refresh();
                
                // ビルド設定に追加
                buildScenes.Add(new EditorBuildSettingsScene(scenePath, true));
                Debug.Log($"[Arsist] Scene added to build settings: {scenePath}");
            }
            
            // ビルド設定を更新
            if (buildScenes.Count > 0)
            {
                EditorBuildSettings.scenes = buildScenes.ToArray();
                Debug.Log($"[Arsist] Build settings updated with {buildScenes.Count} scene(s)");
            }
        }

        private static GameObject CreateGameObject(JObject objData)
        {
            var name = objData["name"]?.ToString() ?? "GameObject";
            var type = objData["type"]?.ToString() ?? "empty";
            var modelPath = objData["modelPath"]?.ToString();

            GameObject go = null;

            // モデル読み込み（GLB/GLTF）
            if (type == "model" && !string.IsNullOrEmpty(modelPath))
            {
                go = CreateModelGameObject(name, modelPath);
            }
            // Dynamic UI Surface
            else if (type == "ui_surface" || type == "canvas")
            {
                go = CreateUISurfaceGameObject(objData);
            }
            // プリミティブ作成
            else if (type == "primitive")
            {
                var primitiveType = objData["primitiveType"]?.ToString() ?? "cube";
                PrimitiveType pType = primitiveType switch
                {
                    "cube" => PrimitiveType.Cube,
                    "sphere" => PrimitiveType.Sphere,
                    "plane" => PrimitiveType.Plane,
                    "cylinder" => PrimitiveType.Cylinder,
                    "capsule" => PrimitiveType.Capsule,
                    _ => PrimitiveType.Cube
                };
                go = GameObject.CreatePrimitive(pType);
            }
            else if (type == "light")
            {
                go = new GameObject(name);
                var light = go.AddComponent<Light>();
                light.type = LightType.Point;
            }
            else
            {
                go = new GameObject(name);
            }

            go.name = name;

            // **重要: Transform適用は親に配置する前に行う**
            // これにより、親の回転の影響を受けずにエディタと同じ結果になる
            var transformData = objData["transform"] as JObject;
            if (transformData != null)
            {
                var pos = transformData["position"] as JObject;
                var rot = transformData["rotation"] as JObject;
                var scale = transformData["scale"] as JObject;

                if (pos != null)
                    go.transform.position = new Vector3(
                        pos["x"]?.Value<float>() ?? 0,
                        pos["y"]?.Value<float>() ?? 0,
                        pos["z"]?.Value<float>() ?? 0
                    );

                if (rot != null)
                {
                    // **修正: eulerAngles（ワールド座標）ではなく localEulerAngles を使用**
                    // これにより、親がいても正しく回転が適用される
                    var rotation = new Vector3(
                        rot["x"]?.Value<float>() ?? 0,
                        rot["y"]?.Value<float>() ?? 0,
                        rot["z"]?.Value<float>() ?? 0
                    );
                    go.transform.localEulerAngles = rotation;
                    Debug.Log($"[Arsist] Applied rotation to {name}: {rotation}");
                }

                if (scale != null)
                    go.transform.localScale = new Vector3(
                        scale["x"]?.Value<float>() ?? 1,
                        scale["y"]?.Value<float>() ?? 1,
                        scale["z"]?.Value<float>() ?? 1
                    );
            }

            // マテリアル適用
            var material = objData["material"] as JObject;
            if (material != null && go.TryGetComponent<Renderer>(out var renderer))
            {
                var shader = FindSafeShader(new[]
                {
                    "Standard",
                    "Universal Render Pipeline/Lit",
                    "Universal Render Pipeline/Unlit",
                    "Unlit/Color",
                    "Sprites/Default",
                });

                if (shader == null)
                {
                    Debug.LogWarning("[Arsist] No compatible shader found for material. Skipping material setup.");
                    return go;
                }

                var mat = new Material(shader);
                
                var colorHex = material["color"]?.ToString() ?? "#FFFFFF";
                if (ColorUtility.TryParseHtmlString(colorHex, out Color color))
                {
                    mat.color = color;
                }
                
                mat.SetFloat("_Metallic", material["metallic"]?.Value<float>() ?? 0);
                mat.SetFloat("_Glossiness", 1 - (material["roughness"]?.Value<float>() ?? 0.5f));
                
                renderer.material = mat;
            }

            return go;
        }

        private static Shader FindSafeShader(IEnumerable<string> candidates)
        {
            foreach (var name in candidates)
            {
                if (string.IsNullOrWhiteSpace(name)) continue;
                var s = Shader.Find(name);
                if (s != null) return s;
            }
            return null;
        }

        /// <summary>
        /// glTFast がランタイムで使用するシェーダーを Always Included Shaders に追加。
        /// Built-in RP では Standard / Unlit 系が必要。これがないと IL2CPP ストリップで
        /// Shader.Find("Standard") が null を返し、マテリアル生成で NullRef になる。
        /// </summary>
        private static void EnsureGltfastShaders()
        {
            try
            {
                var graphicsSettings = AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.GraphicsSettings>(
                    "ProjectSettings/GraphicsSettings.asset");

                // GraphicsSettings はSerializedObject経由で編集する
                var so = new SerializedObject(
                    AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset")[0]);
                var arrayProp = so.FindProperty("m_AlwaysIncludedShaders");

                // 必要なシェーダー名リスト
                var requiredShaders = new[]
                {
                    "Standard",
                    "Unlit/Color",
                    "Unlit/Texture",
                    "Unlit/Transparent",
                    "UI/Default",
                    "TextMeshPro/Mobile/Distance Field",
                    "Sprites/Default",
                };

                // 既に含まれているシェーダーを収集
                var existingGuids = new HashSet<string>();
                for (int i = 0; i < arrayProp.arraySize; i++)
                {
                    var elem = arrayProp.GetArrayElementAtIndex(i);
                    var shader = elem.objectReferenceValue as Shader;
                    if (shader != null) existingGuids.Add(shader.name);
                }

                int added = 0;
                foreach (var shaderName in requiredShaders)
                {
                    if (existingGuids.Contains(shaderName)) continue;

                    var shader = Shader.Find(shaderName);
                    if (shader == null)
                    {
                        Debug.LogWarning($"[Arsist] Shader not found: {shaderName}");
                        continue;
                    }

                    int idx = arrayProp.arraySize;
                    arrayProp.InsertArrayElementAtIndex(idx);
                    arrayProp.GetArrayElementAtIndex(idx).objectReferenceValue = shader;
                    added++;
                }

                if (added > 0)
                {
                    so.ApplyModifiedPropertiesWithoutUndo();
                    Debug.Log($"[Arsist] Added {added} shaders to Always Included Shaders");
                }
                else
                {
                    Debug.Log("[Arsist] All required shaders already included");
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to ensure shaders: {e.Message}");

                // フォールバック: Resources フォルダにダミーマテリアルを作ってシェーダーを強制含有
                try
                {
                    var resourcesDir = Path.Combine(Application.dataPath, "Resources");
                    Directory.CreateDirectory(resourcesDir);

                    // Standard シェーダーのダミーマテリアルを作成
                    var standardShader = Shader.Find("Standard");
                    if (standardShader != null)
                    {
                        var mat = new Material(standardShader);
                        AssetDatabase.CreateAsset(mat, "Assets/Resources/GltfastFallbackStandard.mat");
                    }

                    var unlitShader = Shader.Find("Unlit/Color");
                    if (unlitShader != null)
                    {
                        var mat = new Material(unlitShader);
                        AssetDatabase.CreateAsset(mat, "Assets/Resources/GltfastFallbackUnlit.mat");
                    }

                    AssetDatabase.Refresh();
                    Debug.Log("[Arsist] Created fallback materials in Resources to ensure shader inclusion");
                }
                catch (Exception e2)
                {
                    Debug.LogError($"[Arsist] Shader fallback also failed: {e2.Message}");
                }
            }
        }

        private static void EnsureRuntimeManifestResource(JObject manifest)
        {
            try
            {
                var resourcesDir = Path.Combine(Application.dataPath, "Resources");
                Directory.CreateDirectory(resourcesDir);
                var outPath = Path.Combine(resourcesDir, "ArsistManifest.json");
                File.WriteAllText(outPath, manifest.ToString(Formatting.Indented));
                AssetDatabase.Refresh();
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to write runtime manifest resource: {e.Message}");
            }
        }

        private static void EnsureRemoteInputInScene(JObject manifest)
        {
            try
            {
                var remoteInput = manifest["remoteInput"] as JObject;
                if (remoteInput == null) return;

                var udpEnabled = remoteInput.SelectToken("udp.enabled")?.Value<bool>() ?? false;
                var tcpEnabled = remoteInput.SelectToken("tcp.enabled")?.Value<bool>() ?? false;
                if (!udpEnabled && !tcpEnabled) return;

                var go = GameObject.Find("ArsistRemoteInput");
                if (go == null) go = new GameObject("ArsistRemoteInput");

                if (go.GetComponent<ArsistRemoteInputBehaviour>() == null)
                {
                    go.AddComponent<ArsistRemoteInputBehaviour>();
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to ensure remote input in scene: {e.Message}");
            }
        }

        private static void CreateXROrigin()
        {
            // ===== XREAL Rig (required for XREAL One) =====
            // Desired hierarchy:
            // XREAL_Rig
            //  ├── XR Origin
            //  │    └── Camera Offset
            //  │         └── Main Camera
            //  ├── AR Session
            //  └── XREAL Session Config

            bool isXreal = !string.IsNullOrEmpty(_targetDevice) && _targetDevice.ToLower().Contains("xreal");

            GameObject rigRoot = null;
            if (isXreal)
            {
                rigRoot = new GameObject("XREAL_Rig");
            }

            // XR Origin プレハブを探してインスタンス化（将来: アダプター側prefabに差し替え）
            GameObject xrOrigin = null;
            var xrOriginPrefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Arsist/Prefabs/XROrigin.prefab");
            if (xrOriginPrefab != null)
            {
                xrOrigin = (GameObject)PrefabUtility.InstantiatePrefab(xrOriginPrefab);
                xrOrigin.name = "XR Origin";
                xrOrigin.transform.position = Vector3.zero;
            }
            else
            {
                xrOrigin = new GameObject("XR Origin");
                xrOrigin.transform.position = Vector3.zero;

                var cameraOffset = new GameObject("Camera Offset");
                cameraOffset.transform.SetParent(xrOrigin.transform);
                cameraOffset.transform.localPosition = Vector3.zero;

                var mainCamera = new GameObject("Main Camera");
                mainCamera.tag = "MainCamera";
                mainCamera.transform.SetParent(cameraOffset.transform);
                mainCamera.transform.localPosition = Vector3.zero;
                mainCamera.transform.localRotation = Quaternion.identity;
                mainCamera.AddComponent<Camera>();
                mainCamera.AddComponent<AudioListener>();

                // Best-effort: TrackedPoseDriver (Input System or Legacy)
                TryAddComponentByTypeName(mainCamera, "UnityEngine.InputSystem.XR.TrackedPoseDriver");
                TryAddComponentByTypeName(mainCamera, "UnityEngine.SpatialTracking.TrackedPoseDriver");
            }

            if (rigRoot != null)
            {
                xrOrigin.transform.SetParent(rigRoot.transform);
            }

            // Best-effort: XR Origin component (Core Utils)
            TryAddComponentByTypeName(xrOrigin, "Unity.XR.CoreUtils.XROrigin");
            TryAddComponentByTypeName(xrOrigin, "UnityEngine.XR.Interaction.Toolkit.XROrigin");

            // Add Arsist runtime setup (exists in this project)
            var setupType = Type.GetType("Arsist.Runtime.XROriginSetup, Assembly-CSharp");
            if (setupType != null && xrOrigin.GetComponent(setupType) == null)
            {
                xrOrigin.AddComponent(setupType);
            }

            // AR Session (AR Foundation)
            if (rigRoot != null)
            {
                var arSessionGO = new GameObject("AR Session");
                arSessionGO.transform.SetParent(rigRoot.transform);
                TryAddComponentByTypeName(arSessionGO, "UnityEngine.XR.ARFoundation.ARSession");

                var xrealConfigGO = new GameObject("XREAL Session Config");
                xrealConfigGO.transform.SetParent(rigRoot.transform);
                // SDK固有型は不明なため、名前候補でbest-effort追加
                TryAddComponentByTypeName(xrealConfigGO, "XREALSessionConfig");
                TryAddComponentByTypeName(xrealConfigGO, "XrealSessionConfig");
            }

            Debug.Log(isXreal ? "[Arsist] XREAL_Rig created" : "[Arsist] XR Origin created");
        }

        /// <summary>
        /// GLB/GLTFモデルをインポートしてGameObjectとして生成
        /// </summary>
        private static GameObject CreateModelGameObject(string name, string modelPath)
        {
            // modelPath: "Assets/Models/xxx.glb" または相対パス
            // ArsistProjectAssets からコピーされたアセットを探す
            var possiblePaths = new[]
            {
                modelPath,
                $"Assets/ArsistProjectAssets/{modelPath}",
                $"Assets/ArsistProjectAssets/Models/{Path.GetFileName(modelPath)}",
                $"Assets/Models/{Path.GetFileName(modelPath)}"
            };

            string foundAssetPath = null;
            foreach (var p in possiblePaths)
            {
                var fullPath = Path.Combine(Application.dataPath, "..", p);
                if (File.Exists(fullPath))
                {
                    foundAssetPath = p;
                    break;
                }
            }

            if (string.IsNullOrEmpty(foundAssetPath))
            {
                Debug.LogWarning($"[Arsist] Model not found: {modelPath}. Creating empty placeholder.");
                var placeholder = new GameObject(name);
                placeholder.AddComponent<MeshRenderer>();
                return placeholder;
            }

            // GLBをAssets/Models/にコピーしてUnityのImporterで処理させる（正しい方法）
            var importedPath = ImportModelAsAsset(foundAssetPath, name);
            if (!string.IsNullOrEmpty(importedPath))
            {
                // インポート済みアセットからPrefabをインスタンス化
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(importedPath);
                if (prefab != null)
                {
                    // **FIX: GLBモデルをラップする空の親オブジェクトを作成**
                    // これにより、外部から設定する回転が確実に適用される
                    var wrapper = new GameObject(name);
                    var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                    instance.name = name + "_Model";
                    instance.transform.SetParent(wrapper.transform, false);
                    
                    // GLBの初期位置/回転/スケールをリセット（親で制御するため）
                    instance.transform.localPosition = Vector3.zero;
                    instance.transform.localRotation = Quaternion.identity;
                    instance.transform.localScale = Vector3.one;
                    
                    Debug.Log($"[Arsist] Model imported and wrapped: {importedPath}");
                    return wrapper;
                }
            }

            Debug.LogWarning($"[Arsist] Failed to import model: {foundAssetPath}. Creating placeholder.");
            var fallback = new GameObject(name);
            fallback.AddComponent<MeshRenderer>();
            return fallback;
        }

        private static GameObject CreateUISurfaceGameObject(JObject objData)
        {
            var name = objData["name"]?.ToString() ?? "UISurface";
            var surfaceData = objData["uiSurface"] as JObject;
            var canvasSettings = objData["canvasSettings"] as JObject;

            // 後方互換: uiSurface（旧）と canvasSettings（現行）を両対応
            var layoutId =
                surfaceData?["layoutId"]?.ToString() ??
                canvasSettings?["layoutId"]?.ToString() ??
                string.Empty;

            var width =
                surfaceData?["width"]?.Value<float>() ??
                canvasSettings?["widthMeters"]?.Value<float>() ??
                1.2f;

            var height =
                surfaceData?["height"]?.Value<float>() ??
                canvasSettings?["heightMeters"]?.Value<float>() ??
                0.7f;

            var pixelsPerUnit =
                surfaceData?["pixelsPerUnit"]?.Value<float>() ??
                canvasSettings?["pixelsPerUnit"]?.Value<float>() ??
                1000f;

            var root = new GameObject(name);

            // Surface plane (for spatial reference)
            var quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
            quad.name = "UISurface";
            quad.transform.SetParent(root.transform, false);
            quad.transform.localScale = new Vector3(width, height, 1f);

            var renderer = quad.GetComponent<Renderer>();
            if (renderer != null)
            {
                var shader = FindSafeShader(new[] { "Unlit/Color", "Universal Render Pipeline/Unlit", "Standard" });
                if (shader != null)
                {
                    var mat = new Material(shader);
                    mat.color = new Color(0.1f, 0.1f, 0.1f, 0.6f);
                    renderer.material = mat;
                }
            }

            // World-space Canvas
            var canvasGO = new GameObject("UISurfaceCanvas");
            canvasGO.transform.SetParent(root.transform, false);
            var canvas = canvasGO.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;

            var canvasScaler = canvasGO.AddComponent<UnityEngine.UI.CanvasScaler>();
            canvasScaler.dynamicPixelsPerUnit = pixelsPerUnit;
            canvasGO.AddComponent<UnityEngine.UI.GraphicRaycaster>();

            var rect = canvasGO.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(width * pixelsPerUnit, height * pixelsPerUnit);
            rect.localScale = Vector3.one / pixelsPerUnit;
            rect.localPosition = Vector3.zero;
            rect.localRotation = Quaternion.identity;

            EnsureUILayoutCache();
            if (!string.IsNullOrEmpty(layoutId) && _uiLayoutCache != null && _uiLayoutCache.TryGetValue(layoutId, out var layout))
            {
                var rootEl = layout["root"] as JObject;
                if (rootEl != null)
                {
                    CreateUIElement(rootEl, canvasGO.transform);
                }
                else
                {
                    Debug.LogWarning($"[Arsist] UI layout root not found for layoutId: {layoutId}");
                }
            }
            else
            {
                Debug.LogWarning($"[Arsist] UI layout not found for layoutId: {layoutId}");
            }

            return root;
        }

        private static string ImportModelAsAsset(string sourceAssetPath, string modelName)
        {
            try
            {
                // Assets/Models/ にコピー（Unityが自動インポート）
                var modelsDir = Path.Combine(Application.dataPath, "Models");
                Directory.CreateDirectory(modelsDir);

                var sourceFullPath = Path.Combine(Application.dataPath, "..", sourceAssetPath);
                var fileName = Path.GetFileName(sourceFullPath);
                var destFullPath = Path.Combine(modelsDir, fileName);
                var destAssetPath = $"Assets/Models/{fileName}";

                // ファイルをコピー（既に存在する場合はスキップ）
                if (!File.Exists(destFullPath))
                {
                    File.Copy(sourceFullPath, destFullPath, false);
                    Debug.Log($"[Arsist] Copied model to: {destAssetPath}");
                }
                else
                {
                    Debug.Log($"[Arsist] Model already exists, skipping copy: {destAssetPath}");
                }
                
                // .metaファイルを作成してguid生成
                var metaPath = destFullPath + ".meta";
                if (!File.Exists(metaPath))
                {
                    var guid = System.Guid.NewGuid().ToString("N");
                    // glTFast Importer用のmeta
                    var metaContent = $@"fileFormatVersion: 2
guid: {guid}
ScriptedImporter:
  internalIDToNameTable: []
  externalObjects: {{}}
  serializedVersion: 2
  userData: 
  assetBundleName: 
  assetBundleVariant: 
  script: {{fileID: 11500000, guid: cc45016b844e7624dae3aec10fb443ea, type: 3}}
  reverseAxis: 0
  renderPipeline: 0
";
                    File.WriteAllText(metaPath, metaContent);
                    Debug.Log($"[Arsist] Created .meta for: {destAssetPath}");
                }

                // AssetDatabaseをリフレッシュしてインポート実行
                AssetDatabase.Refresh();
                AssetDatabase.ImportAsset(destAssetPath, ImportAssetOptions.ForceUpdate | ImportAssetOptions.ForceSynchronousImport);
                
                Debug.Log($"[Arsist] Model imported to Unity: {destAssetPath}");
                return destAssetPath;
            }
            catch (Exception e)
            {
                Debug.LogError($"[Arsist] Failed to import model: {e.Message}\n{e.StackTrace}");
                return null;
            }
        }

        private static bool TryConfigureRuntimeModelLoader(GameObject go, string runtimePath)
        {
            try
            {
                var comp = TryAddComponentByTypeName(go, "Arsist.Runtime.ArsistModelRuntimeLoader");
                if (comp == null) return false;

                var t = comp.GetType();
                var field = t.GetField("modelPath");
                if (field != null)
                {
                    field.SetValue(comp, runtimePath);
                }

                var destroyField = t.GetField("destroyAfterLoad");
                if (destroyField != null)
                {
                    destroyField.SetValue(comp, true);
                }

                return true;
            }
            catch
            {
                return false;
            }
        }

        private static Component TryAddComponentByTypeName(GameObject go, string fullTypeName)
        {
            try
            {
                var t = FindType(fullTypeName);
                if (t == null) return null;
                if (go.GetComponent(t) != null) return go.GetComponent(t);
                return go.AddComponent(t);
            }
            catch
            {
                return null;
            }
        }

        private static Type FindType(string fullTypeName)
        {
            // Fast path
            var t = Type.GetType(fullTypeName);
            if (t != null) return t;

            // Search loaded assemblies
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    t = asm.GetType(fullTypeName);
                    if (t != null) return t;
                }
                catch { }
            }
            return null;
        }

        /// <summary>
        /// ランタイム基盤システムを追加
        /// </summary>
        private static void CreateRuntimeSystems(JObject manifest)
        {
            // [ArsistRuntimeSystems] 親オブジェクト
            var systemsRoot = new GameObject("[ArsistRuntimeSystems]");
            
            // DataManager（永続データ）
            TryAddComponentByTypeName(systemsRoot, "Arsist.Runtime.Data.ArsistDataManager");

            // DataFlow（DataSource / Transform / Store）
            TryAddComponentByTypeName(systemsRoot, "Arsist.Runtime.DataFlow.ArsistDataFlowEngine");
            
            // EventBus（イベント通信）
            TryAddComponentByTypeName(systemsRoot, "Arsist.Runtime.Events.ArsistEventBus");
            
            // AudioManager（サウンド）
            TryAddComponentByTypeName(systemsRoot, "Arsist.Runtime.Audio.ArsistAudioManager");
            
            // SceneManager（シーン遷移）
            TryAddComponentByTypeName(systemsRoot, "Arsist.Runtime.Scene.ArsistSceneManager");
            
            // GazeInput（視線入力）- メインカメラに追加
            var mainCam = Camera.main;
            if (mainCam != null)
            {
                TryAddComponentByTypeName(mainCam.gameObject, "Arsist.Runtime.Input.ArsistGazeInput");
            }

            Debug.Log("[Arsist] Runtime systems created");
        }

        /// <summary>
        /// UIコード（HTML/CSS/JS）をStreamingAssetsにコピー
        /// </summary>
        private static void CopyUICodeToStreamingAssets()
        {
            var uiCodeDir = Path.Combine(Application.dataPath, "ArsistGenerated", "UICode");
            if (!Directory.Exists(uiCodeDir))
            {
                Debug.Log("[Arsist] UICode directory not found, skipping WebView UI");
                return;
            }

            var streamingUIDir = Path.Combine(Application.dataPath, "StreamingAssets", "ArsistUI");
            Directory.CreateDirectory(streamingUIDir);

            try
            {
                // HTMLファイルをコピー
                var htmlSrc = Path.Combine(uiCodeDir, "index.html");
                if (File.Exists(htmlSrc))
                {
                    File.Copy(htmlSrc, Path.Combine(streamingUIDir, "index.html"), true);
                    Debug.Log("[Arsist] Copied UI HTML to StreamingAssets");
                }

                // CSSファイルをコピー
                var cssSrc = Path.Combine(uiCodeDir, "styles.css");
                if (File.Exists(cssSrc))
                {
                    File.Copy(cssSrc, Path.Combine(streamingUIDir, "styles.css"), true);
                }

                // JSファイルをコピー
                var jsSrc = Path.Combine(uiCodeDir, "script.js");
                if (File.Exists(jsSrc))
                {
                    File.Copy(jsSrc, Path.Combine(streamingUIDir, "script.js"), true);
                }

                AssetDatabase.Refresh();
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to copy UI code to StreamingAssets: {e.Message}");
            }
        }

        private static void GenerateUI()
        {
            var uiPath = Path.Combine(Application.dataPath, "ArsistGenerated", "ui_layouts.json");
            if (File.Exists(uiPath))
            {
                Debug.Log("[Arsist] Generating Canvas UI from IR (ui_layouts.json)");
                GenerateCanvasUI(uiPath);
            }
            else
            {
                Debug.LogWarning("[Arsist] No UI layout IR found: ui_layouts.json");
            }
        }

        /// <summary>
        /// Canvas UIを生成（従来方式）
        /// </summary>
        private static void GenerateCanvasUI(string uiPath)
        {
            var uiJson = File.ReadAllText(uiPath);
            var layouts = JArray.Parse(uiJson);

            foreach (JObject layout in layouts)
            {
                var scope = layout["scope"]?.ToString() ?? "uhd";
                // 常時表示CanvasはUHDのみ生成。3D配置canvasはScene object側で生成する。
                if (scope != "uhd")
                {
                    continue;
                }
                var layoutName = layout["name"]?.ToString() ?? "MainUI";
                Debug.Log($"[Arsist] Processing UI layout: {layoutName}");

                // Canvas作成
                var canvasGO = new GameObject($"Canvas_{layoutName}");
                var canvas = canvasGO.AddComponent<Canvas>();
                canvas.renderMode = RenderMode.WorldSpace;
                canvas.sortingOrder = 100;
                
                var canvasScaler = canvasGO.AddComponent<UnityEngine.UI.CanvasScaler>();
                canvasScaler.dynamicPixelsPerUnit = 100;
                
                canvasGO.AddComponent<UnityEngine.UI.GraphicRaycaster>();

                // Canvas のサイズ設定（XREAL One: 1920x1080）
                var rectTransform = canvasGO.GetComponent<RectTransform>();
                rectTransform.sizeDelta = new Vector2(1920, 1080);
                rectTransform.localScale = new Vector3(0.001f, 0.001f, 0.001f);

                // 3DoF/Head-lockedの「最初にどこを見ているか」を決める
                var trackingMode = _manifest?["arSettings"]?["trackingMode"]?.ToString() ?? "6dof";
                var presentationMode = _manifest?["arSettings"]?["presentationMode"]?.ToString() ?? "world_anchored";
                var distance = _manifest?["arSettings"]?["floatingScreen"]?["distance"]?.Value<float>() ?? 2f;
                var normalizedTarget = (_targetDevice ?? "").ToLowerInvariant();
                var isQuest = normalizedTarget.Contains("quest") || normalizedTarget.Contains("meta");

                var mainCam = Camera.main;
                if (mainCam != null && (isQuest || trackingMode == "3dof" || presentationMode == "head_locked_hud" || presentationMode == "floating_screen"))
                {
                    // Quest/UHDは確実に見えるようにカメラ直下へ固定
                    canvasGO.transform.SetParent(mainCam.transform, false);
                    rectTransform.localPosition = new Vector3(0f, 0f, Mathf.Max(0.5f, distance));
                    rectTransform.localRotation = Quaternion.identity;
                }
                else
                {
                    rectTransform.position = new Vector3(0, 1.5f, 3f);
                }

                // UIエレメントを生成
                var root = layout["root"] as JObject;
                if (root != null)
                {
                    CreateUIElement(root, canvasGO.transform);
                }
            }
        }

        /// <summary>
        /// WebView UIを生成して常時表示
        /// </summary>
        private static void CreateWebViewUI()
        {
            var webViewGO = new GameObject("[ArsistWebViewUI]");
            
            // XREAL_Rigの子として配置（XRシーンでは必須）
            var xrealRig = GameObject.Find("XREAL_Rig");
            if (xrealRig != null)
            {
                webViewGO.transform.SetParent(xrealRig.transform, false);
                Debug.Log("[Arsist] WebViewUI placed under XREAL_Rig");
            }
            else
            {
                Debug.LogWarning("[Arsist] XREAL_Rig not found, WebViewUI placed at root");
            }
            
            var webViewComp = TryAddComponentByTypeName(webViewGO, "Arsist.Runtime.UI.ArsistWebViewUI");
            if (webViewComp != null)
            {
                var t = webViewComp.GetType();
                
                // htmlPathを設定
                var htmlPathField = t.GetField("htmlPath");
                if (htmlPathField != null)
                {
                    htmlPathField.SetValue(webViewComp, "ArsistUI/index.html");
                    Debug.Log("[Arsist] WebViewUI htmlPath set to: ArsistUI/index.html");
                }
                
                // 画面サイズを設定（XREAL One: 1920x1080）
                var widthField = t.GetField("width");
                if (widthField != null)
                {
                    widthField.SetValue(webViewComp, 1920);
                }
                
                var heightField = t.GetField("height");
                if (heightField != null)
                {
                    heightField.SetValue(webViewComp, 1080);
                }
                
                // Head-locked設定
                var presentationMode = _manifest?["arSettings"]?["presentationMode"]?.ToString() ?? "world_anchored";
                var headLocked = presentationMode == "head_locked_hud" || presentationMode == "floating_screen";
                
                var headLockedField = t.GetField("headLocked");
                if (headLockedField != null)
                {
                    headLockedField.SetValue(webViewComp, headLocked);
                    Debug.Log($"[Arsist] WebViewUI headLocked set to: {headLocked}");
                }
                
                // 距離を設定
                var distance = _manifest?["arSettings"]?["floatingScreen"]?["distance"]?.Value<float>() ?? 2f;
                var distanceField = t.GetField("distance");
                if (distanceField != null)
                {
                    distanceField.SetValue(webViewComp, distance);
                }
                
                // **autoInitializeを確実にtrueに設定**
                var autoInitField = t.GetField("autoInitialize");
                if (autoInitField != null)
                {
                    autoInitField.SetValue(webViewComp, true);
                    Debug.Log("[Arsist] WebViewUI autoInitialize set to: true");
                }
                
                Debug.Log("[Arsist] ✅ WebView UI component configured successfully");
            }
            else
            {
                Debug.LogError("[Arsist] ❌ ArsistWebViewUI component not found! Make sure the Runtime assembly is included.");
            }
        }

        private static void CreateUIElement(JObject elementData, Transform parent)
        {
            var type = elementData["type"]?.ToString() ?? "Panel";
            var go = new GameObject(type);
            go.transform.SetParent(parent, false);

            var rectTransform = go.AddComponent<RectTransform>();
            var style = elementData["style"] as JObject;
            ApplyRectTransformStyle(rectTransform, style);
            
            switch (type)
            {
                case "Panel":
                    var image = go.AddComponent<UnityEngine.UI.Image>();
                    if (TryParseColor(style?["backgroundColor"], out var panelColor))
                    {
                        image.color = panelColor;
                    }
                    else
                    {
                        image.color = Color.clear;
                    }
                    break;
                    
                case "Text":
                    var text = go.AddComponent<TMPro.TextMeshProUGUI>();
                    text.text = elementData["content"]?.ToString() ?? "Text";
                    text.enableAutoSizing = false;
                    if (style != null)
                    {
                        text.fontSize = style["fontSize"]?.Value<float>() ?? 24;
                        if (TryParseColor(style["color"], out var textColor))
                        {
                            text.color = textColor;
                        }

                        var align = style["textAlign"]?.ToString();
                        text.alignment = align switch
                        {
                            "center" => TMPro.TextAlignmentOptions.Center,
                            "right" => TMPro.TextAlignmentOptions.Right,
                            _ => TMPro.TextAlignmentOptions.Left,
                        };
                    }

                    if (IsAutoValue(style?["width"]) || IsAutoValue(style?["height"]))
                    {
                        var fitter = go.AddComponent<UnityEngine.UI.ContentSizeFitter>();
                        fitter.horizontalFit = IsAutoValue(style?["width"]) ? UnityEngine.UI.ContentSizeFitter.FitMode.PreferredSize : UnityEngine.UI.ContentSizeFitter.FitMode.Unconstrained;
                        fitter.verticalFit = IsAutoValue(style?["height"]) ? UnityEngine.UI.ContentSizeFitter.FitMode.PreferredSize : UnityEngine.UI.ContentSizeFitter.FitMode.Unconstrained;
                    }
                    break;
                    
                case "Button":
                    var buttonImage = go.AddComponent<UnityEngine.UI.Image>();
                    if (TryParseColor(style?["backgroundColor"], out var buttonColor))
                    {
                        buttonImage.color = buttonColor;
                    }
                    else
                    {
                        buttonImage.color = new Color(0.91f, 0.27f, 0.38f, 1f);
                    }
                    var button = go.AddComponent<UnityEngine.UI.Button>();
                    
                    go.AddComponent<BoxCollider>();
                    TryAddComponentByTypeName(go, "Arsist.Runtime.Input.ArsistGazeTarget");
                    
                    var buttonTextGO = new GameObject("Text");
                    buttonTextGO.transform.SetParent(go.transform, false);
                    var buttonTextRt = buttonTextGO.AddComponent<RectTransform>();
                    buttonTextRt.anchorMin = Vector2.zero;
                    buttonTextRt.anchorMax = Vector2.one;
                    buttonTextRt.offsetMin = Vector2.zero;
                    buttonTextRt.offsetMax = Vector2.zero;

                    var buttonText = buttonTextGO.AddComponent<TMPro.TextMeshProUGUI>();
                    buttonText.text = elementData["content"]?.ToString() ?? "Button";
                    buttonText.alignment = TMPro.TextAlignmentOptions.Center;
                    buttonText.fontSize = style?["fontSize"]?.Value<float>() ?? 16f;
                    if (TryParseColor(style?["color"], out var buttonTextColor))
                    {
                        buttonText.color = buttonTextColor;
                    }
                    break;

                case "Image":
                    var uiImage = go.AddComponent<UnityEngine.UI.Image>();
                    uiImage.color = Color.white;
                    var assetPath = elementData["assetPath"]?.ToString();
                    if (!string.IsNullOrEmpty(assetPath))
                    {
                        // Arsistプロジェクトの相対パス (Assets/Textures/...) を Unity側 (Assets/ArsistProjectAssets/Textures/...) にマップ
                        var unityAssetPath = assetPath.StartsWith("Assets/")
                            ? "Assets/ArsistProjectAssets/" + assetPath.Substring("Assets/".Length)
                            : assetPath;

                        EnsureTextureIsSprite(unityAssetPath);
                        var sprite = AssetDatabase.LoadAssetAtPath<Sprite>(unityAssetPath);
                        if (sprite != null)
                        {
                            uiImage.sprite = sprite;
                            uiImage.preserveAspect = false;
                        }
                        else
                        {
                            Debug.LogWarning($"[Arsist] Sprite not found for Image: {unityAssetPath}");
                        }
                    }
                    break;
            }

            var bind = elementData["bind"] as JObject;
            var bindKey = bind?["key"]?.ToString();
            var bindFormat = bind?["format"]?.ToString();
            if (!string.IsNullOrEmpty(bindKey))
            {
                var bindingComp = TryAddComponentByTypeName(go, "Arsist.Runtime.UI.ArsistUIBinding");
                if (bindingComp != null)
                {
                    var t = bindingComp.GetType();
                    var keyField = t.GetField("key");
                    if (keyField != null) keyField.SetValue(bindingComp, bindKey);
                    var formatField = t.GetField("format");
                    if (formatField != null) formatField.SetValue(bindingComp, bindFormat);
                }
            }

            // Layout Group 設定
            var layout = elementData["layout"]?.ToString();
            if (layout == "FlexColumn")
            {
                var vlg = go.AddComponent<UnityEngine.UI.VerticalLayoutGroup>();
                vlg.childAlignment = TextAnchor.UpperCenter;
                vlg.spacing = style?["gap"]?.Value<float>() ?? 0;
                if (style?["padding"] is JObject vPadding)
                {
                    vlg.padding = ParseRectOffset(vPadding);
                }
                vlg.childControlWidth = false;
                vlg.childControlHeight = false;
                vlg.childForceExpandWidth = false;
                vlg.childForceExpandHeight = false;
            }
            else if (layout == "FlexRow")
            {
                var hlg = go.AddComponent<UnityEngine.UI.HorizontalLayoutGroup>();
                hlg.childAlignment = TextAnchor.MiddleCenter;
                hlg.spacing = style?["gap"]?.Value<float>() ?? 0;
                if (style?["padding"] is JObject hPadding)
                {
                    hlg.padding = ParseRectOffset(hPadding);
                }
                hlg.childControlWidth = false;
                hlg.childControlHeight = false;
                hlg.childForceExpandWidth = false;
                hlg.childForceExpandHeight = false;
            }

            if (style != null)
            {
                var layoutElement = go.GetComponent<UnityEngine.UI.LayoutElement>();
                if (layoutElement == null)
                {
                    layoutElement = go.AddComponent<UnityEngine.UI.LayoutElement>();
                }

                if (TryParseNumeric(style["minWidth"], out var minWidth)) layoutElement.minWidth = minWidth;
                if (TryParseNumeric(style["minHeight"], out var minHeight)) layoutElement.minHeight = minHeight;

                if (TryParseNumeric(style["width"], out var preferredWidth)) layoutElement.preferredWidth = preferredWidth;
                if (TryParseNumeric(style["height"], out var preferredHeight)) layoutElement.preferredHeight = preferredHeight;

                if (IsAutoValue(style["width"])) layoutElement.preferredWidth = -1;
                if (IsAutoValue(style["height"])) layoutElement.preferredHeight = -1;

                var isAbsolute = string.Equals(style["position"]?.ToString(), "absolute", StringComparison.OrdinalIgnoreCase);
                if (isAbsolute)
                {
                    layoutElement.ignoreLayout = true;
                }
            }

            var children = elementData["children"] as JArray;
            if (children != null)
            {
                foreach (JObject child in children)
                {
                    CreateUIElement(child, go.transform);
                }
            }
        }

        private static void ApplyRectTransformStyle(RectTransform rectTransform, JObject style)
        {
            if (style == null)
            {
                rectTransform.anchorMin = new Vector2(0f, 1f);
                rectTransform.anchorMax = new Vector2(0f, 1f);
                rectTransform.pivot = new Vector2(0f, 1f);
                rectTransform.anchoredPosition = Vector2.zero;
                rectTransform.sizeDelta = new Vector2(200f, 120f);
                return;
            }

            var isAbsolute = string.Equals(style["position"]?.ToString(), "absolute", StringComparison.OrdinalIgnoreCase);

            if (isAbsolute)
            {
                rectTransform.anchorMin = new Vector2(0f, 1f);
                rectTransform.anchorMax = new Vector2(0f, 1f);
                rectTransform.pivot = new Vector2(0f, 1f);

                var left = style["left"]?.Value<float>() ?? 0f;
                var top = style["top"]?.Value<float>() ?? 0f;
                rectTransform.anchoredPosition = new Vector2(left, -top);

                var width = ParseSizeValue(style["width"], 200f);
                var height = ParseSizeValue(style["height"], 120f);
                rectTransform.sizeDelta = new Vector2(width, height);
                return;
            }

            var stretchWidth = IsPercent100(style["width"]);
            var stretchHeight = IsPercent100(style["height"]);

            if (stretchWidth || stretchHeight)
            {
                rectTransform.anchorMin = new Vector2(stretchWidth ? 0f : 0f, stretchHeight ? 0f : 1f);
                rectTransform.anchorMax = new Vector2(stretchWidth ? 1f : 0f, stretchHeight ? 1f : 1f);
                rectTransform.pivot = new Vector2(0f, 1f);
                rectTransform.offsetMin = Vector2.zero;
                rectTransform.offsetMax = Vector2.zero;

                if (!stretchWidth || !stretchHeight)
                {
                    var width = stretchWidth ? 0f : ParseSizeValue(style["width"], 200f);
                    var height = stretchHeight ? 0f : ParseSizeValue(style["height"], 120f);
                    rectTransform.sizeDelta = new Vector2(width, height);
                }

                return;
            }

            rectTransform.anchorMin = new Vector2(0f, 1f);
            rectTransform.anchorMax = new Vector2(0f, 1f);
            rectTransform.pivot = new Vector2(0f, 1f);
            rectTransform.anchoredPosition = Vector2.zero;
            rectTransform.sizeDelta = new Vector2(
                ParseSizeValue(style["width"], 200f),
                ParseSizeValue(style["height"], 120f)
            );
        }

        private static float ParseSizeValue(JToken token, float fallback)
        {
            if (token == null) return fallback;

            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float)
            {
                return token.Value<float>();
            }

            var raw = token.ToString().Trim();
            if (string.IsNullOrEmpty(raw)) return fallback;
            if (string.Equals(raw, "auto", StringComparison.OrdinalIgnoreCase)) return fallback;
            if (raw.EndsWith("%"))
            {
                if (float.TryParse(raw.TrimEnd('%'), out var percent))
                {
                    return Mathf.Clamp01(percent / 100f) * fallback;
                }
            }

            if (float.TryParse(raw, out var parsed))
            {
                return parsed;
            }

            return fallback;
        }

        private static bool TryParseNumeric(JToken token, out float value)
        {
            value = 0f;
            if (token == null) return false;

            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float)
            {
                value = token.Value<float>();
                return true;
            }

            var raw = token.ToString().Trim();
            if (string.IsNullOrEmpty(raw)) return false;
            if (raw.EndsWith("%", StringComparison.Ordinal)) return false;
            if (string.Equals(raw, "auto", StringComparison.OrdinalIgnoreCase)) return false;

            return float.TryParse(raw, out value);
        }

        private static bool IsAutoValue(JToken token)
        {
            if (token == null) return false;
            var raw = token.ToString().Trim();
            return string.Equals(raw, "auto", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsPercent100(JToken token)
        {
            if (token == null) return false;
            var raw = token.ToString().Trim();
            return string.Equals(raw, "100%", StringComparison.OrdinalIgnoreCase);
        }

        private static RectOffset ParseRectOffset(JObject spacing)
        {
            if (spacing == null) return new RectOffset();
            return new RectOffset(
                spacing["left"]?.Value<int>() ?? 0,
                spacing["right"]?.Value<int>() ?? 0,
                spacing["top"]?.Value<int>() ?? 0,
                spacing["bottom"]?.Value<int>() ?? 0
            );
        }

        private static bool TryParseColor(JToken token, out Color color)
        {
            color = Color.white;
            if (token == null) return false;

            var raw = token.ToString().Trim();
            if (string.IsNullOrEmpty(raw)) return false;

            if (ColorUtility.TryParseHtmlString(raw, out color))
            {
                return true;
            }

            if (raw.StartsWith("rgba", StringComparison.OrdinalIgnoreCase) || raw.StartsWith("rgb", StringComparison.OrdinalIgnoreCase))
            {
                var start = raw.IndexOf('(');
                var end = raw.IndexOf(')');
                if (start >= 0 && end > start)
                {
                    var values = raw.Substring(start + 1, end - start - 1).Split(',');
                    if (values.Length >= 3)
                    {
                        if (float.TryParse(values[0], out var r) &&
                            float.TryParse(values[1], out var g) &&
                            float.TryParse(values[2], out var b))
                        {
                            var a = 1f;
                            if (values.Length >= 4)
                            {
                                float.TryParse(values[3], out a);
                            }

                            color = new Color(
                                Mathf.Clamp01(r / 255f),
                                Mathf.Clamp01(g / 255f),
                                Mathf.Clamp01(b / 255f),
                                Mathf.Clamp01(a)
                            );
                            return true;
                        }
                    }
                }
            }

            return false;
        }

        private static void EnsureTextureIsSprite(string unityAssetPath)
        {
            var importer = AssetImporter.GetAtPath(unityAssetPath) as TextureImporter;
            if (importer == null) return;
            if (importer.textureType != TextureImporterType.Sprite)
            {
                importer.textureType = TextureImporterType.Sprite;
                importer.spriteImportMode = SpriteImportMode.Single;
                importer.mipmapEnabled = false;
                importer.SaveAndReimport();
            }
        }

        private static void ApplyBuildSettings(JObject manifest)
        {
            var build = manifest["build"] as JObject;
            if (build == null) return;

            var normalizedTarget = (_targetDevice ?? "").ToLowerInvariant();
            var isXreal = normalizedTarget.Contains("xreal");
            var isQuest = normalizedTarget.Contains("quest") || normalizedTarget.Contains("meta");

            // Android 設定
            PlayerSettings.productName = manifest["projectName"]?.ToString() ?? "ArsistApp";
            PlayerSettings.SetApplicationIdentifier(BuildTargetGroup.Android, 
                build["packageName"]?.ToString() ?? "com.arsist.app");
            PlayerSettings.bundleVersion = build["version"]?.ToString() ?? "1.0.0";
            PlayerSettings.Android.bundleVersionCode = build["versionCode"]?.Value<int>() ?? 1;
            
            PlayerSettings.Android.minSdkVersion = (AndroidSdkVersions)(build["minSdkVersion"]?.Value<int>() ?? 29);
            PlayerSettings.Android.targetSdkVersion = (AndroidSdkVersions)(build["targetSdkVersion"]?.Value<int>() ?? 34);

            // Quest SDKサンプル準拠: minSdkVersion>=32
            if (isQuest && (int)PlayerSettings.Android.minSdkVersion < 32)
            {
                PlayerSettings.Android.minSdkVersion = (AndroidSdkVersions)32;
            }
            if (isQuest && (int)PlayerSettings.Android.targetSdkVersion < 32)
            {
                PlayerSettings.Android.targetSdkVersion = (AndroidSdkVersions)32;
            }
            
            PlayerSettings.SetScriptingBackend(BuildTargetGroup.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;

            // Quest(OpenXR + Oculus Utilities) は Linear color space が必須
            if (isQuest)
            {
                PlayerSettings.colorSpace = ColorSpace.Linear;
                EnsureQuestXRLoaderConfigured();
            }

            ApplyDeviceScriptingDefines(BuildTargetGroup.Android, isXreal, isQuest);

            Debug.Log("[Arsist] Build settings applied");
        }

        private static void ApplyDeviceScriptingDefines(BuildTargetGroup group, bool isXreal, bool isQuest)
        {
            var current = PlayerSettings.GetScriptingDefineSymbolsForGroup(group);
            var defines = new HashSet<string>(
                (current ?? "")
                    .Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries)
                    .Select(d => d.Trim())
                    .Where(d => !string.IsNullOrWhiteSpace(d))
            );

            defines.Remove("ARSIST_XREAL");
            defines.Remove("ARSIST_META_QUEST");

            if (isXreal) defines.Add("ARSIST_XREAL");
            if (isQuest) defines.Add("ARSIST_META_QUEST");

            var joined = string.Join(";", defines.OrderBy(x => x));
            PlayerSettings.SetScriptingDefineSymbolsForGroup(group, joined);
            Debug.Log($"[Arsist] Scripting Defines ({group}): {joined}");
        }

        private static void ApplyDevicePatches(string targetDevice)
        {
            try
            {
                var normalized = (targetDevice ?? "").ToLowerInvariant();
                if (normalized.Contains("xreal"))
                {
                    // Adapters/XREAL_One/XrealBuildPatcher.cs がUnityプロジェクト側にコピーされている前提
                    InvokeStaticIfExists(
                        "Arsist.Adapters.XrealOne.XrealBuildPatcher",
                        "ApplyAllPatches"
                    );
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to apply device patches: {e.Message}");
            }
        }

        private static void ValidateBuildReadiness(string targetDevice)
        {
            var problems = new List<string>();

            var normalized = (targetDevice ?? "").ToLowerInvariant();
            var isXreal = normalized.Contains("xreal");
            var isQuest = normalized.Contains("quest") || normalized.Contains("meta");

            // ==== Android 基本要件（XrealOneガイド準拠）====
            if (EditorUserBuildSettings.activeBuildTarget != _buildTarget)
            {
                problems.Add($"BuildTarget mismatch (expected: {_buildTarget}, actual: {EditorUserBuildSettings.activeBuildTarget})");
            }

            // 現状のヘッドレスビルドは Android を主対象
            if (_buildTarget == BuildTarget.Android && PlayerSettings.GetScriptingBackend(BuildTargetGroup.Android) != ScriptingImplementation.IL2CPP)
            {
                problems.Add("Scripting Backend is not IL2CPP");
            }

            if (_buildTarget == BuildTarget.Android && (PlayerSettings.Android.targetArchitectures & AndroidArchitecture.ARM64) == 0)
            {
                problems.Add("Target Architectures does not include ARM64");
            }

            if (_buildTarget == BuildTarget.Android && (int)PlayerSettings.Android.minSdkVersion < 29)
            {
                problems.Add($"minSdkVersion is too low: {(int)PlayerSettings.Android.minSdkVersion} (need >=29)");
            }

            if (isQuest && _buildTarget == BuildTarget.Android && (int)PlayerSettings.Android.minSdkVersion < 32)
            {
                problems.Add($"Quest requires minSdkVersion >= 32 (actual: {(int)PlayerSettings.Android.minSdkVersion})");
            }

            if (isQuest && PlayerSettings.colorSpace != ColorSpace.Linear)
            {
                problems.Add($"Quest requires Linear color space (actual: {PlayerSettings.colorSpace})");
            }

            if (isQuest)
            {
                try
                {
                    ValidateQuestPackageDependencies(ref problems);
                }
                catch (Exception e)
                {
                    problems.Add($"Failed to validate Quest package dependencies: {e.Message}");
                }

                try
                {
                    var generalSettings = GetXRGeneralSettingsForBuildTarget(BuildTargetGroup.Android);
                    if (generalSettings == null)
                    {
                        Debug.LogWarning("[Arsist] Quest XR General Settings (Android) not found. Continuing build without hard-fail.");
                    }
                    else
                    {
                        if (!generalSettings.InitManagerOnStart)
                        {
                            Debug.LogWarning("[Arsist] Quest 'Initialize XR on Startup' is disabled. Continuing build without hard-fail.");
                        }

                        var manager = generalSettings.Manager;
                        if (manager == null)
                        {
                            Debug.LogWarning("[Arsist] Quest XR Manager Settings is null. Continuing build without hard-fail.");
                        }
                        else
                        {
                            var hasQuestLoader = manager.activeLoaders.Any(loader => loader != null && (
                                loader.GetType().FullName == "UnityEngine.XR.OpenXR.OpenXRLoader" ||
                                loader.GetType().FullName == "Unity.XR.Oculus.OculusLoader"
                            ));

                            if (!hasQuestLoader)
                            {
                                Debug.LogWarning("[Arsist] Quest XR loader (OpenXRLoader/OculusLoader) not active. Continuing build without hard-fail.");
                            }
                        }
                    }
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[Arsist] Quest XR validation warning (ignored): {e.Message}");
                }
            }

            // Graphics API（XrealOne: Vulkan削除 & OpenGLES3のみ）
            if (isXreal)
            {
                try
                {
                    if (_buildTarget == BuildTarget.Android && PlayerSettings.GetUseDefaultGraphicsAPIs(BuildTarget.Android))
                    {
                        problems.Add("Auto Graphics API is enabled (must be disabled)");
                    }

                    var apis = _buildTarget == BuildTarget.Android ? PlayerSettings.GetGraphicsAPIs(BuildTarget.Android) : null;
                    if (apis == null || apis.Length == 0)
                    {
                        problems.Add("Graphics APIs list is empty");
                    }
                    else
                    {
                        if (apis[0] != GraphicsDeviceType.OpenGLES3)
                        {
                            problems.Add($"Graphics API[0] is not OpenGLES3 (actual: {apis[0]})");
                        }

                        foreach (var api in apis)
                        {
                            if (api == GraphicsDeviceType.Vulkan)
                            {
                                problems.Add("Vulkan is present in Graphics APIs (must be removed for XREAL transparency stability)");
                                break;
                            }
                        }
                    }
                }
                catch (Exception e)
                {
                    problems.Add($"Failed to validate Graphics APIs: {e.Message}");
                }
            }

            // Input System（XREAL SDK 3.x は Input System 対応）
            try
            {
                var psType = typeof(PlayerSettings);
                var prop = psType.GetProperty("activeInputHandling", BindingFlags.Public | BindingFlags.Static);
                if (prop != null)
                {
                    var value = prop.GetValue(null);
                    var str = value?.ToString() ?? "";
                    // 代表的な値: Both / InputSystemPackage / OldInputManager
                    if (!(str.IndexOf("Both", StringComparison.OrdinalIgnoreCase) >= 0 ||
                          str.IndexOf("InputSystem", StringComparison.OrdinalIgnoreCase) >= 0))
                    {
                        problems.Add($"Input handling is not using Input System (actual: {str}). Set to 'Both' or 'Input System Package'.");
                    }
                }
            }
            catch (Exception e)
            {
                problems.Add($"Failed to validate Input System setting: {e.Message}");
            }

            // ==== XR Plug-in Management（XREAL Loader が有効になっていること）====
            if (isXreal && _buildTarget == BuildTarget.Android)
            {
                try
                {
                    var generalSettings = GetXRGeneralSettingsForBuildTarget(BuildTargetGroup.Android);
                    if (generalSettings == null)
                    {
                        problems.Add("XR General Settings (Android) is missing");
                    }
                    else
                    {
                        if (!generalSettings.InitManagerOnStart)
                        {
                            problems.Add("Initialize XR on Startup is not enabled");
                        }

                        var manager = generalSettings.Manager;
                        if (manager == null)
                        {
                            problems.Add("XR Manager Settings is missing");
                        }
                        else
                        {
                            var hasXrealLoader = false;
                            foreach (var loader in manager.activeLoaders)
                            {
                                if (loader == null) continue;
                                if (loader.GetType().FullName == "Unity.XR.XREAL.XREALXRLoader")
                                {
                                    hasXrealLoader = true;
                                    break;
                                }
                            }

                            if (!hasXrealLoader)
                            {
                                problems.Add("XREAL XR Loader is not enabled in XR Plug-in Management (Android)");
                            }
                        }
                    }
                }
                catch (Exception e)
                {
                    problems.Add($"Failed to validate XR settings: {e.Message}");
                }
            }

            // ==== XREAL Settings（XREAL SDK 3.x が内部参照するため必須）====
            if (isXreal)
            {
                try
                {
                    if (!TryHasXrealSettingsConfigObject(out var key, out var existing))
                    {
                        problems.Add($"XREALSettings config object is missing (key: {key}). Ensure XREALSettings is registered in EditorBuildSettings.");
                    }
                }
                catch (Exception e)
                {
                    problems.Add($"Failed to validate XREALSettings config: {e.Message}");
                }
            }

            // ==== カメラ透過要件（XrealOne: 黒=透明 / ARCameraBackground除去）====
            if (isXreal)
            {
                try
                {
                    ValidateTransparentCameraScenes(ref problems);
                }
                catch (Exception e)
                {
                    problems.Add($"Failed to validate transparent camera settings: {e.Message}");
                }
            }

            // ==== Arsist固有: HTMLコンテンツの検証 ====
            try
            {
                var uiCodeDir = Path.Combine(Application.dataPath, "ArsistGenerated", "UICode");
                var hasHtmlFile = File.Exists(Path.Combine(uiCodeDir, "index.html"));
                
                if (hasHtmlFile)
                {
                    // StreamingAssetsにコピーされているか確認
                    var streamingHtml = Path.Combine(Application.streamingAssetsPath, "ArsistUI", "index.html");
                    if (!File.Exists(streamingHtml))
                    {
                        problems.Add("HTML file exists in ArsistGenerated/UICode but not copied to StreamingAssets/ArsistUI. WebView UI will not work.");
                    }
                    else
                    {
                        // HTMLの内容を簡易検証
                        var htmlContent = File.ReadAllText(streamingHtml);
                        if (string.IsNullOrWhiteSpace(htmlContent))
                        {
                            problems.Add("HTML file is empty");
                        }
                        else if (htmlContent.Length < 50)
                        {
                            problems.Add($"HTML file is suspiciously small ({htmlContent.Length} bytes)");
                        }

                        Debug.Log($"[Arsist] ✅ HTML validation passed (size: {htmlContent.Length} bytes)");
                    }

                    // WebViewUIコンポーネントがシーンに存在するか確認
                    var buildScenes = EditorBuildSettings.scenes;
                    var foundWebViewUI = false;
                    
                    if (buildScenes != null && buildScenes.Length > 0)
                    {
                        foreach (var sceneSetting in buildScenes)
                        {
                            if (!sceneSetting.enabled) continue;
                            
                            var scene = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(sceneSetting.path, UnityEditor.SceneManagement.OpenSceneMode.Single);
#if UNITY_2023_1_OR_NEWER
                            var webViewUIs = UnityEngine.Object.FindObjectsByType<Arsist.Runtime.UI.ArsistWebViewUI>(FindObjectsSortMode.None);
#else
                            var webViewUIs = UnityEngine.Object.FindObjectsOfType<Arsist.Runtime.UI.ArsistWebViewUI>();
#endif
                            if (webViewUIs != null && webViewUIs.Length > 0)
                            {
                                foundWebViewUI = true;
                                Debug.Log($"[Arsist] ✅ ArsistWebViewUI found in scene: {sceneSetting.path}");
                                break;
                            }
                        }
                    }

                    if (!foundWebViewUI)
                    {
                        problems.Add("HTML content exists but ArsistWebViewUI component not found in any scene. HTML will not be displayed.");
                    }
                }
            }
            catch (Exception e)
            {
                problems.Add($"Failed to validate HTML content: {e.Message}");
            }

            // ==== Arsist固有: GLBモデルのインポート検証 ====
            try
            {
                var scenesPath = Path.Combine(Application.dataPath, "ArsistGenerated", "scenes.json");
                if (File.Exists(scenesPath))
                {
                    var scenesJson = File.ReadAllText(scenesPath);
                    var scenes = JArray.Parse(scenesJson);
                    
                    foreach (JObject scene in scenes)
                    {
                        var objects = scene["objects"] as JArray;
                        if (objects != null)
                        {
                            foreach (JObject obj in objects)
                            {
                                var type = obj["type"]?.ToString();
                                var modelPath = obj["modelPath"]?.ToString();
                                
                                if (type == "model" && !string.IsNullOrEmpty(modelPath))
                                {
                                    // モデルがAssets/Models/にインポートされているか確認
                                    var fileName = Path.GetFileName(modelPath);
                                    var importedPath = $"Assets/Models/{fileName}";
                                    var fullPath = Path.Combine(Application.dataPath, "..", importedPath);
                                    
                                    if (!File.Exists(fullPath))
                                    {
                                        problems.Add($"Model file not found: {modelPath} (expected at: {importedPath})");
                                    }
                                    else
                                    {
                                        Debug.Log($"[Arsist] ✅ Model file validated: {importedPath}");
                                    }
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception e)
            {
                problems.Add($"Failed to validate GLB models: {e.Message}");
            }

            if (problems.Count > 0)
            {
                var message = "Build validation failed:\n- " + string.Join("\n- ", problems);
                throw new Exception(message);
            }
        }

        private static void ValidateQuestPackageDependencies(ref List<string> problems)
        {
            var manifestPath = Path.Combine(Application.dataPath, "..", "Packages", "manifest.json");
            if (!File.Exists(manifestPath))
            {
                problems.Add($"Quest dependency validation failed: manifest.json not found ({manifestPath})");
                return;
            }

            JObject manifest;
            try
            {
                manifest = JObject.Parse(File.ReadAllText(manifestPath));
            }
            catch (Exception e)
            {
                problems.Add($"Quest dependency validation failed: cannot parse manifest.json ({e.Message})");
                return;
            }

            var deps = manifest["dependencies"] as JObject;
            if (deps == null)
            {
                problems.Add("Quest dependency validation failed: dependencies section is missing in manifest.json");
                return;
            }

            var required = new[]
            {
                "com.meta.xr.sdk.core",
                "com.unity.modules.physics2d",
            };

            foreach (var pkg in required)
            {
                if (deps[pkg] == null)
                {
                    problems.Add($"Quest required package is missing: {pkg}");
                }
            }
        }

        private static XRGeneralSettings GetXRGeneralSettingsForBuildTarget(BuildTargetGroup target)
        {
            try
            {
                var t = typeof(XRGeneralSettingsPerBuildTarget);

                // 1) static XRGeneralSettingsForBuildTarget(BuildTargetGroup)
                var miStatic = t.GetMethod(
                    "XRGeneralSettingsForBuildTarget",
                    BindingFlags.Public | BindingFlags.Static,
                    null,
                    new[] { typeof(BuildTargetGroup) },
                    null
                );
                if (miStatic != null)
                {
                    return miStatic.Invoke(null, new object[] { target }) as XRGeneralSettings;
                }

                // 2) instance: XRGeneralSettingsPerBuildTarget.Instance.XRGeneralSettingsForBuildTarget(BuildTargetGroup)
                var piInstance = t.GetProperty("Instance", BindingFlags.Public | BindingFlags.Static);
                var inst = piInstance != null ? piInstance.GetValue(null, null) : null;
                if (inst != null)
                {
                    var mi = t.GetMethod(
                        "XRGeneralSettingsForBuildTarget",
                        BindingFlags.Public | BindingFlags.Instance,
                        null,
                        new[] { typeof(BuildTargetGroup) },
                        null
                    );
                    if (mi != null)
                    {
                        return mi.Invoke(inst, new object[] { target }) as XRGeneralSettings;
                    }
                }
            }
            catch { }

            return null;
        }

        private static void EnsureQuestXRLoaderConfigured()
        {
            if (_buildTarget != BuildTarget.Android) return;

            var generalSettings = GetXRGeneralSettingsForBuildTarget(BuildTargetGroup.Android);
            if (generalSettings == null)
            {
                Debug.LogWarning("[Arsist] Quest XR setup skipped: XR General Settings (Android) not found");
                return;
            }

            generalSettings.InitManagerOnStart = true;
            EditorUtility.SetDirty(generalSettings);

            var manager = generalSettings.Manager;
            if (manager == null)
            {
                Debug.LogWarning("[Arsist] Quest XR setup skipped: XR Manager Settings is null");
                return;
            }

            var hasQuestLoader = manager.activeLoaders.Any(loader => loader != null && (
                loader.GetType().FullName == "UnityEngine.XR.OpenXR.OpenXRLoader" ||
                loader.GetType().FullName == "Unity.XR.Oculus.OculusLoader"
            ));

            if (hasQuestLoader)
            {
                return;
            }

            var added =
                TryAddXRLoaderByType(manager, "UnityEngine.XR.OpenXR.OpenXRLoader") ||
                TryAddXRLoaderByType(manager, "Unity.XR.Oculus.OculusLoader");

            if (added)
            {
                EditorUtility.SetDirty(manager);
                AssetDatabase.SaveAssets();
                Debug.Log("[Arsist] Quest XR loader configured");
            }
            else
            {
                Debug.LogWarning("[Arsist] Quest XR loader could not be configured automatically");
            }
        }

        private static bool TryAddXRLoaderByType(XRManagerSettings manager, string loaderTypeName)
        {
            try
            {
                var loaderType = FindTypeInLoadedAssemblies(loaderTypeName);
                if (loaderType == null) return false;

                if (manager.activeLoaders.Any(loader => loader != null && loaderType.IsAssignableFrom(loader.GetType())))
                {
                    return true;
                }

                var managerType = manager.GetType();
                var tryAddWithIndex = managerType.GetMethod(
                    "TryAddLoader",
                    BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance,
                    null,
                    new[] { typeof(Type), typeof(int) },
                    null
                );

                if (tryAddWithIndex != null)
                {
                    var index = manager.activeLoaders?.Count ?? 0;
                    var result = tryAddWithIndex.Invoke(manager, new object[] { loaderType, index });
                    if (result is bool ok && ok) return true;
                }

                var tryAdd = managerType.GetMethod(
                    "TryAddLoader",
                    BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance,
                    null,
                    new[] { typeof(Type) },
                    null
                );
                if (tryAdd != null)
                {
                    var result = tryAdd.Invoke(manager, new object[] { loaderType });
                    if (result is bool ok && ok) return true;
                }

                var metadataStoreType = FindTypeInLoadedAssemblies("UnityEditor.XR.Management.XRPackageMetadataStore");
                var assignLoader = metadataStoreType?.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)
                    .FirstOrDefault(mi =>
                    {
                        if (mi.Name != "AssignLoader") return false;
                        var p = mi.GetParameters();
                        return p.Length == 3 &&
                               p[0].ParameterType == typeof(XRManagerSettings) &&
                               p[1].ParameterType == typeof(string) &&
                               p[2].ParameterType == typeof(BuildTargetGroup);
                    });

                if (assignLoader != null)
                {
                    var result = assignLoader.Invoke(null, new object[] { manager, loaderType.FullName, BuildTargetGroup.Android });
                    if (result is bool ok && ok) return true;

                    result = assignLoader.Invoke(null, new object[] { manager, loaderType.Name, BuildTargetGroup.Android });
                    if (result is bool ok2 && ok2) return true;
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to add XR loader ({loaderTypeName}): {e.Message}");
            }

            return false;
        }

        private static bool TryHasXrealSettingsConfigObject(out string key, out UnityEngine.Object existing)
        {
            existing = null;
            key = "com.unity.xr.management.xrealsettings";

            // SDK側の定数が取れるなら優先
            var xrealSettingsType = FindTypeInLoadedAssemblies("Unity.XR.XREAL.XREALSettings");
            if (xrealSettingsType != null)
            {
                var fiKey = xrealSettingsType.GetField("k_SettingsKey", BindingFlags.Public | BindingFlags.Static);
                if (fiKey != null && fiKey.FieldType == typeof(string))
                {
                    var v = fiKey.GetValue(null) as string;
                    if (!string.IsNullOrWhiteSpace(v))
                    {
                        key = v;
                    }
                }
            }

            if (EditorBuildSettings.TryGetConfigObject(key, out existing) && existing != null)
            {
                return true;
            }
            return false;
        }


        private static void ValidateTransparentCameraScenes(ref List<string> problems)
        {
            // Build対象シーン（未設定なら Assets 配下の Scene を対象）
            var scenePaths = EditorBuildSettings.scenes
                .Where(s => s != null && s.enabled && !string.IsNullOrWhiteSpace(s.path) && File.Exists(s.path))
                .Select(s => s.path)
                .Distinct()
                .ToList();

            if (scenePaths.Count == 0)
            {
                var guids = AssetDatabase.FindAssets("t:Scene", new[] { "Assets" });
                foreach (var guid in guids)
                {
                    var p = AssetDatabase.GUIDToAssetPath(guid);
                    if (!string.IsNullOrWhiteSpace(p) && p.EndsWith(".unity", StringComparison.OrdinalIgnoreCase) && File.Exists(p))
                    {
                        scenePaths.Add(p);
                    }
                }
                scenePaths = scenePaths.Distinct().ToList();
            }

            if (scenePaths.Count == 0)
            {
                problems.Add("No scenes found. XrealOne requires a scene containing a MainCamera configured for transparency.");
                return;
            }

            var arCameraBackgroundType = FindTypeInLoadedAssemblies("UnityEngine.XR.ARFoundation.ARCameraBackground");
            var desiredBg = new Color(0f, 0f, 0f, 0f);
            var foundCamera = false;

            foreach (var scenePath in scenePaths)
            {
                var scene = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(scenePath, UnityEditor.SceneManagement.OpenSceneMode.Single);

                Camera targetCamera = null;
#if UNITY_2023_1_OR_NEWER
                var cameras = UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None);
#else
                var cameras = UnityEngine.Object.FindObjectsOfType<Camera>();
#endif

                targetCamera = cameras.FirstOrDefault(c => c != null && c.gameObject != null && SafeCompareTag(c.gameObject, "MainCamera"));
                if (targetCamera == null)
                {
                    targetCamera = cameras.FirstOrDefault(c => c != null && c.gameObject != null && string.Equals(c.gameObject.name, "Main Camera", StringComparison.Ordinal));
                }

                if (targetCamera == null)
                {
                    continue;
                }

                foundCamera = true;

                if (targetCamera.clearFlags != CameraClearFlags.SolidColor)
                {
                    problems.Add($"{scenePath}: MainCamera clearFlags is not SolidColor");
                }

                if (targetCamera.backgroundColor != desiredBg)
                {
                    problems.Add($"{scenePath}: MainCamera backgroundColor is not (0,0,0,0)");
                }

                if (arCameraBackgroundType != null)
                {
                    var comps = targetCamera.GetComponents(arCameraBackgroundType);
                    if (comps != null && comps.Length > 0)
                    {
                        problems.Add($"{scenePath}: ARCameraBackground is attached to MainCamera (must be removed for XREAL transparency)");
                    }
                }
            }

            if (!foundCamera)
            {
                problems.Add("No Camera found in scenes. XrealOne requires a MainCamera.");
            }
        }

        private static bool SafeCompareTag(GameObject go, string tag)
        {
            try
            {
                return go != null && go.CompareTag(tag);
            }
            catch
            {
                return false;
            }
        }

        private static void InvokeStaticIfExists(string typeName, string methodName)
        {
            var t = FindTypeInLoadedAssemblies(typeName);
            if (t == null)
            {
                Debug.LogWarning($"[Arsist] Type not found: {typeName}");
                return;
            }

            var mi = t.GetMethod(methodName, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
            if (mi == null)
            {
                Debug.LogWarning($"[Arsist] Method not found: {typeName}.{methodName}");
                return;
            }

            mi.Invoke(null, null);
        }

        private static Type FindTypeInLoadedAssemblies(string fullName)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    var t = asm.GetType(fullName, throwOnError: false);
                    if (t != null) return t;
                }
                catch { }
            }
            return null;
        }

        private static void ExecuteBuild(JObject manifest)
        {
            var scenes = new List<string>();
            
            // ビルド対象シーンを収集
            foreach (var guid in AssetDatabase.FindAssets("t:Scene", new[] { "Assets/Scenes" }))
            {
                scenes.Add(AssetDatabase.GUIDToAssetPath(guid));
            }

            if (scenes.Count == 0)
            {
                throw new Exception("No scenes found to build");
            }

            var buildOptions = BuildOptions.None;
            var normalizedTarget = (_targetDevice ?? "").ToLowerInvariant();
            var isQuest = normalizedTarget.Contains("quest") || normalizedTarget.Contains("meta");
            if (_developmentBuild)
            {
                buildOptions |= BuildOptions.Development;
                if (!isQuest)
                {
                    buildOptions |= BuildOptions.AllowDebugging;
                }
            }

            var outputFile = Path.Combine(_outputPath, $"{manifest["projectName"]}.apk");
            
            var buildPlayerOptions = new BuildPlayerOptions
            {
                scenes = scenes.ToArray(),
                locationPathName = outputFile,
                target = _buildTarget,
                options = buildOptions
            };

            var report = BuildPipeline.BuildPlayer(buildPlayerOptions);

            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new Exception($"Build failed: {report.summary.totalErrors} errors");
            }

            Debug.Log($"[Arsist] APK created: {outputFile}");
            Debug.Log($"[Arsist] Build size: {report.summary.totalSize / (1024 * 1024):F2} MB");
        }

        private static void EnsureOpenXRSettingsLoaded()
        {
            try
            {
                // OpenXR は環境/アダプターによっては入っていない可能性があるため、reflectionでbest-effort
                var openXrSettingsType = FindTypeInLoadedAssemblies("UnityEngine.XR.OpenXR.OpenXRSettings");
                if (openXrSettingsType == null)
                {
                    Debug.Log("[Arsist] OpenXRSettings type not found (skipping)");
                    return;
                }

                var propActive = openXrSettingsType.GetProperty("ActiveBuildTargetInstance", BindingFlags.Public | BindingFlags.Static);
                var miGet = openXrSettingsType.GetMethod("GetSettingsForBuildTargetGroup", BindingFlags.Public | BindingFlags.Static);

                object active = null;
                if (propActive != null)
                {
                    active = propActive.GetValue(null);
                }
                if (active == null && miGet != null)
                {
                    active = miGet.Invoke(null, new object[] { BuildTargetGroup.Android });
                }

                if (active != null) Debug.Log("[Arsist] OpenXRSettings loaded");
                else Debug.LogWarning("[Arsist] OpenXRSettings not available yet");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to load OpenXRSettings: {e.Message}");
            }
        }

        private static void EnsureOpenXRPackageSettingsLoaded()
        {
            try
            {
                // OpenXRPackageSettings は internal なので reflection で呼び出す
                Type t = null;
                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    try
                    {
                        t = asm.GetType("UnityEditor.XR.OpenXR.OpenXRPackageSettings");
                        if (t != null) break;
                    }
                    catch { }
                }

                if (t == null)
                {
                    Debug.LogWarning("[Arsist] OpenXRPackageSettings type not found");
                    return;
                }

                var mi = t.GetMethod("GetOrCreateInstance", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                if (mi == null)
                {
                    Debug.LogWarning("[Arsist] OpenXRPackageSettings.GetOrCreateInstance not found");
                    return;
                }

                mi.Invoke(null, null);
                Debug.Log("[Arsist] OpenXRPackageSettings loaded");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to load OpenXRPackageSettings: {e.Message}");
            }
        }
    }
}
