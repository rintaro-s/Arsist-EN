// ==============================================
// Arsist Engine - XREAL One Build Patcher
// Adapters/XREAL_One/XrealBuildPatcher.cs
// ==============================================

using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEngine.XR.Management;
using UnityEngine.SceneManagement;
using System.IO;
using System.Xml;
using System.Collections.Generic;
using System;
using System.Linq;

namespace Arsist.Adapters.XrealOne
{
    /// <summary>
    /// XREAL One 用のビルドパッチャー
    /// Arsistビルドパイプラインから呼び出され、デバイス固有の設定を適用
    /// </summary>
    public static class XrealBuildPatcher
    {
        private const string ADAPTER_ID = "xreal-one";
        private const string SDK_VERSION = "3.1.0";

        /// <summary>
        /// 全てのパッチを一括適用
        /// </summary>
        [MenuItem("Arsist/Adapters/XREAL One/Apply All Patches")]
        public static void ApplyAllPatches()
        {
            Debug.Log($"[Arsist-{ADAPTER_ID}] Applying all patches...");
            
            ApplyPlayerSettings();
            ConfigureXRLoader();
            RunXRProjectValidationFixAllBestEffort();
            ConfigureXRInteraction();
            ApplyQualitySettings();
            ApplyTransparentCameraSettingsToBuildScenes();
            
            Debug.Log($"[Arsist-{ADAPTER_ID}] All patches applied successfully");
        }

        /// <summary>
        /// XrealOneガイドの「Project Validation > Fix All」を、バッチモードでも実行できる範囲で自動化する。
        /// Unity/XRパッケージのバージョン差が大きいため、reflectionで存在するAPIを探して呼ぶ。
        /// </summary>
        private static void RunXRProjectValidationFixAllBestEffort()
        {
            try
            {
                // Known candidates (package/version differences)
                var candidateTypeNames = new[]
                {
                    "UnityEditor.XR.Management.XRProjectValidation",
                    "UnityEditor.XR.Management.XRProjectValidationUtility",
                    "UnityEditor.XR.Management.Metadata.XRPackageMetadataStore",
                };

                foreach (var tn in candidateTypeNames)
                {
                    var t = FindTypeInLoadedAssemblies(tn);
                    if (t == null) continue;

                    // Try common method names
                    var mi = t.GetMethod("FixAll", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)
                          ?? t.GetMethod("FixAllIssues", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)
                          ?? t.GetMethod("FixAllValidationIssues", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)
                          ?? t.GetMethod("FixAllProjectValidationIssues", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);

                    if (mi != null && mi.GetParameters().Length == 0)
                    {
                        mi.Invoke(null, null);
                        Debug.Log($"[Arsist-{ADAPTER_ID}] XR Project Validation FixAll invoked via: {tn}.{mi.Name}()");
                        return;
                    }
                }

                // Last resort: scan assemblies for a static parameterless FixAll() method on a type name that contains "ProjectValidation".
                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    Type[] types;
                    try { types = asm.GetTypes(); }
                    catch { continue; }

                    foreach (var t in types)
                    {
                        if (t == null) continue;
                        var name = t.FullName ?? t.Name;
                        if (string.IsNullOrWhiteSpace(name) || name.IndexOf("ProjectValidation", StringComparison.OrdinalIgnoreCase) < 0)
                        {
                            continue;
                        }

                        var mi = t.GetMethod("FixAll", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
                        if (mi != null && mi.GetParameters().Length == 0)
                        {
                            mi.Invoke(null, null);
                            Debug.Log($"[Arsist-{ADAPTER_ID}] XR Project Validation FixAll invoked via scan: {name}.{mi.Name}()");
                            return;
                        }
                    }
                }

                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] XR Project Validation FixAll API not found. Manual settings are applied, but Unity's validation auto-fix could not be invoked programmatically in this editor/version.");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to run XR Project Validation FixAll (best-effort): {e.Message}");
            }
        }

