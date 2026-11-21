// ==============================================
// Arsist Engine - Media: VRM を自分の体として動かす (character.embody)
// Assets/Arsist/Runtime/Media/ArsistEmbodiment.cs
//
// doc/23-cameras-media.md「体の動かし方」。IR の character.embody (enabled, hands, lipSync, hideFromSelf, matchHeight)、
// スクリプトの vrm.embody(id, on) / vrm.calibrate(id)。
//
//   体の根元  頭 (XR のメインカメラ) の位置から、頭の骨 → 体の根元の分だけ下・後ろ。水平の向きは頭の向きに
//             遅れて付いていく (肩の向き)。床より上には浮かせない (足は床。しゃがむと体ごと下がる)。
//   頭        頭の骨・首の骨の回転 = 頭の向き (体から見て、首の範囲で制限。首が 35%、頭が残り)。
//   手        コントローラー (握りの位置から手首へずらす) か、XR Hands の手首。2 本の骨の IK を自前で解く
//             (肘は下・後ろ・外へ)。Animator の IK (OnAnimatorIK) を使わないのは、動きの FBX が無い
//             (= AnimatorController が付かない) VRM でも動かしたいから。
//             見失ったら 0.3 秒かけて立ち姿 (ArsistCharacter の力を抜いた腕) に戻す。
//   指        コントローラーのトリガー → 人差し指、グリップ → 中指・薬指・小指 (親指は動かさない)。
//   背の合わせ 動かし始めて 1 秒後の目の高さ (床から) と VRM の目の高さの比で体を拡大縮小。vrm.calibrate で測り直す。
//   口        ArsistVoice.Level (マイクを持つ拡張機能が入れる) → 表情 "aa"。VRMExpressionController を直接叩く
//             (vrm.setExpression は毎回ログを出すので毎フレームには使わない。CLAUDE.md)。0..100。
//   自分の目  hideFromSelf なら体のレンダラーを ArsistSelfOnlyHidden レイヤーへ (頭のカメラは描かない、
//             仮想カメラは showSelf なら描く)。
//
// 動いている間は ArsistCharacter の動き (FBX)・歩き・こちらを見るを止める (まばたきはそのまま)。
// 床の高さ: VRM を置いた物 (ラッパー) の高さ。頭から 0.4〜2.5 m 下になければ、頭の 1.6 m 下とみなす。
//
// 実行順は ArsistCharacter (9990) の後、VRMLookAtController / VRMArmIK (10000)・揺れもの (11000)・
// 仮想カメラ (20000) の前。
// 直列化するフィールドは #if の外 (XR_HANDS はビルドの途中で立つ define。CLAUDE.md)。
// ==============================================

using System.Collections.Generic;
using Arsist.Runtime.VRM;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.XR;
#if XR_HANDS
using UnityEngine.XR.Hands;
#endif

namespace Arsist.Runtime.Media
{
    [UnityEngine.Scripting.Preserve]
    [DefaultExecutionOrder(9995)]
    [DisallowMultipleComponent]
    public sealed class ArsistEmbodiment : MonoBehaviour
    {
        // ---- 設定 (IR の embody) ----
        /// <summary>auto / controllers / hands</summary>
        public string Hands { get; set; } = "auto";
        public bool LipSync { get; set; } = true;
        public bool HideFromSelf { get; set; } = true;
        public bool MatchHeight { get; set; } = true;

        public bool Active { get; private set; }

        private const float CalibrateAfter = 1f;
        private const float HandFadeSeconds = 0.3f;
        private const float AssumedEyeHeight = 1.6f;

        // ---- 骨 ----
        private Animator _animator;
        private bool _ready;
        private Transform _neck, _head;
        private readonly Transform[] _upper = new Transform[2], _lower = new Transform[2], _hand = new Transform[2];
        private readonly Transform[,,] _fingers = new Transform[2, 4, 3]; // [左右, 人差し〜小指, 付け根〜先]
        // 読み込んだとき (バインドポーズ) の、体の正面の枠から見た回転
        private Quaternion _restNeck, _restHead;
        private readonly Quaternion[] _restHand = new Quaternion[2];
        private readonly Quaternion[,,] _restFinger = new Quaternion[2, 4, 3];
        private Quaternion _restRootInFacing;   // Inverse(F0) * root.rotation
        private Vector3 _headOffsetUnit;        // 体の正面の枠での、根元 → 頭の骨 (スケール 1 あたり)
        private float _eyeHeightUnit;           // 根元 → 目の高さ (スケール 1 あたり)

