// ==============================================
// スパイク用の最小ビルドスクリプト。
// シーンは .unity ファイルを持たずここで組み立てる
// (Arsist 本体の ArsistBuildPipeline と同じやり方)。
//
//   Unity -batchmode -quit -projectPath tools/mlkit-spike \
//     -executeMethod SpikeBuild.BuildFromCLI -logFile <log>
// ==============================================

using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class SpikeBuild
{
    private const string SceneDir = "Assets/Scenes";
    private const string ScenePath = SceneDir + "/Spike.unity";

    public static void BuildFromCLI()
    {
        try
        {
            var outputPath = GetArg("-arsistOutput") ?? Path.Combine(
                Directory.GetCurrentDirectory(), "Build", "MlkitOcrSpike.apk");

            Directory.CreateDirectory(Path.GetDirectoryName(outputPath));

            ApplyPlayerSettings();
            CreateScene();

            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = outputPath,
                target = BuildTarget.Android,
                targetGroup = BuildTargetGroup.Android,
                options = BuildOptions.None,
            };

            Debug.Log("[SpikeBuild] building to " + outputPath);
            var report = BuildPipeline.BuildPlayer(options);

            if (report.summary.result != BuildResult.Succeeded)
            {
                Debug.LogError($"[SpikeBuild] FAILED: {report.summary.result} " +
                               $"({report.summary.totalErrors} errors)");
                EditorApplication.Exit(1);
                return;
            }

            Debug.Log($"[SpikeBuild] OK: {outputPath} ({report.summary.totalSize} bytes)");
            EditorApplication.Exit(0);
        }
        catch (Exception e)
        {
            Debug.LogError("[SpikeBuild] threw: " + e);
            EditorApplication.Exit(1);
        }
    }

    private static void ApplyPlayerSettings()
    {
        PlayerSettings.companyName = "Arsist";
        PlayerSettings.productName = "MlkitOcrSpike";
        PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "com.arsist.mlkitocrspike");
        PlayerSettings.bundleVersion = "1.0.0";
        PlayerSettings.Android.bundleVersionCode = 1;

        // Quest 3 は arm64 のみ。IL2CPP 必須。
        PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
        PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
        PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel29;
        PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevel34;

        // マネージドコード除去を切る。UnitySendMessage は名前でメソッドを探すので、
        // 除去されると「ログは出るが結果だけ返ってこない」という、
        // ML Kit の可否と紛らわしい失敗になる。スパイクからは変数を減らす。
        PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.Android, ManagedStrippingLevel.Disabled);

        // フォーカスが無くても動かす。Horizon OS で `adb shell am start` から起こすと
        // パネルにフォーカスが当たらず、Unity が 1 フレームも回さないまま停止する
        // (HasFocus = 0 → APP_CMD_PAUSE → APP_CMD_STOP)。
        // そうなると Awake も Start も走らないので、OCR 以前に何も起きない。
        PlayerSettings.runInBackground = true;

        // VR ではなく普通の 2D アプリとしてビルドする。
        // Quest では 2D パネルとして開くので、OCR の検証だけなら XR は要らない。
        PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;
        PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { UnityEngine.Rendering.GraphicsDeviceType.OpenGLES3 });
        PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);

        EditorUserBuildSettings.buildAppBundle = false;
        EditorUserBuildSettings.androidBuildSubtarget = MobileTextureSubtarget.Generic;
    }

    private static void CreateScene()
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        var go = new GameObject("OcrSpike");
        go.AddComponent<OcrSpike>();

        var cameraGO = new GameObject("Main Camera");
        var camera = cameraGO.AddComponent<Camera>();
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = new Color(0.08f, 0.09f, 0.11f);
        cameraGO.tag = "MainCamera";

        Directory.CreateDirectory(SceneDir);
        EditorSceneManager.SaveScene(scene, ScenePath);
        AssetDatabase.Refresh();
    }

    private static string GetArg(string name)
    {
        var args = Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == name) return args[i + 1];
        }
        return null;
    }
}
