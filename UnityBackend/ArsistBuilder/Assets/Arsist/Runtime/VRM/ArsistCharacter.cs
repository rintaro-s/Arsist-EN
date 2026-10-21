// ==============================================
// Arsist Engine - VRM Character
// Assets/Arsist/Runtime/VRM/ArsistCharacter.cs
// ==============================================
using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Arsist.Runtime.VRM
{
    /// <summary>
    /// VRM を「キャラクター」として動かす部品 (IR v5 の SceneObject.character と、スクリプトの vrm.* の動き)。
    ///
    ///   動き     ビルドが Assets/Animations/*.fbx から作る AnimatorController (Resources/ArsistCharacterAnimations、
    ///            1 ファイル = 1 状態、名前 = ファイル名) を人型の Animator に付けて CrossFade する。
    ///            どの VRM にも同じ動きが使える (Mecanim の人型リターゲット)。
    ///   まばたき VRMExpressionController の blink を 2〜6 秒おきに閉じて開く。
    ///   呼吸     胸のボーンをわずかに前後に回す (Animator の後の LateUpdate)。
    ///   こちらを見る  VRMLookAtController の目標を、正面とユーザーの頭の間でなめらかに動かす。
    ///   歩く     向きを変えてから床の上を直線で進む。当たり判定のある物に塞がれたら止まる。
    ///   立ち姿   動き (FBX) が流れていないときは、腕を下ろしてゆっくり揺らす。T ポーズのままにしない。
    ///
    /// character の無い VRM にも、ローダーは設定 off のまま付ける (力を抜いた立ち姿だけ。T ポーズで立たせない)。
    /// スクリプトが動き・歩き・まばたき等を初めて頼んだときに、VRMWrapper が付ける (設定はすべて off から)。
    ///
    /// 実行順は Animator の後、VRMLookAtController / VRMArmIK (10000) と SpringBone (11000) の前。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    [DefaultExecutionOrder(9990)]
    public class ArsistCharacter : MonoBehaviour
    {
        /// <summary>ビルドが作るコントローラー (ArsistBuildPipeline.CharacterControllerPath と同じ名前)。</summary>
        public const string ControllerResource = "ArsistCharacterAnimations";
        /// <summary>動きの名前と長さの目録 (ArsistBuildPipeline.CharacterIndexPath)。</summary>
        public const string IndexResource = "ArsistCharacterAnimationsIndex";
        /// <summary>コントローラーの既定の状態 (動きなし)。</summary>
        public const string NoneState = "Arsist_None";
        /// <summary>then にこの名前を書くと、1 回流したあと動きを止めて力を抜いた立ち姿に戻る (FBX が要らない)。</summary>
        public const string StandName = "stand";

        private const float DefaultFade = 0.25f;
        private const float TurnDegreesPerSecond = 180f;
        private const float ArriveDistance = 0.05f;
        private const float ObstacleHeight = 0.3f;
        private const float ObstacleRadius = 0.15f;
        private const float ObstacleLookAhead = 0.25f;
        private const float NearbyEnterDistance = 2.5f, NearbyExitDistance = 3.0f;
        private const float NearbyEnterAngle = 30f, NearbyExitAngle = 42f;

        // ---- 目録 (全キャラクター共通) ----
        private static List<string> _names;
        private static Dictionary<string, float> _lengths;
        private static RuntimeAnimatorController _controller;
        private static bool _controllerLoaded;

        /// <summary>このアプリにある動きの名前 (ビルドが取り込めたもの)。</summary>
        public static IReadOnlyList<string> AnimationNames
        {
            get { LoadIndex(); return _names; }
        }

        private static void LoadIndex()
        {
            if (_names != null) return;
            _names = new List<string>();
            _lengths = new Dictionary<string, float>(StringComparer.Ordinal);
            var text = Resources.Load<TextAsset>(IndexResource);
            if (text == null) return;
            try
            {
                if (JObject.Parse(text.text)["animations"] is JArray list)
                {
                    foreach (var item in list)
                    {
                        var name = item?["name"]?.ToString();
                        if (string.IsNullOrEmpty(name)) continue;
                        _names.Add(name);
                        _lengths[name] = item["length"]?.Value<float>() ?? 1f;
                    }
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[ArsistCharacter] {IndexResource} is unreadable: {e.Message}");
            }
        }

        private static RuntimeAnimatorController LoadController()
        {
            if (!_controllerLoaded)
            {
                _controllerLoaded = true;
                _controller = Resources.Load<RuntimeAnimatorController>(ControllerResource);
            }
            return _controller;
        }

        /// <summary>付いていなければ付ける (設定はすべて off)。</summary>
        public static ArsistCharacter Ensure(GameObject vrmRoot)
        {
            if (vrmRoot == null) return null;
            var c = vrmRoot.GetComponent<ArsistCharacter>();
            if (c == null) c = vrmRoot.AddComponent<ArsistCharacter>();
            return c;
        }

        // ---- 部品 ----
        private Animator _animator;
        private VRMExpressionController _expressions;
        private VRMLookAtController _lookAt;
        private Transform _head, _breathBone;
        private Vector3 _localForward = Vector3.forward;

        // ---- 設定 ----
        public bool Blink { get; set; }
        public bool Breathe { get; set; }
        /// <summary>off / always / nearby</summary>
        public string LookAtUser { get; private set; } = "off";
        /// <summary>スクリプトが vrm.lookAt で見る先を決めている間は、こちらを見る処理は触らない。</summary>
        public bool ScriptLookAt { get; set; }

        // ---- 動き ----
        public string CurrentAnimation { get; private set; }
        private bool _controllerAssigned;
        private string _thenName;
        private float _thenAt = -1f, _thenFade = DefaultFade;

        // ---- 歩く / 向く ----
        private enum MoveMode { None, Turn, Walk }
        private MoveMode _move = MoveMode.None;
        private Vector3 _moveTarget;
        private float _walkSpeed, _turnRate;
        private string _walkAnim, _idleAnim, _animBeforeMove;
        private Action<bool, string> _moveDone;
        private readonly RaycastHit[] _hits = new RaycastHit[16];

        // ---- まばたき ----
        private float _nextBlink;
        private float _blinkT = -1f;
        private bool _blinkBroken;

        // ---- 呼吸 ----
        private bool _breathApplied;
        private Quaternion _breathBase, _breathLast;

        // ---- こちらを見る ----
        private bool _lookingAtUser;
        private float _lookWeight;
        private bool _lookOwned;

        public bool IsWalking => _move == MoveMode.Walk;

        // ---- 力を抜いて立つ (動きが流れていないとき。T ポーズのままにしない) ----
        private struct Arm { public Transform Upper, Lower, Hand; public Quaternion UpperRest, LowerRest; public float Side; }
        private Arm[] _arms;

        /// <summary>Animator が動き (FBX) を流しているか。流していなければ力を抜いた立ち姿にする。</summary>
        private bool AnimatorDriving => _controllerAssigned && !string.IsNullOrEmpty(CurrentAnimation) && _animator != null && _animator.isActiveAndEnabled;

        private void Awake()
        {
            _animator = GetComponent<Animator>();
            if (_animator == null) _animator = GetComponentInChildren<Animator>(true);
            _expressions = GetComponent<VRMExpressionController>();
            _lookAt = GetComponent<VRMLookAtController>();

            if (_animator != null && _animator.isHuman)
            {
                _head = _animator.GetBoneTransform(HumanBodyBones.Head);
                _breathBone = _animator.GetBoneTransform(HumanBodyBones.UpperChest);
                if (_breathBone == null) _breathBone = _animator.GetBoneTransform(HumanBodyBones.Chest);
                if (_breathBone == null) _breathBone = _animator.GetBoneTransform(HumanBodyBones.Spine);

                // モデルの本当の正面。VRM0 と VRM1 でルートの向きが 180° 違うので、ルートの +Z は信用しない。
                // 両脚の付け根を結ぶ線 (モデルの右) と上から、前を出す。
                var leftLeg = _animator.GetBoneTransform(HumanBodyBones.LeftUpperLeg);
                var rightLeg = _animator.GetBoneTransform(HumanBodyBones.RightUpperLeg);
                if (leftLeg != null && rightLeg != null)
                {
                    var right = rightLeg.position - leftLeg.position;
                    right.y = 0f;
                    if (right.sqrMagnitude > 1e-6f)
                    {
                        var forward = Vector3.Cross(right.normalized, Vector3.up);
                        _localForward = transform.InverseTransformDirection(forward).normalized;
                    }
                }
            }
            _nextBlink = Time.time + UnityEngine.Random.Range(2f, 6f);
            CaptureArms();
        }

        /// <summary>腕の骨と、読み込んだときの (T ポーズの) 回転を覚える。</summary>
        private void CaptureArms()
        {
            if (_animator == null || !_animator.isHuman) return;
            var arms = new Arm[2];
            var bones = new[]
            {
                (HumanBodyBones.LeftUpperArm, HumanBodyBones.LeftLowerArm, HumanBodyBones.LeftHand, -1f),
                (HumanBodyBones.RightUpperArm, HumanBodyBones.RightLowerArm, HumanBodyBones.RightHand, 1f),
            };
            for (int i = 0; i < 2; i++)
            {
                var (u, l, h, side) = bones[i];
                var a = new Arm
                {
                    Upper = _animator.GetBoneTransform(u), Lower = _animator.GetBoneTransform(l), Hand = _animator.GetBoneTransform(h), Side = side,
                };
                if (a.Upper == null || a.Lower == null || a.Hand == null) return;
                a.UpperRest = a.Upper.localRotation;
                a.LowerRest = a.Lower.localRotation;
                arms[i] = a;
            }
            _arms = arms;
        }

        /// <summary>
        /// 動きが流れていないときの立ち姿: 腕を体の横に下ろし、肘を少し曲げ、ゆっくり前後にぶらぶらさせる。
        /// 動きの FBX が無い・名前が違う・読み込みの都合で再生が止まった、のどれでも T ポーズのままにしない
        /// (T ポーズは「骨の基準の形」で、立ち姿ではない)。動きが流れ始めたら Animator に任せる。
        /// </summary>
        private void ApplyRelaxedStance()
        {
            if (_arms == null) return;
            if (AnimatorDriving) return;
            float t = Time.time;
            var fwd = Forward;
            var right = Vector3.Cross(Vector3.up, fwd);
            for (int i = 0; i < _arms.Length; i++)
            {
                var a = _arms[i];
                // 毎フレーム基準から作り直す (前のフレームの分に足していかない)
                a.Upper.localRotation = a.UpperRest;
                a.Lower.localRotation = a.LowerRest;
                // 体の横、少し外・ほんの少し前へ下ろす。前後に ±5° ほど、左右で少しずらして揺らす
                float swing = Mathf.Sin(t * 1.6f + i * 1.3f) * 3.5f + Mathf.Sin(t * 0.55f + i * 2.1f) * 1.8f;
                var down = (Vector3.down * 0.96f + right * (a.Side * 0.26f) + fwd * 0.06f).normalized;
                down = Quaternion.AngleAxis(swing, right) * down;
                var upper = a.Lower.position - a.Upper.position;
                if (upper.sqrMagnitude > 1e-8f) a.Upper.rotation = Quaternion.FromToRotation(upper, down) * a.Upper.rotation;
                // 肘を前へ 12° ほど曲げる
                var fore = a.Hand.position - a.Lower.position;
                if (fore.sqrMagnitude > 1e-8f)
                {
                    var bent = Vector3.RotateTowards(fore, fwd, 12f * Mathf.Deg2Rad, 0f);
                    a.Lower.rotation = Quaternion.FromToRotation(fore, bent) * a.Lower.rotation;
                }
            }
        }

        /// <summary>モデルの正面 (ワールド、水平)。</summary>
        public Vector3 Forward
        {
            get
            {
                var f = transform.TransformDirection(_localForward);
                f.y = 0f;
                return f.sqrMagnitude > 1e-6f ? f.normalized : Vector3.forward;
            }
        }

        /// <summary>IR の character を当てる。animation があれば流す。</summary>
        public void Configure(string json)
        {
            if (string.IsNullOrEmpty(json)) return;
            JObject settings;
            try { settings = JObject.Parse(json); }
            catch (Exception e)
            {
                Debug.LogWarning($"[ArsistCharacter] character settings unreadable ({e.Message}): {json}");
                return;
            }

            Blink = settings["blink"]?.Type == JTokenType.Boolean && settings["blink"].Value<bool>();
            Breathe = settings["breathe"]?.Type == JTokenType.Boolean && settings["breathe"].Value<bool>();
            SetLookAtUser(settings["lookAtUser"]?.ToString());

            var animation = settings["animation"]?.ToString();
            if (!string.IsNullOrEmpty(animation))
            {
                if (!Play(animation, 0f, null, 1f, out var error))
                    Debug.LogWarning($"[ArsistCharacter] '{name}': starting animation '{animation}' not played: {error}");
            }
            Debug.Log($"[ArsistCharacter] '{name}': animation={(string.IsNullOrEmpty(animation) ? "-" : animation)}, blink={Blink}, breathe={Breathe}, lookAtUser={LookAtUser}");
        }

        public bool SetLookAtUser(string mode)
        {
            var m = (mode ?? "off").Trim().ToLowerInvariant();
            if (m != "off" && m != "always" && m != "nearby") return false;
            LookAtUser = m;
            return true;
        }

        // ========================================
        // 動き
        // ========================================

        public bool HasAnimation(string animationName)
        {
            if (string.IsNullOrEmpty(animationName)) return false;
            LoadIndex();
            return _lengths.ContainsKey(animationName);
        }

        private bool EnsureController(out string error)
        {
            error = null;
            if (_controllerAssigned) return true;
            if (_animator == null || !_animator.isHuman) { error = "noHumanoid (this VRM has no humanoid Animator)"; return false; }
            var controller = LoadController();
            if (controller == null) { error = "noAnimations (put humanoid FBX files in Assets/Animations and rebuild)"; return false; }

            _animator.runtimeAnimatorController = controller;
            _animator.applyRootMotion = false;   // 移動はスクリプト (walkTo) が行う。動きの中の前進は捨てる
            _animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            _animator.enabled = true;
            _controllerAssigned = true;
            return true;
        }

        /// <summary>動きを切り替える。then があれば 1 回流したあとにそれへ戻る。</summary>
        public bool Play(string animationName, float fade, string then, float speed, out string error)
        {
            error = null;
            if (!EnsureController(out error)) return false;
            if (!HasAnimation(animationName))
            {
                error = $"unknownAnimation:{animationName} (have: {string.Join(", ", AnimationNames)})";
                return false;
            }
            if (!string.IsNullOrEmpty(then) && then != StandName && !HasAnimation(then))
            {
                error = $"unknownAnimation:{then} (have: {string.Join(", ", AnimationNames)})";
                return false;
            }

            speed = speed > 0.01f ? speed : 1f;
            fade = Mathf.Max(0f, fade);
            _animator.speed = speed;
            if (fade <= 0f || string.IsNullOrEmpty(CurrentAnimation)) _animator.Play(animationName, 0, 0f);
            else _animator.CrossFadeInFixedTime(animationName, fade, 0);
            CurrentAnimation = animationName;

            if (!string.IsNullOrEmpty(then))
            {
                _lengths.TryGetValue(animationName, out var length);
                _thenName = then;
                _thenFade = fade > 0f ? fade : DefaultFade;
                // 戻りの混ぜがちょうど 1 周の終わりに終わるように
                _thenAt = Time.time + Mathf.Max(0.05f, length / speed - _thenFade);
            }
            else
            {
                _thenName = null;
                _thenAt = -1f;
            }
            return true;
        }

        // ========================================
        // 歩く / 向く
        // ========================================

        public bool WalkTo(Vector3 target, float speed, string walk, string idle, Action<bool, string> done)
        {
            Finish(false, "replaced");
            _move = MoveMode.Walk;
            _moveTarget = target;
            _walkSpeed = speed > 0.01f ? speed : 0.7f;
            _turnRate = TurnDegreesPerSecond;
            _walkAnim = string.IsNullOrEmpty(walk) ? "Walk" : walk;
            _idleAnim = string.IsNullOrEmpty(idle) ? "Idle" : idle;
            _animBeforeMove = CurrentAnimation;
            _moveDone = done;
            if (HasAnimation(_walkAnim)) Play(_walkAnim, DefaultFade, null, 1f, out _);
            return true;
        }

        public bool TurnTo(Vector3 target, float seconds, Action<bool, string> done)
        {
            Finish(false, "replaced");
            var to = target - transform.position;
            to.y = 0f;
            if (to.sqrMagnitude < 1e-6f) { done?.Invoke(true, null); return true; }
            var angle = Mathf.Abs(Vector3.SignedAngle(Forward, to.normalized, Vector3.up));
            _move = MoveMode.Turn;
            _moveTarget = target;
            _turnRate = seconds > 0.01f ? Mathf.Max(1f, angle / seconds) : TurnDegreesPerSecond;
            _moveDone = done;
            return true;
        }

        /// <summary>動き (FBX) を止める。以後は力を抜いた立ち姿 (ApplyRelaxedStance)。</summary>
        public void StopClip()
        {
            if (_controllerAssigned && _animator != null) _animator.CrossFadeInFixedTime(NoneState, DefaultFade, 0);
            CurrentAnimation = null;
            _thenName = null;
            _thenAt = -1f;
        }

        public void Stop()
        {
            Finish(false, "stopped");
        }

        private void Finish(bool ok, string reason)
        {
            if (_move == MoveMode.None) return;
            var wasWalking = _move == MoveMode.Walk;
            _move = MoveMode.None;
            var done = _moveDone;
            _moveDone = null;

            if (wasWalking)
            {
                if (HasAnimation(_idleAnim)) Play(_idleAnim, DefaultFade, null, 1f, out _);
                else if (!string.IsNullOrEmpty(_animBeforeMove) && _animBeforeMove != _walkAnim) Play(_animBeforeMove, DefaultFade, null, 1f, out _);
                else StopClip(); // 戻る動きが無い: 歩く動きを止めて、力を抜いた立ち姿へ (その場で歩き続けない)
            }
            try { done?.Invoke(ok, reason); }
            catch (Exception e) { Debug.LogError($"[ArsistCharacter] move callback failed: {e.Message}"); }
        }

        private void UpdateMove(float dt)
        {
            if (_move == MoveMode.None) return;

            var position = transform.position;
            var to = _moveTarget - position;
            to.y = 0f;
            var distance = to.magnitude;

            if (_move == MoveMode.Walk && distance <= ArriveDistance)
            {
                Finish(true, null);
                return;
            }

            if (distance > 1e-4f)
            {
                var angle = Vector3.SignedAngle(Forward, to / distance, Vector3.up);
                var step = Mathf.Clamp(angle, -_turnRate * dt, _turnRate * dt);
                if (Mathf.Abs(step) > 1e-4f) transform.Rotate(0f, step, 0f, Space.World);
                if (_move == MoveMode.Turn)
                {
                    if (Mathf.Abs(angle - step) < 0.5f) Finish(true, null);
                    return;
                }
                // 大きく向きが違う間は、その場で向きを変える
                if (Mathf.Abs(angle) > 20f) return;
            }
            else if (_move == MoveMode.Turn)
            {
                Finish(true, null);
                return;
            }

            var dir = to / Mathf.Max(distance, 1e-4f);
            var advance = Mathf.Min(_walkSpeed * dt, distance);
            if (Blocked(position, dir, advance + ObstacleLookAhead))
            {
                Debug.Log($"[ArsistCharacter] '{name}': walk blocked at ({position.x:F2}, {position.z:F2})");
                Finish(false, "blocked");
                return;
            }
            transform.position = position + dir * advance;
        }

        /// <summary>
        /// 進む先に当たり判定のある物があるか。quest-room の部屋の当たり判定は Ignore Raycast レイヤー (2) に
        /// あるので、既定のレイヤーに加えて明示的に含める。自分の体とトリガーは数えない。
        /// </summary>
        private bool Blocked(Vector3 position, Vector3 dir, float distance)
        {
            var origin = position + Vector3.up * ObstacleHeight;
            int mask = Physics.DefaultRaycastLayers | (1 << 2);
            int count = Physics.SphereCastNonAlloc(origin, ObstacleRadius, dir, _hits, distance, mask, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < count; i++)
            {
                var collider = _hits[i].collider;
                if (collider == null) continue;
                if (collider.transform.IsChildOf(transform)) continue;
                // 始点で既に重なっている物 (distance 0) は、床に半分埋まった置き方などで常に当たるので数えない
                if (_hits[i].distance <= 0f) continue;
                return true;
            }
            return false;
        }

        // ========================================
        // 毎フレーム
        // ========================================

        private void Update()
        {
            var dt = Time.deltaTime;

            if (_thenAt > 0f && Time.time >= _thenAt && !string.IsNullOrEmpty(_thenName))
            {
                var next = _thenName;
                _thenAt = -1f;
                _thenName = null;
                if (next == StandName) StopClip();
                else Play(next, _thenFade, null, 1f, out _);
            }

            UpdateMove(dt);
            UpdateBlink();
            UpdateLookAtUser(dt);
        }

        private void UpdateBlink()
        {
            if (_expressions == null && Blink) _expressions = GetComponent<VRMExpressionController>();
            if (!Blink || _blinkBroken || _expressions == null)
            {
                if (_blinkT >= 0f && _expressions != null) { _expressions.SetExpression("blink", 0f); _blinkT = -1f; }
                return;
            }

            if (_blinkT < 0f)
            {
                if (Time.time < _nextBlink) return;
                _blinkT = 0f;
            }

            // 閉じる 0.06 s → 閉じたまま 0.03 s → 開く 0.08 s
            _blinkT += Time.deltaTime;
            float w;
            if (_blinkT < 0.06f) w = _blinkT / 0.06f;
            else if (_blinkT < 0.09f) w = 1f;
            else if (_blinkT < 0.17f) w = 1f - (_blinkT - 0.09f) / 0.08f;
            else
            {
                w = 0f;
                _blinkT = -1f;
                _nextBlink = Time.time + UnityEngine.Random.Range(2f, 6f);
            }

            if (!_expressions.SetExpression("blink", w * 100f))
            {
                _blinkBroken = true;
                Debug.LogWarning($"[ArsistCharacter] '{name}': this model has no blink expression; blinking is off.");
            }
        }

        private void UpdateLookAtUser(float dt)
        {
            if (_lookAt == null) _lookAt = GetComponent<VRMLookAtController>();
            if (_lookAt == null || _head == null) return;

            if (ScriptLookAt)
            {
                // スクリプトが見る先を決めている。こちらの持ち分は手放す (ClearTarget はスクリプトの目標も消すので呼ばない)
                _lookOwned = false;
                _lookWeight = 0f;
                _lookingAtUser = false;
                return;
            }

            var cam = Camera.main;
            bool want = false;
            if (cam != null && LookAtUser != "off")
            {
                if (LookAtUser == "always") want = true;
                else
                {
                    var toHead = _head.position - cam.transform.position;
                    var dist = toHead.magnitude;
                    var angle = dist > 1e-4f ? Vector3.Angle(cam.transform.forward, toHead / dist) : 0f;
                    // 入るときより出るときを緩くして、境目でちらつかないようにする
                    want = _lookingAtUser
                        ? dist < NearbyExitDistance && angle < NearbyExitAngle
                        : dist < NearbyEnterDistance && angle < NearbyEnterAngle;
                }
            }
            _lookingAtUser = want;
            _lookWeight = Mathf.MoveTowards(_lookWeight, want ? 1f : 0f, dt * 2.5f);

            if (_lookWeight <= 0.001f)
            {
                if (_lookOwned)
                {
                    _lookAt.ClearTarget();
                    _lookOwned = false;
                }
                return;
            }

            var neutral = _head.position + Forward * 2f;
            var user = cam != null ? cam.transform.position : neutral;
            var t = Mathf.SmoothStep(0f, 1f, _lookWeight);
            _lookAt.SetTarget(Vector3.Lerp(neutral, user, t));
            _lookOwned = true;
        }

        private void LateUpdate()
        {
            ApplyRelaxedStance();
            if (_breathBone == null) return;

            // Animator が動きを流していないと、ボーンは毎フレーム書き戻されない。前のフレームに足した分が
            // そのまま残っていれば (誰も書き換えていなければ) 元に戻してから足す。でないと少しずつ曲がっていく。
            if (_breathApplied && _breathBone.localRotation == _breathLast)
                _breathBone.localRotation = _breathBase;
            _breathApplied = false;

            if (!Breathe) return;

            _breathBase = _breathBone.localRotation;
            // 約 4 秒で 1 回。胸を前後に 1.2° ほど
            var angle = Mathf.Sin(Time.time * (Mathf.PI * 2f / 4f)) * 1.2f;
            var right = Vector3.Cross(Vector3.up, Forward);
            _breathBone.rotation = Quaternion.AngleAxis(angle, right) * _breathBone.rotation;
            _breathLast = _breathBone.localRotation;
            _breathApplied = true;
        }

        private void OnDisable()
        {
            Finish(false, "stopped");
        }
    }
}