        // ---- 状態 ----
        private float _bodyYaw;
        private bool _yawInitialized;
        private float _floorY;
        private float _activatedAt;
        private bool _calibrated;
        private float _scale = 1f;
        private readonly float[] _handWeight = new float[2];
        private readonly Vector3[] _handPos = new Vector3[2];
        private readonly Quaternion[] _handRot = new Quaternion[2];
        private readonly float[] _trigger = new float[2], _grip = new float[2];
        private float _mouth, _mouthSent = -1f;
        private bool _lipSyncBroken;
        private VRMExpressionController _expressions;
        private ArsistCharacter _character;
        private string _savedLookAt;
        private Vector3 _savedLocalPos;
        private Quaternion _savedLocalRot;
        private Vector3 _savedLocalScale;
        private readonly Dictionary<GameObject, int> _savedLayers = new Dictionary<GameObject, int>();
        private readonly List<InputDevice> _devices = new List<InputDevice>();
#if XR_HANDS
        private readonly List<XRHandSubsystem> _handSubsystems = new List<XRHandSubsystem>();
#endif

        public static ArsistEmbodiment Ensure(GameObject vrmRoot)
        {
            if (vrmRoot == null) return null;
            var e = vrmRoot.GetComponent<ArsistEmbodiment>();
            if (e == null) e = vrmRoot.AddComponent<ArsistEmbodiment>();
            return e;
        }

        private void Awake()
        {
            Capture();
        }

        /// <summary>IR の embody (JSON か JObject) を当てる。enabled なら動かし始める。</summary>
        public void Configure(JObject embody)
        {
            if (embody == null) return;
            var hands = embody["hands"]?.ToString();
            if (hands == "auto" || hands == "controllers" || hands == "hands") Hands = hands;
            LipSync = Flag(embody, "lipSync", true);
            HideFromSelf = Flag(embody, "hideFromSelf", true);
            MatchHeight = Flag(embody, "matchHeight", true);
            SetActive(Flag(embody, "enabled", true));
            Debug.Log($"[Arsist] embody '{name}': {(Active ? "on" : "off")}, hands={Hands}, lipSync={LipSync}, hideFromSelf={HideFromSelf}, matchHeight={MatchHeight}");
        }

        private static bool Flag(JObject o, string key, bool fallback) =>
            o[key]?.Type == JTokenType.Boolean ? o[key].Value<bool>() : fallback;

        // ========================================
        // 骨を覚える
        // ========================================

        private void Capture()
        {
            if (_ready) return;
            _animator = GetComponent<Animator>();
            if (_animator == null) _animator = GetComponentInChildren<Animator>(true);
            if (_animator == null || !_animator.isHuman)
            {
                Debug.LogWarning($"[Arsist] embody '{name}': this VRM has no humanoid Animator; it cannot be driven.");
                return;
            }
            _head = _animator.GetBoneTransform(HumanBodyBones.Head);
            _neck = _animator.GetBoneTransform(HumanBodyBones.Neck);
            if (_head == null) return;

            // モデルの正面 (VRM0 / VRM1 でルートの向きが違うので、脚の付け根から出す。ArsistCharacter と同じ)
            var forward = transform.forward;
            var leftLeg = _animator.GetBoneTransform(HumanBodyBones.LeftUpperLeg);
            var rightLeg = _animator.GetBoneTransform(HumanBodyBones.RightUpperLeg);
            if (leftLeg != null && rightLeg != null)
            {
                var right = rightLeg.position - leftLeg.position;
                right.y = 0f;
                if (right.sqrMagnitude > 1e-6f) forward = Vector3.Cross(right.normalized, Vector3.up);
            }
            forward.y = 0f;
            if (forward.sqrMagnitude < 1e-6f) forward = Vector3.forward;
            var f0 = Quaternion.LookRotation(forward.normalized, Vector3.up);
            var inv = Quaternion.Inverse(f0);

            float s = Mathf.Max(1e-4f, transform.lossyScale.y);
            _restRootInFacing = inv * transform.rotation;
            _restHead = inv * _head.rotation;
            _restNeck = _neck != null ? inv * _neck.rotation : Quaternion.identity;
            _headOffsetUnit = inv * (_head.position - transform.position) / s;
            _eyeHeightUnit = (_head.position.y - transform.position.y) / s + 0.07f;

            var sides = new[]
            {
                (HumanBodyBones.LeftUpperArm, HumanBodyBones.LeftLowerArm, HumanBodyBones.LeftHand, HumanBodyBones.LeftIndexProximal),
                (HumanBodyBones.RightUpperArm, HumanBodyBones.RightLowerArm, HumanBodyBones.RightHand, HumanBodyBones.RightIndexProximal),
            };
            for (int i = 0; i < 2; i++)
            {
                var (u, l, h, firstFinger) = sides[i];
                _upper[i] = _animator.GetBoneTransform(u);
                _lower[i] = _animator.GetBoneTransform(l);
                _hand[i] = _animator.GetBoneTransform(h);
                if (_hand[i] != null) _restHand[i] = inv * _hand[i].rotation;
                // 人差し指 (Proximal, Intermediate, Distal) → 中指 → 薬指 → 小指 の順に並んでいる
                for (int f = 0; f < 4; f++)
                    for (int j = 0; j < 3; j++)
                    {
                        var bone = _animator.GetBoneTransform((HumanBodyBones)((int)firstFinger + f * 3 + j));
                        _fingers[i, f, j] = bone;
                        if (bone != null) _restFinger[i, f, j] = inv * bone.rotation;
                    }
            }
            _ready = true;
        }

