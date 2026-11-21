// ==============================================
// Arsist Engine - VRM Wrapper (VRM-specific Control)
// Assets/Arsist/Runtime/Scripting/VRMWrapper.cs
// ==============================================
using System;
using System.Collections.Generic;
using Arsist.Runtime.VRM;
using Jint;
using Jint.Native;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
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
        /// 動きを切り替える (vrm.playAnimation(id, name))。動きは Assets/Animations の FBX
        /// (ビルドが人型のコントローラーにまとめる。名前 = ファイル名)。0.25 秒で混ぜる。
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public void playAnimation(string id, string animName)
        {
            playAnimation(id, animName, JsValue.Undefined);
        }

        /// <summary>vrm.playAnimation(id, name, { fade, then, speed })</summary>
        [UnityEngine.Scripting.Preserve]
        public void playAnimation(string id, string animName, JsValue options)
        {
            var character = Character(id);
            if (character == null) return;
            var o = ParseOptions(options);
            float fade = o?["fade"]?.Type is JTokenType.Float or JTokenType.Integer ? o["fade"].Value<float>() : 0.25f;
            float speed = o?["speed"]?.Type is JTokenType.Float or JTokenType.Integer ? o["speed"].Value<float>() : 1f;
            string then = o?["then"]?.Type == JTokenType.String ? o["then"].ToString() : null;
            if (!character.Play(animName, fade, then, speed, out var error))
                Debug.LogWarning($"[VRMWrapper] playAnimation('{id}', '{animName}'): {error}");
        }

        /// <summary>vrm.stopAnimation(id) — 動きを止めて、力を抜いた立ち姿に戻す。</summary>
        [UnityEngine.Scripting.Preserve]
        public void stopAnimation(string id)
        {
            Character(id)?.StopClip();
        }

        /// <summary>このアプリにある動きの名前 (vrm.animations())。</summary>
        [UnityEngine.Scripting.Preserve]
        public JsValue animations()
        {
            return ToJs(new JArray(ArsistCharacter.AnimationNames));
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue animations(string id)
        {
            return animations();
        }

        /// <summary>今の動きの名前。流していなければ null。</summary>
        [UnityEngine.Scripting.Preserve]
        public string currentAnimation(string id)
        {
            var vrmObj = GetVRM(id);
            var character = vrmObj != null ? vrmObj.GetComponent<ArsistCharacter>() : null;
            return character != null ? character.CurrentAnimation : null;
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

            // VRMLookAtController に委譲する。
            // 直接 head.LookAt() を呼ぶと (a) 次フレームに Animator が上書きして1フレームで消え、
            // (b) Transform.LookAt はボーンのローカル +Z を向けるため、頭ボーンの軸が
            // 前方でないモデル（＝ほとんど）で首がねじれる。
            var lookAtController = vrmObj.GetComponent<Arsist.Runtime.VRM.VRMLookAtController>();
            if (lookAtController == null)
            {
                lookAtController = vrmObj.AddComponent<Arsist.Runtime.VRM.VRMLookAtController>();
            }

            // キャラクターの「こちらを見る」より、スクリプトの指定を優先する (clearLookAt まで)
            var character = vrmObj.GetComponent<ArsistCharacter>();
            if (character != null) character.ScriptLookAt = true;

            if (!lookAtController.SetTarget(new Vector3(x, y, z)))
            {
                Debug.LogWarning($"[VRMWrapper] lookAt('{id}') ignored: no VRMLookAtHead and no humanoid Head bone.");
            }
        }

        /// <summary>
        /// 目線が指定の高さ(m)に来るようにアバターを等倍スケールする。
        /// 「VRChat 内の 1m を現実の 1m として出す」ために必要。
        /// </summary>
        public void setHeight(string id, float eyeHeightMeters)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return;

            var scaler = vrmObj.GetComponent<Arsist.Runtime.VRM.VRMBodyScaler>();
            if (scaler == null) scaler = vrmObj.AddComponent<Arsist.Runtime.VRM.VRMBodyScaler>();

            var applied = scaler.SetEyeHeight(eyeHeightMeters);
            if (applied < 0f)
            {
                Debug.LogWarning($"[VRMWrapper] setHeight('{id}', {eyeHeightMeters}) failed: could not measure the model's eye height.");
            }
        }

        /// <summary>手の目標位置（ワールド座標）を与えて腕を追従させる。</summary>
        /// <param name="side">"left" / "right"（"l" / "r" も可）</param>
        public void setHandTarget(string id, string side, float x, float y, float z)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return;

            var ik = vrmObj.GetComponent<Arsist.Runtime.VRM.VRMArmIK>();
            if (ik == null) ik = vrmObj.AddComponent<Arsist.Runtime.VRM.VRMArmIK>();

            if (!TryParseSide(side, out var left))
            {
                Debug.LogWarning($"[VRMWrapper] setHandTarget: unknown side '{side}' (expected left/right).");
                return;
            }

            if (!ik.SetHandTarget(left, new Vector3(x, y, z)))
            {
                Debug.LogWarning($"[VRMWrapper] setHandTarget('{id}', {side}) ignored: the arm bone chain is incomplete.");
            }
        }

        /// <summary>腕 IK を解除してアニメーションに戻す。</summary>
        public void clearHandTarget(string id, string side)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return;

            var ik = vrmObj.GetComponent<Arsist.Runtime.VRM.VRMArmIK>();
            if (ik == null) return;

            if (string.IsNullOrEmpty(side))
            {
                ik.ClearHandTarget(true);
                ik.ClearHandTarget(false);
                return;
            }
            if (TryParseSide(side, out var left)) ik.ClearHandTarget(left);
        }

        private static bool TryParseSide(string side, out bool left)
        {
            var normalized = (side ?? string.Empty).Trim().ToLowerInvariant();
            if (normalized == "left" || normalized == "l") { left = true; return true; }
            if (normalized == "right" || normalized == "r") { left = false; return true; }
            left = false;
            return false;
        }

        /// <summary>視線制御を解除する。</summary>
        public void clearLookAt(string id)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return;

            var lookAtController = vrmObj.GetComponent<Arsist.Runtime.VRM.VRMLookAtController>();
            if (lookAtController != null) lookAtController.ClearTarget();
            var character = vrmObj.GetComponent<ArsistCharacter>();
            if (character != null) character.ScriptLookAt = false;
        }

        // ========================================
        // キャラクター: 歩く・向く・まばたき・呼吸・こちらを見る (ArsistCharacter)
        // ========================================

        /// <summary>vrm.walkTo(id, x, z) — 向きを変えて床の上をそこまで歩く (高さは今のまま)。</summary>
        [UnityEngine.Scripting.Preserve]
        public bool walkTo(string id, double x, double z)
        {
            return walkTo(id, x, z, JsValue.Undefined, JsValue.Undefined);
        }

        /// <summary>vrm.walkTo(id, x, z, options) / vrm.walkTo(id, x, z, fn)</summary>
        [UnityEngine.Scripting.Preserve]
        public bool walkTo(string id, double x, double z, JsValue optionsOrCallback)
        {
            return TypeOf(optionsOrCallback) == "function"
                ? walkTo(id, x, z, JsValue.Undefined, optionsOrCallback)
                : walkTo(id, x, z, optionsOrCallback, JsValue.Undefined);
        }

        /// <summary>vrm.walkTo(id, x, z, { speed, walk, idle }, fn(ok, reason))</summary>
        [UnityEngine.Scripting.Preserve]
        public bool walkTo(string id, double x, double z, JsValue options, JsValue callback)
        {
            var character = Character(id);
            if (character == null) { Callback(callback, false, "notFound"); return false; }
            var o = ParseOptions(options);
            float speed = o?["speed"]?.Type is JTokenType.Float or JTokenType.Integer ? o["speed"].Value<float>() : 0.7f;
            string walk = o?["walk"]?.Type == JTokenType.String ? o["walk"].ToString() : null;
            string idle = o?["idle"]?.Type == JTokenType.String ? o["idle"].ToString() : null;
            var target = new Vector3((float)x, character.transform.position.y, (float)z);
            return character.WalkTo(target, speed, walk, idle, (ok, reason) => Callback(callback, ok, reason));
        }

        /// <summary>vrm.turnTo(id, x, z) — その点の方を向く (180°/秒)。</summary>
        [UnityEngine.Scripting.Preserve]
        public bool turnTo(string id, double x, double z)
        {
            return turnTo(id, x, z, JsValue.Undefined, JsValue.Undefined);
        }

        /// <summary>vrm.turnTo(id, x, z, seconds) / vrm.turnTo(id, x, z, fn)</summary>
        [UnityEngine.Scripting.Preserve]
        public bool turnTo(string id, double x, double z, JsValue secondsOrCallback)
        {
            return TypeOf(secondsOrCallback) == "function"
                ? turnTo(id, x, z, JsValue.Undefined, secondsOrCallback)
                : turnTo(id, x, z, secondsOrCallback, JsValue.Undefined);
        }

        /// <summary>vrm.turnTo(id, x, z, seconds, fn(ok, reason))</summary>
        [UnityEngine.Scripting.Preserve]
        public bool turnTo(string id, double x, double z, JsValue seconds, JsValue callback)
        {
            var character = Character(id);
            if (character == null) { Callback(callback, false, "notFound"); return false; }
            float s = TypeOf(seconds) == "number" ? (float)seconds.AsNumber() : 0f;
            var target = new Vector3((float)x, character.transform.position.y, (float)z);
            return character.TurnTo(target, s, (ok, reason) => Callback(callback, ok, reason));
        }

        /// <summary>歩く・向くのをやめる (待っている fn には (false, "stopped"))。</summary>
        [UnityEngine.Scripting.Preserve]
        public void stop(string id)
        {
            var vrmObj = GetVRM(id);
            var character = vrmObj != null ? vrmObj.GetComponent<ArsistCharacter>() : null;
            if (character != null) character.Stop();
        }

        [UnityEngine.Scripting.Preserve]
        public bool isWalking(string id)
        {
            var vrmObj = GetVRM(id);
            var character = vrmObj != null ? vrmObj.GetComponent<ArsistCharacter>() : null;
            return character != null && character.IsWalking;
        }

        /// <summary>人型のボーンの位置 { x, y, z } (ワールド)。無ければ null。</summary>
        [UnityEngine.Scripting.Preserve]
        public JsValue bonePosition(string id, string boneName)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return JsValue.Null;
            var animator = vrmObj.GetComponent<Animator>();
            if (animator == null) animator = vrmObj.GetComponentInChildren<Animator>(true);
            if (animator == null || !animator.isHuman) return JsValue.Null;
            if (!Enum.TryParse<HumanBodyBones>(boneName ?? "", true, out var bone) || bone == HumanBodyBones.LastBone)
            {
                Debug.LogWarning($"[VRMWrapper] bonePosition: unknown bone '{boneName}' (e.g. Head, Chest, LeftHand, RightHand).");
                return JsValue.Null;
            }
            var t = animator.GetBoneTransform(bone);
            if (t == null) return JsValue.Null;
            var p = t.position;
            return ToJs(new JObject { ["x"] = p.x, ["y"] = p.y, ["z"] = p.z });
        }

        [UnityEngine.Scripting.Preserve]
        public void setBlink(string id, bool on)
        {
            var character = Character(id);
            if (character != null) character.Blink = on;
        }

        [UnityEngine.Scripting.Preserve]
        public void setBreathing(string id, bool on)
        {
            var character = Character(id);
            if (character != null) character.Breathe = on;
        }

        /// <summary>"off" / "always" / "nearby"</summary>
        [UnityEngine.Scripting.Preserve]
        public void setLookAtUser(string id, string mode)
        {
            var character = Character(id);
            if (character != null && !character.SetLookAtUser(mode))
                Debug.LogWarning($"[VRMWrapper] setLookAtUser('{id}', '{mode}'): expected off / always / nearby.");
        }

        /// <summary>自分の体として動かす / やめる (character.embody と同じ。doc/23-cameras-media.md)。</summary>
        [UnityEngine.Scripting.Preserve]
        public void embody(string id, bool on)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return;
            var e = Arsist.Runtime.Media.ArsistEmbodiment.Ensure(vrmObj);
            e.SetActive(on);
            if (on && !e.Active) Debug.LogWarning($"[VRMWrapper] embody('{id}'): this VRM has no humanoid Animator; it cannot be driven.");
        }

        /// <summary>背を測り直す (今の目の高さに合わせる)。embody の間だけ。</summary>
        [UnityEngine.Scripting.Preserve]
        public void calibrate(string id)
        {
            var vrmObj = GetVRM(id);
            if (vrmObj == null) return;
            var e = vrmObj.GetComponent<Arsist.Runtime.Media.ArsistEmbodiment>();
            if (e == null || !e.Active) { Debug.LogWarning($"[VRMWrapper] calibrate('{id}'): not embodied (call vrm.embody(id, true) first)."); return; }
            e.Calibrate();
        }

        private ArsistCharacter Character(string id)
        {
            var vrmObj = GetVRM(id);
            return vrmObj != null ? ArsistCharacter.Ensure(vrmObj) : null;
        }

        // ---- JS との受け渡し (ModelWrapper と同じく JSON を通す) ----

        private Engine _jsEngine;
        private JsValue _stringify, _parse, _typeOf;

        private Engine Js
        {
            get
            {
                var engine = ScriptEngineManager.Instance != null ? ScriptEngineManager.Instance.Engine : null;
                if (engine != null && engine != _jsEngine)
                {
                    _jsEngine = engine;
                    _stringify = engine.Evaluate("JSON.stringify");
                    _parse = engine.Evaluate("JSON.parse");
                    _typeOf = engine.Evaluate("(function (v) { return v === null ? 'null' : typeof v; })");
                }
                return engine;
            }
        }

        private string TypeOf(JsValue value)
        {
            if (value == null || value.IsUndefined()) return "undefined";
            var engine = Js;
            if (engine == null) return "undefined";
            return engine.Invoke(_typeOf, JsValue.Undefined, new object[] { value }).AsString();
        }

        private JObject ParseOptions(JsValue value)
        {
            if (TypeOf(value) != "object") return null;
            try
            {
                var json = Js.Invoke(_stringify, JsValue.Undefined, new object[] { value });
                return json.IsString() ? JObject.Parse(json.AsString()) : null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private JsValue ToJs(JToken token)
        {
            var engine = Js;
            if (engine == null) return JsValue.Null;
            return engine.Invoke(_parse, JsValue.Undefined, new object[] { token.ToString(Formatting.None) });
        }

        private void Callback(JsValue callback, bool ok, string reason)
        {
            if (TypeOf(callback) != "function") return;
            try
            {
                Js.Invoke(callback, JsValue.Undefined, new object[] { ok, reason });
            }
            catch (Exception e)
            {
                Debug.LogError($"[ArsistJS] vrm callback failed: {e.Message}");
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
