using System;
using System.Threading.Tasks;
using UnityEngine;
#if GLTFAST
using UnityEngine.Networking;
#endif
#if GLTFAST
using GLTFast;
#endif

namespace Arsist.Runtime
{
    /// <summary>
    /// ランタイムでGLB/GLTFモデルを読み込むコンポーネント
    /// glTFastパッケージが必要
    /// </summary>
    public class ArsistModelRuntimeLoader : MonoBehaviour
    {
        [Tooltip("モデルファイルのパス（StreamingAssets相対またはURL）")]
        public string modelPath;
        
        [Tooltip("読み込み完了後に自動でこのコンポーネントを削除")]
        public bool destroyAfterLoad = true;

        private async void Start()
        {
            if (string.IsNullOrEmpty(modelPath))
            {
                Debug.LogWarning("[ArsistModelLoader] modelPath is empty");
                return;
            }

            await LoadModelAsync();
        }

        private async Task LoadModelAsync()
        {
#if GLTFAST
            try
            {
                // Null check: このコンポーネントがアタッチされているGameObjectが破棄されていないか確認
                if (this == null || gameObject == null)
                {
                    Debug.LogWarning("[ArsistModelLoader] GameObject destroyed before loading started");
                    return;
                }

                var gltf = new GltfImport();
                if (gltf == null)
                {
                    Debug.LogError("[ArsistModelLoader] Failed to create GltfImport instance");
                    return;
                }
                
                // StreamingAssetsから読む場合
                string fullPath = modelPath;
                if (!modelPath.StartsWith("http") && !System.IO.Path.IsPathRooted(modelPath))
                {
                    // AndroidのStreamingAssetsはAPK内(jar:)になりやすく、Path.Combine だと壊れることがあるので
                    // URLとして扱える形に寄せる。
                    var basePath = Application.streamingAssetsPath;
                    if (!basePath.EndsWith("/")) basePath += "/";
                    fullPath = basePath + modelPath;
                }

#if !UNITY_ANDROID || UNITY_EDITOR
                // エディタ/PCではローカルファイルとして存在チェックできる
                if (!fullPath.StartsWith("http") && System.IO.Path.IsPathRooted(fullPath) && !System.IO.File.Exists(fullPath))
                {
                    Debug.LogError($"[ArsistModelLoader] File not found: {fullPath} (modelPath={modelPath})");
                    return;
                }
#endif

                Debug.Log($"[ArsistModelLoader] Loading from: {fullPath}");
                bool success = await LoadGltfWithFallbackAsync(gltf, fullPath);
                
                // ロード後のnullチェック
                if (this == null || gameObject == null)
                {
                    Debug.LogWarning("[ArsistModelLoader] GameObject destroyed during loading");
                    return;
                }
                
                if (success)
                {
                    // transform が null でないことを確認
                    if (transform != null)
                    {
                        await gltf.InstantiateMainSceneAsync(transform);
                        Debug.Log($"[ArsistModelLoader] Loaded: {modelPath}");
                    }
                    else
                    {
                        Debug.LogError($"[ArsistModelLoader] Transform is null: {modelPath}");
                    }
                }
                else
                {
                    Debug.LogError($"[ArsistModelLoader] Failed to load: {modelPath} (fullPath={fullPath})");
                }

                if (destroyAfterLoad && this != null)
                {
                    Destroy(this);
                }
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[ArsistModelLoader] Exception while loading: {modelPath}");
                Debug.LogException(e);
            }
#else
            Debug.LogWarning("[ArsistModelLoader] glTFast package not installed. Model will not load.");
            await Task.CompletedTask;
#endif
        }

#if GLTFAST
        private async Task<bool> LoadGltfWithFallbackAsync(GltfImport gltf, string fullPath)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            // AndroidのStreamingAssets(jar:)はgltf.Loadが失敗するケースがあるため、バイナリ読み込みを試す
            if (fullPath.StartsWith("jar:", StringComparison.OrdinalIgnoreCase) ||
                fullPath.StartsWith("content:", StringComparison.OrdinalIgnoreCase) ||
                fullPath.StartsWith("file:///android_asset", StringComparison.OrdinalIgnoreCase))
            {
                var data = await DownloadBytesAsync(fullPath);
                if (data == null || data.Length == 0)
                {
                    Debug.LogError($"[ArsistModelLoader] Failed to download model bytes: {fullPath}");
                    return false;
                }
                return await TryLoadGltfBinaryAsync(gltf, data, fullPath);
            }
#endif

            return await gltf.Load(fullPath);
        }

        private async Task<bool> DownloadBytesAsync(string url)
        {
            using (var req = UnityWebRequest.Get(url))
            {
                var op = req.SendWebRequest();
                while (!op.isDone)
                {
                    await Task.Yield();
                }

                if (req.result != UnityWebRequest.Result.Success)
                {
                    Debug.LogError($"[ArsistModelLoader] Download failed: {req.error} ({url})");
                    return null;
                }

                return req.downloadHandler?.data;
            }
        }

        private async Task<bool> TryLoadGltfBinaryAsync(GltfImport gltf, byte[] data, string sourceUrl)
        {
            var mi = typeof(GltfImport).GetMethod("LoadGltfBinary");
            if (mi == null)
            {
                Debug.LogWarning("[ArsistModelLoader] LoadGltfBinary not available, falling back to Load(string)");
                return await gltf.Load(sourceUrl);
            }

            object result = null;
            var parameters = mi.GetParameters();
            try
            {
                if (parameters.Length == 1)
                {
                    result = mi.Invoke(gltf, new object[] { data });
                }
                else if (parameters.Length == 2)
                {
                    result = mi.Invoke(gltf, new object[] { data, new Uri(sourceUrl) });
                }
                else if (parameters.Length >= 3)
                {
                    result = mi.Invoke(gltf, new object[] { data, new Uri(sourceUrl), null });
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[ArsistModelLoader] LoadGltfBinary invoke failed: {e.Message}");
            }

            if (result is Task<bool> taskBool)
            {
                return await taskBool;
            }

            if (result is bool boolResult)
            {
                return boolResult;
            }

            Debug.LogWarning("[ArsistModelLoader] LoadGltfBinary returned unexpected type, falling back to Load(string)");
            return await gltf.Load(sourceUrl);
        }
#endif
    }
}
