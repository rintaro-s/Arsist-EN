// ==============================================
// Arsist Engine - Scene Wrapper (3D Object Control)
// Assets/Arsist/Runtime/Scripting/SceneWrapper.cs
// ==============================================
using System;
using System.Collections.Generic;
using Jint.Native;
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

        /// <summary>JS の値の受け渡し・コールバック (ScriptEngineManager が入れる)</summary>
        public JsBridge Js { get; set; }
        /// <summary>ユーザーの頭 (faceUser / distanceToUser 用。ScriptEngineManager が入れる)</summary>
        public ViewerWrapper Viewer { get; set; }

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
        /// 登録されたオブジェクトを探す (見つからなくても警告を出さない)。拡張機能から使う。
        /// </summary>
        public bool TryGetObject(string id, out GameObject obj)
        {
            obj = null;
            if (string.IsNullOrEmpty(id)) return false;
            return _dynamicObjects.TryGetValue(id, out obj) && obj != null;
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
                CancelMove(obj, false);
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
                CancelMove(obj, false);
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
                CancelMove(obj, true);
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
                CancelMove(obj, true);
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
        // なめらかな移動・向き・ユーザーとの関係 (2026-10)
        // ========================================

        private sealed class Motion
        {
            public GameObject Target;
            public bool Rotation;
            public Vector3 FromPosition, ToPosition;
            public Quaternion FromRotation, ToRotation;
            public float Start, Duration;
            public JsValue Callback;
            public bool Finished;
        }

        // 物ごとに、動いている移動 1 つ・回転 1 つ
        private readonly Dictionary<GameObject, Motion> _moves = new Dictionary<GameObject, Motion>();
        private readonly Dictionary<GameObject, Motion> _turns = new Dictionary<GameObject, Motion>();

        /// <summary>{ x, y, z } (実行時のワールド座標)。無ければ null。</summary>
        [UnityEngine.Scripting.Preserve]
        public JsValue getPosition(string id)
        {
            var obj = GetObject(id);
            if (obj == null || Js == null) return JsValue.Null;
            var p = obj.transform.position;
            return Js.ToJs(new Dictionary<string, object> { ["x"] = (double)p.x, ["y"] = (double)p.y, ["z"] = (double)p.z });
        }

        /// <summary>そこまでなめらかに動く。着いたら fn(true)、別の移動に置き換えられたら fn(false)。</summary>
        [UnityEngine.Scripting.Preserve]
        public void moveTo(string id, double x, double y, double z, double seconds = 0.5, JsValue callback = null)
        {
            var obj = GetObject(id);
            if (obj == null) { Later(callback, false); return; }
            CancelMove(obj, false);
            var motion = new Motion
            {
                Target = obj,
                FromPosition = obj.transform.position,
                ToPosition = new Vector3((float)x, (float)y, (float)z),
                Start = Time.time,
                Duration = Mathf.Max(0f, (float)seconds),
                Callback = callback,
            };
            _moves[obj] = motion;
            Run(motion, _moves);
        }

        /// <summary>なめらかに向きを変える (度)。</summary>
        [UnityEngine.Scripting.Preserve]
        public void rotateTo(string id, double pitch, double yaw, double roll, double seconds = 0.5, JsValue callback = null)
        {
            var obj = GetObject(id);
            if (obj == null) { Later(callback, false); return; }
            StartTurn(obj, Quaternion.Euler((float)pitch, (float)yaw, (float)roll), (float)seconds, callback);
        }

        /// <summary>
        /// ユーザーの方を向く (水平にだけ回る)。向きの決まりは「ユーザーの正面に回転 0 で置いた物」と同じ:
        /// 物の +Z がユーザーと反対側を指す (パネルは読める向き、VRM 0.x は顔がこちらを向く)。
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public void faceUser(string id, double seconds = 0)
        {
            var obj = GetObject(id);
            var head = Viewer?.HeadTransform;
            if (obj == null || head == null) return;
            var away = obj.transform.position - head.position;
            away.y = 0f;
            if (away.sqrMagnitude < 1e-6f) return;
            Quaternion target;
            var character = obj.GetComponentInChildren<Arsist.Runtime.VRM.ArsistCharacter>();
            if (character != null)
            {
                // キャラクターは「+Z を向こうへ」ではなく、骨から出した本当の正面をユーザーへ向ける。
                // VRM 1.0 はルートの +Z が顔の向き、VRM 0.x は逆なので、+Z で決めると片方が背中を向ける (2026-10-12 実機)
                var turn = Vector3.SignedAngle(character.Forward, -away, Vector3.up);
                target = Quaternion.AngleAxis(turn, Vector3.up) * obj.transform.rotation;
            }
            else
            {
                var e = obj.transform.rotation.eulerAngles;
                float yaw = Mathf.Atan2(away.x, away.z) * Mathf.Rad2Deg;
                target = Quaternion.Euler(e.x, yaw, e.z);
            }
            if (seconds <= 0)
            {
                CancelMove(obj, true);
                obj.transform.rotation = target;
                return;
            }
            StartTurn(obj, target, (float)seconds, null);
        }

        /// <summary>ユーザーの頭からの距離 (m)。物が無ければ -1。</summary>
        [UnityEngine.Scripting.Preserve]
        public double distanceToUser(string id)
        {
            var obj = GetObject(id);
            var head = Viewer?.HeadTransform;
            if (obj == null || head == null) return -1;
            return Vector3.Distance(obj.transform.position, head.position);
        }

        private void StartTurn(GameObject obj, Quaternion target, float seconds, JsValue callback)
        {
            CancelMove(obj, true);
            var motion = new Motion
            {
                Target = obj,
                Rotation = true,
                FromRotation = obj.transform.rotation,
                ToRotation = target,
                Start = Time.time,
                Duration = Mathf.Max(0f, seconds),
                Callback = callback,
            };
            _turns[obj] = motion;
            Run(motion, _turns);
        }

        private void Run(Motion motion, Dictionary<GameObject, Motion> table)
        {
            var host = ScriptRuntimeHost.Instance;
            if (host == null || motion.Duration <= 0f)
            {
                Apply(motion, 1f);
                table.Remove(motion.Target);
                Complete(motion, true);
                return;
            }
            host.AddTicker(() =>
            {
                if (motion.Finished) return false;
                if (motion.Target == null) { table.Remove(motion.Target); Complete(motion, false); return false; }
                float t = Mathf.Clamp01((Time.time - motion.Start) / motion.Duration);
                Apply(motion, t * t * (3f - 2f * t));   // ゆっくり出て、ゆっくり止まる
                if (t < 1f) return true;
                if (table.TryGetValue(motion.Target, out var current) && current == motion) table.Remove(motion.Target);
                Complete(motion, true);
                return false;
            });
        }

        private static void Apply(Motion motion, float k)
        {
            if (motion.Target == null) return;
            if (motion.Rotation) motion.Target.transform.rotation = Quaternion.Slerp(motion.FromRotation, motion.ToRotation, k);
            else motion.Target.transform.position = Vector3.LerpUnclamped(motion.FromPosition, motion.ToPosition, k);
        }

        /// <summary>動いている移動 (rotation=true なら回転) を止める。待っていた fn には false。</summary>
        private void CancelMove(GameObject obj, bool rotation)
        {
            var table = rotation ? _turns : _moves;
            if (!table.TryGetValue(obj, out var old)) return;
            table.Remove(obj);
            Complete(old, false);
        }

        private void Complete(Motion motion, bool arrived)
        {
            if (motion.Finished) return;
            motion.Finished = true;
            Later(motion.Callback, arrived);
        }

        /// <summary>コールバックは次のフレームで呼ぶ (呼んだスクリプトの途中で割り込まない)。</summary>
        private void Later(JsValue callback, bool ok)
        {
            if (callback == null || Js == null || !Js.IsFunction(callback)) return;
            var host = ScriptRuntimeHost.Instance;
            if (host == null) { Js.Call(callback, "scene callback", ok); return; }
            host.Post(() => Js.Call(callback, "scene callback", ok));
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

        /// <summary>
        /// 登録済みオブジェクト全ての Transform を一度に返す。
        ///
        /// ライブ配置モードは「今の実機のシーンの見た目」を数Hzで描き直すので、
        /// ID一覧→ID毎に getState と往復すると、オブジェクト数だけ往復が増える。
        /// 1往復で全部返す口を用意しておく。
        /// </summary>
        public List<ObjectState> GetAllStates()
        {
            var states = new List<ObjectState>(_dynamicObjects.Count);
            foreach (var pair in _dynamicObjects)
            {
                var obj = pair.Value;
                if (obj == null)
                {
                    states.Add(new ObjectState { Id = pair.Key, Error = "destroyed" });
                    continue;
                }

                var t = obj.transform;
                states.Add(new ObjectState
                {
                    Id       = pair.Key,
                    Name     = obj.name,
                    Active   = obj.activeInHierarchy,
                    Position = new float[] { t.position.x, t.position.y, t.position.z },
                    Rotation = new float[] { t.eulerAngles.x, t.eulerAngles.y, t.eulerAngles.z },
                    Scale    = new float[] { t.localScale.x,  t.localScale.y,  t.localScale.z  }
                });
            }
            return states;
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
            /// <summary>GameObject 名（ライブ配置モードの一覧表示用。GetAllStates のみ設定）</summary>
            public string Name      = null;
            public bool Active      = true;
            public float[] Position = new float[3];
            public float[] Rotation = new float[3];
            public float[] Scale    = new float[] { 1f, 1f, 1f };
        }
    }
}
