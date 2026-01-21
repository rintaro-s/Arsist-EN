using System.Threading.Tasks;
using UnityEngine;
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
                var gltf = new GltfImport();
                
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

                bool success = await gltf.Load(fullPath);
                
                if (success)
                {
                    await gltf.InstantiateMainSceneAsync(transform);
                    Debug.Log($"[ArsistModelLoader] Loaded: {modelPath}");
                }
                else
                {
                    Debug.LogError($"[ArsistModelLoader] Failed to load: {modelPath} (fullPath={fullPath})");
                }

                if (destroyAfterLoad)
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
    }
}
