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

        /// <summary>
        /// CLI経由でビルドを実行（Arsistエンジンから呼び出される）
        /// </summary>
        public static void BuildFromCLI()
        {
            Debug.Log("[Arsist] Build pipeline started");

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

        private static void GenerateScenes()
        {
            var scenesPath = Path.Combine(Application.dataPath, "ArsistGenerated", "scenes.json");
            if (!File.Exists(scenesPath)) return;

            var scenesJson = File.ReadAllText(scenesPath);
            var scenes = JArray.Parse(scenesJson);

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

                // オブジェクトを生成
                var objects = scene["objects"] as JArray;
                if (objects != null)
                {
                    foreach (JObject obj in objects)
                    {
                        CreateGameObject(obj);
                    }
                }

                // XR Origin を追加（デバイスに応じたプレハブを使用）
                CreateXROrigin();

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

        private static void CreateGameObject(JObject objData)
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

            // Transform適用
            var transform = objData["transform"] as JObject;
            if (transform != null)
            {
                var pos = transform["position"] as JObject;
                var rot = transform["rotation"] as JObject;
                var scale = transform["scale"] as JObject;

                if (pos != null)
                    go.transform.position = new Vector3(
                        pos["x"]?.Value<float>() ?? 0,
                        pos["y"]?.Value<float>() ?? 0,
                        pos["z"]?.Value<float>() ?? 0
                    );

                if (rot != null)
                    go.transform.eulerAngles = new Vector3(
                        rot["x"]?.Value<float>() ?? 0,
                        rot["y"]?.Value<float>() ?? 0,
                        rot["z"]?.Value<float>() ?? 0
                    );

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
                    return;
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

            // GLB/GLTFはStreamingAssetsへコピーし、ランタイムでglTFast読み込みに切り替える
            var runtimePath = PrepareModelForRuntime(foundAssetPath, modelPath);
            var runtimeGo = new GameObject(name);
            if (!TryConfigureRuntimeModelLoader(runtimeGo, runtimePath))
            {
                Debug.LogWarning($"[Arsist] Runtime model loader not available. Creating placeholder for: {foundAssetPath}");
                runtimeGo.AddComponent<MeshRenderer>();
            }
            else
            {
                Debug.Log($"[Arsist] Model scheduled for runtime load: {runtimePath}");
            }
            return runtimeGo;
        }

        private static string PrepareModelForRuntime(string assetPath, string originalPath)
        {
            if (!string.IsNullOrWhiteSpace(originalPath) &&
                (originalPath.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                 originalPath.StartsWith("https://", StringComparison.OrdinalIgnoreCase)))
            {
                return originalPath;
            }

            var ext = Path.GetExtension(assetPath)?.ToLowerInvariant();
            // .gib はエンジン側のtypo/独自拡張子でGLBを指しているケースがあるためGLB扱いする
            if (ext != ".glb" && ext != ".gltf" && ext != ".gib")
            {
                return assetPath;
            }

            var streamingDir = Path.Combine(Application.dataPath, "StreamingAssets", "ArsistModels");
            Directory.CreateDirectory(streamingDir);

            var srcFull = Path.Combine(Application.dataPath, "..", assetPath);
            var fileName = Path.GetFileName(assetPath);
            // glTFastは拡張子依存の分岐が入るケースがあるため、.gib は .glb に正規化して配置する
            var destFileName = fileName;
            if (string.Equals(ext, ".gib", StringComparison.OrdinalIgnoreCase))
            {
                destFileName = Path.GetFileNameWithoutExtension(fileName) + ".glb";
            }

            var destFull = Path.Combine(streamingDir, destFileName);

            try
            {
                File.Copy(srcFull, destFull, true);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to copy model to StreamingAssets: {e.Message}");
                return assetPath;
            }

            var assetRelative = $"Assets/StreamingAssets/ArsistModels/{destFileName}";
            try
            {
                AssetDatabase.ImportAsset(assetRelative, ImportAssetOptions.ForceUpdate);
                AssetDatabase.Refresh();
            }
            catch { }

            return $"ArsistModels/{destFileName}";
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
            var uiCodeDir = Path.Combine(Application.dataPath, "ArsistGenerated", "UICode");
            var hasUICode = Directory.Exists(uiCodeDir) && File.Exists(Path.Combine(uiCodeDir, "index.html"));

            // UIコード（HTML/CSS/JS）がある場合はWebViewで表示
            if (hasUICode)
            {
                Debug.Log("[Arsist] Creating WebView UI");
                
                // 最初のシーンを開く
                var buildScenes = EditorBuildSettings.scenes;
                if (buildScenes != null && buildScenes.Length > 0)
                {
                    var firstScenePath = buildScenes[0].path;
                    var scene = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(firstScenePath);
                    
                    // WebView UIを追加
                    CreateWebViewUI();
                    
                    // シーンを保存
                    UnityEditor.SceneManagement.EditorSceneManager.SaveScene(scene);
                    Debug.Log($"[Arsist] WebView UI added to scene: {firstScenePath}");
                }
                else
                {
                    Debug.LogWarning("[Arsist] No scenes found in build settings, WebView UI not added");
                }
                return;
            }

            // UIレイアウトがある場合は従来のCanvas UIを生成
            if (!File.Exists(uiPath)) return;

            var uiJson = File.ReadAllText(uiPath);
            var layouts = JArray.Parse(uiJson);

            foreach (JObject layout in layouts)
            {
                var layoutName = layout["name"]?.ToString() ?? "MainUI";
                Debug.Log($"[Arsist] Processing UI layout: {layoutName}");

                // Canvas作成
                var canvasGO = new GameObject($"Canvas_{layoutName}");
                var canvas = canvasGO.AddComponent<Canvas>();
                canvas.renderMode = RenderMode.WorldSpace;
                
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

                var mainCam = Camera.main;
                if (mainCam != null && (trackingMode == "3dof" || presentationMode == "head_locked_hud" || presentationMode == "floating_screen"))
                {
                    // カメラ前方に配置（3DoF必須）
                    rectTransform.position = mainCam.transform.position + mainCam.transform.forward * distance;
                    rectTransform.rotation = Quaternion.LookRotation(rectTransform.position - mainCam.transform.position);
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
            
            var webViewComp = TryAddComponentByTypeName(webViewGO, "Arsist.Runtime.UI.ArsistWebViewUI");
            if (webViewComp != null)
            {
                var t = webViewComp.GetType();
                
                // htmlPathを設定
                var htmlPathField = t.GetField("htmlPath");
                if (htmlPathField != null)
                {
                    htmlPathField.SetValue(webViewComp, "ArsistUI/index.html");
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
                }
                
                // 距離を設定
                var distance = _manifest?["arSettings"]?["floatingScreen"]?["distance"]?.Value<float>() ?? 2f;
                var distanceField = t.GetField("distance");
                if (distanceField != null)
                {
                    distanceField.SetValue(webViewComp, distance);
                }
                
                Debug.Log("[Arsist] WebView UI component added");
            }
            else
            {
                Debug.LogWarning("[Arsist] ArsistWebViewUI component not found");
            }
        }

        private static void CreateUIElement(JObject elementData, Transform parent)
        {
            var type = elementData["type"]?.ToString() ?? "Panel";
            var go = new GameObject(type);
            go.transform.SetParent(parent, false);

            var rectTransform = go.AddComponent<RectTransform>();
            
            // スタイル適用
            var style = elementData["style"] as JObject;
            
            switch (type)
            {
                case "Panel":
                    var image = go.AddComponent<UnityEngine.UI.Image>();
                    if (style != null)
                    {
                        var bgColor = style["backgroundColor"]?.ToString();
                        if (!string.IsNullOrEmpty(bgColor) && ColorUtility.TryParseHtmlString(bgColor, out Color color))
                        {
                            image.color = color;
                        }
                    }
                    break;
                    
                case "Text":
                    var text = go.AddComponent<TMPro.TextMeshProUGUI>();
                    text.text = elementData["content"]?.ToString() ?? "Text";
                    if (style != null)
                    {
                        text.fontSize = style["fontSize"]?.Value<float>() ?? 24;
                        var textColor = style["color"]?.ToString();
                        if (!string.IsNullOrEmpty(textColor) && ColorUtility.TryParseHtmlString(textColor, out Color tColor))
                        {
                            text.color = tColor;
                        }
                    }
                    break;
                    
                case "Button":
                    var buttonImage = go.AddComponent<UnityEngine.UI.Image>();
                    buttonImage.color = new Color(0.91f, 0.27f, 0.38f, 1f); // #E94560
                    var button = go.AddComponent<UnityEngine.UI.Button>();
                    
                    // Gaze対応: Colliderを追加して視線入力を受け付ける
                    go.AddComponent<BoxCollider>();
                    TryAddComponentByTypeName(go, "Arsist.Runtime.Input.ArsistGazeTarget");
                    
                    // Button text
                    var buttonTextGO = new GameObject("Text");
                    buttonTextGO.transform.SetParent(go.transform, false);
                    var buttonText = buttonTextGO.AddComponent<TMPro.TextMeshProUGUI>();
                    buttonText.text = elementData["content"]?.ToString() ?? "Button";
                    buttonText.alignment = TMPro.TextAlignmentOptions.Center;
                    buttonText.fontSize = 16;
                    var buttonTextRect = buttonTextGO.GetComponent<RectTransform>();
                    buttonTextRect.anchorMin = Vector2.zero;
                    buttonTextRect.anchorMax = Vector2.one;
                    buttonTextRect.offsetMin = Vector2.zero;
                    buttonTextRect.offsetMax = Vector2.zero;
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
                            uiImage.preserveAspect = true;
                        }
                        else
                        {
                            Debug.LogWarning($"[Arsist] Sprite not found for Image: {unityAssetPath}");
                        }
                    }
                    break;
            }

            // Layout Group 設定
            var layout = elementData["layout"]?.ToString();
            if (layout == "FlexColumn")
            {
                var vlg = go.AddComponent<UnityEngine.UI.VerticalLayoutGroup>();
                vlg.childAlignment = TextAnchor.UpperCenter;
                vlg.spacing = style?["gap"]?.Value<float>() ?? 0;
            }
            else if (layout == "FlexRow")
            {
                var hlg = go.AddComponent<UnityEngine.UI.HorizontalLayoutGroup>();
                hlg.childAlignment = TextAnchor.MiddleCenter;
                hlg.spacing = style?["gap"]?.Value<float>() ?? 0;
            }

            // 子要素を再帰的に処理
            var children = elementData["children"] as JArray;
            if (children != null)
            {
                foreach (JObject child in children)
                {
                    CreateUIElement(child, go.transform);
                }
            }
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

            // Android 設定
            PlayerSettings.productName = manifest["projectName"]?.ToString() ?? "ArsistApp";
            PlayerSettings.SetApplicationIdentifier(BuildTargetGroup.Android, 
                build["packageName"]?.ToString() ?? "com.arsist.app");
            PlayerSettings.bundleVersion = build["version"]?.ToString() ?? "1.0.0";
            PlayerSettings.Android.bundleVersionCode = build["versionCode"]?.Value<int>() ?? 1;
            
            PlayerSettings.Android.minSdkVersion = (AndroidSdkVersions)(build["minSdkVersion"]?.Value<int>() ?? 29);
            PlayerSettings.Android.targetSdkVersion = (AndroidSdkVersions)(build["targetSdkVersion"]?.Value<int>() ?? 34);
            
            PlayerSettings.SetScriptingBackend(BuildTargetGroup.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;

            Debug.Log("[Arsist] Build settings applied");
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

            if (problems.Count > 0)
            {
                var message = "Build validation failed:\n- " + string.Join("\n- ", problems);
                throw new Exception(message);
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
            if (_developmentBuild)
            {
                buildOptions |= BuildOptions.Development;
                buildOptions |= BuildOptions.AllowDebugging;
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
