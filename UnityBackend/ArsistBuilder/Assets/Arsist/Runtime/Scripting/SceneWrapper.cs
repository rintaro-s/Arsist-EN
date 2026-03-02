// ==============================================
// Arsist Engine - Scene Wrapper (3D Object Control)
// Assets/Arsist/Runtime/Scripting/SceneWrapper.cs
// ==============================================
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// Jintに "scene" として公開されるラッパークラス。
    /// 3Dオブジェクト（GLB、Canvas、VRMなど）をIDベースで操作する。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class SceneWrapper
    {
        // IDとGameObjectの紐付け辞書
        private Dictionary<string, GameObject> _dynamicObjects = new Dictionary<string, GameObject>();

        /// <summary>
        /// シーンロード時などにオブジェクトを登録する
        /// </summary>
        public void RegisterObject(string id, GameObject obj)
        {
            if (string.IsNullOrEmpty(id))
            {
                Debug.LogWarning("[SceneWrapper] RegisterObject: ID is null or empty");
                return;
            }
            _dynamicObjects[id] = obj;
            Debug.Log($"[SceneWrapper] Registered object: {id} -> {obj.name}");
        }

        /// <summary>
        /// 登録されたオブジェクトを取得する
        /// </summary>
        private GameObject GetObject(string id)
        {
            if (_dynamicObjects.TryGetValue(id, out var obj))
            {
                return obj;
            }
            Debug.LogWarning($"[SceneWrapper] Object with ID '{id}' not found.");
            return null;
        }

        // ========================================
        // Transform 操作 (位置・回転・スケール)
        // ========================================

        /// <summary>
        /// 位置の指定 (ワールド座標系)
        /// </summary>
        public void setPosition(string id, float x, float y, float z)
        {
            var obj = GetObject(id);
            if (obj != null)
            {
                obj.transform.position = new Vector3(x, y, z);
            }
        }

        /// <summary>
        /// 現在位置からの相対移動
        /// </summary>
        public void move(string id, float deltaX, float deltaY, float deltaZ)
        {
            var obj = GetObject(id);
            if (obj != null)
            {
                obj.transform.position += new Vector3(deltaX, deltaY, deltaZ);
            }
        }

        /// <summary>
        /// 回転の指定 (オイラー角: 度数法)
        /// </summary>
        public void setRotation(string id, float pitch, float yaw, float roll)
        {
            var obj = GetObject(id);
            if (obj != null)
            {
                obj.transform.rotation = Quaternion.Euler(pitch, yaw, roll);
            }
        }

        /// <summary>
        /// 現在の回転からの相対回転
        /// </summary>
        public void rotate(string id, float deltaPitch, float deltaYaw, float deltaRoll)
        {
            var obj = GetObject(id);
            if (obj != null)
            {
                obj.transform.Rotate(deltaPitch, deltaYaw, deltaRoll);
            }
        }

        /// <summary>
        /// スケールの指定
        /// </summary>
        public void setScale(string id, float x, float y, float z)
        {
            var obj = GetObject(id);
            if (obj != null)
            {
                obj.transform.localScale = new Vector3(x, y, z);
            }
        }

        /// <summary>
        /// 均等スケールの指定
        /// </summary>
        public void setUniformScale(string id, float scale)
        {
            var obj = GetObject(id);
            if (obj != null)
            {
                obj.transform.localScale = Vector3.one * scale;
            }
        }

        // ========================================
        // アニメーション制御 (GLB等)
        // ========================================

        /// <summary>
        /// アニメーションの再生
        /// </summary>
        public void playAnimation(string id, string animName)
        {
            var obj = GetObject(id);
            if (obj != null)
            {
                var animator = obj.GetComponent<Animator>();
                if (animator != null)
                {
                    animator.Play(animName);
                }
                else
                {
                    Debug.LogWarning($"[SceneWrapper] No Animator found on object '{id}'");
                }
            }
        }

        /// <summary>
        /// アニメーションの停止
        /// </summary>
        public void stopAnimation(string id)
        {
            var obj = GetObject(id);
            if (obj != null)
            {
                var animator = obj.GetComponent<Animator>();
                if (animator != null)
                {
                    animator.enabled = false;
                }
            }
        }

        /// <summary>
        /// アニメーションの再生速度変更
        /// </summary>
        public void setAnimationSpeed(string id, float speed)
        {
            var obj = GetObject(id);
            if (obj != null)
            {
                var animator = obj.GetComponent<Animator>();
                if (animator != null)
                {
                    animator.speed = speed;
                }
            }
        }

        // ========================================
        // 表示制御
        // ========================================

        /// <summary>
        /// オブジェクトの表示/非表示を切り替え
        /// </summary>
        public void setVisible(string id, bool visible)
        {
            var obj = GetObject(id);
            if (obj != null)
            {
                obj.SetActive(visible);
            }
        }

        // ========================================
        // 位置・回転の取得
        // ========================================

        /// <summary>
        /// 現在の位置を取得 (X座標)
        /// </summary>
        public float getPositionX(string id)
        {
            var obj = GetObject(id);
            return obj != null ? obj.transform.position.x : 0f;
        }

        /// <summary>
        /// 現在の位置を取得 (Y座標)
        /// </summary>
        public float getPositionY(string id)
        {
            var obj = GetObject(id);
            return obj != null ? obj.transform.position.y : 0f;
        }

        /// <summary>
        /// 現在の位置を取得 (Z座標)
        /// </summary>
        public float getPositionZ(string id)
        {
            var obj = GetObject(id);
            return obj != null ? obj.transform.position.z : 0f;
        }

        // ========================================
        // ユーティリティ
        // ========================================

        /// <summary>
        /// 指定したIDのオブジェクトが存在するかチェック
        /// </summary>
        public bool exists(string id)
        {
            return _dynamicObjects.ContainsKey(id);
        }

        /// <summary>
        /// オブジェクトの登録を解除
        /// </summary>
        public void unregisterObject(string id)
        {
            if (_dynamicObjects.Remove(id))
            {
                Debug.Log($"[SceneWrapper] Unregistered object: {id}");
            }
        }

        /// <summary>
        /// すべてのオブジェクトをクリア
        /// </summary>
        public void clearAll()
        {
            _dynamicObjects.Clear();
            Debug.Log("[SceneWrapper] All objects cleared");
        }

        // ========================================
        // クエリ API
        // ========================================

        /// <summary>
        /// オブジェクトの現在 Transform 状態を返す
        /// </summary>
        public ObjectState GetState(string id)
        {
            var obj = GetObject(id);
            if (obj == null)
                return new ObjectState { Id = id, Error = $"Object '{id}' not registered" };

            var t = obj.transform;
            return new ObjectState
            {
                Id       = id,
                Position = new float[] { t.position.x, t.position.y, t.position.z },
                Rotation = new float[] { t.eulerAngles.x, t.eulerAngles.y, t.eulerAngles.z },
                Scale    = new float[] { t.localScale.x,  t.localScale.y,  t.localScale.z  }
            };
        }

        /// <summary>
        /// 登録済みオブジェクト ID 一覧を返す
        /// </summary>
        public List<string> GetRegisteredIds()
        {
            return new List<string>(_dynamicObjects.Keys);
        }

        // ========================================
        // PropertySystem (汎用BlendShape・ボーン制御)
        // ========================================

        /// <summary>
        /// BlendShape（表情）の値を設定（VRM等の表情制御）
        /// VRMExpressionController → PropertyController → BlendShape直接検索 の優先順で処理
        /// </summary>
        public void setBlendShapeWeight(string id, string blendShapeName, float value)
        {
            var obj = GetObject(id);
            if (obj == null) return;

            // 1. VRMExpressionController を試す（最優先）
            var expressionController = obj.GetComponent<Arsist.Runtime.VRM.VRMExpressionController>();
            if (expressionController != null && expressionController.enabled)
            {
                if (expressionController.SetExpression(blendShapeName, value))
                {
                    return;  // 成功したら終了
                }
            }

            // 2. PropertyController を試す
            var propertyController = obj.GetComponent<Arsist.Runtime.Scene.PropertyController>();
            if (propertyController != null)
            {
                propertyController.SetBlendShapeWeight(blendShapeName, value);
                return;  // 成功したら終了
            }

            // 3. Fallback: BlendShape 直接検索
            var skinnedMeshes = obj.GetComponentsInChildren<SkinnedMeshRenderer>();
            foreach (var smr in skinnedMeshes)
            {
                if (smr == null || smr.sharedMesh == null) continue;
                int index = smr.sharedMesh.GetBlendShapeIndex(blendShapeName);
                if (index >= 0)
                {
                    smr.SetBlendShapeWeight(index, Mathf.Clamp(value, 0f, 100f));
                    return;  // 成功したら終了
                }
            }

            Debug.LogWarning($"[SceneWrapper] BlendShape '{blendShapeName}' not found on object '{id}'");
        }

        /// <summary>
        /// すべてのBlendShapeをリセット
        /// VRMExpressionController → PropertyController → BlendShape直接処理 の優先順
        /// </summary>
        public void resetAllBlendShapes(string id)
        {
            var obj = GetObject(id);
            if (obj == null) return;

            // 1. VRMExpressionController を試す
            var expressionController = obj.GetComponent<Arsist.Runtime.VRM.VRMExpressionController>();
            if (expressionController != null && expressionController.enabled)
            {
                expressionController.ResetAllExpressions();
                return;
            }

            // 2. PropertyController を試す
            var propertyController = obj.GetComponent<Arsist.Runtime.Scene.PropertyController>();
            if (propertyController != null)
            {
                propertyController.ResetAllBlendShapes();
                return;
            }

            // 3. Fallback: BlendShape 直接リセット
            var skinnedMeshes = obj.GetComponentsInChildren<SkinnedMeshRenderer>();
            foreach (var smr in skinnedMeshes)
            {
                if (smr == null || smr.sharedMesh == null) continue;
                int blendCount = smr.sharedMesh.blendShapeCount;
                for (int i = 0; i < blendCount; i++)
                {
                    smr.SetBlendShapeWeight(i, 0f);
                }
            }
        }

        /// <summary>
        /// Humanoidボーンの回転を設定
        /// VRMBoneController → PropertyController → Animator の優先順で処理
        /// </summary>
        public void setBoneRotation(string id, string boneName, float pitch, float yaw, float roll)
        {
            var obj = GetObject(id);
            if (obj == null) return;

            // 1. 新しい VRMBoneController を試す（最優先）
            var boneController = obj.GetComponent<Arsist.Runtime.VRM.VRMBoneController>();
            if (boneController != null && boneController.enabled)
            {
                if (boneController.SetBoneRotation(boneName, pitch, yaw, roll))
                {
                    return;  // 成功したら終了
                }
            }

            // 2. PropertyController を試す
            var propertyController = obj.GetComponent<Arsist.Runtime.Scene.PropertyController>();
            if (propertyController != null)
            {
                propertyController.SetBoneRotation(boneName, pitch, yaw, roll);
                return;  // 成功したら終了
            }

            // 3. Fallback: Animator 直接操作
            var animator = obj.GetComponent<Animator>();
            if (animator != null && animator.isHuman)
            {
                if (System.Enum.TryParse<HumanBodyBones>(boneName, out var bone))
                {
                    var boneTransform = animator.GetBoneTransform(bone);
                    if (boneTransform != null)
                    {
                        boneTransform.localRotation = Quaternion.Euler(pitch, yaw, roll);
                    }
                }
            }
        }

        /// <summary>
        /// ボーンの相対回転
        /// VRMBoneController → PropertyController → Animator の優先順で処理
        /// </summary>
        public void rotateBone(string id, string boneName, float deltaPitch, float deltaYaw, float deltaRoll)
        {
            var obj = GetObject(id);
            if (obj == null) return;

            // 1. VRMBoneController を試す（最優先）
            var boneController = obj.GetComponent<Arsist.Runtime.VRM.VRMBoneController>();
            if (boneController != null && boneController.enabled)
            {
                if (boneController.RotateBoneDelta(boneName, deltaPitch, deltaYaw, deltaRoll))
                {
                    return;  // 成功したら終了
                }
            }

            // 2. PropertyController を試す
            var propertyController = obj.GetComponent<Arsist.Runtime.Scene.PropertyController>();
            if (propertyController != null)
            {
                propertyController.RotateBoneDelta(boneName, deltaPitch, deltaYaw, deltaRoll);
                return;  // 成功したら終了
            }

            // 3. Fallback: Animator 直接操作
            var animator = obj.GetComponent<Animator>();
            if (animator != null && animator.isHuman)
            {
                if (System.Enum.TryParse<HumanBodyBones>(boneName, out var bone))
                {
                    var boneTransform = animator.GetBoneTransform(bone);
                    if (boneTransform != null)
                    {
                        boneTransform.Rotate(deltaPitch, deltaYaw, deltaRoll);
                    }
                }
            }
        }

        /// <summary>
        /// すべてのボーンをリセット
        /// VRMBoneController → PropertyController の優先順で処理
        /// </summary>
        public void resetAllBones(string id)
        {
            var obj = GetObject(id);
            if (obj == null) return;

            // 1. VRMBoneController を試す
            var boneController = obj.GetComponent<Arsist.Runtime.VRM.VRMBoneController>();
            if (boneController != null && boneController.enabled)
            {
                boneController.ResetAllBones();
                return;
            }

            // 2. PropertyController を試す
            var propertyController = obj.GetComponent<Arsist.Runtime.Scene.PropertyController>();
            if (propertyController != null)
            {
                propertyController.ResetAllBones();
            }
        }

        // ========================================
        // Transform 状態データクラス
        // ========================================

        /// <summary>オブジェクトの Transform 状態</summary>
        public class ObjectState
        {
            public string Id        = "";
            public string Error     = null;
            public float[] Position = new float[3];
            public float[] Rotation = new float[3];
            public float[] Scale    = new float[] { 1f, 1f, 1f };
        }
    }
}
