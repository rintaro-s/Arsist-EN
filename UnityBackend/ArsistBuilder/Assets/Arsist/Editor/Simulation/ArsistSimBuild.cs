// ==============================================
// Arsist Engine - シミュレーターのビルド (doc/22-simulation.md)
// Assets/Arsist/Editor/Simulation/ArsistSimBuild.cs
//
// APK と同じシーンを作り (ArsistBuildPipeline.BuildFromCLI をそのまま通す)、最後だけ APK の代わりに
// Linux のプレイヤーを作る。プレイヤーは scripts/sim/unity.mjs が xvfb の上で起こし、
// Runtime/Simulation/ArsistSimulator が頭を動かして画面を撮る。
//
//   Unity -batchmode -nographics -quit -projectPath <作業フォルダ> -buildTarget Linux64
//         -executeMethod Arsist.Builder.Simulation.ArsistSimBuild.BuildFromCLI
//         -arsist-sim-player <出力>/ArsistSim.x86_64 -targetDevice <端末> ...
//
// 作業フォルダはシミュレーター専用 (tmp/ArsistSim/...)。ここで変える設定 (Standalone の XR・グラフィックス API・
// 常に入れるシェーダー) は APK のビルドの作業フォルダには触れない。
// ==============================================

using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.XR.Management;
using UnityEngine;
using UnityEngine.Rendering;

namespace Arsist.Builder.Simulation
{
    public static class ArsistSimBuild
    {
        /// <summary>シミュレーターの部屋を描くシェーダー (Runtime/Simulation/ArsistSimRoom.shader)</summary>
        public const string RoomShader = "Hidden/ArsistSim/Room";

        public static void BuildFromCLI()
        {
            var player = Arg("-arsist-sim-player");
            if (string.IsNullOrEmpty(player))
            {
                Debug.LogError("[Arsist] Build failed: -arsist-sim-player <file> is required for the simulator build");
                EditorApplication.Exit(1);
                return;
            }
            Debug.Log($"[Arsist] Simulator build: the same scene as the APK, built as a Linux player at {player}");
            ArsistBuildPipeline.SimulationPlayerPath = Path.GetFullPath(player);
            ArsistBuildPipeline.BuildFromCLI();
        }

