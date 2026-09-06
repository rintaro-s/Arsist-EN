// ==============================================
// Arsist Engine - Hand Tracking Interaction (Quest)
// Assets/Arsist/Runtime/Input/ArsistHandInteraction.cs
// ==============================================
using UnityEngine;
using System.Collections.Generic;
#if XR_HANDS
using UnityEngine.XR.Hands;
#endif

namespace Arsist.Runtime.Input
{
    /// <summary>
    /// ハンドトラッキング（Quest）でオブジェクトを指差し選択・ピンチ決定する。
    ///
    /// 選択対象への通知は ArsistGazeInput / ArsistGazeTarget と同じ
    /// SendMessage("OnGazeEnter"/"OnGazeExit"/"OnGazeDwellSelect") を再利用する。
    /// こうすることで、IR の「視線で選択」ロジックで生成された UnityEvent
    /// （ArsistGazeTarget.onGazeSelect）が、視線・コントローラーレイ・ハンドトラッキングの
    /// どれで選んでも同じように発火する。新しいイベント名を増やさない。
    ///
    /// レイの起点・方向は指の関節位置だけから作る（親指/人差し指の指先の距離をピンチ判定に、
    /// 人差し指の付け根→指先の向きをポインタ方向に使う）。手首の回転を forward に使わないのは、
    /// 手首を捻ったときの指し先のブレが大きく、実用に耐えないため。
    ///
    /// ビルド設定 (ARSettings.interaction.handTracking) が有効かつ Quest ビルドのときのみ、
    /// ArsistBuildPipeline.ApplyInteractionSettings がこのコンポーネントを XR Origin に付与する。
    ///
    /// com.unity.xr.hands が入っていないプロジェクト（XREAL単体等）でもビルドが壊れないよう、
    /// 実処理は丸ごと #if XR_HANDS で囲む。パッケージが無ければ何もしない空コンポーネントになる。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class ArsistHandInteraction : MonoBehaviour
    {
#if XR_HANDS
        [Header("Ray")]
        [Tooltip("指先からのレイの最大検出距離(m)")]
        [SerializeField] private float _maxDistance = 5f;
        [Tooltip("検出対象のレイヤーマスク")]
        [SerializeField] private LayerMask _raycastMask = -1;

        [Header("Pinch")]
        [Tooltip("親指と人差し指の指先の距離がこれ以下でピンチ開始とみなす(m)")]
        [SerializeField] private float _pinchThreshold = 0.025f;
        [Tooltip("ピンチ解除とみなす距離(m)。開始しきい値よりわずかに大きくし、境界での連打を防ぐ。")]
        [SerializeField] private float _pinchReleaseThreshold = 0.035f;

        [Header("Visual Feedback")]
        [SerializeField] private bool _showRay = true;
        [SerializeField] private Color _rayColor = new Color(0.35f, 0.75f, 1f, 0.8f);
        [SerializeField] private Color _rayPinchingColor = new Color(1f, 0.55f, 0.15f, 0.9f);

        private sealed class HandState
        {
            public LineRenderer Ray;
            public GameObject Current;
            public bool Pinching;
        }

        private readonly List<XRHandSubsystem> _subsystemBuffer = new List<XRHandSubsystem>();
        private XRHandSubsystem _subsystem;
        private readonly HandState _left = new HandState();
        private readonly HandState _right = new HandState();

        private void Awake()
        {
            _left.Ray = CreateRay("HandRay_L");
            _right.Ray = CreateRay("HandRay_R");
        }

        private LineRenderer CreateRay(string name)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);

            var line = go.AddComponent<LineRenderer>();
            line.startWidth = 0.004f;
            line.endWidth = 0.001f;
            line.positionCount = 2;
            line.useWorldSpace = true;

