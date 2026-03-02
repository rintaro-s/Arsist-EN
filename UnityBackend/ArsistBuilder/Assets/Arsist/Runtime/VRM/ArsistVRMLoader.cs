// ==============================================
// Arsist Engine - VRM Loader
// Assets/Arsist/Runtime/VRM/ArsistVRMLoader.cs
// ==============================================
using System;
using System.Collections;
using System.IO;
using System.Reflection;
using UnityEngine;
using UnityEngine.Networking;

namespace Arsist.Runtime.VRM
{
    /// <summary>
    /// VRMモデルをロードするためのユーティリティクラス
    /// UniVRM 0.131.0 以上をサポート
    /// </summary>
    public class ArsistVRMLoader : MonoBehaviour
    {
        /// <summary>
        /// VRMファイルをロードする（非同期）
        /// StreamingAssets または絶対パスからのロード
        /// </summary>
        public IEnumerator LoadVRMAsync(string vrmPath, Action<GameObject> onLoaded, Action<string> onError)
        {
            if (string.IsNullOrEmpty(vrmPath))
            {
                onError?.Invoke("VRM path is null or empty");
                yield break;
            }

            byte[] vrmData = null;

            // --- ステップ 1: VRMデータを取得 ---
            if (Application.platform == RuntimePlatform.Android)
            {
                // Android: StreamingAssets からロード
                if (!vrmPath.StartsWith("jar:"))
                {
                    vrmPath = Path.Combine(Application.streamingAssetsPath, vrmPath);
                }
                yield return LoadVRMFromAndroidStreamingAssets(vrmPath, onLoaded, onError);
                yield break;
            }
            else if (vrmPath.StartsWith("http"))
            {
                // Web: URLからロード
                yield return LoadVRMFromUrl(vrmPath, onLoaded, onError);
                yield break;
            }
            else
            {
                // ローカル: ファイルパスからロード
                if (!Path.IsPathRooted(vrmPath))
                {
                    vrmPath = Path.Combine(Application.streamingAssetsPath, vrmPath);
                }

                if (!File.Exists(vrmPath))
                {
                    onError?.Invoke($"VRM file not found: {vrmPath}");
                    yield break;
                }

                try
                {
                    vrmData = File.ReadAllBytes(vrmPath);
                }
                catch (Exception ex)
                {
                    onError?.Invoke($"Failed to read VRM file: {ex.Message}");
                    yield break;
                }
            }

            if (vrmData == null || vrmData.Length == 0)
            {
                onError?.Invoke("VRM file is empty");
                yield break;
            }

            // --- ステップ 2: VRMをロード ---
            yield return LoadVRMFromBytes(vrmData, vrmPath, onLoaded, onError);
        }

