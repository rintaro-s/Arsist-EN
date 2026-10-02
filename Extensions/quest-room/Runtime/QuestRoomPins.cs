// ==============================================
// Arsist Extension: quest-room — pins (things that stay where the user put them)
// Extensions/quest-room/Runtime/QuestRoomPins.cs
//
// room.pin(id) は、その物の今の位置に Meta の空間アンカー (OVRSpatialAnchor) を作って端末に保存する。
// 次に起動したとき、アンカーを読み戻して物をそこへ戻す。部屋のスキャンとは別の仕組みなので、
// 部屋を読まない設定でも使える。
//
// 物を空間アンカーの子にはしない (シーンの階層を変えると、スクリプトや他の拡張機能の前提が崩れる)。
// 代わりに RoomPinFollower が毎フレーム、アンカーの姿勢を物に写す。
//
// どの物をどのアンカーに留めたかは PlayerPrefs に JSON で持つ ({ "<id>": "<uuid>" })。
// ==============================================

using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Arsist.Runtime.Extensions;
using Arsist.Runtime.Inference;
using UnityEngine;

namespace Arsist.Extensions.QuestRoom
{
    internal sealed class QuestRoomPins
    {
        private const string IndexKey = "arsist.quest-room.pins";

        private readonly ArsistExtensionContext _ctx;
        private readonly MonoBehaviour _host;
        private readonly Dictionary<string, string> _index;
        private readonly Dictionary<string, OVRSpatialAnchor> _live = new Dictionary<string, OVRSpatialAnchor>();

        public QuestRoomPins(ArsistExtensionContext ctx, MonoBehaviour host)
        {
            _ctx = ctx;
            _host = host;
            _index = ReadIndex();
        }

        public bool IsPinned(string id) => !string.IsNullOrEmpty(id) && _index.ContainsKey(id);

        public IReadOnlyCollection<string> PinnedIds => _index.Keys;

        // ---- 留める ----

        public async void Pin(string id, Action<bool, string> done)
        {
            var target = _ctx.FindObject(id);
            if (target == null) { Finish(done, false, $"no object '{id}'"); return; }

            GameObject holder = null;
            try
            {
                holder = new GameObject($"[RoomPin] {id}");
                holder.transform.SetPositionAndRotation(target.transform.position, target.transform.rotation);
                var anchor = holder.AddComponent<OVRSpatialAnchor>();

                if (!await anchor.WhenCreatedAsync())
                {
                    UnityEngine.Object.Destroy(holder);
                    Finish(done, false, "the headset could not create a spatial anchor here (look around a little and try again)");
                    return;
                }

                var saved = await anchor.SaveAnchorAsync();
                if (!saved.Success)
                {
                    UnityEngine.Object.Destroy(holder);
                    Finish(done, false, $"saving the spatial anchor failed: {saved.Status}");
                    return;
                }

                // 前に留めていたアンカーは消す (同じ物に 2 つ残さない)
                if (_index.TryGetValue(id, out var previous)) await EraseLive(id, previous);

                _index[id] = anchor.Uuid.ToString();
                _live[id] = anchor;
                WriteIndex();
                Follow(target, anchor.transform);
                Finish(done, true, anchor.Uuid.ToString());
            }
            catch (Exception e)
            {
                if (holder != null) UnityEngine.Object.Destroy(holder);
                Finish(done, false, $"{e.GetType().Name}: {e.Message}");
            }
        }

        public async void Unpin(string id, Action<bool, string> done)
        {
            if (!_index.TryGetValue(id, out var uuid)) { Finish(done, true, "was not pinned"); return; }

            // 追従は先に (同じフレームで) 外す。消すのを待っている間に、置き直した物が
            // 古いアンカーへ引き戻されないように。
            var target = _ctx.FindObject(id);
            if (target != null)
            {
                var follower = target.GetComponent<RoomPinFollower>();
                if (follower != null)
                {
                    follower.anchor = null;
                    UnityEngine.Object.Destroy(follower);
                }
            }
            _index.Remove(id);
            WriteIndex();

            try
            {
                await EraseLive(id, uuid);
                Finish(done, true, uuid);
            }
            catch (Exception e)
            {
                Finish(done, false, $"{e.GetType().Name}: {e.Message}");
            }
        }

        /// <summary>動かされたので、留めていた場所を忘れる (次の起動で古い場所に戻らないように)。</summary>
        public void Forget(string id)
        {
            if (!IsPinned(id)) return;
            _ctx.Log($"'{id}' was moved; forgetting where it was pinned");
            Unpin(id, null);
        }

