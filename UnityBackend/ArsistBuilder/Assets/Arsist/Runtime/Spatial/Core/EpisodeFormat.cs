// ==============================================
// Arsist Engine - Layster.Spatial core: 記録の形式 layster.episode/1
// Assets/Arsist/Runtime/Spatial/Core/EpisodeFormat.cs
//
// 1 回の記録 = フォルダ 1 つ (doc/20-spatial-runtime.md §5):
//   meta.json       { format, app, layster, device, startedAt (ISO), streams, hz, frame: "world" }
//   episode.jsonl   1 行 1 出来事 { "t": 起動からの秒, "kind": "...", "data": {...} }
//   camera/<t>.jpg  カメラの静止画 (camera を記録するときだけ。行は kind "camera" で file を指す)
// kind: pose / hands / world / event / action / mind / camera / mark / start / stop
// 位置はすべて spatial の world (起動したときの足元が原点、メートル)。UnityEngine に依存しない。
// ==============================================

using System.Collections.Generic;
using Arsist.Runtime.Inference;

namespace Arsist.Runtime.Spatial.Core
{
    public static class EpisodeFormat
    {
        public const string Format = "layster.episode/1";

        public static string Line(double t, string kind, object data)
        {
            return MiniJson.Write(new Dictionary<string, object>
            {
                ["t"] = SpatialMath.Round3(t),
                ["kind"] = kind,
                ["data"] = data,
            });
        }

        public static string Meta(string app, string layster, string device, string startedAtIso, List<string> streams, double hz)
        {
            return MiniJson.Write(new Dictionary<string, object>
            {
                ["format"] = Format,
                ["app"] = app,
                ["layster"] = layster,
                ["device"] = device,
                ["startedAt"] = startedAtIso,
                ["streams"] = new List<object>(streams),
                ["hz"] = hz,
                ["frame"] = "world",
            });
        }

        public static Dictionary<string, object> Pose(Vec3 head, Vec3 forward, Vec3 feet, double yaw)
        {
            return new Dictionary<string, object>
            {
                ["head"] = head.ToPlainRounded(),
                ["forward"] = forward.ToPlainRounded(),
                ["feet"] = feet.ToPlainRounded(),
                ["yaw"] = SpatialMath.Round3(yaw),
            };
        }
    }
}
