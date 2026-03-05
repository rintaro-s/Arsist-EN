// ==============================================
// Arsist Engine - VRM Loader Task
// Assets/Arsist/Runtime/VRM/ArsistVRMLoaderTask.cs
// ==============================================
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Arsist.Runtime.Scripting;

namespace Arsist.Runtime.VRM
{
    /// <summary>
    /// VRM ファイルをストリーミングアセットからロード
    /// ビルドパイプラインで GameObject に添付されるコンポーネント
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class ArsistVRMLoaderTask : MonoBehaviour
    {
        [SerializeField] public string vrmPath;
        [SerializeField] public string assetId;

        /// <summary>
        /// ロード中の VRM 数。ScriptTriggerManager がこの値を参照して
        /// 全 VRM がロード完了するまでスクリプト実行を遅延する。
        /// </summary>
        public static int PendingCount { get; private set; }

        private void Awake()
        {
            PendingCount++;
            Debug.Log($"[ArsistVRMLoaderTask] Pending VRM count: {PendingCount}");
        }

        private void Start()
        {
            if (string.IsNullOrEmpty(vrmPath))
            {
                Debug.LogWarning("[ArsistVRMLoaderTask] VRM path is not set!");
                Destroy(this);
                return;
            }

            StartCoroutine(LoadVRMCoroutine());
        }

        private IEnumerator LoadVRMCoroutine()
        {
            Debug.Log($"[ArsistVRMLoaderTask] Starting VRM load: {vrmPath} (assetId: {assetId})");

            var loaderInstance = gameObject.AddComponent<ArsistVRMLoader>();
            var actualAssetId = assetId ?? gameObject.name;

            // ビルド時に StreamingAssets/VRM にコピーされるため、ファイル名を抽出
            var fileName = System.IO.Path.GetFileName(vrmPath);
            var streamingAssetsPath = $"VRM/{fileName}";
            Debug.Log($"[ArsistVRMLoaderTask] Resolved StreamingAssets path: {streamingAssetsPath}");

            // VRM ファイルをロード
            GameObject vrmInstance = null;
            var error = "";

            yield return loaderInstance.LoadVRMFromStreamingAssets(
                streamingAssetsPath,
                onLoaded: (loadedVRM) =>
                {
                    vrmInstance = loadedVRM;
                    Debug.Log($"[ArsistVRMLoaderTask] ✅ VRM loaded: {loadedVRM.name}");
                },
                onError: (errorMsg) =>
                {
                    error = errorMsg;
                    Debug.LogError($"[ArsistVRMLoaderTask] ❌ Failed to load VRM: {errorMsg}");
                }
            );

            if (vrmInstance != null)
            {
                // VRM をこのゲームオブジェクトの子として配置
                //
                // 【Arsist 座標系】
                //   エディタ X+ = 左、Z+ = 前 → Unity X+ = 右、Z+ = 前
                //   → wrapper の localPosition は (-px, py, pz) として X 反転済み
                //   → wrapper の localRotation は Quaternion.identity（ユーザー回転 rx/ry/rz が 0 の場合）
                //      ユーザーが回転を設定した場合は Mirror_X Quaternion が wrapper に適用済み
                //
                // ※ localRotation に追加補正はしない。
                //   VRM 1.0 は UniVRM が glTF→Unity 変換で Y 軸 180° をルートに焼き込む。
                //   ここで identity に上書きすると +Z 向きになる（後ろ向き）。
                //   VRM 0.x は UniVRM が補正済みで通常 -Z 向き（正面）。
                //
                vrmInstance.transform.SetParent(gameObject.transform, false);
                vrmInstance.transform.localPosition = Vector3.zero;

                // 表示保証（見えない経路を潰す）
                EnsureVRMVisible(vrmInstance);

                // スクリプトエンジンに登録（初期化タイミングずれを吸収）
                yield return RegisterVRMWhenScriptEngineReady(actualAssetId, vrmInstance);
            }
            else
            {
                Debug.LogError($"[ArsistVRMLoaderTask] ❌ VRM load failed: {error}");
            }

            // ペンディングカウントをデクリメント
            PendingCount = Mathf.Max(0, PendingCount - 1);
            Debug.Log($"[ArsistVRMLoaderTask] VRM load completed. Pending count: {PendingCount}");

            // このコンポーネントは不要になったので削除
            Destroy(loaderInstance);
            Destroy(this);
        }

        private IEnumerator RegisterVRMWhenScriptEngineReady(string actualAssetId, GameObject vrmInstance)
        {
            const float timeoutSeconds = 10f;
            var elapsed = 0f;

            while (ScriptEngineManager.Instance == null && elapsed < timeoutSeconds)
            {
                elapsed += Time.unscaledDeltaTime;
                yield return null;
            }

            var scriptEngine = ScriptEngineManager.Instance;
            if (scriptEngine == null)
            {
                Debug.LogError($"[ArsistVRMLoaderTask] ❌ ScriptEngineManager not ready. VRM '{actualAssetId}' NOT registered.");
                yield break;
            }

            // Animator を取得
            var animator = vrmInstance.GetComponent<Animator>();
            if (animator == null)
            {
                Debug.LogWarning($"[ArsistVRMLoaderTask] ⚠ No Animator on VRM '{actualAssetId}'");
            }
            else if (!animator.isHuman)
            {
                Debug.LogWarning($"[ArsistVRMLoaderTask] ⚠ Animator is not Humanoid for VRM '{actualAssetId}'");
            }

            // 1. VRMWrapper に登録
            try
            {
                scriptEngine.VRMWrapper.RegisterVRM(actualAssetId, vrmInstance);
                Debug.Log($"[ArsistVRMLoaderTask] ✅ VRM '{actualAssetId}' registered to VRMWrapper");
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[ArsistVRMLoaderTask] Error registering to VRMWrapper: {e.Message}");
            }

            // 2. SceneWrapper に登録
            try
            {
                scriptEngine.SceneWrapper.RegisterObject(actualAssetId, vrmInstance);
                Debug.Log($"[ArsistVRMLoaderTask] ✅ VRM '{actualAssetId}' registered to SceneWrapper");
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[ArsistVRMLoaderTask] Error registering to SceneWrapper: {e.Message}");
            }

            // 3. PropertyController を初期化（無視できる。必須ではない）
            try
            {
                var propertyController = vrmInstance.GetComponent<Arsist.Runtime.Scene.PropertyController>();
                if (propertyController == null)
                {
                    propertyController = vrmInstance.AddComponent<Arsist.Runtime.Scene.PropertyController>();
                }

                if (animator != null)
                {
                    propertyController.Initialize(animator);
                    Debug.Log($"[ArsistVRMLoaderTask] ✅ PropertyController initialized for '{actualAssetId}'");
                }
                else
                {
                    Debug.LogWarning($"[ArsistVRMLoaderTask] ⚠ PropertyController init skipped: No Animator");
                }
            }
            catch (System.Exception e)
            {
                Debug.LogWarning($"[ArsistVRMLoaderTask] PropertyController init failed (non-critical): {e.Message}");
            }

            // 4. VRMBoneController を追加（確実なボーン制御用）
            try
            {
                var boneController = vrmInstance.GetComponent<VRMBoneController>();
                if (boneController == null)
                {
                    boneController = vrmInstance.AddComponent<VRMBoneController>();
                    Debug.Log($"[ArsistVRMLoaderTask] ✅ VRMBoneController added for '{actualAssetId}'");
                }

                if (animator != null && animator.isHuman)
                {
                    var availableBones = boneController.GetAvailableBones();
                    Debug.Log($"[ArsistVRMLoaderTask] ✅ {availableBones.Count} bones available for bone control");
                }
            }
            catch (System.Exception e)
            {
                Debug.LogWarning($"[ArsistVRMLoaderTask] VRMBoneController add failed (non-critical): {e.Message}");
            }

            // 5. VRMExpressionController を追加（表情制御用）
            try
            {
                var expressionController = vrmInstance.GetComponent<VRMExpressionController>();
                if (expressionController == null)
                {
                    expressionController = vrmInstance.AddComponent<VRMExpressionController>();
                    Debug.Log($"[ArsistVRMLoaderTask] ✅ VRMExpressionController added for '{actualAssetId}'");
                }

                var availableExpressions = expressionController.GetAvailableExpressions();
                Debug.Log($"[ArsistVRMLoaderTask] ✅ {availableExpressions.Count} expressions available");
            }
            catch (System.Exception e)
            {
                Debug.LogWarning($"[ArsistVRMLoaderTask] VRMExpressionController add failed (non-critical): {e.Message}");
            }

            // 4. VRMMetadataDisplay を追加（Editor表示用）
            try
            {
                var metadataDisplay = vrmInstance.AddComponent<VRMMetadataDisplay>();
                metadataDisplay.UpdateMetadata(actualAssetId, animator);
                Debug.Log($"[ArsistVRMLoaderTask] ✅ VRMMetadataDisplay added for '{actualAssetId}'");
            }
            catch (System.Exception e)
            {
                Debug.LogWarning($"[ArsistVRMLoaderTask] VRMMetadataDisplay init failed (non-critical): {e.Message}");
            }

            Debug.Log($"[ArsistVRMLoaderTask] ✅✅✅ VRM '{actualAssetId}' initialization complete");
        }

        private void EnsureVRMVisible(GameObject vrmRoot)
        {
            if (vrmRoot == null) return;

            // 1) 非アクティブ経路を潰す
            SetActiveRecursively(vrmRoot, true);

            // 2) レンダラー有効化 + レイヤーをDefaultへ統一
            var renderers = vrmRoot.GetComponentsInChildren<Renderer>(true);
            foreach (var renderer in renderers)
            {
                if (renderer == null) continue;
                renderer.enabled = true;
                renderer.gameObject.layer = 0;
            }

            if (renderers.Length == 0)
            {
                Debug.LogWarning("[ArsistVRMLoaderTask] No renderer found on loaded VRM");
                return;
            }

            // 3) バウンディングを元にサイズを正規化（極小/極大を防ぐ）
            var bounds = ComputeBounds(renderers);
            var height = Mathf.Max(bounds.size.y, 0.0001f);
            if (height < 0.3f || height > 4.0f)
            {
                var targetHeight = 1.6f;
                var scaleFactor = targetHeight / height;
                vrmRoot.transform.localScale = vrmRoot.transform.localScale * scaleFactor;
                Debug.Log($"[ArsistVRMLoaderTask] Normalized VRM scale: x{scaleFactor:F2}");
                bounds = ComputeBounds(renderers);
            }

            // 4) カメラ前へ配置（遠すぎ/近すぎ/背面を防ぐ）
            var cameraTransform = ResolveMainCameraTransform();
            if (cameraTransform != null)
            {
                var center = bounds.center;
                var toModel = center - cameraTransform.position;
                var distance = toModel.magnitude;
                var forwardDot = Vector3.Dot(cameraTransform.forward, toModel.normalized);

                var shouldReposition = distance < 0.2f || distance > 8.0f || forwardDot < 0.2f;
                if (shouldReposition)
                {
                    var targetPos = cameraTransform.position + cameraTransform.forward * 1.5f;
                    targetPos.y = Mathf.Max(cameraTransform.position.y - 0.9f, 0.0f);

                    var offset = targetPos - center;
                    vrmRoot.transform.position += offset;

                    // NOTE:
                    // 向きはエディタ設定（Scene transform）を尊重する。
                    // ここで自動回転すると「エンジンとUnityで向きが違う」問題を誘発するため回転補正は行わない。
                    Debug.Log("[ArsistVRMLoaderTask] ✅ Repositioned VRM: position corrected (rotation preserved)");
                }
            }

            // 5) SkinnedMeshがオフスクリーンで消えないように補強
            var skinnedMeshes = vrmRoot.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            foreach (var skinned in skinnedMeshes)
            {
                if (skinned == null) continue;
                skinned.updateWhenOffscreen = true;
            }

            Debug.Log($"[ArsistVRMLoaderTask] Visibility guard applied: renderers={renderers.Length}, skinned={skinnedMeshes.Length}");
        }

        private static Bounds ComputeBounds(Renderer[] renderers)
        {
            var initialized = false;
            var bounds = new Bounds(Vector3.zero, Vector3.zero);

            foreach (var renderer in renderers)
            {
                if (renderer == null) continue;
                if (!initialized)
                {
                    bounds = renderer.bounds;
                    initialized = true;
                }
                else
                {
                    bounds.Encapsulate(renderer.bounds);
                }
            }

            return bounds;
        }

        private static Transform ResolveMainCameraTransform()
        {
            if (Camera.main != null) return Camera.main.transform;
            var anyCamera = FindAnyObjectByType<Camera>();
            return anyCamera != null ? anyCamera.transform : null;
        }

        private static void SetActiveRecursively(GameObject root, bool active)
        {
            if (root == null) return;

            var stack = new Stack<Transform>();
            stack.Push(root.transform);

            while (stack.Count > 0)
            {
                var current = stack.Pop();
                current.gameObject.SetActive(active);

                for (int i = 0; i < current.childCount; i++)
                {
                    stack.Push(current.GetChild(i));
                }
            }
        }
    }
}