        private async System.Threading.Tasks.Task EraseLive(string id, string uuid)
        {
            if (_live.TryGetValue(id, out var anchor) && anchor != null)
            {
                var erased = await anchor.EraseAnchorAsync();
                if (!erased.Success) _ctx.Warn($"erasing the old anchor of '{id}' failed: {erased.Status}");
                UnityEngine.Object.Destroy(anchor.gameObject);
            }
            _live.Remove(id);
        }

        // ---- 起動時に戻す ----

        public async void RestoreAll()
        {
            if (_index.Count == 0) return;
            var uuids = new List<Guid>();
            foreach (var pair in _index)
            {
                if (Guid.TryParse(pair.Value, out var g)) uuids.Add(g);
                else _ctx.Warn($"pin of '{pair.Key}' has a broken id '{pair.Value}'; ignored");
            }
            _ctx.Log($"restoring {uuids.Count} pinned object(s)");

            try
            {
                var unbound = new List<OVRSpatialAnchor.UnboundAnchor>();
                var loaded = await OVRSpatialAnchor.LoadUnboundAnchorsAsync(uuids, unbound);
                if (!loaded.Success)
                {
                    _ctx.Warn($"loading pinned anchors failed: {loaded.Status}");
                    return;
                }

                foreach (var anchor in unbound)
                {
                    var id = _index.FirstOrDefault(p => p.Value == anchor.Uuid.ToString()).Key;
                    if (id == null) continue;

                    if (!anchor.Localized && !await anchor.LocalizeAsync())
                    {
                        _ctx.Warn($"pin of '{id}' could not be found in this space (another room, or the space was reset)");
                        continue;
                    }

                    // BindTo は作ったばかりの OVRSpatialAnchor に、同じフレームで行う
                    var holder = new GameObject($"[RoomPin] {id}");
                    var component = holder.AddComponent<OVRSpatialAnchor>();
                    anchor.BindTo(component);
                    _live[id] = component;
                    _host.StartCoroutine(AttachWhenFound(id, component.transform));
                }

                var missing = uuids.Count - unbound.Count;
                if (missing > 0) _ctx.Warn($"{missing} pinned anchor(s) were not on the device any more");
            }
            catch (Exception e)
            {
                _ctx.Warn($"restoring pins failed: {e.GetType().Name}: {e.Message}");
            }
        }

        /// <summary>スクリプトへの登録 (assetId) は起動直後は済んでいないことがあるので、少し待つ。</summary>
        private IEnumerator AttachWhenFound(string id, Transform anchor)
        {
            float waited = 0f;
            GameObject target = null;
            while (waited < 10f && (target = _ctx.FindObject(id)) == null)
            {
                waited += Time.unscaledDeltaTime;
                yield return null;
            }
            if (target == null)
            {
                _ctx.Warn($"pinned object '{id}' is not in this app any more");
                yield break;
            }
            Follow(target, anchor);
            _ctx.Log($"'{id}' is back where it was pinned");
        }

        private static void Follow(GameObject target, Transform anchor)
        {
            var follower = target.GetComponent<RoomPinFollower>();
            if (follower == null) follower = target.AddComponent<RoomPinFollower>();
            follower.anchor = anchor;
        }

        // ---- 保存 ----

        private Dictionary<string, string> ReadIndex()
        {
            var result = new Dictionary<string, string>();
            try
            {
                var json = PlayerPrefs.GetString(IndexKey, "");
                if (string.IsNullOrEmpty(json)) return result;
                foreach (var pair in MiniJson.ParseObject(json))
                {
                    if (pair.Value is string s) result[pair.Key] = s;
                }
            }
            catch (Exception e)
            {
                _ctx.Warn($"pin list could not be read ({e.Message}); starting empty");
            }
            return result;
        }

        private void WriteIndex()
        {
            var plain = new Dictionary<string, object>();
            foreach (var pair in _index) plain[pair.Key] = pair.Value;
            PlayerPrefs.SetString(IndexKey, MiniJson.Write(plain));
            PlayerPrefs.Save();
        }

        private void Finish(Action<bool, string> done, bool ok, string detail)
        {
            if (ok) _ctx.Log($"pin: {detail}");
            else _ctx.Warn($"pin: {detail}");
            try { done?.Invoke(ok, detail); }
            catch (Exception e) { _ctx.Warn($"pin callback failed: {e.Message}"); }
        }
    }
}
