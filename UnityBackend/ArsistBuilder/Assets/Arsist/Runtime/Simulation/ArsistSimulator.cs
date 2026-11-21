// ==============================================
// Arsist Engine - シミュレーター (doc/22-simulation.md)
// Assets/Arsist/Runtime/Simulation/ArsistSimulator.cs
//
// APK と同じシーンを Linux のプレイヤーで動かし、頭のカメラの画を撮る。scripts/sim/unity.mjs が
//   ArsistSim.x86_64 -arsist-sim <sim.json> -screen-width W -screen-height H -logFile <log>
// で起こす (xvfb の上)。-arsist-sim が無ければ何もしない。
//
// sim.json:
//   { "out": "<dir>", "fov": 縦の画角 (度), "eyeHeight": 1.6, "spatial": true,
//     "shots": [{ "t": 2, "name": "t2.0" }], "quitAfter": 秒,
//     "space": { "id", "knows": [...], "entities": [...] } | null, "drawSpace": true,
//     "background": [r, g, b] | null,
//     "timeline": [ { "t": 1, "head": { "yaw": 20, "pitch": -10, "roll": 0, "at": [x, y, z] }, "over": 0.5 },
//                   { "t": 3, "select": "card.hint" }, { "t": 3, "event": "name" }, { "t": 4, "say": "..." },
//                   { "t": 4, "action": { "do": "highlight", ... } }, { "t": 5, "set": { "key": value } } ] }
// 頭の at は spatial の world (起動したときの足元が原点、y が目の高さ)。Unity では頭の最初の位置が原点 (実機の
// PinSpawnViewpointToOrigin と同じ) なので、unity = at - (0, eyeHeight, 0)。
// 結果は <out>/sim-player.json (撮った画・その時の頭・物の置き場所・store)。
// Linux のプレイヤー (シミュレーター) にだけ入る。APK には入らない。
// ==============================================

#if UNITY_STANDALONE
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Inference;
using Arsist.Runtime.Scripting;
using Arsist.Runtime.Spatial;
using Arsist.Runtime.Spatial.Core;
using UnityEngine;

namespace Arsist.Runtime.Simulation
{
    [DefaultExecutionOrder(-30000)]
    public sealed class ArsistSimulator : MonoBehaviour
    {
        private Dictionary<string, object> _config;
        private string _out;
        private float _fov = 60;
        private float _eyeHeight = 1.6f;
        private float _t0;
        private Camera _camera;
        private Color? _background;
        private readonly List<Dictionary<string, object>> _timeline = new List<Dictionary<string, object>>();
        private readonly List<Dictionary<string, object>> _heads = new List<Dictionary<string, object>>();
        private int _next;
        private readonly List<object> _shotResults = new List<object>();
        private readonly List<object> _applied = new List<object>();
        private readonly List<string> _errors = new List<string>();
        private List<Dictionary<string, object>> _spaceEntities;
        private bool _spaceScan;
        private bool _drawSpace;
        private GameObject _room;
        private bool _passthrough;
        private Camera _roomCamera;
        /// <summary>試す空間を描くレイヤー (頭のカメラからは外す)</summary>
        internal const int RoomLayer = 31;

        private float Elapsed => Time.realtimeSinceStartup - _t0;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Boot()
        {
            var path = Arg("-arsist-sim");
            if (string.IsNullOrEmpty(path)) return;
            Dictionary<string, object> config;
            try
            {
                config = MiniJson.ParseObject(File.ReadAllText(path));
            }
            catch (Exception e)
            {
                Debug.LogError($"[ArsistSim] could not read {path}: {e.Message}");
                Application.Quit(2);
                return;
            }
            Application.logMessageReceived += (msg, stack, type) => { if (Instance != null) Instance.OnLog(msg, type); };
            var go = new GameObject("[ArsistSimulator]");
            DontDestroyOnLoad(go);
            var sim = go.AddComponent<ArsistSimulator>();
            sim._config = config;
            // 試す空間は Spatial のランタイムの Start より前に足しておく (登録簿は static)
            sim.ReadConfig();
        }

        private static ArsistSimulator Instance;

