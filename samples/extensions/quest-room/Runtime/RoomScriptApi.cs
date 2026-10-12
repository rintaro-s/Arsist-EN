// ==============================================
// Arsist Extension: quest-room — `room` in scripts
// samples/extensions/quest-room/Runtime/RoomScriptApi.cs
//
//   room.status()                      'idle' | 'permission' | 'loading' | 'ready' | 'denied' | 'noRoom' | 'failed' | 'noMruk'
//   room.ready()                       部屋が使えるか
//   room.onReady(function () { … })   使えるようになったら (もう使えるなら今すぐ) 呼ぶ
//   room.reload()                      読み直す (許可を求め直す・スペース設定のあとなど)
//   room.count('table')                その種類の面の数
//   room.list('wall')                  [{ label, x, y, z, width, height, depth?, top?, normal:{x,y,z} }, …]
//   room.list()                        全部
//   room.lookAt()                      今見ている先の面 { hit, label, x, y, z, distance, normal } (無ければ { hit:false })
//   room.lookAt('table')               その種類だけを見る
//   room.place(id, 'wall')             物を本物の面に置く (今見ている先)
//   room.place(id, 'table', 'nearest') 置いた場所にいちばん近い机の上に
//   room.place(id, 'wall', 'ahead', 0.05)
//   room.isInside()                    ユーザーが部屋の中にいるか
//   room.pin(id[, function (ok, detail) { … }])    今の場所を覚える (次に起動しても同じ場所)
//   room.unpin(id[, function (ok, detail) { … }])
//   room.pinned(id)
//
// 面の種類: wall floor ceiling table couch bed storage screen door window art lamp plant other any
// 座標は実行時の Unity ワールド (viewer.* / scene.* と同じ)。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Extensions;
using Jint.Native;
using Meta.XR.MRUtilityKit;
using UnityEngine;

namespace Arsist.Extensions.QuestRoom
{
    [UnityEngine.Scripting.Preserve]
    public sealed class RoomScriptApi
    {
        private readonly ArsistScriptBridge _js;
        private readonly Func<QuestRoomService> _service;
        private readonly List<JsValue> _waiting = new List<JsValue>();
        private bool _subscribed;

        internal RoomScriptApi(ArsistScriptBridge js, Func<QuestRoomService> service)
        {
            _js = js;
            _service = service;
            // スクリプトが部屋の係より先に onReady を呼んだ場合に備えて、係ができたらつなぐ
            QuestRoomExtension.ServiceStarted += () => { if (_waiting.Count > 0) Subscribe(); };
        }

        private QuestRoomService Service => _service();

        [UnityEngine.Scripting.Preserve]
        public string status() => Service != null ? Service.Status : "idle";

        [UnityEngine.Scripting.Preserve]
        public bool ready() => Service != null && Service.Ready;

        [UnityEngine.Scripting.Preserve]
        public void reload()
        {
            if (Service == null) { Debug.LogWarning("[ArsistJS] room.reload: the room service has not started yet"); return; }
            Service.Reload();
        }

        [UnityEngine.Scripting.Preserve]
        public void onReady(JsValue callback)
        {
            if (!_js.IsFunction(callback)) return;
            if (ready())
            {
                _js.Call(callback);
                return;
            }
            _waiting.Add(callback);
            Subscribe();
        }

        private void Subscribe()
        {
            if (_subscribed || Service == null) return;
            _subscribed = true;
            Service.BecameReady += () =>
            {
                var pending = _waiting.ToArray();
                _waiting.Clear();
                foreach (var fn in pending) _js.Call(fn);
            };
        }

