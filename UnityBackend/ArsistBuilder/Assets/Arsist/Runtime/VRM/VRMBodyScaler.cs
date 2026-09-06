// ==============================================
// Arsist Engine - VRM Body Scaler
// Assets/Arsist/Runtime/VRM/VRMBodyScaler.cs
// ==============================================
using System.Reflection;
using UnityEngine;

namespace Arsist.Runtime.VRM
{
    /// <summary>
    /// VRM を「実寸の目線高さ」に合わせて等倍スケールする。
    ///
    /// AR で人を等身大に出したいとき、モデル固有の身長のまま置くと現実と合わない。
    /// 外部（VRChat 等）から取得した実測の目線高さを渡すと、その高さになるように
    /// ルートを一様スケールする。
    ///
    /// 基準に「目線高さ」を使う理由:
    ///   身長(頭頂)はメッシュ依存で安定して測れないが、目の位置は VRM の仕様に
    ///   明示されている。VRM0.x の VRMFirstPerson は FirstPersonBone とその
    ///   ローカル空間でのオフセット FirstPersonOffset を持つので、
    ///   FirstPersonBone.TransformPoint(FirstPersonOffset) が視点になる。
    ///   （UniVRM 0.131.0 の Runtime/FirstPerson/VRMFirstPerson.cs で確認）
    ///   VRMFirstPerson が無いモデルでは Head ボーンの位置で代用する。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class VRMBodyScaler : MonoBehaviour
    {
        /// <summary>スケール 1 のときの、ルートから視点までの高さ(m)。</summary>
        private float _restEyeHeight = -1f;
        private bool _measured;

        private void Awake()
        {
            Measure();
        }

        /// <summary>
        /// 素の（スケール適用前の）目線高さを測る。
        /// Awake 時点はバインドポーズなので、ここで測るのが最も安定する。
        /// </summary>
        private void Measure()
        {
            if (_measured) return;
            _measured = true;

            var scale = transform.lossyScale.y;
            if (Mathf.Approximately(scale, 0f)) scale = 1f;

            var eye = FindEyeWorldPosition();
            if (!eye.HasValue)
            {
                Debug.LogWarning("[VRMBodyScaler] Neither VRMFirstPerson nor a Head bone was found; height matching is disabled.");
                return;
            }

            // lossyScale で割って「スケール1相当」に正規化する
            _restEyeHeight = (eye.Value.y - transform.position.y) / scale;

            if (_restEyeHeight <= 0.01f)
            {
                Debug.LogWarning($"[VRMBodyScaler] Measured eye height looks wrong ({_restEyeHeight:F3} m); height matching is disabled.");
                _restEyeHeight = -1f;
                return;
            }

            Debug.Log($"[VRMBodyScaler] Rest eye height = {_restEyeHeight:F3} m (at unit scale)");
        }

        /// <summary>VRM の視点ワールド位置。VRMFirstPerson 優先、無ければ Head ボーン。</summary>
        private Vector3? FindEyeWorldPosition()
        {
            foreach (var comp in GetComponentsInChildren<Component>(true))
            {
                if (comp == null || comp.GetType().Name != "VRMFirstPerson") continue;

                var type = comp.GetType();
                var boneField = type.GetField("FirstPersonBone", BindingFlags.Public | BindingFlags.Instance);
                var offsetField = type.GetField("FirstPersonOffset", BindingFlags.Public | BindingFlags.Instance);
                var bone = boneField?.GetValue(comp) as Transform;
                if (bone == null || offsetField == null) continue;

                var offset = (Vector3)offsetField.GetValue(comp);
                return bone.TransformPoint(offset);
            }

            // ?? は Unity の偽装 null を見抜けないので使わない（== はオーバーロードされている）
            var animator = GetComponent<Animator>();
            if (animator == null) animator = GetComponentInChildren<Animator>(true);
            if (animator != null && animator.isHuman)
            {
                var head = animator.GetBoneTransform(HumanBodyBones.Head);
                if (head != null) return head.position;
            }

            return null;
        }

        /// <summary>スケール1相当での目線高さ(m)。測れなかった場合は負値。</summary>
        public float RestEyeHeight
        {
            get
            {
                Measure();
                return _restEyeHeight;
            }
        }

        /// <summary>
        /// 目線が指定の高さに来るよう等倍スケールする。
        /// </summary>
        /// <param name="eyeHeightMeters">ルートからの目線高さ(m)</param>
        /// <returns>適用したスケール。適用できなければ負値。</returns>
        public float SetEyeHeight(float eyeHeightMeters)
        {
            Measure();

            if (_restEyeHeight <= 0f) return -1f;
            if (eyeHeightMeters <= 0.1f || eyeHeightMeters > 5f)
            {
                Debug.LogWarning($"[VRMBodyScaler] Ignoring implausible eye height: {eyeHeightMeters} m");
                return -1f;
            }

            var scale = eyeHeightMeters / _restEyeHeight;
            transform.localScale = Vector3.one * scale;
            return scale;
        }

        /// <summary>スケールを 1 に戻す。</summary>
        public void ResetScale()
        {
            transform.localScale = Vector3.one;
        }
    }
}