        // ========================================
        // 始める / 止める
        // ========================================

        public void SetActive(bool on)
        {
            Capture();
            if (!_ready) { Active = false; return; }
            if (on == Active) return;
            Active = on;
            _character = GetComponent<ArsistCharacter>();
            if (on)
            {
                _savedLocalPos = transform.localPosition;
                _savedLocalRot = transform.localRotation;
                _savedLocalScale = transform.localScale;
                if (_character != null)
                {
                    _character.Stop();
                    _character.StopClip();
                    _savedLookAt = _character.LookAtUser;
                    _character.SetLookAtUser("off");
                }
                _expressions = GetComponent<VRMExpressionController>();
                if (_expressions == null) _expressions = gameObject.AddComponent<VRMExpressionController>();
                _lipSyncBroken = false;
                _yawInitialized = false;
                _activatedAt = Time.unscaledTime;
                _calibrated = false;
                _scale = Mathf.Max(1e-4f, transform.lossyScale.y);
                for (int i = 0; i < 2; i++) _handWeight[i] = 0f;
                DecideFloor();
                ApplyHideFromSelf(HideFromSelf);
            }
            else
            {
                ApplyHideFromSelf(false);
                if (_character != null && !string.IsNullOrEmpty(_savedLookAt)) _character.SetLookAtUser(_savedLookAt);
                if (_expressions != null && _mouthSent > 0f) _expressions.SetExpression("aa", 0f);
                _mouthSent = -1f;
                transform.localPosition = _savedLocalPos;
                transform.localRotation = _savedLocalRot;
                transform.localScale = _savedLocalScale;
            }
        }

        /// <summary>背を測り直す (今の目の高さに合わせる)。床も決め直す。</summary>
        public void Calibrate()
        {
            if (!Active) return;
            DecideFloor();
            _calibrated = false;
            _activatedAt = Time.unscaledTime - CalibrateAfter; // 次のフレームで測る
        }

        private void DecideFloor()
        {
            var head = Camera.main != null ? Camera.main.transform : null;
            float headY = head != null ? head.position.y : transform.position.y + AssumedEyeHeight;
            var anchor = transform.parent != null ? transform.parent : transform;
            float candidate = anchor.position.y;
            float drop = headY - candidate;
            _floorY = drop >= 0.4f && drop <= 2.5f ? candidate : headY - AssumedEyeHeight;
            Debug.Log($"[Arsist] embody '{name}': floor at y={_floorY:F2} ({(drop >= 0.4f && drop <= 2.5f ? "where the VRM was placed" : "assumed 1.6 m below the eyes")})");
        }

        private void ApplyHideFromSelf(bool hide)
        {
            if (hide)
            {
                int layer = ArsistMediaLayers.SelfHidden;
                foreach (var r in GetComponentsInChildren<Renderer>(true))
                {
                    if (r == null) continue;
                    var go = r.gameObject;
                    if (!_savedLayers.ContainsKey(go)) _savedLayers[go] = go.layer;
                    go.layer = layer;
                }
            }
            else
            {
                foreach (var kv in _savedLayers) if (kv.Key != null) kv.Key.layer = kv.Value;
                _savedLayers.Clear();
            }
        }