        private static void ApplyTransparentCameraSettingsToBuildScenes()
        {
            try
            {
                var arCameraBackgroundType = FindTypeInLoadedAssemblies("UnityEngine.XR.ARFoundation.ARCameraBackground");
                var buildScenes = EditorBuildSettings.scenes
                    .Where(s => s != null && s.enabled && !string.IsNullOrWhiteSpace(s.path) && File.Exists(s.path))
                    .Select(s => s.path)
                    .Distinct()
                    .ToList();

                if (buildScenes.Count == 0)
                {
                    // Arsist の一時プロジェクトでは Build Settings が未設定のままビルドするケースがあるため、
                    // Assets 配下の Scene を対象にする（最小限のフォールバック）。
                    var guids = AssetDatabase.FindAssets("t:Scene", new[] { "Assets" });
                    foreach (var guid in guids)
                    {
                        var p = AssetDatabase.GUIDToAssetPath(guid);
                        if (!string.IsNullOrWhiteSpace(p) && p.EndsWith(".unity", StringComparison.OrdinalIgnoreCase) && File.Exists(p))
                        {
                            buildScenes.Add(p);
                        }
                    }
                }

                if (buildScenes.Count == 0)
                {
                    throw new Exception("No scenes found to patch. XrealOne requires a scene with a MainCamera configured for transparency.");
                }

                var patchedAnyScene = false;
                var foundAnyCamera = false;

                foreach (var scenePath in buildScenes)
                {
                    var scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                    var dirty = false;

                    Camera targetCamera = null;

#if UNITY_2023_1_OR_NEWER
                    var cameras = UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None);
#else
                    var cameras = UnityEngine.Object.FindObjectsOfType<Camera>();
#endif
                    // 仕様書: Tag が MainCamera のカメラを優先
                    targetCamera = cameras.FirstOrDefault(c => c != null && SafeCompareTag(c.gameObject, "MainCamera"));
                    if (targetCamera == null)
                    {
                        // 次点: "Main Camera" という名前
                        targetCamera = cameras.FirstOrDefault(c => c != null && string.Equals(c.gameObject.name, "Main Camera", StringComparison.Ordinal));
                    }

                    if (targetCamera == null)
                    {
                        Debug.LogWarning($"[Arsist-{ADAPTER_ID}] No Camera found in scene: {scenePath}.");
                        continue;
                    }

                    foundAnyCamera = true;

                    // 仕様書: Tag=MainCamera を要求（SDK参照）
                    if (!SafeCompareTag(targetCamera.gameObject, "MainCamera"))
                    {
                        try
                        {
                            targetCamera.gameObject.tag = "MainCamera";
                            dirty = true;
                        }
                        catch (Exception e)
                        {
                            Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to set MainCamera tag in {scenePath}: {e.Message}");
                        }
                    }

                    // 仕様書: Clear Flags=Solid Color / Background=Black(Alpha 0)
                    if (targetCamera.clearFlags != CameraClearFlags.SolidColor)
                    {
                        targetCamera.clearFlags = CameraClearFlags.SolidColor;
                        dirty = true;
                    }

                    var desiredBg = new Color(0f, 0f, 0f, 0f);
                    if (targetCamera.backgroundColor != desiredBg)
                    {
                        targetCamera.backgroundColor = desiredBg;
                        dirty = true;
                    }

                    // 仕様書: AR Camera Background が付いていれば削除
                    if (arCameraBackgroundType != null)
                    {
                        var comps = targetCamera.GetComponents(arCameraBackgroundType);
                        if (comps != null && comps.Length > 0)
                        {
                            foreach (var c in comps)
                            {
                                if (c == null) continue;
                                UnityEngine.Object.DestroyImmediate(c, allowDestroyingAssets: true);
                                dirty = true;
                            }
                        }
                    }

                    if (dirty)
                    {
                        EditorSceneManager.MarkSceneDirty(scene);
                        EditorSceneManager.SaveScene(scene);
                        Debug.Log($"[Arsist-{ADAPTER_ID}] Applied transparent camera settings to scene: {scenePath}");
                        patchedAnyScene = true;
                    }
                }

                if (!foundAnyCamera)
                {
                    throw new Exception("No Camera found in any scene. XrealOne requires a MainCamera with SolidColor clear and black(0,0,0,0) background.");
                }

                if (!patchedAnyScene)
                {
                    // 既に要件を満たしている可能性もあるので、ここでは失敗にはしない（確認ログのみ）。
                    Debug.Log($"[Arsist-{ADAPTER_ID}] Transparent camera settings already satisfied. No changes needed.");
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[Arsist-{ADAPTER_ID}] Failed to apply transparent camera settings to scenes: {e.Message}");
                throw;
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

        /// <summary>
        /// XREAL One用のPlayerSettings設定を適用
        /// </summary>
        [MenuItem("Arsist/Adapters/XREAL One/Apply Player Settings")]
        public static void ApplyPlayerSettings()
        {
            Debug.Log($"[Arsist-{ADAPTER_ID}] Applying Player Settings...");

            // === Android基本設定 ===
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel29; // Android 10
            PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevel34; // Android 14
            
            // ARM64のみ（XREAL Oneは64bit専用）
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            
            // IL2CPP必須（パフォーマンス最適化）
            PlayerSettings.SetScriptingBackend(BuildTargetGroup.Android, ScriptingImplementation.IL2CPP);
            
            // API互換性
            // Unity バージョンによって ApiCompatibilityLevel の列挙子が異なるため、文字列パースで安全に選択する
            ApiCompatibilityLevel apiLevel;
            if (!System.Enum.TryParse("NET_Standard_2_1", out apiLevel) &&
                !System.Enum.TryParse("NET_Standard_2_0", out apiLevel) &&
                !System.Enum.TryParse("NET_Unity_4_8", out apiLevel) &&
                !System.Enum.TryParse("NET_4_6", out apiLevel))
            {
                var values = System.Enum.GetValues(typeof(ApiCompatibilityLevel));
                apiLevel = values.Length > 0 ? (ApiCompatibilityLevel)values.GetValue(0) : default;
            }
            PlayerSettings.SetApiCompatibilityLevel(BuildTargetGroup.Android, apiLevel);

            // === グラフィックス設定 ===
            // XrealOneガイド: Auto Graphics API を無効化し、OpenGLES3のみ（Vulkan削除）
            try
            {
                PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to disable Auto Graphics API: {e.Message}");
            }

            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.MTRendering = true; // マルチスレッドレンダリング
            PlayerSettings.graphicsJobs = true;
            PlayerSettings.gpuSkinning = true;

            // OpenGLES3のみ（Vulkanは透過モードで不具合の原因になりやすい）
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] {
                UnityEngine.Rendering.GraphicsDeviceType.OpenGLES3
            });

            // === Input System ===
            // XREAL SDK 3.x は Input System を前提にする箇所があるため、可能なら Both にする
            TrySetActiveInputHandlingToBoth();

            // glTFast をランタイムで使うための定義シンボルを追加
            EnsureGltfFastDefineSymbol(BuildTargetGroup.Android);

            // === 画面設定（XREAL One固定）===
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;
            PlayerSettings.allowedAutorotateToLandscapeLeft = true;
            PlayerSettings.allowedAutorotateToLandscapeRight = true;
            PlayerSettings.allowedAutorotateToPortrait = false;
            PlayerSettings.allowedAutorotateToPortraitUpsideDown = false;
            
            // フルスクリーン設定
            PlayerSettings.useAnimatedAutorotation = false;
            PlayerSettings.resizableWindow = false;

            // === ランタイム設定 ===
            PlayerSettings.Android.startInFullscreen = true;
            PlayerSettings.Android.renderOutsideSafeArea = true;
            
            // Sustained Performance Mode（発熱抑制）
            PlayerSettings.Android.optimizedFramePacing = true;

            Debug.Log($"[Arsist-{ADAPTER_ID}] Player Settings applied");
        }

