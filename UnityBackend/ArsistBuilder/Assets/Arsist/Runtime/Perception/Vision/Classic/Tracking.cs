// ==============================================
// Arsist Engine - Perception / Vision / Classic
// フレームをまたいで同じ物を追う (ID を付け、揺れを均し、速度を出す)
//
// 検出 (blobs / infer) はフレームごとに独立で、同じ物でも毎回別の項目として出る。
// それだと「この箱は前のフレームのあの箱」が分からず、ラベルを置いても毎フレーム
// 別の場所に飛ぶ。ここで近い物同士を結び付けて ID を与え、位置を指数平滑で均す。
//
// 方式は最近傍の貪欲な対応付け。カルマンフィルタほどの重さは要らない:
// AR で追うのは数個〜十数個の物で、フレーム間隔も 0.1〜0.5 秒程度。
//
// UnityEngine に依存しない。tools/perception-check で検証する。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public sealed class TrackedItem
    {
        public int Id;
        /// <summary>正規化した中心と大きさ (0..1、原点左下)。指数平滑済み。</summary>
        public double X, Y, W, H;
        /// <summary>正規化した速度 (1/秒)。</summary>
        public double Vx, Vy;
        public string Label;
        public double Score;
        /// <summary>見えた回数。</summary>
        public int Hits;
        /// <summary>続けて見えなかった回数。</summary>
        public int Missed;
        public double LastSeen;
        /// <summary>直近の検出そのもの (ラベル以外の項目を引き継ぐため)。</summary>
        public Dictionary<string, object> Last;
    }

    public sealed class TrackerState
    {
        public int NextId = 1;
        public readonly List<TrackedItem> Tracks = new List<TrackedItem>();
    }

    public static class Tracker
    {
        /// <summary>
        /// 今のフレームの検出を、追跡中の物に対応付けて更新し、追跡中の一覧を返す。
        /// </summary>
        /// <param name="items">blobs op や infer (detect) の出力 (x, y, width, height, label?, score?)。</param>
        /// <param name="time">フレームの時刻 (秒)。速度の計算に使う。</param>
        /// <param name="maxDistance">これより遠い物は別物とみなす (正規化)。</param>
        /// <param name="maxAge">見えなくなってから消すまでのフレーム数。</param>
        /// <param name="smooth">位置の平滑化 (0 = 均さない, 1 = 動かない)。</param>
        /// <param name="minHits">この回数以上見えたら stable。</param>
        /// <param name="matchLabel">ラベルが違う物は結び付けない。</param>
        public static List<object> Update(
            TrackerState state, List<object> items, double time,
            double maxDistance, int maxAge, double smooth, int minHits, bool matchLabel)
        {
            var detections = new List<Dictionary<string, object>>();
            foreach (var raw in items ?? new List<object>())
            {
                if (raw is Dictionary<string, object> d) detections.Add(d);
            }

            // 候補の組 (距離順) を作り、近いものから貪欲に結び付ける
            var pairs = new List<(double distance, int track, int detection)>();
            for (int t = 0; t < state.Tracks.Count; t++)
            {
                var track = state.Tracks[t];
                for (int d = 0; d < detections.Count; d++)
                {
                    var det = detections[d];
                    if (matchLabel && !string.Equals(track.Label, Text(det, "label"), StringComparison.Ordinal)) continue;
                    double dx = Number(det, "x") - track.X;
                    double dy = Number(det, "y") - track.Y;
                    double distance = Math.Sqrt(dx * dx + dy * dy);
                    if (distance <= maxDistance) pairs.Add((distance, t, d));
                }
            }
            pairs.Sort((a, b) => a.distance.CompareTo(b.distance));

            var trackUsed = new bool[state.Tracks.Count];
            var detectionUsed = new bool[detections.Count];
            foreach (var (_, t, d) in pairs)
            {
                if (trackUsed[t] || detectionUsed[d]) continue;
                trackUsed[t] = true;
                detectionUsed[d] = true;
                Observe(state.Tracks[t], detections[d], time, smooth);
            }

            // 見えなかった物は年を取り、古くなったら消す
            for (int t = state.Tracks.Count - 1; t >= 0; t--)
            {
                if (trackUsed[t]) continue;
                var track = state.Tracks[t];
                track.Missed++;
                if (track.Missed > maxAge) state.Tracks.RemoveAt(t);
            }

            // 新しい物
            for (int d = 0; d < detections.Count; d++)
            {
                if (detectionUsed[d]) continue;
                var det = detections[d];
                var track = new TrackedItem
                {
                    Id = state.NextId++,
                    X = Number(det, "x"), Y = Number(det, "y"),
                    W = Number(det, "width"), H = Number(det, "height"),
                    Label = Text(det, "label"), Score = Number(det, "score"),
                    Hits = 1, Missed = 0, LastSeen = time, Last = det,
                };
                state.Tracks.Add(track);
            }

            // 出力: 追跡中の物すべて (見えなかった物も missing=true で残す。ID を保つため)
            var result = new List<object>(state.Tracks.Count);
            foreach (var track in state.Tracks)
            {
                var item = new Dictionary<string, object>(track.Last ?? new Dictionary<string, object>())
                {
                    ["id"] = track.Id,
                    ["x"] = Math.Round(track.X, 4),
                    ["y"] = Math.Round(track.Y, 4),
                    ["width"] = Math.Round(track.W, 4),
                    ["height"] = Math.Round(track.H, 4),
                    ["vx"] = Math.Round(track.Vx, 4),
                    ["vy"] = Math.Round(track.Vy, 4),
                    ["hits"] = track.Hits,
                    ["age"] = track.Missed,
                    ["stable"] = track.Hits >= minHits,
                    ["missing"] = track.Missed > 0,
                };
                if (track.Label != null) item["label"] = track.Label;
                item["score"] = Math.Round(track.Score, 4);
                result.Add(item);
            }
            return result;
        }

        private static void Observe(TrackedItem track, Dictionary<string, object> det, double time, double smooth)
        {
            double x = Number(det, "x"), y = Number(det, "y");
            double w = Number(det, "width"), h = Number(det, "height");
            double dt = time - track.LastSeen;
            if (dt > 1e-6)
            {
                // 速度は生の位置差から (平滑後の差だと遅れて小さく出る)
                double vx = (x - track.X) / dt, vy = (y - track.Y) / dt;
                track.Vx = track.Hits == 1 ? vx : track.Vx * 0.5 + vx * 0.5;
                track.Vy = track.Hits == 1 ? vy : track.Vy * 0.5 + vy * 0.5;
            }
            double keep = Math.Max(0, Math.Min(0.95, smooth));
            track.X = track.X * keep + x * (1 - keep);
            track.Y = track.Y * keep + y * (1 - keep);
            track.W = track.W * keep + w * (1 - keep);
            track.H = track.H * keep + h * (1 - keep);
            track.Score = Number(det, "score");
            var label = Text(det, "label");
            if (label != null) track.Label = label;
            track.Hits++;
            track.Missed = 0;
            track.LastSeen = time;
            track.Last = det;
        }

        internal static double Number(Dictionary<string, object> d, string key)
        {
            if (d == null || !d.TryGetValue(key, out var raw) || raw == null) return 0;
            try { return Convert.ToDouble(raw); } catch { return 0; }
        }

        internal static string Text(Dictionary<string, object> d, string key)
        {
            if (d == null || !d.TryGetValue(key, out var raw) || raw == null) return null;
            return raw.ToString();
        }
    }
}