        // ========================================
        // 毎フレーム
        // ========================================

        private void LateUpdate()
        {
            if (!Active || !_ready) return;
            ArsistMediaLayers.EnsureHeadCamera();
            var cam = Camera.main;
            if (cam == null) return;
            var headT = cam.transform;
            float dt = Time.deltaTime;

            // ---- 背の合わせ ----
            if (!_calibrated && Time.unscaledTime - _activatedAt >= CalibrateAfter)
            {
                _calibrated = true;
                if (MatchHeight && _eyeHeightUnit > 0.2f)
                {
                    float userEye = headT.position.y - _floorY;
                    if (userEye > 0.5f && userEye < 2.5f)
                    {
                        _scale = Mathf.Clamp(userEye / _eyeHeightUnit, 0.3f, 3f);
                        Debug.Log($"[Arsist] embody '{name}': eye height {userEye:F2} m → scale {_scale:F3}");
                    }
                }
            }
            var parentScale = transform.parent != null ? Mathf.Max(1e-4f, transform.parent.lossyScale.y) : 1f;
            transform.localScale = Vector3.one * (_scale / parentScale);

            // ---- 体の向き ----
            float headYaw = YawOf(headT);
            if (!_yawInitialized) { _bodyYaw = headYaw; _yawInitialized = true; }
            float diff = Mathf.DeltaAngle(_bodyYaw, headYaw);
            // 首を 40° より回したら体が付いていく。それ以内でもゆっくり正面に戻る
            if (diff > 40f) _bodyYaw = headYaw - 40f;
            else if (diff < -40f) _bodyYaw = headYaw + 40f;
            _bodyYaw = Mathf.MoveTowardsAngle(_bodyYaw, headYaw, Mathf.Abs(diff) * 1.5f * dt);
            var facing = Quaternion.Euler(0f, _bodyYaw, 0f);

            // ---- 根元の位置 ----
            // 目 (カメラ) は頭の骨から上に 7 cm・前に 8 cm (頭の向きで)
            var headBoneTarget = headT.position - headT.rotation * new Vector3(0f, 0.07f, 0.08f) * _scale;
            var root = headBoneTarget - facing * (_headOffsetUnit * _scale);
            if (root.y > _floorY) root.y = _floorY;
            transform.SetPositionAndRotation(root, facing * _restRootInFacing);

            // ---- 首と頭 ----
            var rel = Quaternion.Inverse(facing) * headT.rotation;
            rel = ClampHead(rel);
            if (_neck != null) _neck.rotation = facing * Quaternion.Slerp(Quaternion.identity, rel, 0.35f) * _restNeck;
            _head.rotation = facing * rel * _restHead;

            // ---- 手 ----
            ReadHands(headT);
            var bodyForward = facing * Vector3.forward;
            var bodyRight = facing * Vector3.right;
            for (int i = 0; i < 2; i++)
            {
                if (_upper[i] == null || _lower[i] == null || _hand[i] == null) continue;
                bool tracked = _tracked[i];
                _handWeight[i] = Mathf.MoveTowards(_handWeight[i], tracked ? 1f : 0f, dt / HandFadeSeconds);
                if (tracked) { _lastPos[i] = _handPos[i]; _lastRot[i] = _handRot[i]; }
                float w = _handWeight[i];
                if (w > 0.001f)
                {
                    var upperBefore = _upper[i].rotation;
                    var lowerBefore = _lower[i].rotation;
                    var handBefore = _hand[i].rotation;
                    float side = i == 0 ? -1f : 1f;
                    var hint = _upper[i].position + (Vector3.down * 0.6f - bodyForward * 0.3f + bodyRight * (side * 0.4f));
                    SolveArm(_upper[i], _lower[i], _hand[i], _lastPos[i], hint);
                    var targetHand = _lastRot[i] * _restHand[i];
                    if (w < 0.999f)
                    {
                        _upper[i].rotation = Quaternion.Slerp(upperBefore, _upper[i].rotation, w);
                        _lower[i].rotation = Quaternion.Slerp(lowerBefore, _lower[i].rotation, w);
                        _hand[i].rotation = Quaternion.Slerp(handBefore, targetHand, w);
                    }
                    else _hand[i].rotation = targetHand;
                }
                PoseFingers(i, w);
            }

            // ---- 口 ----
            UpdateLipSync(dt);
        }

