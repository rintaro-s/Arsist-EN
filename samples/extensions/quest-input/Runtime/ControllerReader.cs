// ==============================================
// Arsist Extension: quest-input — Touch controllers
// samples/extensions/quest-input/Runtime/ControllerReader.cs
//
// Unity の XR 入力 (UnityEngine.XR.InputDevices) から読む。エンジンのレイ (XROriginSetup) と
// 同じ経路なので、OpenXR の Oculus Touch プロファイルが有効なら必ず見える。
//
// 入力の名前 (「TriggerTouch」など) は OpenXR のプロファイルが決めていて、版で揺れることがある。
// そこで決め打ちせず、端末が実際に持っている入力の一覧 (TryGetFeatureUsages) から候補の名前で探す。
// 一覧は最初に繋がったときにログ ([Arsist:quest-input]) に出すので、実機で何が読めるかがすぐ分かる。
// ==============================================

using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.XR;

namespace Arsist.Extensions.QuestInput
{
    internal sealed class ControllerState
    {
        // 押す・離すを見るボタン (スクリプトの名前 → 読む入力の候補)
        public static readonly string[] Buttons = { "trigger", "grip", "primary", "secondary", "stick", "menu" };
        public static readonly string[] Touches = { "trigger", "primary", "secondary", "stick", "thumbrest" };

        private static readonly Dictionary<string, string[]> ButtonNames = new Dictionary<string, string[]>
        {
            ["trigger"] = new[] { "TriggerButton", "triggerPressed", "IndexButton" },
            ["grip"] = new[] { "GripButton", "gripPressed", "squeezeClicked" },
            ["primary"] = new[] { "PrimaryButton", "primaryButton" },
            ["secondary"] = new[] { "SecondaryButton", "secondaryButton" },
            ["stick"] = new[] { "Primary2DAxisClick", "thumbstickClicked", "JoystickOrPadPressed" },
            ["menu"] = new[] { "MenuButton", "menu", "systemButton" },
        };

        private static readonly Dictionary<string, string[]> TouchNames = new Dictionary<string, string[]>
        {
            ["trigger"] = new[] { "TriggerTouch", "triggerTouched", "IndexTouch", "indexTouched" },
            ["primary"] = new[] { "PrimaryTouch", "primaryTouched" },
            ["secondary"] = new[] { "SecondaryTouch", "secondaryTouched" },
            ["stick"] = new[] { "Primary2DAxisTouch", "thumbstickTouched", "JoystickOrPadTouched" },
            ["thumbrest"] = new[] { "ThumbrestTouch", "thumbrestTouched", "Thumbrest" },
        };

        public readonly string Hand;
        public InputDevice Device;
        public bool Connected;
        public bool Tracked;
        public float Trigger;
        public float Grip;
        public Vector2 Stick;
        public Pose GripPose = Pose.identity;
        public Pose AimPose = Pose.identity;
        public bool HasAim;
        public float Battery = -1f;
        public readonly Dictionary<string, bool> Pressed = new Dictionary<string, bool>();
        public readonly Dictionary<string, bool> Touched = new Dictionary<string, bool>();
        /// <summary>スティックを倒した向き (left/right/up/down)。戻すまで同じ向きは鳴らさない。</summary>
        public string StickFlick = "";

        // 端末が持っている入力の名前 → 実際の入力
        private readonly Dictionary<string, InputFeatureUsage<bool>> _buttons = new Dictionary<string, InputFeatureUsage<bool>>();
        private readonly Dictionary<string, InputFeatureUsage<bool>> _touches = new Dictionary<string, InputFeatureUsage<bool>>();
        private InputFeatureUsage<Vector3>? _aimPosition;
        private InputFeatureUsage<Quaternion>? _aimRotation;

        public ControllerState(string hand) { Hand = hand; }

        /// <summary>a / b (右) と x / y (左) は primary / secondary の別名。</summary>
        public static string Canonical(string hand, string name)
        {
            switch ((name ?? "").Trim().ToLowerInvariant())
            {
                case "a":
                case "x":
                    return "primary";
                case "b":
                case "y":
                    return "secondary";
                case "thumbstick":
                case "joystick":
                    return "stick";
                case "index":
                    return "trigger";
                case "squeeze":
                    return "grip";
                default:
                    return (name ?? "").Trim().ToLowerInvariant();
            }
        }

        /// <summary>イベントに使う名前 (右は a/b、左は x/y)。</summary>
        public string Friendly(string canonical)
        {
            if (canonical == "primary") return Hand == "right" ? "a" : "x";
            if (canonical == "secondary") return Hand == "right" ? "b" : "y";
            return canonical;
        }

        /// <summary>新しく繋がった端末の入力名を調べる。戻り値はログ用の一覧。</summary>
        public string Bind(InputDevice device)
        {
            Device = device;
            _buttons.Clear();
            _touches.Clear();
            _aimPosition = null;
            _aimRotation = null;

            var usages = new List<InputFeatureUsage>();
            device.TryGetFeatureUsages(usages);
            InputFeatureUsage? Find(string[] candidates, Type type)
            {
                foreach (var c in candidates)
                {
                    foreach (var u in usages)
                    {
                        if (u.type == type && string.Equals(u.name, c, StringComparison.OrdinalIgnoreCase)) return u;
                    }
                }
                return null;
            }

            foreach (var pair in ButtonNames)
            {
                var u = Find(pair.Value, typeof(bool));
                if (u.HasValue) _buttons[pair.Key] = u.Value.As<bool>();
            }
            foreach (var pair in TouchNames)
            {
                var u = Find(pair.Value, typeof(bool));
                if (u.HasValue) _touches[pair.Key] = u.Value.As<bool>();
            }
            var aimPos = Find(new[] { "PointerPosition", "pointerPosition", "AimPosition" }, typeof(Vector3));
            var aimRot = Find(new[] { "PointerRotation", "pointerRotation", "AimRotation" }, typeof(Quaternion));
            if (aimPos.HasValue && aimRot.HasValue)
            {
                _aimPosition = aimPos.Value.As<Vector3>();
                _aimRotation = aimRot.Value.As<Quaternion>();
            }

            var missing = Buttons.Where(b => !_buttons.ContainsKey(b)).Concat(Touches.Where(t => !_touches.ContainsKey(t)).Select(t => t + "Touch"));
            return $"{device.name} [{string.Join(", ", usages.Select(u => u.name))}]" +
                   (missing.Any() ? $" — not available: {string.Join(", ", missing)}" : "");
        }

