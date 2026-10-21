// ==============================================
// vrm10 — 表情と目 (UniVRM10 の Expression / LookAt を通す)
// Extensions/vrm10/Runtime/Vrm10Face.cs
// (MonoBehaviour はファイル名とクラス名を同じにする)
//
// エンジンの VRMExpressionController / VRMLookAtController はモデルのルートにある IArsistVrmFace /
// IArsistVrmEyes を見つけるとそれを使う。まばたき (ArsistCharacter)・口の動き (audio.play)・
// vrm.setExpression・vrm.lookAt がすべてここを通る。
//
// 名前: VRM 1.0 の表情名 (happy, aa, blink …) と、VRM 0.x の名前 (Joy, A, Blink …) のどちらでも。
// 大文字小文字は区別しない。モデル独自の表情 (custom) はその名前で。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.VRM;
using UniVRM10;
using UnityEngine;

namespace Arsist.Extensions.Vrm10
{
    [UnityEngine.Scripting.Preserve]
    [DisallowMultipleComponent]
    public sealed class Vrm10Face : MonoBehaviour, IArsistVrmFace, IArsistVrmEyes
    {
        /// <summary>VRM 0.x の名前 → VRM 1.0 の名前。</summary>
        private static readonly Dictionary<string, string> Vrm0Names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "Joy", "happy" }, { "Sorrow", "sad" }, { "Fun", "relaxed" },
            { "A", "aa" }, { "I", "ih" }, { "U", "ou" }, { "E", "ee" }, { "O", "oh" },
            { "Blink_L", "blinkLeft" }, { "Blink_R", "blinkRight" },
            { "LookUp", "lookUp" }, { "LookDown", "lookDown" }, { "LookLeft", "lookLeft" }, { "LookRight", "lookRight" },
        };

        private Vrm10Instance _instance;
        private readonly Dictionary<string, ExpressionKey> _keys = new Dictionary<string, ExpressionKey>(StringComparer.OrdinalIgnoreCase);
        private readonly List<string> _names = new List<string>();
        private readonly HashSet<string> _warned = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        public IReadOnlyList<string> ExpressionNames
        {
            get { Index(); return _names; }
        }

        private void Awake() => Index();

        private bool Index()
        {
            if (_instance != null) return true;
            _instance = GetComponent<Vrm10Instance>();
            if (_instance == null) return false;
            try
            {
                foreach (var key in _instance.Runtime.Expression.ExpressionKeys)
                {
                    var name = key.Preset == ExpressionPreset.custom ? key.Name : key.Preset.ToString();
                    if (string.IsNullOrEmpty(name) || _keys.ContainsKey(name)) continue;
                    _keys[name] = key;
                    _names.Add(name);
                }
                foreach (var pair in Vrm0Names)
                {
                    if (!_keys.ContainsKey(pair.Key) && _keys.TryGetValue(pair.Value, out var key)) _keys[pair.Key] = key;
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist:vrm10] expressions of '{name}' could not be read: {e.Message}");
            }
            return true;
        }

        public bool SetExpression(string expression, float weight01)
        {
            if (string.IsNullOrEmpty(expression) || !Index()) return false;
            if (!_keys.TryGetValue(expression, out var key))
            {
                if (_warned.Add(expression))
                    Debug.LogWarning($"[Arsist:vrm10] '{name}' has no expression '{expression}' (has: {string.Join(", ", _names)})");
                return false;
            }
            _instance.Runtime.Expression.SetWeight(key, Mathf.Clamp01(weight01));
            return true;
        }

        public void ResetExpressions()
        {
            if (!Index()) return;
            foreach (var key in _instance.Runtime.Expression.ExpressionKeys) _instance.Runtime.Expression.SetWeight(key, 0f);
        }

        public void LookAt(Transform target)
        {
            if (!Index()) return;
            _instance.LookAtTargetType = VRM10ObjectLookAt.LookAtTargetTypes.SpecifiedTransform;
            _instance.LookAtTarget = target;
            // 目標が無いと UniVRM10 は最後の向きのまま止まるので、正面に戻す
            if (target == null) _instance.Runtime.LookAt.SetYawPitchManually(0f, 0f);
        }
    }
}
