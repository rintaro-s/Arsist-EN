// ==============================================
// Arsist Extension: quest-room — the room, on the device
// samples/extensions/quest-room/Runtime/QuestRoomService.cs
//
// 流れ:
//   1. 「空間データ」の許可 (com.oculus.permission.USE_SCENE) を確かめ、無ければ求める
//   2. MRUK.LoadSceneFromDevice で、ヘッドセットが保存している部屋を読む
//      (未スキャンなら、設定に応じてヘッドセットの部屋のスキャン画面を開く)
//   3. 当たり判定・輪郭を付け、部屋の情報を store (room.*) に入れる
//   4. IR で ext.quest-room.snapTo を指定した物を、本物の面に置く
//   5. スクリプトのイベント "quest-room:ready" を鳴らす
//
// どの段で止まっても、理由を room.status とログ ([Arsist:quest-room]) に残す。
// 実機でしか確かめられない機能なので、「何も起きない」を作らないことを優先している。
// ==============================================

using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Arsist.Runtime.Extensions;
using Arsist.Runtime.Inference;
using Meta.XR.MRUtilityKit;
using UnityEngine;
using UnityEngine.Android;

namespace Arsist.Extensions.QuestRoom
{
    [UnityEngine.Scripting.Preserve]
    public sealed class QuestRoomService : MonoBehaviour
    {
        /// <summary>Physics.Raycast の既定のマスクに入らないレイヤー。UI を指す邪魔をしない。</summary>
        private const int IgnoreRaycastLayer = 2;
        private const float PermissionTimeoutSeconds = 120f;

        private ArsistExtensionContext _ctx;
        private QuestRoomPins _pins;
        private bool _loading;
        private readonly List<GameObject> _decorations = new List<GameObject>();
        /// <summary>初めて置く前の姿勢。何度置き直しても、作者が置いた向きを基準にする。</summary>
        private readonly Dictionary<int, Pose> _authored = new Dictionary<int, Pose>();
        private Material _lineMaterial;

        /// <summary>idle / permission / loading / ready / denied / noRoom / failed / noMruk</summary>
        public string Status { get; private set; } = "idle";
        public string Detail { get; private set; } = "";
        public MRUKRoom Room { get; private set; }
        public bool Ready => Status == "ready" && Room != null;

        /// <summary>部屋が使えるようになるたびに鳴る (読み直したときも)。</summary>
        public event Action BecameReady;

        internal QuestRoomPins Pins => _pins;
        internal ArsistExtensionContext Context => _ctx;

        internal void Init(ArsistExtensionContext context)
        {
            _ctx = context;
            _pins = new QuestRoomPins(context, this);
            Publish();

            if (MRUK.Instance == null)
            {
                SetStatus("noMruk", "MRUK is not in the scene (the quest-room build hook should have added it)");
                return;
            }
            MRUK.Instance.RoomUpdatedEvent.AddListener(OnRoomUpdated);

            // 留めた物は部屋の許可とは別 (空間アンカー)。先に戻しておく。
            _pins.RestoreAll();

            if (_ctx.GetBool("loadRoom", true)) Reload();
            else _ctx.Log("loadRoom is off; the room is read when a script calls room.reload()");
        }

        private void OnDestroy()
        {
            if (MRUK.Instance != null) MRUK.Instance.RoomUpdatedEvent.RemoveListener(OnRoomUpdated);
        }

        public void Reload()
        {
            if (_loading)
            {
                _ctx.Log("reload ignored: already loading");
                return;
            }
            if (MRUK.Instance == null)
            {
                SetStatus("noMruk", "MRUK is not in the scene");
                return;
            }
            StartCoroutine(LoadRoutine());
        }

