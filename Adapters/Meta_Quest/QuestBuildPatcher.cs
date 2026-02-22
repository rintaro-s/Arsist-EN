#if UNITY_EDITOR
using System.IO;
using System.Xml;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;
using UnityEngine.XR.Management;

namespace Arsist.Adapters.MetaQuest
{
    /// <summary>
    /// Meta Quest 向けビルド設定パッチャー。
    /// Arsist ビルドパイプラインから自動的に呼び出される。
    /// ユーザーは Unity エディタを直接操作する必要はない。
    /// </summary>
    public static class QuestBuildPatcher
    {
        // ─────────────────────────────────────────
        // PlayerSettings パッチ
        // ─────────────────────────────────────────

        /// <summary>Quest 向け PlayerSettings を適用する</summary>
        public static void ApplyPlayerSettings(string packageName, string version, int versionCode)
        {
            // パッケージ名 & バージョン
            PlayerSettings.applicationIdentifier = packageName;
            PlayerSettings.bundleVersion = version;
            PlayerSettings.Android.bundleVersionCode = versionCode;

            // Android ターゲット
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel32;
            PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevel32;

            // IL2CPP (Quest は Mono 非対応)
            PlayerSettings.SetScriptingBackend(BuildTargetGroup.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;

            // カラースペース
            PlayerSettings.colorSpace = ColorSpace.Linear;

            // グラフィックス API (Vulkan 優先)
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[]
            {
                UnityEngine.Rendering.GraphicsDeviceType.Vulkan,
                UnityEngine.Rendering.GraphicsDeviceType.OpenGLES3,
            });

            // マルチスレッドレンダリング
            PlayerSettings.MTRendering = true;

            // ステレオレンダリング: Single Pass Instanced
            PlayerSettings.stereoRenderingPath = StereoRenderingPath.Instancing;

            Debug.Log("[QuestBuildPatcher] PlayerSettings 適用完了");
        }

        // ─────────────────────────────────────────
        // AndroidManifest パッチ
        // ─────────────────────────────────────────

        /// <summary>Quest 用に AndroidManifest.xml を修正する</summary>
        public static void PatchAndroidManifest(string manifestPath)
        {
            if (!File.Exists(manifestPath))
            {
                Debug.LogWarning($"[QuestBuildPatcher] AndroidManifest.xml が見つかりません: {manifestPath}");
                return;
            }

            var doc = new XmlDocument();
            doc.Load(manifestPath);

            var ns = "http://schemas.android.com/apk/res/android";
            var nsMgr = new XmlNamespaceManager(doc.NameTable);
            nsMgr.AddNamespace("android", ns);

            var manifest = doc.SelectSingleNode("/manifest");
            var app = doc.SelectSingleNode("/manifest/application");

            if (manifest == null || app == null)
            {
                Debug.LogError("[QuestBuildPatcher] AndroidManifest.xml の構造が不正です");
                return;
            }

            // ─── Quest VR カテゴリ追加 ───
            EnsureIntentCategory(doc, ns, nsMgr, "com.oculus.intent.category.VR");

            // ─── Quest SDK メタデータ ───
            EnsureMetaData(doc, ns, app, "com.samsung.android.vr.application.mode", "vr_only");
            EnsureMetaData(doc, ns, app, "com.oculus.ossplash", "false");

            // ─── ハンドトラッキング パーミッション ───
            EnsurePermission(doc, ns, manifest, "com.oculus.permission.HAND_TRACKING");
            EnsurePermission(doc, ns, manifest, "com.oculus.permission.USE_SCENE");

            // ─── VR 機能 ───
            EnsureUsesFeature(doc, ns, manifest, "android.hardware.vr.headtracking", true, "1");

            doc.Save(manifestPath);
            Debug.Log($"[QuestBuildPatcher] AndroidManifest.xml パッチ完了: {manifestPath}");
        }

        // ─────────────────────────────────────────
        // Passthrough (MR) 設定
        // ─────────────────────────────────────────

        /// <summary>MR Passthrough を有効化する</summary>
        public static void ConfigurePassthrough(string manifestPath)
        {
            if (!File.Exists(manifestPath)) return;

            var doc = new XmlDocument();
            doc.Load(manifestPath);

            var ns = "http://schemas.android.com/apk/res/android";
            var nsMgr = new XmlNamespaceManager(doc.NameTable);
            nsMgr.AddNamespace("android", ns);

            var manifest = doc.SelectSingleNode("/manifest");
            var app = doc.SelectSingleNode("/manifest/application");

            if (manifest == null || app == null) return;

            // Passthrough メタデータ
            EnsureMetaData(doc, ns, app, "com.oculus.ossplash", "false");
            EnsureMetaData(doc, ns, app, "com.oculus.experimental.enabled", "true");

            // Passthrough パーミッション
            EnsurePermission(doc, ns, manifest, "com.oculus.permission.RENDER_MODEL");

            doc.Save(manifestPath);
            Debug.Log("[QuestBuildPatcher] Passthrough 設定完了");
        }

        // ─────────────────────────────────────────
        // XML ユーティリティ
        // ─────────────────────────────────────────

        private static void EnsureIntentCategory(XmlDocument doc, string ns,
            XmlNamespaceManager nsMgr, string category)
        {
            var existing = doc.SelectSingleNode(
                $"//intent-filter/category[@android:name='{category}']", nsMgr);
            if (existing != null) return;

            var filter = doc.SelectSingleNode("//intent-filter");
            if (filter == null) return;

            var node = doc.CreateElement("category");
            node.SetAttribute("name", ns, category);
            filter.AppendChild(node);
        }

        private static void EnsureMetaData(XmlDocument doc, string ns,
            XmlNode parent, string name, string value)
        {
            var nsMgr = new XmlNamespaceManager(doc.NameTable);
            nsMgr.AddNamespace("android", ns);

            var existing = parent.SelectSingleNode(
                $"meta-data[@android:name='{name}']", nsMgr);
            if (existing != null) return;

            var node = doc.CreateElement("meta-data");
            node.SetAttribute("name", ns, name);
            node.SetAttribute("value", ns, value);
            parent.AppendChild(node);
        }

        private static void EnsurePermission(XmlDocument doc, string ns,
            XmlNode manifest, string permName)
        {
            var nsMgr = new XmlNamespaceManager(doc.NameTable);
            nsMgr.AddNamespace("android", ns);

            var existing = manifest.SelectSingleNode(
                $"uses-permission[@android:name='{permName}']", nsMgr);
            if (existing != null) return;

            var node = doc.CreateElement("uses-permission");
            node.SetAttribute("name", ns, permName);
            manifest.AppendChild(node);
        }

        private static void EnsureUsesFeature(XmlDocument doc, string ns,
            XmlNode manifest, string featureName, bool required, string version = null)
        {
            var nsMgr = new XmlNamespaceManager(doc.NameTable);
            nsMgr.AddNamespace("android", ns);

            var existing = manifest.SelectSingleNode(
                $"uses-feature[@android:name='{featureName}']", nsMgr);
            if (existing != null) return;

            var node = doc.CreateElement("uses-feature");
            node.SetAttribute("name", ns, featureName);
            node.SetAttribute("required", ns, required ? "true" : "false");
            if (version != null) node.SetAttribute("version", ns, version);
            manifest.AppendChild(node);
        }
    }
}
#endif
