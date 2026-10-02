// ==============================================
// Arsist Extension: quest-input — script API (Jint)
// Extensions/quest-input/Runtime/InputScriptApis.cs
//
// スクリプトに出す名前: controller / hands / mic / keyboard / headset。
// どれも on(name, fn) / off(name) を持ち、出来事の表は共通 (README の一覧)。
// 値は素の値 (JSON) で返す。座標は実行時の Unity ワールド (viewer.* / scene.* と同じ)。
// 手の名前は 'left' / 'right'。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Extensions;
using Arsist.Runtime.Inference;
using Jint.Native;
using UnityEngine;

namespace Arsist.Extensions.QuestInput
{
    [UnityEngine.Scripting.Preserve]
    public abstract class InputApiBase
    {
        protected readonly ArsistScriptBridge Js;
        private readonly Func<QuestInputService> _service;

        protected InputApiBase(ArsistScriptBridge js, Func<QuestInputService> service)
        {
            Js = js;
            _service = service;
        }

        /// <summary>まだ始まっていなければ null (スクリプトが Start より先に走ったとき)。</summary>
        protected QuestInputService Service => _service();

        /// <summary>出来事を受け取る。名前は README の一覧 (例: 'right.a.down', 'left.pinch.start', 'speechEnd')。</summary>
        [UnityEngine.Scripting.Preserve]
        public void on(string name, JsValue callback)
        {
            if (!Js.IsFunction(callback))
            {
                Debug.LogWarning($"[ArsistJS] {GetType().Name}.on('{name}'): the second argument must be a function");
                return;
            }
            InputEvents.On(name, args => Js.Call(callback, args));
        }

        /// <summary>その名前で受け取るのをやめる (登録した関数をすべて外す)。</summary>
        [UnityEngine.Scripting.Preserve]
        public void off(string name) => InputEvents.Off(name);

        protected static Dictionary<string, object> PoseToJs(Pose pose)
        {
            var e = pose.rotation.eulerAngles;
            var f = pose.rotation * Vector3.forward;
            return new Dictionary<string, object>
            {
                ["x"] = R(pose.position.x), ["y"] = R(pose.position.y), ["z"] = R(pose.position.z),
                ["rx"] = R(e.x), ["ry"] = R(e.y), ["rz"] = R(e.z),
                ["forward"] = new Dictionary<string, object> { ["x"] = R(f.x), ["y"] = R(f.y), ["z"] = R(f.z) },
            };
        }

        protected static double R(float v) => Math.Round(v, 3);
    }

    // ---- controller ----

    [UnityEngine.Scripting.Preserve]
    public sealed class ControllerApi : InputApiBase
    {
        internal ControllerApi(ArsistScriptBridge js, Func<QuestInputService> service) : base(js, service) { }

        private ControllerState Get(string hand) => Service?.Controllers.Get(hand);

        [UnityEngine.Scripting.Preserve]
        public string mode() => Service != null ? Service.Mode : "none";

        [UnityEngine.Scripting.Preserve]
        public bool connected(string hand) => Get(hand)?.Connected == true;

        /// <summary>button: trigger / grip / a / b / x / y / primary / secondary / stick / menu</summary>
        [UnityEngine.Scripting.Preserve]
        public bool isDown(string hand, string button)
        {
            var c = Get(hand);
            return c != null && c.Pressed.TryGetValue(ControllerState.Canonical(hand, button), out var v) && v;
        }

        /// <summary>part: trigger / a / b / x / y / stick / thumbrest</summary>
        [UnityEngine.Scripting.Preserve]
        public bool isTouched(string hand, string part)
        {
            var c = Get(hand);
            return c != null && c.Touched.TryGetValue(ControllerState.Canonical(hand, part), out var v) && v;
        }

