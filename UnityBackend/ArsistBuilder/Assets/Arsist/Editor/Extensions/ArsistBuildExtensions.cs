// ==============================================
// Arsist Engine - Extensions: build-time hooks
// Assets/Arsist/Editor/Extensions/ArsistBuildExtensions.cs
//
// 拡張機能がビルド中に手を入れる口。拡張機能の Editor/*.cs で IArsistBuildExtension を実装すると、
// ArsistBuildPipeline が決まった時点で呼ぶ:
//
//   OnScene           シーンを作り終えて保存する直前 (シーンごと)。部品をシーンに置くのはここ。
//                     例: quest-room は Meta の MRUK をここで置く。
//   OnPlayerSettings  端末ごとのパッチを当てたあと。PlayerSettings や SDK の設定はここ。
//
// 有効な拡張機能 (manifest.json の extensions) のフックだけが呼ばれる。フックが例外を
// 投げたらビルドを止める — 黙って続けると「ビルドは通ったのに実機で拡張機能が動かない」になる。
// ==============================================

using System;
using System.Collections.Generic;
using System.Linq;
using Arsist.Runtime.Extensions;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace Arsist.Builder.Extensions
{
    public interface IArsistBuildExtension
    {
        /// <summary>extension.json の id。この id の拡張機能が有効なときだけ呼ばれる。</summary>
        string ExtensionId { get; }

        void OnScene(ArsistBuildContext context);

        void OnPlayerSettings(ArsistBuildContext context);
    }

    /// <summary>使わない方を書かずに済むように、何もしない既定を持つ基底。</summary>
    public abstract class ArsistBuildExtension : IArsistBuildExtension
    {
        public abstract string ExtensionId { get; }
        public virtual void OnScene(ArsistBuildContext context) { }
        public virtual void OnPlayerSettings(ArsistBuildContext context) { }
    }

    public sealed class ArsistBuildContext
    {
        internal ArsistBuildContext(string id, JObject entry, JObject manifest)
        {
            ExtensionId = id;
            Settings = entry?["settings"] as JObject ?? new JObject();
            DataVersion = entry?["dataVersion"]?.Value<int>() ?? 1;
            Manifest = manifest ?? new JObject();
            TargetDevice = Manifest["targetDevice"]?.ToString() ?? "";
            DeviceTags = (Manifest["deviceTags"] as JArray)?.Select(t => t.ToString()).ToList() ?? new List<string>();
            Features = (Manifest["features"] as JArray)?.Select(t => t.ToString()).ToList() ?? new List<string>();
        }

        public string ExtensionId { get; }
        /// <summary>既定値の上にプロジェクトの値を重ねた設定。</summary>
        public JObject Settings { get; }
        public int DataVersion { get; }
        /// <summary>ビルド全体の manifest.json (読むだけにすること)。</summary>
        public JObject Manifest { get; }
        public string TargetDevice { get; }
        public IReadOnlyList<string> DeviceTags { get; }
        public IReadOnlyList<string> Features { get; }

        public bool HasTag(string tag) =>
            DeviceTags.Contains(tag, StringComparer.OrdinalIgnoreCase) || Features.Contains(tag, StringComparer.OrdinalIgnoreCase);

        public bool GetBool(string key, bool fallback) =>
            Settings[key] != null && Settings[key].Type == JTokenType.Boolean ? Settings[key].Value<bool>() : fallback;

        public float GetFloat(string key, float fallback) =>
            Settings[key] != null && (Settings[key].Type == JTokenType.Float || Settings[key].Type == JTokenType.Integer)
                ? Settings[key].Value<float>() : fallback;

        public string GetString(string key, string fallback) =>
            Settings[key] != null && Settings[key].Type == JTokenType.String ? Settings[key].Value<string>() : fallback;

        /// <summary>今開いているシーンで、この拡張機能の指定 (ext.&lt;id&gt;) を持つ物。</summary>
        public IEnumerable<ArsistObjectExt> ObjectsWithData()
        {
            foreach (var item in UnityEngine.Object.FindObjectsByType<ArsistObjectExt>(FindObjectsInactive.Include, FindObjectsSortMode.None))
            {
                if (item.Has(ExtensionId)) yield return item;
            }
        }

        // ---- 端末を足す拡張機能のための口 ----

        /// <summary>このビルドの端末 (targetDevice) が、この名前のアダプタか (大文字小文字・区切りは問わない)。</summary>
        public bool IsTargetDevice(string adapterName) =>
            Normalize(TargetDevice).StartsWith(Normalize(adapterName), StringComparison.Ordinal) && Normalize(adapterName).Length > 0;

        private static string Normalize(string s) => (s ?? "").Replace("-", "_").Replace(" ", "_").ToLowerInvariant();

        /// <summary>XR ローダーを足す (例: "UnityEngine.XR.OpenXR.OpenXRLoader")。OnPlayerSettings から呼ぶ。</summary>
        public bool AddXRLoader(string loaderTypeName) => ArsistBuildPipeline.ExtensionAddXRLoader(loaderTypeName);

        /// <summary>OpenXR の機能を有効にする (機能 ID)。OnPlayerSettings から呼ぶ。</summary>
        public bool EnableOpenXRFeature(string featureId) => ArsistBuildPipeline.ExtensionEnableOpenXRFeature(featureId);

        /// <summary>Assets/Plugins/Android/AndroidManifest.xml (端末のアダプタが置いたもの)。</summary>
        public string AndroidManifestPath => System.IO.Path.Combine(Application.dataPath, "Plugins", "Android", "AndroidManifest.xml");

        public void Log(string message) => Debug.Log($"[Arsist:{ExtensionId}] (build) {message}");
        public void Warn(string message) => Debug.LogWarning($"[Arsist:{ExtensionId}] (build) {message}");
    }

    /// <summary>ArsistBuildPipeline から呼ばれる。</summary>
    public static class ArsistBuildExtensionRunner
    {
        /// <summary>manifest.json の extensions (このビルドで有効なもの)。</summary>
        public static List<JObject> ActiveEntries(JObject manifest)
        {
            return (manifest?["extensions"] as JArray)?.OfType<JObject>()
                .Where(e => !string.IsNullOrEmpty(e["id"]?.ToString()))
                .ToList() ?? new List<JObject>();
        }

        /// <summary>
        /// 有効な拡張機能があれば、シーンに ArsistExtensionHost を置く (実機で OnStart を呼ぶ係)。
        /// </summary>
        public static void EnsureHostInScene(JObject manifest)
        {
            var active = ActiveEntries(manifest);
            if (active.Count == 0) return;
            if (UnityEngine.Object.FindAnyObjectByType<ArsistExtensionHost>(FindObjectsInactive.Include) != null) return;
            var go = new GameObject("[ArsistExtensions]");
            go.AddComponent<ArsistExtensionHost>();
            Debug.Log($"[Arsist] Extensions in this build: {string.Join(", ", active.Select(e => e["id"] + "@" + e["version"]))}");
        }

        public static void RunScene(JObject manifest) => Run(manifest, "OnScene", (hook, ctx) => hook.OnScene(ctx));

        public static void RunPlayerSettings(JObject manifest) => Run(manifest, "OnPlayerSettings", (hook, ctx) => hook.OnPlayerSettings(ctx));

        private static void Run(JObject manifest, string stage, Action<IArsistBuildExtension, ArsistBuildContext> call)
        {
            var active = ActiveEntries(manifest);
            if (active.Count == 0) return;

            var hooks = new List<IArsistBuildExtension>();
            foreach (var type in TypeCache.GetTypesDerivedFrom<IArsistBuildExtension>())
            {
                if (type.IsAbstract || type.IsInterface) continue;
                try
                {
                    hooks.Add((IArsistBuildExtension)Activator.CreateInstance(type));
                }
                catch (Exception e)
                {
                    throw new InvalidOperationException($"[Arsist] Extension build hook {type.FullName} could not be created: {e.Message}", e);
                }
            }

            foreach (var entry in active)
            {
                var id = entry["id"].ToString();
                foreach (var hook in hooks.Where(h => h.ExtensionId == id))
                {
                    var context = new ArsistBuildContext(id, entry, manifest);
                    try
                    {
                        call(hook, context);
                    }
                    catch (Exception e)
                    {
                        // 黙って続けると、実機で拡張機能だけが動かない APK になる
                        throw new InvalidOperationException(
                            $"[Arsist] Extension '{id}' failed during {stage} ({hook.GetType().Name}): {e.Message}", e);
                    }
                }
            }
        }
    }
}