        private void ReadConfig()
        {
            Instance = this;
            _out = MiniJson.Text(_config, "out", Path.Combine(Application.persistentDataPath, "sim"));
            Directory.CreateDirectory(_out);
            _fov = (float)MiniJson.Number(_config, "fov", 60);
            _eyeHeight = (float)MiniJson.Number(_config, "eyeHeight", 1.6);
            var bg = MiniJson.List(_config, "background");
            if (bg != null && bg.Count >= 3) _background = new Color(F(bg[0]), F(bg[1]), F(bg[2]), 1);
            var tl = MiniJson.List(_config, "timeline");
            if (tl != null)
                foreach (var o in tl)
                    if (o is Dictionary<string, object> d)
                    {
                        if (d.ContainsKey("head")) _heads.Add(d);
                        else _timeline.Add(d);
                    }
            _timeline.Sort((a, b) => MiniJson.Number(a, "t", 0).CompareTo(MiniJson.Number(b, "t", 0)));
            _heads.Sort((a, b) => MiniJson.Number(a, "t", 0).CompareTo(MiniJson.Number(b, "t", 0)));

            var space = MiniJson.Obj(_config, "space");
            if (space != null)
            {
                _spaceEntities = new List<Dictionary<string, object>>();
                var list = MiniJson.List(space, "entities");
                if (list != null) foreach (var o in list) if (o is Dictionary<string, object> d) _spaceEntities.Add(d);
                var knows = MiniJson.Strings(space, "knows") ?? new string[0];
                _spaceScan = Array.IndexOf(knows, "scan") >= 0;
                _drawSpace = MiniJson.Bool(_config, "drawSpace", true);
                if (ArsistSpatialHooks.IsSpatial)
                {
                    SpatialProviders.Add(new SimulationSpaceProvider(_spaceEntities, _spaceScan, -_eyeHeight));
                    ArsistSpatialRuntime.Started += OnSpatialStarted;
                }
            }
            Debug.Log($"[ArsistSim] simulator on: fov {_fov:0.#}°, eye {_eyeHeight:0.##} m, space {(space != null ? MiniJson.Text(space, "id", "?") : "none")}, " +
                      $"{_heads.Count} head keys, {_timeline.Count} timeline steps, out {_out}");
        }

        private void Start()
        {
            _t0 = Time.realtimeSinceStartup;
            int w = (int)MiniJson.Number(_config, "width", 1280), h = (int)MiniJson.Number(_config, "height", 720);
            if (Screen.width != w || Screen.height != h) Screen.SetResolution(w, h, FullScreenMode.Windowed);
            // Virtual (または Spatial のランタイムが無い) なら、試す空間はここで描く。頭 = 原点、床 = -目の高さ
            if (_spaceEntities != null && _drawSpace && !ArsistSpatialHooks.IsSpatial)
                _room = SimulationRoom.Build(_spaceEntities, p => new Vector3((float)p.X, (float)p.Y - _eyeHeight, (float)p.Z), y => Quaternion.Euler(0, (float)y, 0));
            StartCoroutine(Shots());
        }

        private void OnSpatialStarted()
        {
            var rt = ArsistSpatialRuntime.Instance;
            if (rt == null || !_drawSpace || _room != null) return;
            // spatial の world → Unity は SpatialFrames だけが知っている。床を伝えた後に置く (Begin が先に走る)
            StartCoroutine(BuildRoomSoon(rt));
        }

        private IEnumerator BuildRoomSoon(ArsistSpatialRuntime rt)
        {
            yield return null;
            _room = SimulationRoom.Build(_spaceEntities, rt.Frames.ToUnity, rt.Frames.RotationToUnity);
            rt.Frames.Changed += () =>
            {
                if (_room != null) Destroy(_room);
                _room = SimulationRoom.Build(_spaceEntities, rt.Frames.ToUnity, rt.Frames.RotationToUnity);
            };
        }

        // ---- 頭 ----

        private Camera ResolveCamera()
        {
            if (_camera != null) return _camera;
            _camera = Camera.main;
            if (_camera == null) _camera = FindFirstObjectByType<Camera>();
            if (_camera == null) return null;
            // XR の頭の追跡を外す (ヘッドセットは無い。動かすのはこちら)
            foreach (var b in _camera.GetComponents<Behaviour>())
            {
                var n = b != null ? b.GetType().Name : "";
                if (n.Contains("TrackedPoseDriver")) { b.enabled = false; Debug.Log($"[ArsistSim] disabled {b.GetType().FullName} on the head camera"); }
            }
            Debug.Log($"[ArsistSim] head camera: {_camera.name} (clear {_camera.clearFlags}, background {_camera.backgroundColor})");
            return _camera;
        }

