// ==============================================
// Arsist Extension: quest-room — Layster.Spatial の provider
// samples/extensions/quest-room/Runtime/QuestRoomSpatialProvider.cs
//
// Layster.Spatial のプロジェクトで、MRUK が読んだ部屋 (床・壁・天井・机・ソファ…) を世界の状態の entity にする
// (doc/19-layster.md §3.2、doc/20-spatial-runtime.md §3)。Virtual のプロジェクトでは足されない。
//   形      MRUK の面 (PlaneRect) は厚み 0 の箱、物 (VolumeBounds) は箱。どちらも ArsistSpatial の Box で
//           「一番鉛直に近い軸 = 高さ、残りのうち後の軸 = 奥行き (+Z)」にする。MRUK の面は transform.forward が
//           法線 (壁は部屋の内側) なので、壁の +Z は部屋の内側になる
//   言葉    RoomGeometry.NameOf のラベル名 ('wall' / 'table' / 'storage' …) を語彙の正規の言葉にする
//           ('storage' → 'shelf')。見えない壁 (開けた部屋の境界) は wall、部屋全体のメッシュは入れない
//   id      'mruk-' + アンカーの UUID の先頭 8 文字。起動をまたいで同じなので、keep: forever の基準に使える
//   床      床のアンカーの高さを、spatial の床の高さとして知らせる (確かさ 0.9)
//   出どころ 'scan'、確かさ 0.95 (床 0.9)
//   隠す形  ISpatialOccluderSource として、アンカーごとの箱を出す (面は裏に 5 cm の厚み。QuestRoomService の
//           occlusion と同じ形)。エンジン (SpatialOcclusion) が深度だけ書く箱にし、occlusion: "auto" の物がその向こうで隠れる。
//           箱はアンカーの子なので、アンカーが動けば一緒に動く
// ==============================================

using System.Collections.Generic;
using Arsist.Runtime.Spatial;
using Meta.XR.MRUtilityKit;
using UnityEngine;

namespace Arsist.Extensions.QuestRoom
{
    internal sealed class QuestRoomSpatialProvider : ISpatialProvider, ISpatialOccluderSource
    {
        private const float PlaneThickness = 0.05f;
        private readonly List<SpatialOccluder> _occluders = new List<SpatialOccluder>();
        public int OccluderVersion { get; private set; }

        public void CollectOccluders(List<SpatialOccluder> into) => into.AddRange(_occluders);

        private readonly System.Func<QuestRoomService> _service;
        private MRUKRoom _room;
        private int _anchorCount = -1;
        private bool _readyReported;
        private readonly HashSet<string> _written = new HashSet<string>();

        public QuestRoomSpatialProvider(System.Func<QuestRoomService> service)
        {
            _service = service;
        }

        public string Id => "quest-room";

        public void Begin(SpatialProviderContext context)
        {
            context.Log("quest-room provider: waiting for the room");
        }

        public void Tick(SpatialProviderContext context)
        {
            var service = _service();
            if (service == null || !service.Ready || service.Room == null) return;
            var room = service.Room;
            int count = room.Anchors != null ? room.Anchors.Count : 0;
            if (room == _room && count == _anchorCount) return;
            _room = room;
            _anchorCount = count;
            Rebuild(context, room);
            if (!_readyReported)
            {
                _readyReported = true;
                context.Ready("quest-room");
            }
        }

        private static string IdOf(MRUKAnchor anchor, int index)
        {
            var uuid = anchor.Anchor.Uuid;
            return uuid != System.Guid.Empty ? "mruk-" + uuid.ToString("N").Substring(0, 8) : $"mruk-{anchor.name}-{index}";
        }

        private void Rebuild(SpatialProviderContext context, MRUKRoom room)
        {
            var keep = new HashSet<string>();
            _occluders.Clear();
            int index = 0;
            int written = 0;
            foreach (var anchor in room.Anchors)
            {
                index++;
                if (anchor == null) continue;
                var name = RoomGeometry.NameOf(anchor.Label);
                if (name == "mesh") continue;
                bool invisible = name == "invisibleWall";
                if (invisible) name = "wall";
                var t = anchor.transform;
                Vector3 center;
                Vector3 size;
                if (anchor.VolumeBounds.HasValue)
                {
                    var b = anchor.VolumeBounds.Value;
                    center = t.TransformPoint(b.center);
                    size = Vector3.Scale(b.size, t.lossyScale);
                    if (!invisible) _occluders.Add(new SpatialOccluder { Parent = t, Center = b.center, Rotation = Quaternion.identity, Size = b.size });
                }
                else if (anchor.PlaneRect.HasValue)
                {
                    var r = anchor.PlaneRect.Value;
                    center = t.TransformPoint(new Vector3(r.center.x, r.center.y, 0));
                    size = Vector3.Scale(new Vector3(r.width, r.height, 0), t.lossyScale);
                    // 表は面そのもの、厚みは裏 (部屋の外) へ。見えない壁 (開けた部屋の境界) は何も隠さない
                    if (!invisible)
                    {
                        _occluders.Add(new SpatialOccluder
                        {
                            Parent = t, Center = new Vector3(r.center.x, r.center.y, -PlaneThickness / 2f),
                            Rotation = Quaternion.identity, Size = new Vector3(r.width, r.height, PlaneThickness),
                        });
                    }
                }
                else continue;

                var id = IdOf(anchor, index);
                bool floor = name == "floor";
                var entity = context.Box(id, new[] { name }, center, t.rotation, size, floor ? 0.9 : 0.95, "scan");
                entity.Data = new Dictionary<string, object> { ["mruk"] = anchor.Label.ToString() };
                context.Upsert(entity);
                keep.Add(id);
                written++;
                if (floor) context.ReportFloor(center.y, 0.9, "quest-room floor");
            }
            // 前に書いて、今回の部屋に無いものだけ消す (他の provider の entity には触らない)
            foreach (var old in _written) if (!keep.Contains(old)) context.Remove(old);
            _written.Clear();
            _written.UnionWith(keep);
            OccluderVersion++;
            context.Log($"quest-room provider: {written} entities, {_occluders.Count} occluder boxes from room '{room.name}'");
        }
    }
}