        /// <summary>ArsistBuildPipeline の Phase 4 (APK) の代わり。シーンはもう EditorBuildSettings にある。</summary>
        internal static void BuildPlayer(string playerPath)
        {
            var scenes = EditorBuildSettings.scenes
                .Where(s => s != null && s.enabled && AssetDatabase.LoadAssetAtPath<SceneAsset>(s.path) != null)
                .Select(s => s.path)
                .Distinct()
                .ToArray();
            if (scenes.Length == 0) throw new Exception("No scenes found to build");

            ConfigureStandalone();
            EnableManagedPluginsForLinux();
            DisableStandaloneXR();
            IncludeRoomShader();
            AssetDatabase.SaveAssets();

            Directory.CreateDirectory(Path.GetDirectoryName(playerPath));
            Debug.Log($"[Arsist] Simulator scenes ({scenes.Length}), startup = {scenes[0]}");
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = scenes,
                locationPathName = playerPath,
                target = BuildTarget.StandaloneLinux64,
                // Development にすると画面の隅に "Development Build" の字が出て、撮った画に写る
                options = BuildOptions.None,
            });
            if (report.summary.result != BuildResult.Succeeded)
            {
                // 途中までのプレイヤーを「できた」と取り違えないように消す
                try { if (File.Exists(playerPath)) File.Delete(playerPath); } catch { }
                throw new Exception($"Simulator player build failed: {report.summary.totalErrors} errors");
            }
            Debug.Log($"[Arsist] Simulator player created: {playerPath}");
        }

        /// <summary>
        /// Android 向けにだけ有効にしてある managed の DLL (Jint が要る System.Runtime.CompilerServices.Unsafe など) を
        /// Linux のプレイヤーにも入れる。native のものは触らない (Android の .so / .aar は PC では動かない)。
        /// </summary>
        private static void EnableManagedPluginsForLinux()
        {
            foreach (var importer in PluginImporter.GetAllImporters())
            {
                if (importer == null || importer.isNativePlugin || !importer.assetPath.StartsWith("Assets/")) continue;
                if (!importer.assetPath.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)) continue;
                if (!importer.GetCompatibleWithPlatform(BuildTarget.Android) || importer.GetCompatibleWithPlatform(BuildTarget.StandaloneLinux64)) continue;
                importer.SetCompatibleWithPlatform(BuildTarget.StandaloneLinux64, true);
                importer.SaveAndReimport();
                Debug.Log($"[Arsist] Simulator: {importer.assetPath} enabled for the Linux player");
            }
        }

        private static void ConfigureStandalone()
        {
            var standalone = NamedBuildTarget.Standalone;
            PlayerSettings.SetScriptingBackend(standalone, ScriptingImplementation.Mono2x);
            // Mono なので削らなくてよい (UnityLinker は Jint の参照 System.Runtime.CompilerServices.Unsafe を解決できずに止まる)
            PlayerSettings.SetManagedStrippingLevel(standalone, ManagedStrippingLevel.Disabled);
            // xvfb (Mesa llvmpipe) で確実に動くのは OpenGL Core
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.StandaloneLinux64, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.StandaloneLinux64, new[] { GraphicsDeviceType.OpenGLCore });
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.resizableWindow = true;
            PlayerSettings.runInBackground = true;
            PlayerSettings.visibleInBackground = true;
            PlayerSettings.usePlayerLog = true;
            // 端末に残す値 (store の persist、keep: forever) は ~/.config/unity3d/<company>/<product>/ に書かれる。
            // シミュレーター専用の置き場にして、unity.mjs が実行ごとに消す (前の実行の置き場所を引き継がない)
            PlayerSettings.companyName = "ArsistSim";
            // Mind の手元のスタブ (http://127.0.0.1:…) や PC の Ollama に http で届くように (端末のビルドと同じ扱い)
            PlayerSettings.insecureHttpOption = InsecureHttpOption.AlwaysAllowed;
            PlayerSettings.defaultScreenWidth = 1280;
            PlayerSettings.defaultScreenHeight = 720;
            Debug.Log($"[Arsist] Simulator defines (Standalone): {PlayerSettings.GetScriptingDefineSymbols(standalone)}");
        }

        /// <summary>PC で OpenXR を起こさない (ヘッドセットは無い。頭は ArsistSimulator が動かす)。</summary>
        private static void DisableStandaloneXR()
        {
            try
            {
                var settings = XRGeneralSettingsPerBuildTarget.XRGeneralSettingsForBuildTarget(BuildTargetGroup.Standalone);
                if (settings == null) return;
                settings.InitManagerOnStart = false;
                if (settings.Manager != null)
                {
                    foreach (var loader in settings.Manager.activeLoaders.ToList())
                        settings.Manager.TryRemoveLoader(loader);
                }
                EditorUtility.SetDirty(settings);
                Debug.Log("[Arsist] Simulator: XR loaders for Standalone disabled");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Simulator: could not disable Standalone XR ({e.Message})");
            }
        }

        private static void IncludeRoomShader()
        {
            var shader = Shader.Find(RoomShader);
            if (shader == null)
            {
                Debug.LogWarning($"[Arsist] Simulator: shader {RoomShader} not found (the test space will not be drawn)");
                return;
            }
            var graphicsSettings = AssetDatabase.LoadAssetAtPath<GraphicsSettings>("ProjectSettings/GraphicsSettings.asset");
            var so = new SerializedObject(graphicsSettings);
            var list = so.FindProperty("m_AlwaysIncludedShaders");
            for (int i = 0; i < list.arraySize; i++)
                if (list.GetArrayElementAtIndex(i).objectReferenceValue == shader) return;
            list.arraySize++;
            list.GetArrayElementAtIndex(list.arraySize - 1).objectReferenceValue = shader;
            so.ApplyModifiedProperties();
        }

        private static string Arg(string name)
        {
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == name) return args[i + 1];
            return null;
        }
    }
}
