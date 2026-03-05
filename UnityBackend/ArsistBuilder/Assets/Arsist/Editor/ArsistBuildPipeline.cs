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
using Arsist.Runtime.Scripting;
using Arsist.Runtime.RemoteInput;
using UnityEditor.XR.Management;
using UnityEngine.XR.Management;
using UnityEngine.Rendering;
using TMPro;

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
        private static TMP_FontAsset _defaultTmpFont;
        private static Material _defaultTmpMaterial;

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
                EnsureUILayerExists();
                GenerateScenes();

                // Phase 2: UI生成（StreamingAssetsへのコピーのみ。Canvas生成はPhase 1で完了）
                Debug.Log("[Arsist] Phase 2: Copying UI assets...");
                CopyUICodeToStreamingAssets();
                CopyScriptsToStreamingAssets();

                // Phase 3: ビルド設定適用
                Debug.Log("[Arsist] Phase 3: Applying build settings...");
                ApplyBuildSettings(_manifest);

                // Phase 3.1: デバイス固有パッチ（Editorスクリプト）を実行
                Debug.Log("[Arsist] Phase 3.1: Applying device patches...");
                ApplyDevicePatches(_targetDevice);

                // Phase 3.15: Quest向けビルド設定（OVRProjectConfig等）
                // Quest固有の設定は、Questターゲット時のみ実行
                if (IsQuestTargetDevice())
                {
                    ApplyQuestBuildBootstrap();
                }

                // Phase 3.2: ビルド前検証（ここで落とすことで“成功したけど動かない”を避ける）
                Debug.Log("[Arsist] Phase 3.2: Validating build readiness...");
                ValidateBuildReadiness(_targetDevice);

                // Phase 3.3: glTFast に必要なシェーダーを確実にビルドに含める
                Debug.Log("[Arsist] Phase 3.3: Ensuring required shaders...");
                EnsureGltfastShaders();
                
                // Phase 3.4: TextMeshPro リソースを確保
                Debug.Log("[Arsist] Phase 3.4: Ensuring TextMeshPro resources...");
                EnsureTextMeshProResources();
                EnsureUniVRMResources();
                LoadDefaultTmpAssets();
                
                // Phase 3.5: TMPフォントをStreamingAssetsにコピー（ランタイム読み込み用）
                Debug.Log("[Arsist] Phase 3.5: Copying TMP font to StreamingAssets...");
                CopyTmpFontToStreamingAssets();

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

        private static void EnsureUILayerExists()
        {
            try
            {
                if (LayerMask.NameToLayer("UI") != -1)
                {
                    return;
                }

                var tagManager = new SerializedObject(
                    AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TagManager.asset")[0]);
                var layersProp = tagManager.FindProperty("layers");

                int targetIndex = -1;
                // Prefer slot 5 if empty, otherwise first empty user layer
                if (layersProp.GetArrayElementAtIndex(5).stringValue == string.Empty)
                {
                    targetIndex = 5;
                }
                else
                {
                    for (int i = 8; i < layersProp.arraySize; i++)
                    {
                        if (layersProp.GetArrayElementAtIndex(i).stringValue == string.Empty)
                        {
                            targetIndex = i;
                            break;
                        }
                    }
                }

                if (targetIndex >= 0)
                {
                    layersProp.GetArrayElementAtIndex(targetIndex).stringValue = "UI";
                    tagManager.ApplyModifiedPropertiesWithoutUndo();
                    Debug.Log($"[Arsist] Added UI layer at index {targetIndex}");
                }
                else
                {
                    Debug.LogWarning("[Arsist] No available layer slot for UI. UI camera will fallback to render all layers.");
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to ensure UI layer exists: {e.Message}");
            }
        }

        private static void ParseCommandLineArgs()
        {
            string arsistJdkPath = null;
            string arsistAndroidSdkPath = null;

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
                    case "-arsist-jdk":
                        arsistJdkPath = args[++i];
                        break;
                    case "-arsist-android-sdk":
                        arsistAndroidSdkPath = args[++i];
                        break;
                }
            }

            Debug.Log($"[Arsist] Target: {_buildTarget}, Output: {_outputPath}, Device: {_targetDevice}, Dev: {_developmentBuild}");

            // Android ツールチェーンのパスを AndroidExternalToolsSettings に反映
            ApplyAndroidExternalToolsSettings(arsistJdkPath, arsistAndroidSdkPath);
        }

        /// <summary>
        /// AndroidExternalToolsSettings (UnityEditor.Android) に JDK / SDK / NDK パスを設定する。
        /// reflection で呼ぶことで Android Build Support 未インストール環境でも型エラーを起こさない。
        /// </summary>
        private static void ApplyAndroidExternalToolsSettings(string jdkPath, string androidSdkPath)
        {
            // EditorPrefs に先に書く（legacy かつ広範な互換性）
            // Unity のバッチモードでは EditorPrefs は HKCU レジストリに書かれ、プロセス内から即時参照される
            if (!string.IsNullOrWhiteSpace(jdkPath))
            {
                EditorPrefs.SetString("JdkPath", jdkPath);
                Debug.Log($"[Arsist] EditorPrefs.JdkPath = {jdkPath}");
            }

            if (!string.IsNullOrWhiteSpace(androidSdkPath))
            {
                EditorPrefs.SetString("AndroidSdkRoot", androidSdkPath);
                Debug.Log($"[Arsist] EditorPrefs.AndroidSdkRoot = {androidSdkPath}");

                // NDK: sdk/ndk/<version> または sdk/ndk-bundle
                var ndkCandidates = new[]
                {
                    System.IO.Path.Combine(androidSdkPath, "ndk"),
                    System.IO.Path.Combine(androidSdkPath, "ndk-bundle"),
                };
                string ndkPath = null;
                foreach (var c in ndkCandidates)
                {
                    if (System.IO.Directory.Exists(c))
                    {
                        var sub = System.IO.Directory.GetDirectories(c);
                        if (sub.Length > 0)
                        {
                            System.Array.Sort(sub);
                            ndkPath = sub[sub.Length - 1];
                        }
                        else
                        {
                            ndkPath = c;
                        }
                        break;
                    }
                }

                if (ndkPath != null)
                {
                    EditorPrefs.SetString("AndroidNdkRoot", ndkPath);
                    EditorPrefs.SetString("AndroidNdkRootR16b", ndkPath);
                    Debug.Log($"[Arsist] EditorPrefs.AndroidNdkRoot = {ndkPath}");
                }
            }

            // AndroidExternalToolsSettings (Unity 2021+) による設定も試みる
            try
            {
                var settingsType = FindTypeInLoadedAssemblies("UnityEditor.Android.AndroidExternalToolsSettings");
                if (settingsType == null)
                {
                    Debug.LogWarning("[Arsist] AndroidExternalToolsSettings type not found. Using EditorPrefs only.");
                    return;
                }

                // デバッグ: AndroidExternalToolsSettings の全フィールド/プロパティを列挙
                try
                {
                    var allProps = settingsType.GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                    var allStaticFields = settingsType.GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
                    var allInstFields = settingsType.GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                    var allMethods = settingsType.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
                    Debug.Log($"[Arsist] AndroidExternalToolsSettings props: {string.Join(", ", System.Array.ConvertAll(allProps, p => p.Name))}");
                    Debug.Log($"[Arsist] AndroidExternalToolsSettings static fields: {string.Join(", ", System.Array.ConvertAll(allStaticFields, f => f.Name))}");
                    Debug.Log($"[Arsist] AndroidExternalToolsSettings inst fields: {string.Join(", ", System.Array.ConvertAll(allInstFields, f => f.Name))}");
                    Debug.Log($"[Arsist] AndroidExternalToolsSettings methods: {string.Join(", ", System.Array.ConvertAll(allMethods, m => m.Name))}");

                    // SetAndroidRootPath のシグネチャを確認
                    var setAndroid = settingsType.GetMethod("SetAndroidRootPath", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
                    if (setAndroid != null)
                    {
                        var paramInfos = setAndroid.GetParameters();
                        Debug.Log($"[Arsist] SetAndroidRootPath params: {string.Join(", ", System.Array.ConvertAll(paramInfos, p => $"{p.ParameterType.Name} {p.Name}"))}");
                    }

                    // BaseType を調べる
                    Debug.Log($"[Arsist] AndroidExternalToolsSettings BaseType: {settingsType.BaseType?.FullName ?? "null"}");

                    // 現在の jdkRootPath を取得
                    var jdkPropGetter = settingsType.GetProperty("jdkRootPath", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                    if (jdkPropGetter != null)
                    {
                        var current = jdkPropGetter.GetValue(null);
                        Debug.Log($"[Arsist] jdkRootPath (current) = '{current}'");
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning($"[Arsist] Failed to enumerate members: {ex.Message}");
                }

                void TrySetProp(string propName, object value)
                {
                    if (value is string s && string.IsNullOrWhiteSpace(s)) return;
                    try
                    {
                        var prop = settingsType.GetProperty(propName,
                            System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                        if (prop != null && prop.CanWrite)
                        {
                            prop.SetValue(null, value);
                            Debug.Log($"[Arsist] AndroidExternalToolsSettings.{propName} = {value}");
                        }
                        else if (prop != null)
                        {
                            Debug.LogWarning($"[Arsist] AndroidExternalToolsSettings.{propName} is read-only");
                        }
                        else
                        {
                            Debug.LogWarning($"[Arsist] AndroidExternalToolsSettings.{propName} property not found");
                        }
                    }
                    catch (Exception inner)
                    {
                        // プロパティセッターが検証エラーを出すことがある（例: JDK バージョン不一致）
                        Debug.LogWarning($"[Arsist] AndroidExternalToolsSettings.{propName} setter failed (EditorPrefs was set): {inner.InnerException?.Message ?? inner.Message}");
                    }
                }

                // SetAndroidRootPath(AndroidRoot, string) を直接呼び出してJDKを登録する
                // (property setter の バリデーションをバイパスできる可能性がある)
                var allMethodsForSearch = settingsType.GetMethods(
                    System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static
                    | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                // SetAndroidRootPath を確実に探す (型チェックは緩く)
                System.Reflection.MethodInfo setAndroidRootPathMethod = null;
                foreach (var m in allMethodsForSearch)
                {
                    if (m.Name == "SetAndroidRootPath")
                    {
                        var ps = m.GetParameters();
                        if (ps.Length == 2)
                        {
                            setAndroidRootPathMethod = m;
                            Debug.Log($"[Arsist] SetAndroidRootPath found: IsStatic={m.IsStatic}, p0={ps[0].ParameterType.Name}({ps[0].ParameterType.IsEnum}), p1={ps[1].ParameterType.Name}");
                            break;
                        }
                    }
                }

                if (setAndroidRootPathMethod != null && !string.IsNullOrWhiteSpace(jdkPath))
                {
                    var paramInfos = setAndroidRootPathMethod.GetParameters();
                    var androidRootType = paramInfos.Length > 0 ? paramInfos[0].ParameterType : null;

                    if (androidRootType != null)
                    {
                        // AndroidRoot のすべての具体的サブクラスを AppDomain 全体から探す
                        System.Type jdkConcreteType = null;
                        var subclassLog = new System.Text.StringBuilder();
                        try
                        {
                            foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
                            {
                                System.Type[] asmTypes;
                                try { asmTypes = asm.GetTypes(); }
                                catch { continue; }
                                foreach (var t in asmTypes)
                                {
                                    if (t.IsClass && !t.IsAbstract && androidRootType.IsAssignableFrom(t))
                                    {
                                        subclassLog.Append(t.FullName).Append(", ");
                                        if (jdkConcreteType == null
                                            && (t.Name.IndexOf("jdk", System.StringComparison.OrdinalIgnoreCase) >= 0
                                             || t.Name.IndexOf("java", System.StringComparison.OrdinalIgnoreCase) >= 0))
                                        {
                                            jdkConcreteType = t;
                                        }
                                    }
                                }
                            }
                        }
                        catch (Exception exSub)
                        {
                            Debug.LogWarning($"[Arsist] Subclass scan failed: {exSub.Message}");
                        }
                        Debug.Log($"[Arsist] AndroidRoot subclasses: {subclassLog}");
                        Debug.Log($"[Arsist] JDK concrete type: {jdkConcreteType?.FullName ?? "NOT FOUND"}");

                        object jdkRootValue = null;

                        if (jdkConcreteType != null)
                        {
                            // JDK 用具体クラスのコンストラクタを試みる
                            var jdkCtors = jdkConcreteType.GetConstructors(
                                System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic
                                | System.Reflection.BindingFlags.Instance);
                            foreach (var ctor in jdkCtors)
                            {
                                var ps = ctor.GetParameters();
                                Debug.Log($"[Arsist] {jdkConcreteType.Name} ctor({string.Join(", ", System.Array.ConvertAll(ps, p => p.ParameterType.Name + " " + p.Name))})");
                                try
                                {
                                    object inst = null;
                                    if (ps.Length == 0) inst = ctor.Invoke(null);
                                    else if (ps.Length == 1 && ps[0].ParameterType == typeof(string)) inst = ctor.Invoke(new object[] { jdkPath });
                                    else if (ps.Length == 1 && ps[0].ParameterType == typeof(bool)) inst = ctor.Invoke(new object[] { false });
                                    else if (ps.Length == 2 && ps[0].ParameterType == typeof(bool) && ps[1].ParameterType == typeof(string))
                                        inst = ctor.Invoke(new object[] { false, jdkPath });

                                    if (inst != null)
                                    {
                                        // m_CustomDirectory / m_UseEmbedded をセット
                                        foreach (var fn in new[] { "m_CustomDirectory", "customDirectory", "_customDirectory" })
                                        {
                                            var fld = jdkConcreteType.GetField(fn, System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
                                            fld?.SetValue(inst, jdkPath);
                                        }
                                        foreach (var fn in new[] { "m_UseEmbedded", "useEmbedded", "_useEmbedded" })
                                        {
                                            var fld = jdkConcreteType.GetField(fn, System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
                                            fld?.SetValue(inst, false);
                                        }
                                        jdkRootValue = inst;
                                        Debug.Log($"[Arsist] {jdkConcreteType.Name} instance created");
                                        break;
                                    }
                                }
                                catch (Exception exCtor)
                                {
                                    Debug.Log($"[Arsist] {jdkConcreteType.Name} ctor({ps.Length}) failed: {exCtor.InnerException?.Message ?? exCtor.Message}");
                                }
                            }
                        }

                        if (jdkRootValue != null)
                        {
                            try
                            {
                                setAndroidRootPathMethod.Invoke(null, new object[] { jdkRootValue, jdkPath });
                                Debug.Log($"[Arsist] SetAndroidRootPath succeeded");

                                var postCheck = settingsType.GetProperty("jdkRootPath",
                                    System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                                if (postCheck != null)
                                    Debug.Log($"[Arsist] jdkRootPath after SetAndroidRootPath = '{postCheck.GetValue(null)}'");
                            }
                            catch (Exception ex)
                            {
                                Debug.LogWarning($"[Arsist] SetAndroidRootPath failed: {ex.InnerException?.Message ?? ex.Message}");
                            }
                        }
                        else
                        {
                            Debug.LogWarning("[Arsist] Could not construct/find AndroidRoot JDK value");
                        }
                    }
                }

                // jdkRootPath セッターが失敗する場合はバッキングフィールドへ直接書き込む
                if (!string.IsNullOrWhiteSpace(jdkPath))
                {
                    bool jdkSet = false;
                    // まず通常のプロパティセッターを試みる
                    try
                    {
                        var prop = settingsType.GetProperty("jdkRootPath",
                            System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                        if (prop != null && prop.CanWrite)
                        {
                            prop.SetValue(null, jdkPath);
                            Debug.Log($"[Arsist] AndroidExternalToolsSettings.jdkRootPath = {jdkPath}");
                            jdkSet = true;
                        }
                    }
                    catch (Exception inner)
                    {
                        Debug.LogWarning($"[Arsist] jdkRootPath setter failed, trying field: {inner.InnerException?.Message ?? inner.Message}");
                    }

                    // セッターが失敗した場合: バッキングフィールドへ直接書き込む
                    if (!jdkSet)
                    {
                        var fieldNames = new[] { "m_JDKRoot", "m_JdkRoot", "m_JDKRootPath", "m_JdkRootPath", "jdkRootPath", "<jdkRootPath>k__BackingField" };
                        foreach (var fn in fieldNames)
                        {
                            var field = settingsType.GetField(fn,
                                System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static
                                | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
                            if (field != null)
                            {
                                try
                                {
                                    field.SetValue(null, jdkPath);
                                    jdkSet = true;
                                    Debug.Log($"[Arsist] AndroidExternalToolsSettings.{fn} (field) = {jdkPath}");
                                    break;
                                }
                                catch { /* ignore */ }
                            }
                        }

                        if (!jdkSet)
                        {
                            Debug.LogWarning("[Arsist] Could not set JDK path via AndroidExternalToolsSettings. Relying on EditorPrefs.");
                        }
                    }
                }

                TrySetProp("sdkRootPath", androidSdkPath);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to apply AndroidExternalToolsSettings via reflection: {e.Message}");
            }
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
                if (!File.Exists(uiPath))
                {
                    Debug.LogWarning("[Arsist] ui_layouts.json missing. Creating default layout with diagnostic text.");
                    _uiLayoutCache["default_layout"] = CreateDefaultLayout("DefaultLayout");
                    return;
                }

                var uiJson = File.ReadAllText(uiPath);
                var layouts = JArray.Parse(uiJson);
                foreach (JObject layout in layouts)
                {
                    var id = layout["id"]?.ToString();
                    if (string.IsNullOrEmpty(id)) continue;
                    _uiLayoutCache[id] = layout;
                }

                if (_uiLayoutCache.Count == 0)
                {
                    Debug.LogWarning("[Arsist] No layouts found in ui_layouts.json. Creating default layout with diagnostic text.");
                    _uiLayoutCache["default_layout"] = CreateDefaultLayout("DefaultLayout");
                }
                else
                {
                    Debug.Log($"[Arsist] UILayout cache loaded: {_uiLayoutCache.Count} entries");
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to load UI layout cache: {e.Message}");
                _uiLayoutCache["default_layout"] = CreateDefaultLayout("DefaultLayout_Exception");
            }
        }

        // Creates a minimal layout with a diagnostic Text element to guarantee something renders.
        private static JObject CreateDefaultLayout(string name)
        {
            var root = new JObject
            {
                ["id"] = Guid.NewGuid().ToString(),
                ["type"] = "Text",
                ["content"] = "UI layout missing",
                ["layout"] = "Absolute",
                ["style"] = new JObject
                {
                    ["width"] = 800,
                    ["height"] = 200,
                    ["top"] = 100,
                    ["left"] = 100,
                    ["fontSize"] = 96,
                    ["color"] = "#FFFFFFFF",
                    ["textAlign"] = "center",
                },
                ["children"] = new JArray()
            };

            return new JObject
            {
                ["id"] = "default_layout",
                ["name"] = name,
                ["scope"] = "uhd",
                ["resolution"] = new JObject { ["width"] = 1920, ["height"] = 1080 },
                ["root"] = root,
            };
        }

        private static void GenerateScenes()
        {
            var scenesPath = Path.Combine(Application.dataPath, "ArsistGenerated", "scenes.json");
            if (!File.Exists(scenesPath)) return;

            var scenesJson = File.ReadAllText(scenesPath);
            var scenes = JArray.Parse(scenesJson);

            EnsureUILayoutCache();

            // VRM ファイルを StreamingAssets にコピー
            CopyVRMFilesToStreamingAssets(scenes);

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
                            // 親に配置（worldPositionStays = false でローカル座標を保持）
                            go.transform.SetParent(contentParent, false);
                        }
                    }
                }

                // Remote Input（UDP/TCP）を追加
                EnsureRemoteInputInScene(_manifest);

                // WebSocket リモートコントロールサーバーを追加（明示的に有効化された場合のみ）
                EnsureWebSocketServerInScene(_manifest);

                // ランタイム基盤コンポーネントを追加
                CreateRuntimeSystems(_manifest);

                // UI生成（SimpleHUDDisplayなど）- シーン保存前に実行
                var uiPath = Path.Combine(Application.dataPath, "ArsistGenerated", "ui_layouts.json");
                if (File.Exists(uiPath))
                {
                    Debug.Log("[Arsist] Generating Canvas UI in scene before save");
                    GenerateCanvasUI(uiPath);
                }

                // シーンを保存（すべてのGameObjectが作成された後）
                var scenePath = $"Assets/Scenes/{sceneName}.unity";
                Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(Application.dataPath, "..", scenePath)));
                UnityEditor.SceneManagement.EditorSceneManager.SaveScene(newScene, scenePath);
                AssetDatabase.Refresh();
                
                // ビルド設定に追加
                buildScenes.Add(new EditorBuildSettingsScene(scenePath, true));
                Debug.Log($"[Arsist] Scene saved with all GameObjects: {scenePath}");
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
            var assetId = objData["assetId"]?.ToString() ?? name;

            GameObject go = null;

            // VRM モデル
            if (type == "vrm" && !string.IsNullOrEmpty(modelPath))
            {
                go = CreateVRMGameObject(name, modelPath, assetId);
            }
            // モデル読み込み（GLB/GLTF）
            else if (type == "model" && !string.IsNullOrEmpty(modelPath))
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

            var transformData = objData["transform"] as JObject;
            if (transformData != null)
            {
                var pos   = transformData["position"] as JObject;
                var rot   = transformData["rotation"] as JObject;
                var scale = transformData["scale"]    as JObject;

                float px = pos?["x"]?.Value<float>() ?? 0;
                float py = pos?["y"]?.Value<float>() ?? 0;
                float pz = pos?["z"]?.Value<float>() ?? 0;

                float rx = rot?["x"]?.Value<float>() ?? 0;
                float ry = rot?["y"]?.Value<float>() ?? 0;
                float rz = rot?["z"]?.Value<float>() ?? 0;

                float sx = scale?["x"]?.Value<float>() ?? 1;
                float sy = scale?["y"]?.Value<float>() ?? 1;
                float sz = scale?["z"]?.Value<float>() ?? 1;

                // =================================================================
                // 【Arsist 座標系定義】
                //
                // エディタ（Arsist Engine ビューポート）の座標系:
                //   原点  = ユーザーのデフォルト位置（AR 開始点）
                //   Z+   = ユーザーの正面（前方）
                //   X+   = ユーザーの左
                //   X-   = ユーザーの右
                //   Y+   = 上
                //
                // Unity AR の世界座標系（XREAL / Meta Quest ともに同様）:
                //   原点  = XR Origin（= AR 開始点）
                //   Z+   = 前方  ← エディタ Z+ と同じ → Z はそのまま
                //   X+   = 右   ← エディタ X+ とは逆  → X を反転 (-x)
                //   Y+   = 上   ← 同じ → Y はそのまま
                //
                // 変換式（全タイプ共通）:
                //   Position  : (x, y, z) → (-x, y, z)
                //   Rotation  : X 軸鏡像変換後の Quaternion
                //               Mirror_X(Q) = new Quaternion(-qx, qy, qz, -qw)
                //   Scale     : (x, y, z) そのまま（スケールは鏡像しない）
                //
                // ※ GLB (model): wrapper に上記変換適用。glTFast の内部座標変換は保持。
                // ※ VRM        : wrapper に Position のみ適用。Rotation は UniVRM 内部変換に委任。
                // =================================================================

                if (type == "vrm")
                {
                    // VRM: Position X 反転 + Rotation Mirror_X 変換。
                    // UniVRM の内部変換（Y180等）は wrapper localRotation に加算されるため問題なし。
                    go.transform.localPosition = new Vector3(-px, py, pz);
                    var qv = Quaternion.Euler(rx, ry, rz);
                    go.transform.localRotation = new Quaternion(-qv.x, qv.y, qv.z, -qv.w);
                    go.transform.localScale    = new Vector3(sx, sy, sz);
                    Debug.Log($"[Arsist] VRM pos(-x,y,z): ({px},{py},{pz})->({-px},{py},{pz}) rot({rx},{ry},{rz}) scale({sx},{sy},{sz})");
                }
                else
                {
                    // primitive / model(GLB) / light / canvas / text 等: 全同一変換
                    // Position: X 反転
                    go.transform.localPosition = new Vector3(-px, py, pz);

                    // Rotation: X 軸鏡像 Quaternion
                    var q  = Quaternion.Euler(rx, ry, rz);
                    var qm = new Quaternion(-q.x, q.y, q.z, -q.w);
                    go.transform.localRotation = qm;

                    go.transform.localScale = new Vector3(sx, sy, sz);
                    Debug.Log($"[Arsist] {type} pos(-x,y,z): ({px},{py},{pz})->({-px},{py},{pz}) rot({rx},{ry},{rz})->q({qm.x:F3},{qm.y:F3},{qm.z:F3},{qm.w:F3}) scale({sx},{sy},{sz})");
                }
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

            // VRM 以外のオブジェクトに ArsistObjectRegistrar を追加
            // VRM は ArsistVRMLoaderTask が登録を担うため不要
            if (type != "vrm")
            {
                var registrarType = System.Type.GetType("Arsist.Runtime.Scene.ArsistObjectRegistrar, Assembly-CSharp");
                if (registrarType != null)
                {
                    var registrar = go.AddComponent(registrarType);
                    var assetIdField = registrarType.GetField("assetId", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
                    if (assetIdField != null)
                    {
                        assetIdField.SetValue(registrar, assetId);
                        Debug.Log($"[Arsist] ArsistObjectRegistrar added to '{name}' with assetId='{assetId}'");
                    }
                }
                else
                {
                    Debug.LogWarning($"[Arsist] ArsistObjectRegistrar type not found. Object '{name}' will not be registered at runtime.");
                }
            }

            return go;
        }

        /// <summary>
        /// VRM モデルをランタイムロード用に設定
        /// ビルド時はプレースホルダーを作成し、ランタイムに ArsistVRMLoader が実際のロードを行う
        /// </summary>
        private static GameObject CreateVRMGameObject(string name, string vrmPath, string assetId)
        {
            var go = new GameObject(name);

            // ランタイムでロード開始するコンポーネントを追加
            // VRM ファイルは StreamingAssets/VRM にコピーされている
            bool configured = TryConfigureRuntimeVRMLoader(go, vrmPath, assetId);
            
            if (configured)
            {
                Debug.Log($"[Arsist] VRM loader configured for: {name} (assetId: {assetId}, path: {vrmPath})");
            }
            else
            {
                Debug.LogWarning($"[Arsist] Failed to configure VRM loader for: {name}");
            }

            return go;
        }

        private static bool TryConfigureRuntimeVRMLoader(GameObject go, string vrmPath, string assetId)
        {
            try
            {
                // ArsistVRMLoaderTask コンポーネントを作成
                // これはランタイムに ArsistVRMLoader を使用して VRM をロード
                var comp = TryAddComponentByTypeName(go, "Arsist.Runtime.VRM.ArsistVRMLoaderTask");
                if (comp == null)
                {
                    Debug.LogWarning($"[Arsist] ArsistVRMLoaderTask not available, creating script behavior instead");
                    // フォールバック: ここで Monobehaviour を手作業で作成（エディタのみ）
                    return false;
                }

                var t = comp.GetType();
                
                // VRM ファイルパスを設定
                var pathField = t.GetField("vrmPath", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                if (pathField != null)
                {
                    pathField.SetValue(comp, vrmPath);
                }
                
                // Asset ID を設定
                var assetIdField = t.GetField("assetId", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                if (assetIdField != null)
                {
                    assetIdField.SetValue(comp, assetId);
                }

                return true;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to configure VRM loader: {e.Message}");
                return false;
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

        /// <summary>
        /// Import TMP Essential Resources using reflection to call internal TMP method
        /// </summary>
        [MenuItem("Arsist/Import TMP Essential Resources")]
        public static void ImportTMPEssentialResources()
        {
            try
            {
                Debug.Log("[Arsist] Attempting to import TMP Essential Resources...");
                
                // Use reflection to call TMP's internal import method
                var tmpSettingsType = typeof(TMPro.TMP_Settings);
                var importMethod = tmpSettingsType.GetMethod("ImportProjectResourcesMenu", 
                    System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public);
                
                if (importMethod != null)
                {
                    importMethod.Invoke(null, null);
                    Debug.Log("[Arsist] ✅ TMP Essential Resources import triggered");
                    AssetDatabase.Refresh();
                }
                else
                {
                    Debug.LogWarning("[Arsist] Could not find TMP import method via reflection");
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Arsist] Failed to import TMP resources: {ex.Message}");
            }
        }

        /// <summary>
        /// TextMeshPro のデフォルトフォントアセットを確保。
        /// TMP は Resources/Fonts & Materials/ にデフォルトフォントが必要。
        /// </summary>
        private static void EnsureTextMeshProResources()
        {
            try
            {
                Debug.Log("[Arsist] ========== TMP RESOURCE SETUP START ==========");
                
                // Import JKG-M3.unitypackage if it exists
                // Try multiple possible locations for the package
                string packagePath = null;
                var possiblePaths = new[]
                {
                    Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "..", "sdk", "JKG-M3.unitypackage")),
                    Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "sdk", "JKG-M3.unitypackage")),
                    @"E:\GITS\Arsist\sdk\JKG-M3.unitypackage"
                };
                
                foreach (var path in possiblePaths)
                {
                    Debug.Log($"[Arsist] Checking for package at: {path}");
                    if (File.Exists(path))
                    {
                        packagePath = path;
                        break;
                    }
                }
                
                if (File.Exists(packagePath))
                {
                    Debug.Log($"[Arsist] Found TMP font package at: {packagePath}");
                    Debug.Log("[Arsist] Importing JKG-M3.unitypackage...");
                    
                    try
                    {
                        AssetDatabase.ImportPackage(packagePath, false);
                        Debug.Log("[Arsist] ✅ Successfully imported JKG-M3.unitypackage");
                        
                        // Force multiple refreshes to ensure assets are fully imported
                        AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                        AssetDatabase.SaveAssets();
                        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                        
                        Debug.Log("[Arsist] Asset database refreshed after package import");
                    }
                    catch (Exception ex)
                    {
                        Debug.LogWarning($"[Arsist] Failed to import package: {ex.Message}");
                    }
                }
                else
                {
                    Debug.LogWarning($"[Arsist] JKG-M3.unitypackage not found");
                    // Try to import TMP Essential Resources as fallback
                    ImportTMPEssentialResources();
                }
                
                // Final refresh before searching for fonts
                AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                
                // Resources フォルダを作成
                var resourcesPath = "Assets/Resources";
                if (!AssetDatabase.IsValidFolder(resourcesPath))
                {
                    AssetDatabase.CreateFolder("Assets", "Resources");
                    Debug.Log("[Arsist] Created Resources folder");
                }

                // 既に Resources にフォントがあるかチェック
                var tmpFont = AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>("Assets/Resources/LiberationSans SDF.asset");
                
                if (tmpFont == null)
                {
                    Debug.Log("[Arsist] Font not in Resources, searching for it...");

                    // Prefer explicitly provided font asset from sdk package extraction
                    var providedFont = AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>("Assets/JKG-M_3 SDF.asset");
                    if (providedFont != null)
                    {
                        Debug.Log("[Arsist] Found provided TMP font at Assets/JKG-M_3 SDF.asset");
                        var targetPath = "Assets/Resources/LiberationSans SDF.asset";
                        try
                        {
                            if (!AssetDatabase.CopyAsset("Assets/JKG-M_3 SDF.asset", targetPath))
                            {
                                Debug.LogWarning("[Arsist] CopyAsset returned false for provided font, trying direct load fallback");
                            }

                            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                            tmpFont = AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>(targetPath) ?? providedFont;
                        }
                        catch (Exception ex)
                        {
                            Debug.LogWarning($"[Arsist] Failed to copy provided font: {ex.Message}");
                            tmpFont = providedFont;
                        }
                    }

                    if (tmpFont != null)
                    {
                        Debug.Log($"[Arsist] ✅ Using provided TMP font: {tmpFont.name}");
                    }
                    else
                    {
                    
                    // First, search for JKG-M_3 SDF font (from imported package)
                    var fontGuids = AssetDatabase.FindAssets("JKG t:TMP_FontAsset");
                    
                    if (fontGuids.Length == 0)
                    {
                        Debug.Log("[Arsist] JKG-M_3 SDF not found, searching for LiberationSans SDF...");
                        fontGuids = AssetDatabase.FindAssets("LiberationSans SDF t:TMP_FontAsset", new[] { "Packages/com.unity.textmeshpro" });
                    }
                    
                    if (fontGuids.Length == 0)
                    {
                        Debug.Log("[Arsist] Not found in Packages/com.unity.textmeshpro, searching Packages/com.unity.ugui/Runtime/TMP...");
                        fontGuids = AssetDatabase.FindAssets("LiberationSans SDF t:TMP_FontAsset", new[] { "Packages/com.unity.ugui/Runtime/TMP" });
                    }
                    
                    if (fontGuids.Length == 0)
                    {
                        Debug.Log("[Arsist] Not found in packages, searching entire project for ANY TMP font...");
                        fontGuids = AssetDatabase.FindAssets("t:TMP_FontAsset", new[] { "Assets" });
                    }
                    
                    if (fontGuids.Length > 0)
                    {
                        var existingFontPath = AssetDatabase.GUIDToAssetPath(fontGuids[0]);
                        Debug.Log($"[Arsist] Found font at: {existingFontPath}");
                        
                        var targetPath = "Assets/Resources/LiberationSans SDF.asset";
                        try
                        {
                            AssetDatabase.CopyAsset(existingFontPath, targetPath);
                            Debug.Log($"[Arsist] Copied font to {targetPath}");
                            
                            AssetDatabase.Refresh();
                            tmpFont = AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>(targetPath);
                            
                            if (tmpFont != null)
                            {
                                Debug.Log($"[Arsist] ✅ Successfully loaded TMP font: {tmpFont.name}");
                            }
                            else
                            {
                                Debug.LogError("[Arsist] ❌ Failed to load copied font");
                            }
                        }
                        catch (Exception ex)
                        {
                            Debug.LogError($"[Arsist] Failed to copy font: {ex.Message}");
                        }
                    }
                    else
                    {
                        Debug.LogWarning("[Arsist] ⚠️ LiberationSans SDF font not found. Searching for any available TMP font asset...");
                        
                        // Search for ANY TMP font asset in the entire project
                        var allFontGuids = AssetDatabase.FindAssets("t:TMP_FontAsset");
                        if (allFontGuids.Length > 0)
                        {
                            var firstFontPath = AssetDatabase.GUIDToAssetPath(allFontGuids[0]);
                            Debug.Log($"[Arsist] Found TMP font at: {firstFontPath}");
                            
                            var targetPath = "Assets/Resources/LiberationSans SDF.asset";
                            try
                            {
                                AssetDatabase.CopyAsset(firstFontPath, targetPath);
                                Debug.Log($"[Arsist] Copied available TMP font to {targetPath}");
                                
                                AssetDatabase.Refresh();
                                tmpFont = AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>(targetPath);
                                
                                if (tmpFont != null)
                                {
                                    Debug.Log($"[Arsist] ✅ Successfully loaded fallback TMP font: {tmpFont.name}");
                                }
                                else
                                {
                                    Debug.LogError("[Arsist] ❌ Failed to load copied font");
                                }
                            }
                            catch (Exception ex)
                            {
                                Debug.LogError($"[Arsist] Failed to copy available font: {ex.Message}");
                            }
                        }
                        else
                        {
                            Debug.LogWarning("[Arsist] ⚠️ No TMP font asset found in project.");
                            Debug.LogWarning("[Arsist] Searching for TTF fonts in Assets/Fonts...");
                            
                            // Search for TTF fonts in the project
                            var ttfFontGuids = AssetDatabase.FindAssets("t:Font", new[] { "Assets/Fonts" });
                            if (ttfFontGuids.Length > 0)
                            {
                                var fontPath = AssetDatabase.GUIDToAssetPath(ttfFontGuids[0]);
                                Debug.Log($"[Arsist] Found TTF font at: {fontPath}");
                                
                                // Force reimport to ensure "Include Font Data" is enabled
                                var importer = AssetImporter.GetAtPath(fontPath) as TrueTypeFontImporter;
                                if (importer != null)
                                {
                                    importer.fontReferences = new Font[0];
                                    importer.SaveAndReimport();
                                    AssetDatabase.Refresh();
                                }
                                
                                var arialFont = AssetDatabase.LoadAssetAtPath<Font>(fontPath);
                                
                                if (arialFont != null)
                                {
                                    Debug.Log($"[Arsist] Loaded font: {arialFont.name}");
                                    Debug.Log("[Arsist] Creating TMP font asset...");
                                    
                                    try
                                    {
                                        // Create TMP font asset
                                        var tmpFontAsset = TMPro.TMP_FontAsset.CreateFontAsset(arialFont, 90, 9, UnityEngine.TextCore.LowLevel.GlyphRenderMode.SDFAA, 1024, 1024);
                                        
                                        if (tmpFontAsset != null)
                                        {
                                            var targetPath = "Assets/Resources/LiberationSans SDF.asset";
                                            AssetDatabase.CreateAsset(tmpFontAsset, targetPath);
                                            AssetDatabase.SaveAssets();
                                            AssetDatabase.Refresh();
                                            
                                            tmpFont = AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>(targetPath);
                                            Debug.Log("[Arsist] ✅ Created TMP font from TTF and saved to Resources");
                                        }
                                        else
                                        {
                                            Debug.LogError("[Arsist] ❌ Failed to create TMP font from TTF");
                                        }
                                    }
                                    catch (Exception ex)
                                    {
                                        Debug.LogError($"[Arsist] Exception creating TMP font: {ex.Message}");
                                    }
                                }
                                else
                                {
                                    Debug.LogError("[Arsist] ❌ Failed to load TTF font asset");
                                }
                            }
                            else
                            {
                                Debug.LogError("[Arsist] ❌ No TTF fonts found in Assets/Fonts");
                                Debug.LogError("[Arsist] Please add a TTF font file to Assets/Fonts folder");
                            }
                        }
                    }
                    }
                }
                
                if (tmpFont == null)
                {
                    Debug.LogError("[Arsist] ❌ CRITICAL: No TMP font could be copied to Resources!");
                    Debug.LogError("[Arsist] Text rendering will fail. Please install TextMeshPro Essential Resources.");
                }
                else
                {
                    Debug.Log($"[Arsist] ✅ Font already in Resources: {tmpFont.name}");

                    // Root fix: ensure TMP Settings has a default font so TextMeshProUGUI.Awake won't null-reference
                    EnsureTmpSettingsDefaultFont(tmpFont);
                }

                // マテリアルもコピー
                if (tmpFont != null && tmpFont.material != null)
                {
                    var matPath = "Assets/Resources/LiberationSans SDF - Material.mat";
                    var existingMat = AssetDatabase.LoadAssetAtPath<Material>(matPath);
                    if (existingMat == null)
                    {
                        var sourceMaterialPath = AssetDatabase.GetAssetPath(tmpFont.material);
                        if (!string.IsNullOrEmpty(sourceMaterialPath))
                        {
                            try
                            {
                                AssetDatabase.CopyAsset(sourceMaterialPath, matPath);
                                Debug.Log($"[Arsist] Copied TMP material to Resources");
                            }
                            catch (Exception ex)
                            {
                                Debug.LogWarning($"[Arsist] Failed to copy material: {ex.Message}");
                            }
                        }
                    }
                }

                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh();
                Debug.Log("[Arsist] ========== TMP RESOURCE SETUP COMPLETE ==========");
                
                // Verify the font is actually loadable
                var verifyFont = Resources.Load<TMP_FontAsset>("LiberationSans SDF");
                if (verifyFont != null)
                {
                    Debug.Log($"[Arsist] ✅ VERIFIED: Font is loadable from Resources: {verifyFont.name}");
                }
                else
                {
                    Debug.LogError("[Arsist] ❌ VERIFICATION FAILED: Font not loadable from Resources!");
                }

                try
                {
                    var verifySettings = Resources.Load<TMP_Settings>("TMP Settings");
                    TMP_FontAsset verifyDefaultFont = null;
                    if (verifySettings != null)
                    {
                        var verifySo = new SerializedObject(verifySettings);
                        var verifyFontProp = verifySo.FindProperty("m_defaultFontAsset");
                        verifyDefaultFont = verifyFontProp?.objectReferenceValue as TMP_FontAsset;
                    }

                    if (verifySettings != null && verifyDefaultFont != null)
                    {
                        Debug.Log($"[Arsist] ✅ VERIFIED: TMP Settings default font = {verifyDefaultFont.name}");
                    }
                    else
                    {
                        Debug.LogError("[Arsist] ❌ VERIFICATION FAILED: TMP Settings default font is null");
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[Arsist] Failed to verify TMP Settings: {ex.Message}");
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[Arsist] Failed to setup TextMeshPro resources: {e.Message}\n{e.StackTrace}");
            }
        }

        /// <summary>
        /// UniVRM unitypackage を自動インポート（存在する場合）
        /// </summary>
        private static void EnsureUniVRMResources()
        {
            try
            {
                var candidateRoots = new[]
                {
                    Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "..", "sdk")),
                    Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "sdk")),
                    @"E:\GITS\Arsist\sdk"
                };

                var sdkRoot = candidateRoots.FirstOrDefault(Directory.Exists);
                if (string.IsNullOrEmpty(sdkRoot))
                {
                    Debug.LogWarning("[Arsist] SDK root not found. Skip UniVRM auto import.");
                    return;
                }

                var packages = Directory.GetFiles(sdkRoot, "UniVRM-*.unitypackage", SearchOption.TopDirectoryOnly);
                if (packages == null || packages.Length == 0)
                {
                    Debug.LogWarning("[Arsist] UniVRM unitypackage not found in sdk. VRM runtime load may fail.");
                    return;
                }

                var packagePath = packages
                    .OrderByDescending(File.GetLastWriteTimeUtc)
                    .FirstOrDefault();

                if (string.IsNullOrEmpty(packagePath) || !File.Exists(packagePath))
                {
                    Debug.LogWarning("[Arsist] UniVRM package candidate was not found.");
                    return;
                }

                // 既にインポート済みならスキップ
                var importerType = AppDomain.CurrentDomain.GetAssemblies()
                    .Select(a => a.GetType("VRM.VRMImporterContext"))
                    .FirstOrDefault(t => t != null);

                if (importerType != null)
                {
                    Debug.Log("[Arsist] UniVRM already available. Skip package import.");
                    return;
                }

                Debug.Log($"[Arsist] Importing UniVRM package: {packagePath}");
                AssetDatabase.ImportPackage(packagePath, false);
                AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                Debug.Log("[Arsist] ✅ UniVRM package import completed");
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[Arsist] Failed to import UniVRM package: {ex.Message}");
            }
        }

        private static void EnsureTmpSettingsDefaultFont(TMP_FontAsset defaultFont)
        {
            if (defaultFont == null) return;

            try
            {
                const string settingsPath = "Assets/Resources/TMP Settings.asset";
                var settings = AssetDatabase.LoadAssetAtPath<TMP_Settings>(settingsPath);

                if (settings == null)
                {
                    settings = ScriptableObject.CreateInstance<TMP_Settings>();
                    AssetDatabase.CreateAsset(settings, settingsPath);
                    Debug.Log("[Arsist] Created TMP Settings.asset in Resources");
                }

                var so = new SerializedObject(settings);
                var defaultFontProp = so.FindProperty("m_defaultFontAsset");
                if (defaultFontProp == null)
                {
                    Debug.LogError("[Arsist] TMP Settings property m_defaultFontAsset not found");
                    return;
                }

                defaultFontProp.objectReferenceValue = defaultFont;
                so.ApplyModifiedPropertiesWithoutUndo();

                EditorUtility.SetDirty(settings);
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);

                Debug.Log($"[Arsist] TMP Settings default font set to: {defaultFont.name}");
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Arsist] Failed to configure TMP Settings default font: {ex.Message}");
            }
        }

        /// <summary>
        /// TMPフォントアセットをStreamingAssetsにコピーしてランタイムで読み込めるようにする
        /// </summary>
        private static void CopyTmpFontToStreamingAssets()
        {
            try
            {
                Debug.Log("[Arsist] ========== COPYING TMP FONT TO STREAMING ASSETS ==========");
                
                // StreamingAssets/Fonts フォルダを作成
                var streamingAssetsPath = "Assets/StreamingAssets";
                var fontsPath = Path.Combine(streamingAssetsPath, "Fonts");
                
                if (!Directory.Exists(streamingAssetsPath))
                {
                    Directory.CreateDirectory(streamingAssetsPath);
                    AssetDatabase.Refresh();
                }
                
                if (!Directory.Exists(fontsPath))
                {
                    Directory.CreateDirectory(fontsPath);
                    AssetDatabase.Refresh();
                }
                
                // Resources フォルダからフォントを探す
                var resourceFont = Resources.Load<TMP_FontAsset>("LiberationSans SDF");
                
                if (resourceFont != null)
                {
                    var sourcePath = AssetDatabase.GetAssetPath(resourceFont);
                    var targetPath = Path.Combine(fontsPath, "LiberationSans SDF.asset");
                    
                    Debug.Log($"[Arsist] Copying font from: {sourcePath}");
                    Debug.Log($"[Arsist] Copying font to: {targetPath}");
                    
                    // アセットをコピー
                    AssetDatabase.CopyAsset(sourcePath, targetPath);
                    
                    // マテリアルもコピー
                    if (resourceFont.material != null)
                    {
                        var matSourcePath = AssetDatabase.GetAssetPath(resourceFont.material);
                        var matTargetPath = Path.Combine(fontsPath, "LiberationSans SDF - Material.mat");
                        AssetDatabase.CopyAsset(matSourcePath, matTargetPath);
                        Debug.Log($"[Arsist] Copied material to: {matTargetPath}");
                    }
                    
                    // アトラステクスチャもコピー
                    if (resourceFont.atlasTexture != null)
                    {
                        var texSourcePath = AssetDatabase.GetAssetPath(resourceFont.atlasTexture);
                        var texTargetPath = Path.Combine(fontsPath, "LiberationSans SDF Atlas.png");
                        AssetDatabase.CopyAsset(texSourcePath, texTargetPath);
                        Debug.Log($"[Arsist] Copied atlas texture to: {texTargetPath}");
                    }
                    
                    AssetDatabase.Refresh();
                    Debug.Log("[Arsist] ✅ TMP font copied to StreamingAssets successfully");
                }
                else
                {
                    Debug.LogError("[Arsist] ❌ No TMP font found in Resources! Cannot copy to StreamingAssets.");
                }
                
                Debug.Log("[Arsist] ========== STREAMING ASSETS COPY COMPLETE ==========");
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Arsist] Failed to copy TMP font to StreamingAssets: {ex.Message}\n{ex.StackTrace}");
            }
        }

        private static void LoadDefaultTmpAssets()
        {
            // Cache to avoid repeated loads
            if (_defaultTmpFont != null && _defaultTmpMaterial != null) return;

            Debug.Log("[Arsist] ========== LOADING TMP FONT ASSETS ==========");
            Debug.Log("[Arsist] NOTE: Unity 6 does not include TMP fonts in packages by default.");
            Debug.Log("[Arsist] Font assignment will be handled by CanvasInitializer at runtime.");
            
            // Try to find ANY TMP font in the project
            var allFontGuids = AssetDatabase.FindAssets("t:TMP_FontAsset");
            Debug.Log($"[Arsist] Found {allFontGuids.Length} TMP fonts in entire project");
            
            if (allFontGuids.Length > 0)
            {
                var fontPath = AssetDatabase.GUIDToAssetPath(allFontGuids[0]);
                _defaultTmpFont = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(fontPath);
                if (_defaultTmpFont != null)
                {
                    _defaultTmpMaterial = _defaultTmpFont.material;
                    Debug.Log($"[Arsist] ✅ Found TMP font at build time: {_defaultTmpFont.name}");
                    Debug.Log($"[Arsist] ✅ Font path: {fontPath}");
                    Debug.Log($"[Arsist] ========== TMP FONT LOAD SUCCESS ==========");
                    return;
                }
            }

            // No font found at build time - this is EXPECTED in Unity 6
            Debug.LogWarning("[Arsist] ========== NO TMP FONT AT BUILD TIME ==========");
            Debug.LogWarning("[Arsist] ⚠️ No TMP font found during build (expected in Unity 6).");
            Debug.LogWarning("[Arsist] ✅ Font will be assigned at RUNTIME by CanvasInitializer.");
            Debug.LogWarning("[Arsist] ✅ CanvasInitializer will load from StreamingAssets.");
            Debug.LogWarning("[Arsist] ========================================");
            
            // Set to null explicitly - CanvasInitializer will handle it
            _defaultTmpFont = null;
            _defaultTmpMaterial = null;
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

                // 必要なシェーダー名リスト (Standard removed to prevent timeout)
                // TextMeshPro shaders are explicitly listed to avoid stripping
                var requiredShaders = new[]
                {
                    "Unlit/Color",
                    "Unlit/Texture",
                    "Unlit/Transparent",
                    "UI/Default",
                    "Sprites/Default",
                    "TextMeshPro/Distance Field",
                    "TextMeshPro/Distance Field Overlay",
                    "TextMeshPro/Mobile/Distance Field",
                    "TextMeshPro/Mobile/Distance Field - Overlay",
                    "TextMeshPro/Sprite",
                    "TextMeshPro/Mobile/Bitmap",
                };

                // 既に含まれているシェーダーを収集
                var existingGuids = new HashSet<string>();
                for (int i = 0; i < arrayProp.arraySize; i++)
                {
                    var elem = arrayProp.GetArrayElementAtIndex(i);
                    var shader = elem.objectReferenceValue as Shader;
                    if (shader != null) existingGuids.Add(shader.name);
                }

                // 必要なシェーダーを追加
                int added = 0;
                foreach (var shaderName in requiredShaders)
                {
                    if (existingGuids.Contains(shaderName)) continue;

                    var shader = Shader.Find(shaderName);
                    if (shader != null)
                    {
                        arrayProp.InsertArrayElementAtIndex(arrayProp.arraySize);
                        var newElem = arrayProp.GetArrayElementAtIndex(arrayProp.arraySize - 1);
                        newElem.objectReferenceValue = shader;
                        added++;
                        Debug.Log($"[Arsist] Added shader: {shaderName}");
                    }
                    else
                    {
                        Debug.LogWarning($"[Arsist] Shader not found: {shaderName}");
                    }
                }
                
                // TextMeshPro シェーダーを AssetDatabase から検索して追加（パッケージとSDKフォールバック両方）
                var tmpShaderSearchRoots = new[]
                {
                    "Packages/com.unity.textmeshpro",
                    "Assets/ArsistProjectAssets/sdk/quest/Unity-InteractionSDK-Samples/Assets/TextMesh Pro"
                };

                foreach (var root in tmpShaderSearchRoots)
                {
                    var tmpShaderGuids = AssetDatabase.FindAssets("t:Shader", new[] { root });
                    foreach (var guid in tmpShaderGuids)
                    {
                        var path = AssetDatabase.GUIDToAssetPath(guid);
                        var shader = AssetDatabase.LoadAssetAtPath<Shader>(path);
                        if (shader != null && !existingGuids.Contains(shader.name))
                        {
                            arrayProp.InsertArrayElementAtIndex(arrayProp.arraySize);
                            var newElem = arrayProp.GetArrayElementAtIndex(arrayProp.arraySize - 1);
                            newElem.objectReferenceValue = shader;
                            existingGuids.Add(shader.name);
                            added++;
                            Debug.Log($"[Arsist] Added TMP shader: {shader.name}");
                        }
                    }
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

        private static void EnsureWebSocketServerInScene(JObject manifest)
        {
            try
            {
                // arSettings.enableRemoteControl が明示的に true の場合のみ追加する
                // デフォルトは false （セキュリティ上、未選択時は起動しない）
                var enabled = manifest.SelectToken("arSettings.enableRemoteControl")?.Value<bool>() ?? false;
                if (!enabled) return;

                // VRM が存在しないプロジェクトでは追加しない
                var hasVrm = manifest.SelectTokens("scenes[*].objects[*].type")
                    .Any(t => string.Equals(t?.ToString(), "vrm", StringComparison.OrdinalIgnoreCase));
                if (!hasVrm)
                {
                    Debug.Log("[Arsist] WebSocket remote control skipped: no VRM object found in scenes.");
                    return;
                }

                var port = manifest.SelectToken("arSettings.remoteControlPort")?.Value<int>() ?? 8765;
                var password = manifest.SelectToken("arSettings.remoteControlPassword")?.Value<string>() ?? string.Empty;

                var go = GameObject.Find("ArsistWebSocketServer");
                if (go == null) go = new GameObject("ArsistWebSocketServer");

                var serverType = System.Type.GetType("Arsist.Runtime.Network.ArsistWebSocketServer, Assembly-CSharp");
                if (serverType != null && go.GetComponent(serverType) == null)
                {
                    var comp = go.AddComponent(serverType);
                    // ポートを設定
                    var portField = serverType.GetField("port", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                    portField?.SetValue(comp, port);
                    // autoStart を常に true（ビルド内包時のみ追加されるので常に起動する）
                    var autoStartField = serverType.GetField("autoStart", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                    autoStartField?.SetValue(comp, true);
                    // 任意の認証パスワード
                    var passwordField = serverType.GetField("password", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                    passwordField?.SetValue(comp, password);

                    Debug.Log($"[Arsist] WebSocket remote control server added (port: {port}, auth: {(string.IsNullOrEmpty(password) ? "none" : "enabled")})");
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to ensure WebSocket server in scene: {e.Message}");
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
                
                var cam = mainCamera.AddComponent<Camera>();
                // Critical: Configure camera for proper WorldSpace Canvas rendering
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0f, 0f, 0f, 0f); // Transparent for AR
                cam.cullingMask = -1; // Everything
                cam.depth = 0; // Main camera renders first
                cam.nearClipPlane = 0.1f;
                cam.farClipPlane = 1000f;
                
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

            if (IsQuestTargetDevice())
            {
                EnsureQuestOvrManager(xrOrigin);
            }

            // AR Session (AR Foundation) - XREAL のみ必要
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
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(importedPath);
                if (prefab != null)
                {
                    // **CRITICAL: Use wrapper pattern**
                    // glTFast bakes coordinate conversion into the prefab's internal nodes.
                    // We MUST NOT touch the prefab instance's own transform.
                    // User transform (from Three.js right-handed space) is applied to the
                    // wrapper after RH→LH coordinate conversion in CreateGameObject.
                    var wrapper = new GameObject(name);
                    var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                    instance.name = name + "_GLBRoot";
                    // worldPositionStays=false: preserves glTFast's baked local transform
                    instance.transform.SetParent(wrapper.transform, false);
                    Debug.Log($"[Arsist] Model imported with wrapper: {importedPath}");
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

            // Canvas は「表示位置のアンカー」としてのみ使用する。
            // 固定の板(Quad)は視認性を悪化させるため作らない。

            // World-space Canvas
            var canvasGO = new GameObject("UISurfaceCanvas");
            canvasGO.transform.SetParent(root.transform, false);
            
            // FIX 10: Force UI layer assignment
            int uiLayer = LayerMask.NameToLayer("UI");
            if (uiLayer < 0) uiLayer = 5; // Default UI layer
            canvasGO.layer = uiLayer;
            
            var canvas = canvasGO.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.sortingOrder = 200;
            
            // FIX 11: Add CanvasInitializer to ensure runtime setup (including worldCamera assignment)
            TryAddComponentByTypeName(canvasGO, "Arsist.Runtime.UI.CanvasInitializer");

            var canvasScaler = canvasGO.AddComponent<UnityEngine.UI.CanvasScaler>();
            canvasScaler.dynamicPixelsPerUnit = pixelsPerUnit;
            canvasGO.AddComponent<UnityEngine.UI.GraphicRaycaster>();

            var rect = canvasGO.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(width * pixelsPerUnit, height * pixelsPerUnit);
            rect.localScale = Vector3.one / pixelsPerUnit;
            rect.localPosition = Vector3.zero;
            rect.localRotation = Quaternion.identity;

            var canvasGroup = canvasGO.GetComponent<CanvasGroup>();
            if (canvasGroup == null)
            {
                canvasGroup = canvasGO.AddComponent<CanvasGroup>();
            }
            canvasGroup.alpha = 1f;
            canvasGroup.interactable = true;
            canvasGroup.blocksRaycasts = true;
            
            // FIX 12: Ensure Canvas is active
            canvasGO.SetActive(true);
            root.SetActive(true);

            EnsureUILayoutCache();
            Debug.Log($"[Arsist] ========== CANVAS TEXT DEBUG START ==========");
            Debug.Log($"[Arsist] Canvas '{name}' layoutId: '{layoutId}'");
            Debug.Log($"[Arsist] Available layouts in cache: [{string.Join(", ", _uiLayoutCache?.Keys.ToList() ?? new List<string>())}]");
            Debug.Log($"[Arsist] _uiLayoutCache is null: {_uiLayoutCache == null}");
            Debug.Log($"[Arsist] layoutId is empty: {string.IsNullOrEmpty(layoutId)}");
            
            if (!string.IsNullOrEmpty(layoutId) && _uiLayoutCache != null && _uiLayoutCache.TryGetValue(layoutId, out var layout))
            {
                var rootEl = layout["root"] as JObject;
                if (rootEl != null)
                {
                    Debug.Log($"[Arsist] ✅ Found layout root for '{layoutId}'");
                    Debug.Log($"[Arsist] Root element type: {rootEl["type"]}");
                    Debug.Log($"[Arsist] Root element JSON: {rootEl.ToString()}");
                    Debug.Log($"[Arsist] Calling CreateUIElement for root...");
                    CreateUIElement(rootEl, canvasGO.transform);
                    Debug.Log($"[Arsist] ✅ CreateUIElement completed for layout '{layoutId}'");
                }
                else
                {
                    Debug.LogError($"[Arsist] ❌ UI layout root is NULL for layoutId: {layoutId}");
                    Debug.LogError($"[Arsist] Layout JSON: {layout.ToString()}");
                    // Create fallback UI
                    CreateFallbackUI(canvasGO.transform, layoutId);
                }
            }
            else
            {
                Debug.LogError($"[Arsist] ❌ UI layout NOT FOUND in cache for layoutId: '{layoutId}'");
                Debug.LogError($"[Arsist] Cache has {_uiLayoutCache?.Count ?? 0} layouts");
                if (_uiLayoutCache != null)
                {
                    foreach (var key in _uiLayoutCache.Keys)
                    {
                        Debug.LogError($"[Arsist]   - Cache key: '{key}'");
                    }
                }
                // Create fallback UI
                CreateFallbackUI(canvasGO.transform, layoutId ?? "missing");
            }
            Debug.Log($"[Arsist] ========== CANVAS TEXT DEBUG END ==========");
            
            return root;
        }

        private static void CreateFallbackUI(Transform parent, string reason)
        {
            Debug.Log($"[Arsist] Creating fallback UI for reason: {reason}");
            
            var fallbackRoot = new JObject
            {
                ["id"] = Guid.NewGuid().ToString(),
                ["type"] = "Text",
                ["content"] = $"Fallback UI ({reason})",
                ["layout"] = "Absolute",
                ["style"] = new JObject
                {
                    ["width"] = 800,
                    ["height"] = 200,
                    ["top"] = 100,
                    ["left"] = 100,
                    ["fontSize"] = 96,
                    ["color"] = "#FFFF00",
                    ["textAlign"] = "center",
                },
                ["children"] = new JArray()
            };
            
            CreateUIElement(fallbackRoot, parent);
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
            // Arsist Runtime Manager を追加
            var managerGO = new GameObject("[ArsistRuntimeManager]");
            TryAddComponentByTypeName(managerGO, "Arsist.Runtime.ArsistRuntimeManager");
            
            // Data Store
            var dataStoreGO = new GameObject("[ArsistDataStore]");
            TryAddComponentByTypeName(dataStoreGO, "Arsist.Runtime.DataFlow.ArsistDataStore");
            
            // Event Bus
            var eventBusGO = new GameObject("[ArsistEventBus]");
            TryAddComponentByTypeName(eventBusGO, "Arsist.Runtime.Events.ArsistEventBus");
            
            // UI Manager
            var uiManagerGO = new GameObject("[ArsistUIManager]");
            TryAddComponentByTypeName(uiManagerGO, "Arsist.Runtime.UI.ArsistUIManager");
            
            // Note: Canvas visibility and font fixes are handled at build time in GenerateCanvasUI and CreateUIElement
            
            // Script Engine: manifest フラグまたは scripts.json が存在すれば有効化
            var scriptingEnabled = manifest?["scripting"]?["enabled"]?.Value<bool>() ?? false;
            var remoteControlEnabled = manifest?["arSettings"]?["enableRemoteControl"]?.Value<bool>() ?? false;
            if (!scriptingEnabled)
            {
                var scriptsPath = Path.Combine(Application.dataPath, "ArsistGenerated", "scripts.json");
                if (File.Exists(scriptsPath))
                {
                    var scriptsJson = File.ReadAllText(scriptsPath);
                    var scriptsObj = JObject.Parse(scriptsJson);
                    var scripts = scriptsObj["scripts"] as JArray;
                    scriptingEnabled = scripts != null && scripts.Count > 0;
                }
            }

            // WebSocket remote control は ScriptEngineManager に依存するため、
            // リモート制御有効時はスクリプト機能OFFでもランタイムを生成する。
            scriptingEnabled = scriptingEnabled || remoteControlEnabled;

            if (scriptingEnabled)
            {
                var scriptEngineGO = new GameObject("[ArsistScriptEngine]");
                scriptEngineGO.AddComponent<ScriptEngineManager>();
                Debug.Log("[Arsist] ScriptEngineManager component attached.");
                
                var triggerManagerGO = new GameObject("[ArsistScriptTriggerManager]");
                triggerManagerGO.AddComponent<ScriptTriggerManager>();
                Debug.Log("[Arsist] ScriptTriggerManager component attached.");
                
                var coroutineRunnerGO = new GameObject("[ArsistCoroutineRunner]");
                coroutineRunnerGO.AddComponent<CoroutineRunner>();
                Debug.Log("[Arsist] CoroutineRunner component attached.");
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
                foreach (var srcPath in Directory.GetFiles(uiCodeDir, "*", SearchOption.AllDirectories))
                {
                    var relative = srcPath.Substring(uiCodeDir.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                    var dstPath = Path.Combine(streamingUIDir, relative);
                    var dstDir = Path.GetDirectoryName(dstPath);
                    if (!string.IsNullOrEmpty(dstDir))
                    {
                        Directory.CreateDirectory(dstDir);
                    }
                    File.Copy(srcPath, dstPath, true);
                }

                Debug.Log($"[Arsist] Copied UI assets recursively: {uiCodeDir} -> {streamingUIDir}");

                AssetDatabase.Refresh();
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to copy UI code to StreamingAssets: {e.Message}");
            }
        }

        /// <summary>
        /// scripts.json を StreamingAssets/ArsistScripts/ にコピーしてランタイムで読み込めるようにする
        /// </summary>
        private static void CopyScriptsToStreamingAssets()
        {
            var srcPath = Path.Combine(Application.dataPath, "ArsistGenerated", "scripts.json");
            if (!File.Exists(srcPath))
            {
                Debug.Log("[Arsist] scripts.json not found in ArsistGenerated, skipping script copy.");
                return;
            }

            try
            {
                var dstDir = Path.Combine(Application.dataPath, "StreamingAssets", "ArsistScripts");
                Directory.CreateDirectory(dstDir);
                var dstPath = Path.Combine(dstDir, "scripts.json");
                File.Copy(srcPath, dstPath, overwrite: true);

                // フォールバック用: Resources にもコピー
                var resourcesDir = Path.Combine(Application.dataPath, "Resources");
                Directory.CreateDirectory(resourcesDir);
                var resourcesPath = Path.Combine(resourcesDir, "ArsistScripts.json");
                File.Copy(srcPath, resourcesPath, overwrite: true);

                AssetDatabase.Refresh();
                Debug.Log($"[Arsist] ✅ scripts.json copied to StreamingAssets/ArsistScripts/ and Resources/ArsistScripts.json");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Failed to copy scripts.json to StreamingAssets: {e.Message}");
            }
        }

        /// <summary>
        /// VRM ファイルを StreamingAssets にコピー
        /// </summary>
        private static void CopyVRMFilesToStreamingAssets(JArray scenes)
        {
            if (scenes == null || scenes.Count == 0) return;

            var vrmDir = Path.Combine(Application.dataPath, "StreamingAssets", "VRM");
            Directory.CreateDirectory(vrmDir);

            var vrmFiles = new HashSet<string>();

            // シーンのすべてのオブジェクトから VRM ファイルを収集
            foreach (var scene in scenes)
            {
                var sceneObj = scene as JObject;
                if (sceneObj == null) continue;

                var objects = sceneObj["objects"] as JArray;
                if (objects == null) continue;

                foreach (var obj in objects)
                {
                    var objData = obj as JObject;
                    if (objData == null) continue;

                    var type = objData["type"]?.ToString();
                    if (type == "vrm")
                    {
                        var modelPath = objData["modelPath"]?.ToString();
                        if (!string.IsNullOrEmpty(modelPath))
                        {
                            vrmFiles.Add(modelPath);
                        }
                    }
                }
            }

            var copiedCount = 0;

            // 各 VRM ファイルをコピー
            foreach (var vrmPath in vrmFiles)
            {
                try
                {
                    var requestedFileName = Path.GetFileName(vrmPath);
                    var possiblePaths = new[]
                    {
                        vrmPath,
                        Path.Combine(Application.dataPath, "..", vrmPath),
                        Path.Combine(Application.dataPath, "ArsistProjectAssets", vrmPath),
                        Path.Combine(Application.dataPath, "..", "ArsistProjectAssets", vrmPath),
                        Path.Combine(Application.dataPath, "ArsistProjectAssets", "Models", requestedFileName),
                        Path.Combine(Application.dataPath, "Models", requestedFileName),
                    };

                    string foundPath = null;
                    foreach (var p in possiblePaths)
                    {
                        if (File.Exists(p))
                        {
                            foundPath = p;
                            break;
                        }
                    }

                    // 直接パスで見つからない場合は、代表ディレクトリを再帰探索
                    if (string.IsNullOrEmpty(foundPath) && !string.IsNullOrEmpty(requestedFileName))
                    {
                        var searchRoots = new[]
                        {
                            Path.Combine(Application.dataPath, "ArsistProjectAssets"),
                            Path.Combine(Application.dataPath, "..", "ArsistProjectAssets"),
                            Path.Combine(Application.dataPath, "Models"),
                            Path.Combine(Application.dataPath, "..", "Assets", "Models"),
                        };

                        foreach (var root in searchRoots)
                        {
                            if (!Directory.Exists(root)) continue;
                            var matched = Directory.GetFiles(root, requestedFileName, SearchOption.AllDirectories);
                            if (matched != null && matched.Length > 0)
                            {
                                foundPath = matched[0];
                                break;
                            }
                        }
                    }

                    if (string.IsNullOrEmpty(foundPath))
                    {
                        Debug.LogWarning($"[Arsist] VRM file not found: {vrmPath}");
                        continue;
                    }

                    var fileName = Path.GetFileName(foundPath);
                    var destPath = Path.Combine(vrmDir, fileName);

                    File.Copy(foundPath, destPath, overwrite: true);
                    copiedCount++;
                    Debug.Log($"[Arsist] ✅ VRM file copied to StreamingAssets/VRM/: {fileName} (src={foundPath})");
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[Arsist] Failed to copy VRM file: {vrmPath} - {e.Message}");
                }
            }

            if (vrmFiles.Count > 0)
            {
                AssetDatabase.Refresh();
                Debug.Log($"[Arsist] ✅ {copiedCount}/{vrmFiles.Count} VRM file(s) copied to StreamingAssets");
            }
            else
            {
                Debug.Log("[Arsist] No VRM files to copy");
            }
        }

        private static void GenerateUI()
        {
            var uiPath = Path.Combine(Application.dataPath, "ArsistGenerated", "ui_layouts.json");
            if (File.Exists(uiPath))
            {
                Debug.Log("[Arsist] Generating Canvas UI from IR (ui_layouts.json)");
                GenerateCanvasUI(uiPath);
                
                // Also generate UHD (head-locked) UI that's not tied to canvas objects
                GenerateUHDUI(uiPath);
            }
            else
            {
                Debug.LogWarning("[Arsist] No UI layout IR found: ui_layouts.json");
            }
        }
        
        private static void GenerateUHDUI(string uiPath)
        {
            EnsureUILayoutCache();
            
            foreach (var kvp in _uiLayoutCache)
            {
                var layout = kvp.Value;
                var scope = layout["scope"]?.ToString();
                
                if (scope == "uhd")
                {
                    var layoutId = layout["id"]?.ToString();
                    var layoutName = layout["name"]?.ToString();
                    Debug.Log($"[Arsist] Generating UHD UI: {layoutName} (id: {layoutId})");
                    
                    // Find or create UHD Canvas
                    var uhdCanvasGO = GameObject.Find("UHD_Canvas");
                    if (uhdCanvasGO == null)
                    {
                        uhdCanvasGO = CreateUHDCanvas();
                    }
                    
                    var rootEl = layout["root"] as JObject;
                    if (rootEl != null)
                    {
                        CreateUIElement(rootEl, uhdCanvasGO.transform);
                    }
                }
            }
        }
        
        private static GameObject CreateUHDCanvas()
        {
            var canvasGO = new GameObject("UHD_Canvas");
            
            // Find main camera
            var mainCam = Camera.main;
            if (mainCam == null)
            {
                mainCam = UnityEngine.Object.FindObjectOfType<Camera>();
            }
            
            var canvas = canvasGO.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.sortingOrder = 9999;
            canvas.overrideSorting = true;
            
            if (mainCam != null)
            {
                canvas.worldCamera = mainCam;
                canvasGO.transform.SetParent(mainCam.transform, false);
                canvasGO.transform.localPosition = new Vector3(0, 0, 1.5f);
            }
            
            var canvasScaler = canvasGO.AddComponent<UnityEngine.UI.CanvasScaler>();
            canvasScaler.dynamicPixelsPerUnit = 1000f;
            canvasGO.AddComponent<UnityEngine.UI.GraphicRaycaster>();
            
            var rect = canvasGO.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(1920, 1080);
            rect.localScale = Vector3.one * 0.001f;
            
            var canvasGroup = canvasGO.AddComponent<CanvasGroup>();
            canvasGroup.alpha = 1f;
            canvasGroup.interactable = true;
            canvasGroup.blocksRaycasts = true;
            
            // Add CanvasInitializer
            TryAddComponentByTypeName(canvasGO, "Arsist.Runtime.UI.CanvasInitializer");
            
            canvasGO.SetActive(true);
            return canvasGO;
        }

        /// <summary>
        /// Canvas UIを生成（従来方式）
        /// </summary>
        private static void GenerateCanvasUI(string uiPath)
        {
            var uiJson = File.ReadAllText(uiPath);
            var layouts = JArray.Parse(uiJson);
            var createdHudCount = 0;

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
                canvas.sortingOrder = 9999;
                canvas.overrideSorting = true;
                
                var canvasScaler = canvasGO.AddComponent<UnityEngine.UI.CanvasScaler>();
                canvasScaler.dynamicPixelsPerUnit = 100;
                
                canvasGO.AddComponent<UnityEngine.UI.GraphicRaycaster>();

                // Canvas のサイズ設定
                var rectTransform = canvasGO.GetComponent<RectTransform>();
                rectTransform.sizeDelta = new Vector2(1920, 1080);
                
                // CRITICAL: Use scale 1.0 to match engine coordinate system
                // The engine expects 1 Unity unit = 1 pixel in the Canvas
                rectTransform.localScale = Vector3.one * 0.001f; // 1920x1080 pixels at 0.001 scale = 1.92x1.08 meters

                var distance = _manifest?["arSettings"]?["floatingScreen"]?["distance"]?.Value<float>() ?? 2f;

                var mainCam = Camera.main;
                if (mainCam != null)
                {
                    // Create dedicated UI camera for always-on-top rendering
                    var uiCameraGO = new GameObject($"UICamera_{layoutName}");
                    uiCameraGO.transform.SetParent(mainCam.transform, false);
                    uiCameraGO.transform.localPosition = Vector3.zero;
                    uiCameraGO.transform.localRotation = Quaternion.identity;
                    
                    var uiCam = uiCameraGO.AddComponent<Camera>();
                    uiCam.clearFlags = CameraClearFlags.Depth; // Only clear depth, preserve color from main camera
                    uiCam.cullingMask = 1 << LayerMask.NameToLayer("UI"); // Only render UI layer
                    uiCam.depth = 100; // Render after main camera (depth 0)
                    uiCam.nearClipPlane = 0.01f;
                    uiCam.farClipPlane = 10f;
                    
                    // Position Canvas as child of UI camera
                    canvasGO.transform.SetParent(uiCameraGO.transform, false);
                    rectTransform.localPosition = new Vector3(0f, 0f, Mathf.Max(0.3f, distance * 0.5f));
                    rectTransform.localRotation = Quaternion.identity;
                    
                    // Set Canvas and all children to UI layer
                    canvasGO.layer = LayerMask.NameToLayer("UI");
                    SetLayerRecursively(canvasGO, LayerMask.NameToLayer("UI"));
                    
                    // Canvas uses the dedicated UI camera
                    canvas.worldCamera = uiCam;
                    canvas.planeDistance = rectTransform.localPosition.z;
                    
                    Debug.Log($"[Arsist] Created UI camera for {layoutName} at depth {uiCam.depth}");
                }
                else
                {
                    rectTransform.position = new Vector3(0, 1.5f, 3f);
                    Debug.LogWarning("[Arsist] MainCamera not found - Canvas may not be visible");
                }

                var cg = canvasGO.GetComponent<CanvasGroup>();
                if (cg == null)
                {
                    cg = canvasGO.AddComponent<CanvasGroup>();
                }
                cg.alpha = 1f;
                cg.interactable = true;
                cg.blocksRaycasts = true;
                
                // 常時表示を保証
                canvasGO.SetActive(true);

                // Add CanvasInitializer to ensure worldCamera is set at runtime
                var initializer = canvasGO.AddComponent<Arsist.Runtime.UI.CanvasInitializer>();
                if (initializer != null)
                {
                    Debug.Log("[Arsist] CanvasInitializer added to Canvas");
                }

                createdHudCount++;

                // UIエレメントを生成
                var root = layout["root"] as JObject;
                if (root != null)
                {
                    CreateUIElement(root, canvasGO.transform);
                }
            }

            if (createdHudCount == 0)
            {
                CreateFallbackHUDCanvas();
            }
        }

        private static void CreateFallbackHUDCanvas()
        {
            var mainCam = Camera.main;
            if (mainCam == null)
            {
                Debug.LogWarning("[Arsist] Fallback HUD skipped: MainCamera not found.");
                return;
            }

            // Create dedicated UI camera for fallback HUD
            var uiCameraGO = new GameObject("UICamera_FallbackHUD");
            uiCameraGO.transform.SetParent(mainCam.transform, false);
            uiCameraGO.transform.localPosition = Vector3.zero;
            uiCameraGO.transform.localRotation = Quaternion.identity;
            
            var uiCam = uiCameraGO.AddComponent<Camera>();
            uiCam.clearFlags = CameraClearFlags.Depth;
            uiCam.cullingMask = 1 << LayerMask.NameToLayer("UI");
            uiCam.depth = 100;
            uiCam.nearClipPlane = 0.01f;
            uiCam.farClipPlane = 10f;

            var canvasGO = new GameObject("Canvas_FallbackHUD");
            canvasGO.transform.SetParent(uiCameraGO.transform, false);
            canvasGO.transform.localPosition = new Vector3(0f, 0f, 0.7f);
            canvasGO.transform.localRotation = Quaternion.identity;
            canvasGO.layer = LayerMask.NameToLayer("UI");

            var canvas = canvasGO.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = uiCam;
            canvas.sortingOrder = 9999;
            canvas.overrideSorting = true;

            var scaler = canvasGO.AddComponent<UnityEngine.UI.CanvasScaler>();
            scaler.dynamicPixelsPerUnit = 100f;
            canvasGO.AddComponent<UnityEngine.UI.GraphicRaycaster>();

            var rect = canvasGO.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(1200f, 320f);
            rect.localScale = Vector3.one * 0.001f; // Match engine scale

            var labelGO = new GameObject("Label");
            labelGO.transform.SetParent(canvasGO.transform, false);
            labelGO.layer = canvasGO.layer;

            var labelRect = labelGO.AddComponent<RectTransform>();
            labelRect.anchorMin = Vector2.zero;
            labelRect.anchorMax = Vector2.one;
            labelRect.offsetMin = new Vector2(24f, 24f);
            labelRect.offsetMax = new Vector2(-24f, -24f);

            var text = labelGO.AddComponent<TextMesh>();
            text.text = "HUD initialized";
            text.fontSize = 96;
            text.characterSize = 0.01f;
            text.color = Color.white;
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.richText = true;
            labelGO.AddComponent<MeshRenderer>();
            
            Debug.Log("[Arsist] Fallback HUD created with UI.Text");

            Debug.Log("[Arsist] Fallback HUD canvas created.");
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
            var elementId = elementData["id"]?.ToString() ?? "unknown";
            Debug.Log($"[Arsist] >> CreateUIElement: type={type}, id={elementId}");
            var go = new GameObject(type);
            go.transform.SetParent(parent, false);
            
            // FIX 13: Set UI layer on all elements
            int uiLayer = LayerMask.NameToLayer("UI");
            if (uiLayer < 0) uiLayer = 5;
            go.layer = uiLayer;

            TryAttachUiBindingRegistry(go, elementData);

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
                    Debug.Log($"[Arsist] >>> Creating Text element: '{elementData["content"]?.ToString() ?? "(no content)"}'" );
                    // FIX 1-10: Critical text rendering fixes
                    var tmp = go.AddComponent<TextMeshProUGUI>();
                    var textContent = elementData["content"]?.ToString() ?? "Text";
                    tmp.text = textContent;
                    Debug.Log($"[Arsist] >>> TextMeshProUGUI component added, text set to: '{textContent}'");

                    // FIX 1: Force enable component
                    tmp.enabled = true;
                    go.SetActive(true);
                    Debug.Log($"[Arsist] >>> Text GameObject enabled and active");

                    // FIX 2: Assign font and material BEFORE setting properties
                    Debug.Log($"[Arsist] >>> _defaultTmpFont is null: {_defaultTmpFont == null}");
                    Debug.Log($"[Arsist] >>> _defaultTmpMaterial is null: {_defaultTmpMaterial == null}");
                    if (_defaultTmpFont != null) tmp.font = _defaultTmpFont;
                    if (_defaultTmpMaterial != null) tmp.fontSharedMaterial = _defaultTmpMaterial;
                    
                    // FIX 3: If no font, use TMP_Settings default (with null check)
                    if (tmp.font == null)
                    {
                        try
                        {
                            if (TMP_Settings.instance != null && TMP_Settings.defaultFontAsset != null)
                            {
                                tmp.font = TMP_Settings.defaultFontAsset;
                            }
                        }
                        catch
                        {
                            // TMP_Settings not initialized in build mode, ignore
                        }
                    }
                    
                    Debug.Log($"[Arsist] Creating Text element: '{textContent}' | font={tmp.font?.name ?? "(null)"} | mat={tmp.fontSharedMaterial?.name ?? "(null)"}");

                    // FIX 4: Set font size BEFORE enabling auto-sizing
                    if (style != null)
                    {
                        tmp.fontSize = style["fontSize"]?.Value<int>() ?? 100;
                        if (TryParseColor(style["color"], out var textColor))
                        {
                            tmp.color = textColor;
                        }
                        else
                        {
                            tmp.color = Color.white;
                        }

                        var align = style["textAlign"]?.ToString();
                        tmp.alignment = align switch
                        {
                            "center" => TextAlignmentOptions.Center,
                            "right" => TextAlignmentOptions.Right,
                            _ => TextAlignmentOptions.Left,
                        };
                    }
                    else
                    {
                        tmp.fontSize = 100;
                        tmp.color = Color.white;
                        tmp.alignment = TextAlignmentOptions.Center;
                    }

                    // FIX 5: Disable auto-sizing - it can cause text to shrink to 0
                    tmp.enableAutoSizing = false;
                    
                    // FIX 6: Set vertex color to ensure visibility
                    tmp.enableVertexGradient = false;
                    
                    // FIX 7: Disable raycast target to prevent blocking
                    tmp.raycastTarget = false;
                    
                    tmp.richText = true;
                    
                    // FIX 8: Force update mesh immediately
                    tmp.ForceMeshUpdate(true, true);

                    Debug.Log($"[Arsist] ✅✅✅ Text element FULLY configured: '{tmp.text}'");
                    Debug.Log($"[Arsist]     - GameObject: {go.name}, active: {go.activeSelf}");
                    Debug.Log($"[Arsist]     - TMP enabled: {tmp.enabled}");
                    Debug.Log($"[Arsist]     - Font: {(tmp.font != null ? tmp.font.name : "NULL")}");
                    Debug.Log($"[Arsist]     - Material: {(tmp.fontSharedMaterial != null ? tmp.fontSharedMaterial.name : "NULL")}");
                    Debug.Log($"[Arsist]     - FontSize: {tmp.fontSize}");
                    Debug.Log($"[Arsist]     - Color: {tmp.color}");
                    Debug.Log($"[Arsist]     - Parent: {parent.name}");
                    Debug.Log($"[Arsist]     - Layer: {go.layer} (UI layer: {LayerMask.NameToLayer("UI")})");

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

                    var buttonText = buttonTextGO.AddComponent<TextMeshProUGUI>();
                    buttonText.text = elementData["content"]?.ToString() ?? "Button";
                    
                    // Apply same fixes as Text element
                    buttonText.enabled = true;
                    buttonTextGO.SetActive(true);
                    
                    if (_defaultTmpFont != null) buttonText.font = _defaultTmpFont;
                    if (_defaultTmpMaterial != null) buttonText.fontSharedMaterial = _defaultTmpMaterial;
                    if (buttonText.font == null)
                    {
                        try
                        {
                            if (TMP_Settings.instance != null && TMP_Settings.defaultFontAsset != null)
                            {
                                buttonText.font = TMP_Settings.defaultFontAsset;
                            }
                        }
                        catch
                        {
                            // TMP_Settings not initialized in build mode, ignore
                        }
                    }
                    
                    buttonText.fontSize = style?["fontSize"]?.Value<int>() ?? 80;
                    buttonText.alignment = TextAlignmentOptions.Center;
                    buttonText.color = TryParseColor(style?["color"], out var btnTextColor) ? btnTextColor : Color.white;
                    buttonText.enableAutoSizing = false;
                    buttonText.raycastTarget = false;
                    buttonText.richText = true;
                    buttonText.ForceMeshUpdate(true, true);
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
            if (children != null && children.Count > 0)
            {
                Debug.Log($"[Arsist] >> Element has {children.Count} children, creating recursively...");
                foreach (JObject child in children)
                {
                    CreateUIElement(child, go.transform);
                }
            }
            else
            {
                Debug.Log($"[Arsist] >> Element has no children");
            }
        }

        private static void TryAttachUiBindingRegistry(GameObject go, JObject elementData)
        {
            var bindingId = elementData["bindingId"]?.ToString();
            if (string.IsNullOrWhiteSpace(bindingId))
            {
                bindingId = elementData["id"]?.ToString();
            }

            if (string.IsNullOrWhiteSpace(bindingId)) return;

            var registryComp = go.GetComponent<UiBindingRegistry>();
            if (registryComp == null)
            {
                registryComp = go.AddComponent<UiBindingRegistry>();
            }
            registryComp.bindingId = bindingId;
        }

        private static void SetLayerRecursively(GameObject root, int layer)
        {
            if (root == null) return;
            root.layer = layer;
            foreach (Transform child in root.transform)
            {
                if (child != null)
                {
                    SetLayerRecursively(child.gameObject, layer);
                }
            }
        }

        private static void ApplyRectTransformStyle(RectTransform rectTransform, JObject style)
        {
            // FIX 9: Ensure minimum size for text elements
            const float MIN_SIZE = 50f;
            const float DEFAULT_WIDTH = 400f;
            const float DEFAULT_HEIGHT = 200f;
            
            if (style == null)
            {
                rectTransform.anchorMin = new Vector2(0f, 1f);
                rectTransform.anchorMax = new Vector2(0f, 1f);
                rectTransform.pivot = new Vector2(0f, 1f);
                rectTransform.anchoredPosition = Vector2.zero;
                rectTransform.sizeDelta = new Vector2(DEFAULT_WIDTH, DEFAULT_HEIGHT);
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

                var width = Mathf.Max(MIN_SIZE, ParseSizeValue(style["width"], DEFAULT_WIDTH));
                var height = Mathf.Max(MIN_SIZE, ParseSizeValue(style["height"], DEFAULT_HEIGHT));
                rectTransform.sizeDelta = new Vector2(width, height);
                
                Debug.Log($"[Arsist] RectTransform absolute: pos=({left},{-top}) size=({width},{height})");
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
                    var width = stretchWidth ? 0f : Mathf.Max(MIN_SIZE, ParseSizeValue(style["width"], DEFAULT_WIDTH));
                    var height = stretchHeight ? 0f : Mathf.Max(MIN_SIZE, ParseSizeValue(style["height"], DEFAULT_HEIGHT));
                    rectTransform.sizeDelta = new Vector2(width, height);
                }

                return;
            }

            rectTransform.anchorMin = new Vector2(0f, 1f);
            rectTransform.anchorMax = new Vector2(0f, 1f);
            rectTransform.pivot = new Vector2(0f, 1f);
            rectTransform.anchoredPosition = Vector2.zero;
            
            var finalWidth = Mathf.Max(MIN_SIZE, ParseSizeValue(style["width"], DEFAULT_WIDTH));
            var finalHeight = Mathf.Max(MIN_SIZE, ParseSizeValue(style["height"], DEFAULT_HEIGHT));
            rectTransform.sizeDelta = new Vector2(finalWidth, finalHeight);
            
            Debug.Log($"[Arsist] RectTransform default: size=({finalWidth},{finalHeight})");
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
            PlayerSettings.insecureHttpOption = InsecureHttpOption.AlwaysAllowed;
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

            // XREAL SDKがインストールされているか確認
            if (isXreal)
            {
                var xrealSdkExists = System.Type.GetType("Unity.XR.XREAL.XREALPlugin, Unity.XR.XREAL") != null;
                if (xrealSdkExists)
                {
                    defines.Add("ARSIST_XREAL");
                    Debug.Log("[Arsist] XREAL SDK detected, adding ARSIST_XREAL define");
                }
                else
                {
                    Debug.LogWarning("[Arsist] XREAL SDK not installed. ARSIST_XREAL define will NOT be added.");
                    Debug.LogWarning("[Arsist] XREAL-specific features will be disabled.");
                }
            }
            
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
                var manifestPath = Path.Combine(Application.dataPath, "Plugins", "Android", "AndroidManifest.xml");

                if (normalized.Contains("xreal"))
                {
                    // Adapters/XREAL_One/XrealBuildPatcher.cs がUnityプロジェクト側にコピーされている前提
                    InvokeStaticIfExists(
                        "Arsist.Adapters.XrealOne.XrealBuildPatcher",
                        "ApplyAllPatches"
                    );
                    InvokeStaticIfExists(
                        "Arsist.Adapters.XrealOne.XrealBuildPatcher",
                        "PatchAndroidManifest"
                    );
                }

                if (normalized.Contains("quest") || normalized.Contains("meta"))
                {
                    InvokeStaticIfExists(
                        "Arsist.Adapters.MetaQuest.QuestBuildPatcher",
                        "PatchAndroidManifest",
                        manifestPath
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
                var xrealSdkExists = System.Type.GetType("Unity.XR.XREAL.XREALPlugin, Unity.XR.XREAL") != null;
                
                if (xrealSdkExists)
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
                else
                {
                    Debug.LogWarning("[Arsist] XREAL SDK not installed. Skipping Graphics API validation.");
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
                        Debug.LogWarning("[Arsist] XR General Settings (Android) is missing - XR may not work properly");
                    }
                    else
                    {
                        if (!generalSettings.InitManagerOnStart)
                        {
                            Debug.LogWarning("[Arsist] Initialize XR on Startup is not enabled");
                        }

                        var manager = generalSettings.Manager;
                        if (manager == null)
                        {
                            Debug.LogWarning("[Arsist] XR Manager Settings is missing");
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
                                Debug.LogWarning("[Arsist] XREAL XR Loader is not enabled in XR Plug-in Management (Android)");
                            }
                        }
                    }
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[Arsist] Failed to validate XR settings: {e.Message}");
                }
            }

            // ==== XREAL Settings（XREAL SDK 3.x が内部参照するため必須）====
            if (isXreal)
            {
                // XREAL SDKがインストールされているか確認
                var xrealSdkExists = System.Type.GetType("Unity.XR.XREAL.XREALPlugin, Unity.XR.XREAL") != null;
                
                if (xrealSdkExists)
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
                else
                {
                    Debug.LogWarning("[Arsist] XREAL SDK not installed. Skipping XREAL-specific validation.");
                    Debug.LogWarning("[Arsist] Build will proceed without XREAL SDK features.");
                }
            }

            // ==== カメラ透過要件（XrealOne: 黒=透明 / ARCameraBackground除去）====
            if (isXreal)
            {
                var xrealSdkExists = System.Type.GetType("Unity.XR.XREAL.XREALPlugin, Unity.XR.XREAL") != null;
                
                if (xrealSdkExists)
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
                else
                {
                    Debug.LogWarning("[Arsist] XREAL SDK not installed. Skipping camera transparency validation.");
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
            => InvokeStaticIfExists(typeName, methodName, null);

        private static void InvokeStaticIfExists(string typeName, string methodName, params object[] args)
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

            mi.Invoke(null, args);
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

        private static bool IsQuestTargetDevice()
        {
            var normalizedTarget = (_targetDevice ?? string.Empty).Trim().ToLowerInvariant();
            return normalizedTarget.Contains("quest") || normalizedTarget.Contains("meta");
        }

        private static void ApplyQuestBuildBootstrap()
        {
            if (!IsQuestTargetDevice()) return;

            Debug.Log("[Arsist] Phase 3.15: Applying Quest build bootstrap...");
            ConfigureOculusProjectConfigForQuest();
        }

        private static void EnsureQuestOvrManager(GameObject xrOrigin)
        {
            var ovrManagerType = FindType("OVRManager") ?? FindTypeInLoadedAssemblies("OVRManager");
            if (ovrManagerType == null)
            {
                Debug.LogWarning("[Arsist] OVRManager type not found. Make sure com.meta.xr.sdk.core is installed.");
                return;
            }

            var existingManagers = Resources.FindObjectsOfTypeAll(ovrManagerType);
            if (existingManagers != null && existingManagers.Length > 0)
            {
                Debug.Log("[Arsist] OVRManager already exists in scene.");
                return;
            }

            if (xrOrigin != null)
            {
                xrOrigin.AddComponent(ovrManagerType);
                Debug.Log("[Arsist] OVRManager added on XR Origin for Quest.");
                return;
            }

            var fallbackRoot = new GameObject("OVR Manager");
            fallbackRoot.AddComponent(ovrManagerType);
            Debug.Log("[Arsist] OVRManager added on fallback root for Quest.");
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

        /// <summary>
        /// Quest向けに OculusProjectConfig.asset を確実に適用する。
        /// まず SerializedObject で適用し、取得できない場合のみ YAML パッチにフォールバックする。
        /// </summary>
        private static void ConfigureOculusProjectConfigForQuest()
        {
            try
            {
                var assetPath = "Assets/Oculus/OculusProjectConfig.asset";
                var configAsset = AssetDatabase.LoadMainAssetAtPath(assetPath);

                if (configAsset != null)
                {
                    var serialized = new SerializedObject(configAsset);
                    var changed = false;

                    changed |= SetSerializedIntOrBool(serialized, "handTrackingSupport", 1, true);
                    changed |= SetSerializedIntOrBool(serialized, "handTrackingFrequency", 1, true);
                    changed |= SetSerializedIntOrBool(serialized, "insightPassthroughEnabled", 1, true);
                    changed |= SetSerializedIntOrBool(serialized, "_insightPassthroughSupport", 2, true);
                    changed |= SetSerializedIntOrBool(serialized, "focusAware", 1, true);
                    changed |= SetSerializedIntOrBool(serialized, "sceneSupport", 1, true);

                    if (changed)
                    {
                        serialized.ApplyModifiedPropertiesWithoutUndo();
                        EditorUtility.SetDirty(configAsset);
                        AssetDatabase.SaveAssets();
                        AssetDatabase.Refresh();
                    }

                    Debug.Log("[Arsist] OculusProjectConfig applied for Quest: HandTracking=1, Passthrough=1, FocusAware=1, SceneSupport=1");
                    return;
                }

                Debug.LogWarning("[Arsist] OculusProjectConfig asset not found in AssetDatabase. Falling back to YAML patch.");
                PatchOculusProjectConfigYaml();
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] ConfigureOculusProjectConfigForQuest failed: {e.Message}. Falling back to YAML patch.");
                PatchOculusProjectConfigYaml();
            }
        }

        private static bool SetSerializedIntOrBool(SerializedObject serialized, string propertyName, int intValue, bool boolValue)
        {
            var property = serialized.FindProperty(propertyName);
            if (property == null)
            {
                Debug.LogWarning($"[Arsist] OculusProjectConfig property not found: {propertyName}");
                return false;
            }

            switch (property.propertyType)
            {
                case SerializedPropertyType.Boolean:
                    if (property.boolValue == boolValue) return false;
                    property.boolValue = boolValue;
                    return true;

                case SerializedPropertyType.Integer:
                case SerializedPropertyType.Enum:
                    if (property.intValue == intValue) return false;
                    property.intValue = intValue;
                    return true;

                default:
                    Debug.LogWarning($"[Arsist] Unsupported OculusProjectConfig property type: {propertyName} ({property.propertyType})");
                    return false;
            }
        }

        private static void PatchOculusProjectConfigYaml()
        {
            var path = Path.Combine(Application.dataPath, "Oculus", "OculusProjectConfig.asset");
            if (!File.Exists(path))
            {
                Debug.LogWarning($"[Arsist] OculusProjectConfig.asset not found at {path}");
                return;
            }

            var yaml = File.ReadAllText(path);
            yaml = ReplaceYamlNumericValue(yaml, "handTrackingSupport", 1);
            yaml = ReplaceYamlNumericValue(yaml, "handTrackingFrequency", 1);
            yaml = ReplaceYamlNumericValue(yaml, "insightPassthroughEnabled", 1);
            yaml = ReplaceYamlNumericValue(yaml, "_insightPassthroughSupport", 2);
            yaml = ReplaceYamlNumericValue(yaml, "focusAware", 1);
            yaml = ReplaceYamlNumericValue(yaml, "sceneSupport", 1);

            File.WriteAllText(path, yaml);
            AssetDatabase.Refresh();
            Debug.Log("[Arsist] OculusProjectConfig YAML patched for Quest.");
        }

        private static string ReplaceYamlNumericValue(string yaml, string key, int value)
        {
            return System.Text.RegularExpressions.Regex.Replace(
                yaml,
                $@"(?m)^(\s*{System.Text.RegularExpressions.Regex.Escape(key)}:\s*)\d+(\s*)$",
                $"$1{value}$2");
        }
    }
}