        [UnityEngine.Scripting.Preserve]
        public int count(string surface)
        {
            if (!ready()) return 0;
            var labels = RoomGeometry.LabelsFor(surface);
            if (!labels.HasValue) { Unknown("count", surface); return 0; }
            int n = 0;
            foreach (var a in Service.Room.Anchors) if (a != null && (a.Label & labels.Value) != 0) n++;
            return n;
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue list() => list("any");

        [UnityEngine.Scripting.Preserve]
        public JsValue list(string surface)
        {
            var items = new List<object>();
            if (ready())
            {
                var labels = RoomGeometry.LabelsFor(surface);
                if (!labels.HasValue) Unknown("list", surface);
                else foreach (var a in Service.Room.Anchors)
                {
                    if (a != null && (a.Label & labels.Value) != 0) items.Add(RoomGeometry.Describe(a));
                }
            }
            return _js.ToJs(items);
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue lookAt() => lookAt("any");

        [UnityEngine.Scripting.Preserve]
        public JsValue lookAt(string surface)
        {
            var result = new Dictionary<string, object> { ["hit"] = false };
            if (Service != null && Service.TryHitFromView(surface, out var hit, out var anchor))
            {
                result["hit"] = true;
                result["label"] = anchor != null ? RoomGeometry.NameOf(anchor.Label) : surface;
                result["x"] = RoomGeometry.Round(hit.point.x);
                result["y"] = RoomGeometry.Round(hit.point.y);
                result["z"] = RoomGeometry.Round(hit.point.z);
                result["distance"] = RoomGeometry.Round(hit.distance);
                result["normal"] = new Dictionary<string, object>
                {
                    ["x"] = RoomGeometry.Round(hit.normal.x), ["y"] = RoomGeometry.Round(hit.normal.y), ["z"] = RoomGeometry.Round(hit.normal.z),
                };
            }
            return _js.ToJs(result);
        }

        [UnityEngine.Scripting.Preserve]
        public bool place(string id, string surface) => place(id, surface, "gaze", 0.02);

        [UnityEngine.Scripting.Preserve]
        public bool place(string id, string surface, string pick) => place(id, surface, pick, 0.02);

        [UnityEngine.Scripting.Preserve]
        public bool place(string id, string surface, string pick, double offset)
        {
            var service = Service;
            if (service == null) { Debug.LogWarning("[ArsistJS] room.place: the room service has not started yet"); return false; }
            var go = service.Context.FindObject(id);
            if (go == null) { Debug.LogWarning($"[ArsistJS] room.place: no object '{id}'"); return false; }

            // 留めていた物を動かすなら、留めた場所は忘れる (次の起動で古い場所に戻らないように)
            if (service.Pins.IsPinned(id)) service.Pins.Forget(id);

            var ok = service.Place(go, surface, string.IsNullOrEmpty(pick) ? "gaze" : pick, (float)offset, out var detail);
            if (!ok) Debug.LogWarning($"[ArsistJS] room.place('{id}', '{surface}'): {detail}");
            return ok;
        }

        [UnityEngine.Scripting.Preserve]
        public bool isInside()
        {
            var cam = Camera.main;
            return ready() && cam != null && Service.Room.IsPositionInRoom(cam.transform.position);
        }

        [UnityEngine.Scripting.Preserve]
        public void pin(string id) => pin(id, JsValue.Undefined);

        [UnityEngine.Scripting.Preserve]
        public void pin(string id, JsValue callback)
        {
            if (Service == null) { Reply(callback, false, "the room service has not started yet"); return; }
            Service.Pins.Pin(id, (ok, detail) => Reply(callback, ok, detail));
        }

        [UnityEngine.Scripting.Preserve]
        public void unpin(string id) => unpin(id, JsValue.Undefined);

        [UnityEngine.Scripting.Preserve]
        public void unpin(string id, JsValue callback)
        {
            if (Service == null) { Reply(callback, false, "the room service has not started yet"); return; }
            Service.Pins.Unpin(id, (ok, detail) => Reply(callback, ok, detail));
        }

        [UnityEngine.Scripting.Preserve]
        public bool pinned(string id) => Service != null && Service.Pins.IsPinned(id);

        private void Reply(JsValue callback, bool ok, string detail)
        {
            if (_js.IsFunction(callback)) _js.Call(callback, ok, detail);
        }

        private static void Unknown(string what, string surface)
        {
            Debug.LogWarning($"[ArsistJS] room.{what}: unknown surface '{surface}' (use {string.Join(" / ", RoomGeometry.SurfaceNames)})");
        }
    }
}