        private IEnumerator LoadRoutine()
        {
            _loading = true;
            try
            {
                // OVRPlugin が立ち上がる前に問い合わせると NotInitialized で返ってくる
                float waited = 0f;
                while (!OVRPlugin.initialized && waited < 10f)
                {
                    waited += Time.unscaledDeltaTime;
                    yield return null;
                }
                LogAlignment();

                // ---- 1. 許可 ----
                var permission = OVRPermissionsRequester.ScenePermission;
                if (!Permission.HasUserAuthorizedPermission(permission))
                {
                    SetStatus("permission", "asking for " + permission);
                    bool? granted = null;
                    var callbacks = new PermissionCallbacks();
                    callbacks.PermissionGranted += _ => granted = true;
                    callbacks.PermissionDenied += _ => granted = false;
                    Permission.RequestUserPermission(permission, callbacks);

                    // ダイアログが既に出ていると callback が来ないことがある (MRUK.Update のコメント)。
                    // 許可されたかどうかは直接も見る。
                    float asked = 0f;
                    while (granted == null && asked < PermissionTimeoutSeconds)
                    {
                        if (Permission.HasUserAuthorizedPermission(permission)) granted = true;
                        asked += Time.unscaledDeltaTime;
                        yield return null;
                    }
                    if (granted != true)
                    {
                        SetStatus("denied", granted == false
                            ? "the user did not allow spatial data; the room cannot be read (Settings > Privacy > Spatial data)"
                            : $"no answer to the spatial data permission within {PermissionTimeoutSeconds:F0} s");
                        yield break;
                    }
                    _ctx.Log("spatial data permission granted");
                }

                // ---- 2. 読み込み ----
                SetStatus("loading", "");
                var model = _ctx.GetBool("highFidelity", false) ? MRUK.SceneModel.V2FallbackV1 : MRUK.SceneModel.V1;
                var requestCapture = _ctx.GetBool("requestSpaceSetup", true);
                var started = Time.realtimeSinceStartup;
                var task = MRUK.Instance.LoadSceneFromDevice(requestCapture, true, model);
                while (!task.IsCompleted) yield return null;

                if (task.IsFaulted || task.IsCanceled)
                {
                    var reason = task.Exception != null ? task.Exception.GetBaseException().Message : "cancelled";
                    SetStatus("failed", "LoadSceneFromDevice threw: " + reason);
                    yield break;
                }

                var result = task.Result;
                _ctx.Log($"LoadSceneFromDevice({model}, spaceSetup={requestCapture}) -> {result} in {(Time.realtimeSinceStartup - started) * 1000f:F0} ms");
                if (result != MRUK.LoadDeviceResult.Success)
                {
                    switch (result)
                    {
                        case MRUK.LoadDeviceResult.NoScenePermission:
                            SetStatus("denied", "the system says spatial data is not allowed");
                            break;
                        case MRUK.LoadDeviceResult.NoRoomsFound:
                            SetStatus("noRoom", requestCapture
                                ? "no room is stored and Space Setup was not completed"
                                : "no room is stored (run Space Setup in the headset settings, or turn on requestSpaceSetup)");
                            break;
                        default:
                            SetStatus("failed", "LoadSceneFromDevice: " + result);
                            break;
                    }
                    yield break;
                }

                // ---- 3. 部屋 ----
                Room = MRUK.Instance.GetCurrentRoom();
                if (Room == null && MRUK.Instance.Rooms.Count > 0) Room = MRUK.Instance.Rooms[0];
                if (Room == null)
                {
                    SetStatus("noRoom", "the scene loaded but contains no room");
                    yield break;
                }

                DescribeRoom(Room);
                RebuildDecorations();
                SetStatus("ready", "");

                // ---- 4. 物を置く ----
                PlaceTaggedObjects();

                // ---- 5. 知らせる ----
                _ctx.FireEvent("quest-room:ready");
                BecameReady?.Invoke();
            }
            finally
            {
                _loading = false;
            }
        }

        private void OnRoomUpdated(MRUKRoom room)
        {
            if (room == null || room != Room) return;
            _ctx.Log("room updated by the system; refreshing colliders, outlines and store values");
            RebuildDecorations();
            Publish();
        }

        // ---- 状態とストア ----

        private void SetStatus(string status, string detail)
        {
            Status = status;
            Detail = detail ?? "";
            if (status == "ready" || status == "loading" || status == "permission") _ctx.Log($"status: {status}{(string.IsNullOrEmpty(Detail) ? "" : " — " + Detail)}");
            else if (status != "idle") _ctx.Warn($"status: {status} — {Detail}");
            Publish();
        }