            // Unity の Object は == をオーバーロードしているので、?? ではなく == で見る
            // （XROriginSetup.FindSafeShader と同じ方針）
            Shader shader = null;
            foreach (var shaderName in new[] { "Unlit/Color", "Universal Render Pipeline/Unlit", "Sprites/Default" })
            {
                var candidate = Shader.Find(shaderName);
                if (candidate != null) { shader = candidate; break; }
            }
            if (shader != null)
            {
                line.material = new Material(shader) { color = _rayColor };
            }
            line.enabled = false;
            return line;
        }

        private void Update()
        {
            if (_subsystem == null || !_subsystem.running)
            {
                _subsystem = FindRunningHandSubsystem();
            }

            if (_subsystem == null)
            {
                ReleaseHand(_left);
                ReleaseHand(_right);
                return;
            }

            UpdateHand(_subsystem.leftHand, _left);
            UpdateHand(_subsystem.rightHand, _right);
        }

        private XRHandSubsystem FindRunningHandSubsystem()
        {
            _subsystemBuffer.Clear();
            SubsystemManager.GetSubsystems(_subsystemBuffer);
            for (int i = 0; i < _subsystemBuffer.Count; i++)
            {
                if (_subsystemBuffer[i] != null && _subsystemBuffer[i].running) return _subsystemBuffer[i];
            }
            return null;
        }

        private void UpdateHand(XRHand hand, HandState state)
        {
            if (!hand.isTracked
                || !hand.GetJoint(XRHandJointID.IndexProximal).TryGetPose(out var proximal)
                || !hand.GetJoint(XRHandJointID.IndexTip).TryGetPose(out var tip))
            {
                ReleaseHand(state);
                return;
            }

            var origin = tip.position;
            var direction = tip.position - proximal.position;
            direction = direction.sqrMagnitude > 1e-8f ? direction.normalized : (tip.rotation * Vector3.forward);

            var wasPinching = state.Pinching;
            state.Pinching = ComputePinch(hand, wasPinching);

            var endPos = origin + direction * _maxDistance;
            GameObject hitTarget = null;
            Vector3 hitPoint = default;
            if (Physics.Raycast(origin, direction, out var hit, _maxDistance, _raycastMask))
            {
                endPos = hit.point;
                hitPoint = hit.point;
                hitTarget = hit.collider.gameObject;
            }

            if (_showRay && state.Ray != null)
            {
                state.Ray.enabled = true;
                state.Ray.material.color = state.Pinching ? _rayPinchingColor : _rayColor;
                state.Ray.SetPosition(0, origin);
                state.Ray.SetPosition(1, endPos);
            }
            else if (state.Ray != null)
            {
                state.Ray.enabled = false;
            }

            if (hitTarget != state.Current)
            {
                if (state.Current != null)
                {
                    state.Current.SendMessage("OnGazeExit", SendMessageOptions.DontRequireReceiver);
                }
                state.Current = hitTarget;
                if (state.Current != null)
                {
                    state.Current.SendMessage("OnGazeEnter", hitPoint, SendMessageOptions.DontRequireReceiver);
                }
            }

            // ピンチ「開始」の立ち上がりだけを決定として送る（押しっぱなしで連打しない）。
            if (state.Pinching && !wasPinching && state.Current != null)
            {
                state.Current.SendMessage("OnGazeDwellSelect", hitPoint, SendMessageOptions.DontRequireReceiver);
            }
            // ピンチを保持している間は毎フレーム送る（Slider をつまんでドラッグする用途）
            if (state.Pinching && state.Current != null)
            {
                state.Current.SendMessage("OnGazeDrag", hitPoint, SendMessageOptions.DontRequireReceiver);
            }
        }

        private bool ComputePinch(XRHand hand, bool wasPinching)
        {
            if (!hand.GetJoint(XRHandJointID.ThumbTip).TryGetPose(out var thumb)
                || !hand.GetJoint(XRHandJointID.IndexTip).TryGetPose(out var index))
            {
                return false;
            }

            var distance = Vector3.Distance(thumb.position, index.position);
            return wasPinching ? distance <= _pinchReleaseThreshold : distance <= _pinchThreshold;
        }

        private void ReleaseHand(HandState state)
        {
            if (state.Current != null)
            {
                state.Current.SendMessage("OnGazeExit", SendMessageOptions.DontRequireReceiver);
                state.Current = null;
            }
            state.Pinching = false;
            if (state.Ray != null) state.Ray.enabled = false;
        }
#endif
    }
}