        private static float YawOf(Transform head)
        {
            var f = head.forward;
            var flat = new Vector3(f.x, 0f, f.z);
            if (flat.sqrMagnitude < 0.01f)
            {
                // 真下・真上を見ている: 頭の上の向き (下を見ているときは前を指す) を使う
                var u = head.up * (f.y < 0f ? 1f : -1f);
                flat = new Vector3(u.x, 0f, u.z);
            }
            if (flat.sqrMagnitude < 1e-6f) return 0f;
            return Mathf.Atan2(flat.x, flat.z) * Mathf.Rad2Deg;
        }

        /// <summary>体から見た頭の回転を、首が回る範囲に収める。</summary>
        private static Quaternion ClampHead(Quaternion rel)
        {
            var e = rel.eulerAngles;
            float pitch = Mathf.Clamp(Mathf.DeltaAngle(0f, e.x), -50f, 60f);  // + = 下を向く
            float yaw = Mathf.Clamp(Mathf.DeltaAngle(0f, e.y), -75f, 75f);
            float roll = Mathf.Clamp(Mathf.DeltaAngle(0f, e.z), -35f, 35f);
            return Quaternion.Euler(pitch, yaw, roll);
        }

        // ========================================
        // 手の入力
        // ========================================

        private readonly bool[] _tracked = new bool[2];
        private readonly Vector3[] _lastPos = new Vector3[2];
        private readonly Quaternion[] _lastRot = { Quaternion.identity, Quaternion.identity };

        // 握ったコントローラー / 手首 の向き → 手の骨 (T ポーズ: 指が横、手のひらが下) へ
        // 体の正面の枠で: コントローラーは「指 → 前、手のひら → 内側」、手首 (XR Hands) は「指 → 前、手のひら → 下」
        private static readonly Quaternion[] ControllerToHand =
        {
            Quaternion.LookRotation(Vector3.up, Vector3.left),   // 左: 右 → 後ろ、上 → 左、前 → 上
            Quaternion.LookRotation(Vector3.up, Vector3.right),  // 右
        };
        private static readonly Quaternion[] WristToHand =
        {
            Quaternion.LookRotation(Vector3.right, Vector3.up),  // 左: 指 (-X) → 前、手のひら (-Y) → 下
            Quaternion.LookRotation(Vector3.left, Vector3.up),   // 右
        };

        private void ReadHands(Transform head)
        {
            var space = head.parent;
            var spaceRot = space != null ? space.rotation : Quaternion.identity;
            for (int i = 0; i < 2; i++)
            {
                _tracked[i] = false;
                _trigger[i] = _grip[i] = 0f;
                bool wantHands = Hands != "controllers";
                bool wantControllers = Hands != "hands";
                // auto: 手が見えていれば手、無ければコントローラー
                if (wantHands && ReadHand(i, space, spaceRot)) continue;
                if (wantControllers) ReadController(i, space, spaceRot);
            }
        }

        private bool ReadController(int i, Transform space, Quaternion spaceRot)
        {
            var side = i == 0 ? InputDeviceCharacteristics.Left : InputDeviceCharacteristics.Right;
            _devices.Clear();
            InputDevices.GetDevicesWithCharacteristics(side | InputDeviceCharacteristics.Controller, _devices);
            foreach (var d in _devices)
            {
                if (!d.isValid || (d.characteristics & InputDeviceCharacteristics.HandTracking) != 0) continue;
                if (d.TryGetFeatureValue(CommonUsages.isTracked, out var tracked) && !tracked) continue;
                if (!d.TryGetFeatureValue(CommonUsages.devicePosition, out var p) || !d.TryGetFeatureValue(CommonUsages.deviceRotation, out var r)) continue;
                var rot = spaceRot * r;
                var pos = space != null ? space.TransformPoint(p) : p;
                // 握りの中心から手首へ (コントローラーの後ろへ 8 cm)
                _handPos[i] = pos + rot * new Vector3(0f, -0.01f, -0.08f);
                _handRot[i] = rot * ControllerToHand[i];
                if (d.TryGetFeatureValue(CommonUsages.trigger, out float t)) _trigger[i] = t;
                if (d.TryGetFeatureValue(CommonUsages.grip, out float g)) _grip[i] = g;
                _tracked[i] = true;
                return true;
            }
            return false;
        }