        private void Publish()
        {
            if (_ctx == null || !_ctx.GetBool("publishToStore", true)) return;
            _ctx.SetStore("room.status", Status);
            _ctx.SetStore("room.ready", Ready);
            _ctx.SetStore("room.detail", Detail);
            if (Room == null) return;

            int Count(string surface)
            {
                var labels = RoomGeometry.LabelsFor(surface);
                return labels.HasValue ? Room.Anchors.Count(a => a != null && (a.Label & labels.Value) != 0) : 0;
            }
            _ctx.SetStore("room.walls", Count("wall"));
            _ctx.SetStore("room.tables", Count("table"));
            _ctx.SetStore("room.couches", Count("couch"));
            _ctx.SetStore("room.anchors", Room.Anchors.Count);

            var floor = Room.FloorAnchor;
            if (floor != null && floor.PlaneRect.HasValue)
            {
                var r = floor.PlaneRect.Value;
                _ctx.SetStore("room.width", RoomGeometry.Round(r.width));
                _ctx.SetStore("room.depth", RoomGeometry.Round(r.height));
                _ctx.SetStore("room.floorArea", Math.Round(r.width * r.height, 1));
            }
            var ceiling = Room.CeilingAnchor;
            if (floor != null && ceiling != null)
            {
                _ctx.SetStore("room.ceilingHeight", RoomGeometry.Round(ceiling.transform.position.y - floor.transform.position.y));
            }
            _ctx.SetStore("room.labels", string.Join(", ", Room.Anchors.Where(a => a != null).Select(a => RoomGeometry.NameOf(a.Label)).Distinct()));
        }

        // ---- ログ (npm run logs で見える) ----

        private void LogAlignment()
        {
            var cam = Camera.main;
            if (cam == null)
            {
                _ctx.Warn("no main camera yet; cannot check that the room lines up with the view");
                return;
            }
            _ctx.Log($"tracking origin {OVRPlugin.GetTrackingOriginType()}, head at {cam.transform.position:F2}");
            // MRUK は OVRCameraRig が無いとき、部屋をワールド原点基準で置く。Arsist の XR Origin も
            // 原点にあるので一致するはずだが、カメラの親が原点から動いていればその分ずれる。
            var parent = cam.transform.parent;
            if (parent != null)
            {
                var offset = parent.position;
                var angle = Quaternion.Angle(parent.rotation, Quaternion.identity);
                if (offset.magnitude > 0.01f || angle > 0.5f)
                {
                    _ctx.Warn($"the camera's parent '{parent.name}' is at {offset:F2} / {angle:F1}° instead of the origin; " +
                              "the room may look shifted by that much (turn on showSurfaces to see it)");
                }
            }
        }

        private void DescribeRoom(MRUKRoom room)
        {
            var byLabel = room.Anchors.Where(a => a != null).GroupBy(a => RoomGeometry.NameOf(a.Label))
                .Select(g => $"{g.Key}×{g.Count()}");
            _ctx.Log($"room '{room.name}': {room.Anchors.Count} anchors ({string.Join(", ", byLabel)})");
            int shown = 0;
            foreach (var a in room.Anchors)
            {
                if (a == null || shown++ >= 30) continue;
                var c = a.GetAnchorCenter();
                var size = a.VolumeBounds.HasValue ? a.VolumeBounds.Value.size.ToString("F2")
                         : a.PlaneRect.HasValue ? a.PlaneRect.Value.size.ToString("F2") : "-";
                _ctx.Log($"  {RoomGeometry.NameOf(a.Label),-8} at {c:F2} size {size} facing {a.transform.forward:F2}");
            }
        }

        // ---- 当たり判定と輪郭 ----