        /// <summary>axis: trigger / grip (0..1)</summary>
        [UnityEngine.Scripting.Preserve]
        public double value(string hand, string axis)
        {
            var c = Get(hand);
            if (c == null) return 0;
            var a = ControllerState.Canonical(hand, axis);
            return a == "grip" ? R(c.Grip) : a == "trigger" ? R(c.Trigger) : 0;
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue stick(string hand)
        {
            var c = Get(hand);
            var s = c != null ? c.Stick : Vector2.zero;
            return Js.ToJs(new Dictionary<string, object> { ["x"] = R(s.x), ["y"] = R(s.y) });
        }

        /// <summary>握り (グリップ) の位置と向き。</summary>
        [UnityEngine.Scripting.Preserve]
        public JsValue pose(string hand)
        {
            var c = Get(hand);
            if (c == null || !c.Connected) return JsValue.Null;
            var d = PoseToJs(c.GripPose);
            d["tracked"] = c.Tracked;
            return Js.ToJs(d);
        }

        /// <summary>指す向き (レイの起点と向き)。</summary>
        [UnityEngine.Scripting.Preserve]
        public JsValue aim(string hand)
        {
            var c = Get(hand);
            if (c == null || !c.Connected) return JsValue.Null;
            var d = PoseToJs(c.AimPose);
            d["tracked"] = c.Tracked;
            return Js.ToJs(d);
        }

        [UnityEngine.Scripting.Preserve]
        public bool vibrate(string hand) => vibrate(hand, 0.5, 0.1);

        /// <summary>振動。amplitude 0..1、seconds 秒。</summary>
        [UnityEngine.Scripting.Preserve]
        public bool vibrate(string hand, double amplitude, double seconds)
        {
            var c = Get(hand);
            return c != null && c.Vibrate((float)amplitude, (float)seconds);
        }

        /// <summary>電池 0..1。端末が教えてくれなければ null。</summary>
        [UnityEngine.Scripting.Preserve]
        public JsValue battery(string hand)
        {
            var c = Get(hand);
            return c != null && c.Battery >= 0 ? Js.ToJs((double)R(c.Battery)) : JsValue.Null;
        }

        /// <summary>その手でつかんでいる物の ID ("" なら無し)。</summary>
        [UnityEngine.Scripting.Preserve]
        public string holding(string hand) => Service?.Grab.HeldBy(hand) ?? "";
    }

    // ---- hands ----

    [UnityEngine.Scripting.Preserve]
    public sealed class HandsApi : InputApiBase
    {
        internal HandsApi(ArsistScriptBridge js, Func<QuestInputService> service) : base(js, service) { }

        private HandState Get(string hand) => Service?.Hands.Get(hand);

        [UnityEngine.Scripting.Preserve]
        public bool available() => Service != null && Service.Hands.Available;

        [UnityEngine.Scripting.Preserve]
        public bool tracked(string hand) => Get(hand)?.Tracked == true;

        [UnityEngine.Scripting.Preserve]
        public bool isPinching(string hand) => Get(hand)?.Pinching == true;

        /// <summary>つまむ強さ 0..1。</summary>
        [UnityEngine.Scripting.Preserve]
        public double pinch(string hand)
        {
            var h = Get(hand);
            return h != null && h.Tracked ? R(h.PinchStrength) : 0;
        }

        /// <summary>fist / thumbsUp / pinch / point / peace / open / none</summary>
        [UnityEngine.Scripting.Preserve]
        public string gesture(string hand)
        {
            var h = Get(hand);
            return h != null && h.Tracked ? h.Gesture : "none";
        }

        /// <summary>関節 1 つ。name は XR Hands の名前 (wrist, palm, thumbTip, indexTip, middleProximal …)。</summary>
        [UnityEngine.Scripting.Preserve]
        public JsValue joint(string hand, string name)
        {
            var h = Get(hand);
            var i = HandReader.JointIndex(name);
            if (h == null || !h.Tracked || i < 0) return JsValue.Null;
            return Js.ToJs(PoseToJs(h.Poses[i]));
        }

