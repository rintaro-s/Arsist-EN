// ==============================================
// Arsist Extension: quest-input — the input loop
// Extensions/quest-input/Runtime/QuestInputService.cs
//
// 毎フレーム、コントローラー・手・マイク・キーボード・ヘッドセットを読み、
//   - 変化を出来事にする (InputEvents → スクリプトの on() と "quest-input:*" イベント)
//   - 今の値を store に入れる (UI の bind にそのまま使える。変わったときだけ書く)
//   - つかめる物を動かす (GrabSystem)
// どの入力も、使えないとき (コントローラーを置いた・手が見えない・許可が無い) は
// 理由をログに 1 度だけ出し、値は「無い」を返す (落ちない)。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Extensions;
using UnityEngine;

namespace Arsist.Extensions.QuestInput
{
    [UnityEngine.Scripting.Preserve]
    public sealed class QuestInputService : MonoBehaviour
    {
        private ArsistExtensionContext _ctx;
        private bool _publish;
        private bool _physicalKeys;
        private float _gestureHold;
        private readonly Dictionary<string, object> _published = new Dictionary<string, object>();

        internal ControllerReader Controllers { get; } = new ControllerReader();
        internal HandReader Hands { get; } = new HandReader();
        internal MicCapture Mic { get; private set; }
        internal KeyboardInput Keyboard { get; } = new KeyboardInput();
        internal GrabSystem Grab { get; private set; }
        internal ArsistExtensionContext Context => _ctx;

        /// <summary>controllers / hands / none</summary>
        public string Mode { get; private set; } = "none";

        private readonly Dictionary<string, bool> _prevButtons = new Dictionary<string, bool>();
        private readonly Dictionary<string, bool> _prevTouches = new Dictionary<string, bool>();
        private readonly Dictionary<string, bool> _prevConnected = new Dictionary<string, bool>();
        private readonly Dictionary<string, bool> _prevHandTracked = new Dictionary<string, bool>();
        private readonly Dictionary<string, bool> _prevPinch = new Dictionary<string, bool>();
        private readonly Dictionary<string, string> _prevGesture = new Dictionary<string, string>();
        private bool _loggedNoHands;
        private float _handsSince;

        internal void Init(ArsistExtensionContext context)
        {
            _ctx = context;
            _publish = context.GetBool("publishToStore", true);
            _physicalKeys = context.GetBool("physicalKeyboard", true);
            _gestureHold = Mathf.Clamp(context.GetFloat("gestureHoldSeconds", 0.1f), 0f, 1f);
            InputEvents.FireScriptEvents = context.GetBool("scriptEvents", true);

            Mic = new MicCapture(msg => _ctx.Log("mic: " + msg))
            {
                OutputRate = Mathf.Clamp(context.GetInt("micOutputRate", 16000), 8000, 48000),
            };
            Mic.Voice.Threshold = Mathf.Clamp01(context.GetFloat("voiceThreshold", 0.45f));
            Mic.VoiceChanged += (change, result) =>
            {
                if (change > 0) InputEvents.Emit("speechStart");
                else InputEvents.Emit("speechEnd", result);
            };

            Keyboard.Changed += text =>
            {
                Publish("keyboard.text", text);
                InputEvents.Emit("change", text);
            };

            Grab = new GrabSystem(context);
            Grab.Changed += (change, hand, id, by) =>
            {
                var info = new Dictionary<string, object> { ["id"] = id, ["hand"] = hand, ["by"] = by };
                InputEvents.Emit(change > 0 ? "grab" : "release", info);
                Publish($"input.{hand}.holding", change > 0 ? id : "");
            };

            SubscribeHeadset();
            _handsSince = Time.unscaledTime;
            if (context.GetBool("micAutoStart", false)) Mic.Start();

            int grabbable = 0;
            foreach (var obj in context.ObjectsWithData()) grabbable++;
            _ctx.Log($"ready (store: {_publish}, script events: {InputEvents.FireScriptEvents}, objects with options: {grabbable})");
        }

        private void OnDestroy()
        {
            UnsubscribeHeadset();
            Mic?.Stop();
            Keyboard.Close(false);
        }

        private void Update()
        {
            if (_ctx == null) return;
            float dt = Time.unscaledDeltaTime;
            var cam = Camera.main;
            var space = cam != null ? cam.transform.parent : null;

            UpdateControllers(space);
            UpdateHands(space, dt);
            UpdateMode();
            Grab.Update(Controllers, Hands, Time.deltaTime > 0 ? Time.deltaTime : dt);
            Mic.Update(dt);
            UpdateKeyboard();
            UpdateHeadsetValues(cam);
        }

