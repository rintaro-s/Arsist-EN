// ==============================================
// Arsist Engine - VRM Expression Controller
// Assets/Arsist/Runtime/VRM/VRMExpressionController.cs
// ==============================================
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.VRM
{
    /// <summary>
    /// VRM の表情（BlendShape）を確実に制御する（確実な実装）
    /// SkinnedMeshRenderer.SetBlendShapeWeight() を使用して直接操作
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class VRMExpressionController : MonoBehaviour
    {
        // BlendShape キャッシュ構造体
        private struct BlendShapeInfo
        {
            public SkinnedMeshRenderer Renderer;
            public int BlendShapeIndex;
        }

        private Dictionary<string, BlendShapeInfo> _expressionCache = new Dictionary<string, BlendShapeInfo>();

        private void Awake()
        {
            BuildExpressionCache();
        }

        private void BuildExpressionCache()
        {
            _expressionCache.Clear();

            // VRM モデル内のすべての SkinnedMeshRenderer を取得
            var skinnedMeshes = GetComponentsInChildren<SkinnedMeshRenderer>(true);
            
            if (skinnedMeshes.Length == 0)
            {
                Debug.LogWarning("[VRMExpressionController] ✗ No SkinnedMeshRenderer found. Cannot build expression cache.");
                return;
            }

            foreach (var smr in skinnedMeshes)
            {
                if (smr == null || smr.sharedMesh == null) continue;

                // 各 SkinnedMeshRenderer 内のすべての BlendShape を列挙
                int blendCount = smr.sharedMesh.blendShapeCount;
                for (int i = 0; i < blendCount; i++)
                {
                    string blendShapeName = smr.sharedMesh.GetBlendShapeName(i);
                    if (!string.IsNullOrEmpty(blendShapeName))
                    {
                        // 同じ名前の BlendShape は最後に見つかったものを使用
                        var info = new BlendShapeInfo { Renderer = smr, BlendShapeIndex = i };
                        _expressionCache[blendShapeName] = info;
                    }
                }
            }

            if (_expressionCache.Count == 0)
            {
                Debug.LogWarning("[VRMExpressionController] ✗ No BlendShapes found. VRM model may not have expressions.");
            }
            else
            {
                Debug.Log($"[VRMExpressionController] ✅ Expression cache built: {_expressionCache.Count} expressions available");
            }
        }

        /// <summary>
        /// 表情を設定（0-100）
        /// </summary>
        public bool SetExpression(string expressionName, float value)
        {
            if (string.IsNullOrEmpty(expressionName))
            {
                return false;
            }

            if (!_expressionCache.TryGetValue(expressionName, out BlendShapeInfo info))
            {
                Debug.LogWarning($"[VRMExpressionController] ✗ Expression '{expressionName}' not found");
                return false;
            }

            // BlendShapeWeight は 0-100 の範囲にクランプして設定
            float clampedValue = Mathf.Clamp(value, 0f, 100f);
            info.Renderer.SetBlendShapeWeight(info.BlendShapeIndex, clampedValue);
            return true;
        }

        /// <summary>
        /// すべての表情をリセット（0 に設定）
        /// </summary>
        public void ResetAllExpressions()
        {
            foreach (KeyValuePair<string, BlendShapeInfo> kvp in _expressionCache)
            {
                BlendShapeInfo info = kvp.Value;
                info.Renderer.SetBlendShapeWeight(info.BlendShapeIndex, 0f);
            }
        }

        /// <summary>
        /// 利用可能な表情一覧を取得
        /// </summary>
        public List<string> GetAvailableExpressions()
        {
            return new List<string>(_expressionCache.Keys);
        }
    }
}
