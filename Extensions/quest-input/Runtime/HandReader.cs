// ==============================================
// Arsist Extension: quest-input — hand tracking
// Extensions/quest-input/Runtime/HandReader.cs
//
// Unity の XR Hands (XRHandSubsystem) から 26 関節を読む。Quest では OpenXR の
// "Hand Tracking Subsystem" 機能が要る (エンジンが Quest ビルドで有効にしている:
// ArsistBuildPipeline.EnableQuestOpenXRFeatures)。
//
// 関節の姿勢は XR Origin 基準 (XR Hands の仕様) なので、カメラの親 (トラッキング空間) で
// ワールドに直す。ジェスチャーの判定は HandGestureMath (UnityEngine 非依存、検証済み)。
// ==============================================

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.Hands;

namespace Arsist.Extensions.QuestInput
{
    internal sealed class HandState
    {
        public readonly string Hand;
        public bool Tracked;
        public readonly V3[] Joints = new V3[Joint.Count];
        public readonly Pose[] Poses = new Pose[Joint.Count];
        public bool Pinching;
        public float PinchStrength;
        /// <summary>確定したジェスチャー (候補が HoldSeconds 続いたもの)。</summary>
        public string Gesture = "none";
        public string Candidate = "none";
        public float CandidateSince;
        /// <summary>手のひらの速度 (m/s、ワールド)。投げるときに使う。</summary>
        public Vector3 Velocity;
        private Vector3 _lastPalm;
        private bool _hasLast;

        public HandState(string hand) { Hand = hand; }

        public Pose Palm => Poses[Joint.Palm];

        /// <summary>つまんでいる点 (親指と人差し指の指先の中点)。</summary>
        public Vector3 PinchPoint => (Poses[Joint.ThumbTip].position + Poses[Joint.IndexTip].position) * 0.5f;

        public void TrackVelocity(float dt)
        {
            var palm = Palm.position;
            if (_hasLast && dt > 1e-4f)
            {
                var v = (palm - _lastPalm) / dt;
                Velocity = Vector3.Lerp(Velocity, v, 0.5f);
            }
            _lastPalm = palm;
            _hasLast = true;
        }

        public void Lose()
        {
            Tracked = false;
            Pinching = false;
            PinchStrength = 0f;
            // 見失ったら形も「無し」に (最後の形が残ると、戻ったときに同じ形の出来事が鳴らない)
            Gesture = "none";
            Candidate = "none";
            _hasLast = false;
            Velocity = Vector3.zero;
        }
    }

    internal sealed class HandReader
    {
        public readonly HandState Left = new HandState("left");
        public readonly HandState Right = new HandState("right");
        private readonly List<XRHandSubsystem> _buffer = new List<XRHandSubsystem>();
        private XRHandSubsystem _subsystem;
        private float _nextLookup;

        public bool Available => _subsystem != null && _subsystem.running;

        public HandState Get(string hand)
        {
            switch ((hand ?? "").Trim().ToLowerInvariant())
            {
                case "left":
                case "l":
                    return Left;
                case "right":
                case "r":
                    return Right;
                default:
                    return null;
            }
        }

        /// <summary>動いている XRHandSubsystem を探す。見つかったときだけ true (ログ用)。</summary>
        public bool Lookup()
        {
            if (Available) return false;
            if (Time.unscaledTime < _nextLookup) return false;
            _nextLookup = Time.unscaledTime + 1f;
            _buffer.Clear();
            SubsystemManager.GetSubsystems(_buffer);
            foreach (var s in _buffer)
            {
                if (s != null && s.running)
                {
                    _subsystem = s;
                    return true;
                }
            }
            return false;
        }

        public void Read(Transform space, float dt, float holdSeconds)
        {
            if (!Available)
            {
                Left.Lose();
                Right.Lose();
                return;
            }
            Read(_subsystem.leftHand, Left, space, dt, holdSeconds);
            Read(_subsystem.rightHand, Right, space, dt, holdSeconds);
        }

        private static void Read(XRHand hand, HandState state, Transform space, float dt, float holdSeconds)
        {
            if (!hand.isTracked)
            {
                state.Lose();
                return;
            }

            for (int i = 1; i < Joint.Count; i++)
            {
                var joint = hand.GetJoint((XRHandJointID)i);
                if (!joint.TryGetPose(out var pose)) continue;
                var world = space != null
                    ? new Pose(space.TransformPoint(pose.position), space.rotation * pose.rotation)
                    : pose;
                state.Poses[i] = world;
                state.Joints[i] = new V3(world.position.x, world.position.y, world.position.z);
            }
            state.Tracked = true;
            state.TrackVelocity(dt);

            state.Pinching = HandGestureMath.IsPinching(state.Joints, state.Pinching);
            state.PinchStrength = HandGestureMath.PinchStrength(state.Joints);

            // 候補が一定時間続いたら確定する (指の動きの途中で一瞬だけ別の形に見えるのを拾わない)
            var candidate = HandGestureMath.Classify(state.Joints, state.Pinching, new V3(0, 1, 0));
            if (candidate != state.Candidate)
            {
                state.Candidate = candidate;
                state.CandidateSince = Time.unscaledTime;
            }
            if (state.Candidate != state.Gesture && Time.unscaledTime - state.CandidateSince >= holdSeconds)
            {
                state.Gesture = state.Candidate;
            }
        }

        /// <summary>関節の名前 (XRHandJointID と同じ、大文字小文字は問わない) → 番号。無ければ -1。</summary>
        public static int JointIndex(string name)
        {
            if (string.IsNullOrEmpty(name)) return -1;
            // Wrist は BeginMarker と同じ値なので、ToString() がどちらを返すかに頼らない
            if (string.Equals(name.Trim(), "wrist", System.StringComparison.OrdinalIgnoreCase)) return Joint.Wrist;
            for (int i = 2; i < Joint.Count; i++)
            {
                if (string.Equals(((XRHandJointID)i).ToString(), name.Trim(), System.StringComparison.OrdinalIgnoreCase)) return i;
            }
            return -1;
        }
    }
}