        private void RebuildDecorations()
        {
            foreach (var go in _decorations) if (go != null) Destroy(go);
            _decorations.Clear();
            if (Room == null) return;

            bool colliders = _ctx.GetBool("roomColliders", true);
            bool outlines = _ctx.GetBool("showSurfaces", false);
            bool occlusion = _ctx.GetBool("occlusion", false);
            int made = 0, occluders = 0;
            var occluderMaterial = occlusion ? OccluderMaterial() : null;
            if (occlusion && occluderMaterial == null) _ctx.Warn("occlusion is on, but the occluder shader is missing from the build; virtual things will not be hidden");

            foreach (var anchor in Room.Anchors)
            {
                if (anchor == null) continue;
                var label = RoomGeometry.NameOf(anchor.Label);
                if (label == "mesh") continue;

                if (colliders && label != "invisibleWall")
                {
                    var holder = new GameObject("[RoomCollider] " + label);
                    holder.layer = IgnoreRaycastLayer;
                    holder.transform.SetParent(anchor.transform, false);
                    var box = holder.AddComponent<BoxCollider>();
                    if (anchor.VolumeBounds.HasValue)
                    {
                        box.center = anchor.VolumeBounds.Value.center;
                        box.size = anchor.VolumeBounds.Value.size;
                    }
                    else if (anchor.PlaneRect.HasValue)
                    {
                        // 面の裏側 (法線の反対) に厚みを持たせる。表は面そのもの。
                        const float thickness = 0.05f;
                        var r = anchor.PlaneRect.Value;
                        box.center = new Vector3(r.center.x, r.center.y, -thickness / 2f);
                        box.size = new Vector3(r.width, r.height, thickness);
                    }
                    else
                    {
                        Destroy(holder);
                        holder = null;
                    }
                    if (holder != null) { _decorations.Add(holder); made++; }
                }

                if (occluderMaterial != null && label != "invisibleWall" && AddOccluder(anchor, label, occluderMaterial)) occluders++;
                if (outlines) AddOutline(anchor, label);
            }

            _ctx.Log($"decorations: {made} colliders, {occluders} occluders{(outlines ? ", outlines on" : "")}");
        }

        // ---- 本物の物が仮想の物を隠す ----
        //
        // 部屋の面・箱と同じ形を「深度だけ書いて色は書かない」材質で先に描く。パススルーの上では何も見えないが、
        // その奥にある仮想の物 (机の向こうのキャラクターの脚など) は深度で負けて描かれず、現実の机が手前に見える。
        // 部屋のスキャンは家具の箱なので、形は大まか (人の手や動く物は隠さない。それには Depth API が要る)。

        private const string OccluderShader = "ArsistQuestRoomOccluder";
        private static Material _occluderMaterial;
        private static Mesh _cube;

        private static Material OccluderMaterial()
        {
            if (_occluderMaterial != null) return _occluderMaterial;
            var shader = Resources.Load<Shader>(OccluderShader);
            if (shader == null) return null;
            _occluderMaterial = new Material(shader) { name = "[RoomOccluder]" };
            return _occluderMaterial;
        }

        private static Mesh Cube()
        {
            if (_cube != null) return _cube;
            var tmp = GameObject.CreatePrimitive(PrimitiveType.Cube);
            tmp.SetActive(false); // Destroy はフレームの終わりなので、それまで原点に箱が映らないように
            _cube = tmp.GetComponent<MeshFilter>().sharedMesh;
            Destroy(tmp);
            return _cube;
        }

        private bool AddOccluder(MRUKAnchor anchor, string label, Material material)
        {
            Vector3 center, size;
            if (anchor.VolumeBounds.HasValue)
            {
                center = anchor.VolumeBounds.Value.center;
                size = anchor.VolumeBounds.Value.size;
            }
            else if (anchor.PlaneRect.HasValue)
            {
                // 当たり判定と同じく、面の裏側に厚みを持たせる (表は面そのもの)
                const float thickness = 0.05f;
                var r = anchor.PlaneRect.Value;
                center = new Vector3(r.center.x, r.center.y, -thickness / 2f);
                size = new Vector3(r.width, r.height, thickness);
            }
            else return false;

            var go = new GameObject("[RoomOccluder] " + label);
            go.layer = IgnoreRaycastLayer;
            go.transform.SetParent(anchor.transform, false);
            go.transform.localPosition = center;
            go.transform.localScale = size;
            go.AddComponent<MeshFilter>().sharedMesh = Cube();
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            _decorations.Add(go);
            return true;
        }

