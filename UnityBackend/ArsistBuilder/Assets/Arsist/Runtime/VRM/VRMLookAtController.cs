// ==============================================
// Arsist Engine - VRM LookAt Controller
// Assets/Arsist/Runtime/VRM/VRMLookAtController.cs
// ==============================================
using System;
using System.Reflection;
using UnityEngine;

namespace Arsist.Runtime.VRM
{
    /// <summary>
    /// VRM の視線制御。
    ///
    /// 以前は VRMWrapper.lookAt が Transform.LookAt() を頭ボーンに直接呼んでいたが、
    /// これは2つの理由で動かなかった:
    ///
    ///   1. コマンド受信時（Update 相当）に1回書くだけなので、次のフレームで
    ///      Animator に上書きされて消える。
    ///   2. Transform.LookAt は「その Transform のローカル +Z」を対象へ向ける。
    ///      VRM の仕様が定めているのは「モデル全体が +Z を向く」ことだけで、
    ///      個々のボーンのローカル軸はエクスポータ次第。頭ボーンの +Z が前方である
    ///      保証はなく、多くのモデルで首があらぬ方向にねじれる。
    ///
    /// ここでは UniVRM 公式の VRMLookAtHead があればそれに委ね（目のボーン/
    /// BlendShape まで含めて SDK が正しく処理する）、無い場合のみ、
    /// ボーンのローカル軸に依存しない差分回転で頭を向ける。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    [DefaultExecutionOrder(10000)]   // Animator の後、SpringBone(11000) の前
    public class VRMLookAtController : MonoBehaviour
    {
        /// <summary>フォールバック時に頭を振れる最大角度（度）。首が折れないように制限する。</summary>
        [SerializeField] private float _maxHeadAngle = 70f;

        private Animator _animator;
        private Transform _head;

        // ---- UniVRM VRM0.x: VRMLookAtHead ----
        private Component _lookAtHead;          // VRM.VRMLookAtHead
        private FieldInfo _lookAtTargetField;   // public Transform Target
        private Transform _targetProxy;         // VRMLookAtHead へ渡す実体

        private bool _hasTarget;
        private Vector3 _worldTarget;

        private void Awake()
        {
            // ?? は Unity の偽装 null を見抜けないので使わない（== はオーバーロードされている）
            _animator = GetComponent<Animator>();
            if (_animator == null) _animator = GetComponentInChildren<Animator>(true);
            if (_animator != null && _animator.isHuman)
            {
                _head = _animator.GetBoneTransform(HumanBodyBones.Head);
            }

            DetectUniVRMLookAt();
        }

        /// <summary>UniVRM (VRM0.x) の VRMLookAtHead を型名で探す。SDK 未導入でも落ちないよう reflection。</summary>
        private void DetectUniVRMLookAt()
        {
            foreach (var comp in GetComponentsInChildren<Component>(true))
            {
                if (comp == null) continue;
                if (comp.GetType().Name != "VRMLookAtHead") continue;

                _lookAtHead = comp;
                _lookAtTargetField = comp.GetType().GetField("Target", BindingFlags.Public | BindingFlags.Instance);
                if (_lookAtTargetField == null || _lookAtTargetField.FieldType != typeof(Transform))
                {
                    Debug.LogWarning("[VRMLookAtController] VRMLookAtHead found but its 'Target' field is not a Transform; falling back to manual head aim.");
                    _lookAtHead = null;
                    _lookAtTargetField = null;
                    return;
                }

                Debug.Log("[VRMLookAtController] ✅ UniVRM VRMLookAtHead found; look-at is delegated to the SDK.");
                return;
            }

            if (_head == null)
            {
                Debug.LogWarning("[VRMLookAtController] Neither VRMLookAtHead nor a humanoid Head bone was found; look-at is disabled.");
                enabled = false;
                return;
            }

            Debug.Log("[VRMLookAtController] VRMLookAtHead not present; using axis-independent manual head aim.");
        }

        /// <summary>ワールド座標の一点を見る。</summary>
        public bool SetTarget(Vector3 worldPosition)
        {
            _worldTarget = worldPosition;
            _hasTarget = true;

            if (_lookAtHead != null && _lookAtTargetField != null)
            {
                if (_targetProxy == null)
                {
                    var go = new GameObject("ArsistLookAtTarget");
                    go.hideFlags = HideFlags.DontSave;
                    _targetProxy = go.transform;
                }
                _targetProxy.position = worldPosition;
                _lookAtTargetField.SetValue(_lookAtHead, _targetProxy);
                return true;
            }

            return _head != null;
        }

        /// <summary>視線制御を解除して、元のアニメーションに戻す。</summary>
        public void ClearTarget()
        {
            _hasTarget = false;
            if (_lookAtHead != null && _lookAtTargetField != null)
            {
                _lookAtTargetField.SetValue(_lookAtHead, null);
            }
        }

        public bool HasTarget => _hasTarget;

        private void LateUpdate()
        {
            // VRMLookAtHead に委譲している場合は SDK 側が毎フレーム処理するので何もしない。
            if (_lookAtHead != null) return;
            if (!_hasTarget || _head == null) return;

            var toTarget = _worldTarget - _head.position;
            if (toTarget.sqrMagnitude < 1e-6f) return;
            toTarget.Normalize();

            // モデルの前方（VRM 仕様: ルートの +Z が正面）から目標方向への差分回転を、
            // 頭ボーンの「現在の（アニメーション適用後の）ワールド回転」に掛ける。
            // こうするとボーンのローカル軸が何であっても正しく向く。
            var forward = transform.forward;
            var angle = Vector3.Angle(forward, toTarget);
            if (angle > _maxHeadAngle)
            {
                toTarget = Vector3.RotateTowards(forward, toTarget, _maxHeadAngle * Mathf.Deg2Rad, 0f);
            }

            _head.rotation = Quaternion.FromToRotation(forward, toTarget) * _head.rotation;
        }

        private void OnDestroy()
        {
            if (_targetProxy != null)
            {
                Destroy(_targetProxy.gameObject);
            }
        }
    }
}
