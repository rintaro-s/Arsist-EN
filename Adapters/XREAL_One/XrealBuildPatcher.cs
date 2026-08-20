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
using System.IO.Compression;
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
            // Validation の FixAll は XR Loader 設定より“前”に流す。
            // 後に流すと、他プラグイン(OpenXR等)の自動修正が XREAL 以外のLoaderを
            // 復活させ、ConfigureXRLoader で最小構成にしたはずの設定を上書きしうる。
            RunXRProjectValidationFixAllBestEffort();
            ConfigureXRLoader();
            // AGP 8 は同一 namespace の複数ライブラリを許さないため、SDK側AARの重複を解消する
            EnsureUniqueAarNamespaces();
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

                // 以前はここで全アセンブリを走査し、型名に "ProjectValidation" を含む型の
                // static FixAll() を無差別に呼んでいたが、これは OpenXR / AR Foundation / Meta の
                // バリデータまで巻き込んで実行してしまい、XREAL 向けに整えた設定
                // （最小構成のXR Loader 等）を壊しうるため廃止した。
                // XREAL のプロジェクト要件（minSdk29 / IL2CPP / ARM64 / GLES3）は
                // ApplyPlayerSettings() で明示的に満たしているので、FixAll は必須ではない。
                Debug.Log($"[Arsist-{ADAPTER_ID}] XR Project Validation FixAll API not found in XR Management; relying on ApplyPlayerSettings() (this is expected).");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to run XR Project Validation FixAll (best-effort): {e.Message}");
            }
        }

        /// <summary>
        /// XREAL SDK の AAR が持つ重複した Android namespace を一意化する。
        ///
        /// XREAL SDK 3.1.0 の nr_*.aar は全て AndroidManifest.xml で
        /// package="nrsdk.pack" を宣言している。Unity 2022 (AGP 7) までは通ったが、
        /// Unity 6 (AGP 8) は同一 namespace を複数ライブラリで使うことを禁止しており、
        ///   Namespace 'nrsdk.pack' is used in multiple modules and/or libraries:
        ///   :nr_loader:, :nr_common:
        /// でマニフェストマージが失敗し、Gradle ビルドごと落ちる。
        ///
        /// これらの AAR は classes.jar が空・R.txt が空・res/ 無しの
        /// 「ネイティブ .so の入れ物」なので、namespace は AGP の一意性チェック以外に
        /// 何も参照されない。よってファイル名由来のサフィックスを足して衝突を解消する。
        ///
        /// 対象は作業用Unityプロジェクトへコピーされた Packages/com.xreal.xr 配下のみ。
        /// ユーザー提供の sdk/ 本体は書き換えない。
        /// </summary>
        [MenuItem("Arsist/Adapters/XREAL One/Fix Duplicate AAR Namespaces")]
        public static void EnsureUniqueAarNamespaces()
        {
            try
            {
                var sdkRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Packages", "com.xreal.xr"));
                if (!Directory.Exists(sdkRoot))
                {
                    Debug.Log($"[Arsist-{ADAPTER_ID}] XREAL SDK package folder not found, skipping AAR namespace fix: {sdkRoot}");
                    return;
                }

                var aarPaths = Directory.GetFiles(sdkRoot, "*.aar", SearchOption.AllDirectories)
                    .OrderBy(p => p, StringComparer.Ordinal)
                    .ToList();
                if (aarPaths.Count == 0) return;

                // namespace -> AARパス群
                var byNamespace = new Dictionary<string, List<string>>(StringComparer.Ordinal);
                foreach (var aarPath in aarPaths)
                {
                    var ns = ReadAarNamespace(aarPath);
                    if (string.IsNullOrWhiteSpace(ns)) continue;
                    if (!byNamespace.TryGetValue(ns, out var list))
                    {
                        list = new List<string>();
                        byNamespace[ns] = list;
                    }
                    list.Add(aarPath);
                }

                var patched = 0;
                foreach (var kvp in byNamespace)
                {
                    if (kvp.Value.Count < 2) continue; // 衝突していないものは触らない

                    Debug.Log($"[Arsist-{ADAPTER_ID}] Duplicate AAR namespace '{kvp.Key}' in: {string.Join(", ", kvp.Value.Select(Path.GetFileName))}");
                    foreach (var aarPath in kvp.Value)
                    {
                        var suffix = SanitizeNamespaceSegment(Path.GetFileNameWithoutExtension(aarPath));
                        if (string.IsNullOrEmpty(suffix)) continue;

                        var uniqueNamespace = $"{kvp.Key}.{suffix}";
                        if (WriteAarNamespace(aarPath, uniqueNamespace))
                        {
                            Debug.Log($"[Arsist-{ADAPTER_ID}] {Path.GetFileName(aarPath)}: namespace '{kvp.Key}' -> '{uniqueNamespace}'");
                            patched++;
                        }
                    }
                }

                if (patched > 0)
                {
                    AssetDatabase.Refresh();
                    Debug.Log($"[Arsist-{ADAPTER_ID}] Made {patched} AAR namespace(s) unique for AGP 8 (Unity 6)");
                }
            }
            catch (Exception e)
            {
                // ここで失敗すると Gradle の manifest merger で落ちるため、原因を明示しておく
                Debug.LogError($"[Arsist-{ADAPTER_ID}] Failed to make AAR namespaces unique: {e.Message}\n{e.StackTrace}");
            }
        }

        private const string AAR_MANIFEST_ENTRY = "AndroidManifest.xml";

        /// <summary>AAR 内 AndroidManifest.xml の package 属性を読む。取れなければ null。</summary>
        private static string ReadAarNamespace(string aarPath)
        {
            try
            {
                // ZipFile は System.IO.Compression.FileSystem 側の型なので、
                // 参照の有無に左右されない ZipArchive + FileStream を使う。
                using (var stream = new FileStream(aarPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    var entry = archive.GetEntry(AAR_MANIFEST_ENTRY);
                    if (entry == null) return null;
                    using (var reader = new StreamReader(entry.Open()))
                    {
                        return ExtractManifestPackage(reader.ReadToEnd());
                    }
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Could not read namespace from {Path.GetFileName(aarPath)}: {e.Message}");
                return null;
            }
        }

        /// <summary>
        /// AAR 内 AndroidManifest.xml の package 属性を書き換える。変更したら true。
        ///
        /// ZipArchiveMode.Update は使わない。Mono の Update 実装は
        /// 「中央ディレクトリからは全エントリが見えるが、ローカルヘッダを逐次読むと
        ///  途中で止まる」壊れた zip を作ることがあり、Gradle の AAR 展開
        ///  (ZipInputStream 相当) が AndroidManifest.xml を取り出せず
        ///  AarResourcesCompilerTransform が NoSuchFileException で落ちる。
        /// そのため一時ファイルへ zip を丸ごと書き起こし、検証してから差し替える。
        /// </summary>
        private static bool WriteAarNamespace(string aarPath, string newNamespace)
        {
            var tempPath = aarPath + ".arsist-tmp";
            try
            {
                var rewrote = false;

                using (var srcStream = new FileStream(aarPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var src = new ZipArchive(srcStream, ZipArchiveMode.Read))
                using (var dstStream = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None))
                using (var dst = new ZipArchive(dstStream, ZipArchiveMode.Create))
                {
                    foreach (var entry in src.Entries)
                    {
                        var isManifest = string.Equals(entry.FullName, AAR_MANIFEST_ENTRY, StringComparison.Ordinal);
                        var newEntry = dst.CreateEntry(entry.FullName, System.IO.Compression.CompressionLevel.Optimal);
                        try
                        {
                            newEntry.LastWriteTime = entry.LastWriteTime;
                        }
                        catch
                        {
                            // 範囲外の日時を持つエントリはそのままにする
                        }

                        using (var input = entry.Open())
                        using (var output = newEntry.Open())
                        {
                            if (isManifest)
                            {
                                string xml;
                                using (var reader = new StreamReader(input))
                                {
                                    xml = reader.ReadToEnd();
                                }

                                var updated = ReplaceManifestPackage(xml, newNamespace);
                                rewrote = !string.Equals(updated, xml, StringComparison.Ordinal);

                                // BOM を付けない UTF-8（AAPT2 は先頭が '<' である必要がある）
                                using (var writer = new StreamWriter(output, new System.Text.UTF8Encoding(false)))
                                {
                                    writer.Write(updated);
                                }
                            }
                            else
                            {
                                input.CopyTo(output);
                            }
                        }
                    }
                }

                if (!rewrote)
                {
                    File.Delete(tempPath);
                    return false;
                }

                if (!VerifyAarIsSequentiallyReadable(tempPath, newNamespace))
                {
                    // 壊れた AAR で元を上書きすると、以降クリーンビルドしないと復旧できない
                    Debug.LogError($"[Arsist-{ADAPTER_ID}] Rewritten AAR failed verification, keeping the original: {Path.GetFileName(aarPath)}");
                    File.Delete(tempPath);
                    return false;
                }

                File.Delete(aarPath);
                File.Move(tempPath, aarPath);
                return true;
            }
            catch
            {
                if (File.Exists(tempPath))
                {
                    try { File.Delete(tempPath); } catch { /* best-effort */ }
                }
                throw;
            }
        }

        /// <summary>
        /// 書き出した AAR が「ローカルヘッダを頭から順に読む」方式でも全エントリ辿れるかを検証する。
        /// Gradle の AAR 展開はこの読み方をするため、中央ディレクトリだけ正しくても不十分。
        /// </summary>
        private static bool VerifyAarIsSequentiallyReadable(string aarPath, string expectedNamespace)
        {
            try
            {
                int centralCount;
                using (var stream = new FileStream(aarPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    centralCount = archive.Entries.Count;
                }

                int seen;
                using (var stream = new FileStream(aarPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    // ZipArchive は中央ディレクトリを読むため逐次読みの検証には使えない
                    seen = CountSequentialLocalEntries(stream);
                }

                var manifestOk = false;

                using (var stream = new FileStream(aarPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    var entry = archive.GetEntry(AAR_MANIFEST_ENTRY);
                    if (entry != null)
                    {
                        using (var reader = new StreamReader(entry.Open()))
                        {
                            manifestOk = string.Equals(ExtractManifestPackage(reader.ReadToEnd()), expectedNamespace, StringComparison.Ordinal);
                        }
                    }
                }

                if (!manifestOk)
                {
                    Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Verification: manifest namespace mismatch in {Path.GetFileName(aarPath)}");
                    return false;
                }
                if (seen != centralCount)
                {
                    Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Verification: {Path.GetFileName(aarPath)} has {centralCount} entries in the central directory but only {seen} readable local headers");
                    return false;
                }
                return true;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Verification of {Path.GetFileName(aarPath)} failed: {e.Message}");
                return false;
            }
        }

        /// <summary>
        /// ローカルファイルヘッダを先頭から順に辿ってエントリ数を数える。
        /// Gradle/ZipInputStream と同じ読み方なので、中央ディレクトリだけ正しい
        /// 「壊れた zip」をここで検出できる。辿れなくなった時点で打ち切る。
        /// </summary>
        private static int CountSequentialLocalEntries(Stream stream)
        {
            const uint LocalHeaderSignature = 0x04034b50;
            const uint CentralHeaderSignature = 0x02014b50;
            const int LocalHeaderSize = 30;

            var header = new byte[LocalHeaderSize];
            var count = 0;
            long offset = 0;

            while (true)
            {
                stream.Position = offset;
                if (!ReadExactly(stream, header, LocalHeaderSize)) return count;

                var signature = BitConverter.ToUInt32(header, 0);
                if (signature == CentralHeaderSignature) return count; // 正常終了
                if (signature != LocalHeaderSignature) return count;   // 壊れている

                var flags = BitConverter.ToUInt16(header, 6);
                var compressedSize = BitConverter.ToUInt32(header, 18);
                var nameLength = BitConverter.ToUInt16(header, 26);
                var extraLength = BitConverter.ToUInt16(header, 28);

                // bit 3 が立っているとサイズはデータ記述子側にあり、ここからは辿れない。
                // ZipArchiveMode.Create + シーク可能ストリームでは立たない想定。
                if ((flags & 0x0008) != 0) return count;

                count++;
                offset += LocalHeaderSize + nameLength + extraLength + compressedSize;
            }
        }

        private static bool ReadExactly(Stream stream, byte[] buffer, int count)
        {
            var read = 0;
            while (read < count)
            {
                var n = stream.Read(buffer, read, count - read);
                if (n <= 0) return false;
                read += n;
            }
            return true;
        }

        private static readonly System.Text.RegularExpressions.Regex s_ManifestPackageRegex =
            new System.Text.RegularExpressions.Regex(
                "(<manifest\\b[^>]*?\\bpackage\\s*=\\s*\")([^\"]*)(\")",
                System.Text.RegularExpressions.RegexOptions.Singleline);

        private static string ExtractManifestPackage(string xml)
        {
            if (string.IsNullOrEmpty(xml)) return null;
            var match = s_ManifestPackageRegex.Match(xml);
            return match.Success ? match.Groups[2].Value : null;
        }

        private static string ReplaceManifestPackage(string xml, string newNamespace)
        {
            return s_ManifestPackageRegex.Replace(
                xml,
                m => m.Groups[1].Value + newNamespace + m.Groups[3].Value,
                1);
        }

        /// <summary>ファイル名を Android namespace のセグメントとして使える形にする。</summary>
        private static string SanitizeNamespaceSegment(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var chars = raw.Select(c => (char.IsLetterOrDigit(c) || c == '_') ? c : '_').ToArray();
            var segment = new string(chars).Trim('_');
            if (segment.Length == 0) return null;
            // Java パッケージのセグメントは数字始まりにできない
            if (char.IsDigit(segment[0])) segment = "_" + segment;
            return segment;
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
            AndroidSdkVersions targetSdk;
            if (!System.Enum.TryParse("AndroidApiLevel34", out targetSdk) &&
                !System.Enum.TryParse("AndroidApiLevel33", out targetSdk))
            {
                targetSdk = AndroidSdkVersions.AndroidApiLevelAuto;
            }
            PlayerSettings.Android.targetSdkVersion = targetSdk;
            
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
            // Graphics Jobs は Vulkan/D3D12/Metal 向けの機能で OpenGLES では使えない。
            // XREAL は GLES3 固定なので有効にしても効果が無く、環境によっては不安定要因になる。
            PlayerSettings.graphicsJobs = false;
            PlayerSettings.gpuSkinning = true;

            // OpenGLES3のみ（Vulkanは透過モードで不具合の原因になりやすい）
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] {
                UnityEngine.Rendering.GraphicsDeviceType.OpenGLES3
            });

            // ステレオ描画を Single Pass Instanced に統一する。
            // XREAL SDK 実体は XREALSettings.StereoRendering(=SinglePassInstanced) で
            // ネイティブに渡すが、Unity 側の PlayerSettings も合わせておくことで
            // 描画パスの不一致を防ぐ（Quest 側は既に Instancing 設定済み）。
            try
            {
                PlayerSettings.stereoRenderingPath = StereoRenderingPath.Instancing;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to set stereoRenderingPath: {e.Message}");
            }

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

                // 既に登録済みでも、フィールドの設定は毎回やり直す。
                // (作業用Unityプロジェクトを再利用するようになったため、
                //  「登録済みだから何もしない」と SupportMultiResume 等が前回のまま残ってしまう)
                if (EditorBuildSettings.TryGetConfigObject(key, out UnityEngine.Object existing) && existing != null)
                {
                    ConfigureXrealSettingsFields(existing);
                    EditorUtility.SetDirty(existing);
                    AssetDatabase.SaveAssets();
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

                // SDK が意図する構成に合わせて XREALSettings のフィールドを設定する。
                // (以前は空の設定を作るだけで、StereoRendering や InitialTrackingType が
                //  プロジェクト設定に反映されず、XREAL の描画/トラッキングが最適でなかった)
                ConfigureXrealSettingsFields(settingsAsset);

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

        /// <summary>
        /// XREALSettings（SDKのScriptableObject）に、SDKが意図する値を reflection で設定する。
        /// SDK側フィールド:
        ///   StereoRendering (enum StereoRenderingMode)  -> SinglePassInstanced
        ///   InitialTrackingType (enum TrackingType)     -> プロジェクトの trackingMode から map
        /// SDKのバージョン差やフィールド有無に強いよう、存在するものだけ best-effort で設定する。
        /// </summary>
        private static void ConfigureXrealSettingsFields(UnityEngine.Object settingsAsset)
        {
            if (settingsAsset == null) return;
            try
            {
                // ステレオ描画: SDK 既定と同じ SinglePassInstanced に統一（パフォーマンス最適）
                SetEnumFieldByName(settingsAsset, "StereoRendering", "SinglePassInstanced");

                // トラッキング種別: プロジェクトの arSettings.trackingMode を XREAL の enum に map
                //   6dof        -> MODE_6DOF
                //   3dof        -> MODE_3DOF
                //   head_locked -> MODE_0DOF (頭固定HUDは0DoFが自然)
                var trackingMode = ReadProjectTrackingMode();
                string xrealTracking;
                switch (trackingMode)
                {
                    case "3dof": xrealTracking = "MODE_3DOF"; break;
                    case "head_locked": xrealTracking = "MODE_0DOF"; break;
                    case "6dof":
                    default: xrealTracking = "MODE_6DOF"; break;
                }
                SetEnumFieldByName(settingsAsset, "InitialTrackingType", xrealTracking);

                // SupportMultiResume は SDK 既定が true。true のままだと
                // XREALManifestProvider が manifest/application/activity/intent-filter を
                // 丸ごと削除するため、Adapters/XREAL_One/AndroidManifest.xml に書いた
                // MAIN/LAUNCHER も消えて「インストールしてもアイコンが出ない／起動できない」
                // 状態になる。Arsist は自前でランチャー用 intent-filter を持つので false にする。
                var multiResumeApplied = SetBoolFieldByName(settingsAsset, "SupportMultiResume", false);

                Debug.Log($"[Arsist-{ADAPTER_ID}] XREALSettings configured (Stereo=SinglePassInstanced, Tracking={xrealTracking} from '{trackingMode}', SupportMultiResume=false applied={multiResumeApplied})");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to configure XREALSettings fields (best-effort): {e.Message}");
            }
        }

        /// <summary>
        /// public bool フィールドを best-effort に設定する。
        /// フィールドが存在しない SDK バージョンでは静かにスキップし、設定できたかを返す。
        /// </summary>
        private static bool SetBoolFieldByName(object target, string fieldName, bool value)
        {
            try
            {
                var fi = target.GetType().GetField(fieldName,
                    System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
                if (fi == null || fi.FieldType != typeof(bool)) return false;
                fi.SetValue(target, value);
                return true;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] SetBoolFieldByName({fieldName}={value}) failed: {e.Message}");
                return false;
            }
        }

        /// <summary>
        /// public フィールド（enum型）を、enum値の名前で best-effort に設定する。
        /// フィールドや enum 値が存在しない SDK バージョンでは静かにスキップする。
        /// </summary>
        private static void SetEnumFieldByName(object target, string fieldName, string enumValueName)
        {
            try
            {
                var fi = target.GetType().GetField(fieldName,
                    System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
                if (fi == null || !fi.FieldType.IsEnum) return;
                if (!Enum.IsDefined(fi.FieldType, enumValueName)) return;
                var value = Enum.Parse(fi.FieldType, enumValueName);
                fi.SetValue(target, value);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] SetEnumFieldByName({fieldName}={enumValueName}) failed: {e.Message}");
            }
        }

        /// <summary>
        /// 生成された manifest.json から arSettings.trackingMode を読む（"6dof"/"3dof"/"head_locked"）。
        /// Newtonsoft への依存を避けるため軽量な正規表現で抽出し、失敗時は "6dof" を返す。
        /// </summary>
        private static string ReadProjectTrackingMode()
        {
            try
            {
                var manifestPath = Path.Combine(Application.dataPath, "ArsistGenerated", "manifest.json");
                if (!File.Exists(manifestPath)) return "6dof";
                var text = File.ReadAllText(manifestPath);
                var m = System.Text.RegularExpressions.Regex.Match(
                    text, "\"trackingMode\"\\s*:\\s*\"(?<v>[^\"]+)\"");
                if (m.Success)
                {
                    var v = m.Groups["v"].Value.Trim().ToLowerInvariant();
                    if (v == "3dof" || v == "6dof" || v == "head_locked") return v;
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist-{ADAPTER_ID}] Failed to read trackingMode from manifest (default 6dof): {e.Message}");
            }
            return "6dof";
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
            // NOTE: Application.targetFrameRate はランタイム設定なので、ここ（Editor/ビルド時）で
            // 設定してもAPKには反映されない。実際の適用は Arsist.Runtime.XROriginSetup が行う。

            // バッチモードでは変更が ProjectSettings に書き戻されないことがあるため明示的に保存する
            AssetDatabase.SaveAssets();

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
                application.SetAttribute("usesCleartextTraffic", "http://schemas.android.com/apk/res/android", "true");

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
        android:theme=""@style/UnityThemeSelector""
        android:usesCleartextTraffic=""true"">
        
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