        private bool ReadHand(int i, Transform space, Quaternion spaceRot)
        {
#if XR_HANDS
            _handSubsystems.Clear();
            SubsystemManager.GetSubsystems(_handSubsystems);
            foreach (var sub in _handSubsystems)
            {
                if (sub == null || !sub.running) continue;
                var h = i == 0 ? sub.leftHand : sub.rightHand;
                if (!h.isTracked || !h.GetJoint(XRHandJointID.Wrist).TryGetPose(out var wrist)) return false;
                _handPos[i] = space != null ? space.TransformPoint(wrist.position) : wrist.position;
                _handRot[i] = spaceRot * wrist.rotation * WristToHand[i];
                _tracked[i] = true;
                return true;
            }
#endif
            return false;
        }

        // ========================================
        // 腕の IK (2 本の骨)
        // ========================================

        private static void SolveArm(Transform upper, Transform lower, Transform hand, Vector3 target, Vector3 hint)
        {
            var a = upper.position;
            float lu = Vector3.Distance(a, lower.position);
            float ll = Vector3.Distance(lower.position, hand.position);
            if (lu < 1e-5f || ll < 1e-5f) return;
            var toTarget = target - a;
            float d = Mathf.Clamp(toTarget.magnitude, Mathf.Abs(lu - ll) + 1e-4f, (lu + ll) * 0.999f);
            if (toTarget.sqrMagnitude < 1e-10f) return;
            var dir = toTarget.normalized;

            // 肘は、目標への線と hint の作る面の上
            var pole = hint - a;
            pole -= dir * Vector3.Dot(pole, dir);
            if (pole.sqrMagnitude < 1e-8f) pole = Vector3.Cross(dir, Vector3.right);
            pole.Normalize();
            float cosA = Mathf.Clamp((lu * lu + d * d - ll * ll) / (2f * lu * d), -1f, 1f);
            float sinA = Mathf.Sqrt(1f - cosA * cosA);
            var elbow = a + dir * (lu * cosA) + pole * (lu * sinA);

            upper.rotation = Quaternion.FromToRotation(lower.position - a, elbow - a) * upper.rotation;
            var reach = a + dir * d;
            lower.rotation = Quaternion.FromToRotation(hand.position - lower.position, reach - lower.position) * lower.rotation;
        }

        // ========================================
        // 指
        // ========================================

        private void PoseFingers(int i, float weight)
        {
            if (_hand[i] == null) return;
            // 手の骨の今の回転から、手全体の回転 (体の正面の枠に対する) を出す
            var q = _hand[i].rotation * Quaternion.Inverse(_restHand[i]);
            // 曲げる軸: 左手は前 (+Z)、右手は後ろ (-Z) まわり (T ポーズで指が手のひら側へ曲がる向き)
            var axis = q * (i == 0 ? Vector3.forward : Vector3.back);
            const float relaxed = 0.15f;
            for (int f = 0; f < 4; f++)
            {
                float amount = f == 0 ? _trigger[i] : _grip[i];
                amount = Mathf.Lerp(relaxed, Mathf.Max(relaxed, amount), weight);
                float total = 0f;
                for (int j = 0; j < 3; j++)
                {
                    var bone = _fingers[i, f, j];
                    if (bone == null) break;
                    total += amount * (j == 0 ? 65f : j == 1 ? 85f : 55f);
                    bone.rotation = Quaternion.AngleAxis(total, axis) * q * _restFinger[i, f, j];
                }
            }
        }

        // ========================================
        // 口
        // ========================================

        private void UpdateLipSync(float dt)
        {
            if (!LipSync || _lipSyncBroken || _expressions == null) return;
            _mouth = (float)Arsist.Runtime.Audio.LipSyncMath.Smooth(_mouth, ArsistVoice.Level, dt);
            float value = _mouth < 0.02f ? 0f : _mouth;
            if (Mathf.Abs(value - _mouthSent) < 0.01f) return;
            if (!_expressions.SetExpression("aa", value * 100f))
            {
                _lipSyncBroken = true;
                Debug.LogWarning($"[Arsist] embody '{name}': this model has no 'aa' (A) expression; lip sync is off.");
                return;
            }
            _mouthSent = value;
        }

        private void OnDisable()
        {
            if (Active) SetActive(false);
        }
    }
}