        // ---- コントローラー ----

        private void UpdateControllers(Transform space)
        {
            foreach (var line in Controllers.Scan(force: false)) _ctx.Log("controller " + line);

            foreach (var c in new[] { Controllers.Left, Controllers.Right })
            {
                c.Read(space);
                var h = c.Hand;

                if (Changed(_prevConnected, h, c.Connected))
                {
                    InputEvents.Emit($"{h}.{(c.Connected ? "connected" : "disconnected")}");
                    Publish($"input.{h}.connected", c.Connected);
                }
                if (!c.Connected) continue;

                foreach (var b in ControllerState.Buttons)
                {
                    var down = c.Pressed.TryGetValue(b, out var v) && v;
                    if (Changed(_prevButtons, h + "." + b, down))
                    {
                        var name = c.Friendly(b);
                        InputEvents.Emit($"{h}.{name}.{(down ? "down" : "up")}");
                        Publish($"input.{h}.{name}", down);
                    }
                }
                foreach (var t in ControllerState.Touches)
                {
                    var touched = c.Touched.TryGetValue(t, out var v) && v;
                    if (Changed(_prevTouches, h + "." + t, touched))
                    {
                        InputEvents.Emit($"{h}.{c.Friendly(t)}.{(touched ? "touch" : "untouch")}");
                    }
                }

                // スティックを倒した向き (メニュー送りなどに。戻すまで同じ向きは 1 回)
                var flick = "";
                if (c.Stick.magnitude > 0.7f)
                {
                    flick = Mathf.Abs(c.Stick.x) > Mathf.Abs(c.Stick.y)
                        ? (c.Stick.x > 0 ? "right" : "left")
                        : (c.Stick.y > 0 ? "up" : "down");
                }
                else if (c.Stick.magnitude > 0.3f)
                {
                    flick = c.StickFlick; // 戻りきるまで今の向きを保つ
                }
                if (flick != c.StickFlick)
                {
                    c.StickFlick = flick;
                    if (flick != "") InputEvents.Emit($"{h}.stick.{flick}");
                }

                Publish($"input.{h}.triggerValue", Quantize(c.Trigger));
                Publish($"input.{h}.gripValue", Quantize(c.Grip));
                Publish($"input.{h}.stickX", Quantize(c.Stick.x));
                Publish($"input.{h}.stickY", Quantize(c.Stick.y));
            }
        }

        // ---- 手 ----

        private void UpdateHands(Transform space, float dt)
        {
            if (Hands.Lookup())
            {
                _ctx.Log("hand tracking subsystem is running");
                _loggedNoHands = false;
            }
            else if (!Hands.Available && !_loggedNoHands && Time.unscaledTime - _handsSince > 10f)
            {
                _loggedNoHands = true;
                _ctx.Warn("no running hand tracking subsystem after 10 s; hands.* stays empty " +
                          "(check that the build log says 'OpenXR feature enabled: com.unity.openxr.feature.input.handtrackingsubsystem' " +
                          "and that hand tracking is on in the headset settings)");
            }

            Hands.Read(space, dt, _gestureHold);
            foreach (var hand in new[] { Hands.Left, Hands.Right })
            {
                var h = hand.Hand;
                if (Changed(_prevHandTracked, h, hand.Tracked))
                {
                    InputEvents.Emit($"{h}.hand.{(hand.Tracked ? "tracked" : "lost")}");
                    Publish($"input.{h}.handTracked", hand.Tracked);
                }
                if (Changed(_prevPinch, h, hand.Pinching))
                {
                    InputEvents.Emit($"{h}.pinch.{(hand.Pinching ? "start" : "end")}");
                    Publish($"input.{h}.pinch", hand.Pinching);
                }
                _prevGesture.TryGetValue(h, out var previous);
                previous ??= "none";
                if (hand.Gesture != previous)
                {
                    _prevGesture[h] = hand.Gesture;
                    InputEvents.Emit($"{h}.gesture", hand.Gesture, previous);
                    if (hand.Gesture != "none") InputEvents.Emit($"{h}.gesture.{hand.Gesture}");
                    Publish($"input.{h}.gesture", hand.Gesture);
                }
                Publish($"input.{h}.pinchStrength", Quantize(hand.PinchStrength));
            }
        }

