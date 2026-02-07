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
                
                // StreamingAssetsから読む場合のパス構築
                string fullPath = modelPath;
                if (!modelPath.StartsWith("http") && !System.IO.Path.IsPathRooted(modelPath))
                {
#if UNITY_ANDROID && !UNITY_EDITOR
                    // Androidの場合：常にfile:///android_asset/スキームを使う
                    fullPath = "file:///android_asset/" + modelPath;
#else
                    // PC/エディタ：StreamingAssets ディレクトリからの相対パス
                    var basePath = Application.streamingAssetsPath;
                    if (!basePath.EndsWith("/") && !basePath.EndsWith("\\")) basePath += "/";
                    fullPath = basePath + modelPath;
#endif
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
                Debug.Log($"[ArsistModelLoader] LoadGltfWithFallbackAsync result: {success}, gltf scene count: {(gltf != null ? "valid" : "null")}");
                
                // ロード後のnullチェック
                if (this == null || gameObject == null)
                {
                    Debug.LogWarning("[ArsistModelLoader] GameObject destroyed during loading");
                    return;
                }
                
                if (success)
                {
                    // gltf と transform が null でないことを確認
                    if (gltf == null)
                    {
                        Debug.LogError($"[ArsistModelLoader] GltfImport became null after load: {modelPath}");
                        return;
                    }
                    
                    if (transform == null)
                    {
                        Debug.LogError($"[ArsistModelLoader] Transform is null: {modelPath}");
                        return;
                    }
                    
                    try
                    {
                        Debug.Log($"[ArsistModelLoader] About to instantiate: {modelPath} (gltf={gltf}, transform={transform})");
                        await gltf.InstantiateMainSceneAsync(transform);
                        Debug.Log($"[ArsistModelLoader] Loaded: {modelPath}");
                    }
                    catch (System.Exception ex)
                    {
                        Debug.LogError($"[ArsistModelLoader] InstantiateMainSceneAsync failed: {ex.Message}");
                        Debug.LogException(ex);
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
            Debug.Log($"[ArsistModelLoader] LoadGltfWithFallbackAsync starting with path: {fullPath}");

#if UNITY_ANDROID && !UNITY_EDITOR
            // Androidでは file:///android_asset/ のパスを使う場合、バイナリロードを試みる
            if (fullPath.StartsWith("file:///android_asset/", StringComparison.OrdinalIgnoreCase))
            {
                Debug.Log("[ArsistModelLoader] Using binary load for Android StreamingAssets");
                var data = await DownloadBytesAsync(fullPath);
                if (data != null && data.Length > 0)
                {
                    Debug.Log($"[ArsistModelLoader] Downloaded {data.Length} bytes");
                    return await TryLoadGltfBinaryAsync(gltf, data, fullPath);
                }
                else
                {
                    Debug.LogWarning("[ArsistModelLoader] Binary download failed, trying gltf.Load");
                }
            }
#endif

            try
            {
                Debug.Log($"[ArsistModelLoader] Calling gltf.Load({fullPath})");
                var result = await gltf.Load(fullPath);
                Debug.Log($"[ArsistModelLoader] gltf.Load returned: {result}");
                
                if (!result)
                {
                    Debug.LogError($"[ArsistModelLoader] gltf.Load returned false for {fullPath}");
                    return false;
                }
                
                // glTFastが正常にロードされたか確認
                Debug.Log("[ArsistModelLoader] glTF load successful");
                return true;
            }
            catch (System.Exception ex)
            {
                Debug.LogError($"[ArsistModelLoader] gltf.Load threw exception: {ex.Message}");
                Debug.LogException(ex);
                return false;
            }
        }

        private async Task<byte[]> DownloadBytesAsync(string url)
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