        private void ApplyHead()
        {
            var cam = ResolveCamera();
            if (cam == null) return;
            HeadAt(Elapsed, out var at, out var yaw, out var pitch, out var roll);
            cam.transform.SetPositionAndRotation(new Vector3(at.x, at.y - _eyeHeight, at.z), Quaternion.Euler(-pitch, yaw, roll));
            cam.fieldOfView = _fov;
            ApplyPassthrough(cam);
        }

        /// <summary>
        /// パススルー (透明な黒で消すカメラ。XREAL は黒が透ける) の代わり。実機の現実の像と同じく、アプリの物の
        /// 「後ろ」にだけ見えるよう、試す空間は別のカメラ (先に描く) で描き、頭のカメラは深度だけ消す。
        /// アプリが自分で背景を塗っている (VR・skybox) なら何もしない (実機でも現実は見えない)。
        /// </summary>
        private void ApplyPassthrough(Camera cam)
        {
            bool solid = cam.clearFlags == CameraClearFlags.SolidColor || cam.clearFlags == CameraClearFlags.Color;
            var c = cam.backgroundColor;
            if (!_passthrough && solid && (c.a < 0.99f || (c.r < 0.01f && c.g < 0.01f && c.b < 0.01f)))
            {
                _passthrough = true;
                Debug.Log("[ArsistSim] the app shows the real world behind it (passthrough / see-through): the test space stands in for it");
            }
            if (!_passthrough) return;
            if (_roomCamera == null)
            {
                var go = new GameObject("[ArsistSim] real-world camera");
                go.transform.SetParent(cam.transform, false);
                _roomCamera = go.AddComponent<Camera>();
                _roomCamera.cullingMask = 1 << RoomLayer;
                _roomCamera.clearFlags = CameraClearFlags.SolidColor;
                _roomCamera.backgroundColor = _background ?? new Color(0.16f, 0.17f, 0.19f, 1);
                _roomCamera.depth = cam.depth - 1;
            }
            _roomCamera.fieldOfView = cam.fieldOfView;
            _roomCamera.nearClipPlane = cam.nearClipPlane;
            _roomCamera.farClipPlane = cam.farClipPlane;
            if (solid) cam.clearFlags = CameraClearFlags.Depth;
            cam.cullingMask &= ~(1 << RoomLayer);
        }

        /// <summary>t 秒の頭。キーの間は over があればその秒数で前の姿勢から移り、無ければその時刻に切り替わる。</summary>
        private void HeadAt(float t, out Vector3 at, out float yaw, out float pitch, out float roll)
        {
            at = new Vector3(0, _eyeHeight, 0);
            yaw = 0; pitch = 0; roll = 0;
            foreach (var key in _heads)
            {
                double kt = MiniJson.Number(key, "t", 0);
                if (kt > t) break;
                var head = MiniJson.Obj(key, "head");
                var at2 = at;
                var a = MiniJson.List(head, "at");
                if (a != null && a.Count >= 3) at2 = new Vector3(F(a[0]), F(a[1]), F(a[2]));
                float yaw2 = (float)MiniJson.Number(head, "yaw", yaw);
                float pitch2 = (float)MiniJson.Number(head, "pitch", pitch);
                float roll2 = (float)MiniJson.Number(head, "roll", roll);
                double over = MiniJson.Number(key, "over", 0);
                float k = over > 0 ? Mathf.Clamp01((float)((t - kt) / over)) : 1;
                k = k * k * (3 - 2 * k);
                at = Vector3.Lerp(at, at2, k);
                yaw = Mathf.LerpAngle(yaw, yaw2, k);
                pitch = Mathf.Lerp(pitch, pitch2, k);
                roll = Mathf.Lerp(roll, roll2, k);
            }
        }

        private void Update()
        {
            ApplyHead();
            while (_next < _timeline.Count && MiniJson.Number(_timeline[_next], "t", 0) <= Elapsed)
                Apply(_timeline[_next++]);
        }

        private void LateUpdate() => ApplyHead();

        // ---- 出来事 ----