        private void AddOutline(MRUKAnchor anchor, string label)
        {
            if (_lineMaterial == null)
            {
                var shader = Shader.Find("Sprites/Default") ?? Shader.Find("UI/Default");
                if (shader == null)
                {
                    _ctx.Warn("no line shader in the build (Sprites/Default, UI/Default); outlines are skipped");
                    return;
                }
                _lineMaterial = new Material(shader);
            }

            Vector3[] loop;
            if (anchor.VolumeBounds.HasValue)
            {
                // 箱は天板の輪郭だけ (いちばん高い 4 隅)
                var corners = RoomGeometry.VolumeCorners(anchor).OrderByDescending(c => c.y).Take(4).ToArray();
                var center = corners.Aggregate(Vector3.zero, (s, c) => s + c) / 4f;
                loop = corners.OrderBy(c => Mathf.Atan2(c.z - center.z, c.x - center.x)).ToArray();
            }
            else if (anchor.PlaneRect.HasValue)
            {
                loop = RoomGeometry.PlaneCorners(anchor);
            }
            else return;

            var go = new GameObject("[RoomOutline] " + label);
            go.layer = IgnoreRaycastLayer;
            go.transform.SetParent(anchor.transform, false);
            var line = go.AddComponent<LineRenderer>();
            line.sharedMaterial = _lineMaterial;
            line.useWorldSpace = false;
            line.loop = true;
            line.widthMultiplier = 0.008f;
            line.positionCount = loop.Length;
            for (int i = 0; i < loop.Length; i++) line.SetPosition(i, go.transform.InverseTransformPoint(loop[i]));
            var color = ColorFor(label);
            line.startColor = color;
            line.endColor = color;
            line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            line.receiveShadows = false;
            _decorations.Add(go);
        }

        private static Color ColorFor(string label)
        {
            switch (label)
            {
                case "wall": return new Color(0.3f, 0.85f, 1f, 0.9f);
                case "floor": return new Color(0.35f, 1f, 0.5f, 0.9f);
                case "ceiling": return new Color(0.7f, 0.7f, 0.75f, 0.8f);
                case "table": return new Color(1f, 0.65f, 0.2f, 0.95f);
                case "couch":
                case "bed": return new Color(1f, 0.4f, 0.6f, 0.95f);
                case "invisibleWall": return new Color(1f, 1f, 1f, 0.25f);
                default: return new Color(1f, 0.95f, 0.3f, 0.9f);
            }
        }

        // ---- 物を本物の面に置く ----

        private void PlaceTaggedObjects()
        {
            int placed = 0, failed = 0;
            foreach (var obj in _ctx.ObjectsWithData())
            {
                var data = _ctx.ObjectData(obj);
                var surface = MiniJson.Text(data, "snapTo", "none");
                if (string.IsNullOrEmpty(surface) || surface == "none") continue;

                if (_pins.IsPinned(obj.objectId) || _pins.IsPinned(obj.assetId))
                {
                    _ctx.Log($"'{obj.name}' is pinned; keeping the pinned place instead of snapping to {surface}");
                    continue;
                }

                var pick = MiniJson.Text(data, "pick", "ahead");
                var offset = (float)MiniJson.Number(data, "offset", 0.02);
                var flat = MiniJson.Text(data, "lie", "upright") == "flat";
                if (Place(obj.gameObject, surface, pick, offset, out var detail, flat)) placed++;
                else failed++;
                if (failed > 0 && detail != null) _ctx.Warn($"'{obj.name}': {detail}");
            }
            if (placed + failed > 0) _ctx.Log($"placed {placed} object(s) on real surfaces{(failed > 0 ? $", {failed} could not be placed" : "")}");
        }

