// ==============================================
// Arsist Engine - VRM Bone Controller (確実な実装)
// Assets/Arsist/Runtime/VRM/VRMBoneController.cs
// ==============================================
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.VRM
{
    /// <summary>
    /// LateUpdate で Animator 更新後にスクリプト指定のボーン回転を適用する。
    /// DefaultExecutionOrder(10000) により UniVRM の LateUpdate より確実に後に実行される。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    [DefaultExecutionOrder(10000)]
    public class VRMBoneController : MonoBehaviour
    {
        private Animator _animator;
        private Dictionary<HumanBodyBones, Transform> _boneCache = new Dictionary<HumanBodyBones, Transform>();
        private Dictionary<HumanBodyBones, Quaternion> _originalBoneRotations = new Dictionary<HumanBodyBones, Quaternion>();
        // VRM1.0 名前ベースフォールバック: boneName → Transform
        private Dictionary<string, Transform> _nameBoneCache = new Dictionary<string, Transform>();
        private Dictionary<string, Quaternion> _nameOriginalRotations = new Dictionary<string, Quaternion>();
        private bool _useNameFallback = false;

        // ===== LateUpdate 適用用キャッシュ =====
        // Animator が Update() でボーンを上書きするため、LateUpdate() で再適用する
        private Dictionary<HumanBodyBones, Quaternion> _pendingBoneRotations = new Dictionary<HumanBodyBones, Quaternion>();
        private Dictionary<string, Quaternion> _pendingNameBoneRotations = new Dictionary<string, Quaternion>();
        private bool _hasPendingRotations = false;

        // VRM1.0 ボーン名 → HumanBodyBones 名のマッピング
        private static readonly Dictionary<string, string[]> VRM_BONE_NAME_PATTERNS = new Dictionary<string, string[]>
        {
            { "Hips", new[] { "J_Bip_C_Hips", "hips", "Hips", "Hip" } },
            { "Spine", new[] { "J_Bip_C_Spine", "spine", "Spine" } },
            { "Chest", new[] { "J_Bip_C_Chest", "chest", "Chest" } },
            { "UpperChest", new[] { "J_Bip_C_UpperChest", "upper_chest", "UpperChest" } },
            { "Neck", new[] { "J_Bip_C_Neck", "neck", "Neck" } },
            { "Head", new[] { "J_Bip_C_Head", "head", "Head" } },
            { "LeftShoulder", new[] { "J_Bip_L_Shoulder", "shoulder_L", "LeftShoulder" } },
            { "LeftUpperArm", new[] { "J_Bip_L_UpperArm", "upper_arm_L", "LeftUpperArm" } },
            { "LeftLowerArm", new[] { "J_Bip_L_LowerArm", "lower_arm_L", "LeftLowerArm", "LeftForeArm" } },
            { "LeftHand", new[] { "J_Bip_L_Hand", "hand_L", "LeftHand" } },
            { "RightShoulder", new[] { "J_Bip_R_Shoulder", "shoulder_R", "RightShoulder" } },
            { "RightUpperArm", new[] { "J_Bip_R_UpperArm", "upper_arm_R", "RightUpperArm" } },
            { "RightLowerArm", new[] { "J_Bip_R_LowerArm", "lower_arm_R", "RightLowerArm", "RightForeArm" } },
            { "RightHand", new[] { "J_Bip_R_Hand", "hand_R", "RightHand" } },
            { "LeftUpperLeg", new[] { "J_Bip_L_UpperLeg", "upper_leg_L", "LeftUpperLeg", "LeftThigh" } },
            { "LeftLowerLeg", new[] { "J_Bip_L_LowerLeg", "lower_leg_L", "LeftLowerLeg", "LeftShin" } },
            { "LeftFoot", new[] { "J_Bip_L_Foot", "foot_L", "LeftFoot" } },
            { "LeftToes", new[] { "J_Bip_L_ToeBase", "toes_L", "LeftToes" } },
            { "RightUpperLeg", new[] { "J_Bip_R_UpperLeg", "upper_leg_R", "RightUpperLeg", "RightThigh" } },
            { "RightLowerLeg", new[] { "J_Bip_R_LowerLeg", "lower_leg_R", "RightLowerLeg", "RightShin" } },
            { "RightFoot", new[] { "J_Bip_R_Foot", "foot_R", "RightFoot" } },
            { "RightToes", new[] { "J_Bip_R_ToeBase", "toes_R", "RightToes" } },
        };

        private void Awake()
        {
            _animator = GetComponent<Animator>();
            if (_animator != null && _animator.isHuman)
            {
                // 正規 Humanoid パス
                BuildBoneCache();
                return;
            }

            // Humanoid でない場合: VRM1.0 名前ベースフォールバック
            Debug.Log("[VRMBoneController] No Humanoid Animator. Attempting name-based bone detection (VRM1.0 fallback)...");
            BuildNameBasedBoneCache();

            if (_nameBoneCache.Count == 0)
            {
                Debug.LogWarning("[VRMBoneController] ✗ No bones found via name-based search either. Bone control disabled.");
                enabled = false;
                return;
            }
            _useNameFallback = true;
            Debug.Log($"[VRMBoneController] ✅ Name-based bone cache built: {_nameBoneCache.Count} bones available (VRM1.0 fallback)");
        }

        private void BuildBoneCache()
        {
            if (_animator == null || !_animator.isHuman) return;

            _boneCache.Clear();
            _originalBoneRotations.Clear();

            // すべての Humanoid ボーンを列挙
            for (int i = 0; i < (int)HumanBodyBones.LastBone; i++)
            {
                HumanBodyBones bone = (HumanBodyBones)i;
                Transform boneTransform = _animator.GetBoneTransform(bone);
                if (boneTransform != null)
                {
                    _boneCache[bone] = boneTransform;
                    // 元の回転角度を保存（リセット用）
                    _originalBoneRotations[bone] = boneTransform.localRotation;
                }
            }

            if (_boneCache.Count == 0)
            {
                Debug.LogWarning($"[VRMBoneController] ✗ No bones found. Humanoid rig may not be properly configured.");
            }
            else
            {
                Debug.Log($"[VRMBoneController] ✅ Bone cache built: {_boneCache.Count} bones available");
            }
        }

        /// <summary>
        /// VRM1.0 名前ベースフォールバック: Transform名パターンからボーンを検出
        /// </summary>
        private void BuildNameBasedBoneCache()
        {
            _nameBoneCache.Clear();
            _nameOriginalRotations.Clear();

            // すべての子 Transform を収集
            var allTransforms = GetComponentsInChildren<Transform>(true);
            var nameMap = new Dictionary<string, Transform>();
            foreach (var t in allTransforms)
            {
                if (t != null && !string.IsNullOrEmpty(t.name))
                {
                    nameMap[t.name] = t;
                }
            }

            // パターンマッチでボーンを検出
            foreach (var kvp in VRM_BONE_NAME_PATTERNS)
            {
                string humanBoneName = kvp.Key;
                foreach (var pattern in kvp.Value)
                {
                    if (nameMap.TryGetValue(pattern, out var boneTransform))
                    {
                        _nameBoneCache[humanBoneName] = boneTransform;
                        _nameOriginalRotations[humanBoneName] = boneTransform.localRotation;
                        break;
                    }
                }
            }

            // パターンマッチで見つからなかったボーンをサブストリング検索
            if (_nameBoneCache.Count < VRM_BONE_NAME_PATTERNS.Count)
            {
                foreach (var kvp in VRM_BONE_NAME_PATTERNS)
                {
                    if (_nameBoneCache.ContainsKey(kvp.Key)) continue;
                    foreach (var t in allTransforms)
                    {
                        if (t == null || string.IsNullOrEmpty(t.name)) continue;
                        foreach (var pattern in kvp.Value)
                        {
                            if (t.name.IndexOf(pattern, StringComparison.OrdinalIgnoreCase) >= 0)
                            {
                                _nameBoneCache[kvp.Key] = t;
                                _nameOriginalRotations[kvp.Key] = t.localRotation;
                                goto nextBone;
                            }
                        }
                    }
                    nextBone:;
                }
            }
        }

        /// <summary>
        /// ボーンの回転を設定（絶対指定）
        /// ※ Animator が Update() でボーンを上書きするため、LateUpdate() でキャッシュを適用する
        /// </summary>
        public bool SetBoneRotation(string boneName, float pitch, float yaw, float roll)
        {
            var rotation = Quaternion.Euler(pitch, yaw, roll);

            // 名前ベースフォールバック
            if (_useNameFallback)
            {
                if (_nameBoneCache.ContainsKey(boneName))
                {
                    _pendingNameBoneRotations[boneName] = rotation;
                    _hasPendingRotations = true;
                    return true;
                }
                Debug.LogWarning($"[VRMBoneController] ✗ Bone '{boneName}' not found in name-based cache");
                return false;
            }

            if (_animator == null || !_animator.isHuman)
            {
                Debug.LogWarning("[VRMBoneController] ✗ Animator is not Humanoid");
                return false;
            }

            // ボーン名を HumanBodyBones に変換
            if (!System.Enum.TryParse<HumanBodyBones>(boneName, out HumanBodyBones bone))
            {
                Debug.LogWarning($"[VRMBoneController] ✗ Invalid bone name: {boneName}");
                return false;
            }

            // ボーンがキャッシュにあるか確認（なければ直接追加）
            if (!_boneCache.ContainsKey(bone))
            {
                var boneTransformDirect = _animator.GetBoneTransform(bone);
                if (boneTransformDirect == null)
                {
                    Debug.LogWarning($"[VRMBoneController] ✗ Bone '{boneName}' not found");
                    return false;
                }
                _boneCache[bone] = boneTransformDirect;
            }

            _pendingBoneRotations[bone] = rotation;
            _hasPendingRotations = true;
            return true;
        }

        /// <summary>
        /// LateUpdate: Animator の骨格更新後にスクリプト指定の回転を適用
        /// </summary>
        private void LateUpdate()
        {
            if (!_hasPendingRotations) return;

            if (_useNameFallback)
            {
                foreach (var kvp in _pendingNameBoneRotations)
                {
                    if (_nameBoneCache.TryGetValue(kvp.Key, out var t) && t != null)
                        t.localRotation = kvp.Value;
                }
            }
            else
            {
                foreach (var kvp in _pendingBoneRotations)
                {
                    if (_boneCache.TryGetValue(kvp.Key, out var t) && t != null)
                        t.localRotation = kvp.Value;
                }
            }
        }

        /// <summary>
        /// ボーンの回転をリセット
        /// </summary>
        public bool ResetBoneRotation(string boneName)
        {
            if (_useNameFallback)
            {
                _pendingNameBoneRotations.Remove(boneName);
                if (_nameBoneCache.TryGetValue(boneName, out var t))
                {
                    var orig2 = _nameOriginalRotations.TryGetValue(boneName, out var o2) ? o2 : Quaternion.identity;
                    t.localRotation = orig2;
                    return true;
                }
                return false;
            }

            if (!System.Enum.TryParse<HumanBodyBones>(boneName, out var bone))
                return false;

            _pendingBoneRotations.Remove(bone);

            if (!_boneCache.TryGetValue(bone, out var boneTransform))
                return false;

            boneTransform.localRotation = _originalBoneRotations.TryGetValue(bone, out var originalRot)
                ? originalRot
                : Quaternion.identity;
            return true;
        }

        /// <summary>
        /// すべてのボーンをリセット
        /// </summary>
        public void ResetAllBones()
        {
            // ペンディングキャッシュをクリア
            _pendingBoneRotations.Clear();
            _pendingNameBoneRotations.Clear();
            _hasPendingRotations = false;

            if (_useNameFallback)
            {
                foreach (var kvp in _nameBoneCache)
                {
                    if (kvp.Value != null)
                    {
                        kvp.Value.localRotation = _nameOriginalRotations.TryGetValue(kvp.Key, out var orig)
                            ? orig : Quaternion.identity;
                    }
                }
                return;
            }

            foreach (var kvp in _boneCache)
            {
                if (kvp.Value != null)
                {
                    kvp.Value.localRotation = _originalBoneRotations.TryGetValue(kvp.Key, out var originalRot)
                        ? originalRot : Quaternion.identity;
                }
            }
        }

        /// <summary>
        /// 利用可能なボーン一覧を取得
        /// </summary>
        public List<string> GetAvailableBones()
        {
            if (_useNameFallback)
            {
                return new List<string>(_nameBoneCache.Keys);
            }

            var result = new List<string>();
            foreach (var bone in _boneCache.Keys)
            {
                result.Add(bone.ToString());
            }
            return result;
        }

        /// <summary>
        /// ボーンの相対回転を適用（LateUpdate で処理されるキャッシュに追加）
        /// </summary>
        public bool RotateBoneDelta(string boneName, float deltaPitch, float deltaYaw, float deltaRoll)
        {
            if (_useNameFallback)
            {
                if (!_nameBoneCache.ContainsKey(boneName)) return false;
                var current = _pendingNameBoneRotations.TryGetValue(boneName, out var p)
                    ? p
                    : (_nameOriginalRotations.TryGetValue(boneName, out var o) ? o : Quaternion.identity);
                _pendingNameBoneRotations[boneName] = current * Quaternion.Euler(deltaPitch, deltaYaw, deltaRoll);
                _hasPendingRotations = true;
                return true;
            }

            if (_animator == null || !_animator.isHuman) return false;
            if (!System.Enum.TryParse<HumanBodyBones>(boneName, out var bone)) return false;
            if (!_boneCache.ContainsKey(bone)) return false;

            var basePending = _pendingBoneRotations.TryGetValue(bone, out var pb)
                ? pb
                : (_originalBoneRotations.TryGetValue(bone, out var ob) ? ob : Quaternion.identity);
            _pendingBoneRotations[bone] = basePending * Quaternion.Euler(deltaPitch, deltaYaw, deltaRoll);
            _hasPendingRotations = true;
            return true;
        }

        /// <summary>
        /// Humanoid が正しく設定されているか確認（名前ベースフォールバックもOK）
        /// </summary>
        public bool IsValidHumanoid()
        {
            if (_useNameFallback)
            {
                return _nameBoneCache.Count > 0;
            }
            return _animator != null && _animator.isHuman && _boneCache.Count > 0;
        }
    }
}
