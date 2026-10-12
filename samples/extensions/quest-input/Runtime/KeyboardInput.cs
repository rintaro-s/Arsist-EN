// ==============================================
// Arsist Extension: quest-input — keyboards
// samples/extensions/quest-input/Runtime/KeyboardInput.cs
//
// 2 種類:
//   システムキーボード  スクリプトから開く (keyboard.open)。入力欄 (Input 要素) が無くても使える。
//                      Quest ではシステムのキーボード オーバーレイ (日本語・音声入力つき)。
//                      その宣言 (oculus.software.overlay_keyboard / requiresSystemKeyboard) は、
//                      この拡張機能が feature:text-input を名乗ることでエンジンが付ける。
//   物理キーボード      Bluetooth でつないだキーボード。Unity の旧 Input (このエンジンの設定:
//                      activeInputHandler = Input Manager) の inputString / GetKeyDown で読む。
// ==============================================

using System;
using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Extensions.QuestInput
{
    internal sealed class KeyboardInput
    {
        private TouchScreenKeyboard _keyboard;
        private Action<string, bool> _done;
        private string _lastText = "";
        private bool _wasVisible;
        private float _openedAt;

        public bool IsOpen => _keyboard != null;
        public string Text => _keyboard != null ? _keyboard.text ?? "" : _lastText;

        /// <summary>入力中の文字が変わった。</summary>
        public event Action<string> Changed;

        // 物理キーボードで見るキー (名前は KeyCode を小文字にしたもの: "a", "space", "return", "f1" …)
        private static readonly KeyCode[] WatchedKeys = BuildWatchedKeys();

        private static KeyCode[] BuildWatchedKeys()
        {
            var keys = new List<KeyCode>();
            for (var k = KeyCode.A; k <= KeyCode.Z; k++) keys.Add(k);
            for (var k = KeyCode.Alpha0; k <= KeyCode.Alpha9; k++) keys.Add(k);
            for (var k = KeyCode.F1; k <= KeyCode.F12; k++) keys.Add(k);
            keys.AddRange(new[]
            {
                KeyCode.Space, KeyCode.Return, KeyCode.KeypadEnter, KeyCode.Backspace, KeyCode.Delete, KeyCode.Tab, KeyCode.Escape,
                KeyCode.UpArrow, KeyCode.DownArrow, KeyCode.LeftArrow, KeyCode.RightArrow,
                KeyCode.Home, KeyCode.End, KeyCode.PageUp, KeyCode.PageDown,
                KeyCode.LeftShift, KeyCode.RightShift, KeyCode.LeftControl, KeyCode.RightControl, KeyCode.LeftAlt, KeyCode.RightAlt,
                KeyCode.Minus, KeyCode.Equals, KeyCode.Comma, KeyCode.Period, KeyCode.Slash,
            });
            return keys.ToArray();
        }

        /// <summary>システムキーボードを開く。閉じたら done(text, submitted)。</summary>
        public bool Open(string text, bool multiline, bool secure, string placeholder, Action<string, bool> done)
        {
            if (_keyboard != null) Close(false);
            if (!TouchScreenKeyboard.isSupported)
            {
                done?.Invoke(text ?? "", false);
                return false;
            }
            _done = done;
            _lastText = text ?? "";
            _wasVisible = false;
            _openedAt = Time.unscaledTime;
            _keyboard = TouchScreenKeyboard.Open(_lastText, TouchScreenKeyboardType.Default, false, multiline, secure, false, placeholder ?? "");
            return _keyboard != null;
        }

        public void Close(bool submitted)
        {
            if (_keyboard == null) return;
            var text = _keyboard.text ?? _lastText;
            try { _keyboard.active = false; } catch (Exception) { /* もう閉じている */ }
            Finish(text, submitted);
        }

        /// <summary>毎フレーム。戻り値: 何か起きたときの説明 (ログ用)。</summary>
        public string Poll()
        {
            if (_keyboard == null) return null;
            var text = _keyboard.text ?? "";
            if (text != _lastText)
            {
                _lastText = text;
                Changed?.Invoke(text);
            }

            switch (_keyboard.status)
            {
                case TouchScreenKeyboard.Status.Visible:
                    if (!_wasVisible) { _wasVisible = true; return "system keyboard visible"; }
                    return null;
                case TouchScreenKeyboard.Status.Done:
                    Finish(text, true);
                    return $"system keyboard done ({text.Length} chars)";
                case TouchScreenKeyboard.Status.Canceled:
                case TouchScreenKeyboard.Status.LostFocus:
                    var status = _keyboard.status;
                    Finish(text, false);
                    return $"system keyboard closed: {status}";
                default:
                    // 一度も出ないまま数秒経ったら、出ない端末・設定として閉じる
                    if (!_wasVisible && Time.unscaledTime - _openedAt > 3f)
                    {
                        Finish(text, false);
                        return "system keyboard never became visible (is requiresSystemKeyboard set? see the build log)";
                    }
                    return null;
            }
        }

        private void Finish(string text, bool submitted)
        {
            _keyboard = null;
            _lastText = text ?? "";
            var done = _done;
            _done = null;
            done?.Invoke(_lastText, submitted);
        }

        // ---- 物理キーボード ----

        /// <summary>このフレームに打たれた文字 (日本語の確定文字も含む)。</summary>
        public string TypedText() => UnityEngine.Input.inputString ?? "";

        /// <summary>このフレームに押されたキーの名前。</summary>
        public List<string> KeysDown()
        {
            List<string> keys = null;
            if (!UnityEngine.Input.anyKeyDown) return null;
            foreach (var k in WatchedKeys)
            {
                if (UnityEngine.Input.GetKeyDown(k)) (keys ??= new List<string>()).Add(KeyName(k));
            }
            return keys;
        }

        public static string KeyName(KeyCode key)
        {
            if (key >= KeyCode.Alpha0 && key <= KeyCode.Alpha9) return ((int)(key - KeyCode.Alpha0)).ToString();
            if (key == KeyCode.Return || key == KeyCode.KeypadEnter) return "enter";
            return key.ToString().ToLowerInvariant();
        }

        public static bool IsDown(string name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            var n = name.Trim().ToLowerInvariant();
            if (n == "enter") return UnityEngine.Input.GetKey(KeyCode.Return) || UnityEngine.Input.GetKey(KeyCode.KeypadEnter);
            if (n.Length == 1 && n[0] >= '0' && n[0] <= '9') return UnityEngine.Input.GetKey(KeyCode.Alpha0 + (n[0] - '0'));
            return Enum.TryParse<KeyCode>(n, true, out var key) && UnityEngine.Input.GetKey(key);
        }
    }
}