        private void Apply(Dictionary<string, object> step)
        {
            var t = MiniJson.Number(step, "t", 0);
            string what = null;
            try
            {
                var rt = ArsistSpatialRuntime.Instance;
                if (step.TryGetValue("select", out var sel) && sel is string binding)
                {
                    what = "select " + binding;
                    // 実機と同じ道: 視線・レイ・手 (XROriginSetup / ArsistHandInteraction) は当たった物に
                    // SendMessage("OnGazeDwellSelect") を送る。受け手 (ArsistGazeTarget) が bindingId の出来事を鳴らす
                    var go = UiBindingLookup.Find(binding);
                    var target = go != null ? go.GetComponentInChildren<Arsist.Runtime.Input.ArsistGazeTarget>(true) : null;
                    if (target != null) target.gameObject.SendMessage("OnGazeDwellSelect", target.transform.position, SendMessageOptions.DontRequireReceiver);
                    else
                    {
                        var button = go != null ? go.GetComponentInChildren<UnityEngine.UI.Button>(true) : null;
                        if (button != null) button.onClick.Invoke();
                        ArsistScriptEvent.Fire(binding, false);
                    }
                }
                else if (step.TryGetValue("event", out var ev) && ev is string name)
                {
                    what = "event " + name;
                    ArsistScriptEvent.Fire(name, false);
                }
                else if (step.TryGetValue("say", out var say) && say is string text)
                {
                    what = "say " + text;
                    if (rt != null) rt.Actions.Execute(new Dictionary<string, object> { ["do"] = "say", ["text"] = text }, "simulation", null);
                    else ArsistDataStore.Instance.SetValue("say.text", text);
                }
                else if (step.TryGetValue("action", out var act) && act is Dictionary<string, object> action)
                {
                    what = "action " + MiniJson.Text(action, "do", "?");
                    if (rt == null) throw new Exception("actions need a Layster.Spatial project");
                    var problem = rt.Actions.Execute(action, "simulation", null);
                    if (!string.IsNullOrEmpty(problem)) throw new Exception(problem);
                }
                else if (step.TryGetValue("set", out var set) && set is Dictionary<string, object> values)
                {
                    what = "set " + string.Join(",", values.Keys);
                    foreach (var pair in values) ArsistDataStore.Instance.SetValue(pair.Key, pair.Value);
                }
                else
                {
                    what = "unknown step";
                    throw new Exception("a step needs one of head / select / event / say / action / set");
                }
                Debug.Log($"[ArsistSim] t={Elapsed:0.00} {what}");
                _applied.Add(new Dictionary<string, object> { ["t"] = t, ["at"] = Math.Round(Elapsed, 2), ["step"] = what, ["ok"] = true });
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[ArsistSim] t={Elapsed:0.00} {what} failed: {e.Message}");
                _applied.Add(new Dictionary<string, object> { ["t"] = t, ["step"] = what, ["ok"] = false, ["error"] = e.Message });
            }
        }

        private void OnLog(string message, LogType type)
        {
            // LogError で経過を書くだけの所もある (CanvasInitializer) ので、例外と「失敗」を言っている行だけを数える
            if (_errors.Count >= 200) return;
            if (type == LogType.Exception || type == LogType.Assert ||
                (type == LogType.Error && System.Text.RegularExpressions.Regex.IsMatch(message ?? "", "fail|error|exception|not found|missing|cannot|could not|❌", System.Text.RegularExpressions.RegexOptions.IgnoreCase)))
                _errors.Add(message.Length > 500 ? message.Substring(0, 500) : message);
        }

        // ---- 撮る ----

        private IEnumerator Shots()
        {
            var shots = new List<Dictionary<string, object>>();
            var list = MiniJson.List(_config, "shots");
            if (list != null) foreach (var o in list) if (o is Dictionary<string, object> d) shots.Add(d);
            shots.Sort((a, b) => MiniJson.Number(a, "t", 0).CompareTo(MiniJson.Number(b, "t", 0)));
            foreach (var shot in shots)
            {
                var t = (float)MiniJson.Number(shot, "t", 0);
                while (Elapsed < t) yield return null;
                yield return new WaitForEndOfFrame();
                Capture(MiniJson.Text(shot, "name", t.ToString("0.0", CultureInfo.InvariantCulture)), t);
            }
            var quitAfter = (float)MiniJson.Number(_config, "quitAfter", 0);
            while (Elapsed < quitAfter) yield return null;
            Finish();
        }

