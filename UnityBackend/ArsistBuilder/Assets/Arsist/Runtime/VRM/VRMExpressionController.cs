// ==============================================
// Arsist Engine - VRM Expression Controller
// Assets/Arsist/Runtime/VRM/VRMExpressionController.cs
// ==============================================
using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;

namespace Arsist.Runtime.VRM
{
    /// <summary>
    /// VRM の表情を制御するコントローラー。
    ///
    /// UniVRM は VRMBlendShapeProxy (VRM0.x) または Vrm10Runtime (VRM1.0) を
    /// LateUpdate で実行し、SetBlendShapeWeight を上書きする。
    /// このクラスはそれらの公式 API を reflection 経由で呼び出す。
    /// 公式 API が見つからない場合のみ直接 SetBlendShapeWeight を使用する。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class VRMExpressionController : MonoBehaviour
    {
        // ---- VRM0.x BlendShapeProxy ----
        private Component _blendShapeProxy;       // VRMBlendShapeProxy
        private MethodInfo _immSetValueMethod;     // ImmediatelySetValue(BlendShapeKey, float)
        private MethodInfo _createUnknownKey;      // BlendShapeKey.CreateUnknown(string)
        private MethodInfo _createPresetKey;       // BlendShapeKey.CreateFromPreset(BlendShapePreset)
        private Type _blendShapePresetType;

        // ---- VRM1.0 Vrm10Runtime ----
        private object _vrm10Expression;           // Vrm10Runtime.Expression
        private MethodInfo _vrm10SetWeight;        // SetWeight(ExpressionKey, float)
        private MethodInfo _vrm10CreateKey;        // ExpressionKey.CreateFromLabel(string)

        // ---- fallback: 直接 BlendShape ----
        private struct BlendShapeInfo
        {
            public SkinnedMeshRenderer Renderer;
            public int BlendShapeIndex;
        }
        private Dictionary<string, BlendShapeInfo> _fallbackCache = new Dictionary<string, BlendShapeInfo>();
        private bool _useFallback = false;

        private void Awake()
        {
            // capabilities/getInfo 用に BlendShape 名は常に収集しておく
            BuildFallbackCache();
            DetectUniVRMAPIs();
        }

        private void DetectUniVRMAPIs()
        {
            // ---- VRM0.x: VRMBlendShapeProxy を探す ----
            foreach (var comp in GetComponentsInParent<Component>(true))
            {
                if (comp == null) continue;
                var typeName = comp.GetType().Name;
                if (typeName == "VRMBlendShapeProxy")
                {
                    _blendShapeProxy = comp;
                    var proxyType = comp.GetType();
                    _immSetValueMethod = proxyType.GetMethod("ImmediatelySetValue");

                    // BlendShapeKey 型を取得
                    var assembly = proxyType.Assembly;
                    var blendShapeKeyType = assembly.GetType("VRM.BlendShapeKey");
                    if (blendShapeKeyType != null)
                    {
                        _createUnknownKey = blendShapeKeyType.GetMethod("CreateUnknown",
                            BindingFlags.Public | BindingFlags.Static);
                        _createPresetKey = blendShapeKeyType.GetMethod("CreateFromPreset",
                            BindingFlags.Public | BindingFlags.Static);
                        _blendShapePresetType = assembly.GetType("VRM.BlendShapePreset");
                    }

                    Debug.Log($"[VRMExpressionController] ✅ VRM0.x BlendShapeProxy found. ImmSetValue={_immSetValueMethod != null}, CreateUnknown={_createUnknownKey != null}");
                    return;
                }
            }

            // ---- VRM1.0: Vrm10Instance → Runtime → Expression を探す ----
            foreach (var comp in GetComponentsInParent<Component>(true))
            {
                if (comp == null) continue;
                var typeName = comp.GetType().Name;
                if (typeName == "Vrm10Instance")
                {
                    try
                    {
                        var runtimeProp = comp.GetType().GetProperty("Runtime");
                        var runtime = runtimeProp?.GetValue(comp);
                        if (runtime == null) continue;

                        var expressionProp = runtime.GetType().GetProperty("Expression");
                        _vrm10Expression = expressionProp?.GetValue(runtime);
                        if (_vrm10Expression == null) continue;

                        _vrm10SetWeight = _vrm10Expression.GetType().GetMethod("SetWeight");

                        // ExpressionKey.CreateFromLabel または ExpressionKey の静的ファクトリーを探す
                        foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                        {
                            var ekType = asm.GetType("UniVRM10.ExpressionKey");
                            if (ekType != null)
                            {
                                _vrm10CreateKey = ekType.GetMethod("CreateFromLabel",
                                    BindingFlags.Public | BindingFlags.Static);
                                if (_vrm10CreateKey == null)
                                    _vrm10CreateKey = ekType.GetMethod("CreateFromExpression",
                                        BindingFlags.Public | BindingFlags.Static);
                                break;
                            }
                        }

                        Debug.Log($"[VRMExpressionController] ✅ VRM1.0 Vrm10Instance found. SetWeight={_vrm10SetWeight != null}, CreateKey={_vrm10CreateKey != null}");
                        return;
                    }
                    catch (Exception ex)
                    {
                        Debug.LogWarning($"[VRMExpressionController] VRM1.0 detection error: {ex.Message}");
                    }
                }
            }

            // ---- fallback: 直接 SkinnedMeshRenderer ----
            Debug.LogWarning("[VRMExpressionController] No UniVRM API found. Using direct SetBlendShapeWeight (fallback). Expressions may be overridden by UniVRM runtime.");
            _useFallback = true;
        }

        private void BuildFallbackCache()
        {
            _fallbackCache.Clear();
            var skinnedMeshes = GetComponentsInChildren<SkinnedMeshRenderer>(true);
            foreach (var smr in skinnedMeshes)
            {
                if (smr == null || smr.sharedMesh == null) continue;
                int blendCount = smr.sharedMesh.blendShapeCount;
                for (int i = 0; i < blendCount; i++)
                {
                    string name = smr.sharedMesh.GetBlendShapeName(i);
                    if (!string.IsNullOrEmpty(name))
                        _fallbackCache[name] = new BlendShapeInfo { Renderer = smr, BlendShapeIndex = i };
                }
            }
            Debug.Log($"[VRMExpressionController] Fallback BlendShape cache: {_fallbackCache.Count} entries");
        }

        /// <summary>
        /// 表情を設定（0-100）
        /// </summary>
        public bool SetExpression(string expressionName, float value)
        {
            if (string.IsNullOrEmpty(expressionName)) return false;
            float normalized = Mathf.Clamp01(value / 100f);
            var candidates = ResolveExpressionCandidates(expressionName);

            // VRM0.x: VRMBlendShapeProxy.ImmediatelySetValue
            if (_blendShapeProxy != null && _immSetValueMethod != null && _createUnknownKey != null)
            {
                foreach (var candidate in candidates)
                {
                    try
                    {
                        object key = null;
                        // BlendShapePreset 名と一致するか試す
                        if (_createPresetKey != null && _blendShapePresetType != null)
                        {
                            try
                            {
                                var preset = Enum.Parse(_blendShapePresetType, candidate, true);
                                key = _createPresetKey.Invoke(null, new object[] { preset });
                            }
                            catch { }
                        }

                        if (key == null)
                            key = _createUnknownKey.Invoke(null, new object[] { candidate });

                        _immSetValueMethod.Invoke(_blendShapeProxy, new object[] { key, normalized });
                        return true;
                    }
                    catch (Exception ex)
                    {
                        Debug.LogWarning($"[VRMExpressionController] VRM0.x ImmediatelySetValue failed ({candidate}): {ex.Message}");
                    }
                }
            }

            // VRM1.0: Vrm10Runtime.Expression.SetWeight
            if (_vrm10Expression != null && _vrm10SetWeight != null && _vrm10CreateKey != null)
            {
                foreach (var candidate in candidates)
                {
                    try
                    {
                        var key = _vrm10CreateKey.Invoke(null, new object[] { candidate });
                        if (key != null)
                        {
                            _vrm10SetWeight.Invoke(_vrm10Expression, new object[] { key, normalized });
                            return true;
                        }
                    }
                    catch (Exception ex)
                    {
                        Debug.LogWarning($"[VRMExpressionController] VRM1.0 SetWeight failed ({candidate}): {ex.Message}");
                    }
                }
            }

            // Fallback
            if (_useFallback)
            {
                foreach (var candidate in candidates)
                {
                    if (_fallbackCache.TryGetValue(candidate, out var info))
                    {
                        info.Renderer.SetBlendShapeWeight(info.BlendShapeIndex, Mathf.Clamp(value, 0f, 100f));
                        return true;
                    }
                }
            }

            Debug.LogWarning($"[VRMExpressionController] ✗ Expression '{expressionName}' could not be set");
            return false;
        }

        /// <summary>
        /// すべての表情をリセット（0 に設定）
        /// </summary>
        public void ResetAllExpressions()
        {
            if (_blendShapeProxy != null)
            {
                // VRM0.x: VRMBlendShapeProxy の ResetValues を呼ぶ
                var resetMethod = _blendShapeProxy.GetType().GetMethod("ResetValues")
                    ?? _blendShapeProxy.GetType().GetMethod("ClearValues");
                if (resetMethod != null)
                {
                    try { resetMethod.Invoke(_blendShapeProxy, null); return; } catch { }
                }
            }

            if (_vrm10Expression != null)
            {
                var resetMethod = _vrm10Expression.GetType().GetMethod("ResetWeights")
                    ?? _vrm10Expression.GetType().GetMethod("ClearWeights");
                if (resetMethod != null)
                {
                    try { resetMethod.Invoke(_vrm10Expression, null); return; } catch { }
                }
            }

            // fallback: 全 BlendShape を 0 に
            foreach (var kvp in _fallbackCache)
                kvp.Value.Renderer.SetBlendShapeWeight(kvp.Value.BlendShapeIndex, 0f);
        }

        /// <summary>
        /// 利用可能な表情一覧を取得
        /// </summary>
        public List<string> GetAvailableExpressions()
        {
            return new List<string>(_fallbackCache.Keys);
        }

        private static List<string> ResolveExpressionCandidates(string name)
        {
            var result = new List<string>();
            void Add(string v)
            {
                if (string.IsNullOrWhiteSpace(v)) return;
                if (!result.Contains(v)) result.Add(v);
            }

            Add(name);
            Add(name.ToLowerInvariant());
            Add(name.ToUpperInvariant());

            var map = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
            {
                { "Joy", new[] { "happy", "Joy", "joy" } },
                { "Angry", new[] { "angry", "Angry" } },
                { "Sorrow", new[] { "sad", "Sorrow", "sorrow" } },
                { "Fun", new[] { "relaxed", "Fun", "fun" } },
                { "Surprised", new[] { "surprised", "Surprised" } },
                { "Neutral", new[] { "neutral", "Neutral" } }
            };

            if (map.TryGetValue(name, out var aliases))
            {
                for (int i = 0; i < aliases.Length; i++)
                    Add(aliases[i]);
            }

            return result;
        }
    }
}