        private static void EnsureGltfFastDefineSymbol(BuildTargetGroup group)
        {
            try
            {
                var symbols = PlayerSettings.GetScriptingDefineSymbolsForGroup(group);
                var list = symbols.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries).ToList();
                if (!list.Contains("GLTFAST"))
                {
                    list.Add("GLTFAST");
                    var updated = string.Join(";", list.Distinct());
                    PlayerSettings.SetScriptingDefineSymbolsForGroup(group, updated);
                    Debug.Log($"[Arsist-{ADAPTER_ID}] Added scripting define: GLTFAST");
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to set GLTFAST define: {e.Message}");
            }
        }

        /// <summary>
        /// OpenXR Loader設定
        /// </summary>
        [MenuItem("Arsist/Adapters/XREAL One/Configure XR Loader")]
        public static void ConfigureXRLoader()
        {
            Debug.Log($"[Arsist-{ADAPTER_ID}] Configuring XR Loader...");

            try
            {
                // UNITY_XR_MANAGEMENT シンボルは環境により未定義になることがあり、
                // それだと設定生成がスキップされて ArsistBuildPipeline の事前検証で落ちる。
                // ここでは XR Management パッケージが入っている前提で、常に設定を作成/紐づけする。

                // 1) 既存のXR General Settingsを取得（Unityバージョン差でAPIがstatic/instanceで揺れるためreflectionで対応）
                var generalSettings = GetXRGeneralSettingsForBuildTarget(BuildTargetGroup.Android);

                // 2) 無ければAssetsとして作成してBuildTargetに紐づけ
                const string xrSettingsDir = "Assets/XR/Settings";
                const string generalAssetPath = xrSettingsDir + "/XRGeneralSettings.asset";
                const string managerAssetPath = xrSettingsDir + "/XRManagerSettings.asset";

                if (!AssetDatabase.IsValidFolder("Assets/XR"))
                {
                    AssetDatabase.CreateFolder("Assets", "XR");
                }
                if (!AssetDatabase.IsValidFolder(xrSettingsDir))
                {
                    AssetDatabase.CreateFolder("Assets/XR", "Settings");
                }

                // XREAL SDK の Editor スクリプトは XREALSettings が未登録だと
                // NullReferenceException を投げてビルドが不安定になるため、ここで必ず用意する。
                EnsureXrealSettingsConfigObject(xrSettingsDir);

                if (generalSettings == null)
                {
                    generalSettings = AssetDatabase.LoadAssetAtPath<XRGeneralSettings>(generalAssetPath);
                    if (generalSettings == null)
                    {
                        generalSettings = ScriptableObject.CreateInstance<XRGeneralSettings>();
                        AssetDatabase.CreateAsset(generalSettings, generalAssetPath);
                    }
                    SetXRGeneralSettingsForBuildTarget(BuildTargetGroup.Android, generalSettings);
                }

                var managerSettings = generalSettings.Manager;
                if (managerSettings == null)
                {
                    managerSettings = AssetDatabase.LoadAssetAtPath<XRManagerSettings>(managerAssetPath);
                    if (managerSettings == null)
                    {
                        managerSettings = ScriptableObject.CreateInstance<XRManagerSettings>();
                        AssetDatabase.CreateAsset(managerSettings, managerAssetPath);
                    }
                    generalSettings.Manager = managerSettings;
                }

                // XrealOneガイド: XR Plug-in Management(Android) で XREAL を有効化
                EnsureXrealLoaderEnabled(managerSettings);

                // 自動初期化を有効化
                generalSettings.InitManagerOnStart = true;

                EditorUtility.SetDirty(generalSettings);
                EditorUtility.SetDirty(managerSettings);
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh();
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to configure XR Management: {e.Message}");
            }

            Debug.Log($"[Arsist-{ADAPTER_ID}] XR Loader configured");
        }