        /// <summary>1 フレーム分を読む。トラッキング空間 → ワールドの変換は space で行う。</summary>
        public void Read(Transform space)
        {
            if (!Device.isValid)
            {
                // 切れたら「押していない」に戻す (前の値が残ると isDown が true のままになる)
                Connected = false;
                Tracked = false;
                Trigger = Grip = 0f;
                Stick = Vector2.zero;
                Pressed.Clear();
                Touched.Clear();
                StickFlick = "";
                return;
            }
            Connected = true;
            Tracked = Device.TryGetFeatureValue(CommonUsages.isTracked, out bool tracked) && tracked;

            Trigger = Device.TryGetFeatureValue(CommonUsages.trigger, out float trigger) ? trigger : 0f;
            Grip = Device.TryGetFeatureValue(CommonUsages.grip, out float grip) ? grip : 0f;
            Stick = Device.TryGetFeatureValue(CommonUsages.primary2DAxis, out Vector2 stick) ? stick : Vector2.zero;
            Battery = Device.TryGetFeatureValue(CommonUsages.batteryLevel, out float battery) ? battery : -1f;

            foreach (var b in Buttons)
            {
                bool down = _buttons.TryGetValue(b, out var usage) && Device.TryGetFeatureValue(usage, out bool v) && v;
                // ボタンとしての入力が無くても、アナログ値から決める (トリガー・グリップ)
                if (!_buttons.ContainsKey(b))
                {
                    if (b == "trigger") down = Trigger > 0.55f;
                    else if (b == "grip") down = Grip > 0.55f;
                }
                Pressed[b] = down;
            }
            foreach (var t in Touches)
            {
                Touched[t] = _touches.TryGetValue(t, out var usage) && Device.TryGetFeatureValue(usage, out bool v) && v;
            }

            if (Device.TryGetFeatureValue(CommonUsages.devicePosition, out Vector3 p) &&
                Device.TryGetFeatureValue(CommonUsages.deviceRotation, out Quaternion r))
            {
                GripPose = ToWorld(space, new Pose(p, r));
            }
            HasAim = false;
            if (_aimPosition.HasValue && _aimRotation.HasValue &&
                Device.TryGetFeatureValue(_aimPosition.Value, out Vector3 ap) &&
                Device.TryGetFeatureValue(_aimRotation.Value, out Quaternion ar))
            {
                AimPose = ToWorld(space, new Pose(ap, ar));
                HasAim = true;
            }
            if (!HasAim) AimPose = GripPose;
        }

        public static Pose ToWorld(Transform space, Pose local)
        {
            if (space == null) return local;
            return new Pose(space.TransformPoint(local.position), space.rotation * local.rotation);
        }

        public bool Vibrate(float amplitude, float seconds)
        {
            if (!Device.isValid) return false;
            if (Device.TryGetHapticCapabilities(out var caps) && !caps.supportsImpulse) return false;
            return Device.SendHapticImpulse(0, Mathf.Clamp01(amplitude), Mathf.Clamp(seconds, 0.01f, 5f));
        }
    }

    internal sealed class ControllerReader
    {
        public readonly ControllerState Left = new ControllerState("left");
        public readonly ControllerState Right = new ControllerState("right");
        private readonly List<InputDevice> _buffer = new List<InputDevice>();
        private float _nextScan;

        public ControllerState Get(string hand)
        {
            switch ((hand ?? "").Trim().ToLowerInvariant())
            {
                case "left":
                case "l":
                    return Left;
                case "right":
                case "r":
                    return Right;
                default:
                    return null;
            }
        }

        /// <summary>繋がっている端末を探し直す (つなぎ直し・電池交換に追従するため、時々)。戻り値: 新しく繋がった説明。</summary>
        public List<string> Scan(bool force)
        {
            var bound = new List<string>();
            if (!force && Time.unscaledTime < _nextScan && Left.Device.isValid && Right.Device.isValid) return bound;
            _nextScan = Time.unscaledTime + 1f;

            foreach (var state in new[] { Left, Right })
            {
                if (state.Device.isValid) continue;
                var side = state.Hand == "left" ? InputDeviceCharacteristics.Left : InputDeviceCharacteristics.Right;
                _buffer.Clear();
                InputDevices.GetDevicesWithCharacteristics(InputDeviceCharacteristics.Controller | side, _buffer);
                // 手の追跡 (HandTracking) を名乗るものはコントローラーではない
                var device = _buffer.FirstOrDefault(d => d.isValid && (d.characteristics & InputDeviceCharacteristics.HandTracking) == 0);
                if (device.isValid) bound.Add($"{state.Hand}: {state.Bind(device)}");
            }
            return bound;
        }
    }
}