        /// <summary>全関節 ({ wrist: {...}, palm: {...}, thumbTip: {...}, … })。</summary>
        [UnityEngine.Scripting.Preserve]
        public JsValue joints(string hand)
        {
            var h = Get(hand);
            if (h == null || !h.Tracked) return JsValue.Null;
            var all = new Dictionary<string, object>();
            for (int i = 1; i < Joint.Count; i++)
            {
                var n = i == Joint.Wrist ? "wrist" : ((UnityEngine.XR.Hands.XRHandJointID)i).ToString();
                all[char.ToLowerInvariant(n[0]) + n.Substring(1)] = PoseToJs(h.Poses[i]);
            }
            return Js.ToJs(all);
        }

        /// <summary>人差し指で指している向き (付け根 → 指先)。</summary>
        [UnityEngine.Scripting.Preserve]
        public JsValue pointing(string hand)
        {
            var h = Get(hand);
            if (h == null || !h.Tracked) return JsValue.Null;
            var from = h.Poses[Joint.IndexProximal].position;
            var tip = h.Poses[Joint.IndexTip].position;
            var dir = (tip - from).normalized;
            return Js.ToJs(new Dictionary<string, object>
            {
                ["x"] = R(tip.x), ["y"] = R(tip.y), ["z"] = R(tip.z),
                ["direction"] = new Dictionary<string, object> { ["x"] = R(dir.x), ["y"] = R(dir.y), ["z"] = R(dir.z) },
            });
        }

        [UnityEngine.Scripting.Preserve]
        public string holding(string hand) => Service?.Grab.HeldBy(hand) ?? "";
    }

    // ---- mic ----

    [UnityEngine.Scripting.Preserve]
    public sealed class MicApi : InputApiBase
    {
        internal MicApi(ArsistScriptBridge js, Func<QuestInputService> service) : base(js, service) { }

        /// <summary>マイクを開く (初回は許可を求める)。</summary>
        [UnityEngine.Scripting.Preserve]
        public void start() => Service?.Mic.Start();

        [UnityEngine.Scripting.Preserve]
        public void stop() => Service?.Mic.Stop();

        [UnityEngine.Scripting.Preserve]
        public bool active() => Service != null && Service.Mic.Active;

        /// <summary>off / permission / denied / noDevice / failed / on</summary>
        [UnityEngine.Scripting.Preserve]
        public string status() => Service != null ? Service.Mic.Status : "off";

        /// <summary>音量 0..1 (-60 dBFS = 0, 0 dBFS = 1)。</summary>
        [UnityEngine.Scripting.Preserve]
        public double level() => Service != null ? R(Service.Mic.Level) : 0;

        [UnityEngine.Scripting.Preserve]
        public bool speaking() => Service != null && Service.Mic.Voice.Speaking;

        /// <summary>話し始めとみなす音量 (0..1)。</summary>
        [UnityEngine.Scripting.Preserve]
        public void threshold(double value)
        {
            if (Service != null) Service.Mic.Voice.Threshold = Mathf.Clamp01((float)value);
        }

        /// <summary>これから seconds 秒を録って fn({ ok, wav (base64), sampleRate, seconds, level }) に渡す。</summary>
        [UnityEngine.Scripting.Preserve]
        public void record(double seconds, JsValue callback)
        {
            if (Service == null)
            {
                Js.Call(callback, new Dictionary<string, object> { ["ok"] = false, ["error"] = "not started yet" });
                return;
            }
            Service.Mic.Record((float)seconds, result => Js.Call(callback, result));
        }
    }

    // ---- keyboard ----

    [UnityEngine.Scripting.Preserve]
    public sealed class KeyboardApi : InputApiBase
    {
        internal KeyboardApi(ArsistScriptBridge js, Func<QuestInputService> service) : base(js, service) { }

        [UnityEngine.Scripting.Preserve]
        public bool open(JsValue callback) => open(JsValue.Undefined, callback);