        private static void EnsureXrealSettingsConfigObject(string xrSettingsDir)
        {
            const string defaultKey = "com.unity.xr.management.xrealsettings";
            const string defaultAssetName = "XREALSettings.asset";

            try
            {
                // XREALSettings の型を取得（存在しない場合は何もしない）
                var xrealSettingsType = FindTypeInLoadedAssemblies("Unity.XR.XREAL.XREALSettings");
                if (xrealSettingsType == null)
                {
                    Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Unity.XR.XREAL.XREALSettings type not found (XREAL SDK not imported yet?)");
                    return;
                }

                // 設定キー（SDK側の定数が取れればそれを使う）
                var key = defaultKey;
                var fiKey = xrealSettingsType.GetField("k_SettingsKey", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                if (fiKey != null && fiKey.FieldType == typeof(string))
                {
                    var v = fiKey.GetValue(null) as string;
                    if (!string.IsNullOrWhiteSpace(v))
                    {
                        key = v;
                    }
                }

                // 既に登録済みならOK
                if (EditorBuildSettings.TryGetConfigObject(key, out UnityEngine.Object existing) && existing != null)
                {
                    return;
                }

                var assetPath = $"{xrSettingsDir}/{defaultAssetName}";
                var settingsAsset = AssetDatabase.LoadAssetAtPath(assetPath, xrealSettingsType);
                if (settingsAsset == null)
                {
                    var inst = ScriptableObject.CreateInstance(xrealSettingsType);
                    AssetDatabase.CreateAsset(inst, assetPath);
                    settingsAsset = inst;
                }

                // Unity 版差異に備えて AddConfigObject のオーバーロードを reflection で呼ぶ
                var ebsType = typeof(EditorBuildSettings);
                var mi = ebsType.GetMethod(
                    "AddConfigObject",
                    System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static,
                    null,
                    new[] { typeof(string), typeof(UnityEngine.Object), typeof(bool) },
                    null
                );
                if (mi != null)
                {
                    mi.Invoke(null, new object[] { key, settingsAsset, true });
                }
                else
                {
                    // 旧シグネチャ AddConfigObject(string, Object)
                    mi = ebsType.GetMethod(
                        "AddConfigObject",
                        System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static,
                        null,
                        new[] { typeof(string), typeof(UnityEngine.Object) },
                        null
                    );
                    if (mi != null)
                    {
                        mi.Invoke(null, new object[] { key, settingsAsset });
                    }
                    else
                    {
                        Debug.LogWarning($"[Arsist-{ADAPTER_ID}] EditorBuildSettings.AddConfigObject overloads not found");
                    }
                }

                EditorUtility.SetDirty(settingsAsset);
                AssetDatabase.SaveAssets();
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to ensure XREALSettings config object: {e.Message}");
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
                    System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static,
                    null,
                    new[] { typeof(BuildTargetGroup) },
                    null
                );
                if (miStatic != null)
                {
                    return miStatic.Invoke(null, new object[] { target }) as XRGeneralSettings;
                }

                // 2) instance: XRGeneralSettingsPerBuildTarget.Instance.XRGeneralSettingsForBuildTarget(BuildTargetGroup)
                var piInstance = t.GetProperty("Instance", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                var inst = piInstance != null ? piInstance.GetValue(null, null) : null;
                if (inst != null)
                {
                    var mi = t.GetMethod(
                        "XRGeneralSettingsForBuildTarget",
                        System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance,
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
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to get XRGeneralSettings for target: {e.Message}");
            }
            return null;
        }

        private static void SetXRGeneralSettingsForBuildTarget(BuildTargetGroup target, XRGeneralSettings settings)
        {
            try
            {
                var t = typeof(XRGeneralSettingsPerBuildTarget);

                // 1) static SetSettingsForBuildTarget(BuildTargetGroup, XRGeneralSettings)
                var miStatic = t.GetMethod(
                    "SetSettingsForBuildTarget",
                    System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static,
                    null,
                    new[] { typeof(BuildTargetGroup), typeof(XRGeneralSettings) },
                    null
                );
                if (miStatic != null)
                {
                    miStatic.Invoke(null, new object[] { target, settings });
                    return;
                }

                // 2) instance: XRGeneralSettingsPerBuildTarget.Instance.SetSettingsForBuildTarget(...)
                var piInstance = t.GetProperty("Instance", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                var inst = piInstance != null ? piInstance.GetValue(null, null) : null;
                if (inst != null)
                {
                    var mi = t.GetMethod(
                        "SetSettingsForBuildTarget",
                        System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance,
                        null,
                        new[] { typeof(BuildTargetGroup), typeof(XRGeneralSettings) },
                        null
                    );
                    if (mi != null)
                    {
                        mi.Invoke(inst, new object[] { target, settings });
                        return;
                    }
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to set XRGeneralSettings for target: {e.Message}");
            }
        }

        private static void EnsureXrealLoaderEnabled(XRManagerSettings managerSettings)
        {
            if (managerSettings == null)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] XRManagerSettings is null");
                return;
            }

            const string xrealLoaderTypeName = "Unity.XR.XREAL.XREALXRLoader";

            var alreadyEnabled = managerSettings.activeLoaders != null && managerSettings.activeLoaders.Any(l =>
                l != null && string.Equals(l.GetType().FullName, xrealLoaderTypeName, StringComparison.Ordinal));
            if (alreadyEnabled)
            {
                // 競合を避けるため、XREALビルドではXREAL以外のLoaderを外す（XrealOneガイド準拠で最小構成）。
                try
                {
                    RemoveNonXrealLoadersBestEffort(managerSettings, xrealLoaderTypeName);
                }
                catch { /* best-effort */ }

                Debug.Log($"[Arsist-{ADAPTER_ID}] XREAL Loader already enabled");
                return;
            }

            try
            {
                // XRPackageMetadataStore は XREAL SDK 側で IXRPackage を登録しているため、型名で割当できる
                XRPackageMetadataStore.AssignLoader(managerSettings, xrealLoaderTypeName, BuildTargetGroup.Android);
                Debug.Log($"[Arsist-{ADAPTER_ID}] Assigned XREAL Loader via XRPackageMetadataStore");

                // 競合を避けるため、XREAL以外のLoaderを外す
                try
                {
                    RemoveNonXrealLoadersBestEffort(managerSettings, xrealLoaderTypeName);
                }
                catch { /* best-effort */ }
                return;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to assign XREAL loader via metadata store: {e.Message}");
            }

            // フォールバック: 型が見つかればインスタンス生成して追加を試みる
            var xrealLoaderType = FindTypeInLoadedAssemblies(xrealLoaderTypeName);
            if (xrealLoaderType == null)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] XREALXRLoader type not found. Is XREAL SDK imported?");
                return;
            }

            try
            {
                var loaderInstance = ScriptableObject.CreateInstance(xrealLoaderType) as XRLoader;
                if (loaderInstance == null)
                {
                    Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to create XREAL loader instance");
                    return;
                }

                // TryAddLoader がある場合はそれを使う
                if (!TryInvokeTryAddLoader(managerSettings, loaderInstance, insertAtIndex: 0))
                {
                    Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Could not add XREAL loader via TryAddLoader overloads");
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Fallback XREAL loader add failed: {e.Message}");
            }
        }

        private static void RemoveNonXrealLoadersBestEffort(XRManagerSettings managerSettings, string keepLoaderTypeFullName)
        {
            try
            {
                if (managerSettings == null) return;

                // Unity 6 では activeLoaders が IReadOnlyList になるため、内部の List を reflection で触る。
                var t = managerSettings.GetType();
                var fi = t.GetField("m_ActiveLoaders", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                var listObj = fi != null ? fi.GetValue(managerSettings) : null;
                if (listObj is System.Collections.IList list)
                {
                    // Remove non-XREAL
                    for (int i = list.Count - 1; i >= 0; i--)
                    {
                        var loader = list[i] as XRLoader;
                        if (loader == null) continue;
                        if (!string.Equals(loader.GetType().FullName, keepLoaderTypeFullName, StringComparison.Ordinal))
                        {
                            list.RemoveAt(i);
                        }
                    }

                    // Move XREAL to index 0
                    int keepIndex = -1;
                    for (int i = 0; i < list.Count; i++)
                    {
                        var loader = list[i] as XRLoader;
                        if (loader != null && string.Equals(loader.GetType().FullName, keepLoaderTypeFullName, StringComparison.Ordinal))
                        {
                            keepIndex = i;
                            break;
                        }
                    }
                    if (keepIndex > 0)
                    {
                        var keep = list[keepIndex];
                        list.RemoveAt(keepIndex);
                        list.Insert(0, keep);
                    }

                    EditorUtility.SetDirty(managerSettings);
                }
            }
            catch
            {
                // ignore (best-effort)
            }
        }

        private static bool TryInvokeTryAddLoader(XRManagerSettings managerSettings, XRLoader loaderInstance, int insertAtIndex)
        {
            try
            {
                // Unityバージョンで TryAddLoader のシグネチャが異なるので、存在するものを順に試す
                var t = managerSettings.GetType();

                // 1) TryAddLoader(XRLoader, int)
                var miWithIndex = t.GetMethod("TryAddLoader", new[] { typeof(XRLoader), typeof(int) });
                if (miWithIndex != null)
                {
                    var added = (bool)miWithIndex.Invoke(managerSettings, new object[] { loaderInstance, insertAtIndex });
                    Debug.Log($"[Arsist-{ADAPTER_ID}] TryAddLoader(XREAL, index) => {added}");
                    return added;
                }

                // 2) TryAddLoader(XRLoader)
                var mi = t.GetMethod("TryAddLoader", new[] { typeof(XRLoader) });
                if (mi != null)
                {
                    var added = (bool)mi.Invoke(managerSettings, new object[] { loaderInstance });
                    Debug.Log($"[Arsist-{ADAPTER_ID}] TryAddLoader(XREAL) => {added}");
                    return added;
                }

                return false;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] TryAddLoader reflection failed: {e.Message}");
                return false;
            }
        }

        private static Type FindTypeInLoadedAssemblies(string fullName)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                var t = asm.GetType(fullName, throwOnError: false);
                if (t != null) return t;
            }
            return null;
        }