        /// <summary>
        /// 物を本物の面に置く。
        ///   surface  wall / floor / ceiling / table / couch / bed / storage / screen / door / window / art / any
        ///   pick     ahead   = 開始位置から、作者が置いた方向を見て最初にある面
        ///            nearest = 作者が置いた位置にいちばん近い面
        ///            gaze    = 今ユーザーが見ている先 (スクリプトから使う)
        ///   offset   面から浮かせる距離 (m)
        ///   flat     机・床などの上に「寝かせる」。パネルなら机に置いた紙のように表を上に、文字の上側を
        ///            ユーザーから遠い方へ向ける (座って読む向き)。壁では無視する
        /// 向きは「作者がユーザーに対してどう向けたか」を保つ (正面に置いたパネルは、壁でもこちらを向く)。
        /// </summary>
        public bool Place(GameObject go, string surface, string pick, float offset, out string detail, bool flat = false)
        {
            detail = null;
            if (go == null) { detail = "no object"; return false; }
            if (!Ready) { detail = $"the room is not ready (status {Status})"; return false; }
            var labels = RoomGeometry.LabelsFor(surface);
            if (!labels.HasValue) { detail = $"unknown surface '{surface}' (use {string.Join(" / ", RoomGeometry.SurfaceNames)})"; return false; }
            var filter = LabelFilter.Included(labels.Value);

            var cam = Camera.main;
            var head = cam != null ? cam.transform.position : Vector3.zero;
            var lookDir = cam != null ? cam.transform.forward : Vector3.forward;

            int key = go.GetInstanceID();
            if (!_authored.TryGetValue(key, out var authored))
            {
                authored = new Pose(go.transform.position, go.transform.rotation);
                _authored[key] = authored;
            }
            // 作者の置き方を「ユーザーから見て正面方向」を基準にした相対の向きとして持つ
            var authoredFrame = Quaternion.LookRotation(RoomGeometry.Flat(authored.position, Vector3.forward), Vector3.up);
            var relative = Quaternion.Inverse(authoredFrame) * authored.rotation;

            var toAuthored = authored.position - head;
            var ray = pick == "gaze" || toAuthored.sqrMagnitude < 1e-4f
                ? new Ray(head, lookDir)
                : new Ray(head, toAuthored.normalized);

            Vector3 point;
            Vector3 normal;
            MRUKAnchor hitAnchor = null;

            if (RoomGeometry.IsHorizontal(surface))
            {
                if (!TryHorizontalPoint(surface, pick, ray, filter, authored.position, out point, out hitAnchor, out detail)) return false;
                bool ceiling = surface.Equals("ceiling", StringComparison.OrdinalIgnoreCase);
                normal = ceiling ? Vector3.down : Vector3.up;

                var facing = RoomGeometry.Flat(point - head, lookDir);
                go.transform.SetPositionAndRotation(point, flat && !ceiling
                    ? LyingFlat(facing)
                    : Quaternion.LookRotation(facing, Vector3.up) * relative);
                // 物の底 (天井なら頂) を面に合わせる
                if (RoomGeometry.TryWorldBounds(go, out var b))
                {
                    float shift = ceiling ? (point.y - offset) - b.max.y : (point.y + offset) - b.min.y;
                    go.transform.position += Vector3.up * shift;
                }
                else
                {
                    go.transform.position += normal * offset;
                }
            }
            else
            {
                bool found = false;
                if (pick != "nearest" && Room.Raycast(ray, 20f, filter, out var hit, out hitAnchor))
                {
                    point = hit.point;
                    normal = hit.normal;
                    found = true;
                }
                else
                {
                    var distance = Room.TryGetClosestSurfacePosition(authored.position, out point, out hitAnchor, out normal, filter);
                    found = !float.IsInfinity(distance) && hitAnchor != null;
                }
                if (!found)
                {
                    detail = $"no {surface} found {(pick == "nearest" ? "in the room" : "in that direction")}";
                    return false;
                }
                // 法線はユーザーの側に向ける (箱の裏側に当たった場合など)
                if (Vector3.Dot(normal, head - point) < 0) normal = -normal;
                if (Mathf.Abs(normal.y) > 0.7f)
                {
                    // 'any' で床や机の上に当たった: 上に載せる
                    var facing = RoomGeometry.Flat(point - head, lookDir);
                    go.transform.SetPositionAndRotation(point, flat
                        ? LyingFlat(facing)
                        : Quaternion.LookRotation(facing, Vector3.up) * relative);
                }
                else
                {
                    // 壁に貼る: 物の +Z (パネルが読める向き) を壁の奥へ
                    var into = RoomGeometry.Flat(-normal, -normal);
                    go.transform.SetPositionAndRotation(point, Quaternion.LookRotation(into, Vector3.up) * relative);
                }
                // 厚みのある物は、背面が面に触れるまで手前に出す
                float depth = 0f;
                if (RoomGeometry.TryWorldBounds(go, out var bb))
                {
                    var ext = bb.extents;
                    var c = bb.center - point;
                    depth = Mathf.Max(0f, -(Vector3.Dot(c, normal)) + Mathf.Abs(normal.x) * ext.x + Mathf.Abs(normal.y) * ext.y + Mathf.Abs(normal.z) * ext.z);
                }
                go.transform.position += normal * (offset + depth);
            }

            var anchorName = hitAnchor != null ? RoomGeometry.NameOf(hitAnchor.Label) : surface;
            _ctx.Log($"'{go.name}' -> {anchorName} at {go.transform.position:F2} (pick {pick})");
            return true;
        }