        private void UpdateMode()
        {
            var mode = Controllers.Left.Tracked || Controllers.Right.Tracked ? "controllers"
                : Hands.Left.Tracked || Hands.Right.Tracked ? "hands"
                : "none";
            if (mode == Mode) return;
            var previous = Mode;
            Mode = mode;
            _ctx.Log($"input mode: {previous} → {mode}");
            InputEvents.Emit("mode", mode, previous);
            Publish("input.mode", mode);
        }

        // ---- キーボード ----

        private void UpdateKeyboard()
        {
            var note = Keyboard.Poll();
            if (note != null) _ctx.Log(note);
            Publish("keyboard.open", Keyboard.IsOpen);
            Publish("mic.level", Quantize(Mic.Level));
            Publish("mic.speaking", Mic.Voice.Speaking);
            Publish("mic.active", Mic.Active);

            if (!_physicalKeys) return;
            var keys = Keyboard.KeysDown();
            if (keys != null) foreach (var k in keys) InputEvents.Emit("key", k);
            // システムキーボードが開いている間は、その文字を物理キーボードの文字として二重に流さない
            if (!Keyboard.IsOpen)
            {
                var typed = Keyboard.TypedText();
                if (!string.IsNullOrEmpty(typed)) InputEvents.Emit("text", typed);
            }
        }

        // ---- ヘッドセット ----

        private Action _onMounted, _onUnmounted, _onFocusLost, _onFocusGained, _onTrackingLost, _onTrackingAcquired, _onRecentered;

        private void SubscribeHeadset()
        {
            _onMounted = () => { InputEvents.Emit("mounted"); Publish("headset.mounted", true); };
            _onUnmounted = () => { InputEvents.Emit("unmounted"); Publish("headset.mounted", false); };
            _onFocusLost = () => InputEvents.Emit("focusLost");
            _onFocusGained = () => InputEvents.Emit("focusGained");
            _onTrackingLost = () => InputEvents.Emit("trackingLost");
            _onTrackingAcquired = () => InputEvents.Emit("trackingAcquired");
            _onRecentered = () => InputEvents.Emit("recentered");
            OVRManager.HMDMounted += _onMounted;
            OVRManager.HMDUnmounted += _onUnmounted;
            OVRManager.InputFocusLost += _onFocusLost;
            OVRManager.InputFocusAcquired += _onFocusGained;
            OVRManager.TrackingLost += _onTrackingLost;
            OVRManager.TrackingAcquired += _onTrackingAcquired;
            if (OVRManager.display != null) OVRManager.display.RecenteredPose += _onRecentered;
            else _ctx.Warn("OVRManager.display is not ready; the 'recentered' event will not fire");
        }

        private void UnsubscribeHeadset()
        {
            OVRManager.HMDMounted -= _onMounted;
            OVRManager.HMDUnmounted -= _onUnmounted;
            OVRManager.InputFocusLost -= _onFocusLost;
            OVRManager.InputFocusAcquired -= _onFocusGained;
            OVRManager.TrackingLost -= _onTrackingLost;
            OVRManager.TrackingAcquired -= _onTrackingAcquired;
            if (OVRManager.display != null) OVRManager.display.RecenteredPose -= _onRecentered;
        }

        private float _nextSlowPublish;

        private void UpdateHeadsetValues(Camera cam)
        {
            if (Time.unscaledTime < _nextSlowPublish) return;
            _nextSlowPublish = Time.unscaledTime + 1f;
            Publish("headset.battery", Math.Round(SystemInfo.batteryLevel, 2));
            Publish("headset.mounted", OVRPlugin.userPresent);
        }

        // ---- store ----

        internal void Publish(string key, object value)
        {
            if (!_publish) return;
            if (_published.TryGetValue(key, out var old) && Equals(old, value)) return;
            _published[key] = value;
            _ctx.SetStore(key, value);
        }

        private static double Quantize(float v) => Math.Round(v * 20.0) / 20.0;

        private static bool Changed(Dictionary<string, bool> previous, string key, bool now)
        {
            if (previous.TryGetValue(key, out var was) && was == now) return false;
            var first = !previous.ContainsKey(key);
            previous[key] = now;
            // 最初の 1 回 (false のまま始まった) は出来事にしない
            return !(first && !now);
        }
    }
}