        private static void TrySetActiveInputHandlingToBoth()
        {
            try
            {
                var prop = typeof(PlayerSettings).GetProperty("activeInputHandling", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                if (prop == null)
                {
                    return;
                }

                var enumType = prop.PropertyType;
                object bothValue;
                if (!Enum.TryParse(enumType, "Both", ignoreCase: true, result: out bothValue))
                {
                    if (!Enum.TryParse(enumType, "InputSystemPackage", ignoreCase: true, result: out bothValue))
                    {
                        return;
                    }
                }

                prop.SetValue(null, bothValue);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to set activeInputHandling: {e.Message}");
            }
        }

        /// <summary>
        /// XR Interaction Toolkit設定
        /// </summary>
        public static void ConfigureXRInteraction()
        {
            Debug.Log($"[Arsist-{ADAPTER_ID}] Configuring XR Interaction...");

            // InputActionアセットをコピー
            var sourceInputActions = "Packages/com.unity.xr.interaction.toolkit/Runtime/Interaction/Actions/XRI Default Input Actions.inputactions";
            var destInputActions = "Assets/Arsist/Input/XrealInputActions.inputactions";

            if (File.Exists(sourceInputActions) && !File.Exists(destInputActions))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(destInputActions));
                File.Copy(sourceInputActions, destInputActions);
                AssetDatabase.Refresh();
            }

