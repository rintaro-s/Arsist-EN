// ==============================================
// Arsist Engine - VRM Wrapper (VRM-specific Control)
// Assets/Arsist/Runtime/Scripting/VRMWrapper.cs
// ==============================================
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// Jintに "vrm" として公開されるラッパークラス。
    /// VRMモデル専用の制御（ボーン操作、表情制御など）を提供する。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class VRMWrapper
    {
        private Dictionary<string, GameObject> _vrmObjects = new Dictionary<string, GameObject>();

        /// <summary>
        /// VRMオブジェクトを登録する
        /// </summary>
        public void RegisterVRM(string id, GameObject vrmRoot)
        {
            if (string.IsNullOrEmpty(id))
            {
                Debug.LogWarning("[VRMWrapper] RegisterVRM: ID is null or empty");
                return;
            }
            _vrmObjects[id] = vrmRoot;
            Debug.Log($"[VRMWrapper] Registered VRM: {id} -> {vrmRoot.name}");
        }

        /// <summary>
        /// 登録されたVRMオブジェクトを取得する
        /// </summary>
        private GameObject GetVRM(string id)
        {
            if (_vrmObjects.TryGetValue(id, out var obj))
            {
                return obj;
            }
            Debug.LogWarning($"[VRMWrapper] VRM with ID '{id}' not found.");
            return null;
        }

        // ========================================
        // ボーン制御
        // ========================================

        /// <summary>
        /// ボーンの回転を設定 (Humanoidボーン名を使用)
        /// </summary>
        public void setBoneRotation(string id, string boneName, float pitch, float yaw, float roll)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return;

            // 1. VRMBoneController を試す
            var boneController = vrmObj.GetComponent<Arsist.Runtime.VRM.VRMBoneController>();
            if (boneController != null)
            {
                bool success = boneController.SetBoneRotation(boneName, pitch, yaw, roll);
                if (success)
                {
                    Debug.Log($"[VRMWrapper] Bone '{boneName}' rotated via VRMBoneController");
                    return;
                }
            }

            // 2. Fallback: 直接 Animator でボーン回転
            var animator = vrmObj.GetComponent<Animator>();
            if (animator == null || !animator.isHuman)
            {
                Debug.LogWarning($"[VRMWrapper] No Humanoid Animator found on VRM '{id}'. Bone '{boneName}' not rotated.");
                return;
            }

            if (System.Enum.TryParse<HumanBodyBones>(boneName, out var bone))
            {
                Transform boneTransform = animator.GetBoneTransform(bone);
                if (boneTransform != null)
                {
                    boneTransform.localRotation = Quaternion.Euler(pitch, yaw, roll);
                    Debug.Log($"[VRMWrapper] Bone '{boneName}' rotated via Animator (fallback)");
                }
                else
                {
                    Debug.LogWarning($"[VRMWrapper] Bone '{boneName}' transform not found on Animator");
                }
            }
            else
            {
                Debug.LogWarning($"[VRMWrapper] Invalid bone name: '{boneName}'");
            }
        }

        /// <summary>
        /// ボーンの相対回転を適用
        /// </summary>
        public void rotateBone(string id, string boneName, float deltaPitch, float deltaYaw, float deltaRoll)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return;

            // VRMBoneController 経由で LateUpdate に委ねる（Animator 上書き対策）
            var boneController = vrmObj.GetComponent<Arsist.Runtime.VRM.VRMBoneController>();
            if (boneController != null)
            {
                boneController.RotateBoneDelta(boneName, deltaPitch, deltaYaw, deltaRoll);
                return;
            }

            // Fallback: Animator 直接（Animator なし環境向け）
            var animator = vrmObj.GetComponent<Animator>();
            if (animator == null || !animator.isHuman) return;
            if (System.Enum.TryParse<HumanBodyBones>(boneName, out var bone))
            {
                Transform boneTransform = animator.GetBoneTransform(bone);
                if (boneTransform != null)
                    boneTransform.Rotate(deltaPitch, deltaYaw, deltaRoll);
            }
        }

        // ========================================
        // 表情制御 (BlendShape/Expression)
        // ========================================
        // 注意: UniVRMを使用する場合、VRM0/VRM1で実装が異なる
        // ここでは汎用的なSkinnedMeshRendererベースの実装を提供

        /// <summary>
        /// 表情(BlendShape)の値を設定 (0.0 ~ 100.0)
        /// </summary>
        public void setExpression(string id, string expressionName, float value)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return;

            // 1. VRMExpressionController を試す
            var expressionController = vrmObj.GetComponent<Arsist.Runtime.VRM.VRMExpressionController>();
            if (expressionController != null)
            {
                bool success = expressionController.SetExpression(expressionName, value);
                if (success)
                {
                    Debug.Log($"[VRMWrapper] Expression '{expressionName}' set via VRMExpressionController");
                    return;
                }
            }

            // 2. Fallback: 直接 BlendShape を設定
            var skinnedMeshes = vrmObj.GetComponentsInChildren<SkinnedMeshRenderer>();
            bool found = false;

            foreach (var smr in skinnedMeshes)
            {
                var mesh = smr.sharedMesh;
                if (mesh == null) continue;

                int blendShapeIndex = mesh.GetBlendShapeIndex(expressionName);
                if (blendShapeIndex >= 0)
                {
                    smr.SetBlendShapeWeight(blendShapeIndex, Mathf.Clamp(value, 0f, 100f));
                    found = true;
                    Debug.Log($"[VRMWrapper] Expression '{expressionName}' set via BlendShape (fallback)");
                }
            }

            if (!found)
            {
                Debug.LogWarning($"[VRMWrapper] Expression '{expressionName}' not found on VRM '{id}'");
            }
        }

        /// <summary>
        /// すべての表情をリセット (0にする)
        /// </summary>
        public void resetExpressions(string id)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return;

            // VRMExpressionController 経由でリセット（UniVRM Proxy に通知される）
            var expressionController = vrmObj.GetComponent<Arsist.Runtime.VRM.VRMExpressionController>();
            if (expressionController != null)
            {
                expressionController.ResetAllExpressions();
                return;
            }

            // Fallback: 直接 BlendShape リセット（VRMBlendShapeProxy なし環境のみ）
            var skinnedMeshes = vrmObj.GetComponentsInChildren<SkinnedMeshRenderer>();
            foreach (var smr in skinnedMeshes)
            {
                if (smr?.sharedMesh == null) continue;
                for (int i = 0; i < smr.sharedMesh.blendShapeCount; i++)
                    smr.SetBlendShapeWeight(i, 0f);
            }
        }

        // ========================================
        // アニメーション制御
        // ========================================

        /// <summary>
        /// VRMのアニメーションを再生
        /// </summary>
        public void playAnimation(string id, string animName)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return;

            var animator = vrmObj.GetComponent<Animator>();
            if (animator != null)
            {
                animator.Play(animName);
            }
            else
            {
                Debug.LogWarning($"[VRMWrapper] No Animator found on VRM '{id}'");
            }
        }

        /// <summary>
        /// アニメーション速度を設定
        /// </summary>
        public void setAnimationSpeed(string id, float speed)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return;

            var animator = vrmObj.GetComponent<Animator>();
            if (animator != null)
            {
                animator.speed = speed;
            }
        }

        // ========================================
        // ルックアット制御
        // ========================================

        /// <summary>
        /// VRMの視線を特定の座標に向ける
        /// </summary>
        public void lookAt(string id, float x, float y, float z)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return;

            var animator = vrmObj.GetComponent<Animator>();
            if (animator == null || !animator.isHuman) return;

            // 頭のボーンを取得
            Transform head = animator.GetBoneTransform(HumanBodyBones.Head);
            if (head != null)
            {
                Vector3 targetPos = new Vector3(x, y, z);
                head.LookAt(targetPos);
            }
        }

        // ========================================
        // ユーティリティ
        // ========================================

        /// <summary>
        /// 指定したIDのVRMが存在するかチェック
        /// </summary>
        public bool exists(string id)
        {
            return _vrmObjects.ContainsKey(id);
        }

        /// <summary>
        /// VRMの登録を解除
        /// </summary>
        public void unregisterVRM(string id)
        {
            if (_vrmObjects.Remove(id))
            {
                Debug.Log($"[VRMWrapper] Unregistered VRM: {id}");
            }
        }

        /// <summary>
        /// すべてのVRMをクリア
        /// </summary>
        public void clearAll()
        {
            _vrmObjects.Clear();
            Debug.Log("[VRMWrapper] All VRMs cleared");
        }

        // ========================================
        // 能力検出・クエリ API
        // ========================================

        /// <summary>
        /// VRM が持つ全能力（表情・ボーン・Transform）を検出して返す
        /// </summary>
        public VRMCapabilities GetCapabilities(string id)
        {
            var caps = new VRMCapabilities { Id = id };
            var vrmObj = GetVRM(id);
            if (vrmObj == null)
            {
                caps.Error = $"VRM '{id}' not registered";
                return caps;
            }

            // --- BlendShape / 表情一覧 ---
            var seenNames = new HashSet<string>();
            foreach (var smr in vrmObj.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (smr == null || smr.sharedMesh == null) continue;
                int count = smr.sharedMesh.blendShapeCount;
                for (int i = 0; i < count; i++)
                {
                    var name = smr.sharedMesh.GetBlendShapeName(i);
                    if (!string.IsNullOrEmpty(name) && seenNames.Add(name))
                        caps.Expressions.Add(name);
                }
            }

            // --- Humanoid ボーン一覧 ---
            var animator = vrmObj.GetComponent<Animator>();
            caps.HasHumanoid = animator != null && animator.isHuman;

            // VRMBoneController を使ってボーン一覧を取得（名前ベースフォールバック対応）
            var boneController = vrmObj.GetComponent<Arsist.Runtime.VRM.VRMBoneController>();
            if (boneController != null && boneController.enabled)
            {
                caps.HumanoidBones = boneController.GetAvailableBones();
                if (caps.HumanoidBones.Count > 0)
                {
                    caps.HasHumanoid = true;  // 名前ベースでもボーン制御可能
                }
            }
            else if (caps.HasHumanoid)
            {
                foreach (HumanBodyBones bone in System.Enum.GetValues(typeof(HumanBodyBones)))
                {
                    if (bone == HumanBodyBones.LastBone) continue;
                    if (animator.GetBoneTransform(bone) != null)
                        caps.HumanoidBones.Add(bone.ToString());
                }
            }

            // --- Transform ---
            var t = vrmObj.transform;
            caps.Position = new float[] { t.position.x, t.position.y, t.position.z };
            caps.Rotation = new float[] { t.eulerAngles.x, t.eulerAngles.y, t.eulerAngles.z };
            caps.Scale    = new float[] { t.localScale.x,  t.localScale.y,  t.localScale.z  };

            Debug.Log($"[VRMWrapper] GetCapabilities '{id}': expressions={caps.Expressions.Count}, bones={caps.HumanoidBones.Count}, humanoid={caps.HasHumanoid}");
            return caps;
        }

        /// <summary>
        /// 登録済み VRM ID 一覧を返す
        /// </summary>
        public List<string> GetRegisteredIds()
        {
            return new List<string>(_vrmObjects.Keys);
        }

        // ========================================
        // 能力情報データクラス
        // ========================================

        /// <summary>VRM の能力情報</summary>
        public class VRMCapabilities
        {
            public string Id                    = "";
            public string Error                 = null;
            public List<string> Expressions     = new List<string>();
            public List<string> HumanoidBones   = new List<string>();
            public bool HasHumanoid             = false;
            public float[] Position             = new float[3];
            public float[] Rotation             = new float[3];
            public float[] Scale                = new float[] { 1f, 1f, 1f };
        }
    }
}
