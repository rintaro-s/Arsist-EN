// ==============================================
// Arsist Engine - Layster.Spatial core: 安全の門
// Assets/Arsist/Runtime/Spatial/Core/SafetyGate.cs
//
// 体 (ロボット) への命令はすべてここを通る (doc/19-layster.md §3.8)。順に:
//   1. 命令が体に無い              → unknownCommand
//   2. 目標が動ける範囲 (workspace) の外 → outsideWorkspace
//   3. ユーザーの手が目標から stopIfHandWithin 以内 → handTooClose
//   4. 1 秒あたりの回数の上限       → tooFrequent
//   5. confirm: always             → 通すが、確認が要る (NeedsConfirm)
// UnityEngine に依存しない。位置はすべて spatial の world。
// ==============================================

using System.Collections.Generic;

namespace Arsist.Runtime.Spatial.Core
{
    public struct SafetyVerdict
    {
        public bool Allowed;
        public bool NeedsConfirm;
        /// <summary>止めた理由 (Allowed なら null)。unknownCommand / outsideWorkspace / handTooClose / tooFrequent</summary>
        public string Reason;

        public static SafetyVerdict Block(string reason) => new SafetyVerdict { Allowed = false, Reason = reason };
    }

    public sealed class SafetyGate
    {
        private readonly BodyDef _body;
        private readonly List<double> _sent = new List<double>();

        public SafetyGate(BodyDef body)
        {
            _body = body;
        }

        /// <summary>world の点が、体の動ける範囲 (体の根元の frame での箱) に入っているか。</summary>
        public bool InWorkspace(Vec3 targetWorld, SpatialPose basePose)
        {
            var local = SpatialMath.PointToFrame(targetWorld, basePose.At, basePose.Yaw);
            var c = _body.WorkspaceCenter;
            var s = _body.WorkspaceSize;
            return System.Math.Abs(local.X - c.X) <= s.X / 2 + SpatialMath.Eps
                && System.Math.Abs(local.Y - c.Y) <= s.Y / 2 + SpatialMath.Eps
                && System.Math.Abs(local.Z - c.Z) <= s.Z / 2 + SpatialMath.Eps;
        }

        /// <param name="targetWorld">命令が指す場所 (無ければ null)</param>
        /// <param name="hands">ユーザーの手 (分からない手は null)</param>
        /// <param name="now">秒</param>
        public SafetyVerdict Check(string command, Vec3? targetWorld, SpatialPose basePose, Vec3?[] hands, double now)
        {
            var def = _body.Command(command);
            if (def == null) return SafetyVerdict.Block("unknownCommand");
            if (targetWorld.HasValue)
            {
                if (!InWorkspace(targetWorld.Value, basePose)) return SafetyVerdict.Block("outsideWorkspace");
                if (hands != null)
                {
                    foreach (var hand in hands)
                    {
                        if (!hand.HasValue) continue;
                        if ((hand.Value - targetWorld.Value).Length <= _body.StopIfHandWithin) return SafetyVerdict.Block("handTooClose");
                    }
                }
            }
            if (_body.MaxPerSecond > 0)
            {
                int recent = 0;
                foreach (var t in _sent) if (now - t < 1.0) recent++;
                if (recent >= _body.MaxPerSecond) return SafetyVerdict.Block("tooFrequent");
            }
            return new SafetyVerdict { Allowed = true, NeedsConfirm = def.Confirm == "always" };
        }

        /// <summary>手が、動いている体の目標に近づきすぎたか (動いている間、毎フレーム見る)。</summary>
        public bool HandTooClose(Vec3 targetWorld, Vec3?[] hands)
        {
            if (hands == null) return false;
            foreach (var hand in hands)
                if (hand.HasValue && (hand.Value - targetWorld).Length <= _body.StopIfHandWithin) return true;
            return false;
        }

        /// <summary>送ったことを記録する (回数の上限のため)。</summary>
        public void Sent(double now)
        {
            _sent.Add(now);
            _sent.RemoveAll(t => now - t >= 1.0);
        }

        public static string Explain(string reason)
        {
            switch (reason)
            {
                case "unknownCommand": return "blocked: unknown command";
                case "outsideWorkspace": return "blocked: outside the workspace";
                case "handTooClose": return "blocked: hand too close";
                case "tooFrequent": return "blocked: too many commands";
                case "declined": return "blocked: the user declined";
                case "notConnected": return "blocked: not connected";
                default: return "blocked: " + reason;
            }
        }
    }
}
