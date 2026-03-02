// ==============================================
// Arsist Engine - Object Registrar
// Assets/Arsist/Runtime/Scene/ArsistObjectRegistrar.cs
// ==============================================
using System.Collections;
using UnityEngine;

namespace Arsist.Runtime.Scene
{
    /// <summary>
    /// シーンオブジェクト（GLBモデル、プリミティブ等）を SceneWrapper に自動登録する。
    /// ビルドパイプラインで非VRMオブジェクトに自動追加される。
    /// VRM はArsistVRMLoaderTask が登録を担うため、このコンポーネントは不要。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class ArsistObjectRegistrar : MonoBehaviour
    {
        [Tooltip("SceneWrapper に登録する Asset ID")]
        [SerializeField] public string assetId;

        private IEnumerator Start()
        {
            if (string.IsNullOrEmpty(assetId))
            {
                Debug.LogWarning("[ArsistObjectRegistrar] assetId is empty, skipping registration");
                Destroy(this);
                yield break;
            }

            // ScriptEngineManager の初期化を待機（最大10秒）
            float elapsed = 0f;
            while (Scripting.ScriptEngineManager.Instance == null && elapsed < 10f)
            {
                elapsed += Time.unscaledDeltaTime;
                yield return null;
            }

            var engine = Scripting.ScriptEngineManager.Instance;
            if (engine == null)
            {
                Debug.LogError($"[ArsistObjectRegistrar] ScriptEngineManager not found. '{assetId}' NOT registered.");
                Destroy(this);
                yield break;
            }

            // SceneWrapper に登録
            engine.SceneWrapper.RegisterObject(assetId, gameObject);
            Debug.Log($"[ArsistObjectRegistrar] ✅ Registered '{assetId}' -> {gameObject.name}");

            // 登録完了後、自身を削除
            Destroy(this);
        }
    }
}