        /// <summary>
        /// VRMバイト列からロード（VRM0.x → VRM1.0 のデュアルパス）
        /// </summary>
        private IEnumerator LoadVRMFromBytes(byte[] vrmData, string vrmPath, Action<GameObject> onLoaded, Action<string> onError)
        {
            Debug.Log($"[ArsistVRMLoader] Loading VRM from bytes: {vrmPath} ({vrmData.Length} bytes)");

            // ── ステップ1: VRM1.0 ローダーを優先して試行 ──
            // UniVRM 0.131+ では Vrm10.LoadBytesAsync が VRM1.0 を正しく Humanoid で読める
            var vrm10Loaded = false;
            GameObject vrm10Instance = null;

            var vrm10Type = ResolveType("UniVRM10.Vrm10");
            if (vrm10Type != null)
            {
                Debug.Log("[ArsistVRMLoader] VRM1.0 loader (UniVRM10.Vrm10) found. Trying VRM1.0 path first...");
                var loadBytes10 = vrm10Type.GetMethod("LoadBytesAsync", BindingFlags.Public | BindingFlags.Static);
                if (loadBytes10 != null)
                {
                    object task10 = null;
                    try
                    {
                        // UniVRM10.Vrm10.LoadBytesAsync(byte[] bytes, bool canLoadVrm0X = true, ...)
                        var paramInfos = loadBytes10.GetParameters();
                        var args10 = new object[paramInfos.Length];
                        for (int i = 0; i < paramInfos.Length; i++)
                        {
                            var pi = paramInfos[i];
                            if (pi.ParameterType == typeof(byte[]))
                                args10[i] = vrmData;
                            else if (pi.ParameterType == typeof(string))
                                args10[i] = vrmPath;
                            else if (pi.ParameterType == typeof(bool) && pi.Name == "canLoadVrm0X")
                                args10[i] = true;  // VRM0.x も読めるようにする
                            else if (pi.HasDefaultValue)
                                args10[i] = pi.DefaultValue;
                            else
                                args10[i] = null;
                        }
                        task10 = loadBytes10.Invoke(null, args10);
                    }
                    catch (Exception ex)
                    {
                        Debug.LogWarning($"[ArsistVRMLoader] VRM1.0 loader invoke failed: {ex.InnerException?.Message ?? ex.Message}");
                    }

                    if (task10 != null)
                    {
                        yield return WaitForTask(task10);
                        var result10 = ExtractTaskResult(task10);
                        if (result10 != null)
                        {
                            var rt10 = result10.GetType();
                            var rootProp10 = rt10.GetProperty("Root") ?? rt10.GetProperty("gameObject");
                            vrm10Instance = rootProp10?.GetValue(result10) as GameObject;
                            if (vrm10Instance != null)
                            {
                                var anim10 = vrm10Instance.GetComponent<Animator>();
                                if (anim10 != null && anim10.isHuman)
                                {
                                    vrm10Loaded = true;
                                    Debug.Log($"[ArsistVRMLoader] ✅ VRM loaded via VRM1.0 path: {vrm10Instance.name} (Humanoid ✓)");
                                    onLoaded?.Invoke(vrm10Instance);
                                    yield break;
                                }
                                else
                                {
                                    Debug.Log($"[ArsistVRMLoader] VRM1.0 loaded '{vrm10Instance.name}' but no Humanoid. Falling through...");
                                    // VRM1.0でもHumanoidなしなら保持して後で使う
                                    vrm10Loaded = true;
                                }
                            }
                        }
                    }
                }
            }

            // ── ステップ2: VRM0.x ローダーを試行 ──
            var vrmUtilityType = ResolveType("VRM.VrmUtility");
            if (vrmUtilityType == null)
            {
                // VRM0.x ローダーなし: VRM1.0の結果があればそれを使う
                if (vrm10Loaded && vrm10Instance != null)
                {
                    Debug.Log("[ArsistVRMLoader] VRM0.x loader not found, using VRM1.0 result.");
                    onLoaded?.Invoke(vrm10Instance);
                    yield break;
                }
                onError?.Invoke("UniVRM runtime library not found. Please import UniVRM-0.131.0 or later into Unity project.");
                yield break;
            }

            var loadBytesAsync = vrmUtilityType.GetMethod("LoadBytesAsync", BindingFlags.Public | BindingFlags.Static);
            if (loadBytesAsync == null)
            {
                if (vrm10Loaded && vrm10Instance != null)
                {
                    onLoaded?.Invoke(vrm10Instance);
                    yield break;
                }
                onError?.Invoke("UniVRM VrmUtility.LoadBytesAsync was not found");
                yield break;
            }

            // Resolve IAwaitCaller type for better async handling
            var awaitCallerType = ResolveType("UniGLTF.AwaitCaller.ImmediateCaller") ?? ResolveType("UniGLTF.IAwaitCaller");
            object awaitCaller = null;
            
            if (awaitCallerType != null)
            {
                try
                {
                    awaitCaller = Activator.CreateInstance(awaitCallerType);
                }
                catch
                {
                    Debug.LogWarning("[ArsistVRMLoader] Failed to create IAwaitCaller, using null");
                }
            }

            object taskObj = null;
            try
            {
                var args = new object[]
                {
                    vrmPath,
                    vrmData,
                    awaitCaller,                      // IAwaitCaller (with fallback)
                    null,                             // MaterialGeneratorCallback
                    null,                             // MetaCallback
                    null,                             // ITextureDeserializer
                    false,                            // loadAnimation
                    null                              // IVrm0XSpringBoneRuntime
                };
                taskObj = loadBytesAsync.Invoke(null, args);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[ArsistVRMLoader] ❌ Failed to invoke VrmUtility.LoadBytesAsync: {ex.Message}");
                if (ex.InnerException != null)
                {
                    Debug.LogError($"[ArsistVRMLoader] Inner Exception: {ex.InnerException.Message}");
                }
                // VRM0.x失敗: VRM1.0の結果があればそれを使う
                if (vrm10Loaded && vrm10Instance != null)
                {
                    Debug.Log("[ArsistVRMLoader] Falling back to VRM1.0 result");
                    onLoaded?.Invoke(vrm10Instance);
                    yield break;
                }
                onError?.Invoke($"Failed to invoke UniVRM loader: {ex.Message}");
                yield break;
            }

            if (taskObj == null)
            {
                if (vrm10Loaded && vrm10Instance != null)
                {
                    onLoaded?.Invoke(vrm10Instance);
                    yield break;
                }
                onError?.Invoke("UniVRM loader returned null task");
                yield break;
            }

            yield return WaitForTask(taskObj);

            var isFaultedProp = taskObj.GetType().GetProperty("IsFaulted");
            var isFaulted = (bool)(isFaultedProp?.GetValue(taskObj) ?? false);
            if (isFaulted)
            {
                var exceptionProp = taskObj.GetType().GetProperty("Exception");
                Exception exceptionObj = null;
                try { exceptionObj = exceptionProp?.GetValue(taskObj) as Exception; } catch { }
                
                var err = exceptionObj?.InnerException?.Message ?? exceptionObj?.Message ?? "Unknown UniVRM task error";
                Debug.LogError($"[ArsistVRMLoader] ❌ VRM0.x task faulted: {err}");

                // VRM0.x失敗: VRM1.0の結果があればそれを使う
                if (vrm10Loaded && vrm10Instance != null)
                {
                    Debug.Log("[ArsistVRMLoader] VRM0.x failed, using VRM1.0 result");
                    onLoaded?.Invoke(vrm10Instance);
                    yield break;
                }
                onError?.Invoke($"UniVRM task failed: {err}");
                yield break;
            }

            object runtimeInstance = ExtractTaskResult(taskObj);
            if (runtimeInstance == null)
            {
                if (vrm10Loaded && vrm10Instance != null)
                {
                    onLoaded?.Invoke(vrm10Instance);
                    yield break;
                }
                onError?.Invoke("UniVRM load result is null");
                yield break;
            }

            var runtimeType = runtimeInstance.GetType();
            var rootProp = runtimeType.GetProperty("Root") ?? runtimeType.GetProperty("gameObject");
            var vrmInstance = rootProp?.GetValue(runtimeInstance) as GameObject;

            if (vrmInstance == null)
            {
                if (vrm10Loaded && vrm10Instance != null)
                {
                    onLoaded?.Invoke(vrm10Instance);
                    yield break;
                }
                onError?.Invoke("VRM root GameObject is null");
                yield break;
            }

            var animator = vrmInstance.GetComponent<Animator>();
            bool hasHumanoid = animator != null && animator.isHuman;

            // VRM0.xの結果がHumanoidなら採用
            if (hasHumanoid)
            {
                Debug.Log($"[ArsistVRMLoader] ✅ VRM loaded via VRM0.x path: {vrmInstance.name} (Humanoid ✓)");
                onLoaded?.Invoke(vrmInstance);
                yield break;
            }

            // VRM0.xもHumanoidなし: VRM1.0結果を優先（存在すれば）
            if (vrm10Loaded && vrm10Instance != null)
            {
                Debug.Log($"[ArsistVRMLoader] VRM0.x loaded as '{vrmInstance.name}' without Humanoid. Using VRM1.0 result instead.");
                // VRM0.xの結果を破棄
                UnityEngine.Object.Destroy(vrmInstance);
                onLoaded?.Invoke(vrm10Instance);
                yield break;
            }

            // 両方ともHumanoidなし: VRM0.xの結果を使用
            Debug.LogWarning($"[ArsistVRMLoader] ⚠️ VRM loaded as '{vrmInstance.name}' without Humanoid Animator (both paths tried)");
            onLoaded?.Invoke(vrmInstance);
        }

