// ==============================================
// Arsist Engine - Layster.Spatial core: 世界の状態
// Assets/Arsist/Runtime/Spatial/Core/WorldState.cs
//
// entity の表 (doc/19-layster.md §3.2)。部屋のスキャン・検出・Mind の推測・スクリプトが同じ表に書く。
//
// 出どころ (source) による扱いの違い:
//   scan / space / user / assumed     確かめた (と端末が言う) もの。時間では薄れない
//   detector:<id> / mind:<id> / script 見えたとき・推測したときの確かさが、時間とともに下がる
//                                      (検出は 10 秒、推測は 20 秒で 1/e)。0.15 を切ると消える (Lost)
// 薄れる出どころの値は、薄れない出どころの entity を「より低い確かさで」上書きできない
// (Mind が机を 5 m 先に動かしてしまわないように)。
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Spatial.Core
{
    public sealed class WorldState
    {
        public const double ForgetBelow = 0.15;
        public const double DetectorTau = 10;
        public const double BeliefTau = 20;

        private sealed class Slot
        {
            public Entity Entity;
            public double BaseConfidence;
            public double BaseTime;
        }

        private readonly Vocabulary _vocab;
        private readonly List<string> _order = new List<string>();
        private readonly Dictionary<string, Slot> _slots = new Dictionary<string, Slot>(StringComparer.Ordinal);

        /// <summary>何か変わるたびに増える (Mind の run.on = change、keep = none の置き直しが見る)。</summary>
        public int Version { get; private set; }

        public event Action<Entity> Seen;
        public event Action<Entity> Lost;

        public WorldState(Vocabulary vocabulary)
        {
            _vocab = vocabulary ?? new Vocabulary();
        }

        public Vocabulary Vocabulary => _vocab;

        public static bool Fades(string source)
        {
            if (string.IsNullOrEmpty(source)) return false;
            return source.StartsWith("mind:", StringComparison.Ordinal)
                || source.StartsWith("detector:", StringComparison.Ordinal)
                || source == "script";
        }

        private static double TauOf(string source) =>
            source != null && source.StartsWith("detector:", StringComparison.Ordinal) ? DetectorTau : BeliefTau;

        public Entity Get(string id) => id != null && _slots.TryGetValue(id, out var slot) ? slot.Entity : null;

        /// <summary>今の entity (足した順)。</summary>
        public List<Entity> Entities()
        {
            var list = new List<Entity>(_order.Count);
            foreach (var id in _order) list.Add(_slots[id].Entity);
            return list;
        }

        /// <summary>足す・更新する。足したら Seen。今の値を守るために断ったら false。</summary>
        public bool Upsert(Entity incoming, double now)
        {
            if (incoming == null || string.IsNullOrEmpty(incoming.Id)) return false;
            if (_slots.TryGetValue(incoming.Id, out var slot))
            {
                var current = slot.Entity;
                if (!Fades(current.Source) && Fades(incoming.Source) && incoming.Confidence < current.Confidence) return false;
                slot.Entity = incoming;
                slot.BaseConfidence = incoming.Confidence;
                slot.BaseTime = incoming.SeenAt ?? now;
                if (incoming.SeenAt == null) incoming.SeenAt = now;
                Version++;
                return true;
            }
            if (incoming.SeenAt == null) incoming.SeenAt = now;
            _slots[incoming.Id] = new Slot { Entity = incoming, BaseConfidence = incoming.Confidence, BaseTime = incoming.SeenAt.Value };
            _order.Add(incoming.Id);
            Version++;
            Seen?.Invoke(incoming);
            return true;
        }

        public bool Remove(string id)
        {
            if (id == null || !_slots.TryGetValue(id, out var slot)) return false;
            _slots.Remove(id);
            _order.Remove(id);
            Version++;
            Lost?.Invoke(slot.Entity);
            return true;
        }

        /// <summary>ある出どころの entity を全部消す (provider が部屋を読み直したときなど)。keep にある id は残す。</summary>
        public void RemoveSource(string source, HashSet<string> keep = null)
        {
            foreach (var id in _order.ToArray())
            {
                var e = _slots[id].Entity;
                if (e.Source == source && (keep == null || !keep.Contains(id))) Remove(id);
            }
        }

        /// <summary>時間を進める。薄れる出どころの確かさを下げ、低すぎるものを消す。</summary>
        public void Tick(double now)
        {
            List<string> drop = null;
            foreach (var id in _order)
            {
                var slot = _slots[id];
                if (!Fades(slot.Entity.Source)) continue;
                double age = Math.Max(0, now - slot.BaseTime);
                double c = slot.BaseConfidence * Math.Exp(-age / TauOf(slot.Entity.Source));
                slot.Entity.Confidence = c;
                if (c < ForgetBelow) (drop ??= new List<string>()).Add(id);
            }
            if (drop != null) foreach (var id in drop) Remove(id);
        }

        /// <summary>置き方の計算に渡す形 (同じ entity の参照を共有する)。</summary>
        public SolveWorld ToSolveWorld(SolveUser user, Vec3? left, Vec3? right)
        {
            return new SolveWorld { Entities = Entities(), User = user, LeftHand = left, RightHand = right };
        }

        public static Dictionary<string, object> ToPlain(Entity e, Vocabulary vocab, bool round = true)
        {
            var d = new Dictionary<string, object>
            {
                ["id"] = e.Id,
                ["is"] = new List<object>(e.Is),
                ["at"] = round ? e.At.ToPlainRounded() : e.At.ToPlain(),
                ["yaw"] = round ? SpatialMath.Round3(e.Yaw) : e.Yaw,
                ["size"] = round ? e.Size.ToPlainRounded() : e.Size.ToPlain(),
                ["has"] = new List<object>(vocab != null ? vocab.AffordancesOf(e) : (e.Has ?? new List<string>())),
                ["confidence"] = round ? SpatialMath.Round3(e.Confidence) : e.Confidence,
                ["source"] = e.Source,
            };
            if (e.SeenAt.HasValue) d["seenAt"] = round ? SpatialMath.Round3(e.SeenAt.Value) : e.SeenAt.Value;
            if (e.Data != null) d["data"] = e.Data;
            return d;
        }
    }
}