            Debug.Log($"[Arsist-{ADAPTER_ID}] XR Interaction configured");
        }

        /// <summary>
        /// Quality Settings最適化
        /// </summary>
        [MenuItem("Arsist/Adapters/XREAL One/Apply Quality Settings")]
        public static void ApplyQualitySettings()
        {
            Debug.Log($"[Arsist-{ADAPTER_ID}] Applying Quality Settings...");

            // 最適なQualityレベルを設定
            QualitySettings.SetQualityLevel(2); // Medium相当
            
            // アンチエイリアシング（MSAAx4）
            QualitySettings.antiAliasing = 4;
            
            // テクスチャ品質
            QualitySettings.globalTextureMipmapLimit = 0; // フル解像度
            QualitySettings.anisotropicFiltering = AnisotropicFiltering.ForceEnable;
            
            // シャドウ設定
            QualitySettings.shadows = ShadowQuality.HardOnly;
            QualitySettings.shadowResolution = ShadowResolution.Medium;
            QualitySettings.shadowDistance = 20f;
            QualitySettings.shadowCascades = 2;
            
            // LOD設定
            QualitySettings.lodBias = 1.0f;
            QualitySettings.maximumLODLevel = 0;
            
            // Skin Weights
            QualitySettings.skinWeights = SkinWeights.TwoBones;
            
            // VSync（AR用に無効化、フレームレート制御はSDKに任せる）
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = 60;

            Debug.Log($"[Arsist-{ADAPTER_ID}] Quality Settings applied");
        }

        /// <summary>
        /// AndroidManifest.xmlにXREAL固有の設定を追加
        /// </summary>
        public static void PatchAndroidManifest()
        {
            Debug.Log($"[Arsist-{ADAPTER_ID}] Patching AndroidManifest.xml...");

            var manifestPath = Path.Combine(Application.dataPath, "Plugins", "Android", "AndroidManifest.xml");
            
            if (!File.Exists(manifestPath))
            {
                // テンプレートからコピー
                CreateBaseManifest(manifestPath);
            }

            var doc = new XmlDocument();
            doc.Load(manifestPath);

            var manifest = doc.DocumentElement;
            var nsManager = new XmlNamespaceManager(doc.NameTable);
            nsManager.AddNamespace("android", "http://schemas.android.com/apk/res/android");

            // === パーミッション追加 ===
            AddPermissionIfMissing(doc, manifest, "android.permission.CAMERA");
            AddPermissionIfMissing(doc, manifest, "android.permission.INTERNET");
            AddPermissionIfMissing(doc, manifest, "android.permission.ACCESS_NETWORK_STATE");

            // === uses-feature追加 ===
            AddFeatureIfMissing(doc, manifest, "android.hardware.camera", true);
            AddFeatureIfMissing(doc, manifest, "android.hardware.camera.autofocus", false);

            // === Application/Activity設定 ===
            var application = manifest.SelectSingleNode("application") as XmlElement;
            if (application != null)
            {
                // meta-data追加
                AddMetaDataIfMissing(doc, application, "com.xreal.sdk.version", SDK_VERSION, nsManager);
                
                var activity = application.SelectSingleNode("activity[@android:name='com.unity3d.player.UnityPlayerActivity']", nsManager) as XmlElement;
                if (activity != null)
                {
                    // AR用カテゴリ追加
                    var intentFilter = activity.SelectSingleNode("intent-filter") as XmlElement;
                    if (intentFilter != null)
                    {
                        AddCategoryIfMissing(doc, intentFilter, "com.xreal.intent.category.AR", nsManager);
                    }

                    // 画面設定
                    activity.SetAttribute("screenOrientation", "http://schemas.android.com/apk/res/android", "landscape");
                    activity.SetAttribute("configChanges", "http://schemas.android.com/apk/res/android", 
                        "keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode");
                }
            }

            doc.Save(manifestPath);
            AssetDatabase.Refresh();

            Debug.Log($"[Arsist-{ADAPTER_ID}] AndroidManifest.xml patched");
        }

        private static void CreateBaseManifest(string path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            
            var content = @"<?xml version=""1.0"" encoding=""utf-8""?>
<manifest xmlns:android=""http://schemas.android.com/apk/res/android""
    package=""com.arsist.app""
    android:versionCode=""1""
    android:versionName=""1.0"">
    
    <uses-sdk android:minSdkVersion=""29"" android:targetSdkVersion=""34"" />
    
    <application
        android:allowBackup=""false""
        android:icon=""@mipmap/app_icon""
        android:label=""@string/app_name""
        android:theme=""@style/UnityThemeSelector"">
        
        <activity
            android:name=""com.unity3d.player.UnityPlayerActivity""
            android:exported=""true""
            android:screenOrientation=""landscape""
            android:configChanges=""keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode"">
            <intent-filter>
                <action android:name=""android.intent.action.MAIN"" />
                <category android:name=""android.intent.category.LAUNCHER"" />
            </intent-filter>
        </activity>
    </application>
</manifest>";
            
            File.WriteAllText(path, content);
        }

        private static void AddPermissionIfMissing(XmlDocument doc, XmlElement manifest, string permission)
        {
            var existing = manifest.SelectSingleNode($"uses-permission[@android:name='{permission}']", 
                CreateNamespaceManager(doc));
            
            if (existing == null)
            {
                var element = doc.CreateElement("uses-permission");
                element.SetAttribute("name", "http://schemas.android.com/apk/res/android", permission);
                manifest.AppendChild(element);
            }
        }

        private static void AddFeatureIfMissing(XmlDocument doc, XmlElement manifest, string feature, bool required)
        {
            var existing = manifest.SelectSingleNode($"uses-feature[@android:name='{feature}']", 
                CreateNamespaceManager(doc));
            
            if (existing == null)
            {
                var element = doc.CreateElement("uses-feature");
                element.SetAttribute("name", "http://schemas.android.com/apk/res/android", feature);
                element.SetAttribute("required", "http://schemas.android.com/apk/res/android", required.ToString().ToLower());
                manifest.AppendChild(element);
            }
        }

        private static void AddMetaDataIfMissing(XmlDocument doc, XmlElement parent, string name, string value, XmlNamespaceManager nsManager)
        {
            var existing = parent.SelectSingleNode($"meta-data[@android:name='{name}']", nsManager);
            
            if (existing == null)
            {
                var element = doc.CreateElement("meta-data");
                element.SetAttribute("name", "http://schemas.android.com/apk/res/android", name);
                element.SetAttribute("value", "http://schemas.android.com/apk/res/android", value);
                parent.AppendChild(element);
            }
        }

        private static void AddCategoryIfMissing(XmlDocument doc, XmlElement intentFilter, string category, XmlNamespaceManager nsManager)
        {
            var existing = intentFilter.SelectSingleNode($"category[@android:name='{category}']", nsManager);
            
            if (existing == null)
            {
                var element = doc.CreateElement("category");
                element.SetAttribute("name", "http://schemas.android.com/apk/res/android", category);
                intentFilter.AppendChild(element);
            }
        }

        private static XmlNamespaceManager CreateNamespaceManager(XmlDocument doc)
        {
            var nsManager = new XmlNamespaceManager(doc.NameTable);
            nsManager.AddNamespace("android", "http://schemas.android.com/apk/res/android");
            return nsManager;
        }

        /// <summary>
        /// XREAL One用のXR Originプレハブを生成
        /// </summary>
        [MenuItem("Arsist/Adapters/XREAL One/Create XR Origin Prefab")]
        public static void CreateXROriginPrefab()
        {
            Debug.Log($"[Arsist-{ADAPTER_ID}] Creating XR Origin prefab...");

            // XR Origin
            var xrOrigin = new GameObject("XR Origin (XREAL One)");
            
            // Camera Offset
            var cameraOffset = new GameObject("Camera Offset");
            cameraOffset.transform.SetParent(xrOrigin.transform);
            
            // Main Camera
            var mainCamera = new GameObject("Main Camera");
            mainCamera.tag = "MainCamera";
            mainCamera.transform.SetParent(cameraOffset.transform);
            var camera = mainCamera.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Color.clear;
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 100f;
            camera.fieldOfView = 50f; // XREAL One FOV
            mainCamera.AddComponent<AudioListener>();
            
            // Gaze Interactor
            var gazeInteractor = new GameObject("Gaze Interactor");
            gazeInteractor.transform.SetParent(mainCamera.transform);
            gazeInteractor.transform.localPosition = Vector3.zero;
            
            // Ray Interactor（コントローラー用）
            var rayInteractor = new GameObject("Ray Interactor");
            rayInteractor.transform.SetParent(xrOrigin.transform);
            var lineRenderer = rayInteractor.AddComponent<LineRenderer>();
            lineRenderer.startWidth = 0.005f;
            lineRenderer.endWidth = 0.005f;

            // プレハブとして保存
            var prefabPath = "Assets/Arsist/Prefabs/XROrigin.prefab";
            Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(Application.dataPath, "..", prefabPath)));
            PrefabUtility.SaveAsPrefabAsset(xrOrigin, prefabPath);
            GameObject.DestroyImmediate(xrOrigin);
            
            AssetDatabase.Refresh();
            Debug.Log($"[Arsist-{ADAPTER_ID}] XR Origin prefab created at {prefabPath}");
        }
    }
}