        private void Capture(string name, float t)
        {
            var file = Path.Combine(_out, $"shot-{name}.png");
            var entry = new Dictionary<string, object> { ["name"] = name, ["t"] = t, ["at"] = Math.Round(Elapsed, 3), ["frame"] = Time.frameCount };
            try
            {
                // フレームの終わりの back buffer (HUD のカメラと overlay の Canvas も入った、画面そのもの) を読む
                var tex = new Texture2D(Screen.width, Screen.height, TextureFormat.RGB24, false);
                tex.ReadPixels(new Rect(0, 0, Screen.width, Screen.height), 0, 0, false);
                tex.Apply(false);
                File.WriteAllBytes(file, tex.EncodeToPNG());
                entry["file"] = file;
                entry["width"] = tex.width;
                entry["height"] = tex.height;
                entry["stats"] = Stats(tex);
                Destroy(tex);
            }
            catch (Exception e)
            {
                entry["error"] = e.Message;
                Debug.LogError($"[ArsistSim] capture {name} failed: {e.Message}");
            }
            HeadAt(t, out var at, out var yaw, out var pitch, out _);
            entry["head"] = new Dictionary<string, object> { ["at"] = V(at), ["yaw"] = yaw, ["pitch"] = pitch };
            var rt = ArsistSpatialRuntime.Instance;
            if (rt != null && rt.Placer != null)
            {
                var things = new List<object>();
                foreach (var b in rt.Placer.Bindings)
                {
                    var th = new Dictionary<string, object> { ["id"] = b.Def.Id, ["placed"] = b.Placed, ["visible"] = b.WantVisible };
                    if (b.Placed) { th["at"] = new List<object> { R(b.Pose.At.X), R(b.Pose.At.Y), R(b.Pose.At.Z) }; th["yaw"] = R(b.Pose.Yaw); }
                    if (b.Result != null) { th["rule"] = b.Result.RuleValue; if (b.Result.Host != null) th["on"] = b.Result.Host; }
                    things.Add(th);
                }
                entry["things"] = things;
                entry["entities"] = rt.World.Entities().Count;
            }
            entry["store"] = StoreSnapshot();
            _shotResults.Add(entry);
            Debug.Log($"[ArsistSim] shot {name} at {Elapsed:0.00} s → {file}");
        }

        /// <summary>真っ黒・一色でないかを見るための数字 (平均の明るさと、左上の色と違う画素の割合)。</summary>
        private static Dictionary<string, object> Stats(Texture2D tex)
        {
            var px = tex.GetPixels32();
            if (px.Length == 0) return new Dictionary<string, object>();
            var corner = px[px.Length - 1];
            double sum = 0;
            int differ = 0, step = Math.Max(1, px.Length / 200000), n = 0;
            for (int i = 0; i < px.Length; i += step)
            {
                var c = px[i];
                sum += (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255.0;
                if (Math.Abs(c.r - corner.r) + Math.Abs(c.g - corner.g) + Math.Abs(c.b - corner.b) > 24) differ++;
                n++;
            }
            return new Dictionary<string, object> { ["meanLuma"] = Math.Round(sum / n, 4), ["nonBackground"] = Math.Round((double)differ / n, 4) };
        }

        private static Dictionary<string, object> StoreSnapshot()
        {
            var o = new Dictionary<string, object>();
            try
            {
                foreach (var pair in ArsistDataStore.Instance.GetSnapshot())
                {
                    if (o.Count >= 200) break;
                    var v = pair.Value;
                    if (v == null || v is string || v is bool || v is int || v is long || v is float || v is double) o[pair.Key] = v;
                    else o[pair.Key] = v.ToString();
                }
            }
            catch { }
            return o;
        }

        private void Finish()
        {
            var result = new Dictionary<string, object>
            {
                ["format"] = "arsist.sim.player/1",
                ["spatial"] = ArsistSpatialHooks.IsSpatial,
                ["screen"] = new List<object> { Screen.width, Screen.height },
                ["graphics"] = SystemInfo.graphicsDeviceName + " / " + SystemInfo.graphicsDeviceVersion,
                ["shots"] = _shotResults,
                ["timeline"] = _applied,
                ["errors"] = _errors,
            };
            try
            {
                File.WriteAllText(Path.Combine(_out, "sim-player.json"), MiniJson.Write(result));
            }
            catch (Exception e)
            {
                Debug.LogError($"[ArsistSim] could not write sim-player.json: {e.Message}");
            }
            Debug.Log($"[ArsistSim] done: {_shotResults.Count} shot(s), {_errors.Count} error(s)");
            Application.Quit(0);
        }

        private static float F(object o) => Convert.ToSingle(o, CultureInfo.InvariantCulture);
        private static double R(double v) => Math.Round(v, 3);
        private static List<object> V(Vector3 v) => new List<object> { R(v.x), R(v.y), R(v.z) };

        private static string Arg(string name)
        {
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == name) return args[i + 1];
            return null;
        }
    }
}
#endif