        /// <summary>
        /// システムキーボードを開く。options は文字列 (最初の文字) か
        /// { text, placeholder, multiline, secure }。閉じたら fn(text, submitted)。
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public bool open(JsValue options, JsValue callback)
        {
            var service = Service;
            if (service == null)
            {
                Debug.LogWarning("[ArsistJS] keyboard.open: the input service has not started yet");
                return false;
            }
            string text = "", placeholder = "";
            bool multiline = false, secure = false;
            var plain = Js.FromJs(options);
            if (plain is string s) text = s;
            else if (plain is Dictionary<string, object> d)
            {
                text = MiniJson.Text(d, "text", "");
                placeholder = MiniJson.Text(d, "placeholder", "");
                multiline = MiniJson.Bool(d, "multiline", false);
                secure = MiniJson.Bool(d, "secure", false);
            }
            var ok = service.Keyboard.Open(text, multiline, secure, placeholder, (result, submitted) =>
            {
                service.Publish("keyboard.text", result);
                InputEvents.Emit(submitted ? "submit" : "cancel", result);
                Js.Call(callback, result, submitted);
            });
            if (!ok) Debug.LogWarning("[ArsistJS] keyboard.open: this device has no system keyboard");
            return ok;
        }

        [UnityEngine.Scripting.Preserve]
        public void close() => Service?.Keyboard.Close(false);

        [UnityEngine.Scripting.Preserve]
        public bool isOpen() => Service != null && Service.Keyboard.IsOpen;

        /// <summary>開いているキーボードに今入っている文字 (閉じていれば最後の文字)。</summary>
        [UnityEngine.Scripting.Preserve]
        public string text() => Service != null ? Service.Keyboard.Text : "";

        /// <summary>物理キーボードのキーが押されているか ('a', 'space', 'enter', 'leftshift', 'f1' …)。</summary>
        [UnityEngine.Scripting.Preserve]
        public bool isDown(string key) => KeyboardInput.IsDown(key);
    }

    // ---- headset ----

    [UnityEngine.Scripting.Preserve]
    public sealed class HeadsetApi : InputApiBase
    {
        internal HeadsetApi(ArsistScriptBridge js, Func<QuestInputService> service) : base(js, service) { }

        [UnityEngine.Scripting.Preserve]
        public JsValue pose()
        {
            var cam = Camera.main;
            return cam != null ? Js.ToJs(PoseToJs(new Pose(cam.transform.position, cam.transform.rotation))) : JsValue.Null;
        }

        /// <summary>かぶっているか (近接センサー)。</summary>
        [UnityEngine.Scripting.Preserve]
        public bool mounted() => OVRPlugin.userPresent;

        /// <summary>本体の電池 0..1。</summary>
        [UnityEngine.Scripting.Preserve]
        public double battery() => Math.Round(SystemInfo.batteryLevel, 2);

        [UnityEngine.Scripting.Preserve]
        public double refreshRate() => OVRManager.display != null ? Math.Round(OVRManager.display.displayFrequency, 1) : 0;

        [UnityEngine.Scripting.Preserve]
        public JsValue refreshRates()
        {
            var list = new List<object>();
            if (OVRManager.display != null)
            {
                foreach (var f in OVRManager.display.displayFrequenciesAvailable) list.Add(Math.Round(f, 1));
            }
            return Js.ToJs(list);
        }

        /// <summary>リフレッシュレートを変える (72 / 90 / 120 など、refreshRates() にあるもの)。</summary>
        [UnityEngine.Scripting.Preserve]
        public bool setRefreshRate(double hz)
        {
            if (OVRManager.display == null) return false;
            foreach (var f in OVRManager.display.displayFrequenciesAvailable)
            {
                if (Mathf.Abs(f - (float)hz) < 0.5f)
                {
                    OVRManager.display.displayFrequency = f;
                    return true;
                }
            }
            Debug.LogWarning($"[ArsistJS] headset.setRefreshRate({hz}): not one of {string.Join(", ", OVRManager.display.displayFrequenciesAvailable)}");
            return false;
        }
    }
}