        /// <summary>
        /// Task の完了を待つヘルパー
        /// </summary>
        private IEnumerator WaitForTask(object taskObj)
        {
            var taskType = taskObj.GetType();
            var isCompletedProp = taskType.GetProperty("IsCompleted");
            int waitFrames = 0;
            while (!(bool)(isCompletedProp?.GetValue(taskObj) ?? true))
            {
                waitFrames++;
                if (waitFrames > 1000)
                    yield break;
                yield return null;
            }
        }

        /// <summary>
        /// Task の Result を安全に抽出するヘルパー
        /// </summary>
        private object ExtractTaskResult(object taskObj)
        {
            try
            {
                var taskType = taskObj.GetType();
                var isFaultedProp = taskType.GetProperty("IsFaulted");
                if ((bool)(isFaultedProp?.GetValue(taskObj) ?? false))
                    return null;

                var resultProp = taskType.GetProperty("Result");
                if (resultProp == null) return null;
                return resultProp.GetValue(taskObj);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[ArsistVRMLoader] ExtractTaskResult failed: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// URLからVRMをロード
        /// </summary>
        private IEnumerator LoadVRMFromUrl(string url, Action<GameObject> onLoaded, Action<string> onError)
        {
            using (UnityWebRequest req = UnityWebRequest.Get(url))
            {
                yield return req.SendWebRequest();

                if (req.result != UnityWebRequest.Result.Success)
                {
                    onError?.Invoke($"Failed to download VRM from URL: {req.error}");
                    yield break;
                }

                byte[] vrmData = req.downloadHandler.data;
                yield return LoadVRMFromBytes(vrmData, url, onLoaded, onError);
            }
        }

        /// <summary>
        /// StreamingAssetsからVRMをロードする
        /// </summary>
        public IEnumerator LoadVRMFromStreamingAssets(string relativePath, Action<GameObject> onLoaded, Action<string> onError)
        {
            if (string.IsNullOrEmpty(relativePath))
            {
                onError?.Invoke("Relative path is null or empty");
                yield break;
            }

            var normalizedRelativePath = relativePath
                .Replace('\\', '/')
                .TrimStart('/');
            string fullPath = Path.Combine(Application.streamingAssetsPath, normalizedRelativePath);
            Debug.Log($"[ArsistVRMLoader] StreamingAssets full path: {fullPath}");
            
            // Android は UnityWebRequest で jar:// から読む必要がある
            if (Application.platform == RuntimePlatform.Android)
            {
                var androidUri = BuildAndroidStreamingAssetsUri(normalizedRelativePath);
                Debug.Log($"[ArsistVRMLoader] Android StreamingAssets URI: {androidUri}");
                yield return LoadVRMFromAndroidStreamingAssets(androidUri, onLoaded, onError);
            }
            else
            {
                // その他のプラットフォームは File.ReadAllBytes で読む
                if (!File.Exists(fullPath))
                {
                    onError?.Invoke($"VRM file not found: {fullPath}");
                    yield break;
                }

                byte[] vrmData = null;
                try
                {
                    vrmData = File.ReadAllBytes(fullPath);
                }
                catch (Exception ex)
                {
                    onError?.Invoke($"Failed to read VRM file: {ex.Message}");
                    yield break;
                }

                if (vrmData != null && vrmData.Length > 0)
                {
                    yield return LoadVRMFromBytes(vrmData, fullPath, onLoaded, onError);
                }
                else
                {
                    onError?.Invoke("VRM file is empty");
                }
            }
        }

        private static string BuildAndroidStreamingAssetsUri(string relativePath)
        {
            var basePath = Application.streamingAssetsPath.Replace('\\', '/');
            var normalizedRelativePath = (relativePath ?? string.Empty).Replace('\\', '/').TrimStart('/');

            if (string.IsNullOrEmpty(normalizedRelativePath))
            {
                return basePath;
            }

            if (basePath.EndsWith("/"))
            {
                return $"{basePath}{normalizedRelativePath}";
            }

            return $"{basePath}/{normalizedRelativePath}";
        }

        /// <summary>
        /// Android StreamingAssetsからVRMをロードする（UnityWebRequest使用）
        /// </summary>
        private IEnumerator LoadVRMFromAndroidStreamingAssets(string streamingAssetsUri, Action<GameObject> onLoaded, Action<string> onError)
        {
            Debug.Log($"[ArsistVRMLoader] Loading from Android URI: {streamingAssetsUri}");
            using (UnityWebRequest request = UnityWebRequest.Get(streamingAssetsUri))
            {
                yield return request.SendWebRequest();

                if (request.result != UnityWebRequest.Result.Success)
                {
                    onError?.Invoke($"Failed to load VRM from Android StreamingAssets: {request.error} (uri={streamingAssetsUri})");
                    yield break;
                }

                byte[] vrmData = request.downloadHandler.data;
                if (vrmData == null || vrmData.Length == 0)
                {
                    onError?.Invoke("Downloaded VRM data is empty");
                    yield break;
                }

                yield return LoadVRMFromBytes(vrmData, streamingAssetsUri, onLoaded, onError);
            }
        }

        /// <summary>
        /// VRMインスタンスにスクリプト制御用のコンポーネントを追加
        /// </summary>
        public static void SetupVRMForScripting(GameObject vrmRoot, string assetId)
        {
            if (vrmRoot == null || string.IsNullOrEmpty(assetId))
            {
                Debug.LogWarning("[ArsistVRMLoader] Invalid VRM root or asset ID");
                return;
            }

            // VRMWrapperに登録
            var scriptEngine = Scripting.ScriptEngineManager.Instance;
            if (scriptEngine != null)
            {
                scriptEngine.VRMWrapper.RegisterVRM(assetId, vrmRoot);
                Debug.Log($"[ArsistVRMLoader] Registered VRM '{assetId}' for scripting");
            }

            // SceneWrapperにも登録（scene APIでも操作可能にする）
            if (scriptEngine != null)
            {
                scriptEngine.SceneWrapper.RegisterObject(assetId, vrmRoot);
            }
        }

        /// <summary>
        /// フルネームからタイプを解決する（reflection helper）
        /// </summary>
        private static Type ResolveType(string fullName)
        {
            if (string.IsNullOrEmpty(fullName))
                return null;

            try
            {
                // 現在ロードされているすべてのアセンブリから検索
                foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
                {
                    try
                    {
                        var type = assembly.GetType(fullName, false);
                        if (type != null)
                            return type;
                    }
                    catch
                    {
                        // アセンブリによってはエラーが発生する可能性があるため無視
                    }
                }
            }
            catch
            {
                // 全体エラーも無視
            }

            return null;
        }    }
}