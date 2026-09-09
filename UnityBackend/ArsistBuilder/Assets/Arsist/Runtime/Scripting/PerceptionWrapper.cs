// ==============================================
// Arsist Engine - Perception Wrapper
// Assets/Arsist/Runtime/Scripting/PerceptionWrapper.cs
//
// Jint に "perception" として公開される。
// 姿勢は実行時の Unity ワールド座標（IR の X 反転前ではない）。
//
// タスクの起動は api.get と同じコールバック形にしてある。OCR が非同期なのは
// HTTP が非同期なのと同じ理由なので、書き味を揃えた方が迷わない。
// ==============================================

using Arsist.Runtime.Perception;
using Arsist.Runtime.Perception.Text;
using Jint;
using Jint.Native;
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    [UnityEngine.Scripting.Preserve]
    public class PerceptionTargetInfo
    {
        public string Id { get; set; }
        public string Name { get; set; }
        /// <summary>一度でも姿勢が確定したか。確定後はワールドに固定される。</summary>
        public bool Localized { get; set; }
        /// <summary>直近に実際に見えているか。</summary>
        public bool Visible { get; set; }
        public double X { get; set; }
        public double Y { get; set; }
        public double Z { get; set; }
        public double RotationX { get; set; }
        public double RotationY { get; set; }
        public double RotationZ { get; set; }
        /// <summary>融合に使った観測数。多いほど姿勢が安定している。</summary>
        public int Observations { get; set; }
        /// <summary>直近の再投影誤差 (px)。小さいほど良い。</summary>
        public double Rmse { get; set; }
    }

    [UnityEngine.Scripting.Preserve]
    public class PerceptionTaskResult
    {
        public bool Ok { get; set; }
        public string Text { get; set; }
        public string[] Lines { get; set; }
        public string Error { get; set; }
        public int ElapsedMs { get; set; }
    }

    [UnityEngine.Scripting.Preserve]
    public class PerceptionWrapper
    {
        private readonly Engine _engine;

        public PerceptionWrapper(Engine engine)
        {
            _engine = engine;
        }

        /// <summary>ターゲットの姿勢が確定しているか。</summary>
        [UnityEngine.Scripting.Preserve]
        public bool isTracked(string targetId)
        {
            var state = Resolve(targetId);
            return state != null && state.Localized;
        }

        /// <summary>いま実際にカメラに映っているか。</summary>
        [UnityEngine.Scripting.Preserve]
        public bool isVisible(string targetId)
        {
            var state = Resolve(targetId);
            return state != null && state.Visible;
        }

        /// <summary>ターゲットの現在の姿勢。未確定なら null。</summary>
        [UnityEngine.Scripting.Preserve]
        public PerceptionTargetInfo getPose(string targetId)
        {
            var state = Resolve(targetId);
            if (state == null || !state.Localized) return null;
            return ToInfo(state);
        }

        /// <summary>領域の中心のワールド姿勢。ターゲット未確定なら null。</summary>
        [UnityEngine.Scripting.Preserve]
        public PerceptionTargetInfo getRegionPose(string targetId, string regionId)
        {
            var state = Resolve(targetId);
            if (state == null || !state.Localized) return null;

            var info = ToInfo(state);
            if (string.IsNullOrEmpty(regionId) ||
                !state.Regions.TryGetValue(regionId, out var rect))
            {
                return info;
            }

            // 印刷面基準の中心 → アンカーのローカル (+X は印刷面の左) → ワールド
            float printedX = (rect.X + rect.Width * 0.5f - 0.5f) * state.PhysicalWidth;
            float printedY = (rect.Y + rect.Height * 0.5f - 0.5f) * state.PhysicalHeight;
            var world = state.Position + state.Rotation * new Vector3(-printedX, printedY, 0f);

            info.X = world.x;
            info.Y = world.y;
            info.Z = world.z;
            return info;
        }

        /// <summary>登録されている全ターゲットのID。</summary>
        [UnityEngine.Scripting.Preserve]
        public string[] listTargets()
        {
            var manager = ArsistPerceptionManager.Instance;
            if (manager == null) return new string[0];

            var ids = new string[manager.States.Count];
            int i = 0;
            foreach (var key in manager.States.Keys) ids[i++] = key;
            return ids;
        }

        /// <summary>タスクを実行する（結果は DataStore とイベントにも出る）。</summary>
        [UnityEngine.Scripting.Preserve]
        public void run(string taskId)
        {
            run(taskId, null);
        }

        /// <summary>タスクを実行し、完了時にコールバックを呼ぶ。</summary>
        [UnityEngine.Scripting.Preserve]
        public void run(string taskId, JsValue callback)
        {
            var runner = ArsistPerceptionTaskRunner.Instance;
            if (runner == null)
            {
                Debug.LogWarning("[Arsist] perception.run called but no task runner is in the scene.");
                Invoke(callback, ToResult(TextResult.Failure("noRunner")));
                return;
            }

            runner.Run(taskId, (result) => Invoke(callback, ToResult(result)));
        }

        /// <summary>直近の結果（同期）。まだ実行していなければ null。</summary>
        [UnityEngine.Scripting.Preserve]
        public PerceptionTaskResult lastResult(string taskId)
        {
            var runner = ArsistPerceptionTaskRunner.Instance;
            var result = runner != null ? runner.GetLastResult(taskId) : null;
            return result == null ? null : ToResult(result);
        }

        private void Invoke(JsValue callback, PerceptionTaskResult result)
        {
            if (callback == null || callback.IsNull() || callback.IsUndefined()) return;
            try
            {
                // Jint 4.x: engine.Invoke(callable, thisValue, arguments) — ApiWrapper と同じ形
                _engine.Invoke(callback, JsValue.Undefined, new[] { JsValue.FromObject(_engine, result) });
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[ArsistJS] perception callback failed: {e.Message}");
            }
        }

        private static PerceptionTaskResult ToResult(TextResult result)
        {
            return new PerceptionTaskResult
            {
                Ok = result.Ok,
                Text = result.Text,
                Lines = result.Lines,
                Error = result.Error,
                ElapsedMs = result.ElapsedMs,
            };
        }

        private static PerceptionTargetInfo ToInfo(PerceptionTargetState state)
        {
            var euler = state.Rotation.eulerAngles;
            return new PerceptionTargetInfo
            {
                Id = state.Id,
                Name = state.Name,
                Localized = state.Localized,
                Visible = state.Visible,
                X = state.Position.x,
                Y = state.Position.y,
                Z = state.Position.z,
                RotationX = euler.x,
                RotationY = euler.y,
                RotationZ = euler.z,
                Observations = state.ObservationCount,
                Rmse = state.LastRmse,
            };
        }

        private static PerceptionTargetState Resolve(string targetId)
        {
            var manager = ArsistPerceptionManager.Instance;
            return manager != null ? manager.GetState(targetId) : null;
        }
    }
}
