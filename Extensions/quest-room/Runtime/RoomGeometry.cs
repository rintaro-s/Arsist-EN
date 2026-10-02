// ==============================================
// Arsist Extension: quest-room — room vocabulary and geometry helpers
// Extensions/quest-room/Runtime/RoomGeometry.cs
//
// MRUK のラベル (WALL_FACE など) と、IR / スクリプトで使う言葉 (wall / table …) の対応、
// それと物を面に置くための幾何。
//
// MRUK の約束 (MRUKRoom.GetFacingDirection のコメント):
//   面 (plane) のアンカーは transform.forward が法線。壁は部屋の内側、床は上、天井は下を向く。
//   PlaneRect はアンカーのローカル XY 平面上の矩形、VolumeBounds はローカル座標の箱。
// ==============================================

using System;
using System.Collections.Generic;
using Meta.XR.MRUtilityKit;
using UnityEngine;

namespace Arsist.Extensions.QuestRoom
{
    internal static class RoomGeometry
    {
        private const MRUKAnchor.SceneLabels Walls =
            MRUKAnchor.SceneLabels.WALL_FACE | MRUKAnchor.SceneLabels.INNER_WALL_FACE;

        /// <summary>IR / スクリプトの面の名前 → MRUK のラベル。不明なら null。</summary>
        public static MRUKAnchor.SceneLabels? LabelsFor(string surface)
        {
            switch ((surface ?? "").Trim().ToLowerInvariant())
            {
                case "wall": return Walls;
                case "floor": return MRUKAnchor.SceneLabels.FLOOR;
                case "ceiling": return MRUKAnchor.SceneLabels.CEILING;
                case "table": return MRUKAnchor.SceneLabels.TABLE;
                case "couch": return MRUKAnchor.SceneLabels.COUCH;
                case "bed": return MRUKAnchor.SceneLabels.BED;
                case "storage": return MRUKAnchor.SceneLabels.STORAGE;
                case "screen": return MRUKAnchor.SceneLabels.SCREEN;
                case "door": return MRUKAnchor.SceneLabels.DOOR_FRAME;
                case "window": return MRUKAnchor.SceneLabels.WINDOW_FRAME;
                case "art": return MRUKAnchor.SceneLabels.WALL_ART;
                case "lamp": return MRUKAnchor.SceneLabels.LAMP;
                case "plant": return MRUKAnchor.SceneLabels.PLANT;
                case "other": return MRUKAnchor.SceneLabels.OTHER;
                case "any":
                case "":
                    // 見えない壁 (開けた部屋の境界) と部屋全体のメッシュには置かない
                    return Walls | MRUKAnchor.SceneLabels.FLOOR | MRUKAnchor.SceneLabels.CEILING |
                           MRUKAnchor.SceneLabels.TABLE | MRUKAnchor.SceneLabels.COUCH | MRUKAnchor.SceneLabels.BED |
                           MRUKAnchor.SceneLabels.STORAGE | MRUKAnchor.SceneLabels.SCREEN | MRUKAnchor.SceneLabels.DOOR_FRAME |
                           MRUKAnchor.SceneLabels.WINDOW_FRAME | MRUKAnchor.SceneLabels.WALL_ART |
                           MRUKAnchor.SceneLabels.LAMP | MRUKAnchor.SceneLabels.PLANT | MRUKAnchor.SceneLabels.OTHER;
                default: return null;
            }
        }

        public static readonly string[] SurfaceNames =
            { "wall", "floor", "ceiling", "table", "couch", "bed", "storage", "screen", "door", "window", "art", "lamp", "plant", "other", "any" };

        /// <summary>MRUK のラベル → スクリプトに見せる名前。</summary>
        public static string NameOf(MRUKAnchor.SceneLabels label)
        {
            if ((label & Walls) != 0) return "wall";
            if ((label & MRUKAnchor.SceneLabels.INVISIBLE_WALL_FACE) != 0) return "invisibleWall";
            if ((label & MRUKAnchor.SceneLabels.FLOOR) != 0) return "floor";
            if ((label & MRUKAnchor.SceneLabels.CEILING) != 0) return "ceiling";
            if ((label & MRUKAnchor.SceneLabels.TABLE) != 0) return "table";
            if ((label & MRUKAnchor.SceneLabels.COUCH) != 0) return "couch";
            if ((label & MRUKAnchor.SceneLabels.BED) != 0) return "bed";
            if ((label & MRUKAnchor.SceneLabels.STORAGE) != 0) return "storage";
            if ((label & MRUKAnchor.SceneLabels.SCREEN) != 0) return "screen";
            if ((label & MRUKAnchor.SceneLabels.DOOR_FRAME) != 0) return "door";
            if ((label & MRUKAnchor.SceneLabels.WINDOW_FRAME) != 0) return "window";
            if ((label & MRUKAnchor.SceneLabels.WALL_ART) != 0) return "art";
            if ((label & MRUKAnchor.SceneLabels.LAMP) != 0) return "lamp";
            if ((label & MRUKAnchor.SceneLabels.PLANT) != 0) return "plant";
            if ((label & MRUKAnchor.SceneLabels.GLOBAL_MESH) != 0) return "mesh";
            return "other";
        }

        /// <summary>上に物を載せる面か (床・机・ソファ…)。壁や窓は横に貼る。</summary>
        public static bool IsHorizontal(string surface)
        {
            switch ((surface ?? "").Trim().ToLowerInvariant())
            {
                case "floor":
                case "ceiling":
                case "table":
                case "couch":
                case "bed":
                case "storage":
                    return true;
                default:
                    return false;
            }
        }

