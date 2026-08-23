// ==============================================
// Arsist Engine - VRM Arm IK (2-bone)
// Assets/Arsist/Runtime/VRM/VRMArmIK.cs
// ==============================================
using UnityEngine;

namespace Arsist.Runtime.VRM
{
    /// <summary>
    /// 手のワールド座標を与えて腕を追従させる 2 ボーン IK。
    ///
    /// 外部トラッキング（VRChat のハンドトラッキング等）から届くのは
    /// 「手がどこにあるか」であって「肘を何度曲げるか」ではないので、
    /// ボーン回転をそのまま送る API では腕を再現できない。
    ///
    /// 実装は世界座標の位置だけを使う古典的な三角形 IK で、
    /// ボーンのローカル軸に依存しない（VRM のボーン軸はエクスポータ依存なので、
    /// ローカル軸を仮定する実装は多くのモデルで壊れる）。
    ///
    /// 肘の向き（ポールベクタ）は「現在の肘の平面」を維持する。
    /// 腕が伸び切って平面が定まらないときだけ、体の後方を既定の肘向きとして使う。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    [DefaultExecutionOrder(10000)]   // Animator の後、SpringBone(11000) の前
    public class VRMArmIK : MonoBehaviour
    {
        /// <summary>手の目標に届かないときに肩を伸ばす割合の上限（1 = 伸ばさない）。</summary>
        private const float MaxReach = 0.999f;

        private Animator _animator;

        private Transform _leftUpper, _leftLower, _leftHand;
        private Transform _rightUpper, _rightLower, _rightHand;

        private bool _hasLeftTarget, _hasRightTarget;
        private Vector3 _leftTarget, _rightTarget;

        private void Awake()
        {
            _animator = GetComponent<Animator>() ?? GetComponentInChildren<Animator>(true);
            if (_animator == null || !_animator.isHuman)
            {
                Debug.LogWarning("[VRMArmIK] No humanoid Animator; arm IK disabled.");
                enabled = false;
                return;
            }

            _leftUpper = _animator.GetBoneTransform(HumanBodyBones.LeftUpperArm);
            _leftLower = _animator.GetBoneTransform(HumanBodyBones.LeftLowerArm);
            _leftHand = _animator.GetBoneTransform(HumanBodyBones.LeftHand);
            _rightUpper = _animator.GetBoneTransform(HumanBodyBones.RightUpperArm);
            _rightLower = _animator.GetBoneTransform(HumanBodyBones.RightLowerArm);
            _rightHand = _animator.GetBoneTransform(HumanBodyBones.RightHand);

            if (!HasChain(true) && !HasChain(false))
            {
                Debug.LogWarning("[VRMArmIK] Neither arm chain is complete; arm IK disabled.");
                enabled = false;
            }
        }

        private bool HasChain(bool left)
        {
            return left
                ? (_leftUpper != null && _leftLower != null && _leftHand != null)
                : (_rightUpper != null && _rightLower != null && _rightHand != null);
        }

        /// <summary>手の目標位置（ワールド）を設定する。</summary>
        /// <param name="left">true = 左手</param>
        public bool SetHandTarget(bool left, Vector3 worldPosition)
        {
            if (!HasChain(left)) return false;

            if (left)
            {
                _leftTarget = worldPosition;
                _hasLeftTarget = true;
            }
            else
            {
                _rightTarget = worldPosition;
                _hasRightTarget = true;
            }
            return true;
        }

        /// <summary>IK を解除してアニメーションに戻す。</summary>
        public void ClearHandTarget(bool left)
        {
            if (left) _hasLeftTarget = false;
            else _hasRightTarget = false;
        }

        public bool HasTarget(bool left) => left ? _hasLeftTarget : _hasRightTarget;

        private void LateUpdate()
        {
            if (_hasLeftTarget) Solve(_leftUpper, _leftLower, _leftHand, _leftTarget);
            if (_hasRightTarget) Solve(_rightUpper, _rightLower, _rightHand, _rightTarget);
        }

        /// <summary>
        /// 三角形 (upper, lower, hand) の内角を目標距離に合わせて開き直し、
        /// 最後に腕全体を目標方向へ向ける。
        /// </summary>
        private void Solve(Transform upper, Transform lower, Transform hand, Vector3 target)
        {
            if (upper == null || lower == null || hand == null) return;

            Vector3 a = upper.position;
            Vector3 b = lower.position;
            Vector3 c = hand.position;

            float upperLength = Vector3.Distance(a, b);
            float lowerLength = Vector3.Distance(b, c);
            if (upperLength <= 1e-5f || lowerLength <= 1e-5f) return;

            float reach = (upperLength + lowerLength) * MaxReach;
            Vector3 toTarget = target - a;
            float targetDistance = toTarget.magnitude;
            if (targetDistance <= 1e-5f) return;

            // 届かない距離は伸ばし切った位置で止める（肩が引き伸ばされるのを防ぐ）
            float clamped = Mathf.Clamp(targetDistance, Mathf.Abs(upperLength - lowerLength) + 1e-4f, reach);

            // 肘の曲げ平面。現在の姿勢を維持する。
            Vector3 bendAxis = Vector3.Cross(c - a, b - a);
            if (bendAxis.sqrMagnitude < 1e-8f)
            {
                // 腕が一直線＝平面が決まらない。体の後ろ向きを肘の既定方向にする。
                bendAxis = Vector3.Cross(toTarget, transform.forward);
                if (bendAxis.sqrMagnitude < 1e-8f) bendAxis = Vector3.Cross(toTarget, transform.up);
                if (bendAxis.sqrMagnitude < 1e-8f) return;
            }
            bendAxis.Normalize();

            // 現在の内角
            float currentAngleAtA = Vector3.Angle(b - a, c - a);
            float currentAngleAtB = Vector3.Angle(a - b, c - b);

            // 目標距離を満たす内角（余弦定理）
            float targetAngleAtA = LawOfCosines(upperLength, clamped, lowerLength);
            float targetAngleAtB = LawOfCosines(upperLength, lowerLength, clamped);

            upper.rotation = Quaternion.AngleAxis(targetAngleAtA - currentAngleAtA, bendAxis) * upper.rotation;
            lower.rotation = Quaternion.AngleAxis(targetAngleAtB - currentAngleAtB, bendAxis) * lower.rotation;

            // 曲げたあとの手の位置を測り直してから、腕全体を目標へ向ける
            Vector3 handAfterBend = hand.position;
            Vector3 currentDirection = handAfterBend - a;
            if (currentDirection.sqrMagnitude < 1e-8f) return;

            upper.rotation = Quaternion.FromToRotation(currentDirection, toTarget) * upper.rotation;
        }

        /// <summary>辺 adjacentA, adjacentB に挟まれた角（度）。opposite は対辺。</summary>
        private static float LawOfCosines(float adjacentA, float adjacentB, float opposite)
        {
            float cos = (adjacentA * adjacentA + adjacentB * adjacentB - opposite * opposite)
                      / (2f * adjacentA * adjacentB);
            return Mathf.Acos(Mathf.Clamp(cos, -1f, 1f)) * Mathf.Rad2Deg;
        }
    }
}