        /// <summary>
        /// 表 (パネルの読める面 = ローカルの -Z) を上に、上側 (ローカルの +Y) をユーザーから遠い方へ向けた寝かせ方。
        /// awayFromUser は水平の向き。
        /// </summary>
        private static Quaternion LyingFlat(Vector3 awayFromUser) => Quaternion.LookRotation(Vector3.down, awayFromUser);

        private bool TryHorizontalPoint(string surface, string pick, Ray ray, LabelFilter filter, Vector3 authored,
            out Vector3 point, out MRUKAnchor anchor, out string detail)
        {
            detail = null;
            point = default;
            anchor = null;
            var s = surface.ToLowerInvariant();

            if (s == "floor" || s == "ceiling")
            {
                var plane = s == "floor" ? Room.FloorAnchor : Room.CeilingAnchor;
                if (plane == null) { detail = $"the room has no {s}"; return false; }
                if (pick != "nearest" && Room.Raycast(ray, 20f, filter, out var hit, out var hitAnchor))
                {
                    point = hit.point;
                    anchor = hitAnchor;
                    return true;
                }
                // 置いた位置の真下 (真上) の床 (天井)
                point = new Vector3(authored.x, plane.transform.position.y, authored.z);
                anchor = plane;
                return true;
            }

            // 机・ソファ…: 天板の上
            if (pick != "nearest" && Room.Raycast(ray, 20f, filter, out var top, out var topAnchor) && topAnchor != null)
            {
                anchor = topAnchor;
                point = top.normal.y > 0.7f ? top.point : RoomGeometry.TopCenter(topAnchor);
                return true;
            }
            var labels = RoomGeometry.LabelsFor(surface).Value;
            var candidates = Room.Anchors.Where(a => a != null && (a.Label & labels) != 0).ToList();
            if (candidates.Count == 0) { detail = $"the room has no {s}"; return false; }
            anchor = candidates.OrderBy(a => (RoomGeometry.TopCenter(a) - authored).sqrMagnitude).First();
            point = RoomGeometry.TopCenter(anchor);
            return true;
        }

        // ---- スクリプトから ----

        /// <summary>任意の向きの光線が最初に当たる本物の面 (手やコントローラーで指した先など)。</summary>
        public bool TryHit(Ray ray, string surface, out RaycastHit hit, out MRUKAnchor anchor)
        {
            hit = default;
            anchor = null;
            if (!Ready || ray.direction.sqrMagnitude < 1e-8f) return false;
            var labels = RoomGeometry.LabelsFor(surface);
            if (!labels.HasValue) return false;
            return Room.Raycast(ray, 20f, LabelFilter.Included(labels.Value), out hit, out anchor);
        }

        /// <summary>今見ている先にある本物の面。</summary>
        public bool TryHitFromView(string surface, out RaycastHit hit, out MRUKAnchor anchor)
        {
            hit = default;
            anchor = null;
            var cam = Camera.main;
            if (!Ready || cam == null) return false;
            var labels = RoomGeometry.LabelsFor(surface);
            if (!labels.HasValue) return false;
            return Room.Raycast(new Ray(cam.transform.position, cam.transform.forward), 20f, LabelFilter.Included(labels.Value), out hit, out anchor);
        }
    }
}