        /// <summary>箱 (VolumeBounds) の 8 隅をワールドで返す。</summary>
        public static Vector3[] VolumeCorners(MRUKAnchor anchor)
        {
            var b = anchor.VolumeBounds.Value;
            var corners = new Vector3[8];
            int i = 0;
            for (int x = 0; x < 2; x++)
            for (int y = 0; y < 2; y++)
            for (int z = 0; z < 2; z++)
            {
                var local = new Vector3(x == 0 ? b.min.x : b.max.x, y == 0 ? b.min.y : b.max.y, z == 0 ? b.min.z : b.max.z);
                corners[i++] = anchor.transform.TransformPoint(local);
            }
            return corners;
        }

        /// <summary>矩形 (PlaneRect) の 4 隅をワールドで返す (一周する順)。</summary>
        public static Vector3[] PlaneCorners(MRUKAnchor anchor)
        {
            var r = anchor.PlaneRect.Value;
            return new[]
            {
                anchor.transform.TransformPoint(new Vector3(r.xMin, r.yMin, 0)),
                anchor.transform.TransformPoint(new Vector3(r.xMax, r.yMin, 0)),
                anchor.transform.TransformPoint(new Vector3(r.xMax, r.yMax, 0)),
                anchor.transform.TransformPoint(new Vector3(r.xMin, r.yMax, 0)),
            };
        }

        /// <summary>上に物を載せる点 (箱なら天板の中央、面ならアンカーの位置)。</summary>
        public static Vector3 TopCenter(MRUKAnchor anchor)
        {
            if (anchor.VolumeBounds.HasValue)
            {
                var corners = VolumeCorners(anchor);
                float top = float.MinValue;
                var center = Vector3.zero;
                foreach (var c in corners) { top = Mathf.Max(top, c.y); center += c; }
                center /= corners.Length;
                return new Vector3(center.x, top, center.z);
            }
            return anchor.transform.position;
        }

        /// <summary>
        /// 物の見た目の範囲 (ワールド)。Renderer と、World Space Canvas の矩形を足し合わせる
        /// (Canvas の文字や画像には Renderer が無いので、矩形で見る)。
        /// </summary>
        public static bool TryWorldBounds(GameObject go, out Bounds bounds)
        {
            bool any = false;
            bounds = default;
            foreach (var r in go.GetComponentsInChildren<Renderer>())
            {
                if (!r.enabled || r is ParticleSystemRenderer) continue;
                if (!any) { bounds = r.bounds; any = true; }
                else bounds.Encapsulate(r.bounds);
            }
            var corners = new Vector3[4];
            foreach (var canvas in go.GetComponentsInChildren<Canvas>())
            {
                if (canvas.renderMode != RenderMode.WorldSpace) continue;
                var rect = canvas.transform as RectTransform;
                if (rect == null) continue;
                rect.GetWorldCorners(corners);
                foreach (var c in corners)
                {
                    if (!any) { bounds = new Bounds(c, Vector3.zero); any = true; }
                    else bounds.Encapsulate(c);
                }
            }
            return any;
        }

        /// <summary>水平にした向き (長さ 0 なら fallback)。</summary>
        public static Vector3 Flat(Vector3 v, Vector3 fallback)
        {
            v.y = 0;
            if (v.sqrMagnitude < 1e-6f)
            {
                fallback.y = 0;
                return fallback.sqrMagnitude < 1e-6f ? Vector3.forward : fallback.normalized;
            }
            return v.normalized;
        }

        /// <summary>
        /// スクリプトに渡す、アンカー 1 つの説明 (素の値)。座標は実行時の Unity ワールド
        /// (viewer.* / scene.* と同じ。IR の X 反転前ではない)。
        /// </summary>
        public static Dictionary<string, object> Describe(MRUKAnchor anchor)
        {
            var center = anchor.GetAnchorCenter();
            var normal = anchor.transform.forward;
            var d = new Dictionary<string, object>
            {
                ["label"] = NameOf(anchor.Label),
                ["x"] = Round(center.x),
                ["y"] = Round(center.y),
                ["z"] = Round(center.z),
                ["normal"] = new Dictionary<string, object> { ["x"] = Round(normal.x), ["y"] = Round(normal.y), ["z"] = Round(normal.z) },
            };
            if (anchor.VolumeBounds.HasValue)
            {
                // どのローカル軸が上下かは決め打ちしない (いちばん鉛直に近い軸を高さとする)
                var s = anchor.VolumeBounds.Value.size;
                var t = anchor.transform;
                float ux = Mathf.Abs(t.right.y), uy = Mathf.Abs(t.up.y), uz = Mathf.Abs(t.forward.y);
                float height, a, b;
                if (ux >= uy && ux >= uz) { height = s.x; a = s.y; b = s.z; }
                else if (uy >= uz) { height = s.y; a = s.x; b = s.z; }
                else { height = s.z; a = s.x; b = s.y; }
                d["width"] = Round(Mathf.Max(a, b));
                d["depth"] = Round(Mathf.Min(a, b));
                d["height"] = Round(height);
                d["top"] = Round(TopCenter(anchor).y);
            }
            else if (anchor.PlaneRect.HasValue)
            {
                var r = anchor.PlaneRect.Value;
                d["width"] = Round(r.width);
                d["height"] = Round(r.height);
            }
            return d;
        }

        public static double Round(float v) => Math.Round(v, 3);
    }
}
