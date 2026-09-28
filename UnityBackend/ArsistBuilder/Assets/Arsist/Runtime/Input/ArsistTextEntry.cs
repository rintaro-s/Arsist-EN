// ==============================================
// Arsist Engine - Input
// 「文字を打つ」の入り口 (端末ごとの違いはここで吸収する)
//
// 打ち方は 2 つある:
//   1. 端末の入力方式 (IME) — Quest のシステムキーボード、XREAL のスマホ、Android のキーボード。
//      TouchScreenKeyboard で開く。日本語・音声入力・予測変換は端末が持っているものをそのまま使える。
//   2. アプリの中のキーボード — 1 が無い / 出てこない端末 (パソコンでの確認も含む) で下から出す。
//      ArsistVirtualKeyboard をその場で作る。英数字だけ。
//
// 1 を開いても実際に出ないことがある (端末の設定や機能宣言の漏れ)。その場合に何も打てなくなると
// 実機では「タップしても何も起きない」にしか見えないので、少し待って出てこなければ 2 に落とす。
// パソコン等の物理キーボードは、2 のときに直接受け取る。
//
// 端末を見て分岐するのはここだけ。アプリ側 (IR・スクリプト) からは同じ 1 つの「文字入力」に見える。
// ==============================================

using System;
using UnityEngine;

namespace Arsist.Runtime.Input
{
    public static class ArsistTextEntry
    {
        /// <summary>端末のキーボードを開いてから、これだけ出てこなければアプリの中のキーボードに落とす (秒)。</summary>
        private const float SystemKeyboardGraceSeconds = 1.5f;

        private static ArsistTextInput _target;
        private static TouchScreenKeyboard _keyboard;
        private static UI.ArsistVirtualKeyboard _fallback;
        private static GameObject _fallbackPanel;
        private static float _openedAt;
        /// <summary>端末のキーボードが一度でも実際に出たか。出ないまま閉じたなら、中のものに切り替える。</summary>
        private static bool _systemKeyboardWasVisible;
        /// <summary>直前に見た状態 (変わったときだけログに出す)。</summary>
        private static TouchScreenKeyboard.Status _lastStatus = (TouchScreenKeyboard.Status)(-1);
        private static string _lastSystemText = "";
        private static Pump _pump;

        /// <summary>どのキーボードを出すか。ビルド時に IR の interaction.textInput から入る。</summary>
        public enum Mode { Auto, DeviceOnly, InAppOnly }

        private static Mode _mode = Mode.Auto;

        /// <summary>ビルド時の設定を渡す (ArsistTextEntryConfig から)。</summary>
        public static void SetMode(Mode mode)
        {
            _mode = mode;
            Debug.Log($"[Arsist] Text entry mode: {mode}");
        }

        public static ArsistTextInput Current => _target;

        /// <summary>この欄で文字を打ち始める。</summary>
        public static void Begin(ArsistTextInput target)
        {
            if (target == null) return;
            if (_target == target) return;

            End(submit: false);

            _target = target;
            target.SetEditing(true);
            EnsurePump();

            if (_mode == Mode.InAppOnly)
            {
                Debug.Log("[Arsist] Text entry: the project asks for the in-app keyboard.");
                ShowFallback();
                return;
            }

            if (TouchScreenKeyboard.isSupported)
            {
                _lastSystemText = target.Value;
                _systemKeyboardWasVisible = false;
                _lastStatus = (TouchScreenKeyboard.Status)(-1);
                try
                {
                    _keyboard = TouchScreenKeyboard.Open(
                        target.Value,
                        TouchScreenKeyboardType.Default,
                        autocorrection: false,
                        multiline: false,
                        secure: false,
                        alert: false);
                }
                catch (Exception e)
                {
                    // 端末側が対応していないと、例外で返ってくることがある
                    Debug.LogWarning($"[Arsist] Text entry: the device refused to open a keyboard ({e.Message}).");
                    _keyboard = null;
                }
                _openedAt = Time.unscaledTime;
                Debug.Log("[Arsist] Text entry: asked the device for its keyboard.");
                if (_keyboard != null) return;
                Debug.LogWarning("[Arsist] Text entry: the device did not give a keyboard.");
            }
            else
            {
                Debug.Log("[Arsist] Text entry: this device has no keyboard of its own.");
            }

            if (_mode == Mode.DeviceOnly)
            {
                // 端末のものだけを使う設定。落とす先が無いので、打てないことをはっきり残す。
                Debug.LogError("[Arsist] Text entry: the project asks for the device keyboard only, " +
                               "but this device did not open one. Nothing can be typed. " +
                               "Switch 'text input' to automatic or in-app in the build settings.");
                End(submit: false);
                return;
            }

            ShowFallback();
        }

        /// <summary>打ち終わる。submit なら確定として扱う (イベントが鳴る)。</summary>
        public static void End(bool submit)
        {
            var target = _target;
            _target = null;

            if (_keyboard != null)
            {
                _keyboard.active = false;
                _keyboard = null;
            }
            HideFallback();

            if (target == null) return;
            target.SetEditing(false);
            Debug.Log($"[Arsist] Text entry finished: {(submit ? "submitted" : "cancelled")}, {target.Length} character(s).");
            if (submit) target.Submit();
        }

        // ---- アプリの中のキーボード ----

        private static void ShowFallback()
        {
            var target = _target;
            if (target == null) return;

            var canvas = target.GetComponentInParent<Canvas>();
            var canvasRect = canvas != null ? canvas.transform as RectTransform : null;
            if (canvasRect == null)
            {
                Debug.LogError("[Arsist] Text entry: no Canvas to put the in-app keyboard on.");
                End(submit: false);
                return;
            }

            // レイヤーは Canvas に合わせる。`new GameObject()` は親のレイヤーを継がないので、
            // ここが Default のままだと HUD を描くカメラの対象から外れ、
            // **出ているのに見えない**キーボードになる (UI/ArsistUiLayers の説明を参照)。
            _fallbackPanel = UI.ArsistUiLayers.CreateChild("Arsist Keyboard", canvasRect);

            var rect = _fallbackPanel.AddComponent<RectTransform>();
            rect.anchorMin = new Vector2(0.5f, 0f);
            rect.anchorMax = new Vector2(0.5f, 0f);
            rect.pivot = new Vector2(0.5f, 0f);
            rect.sizeDelta = new Vector2(canvasRect.rect.width * 0.92f, canvasRect.rect.height * 0.40f);
            rect.anchoredPosition = new Vector2(0f, canvasRect.rect.height * 0.03f);
            // 手前に出す (同じ板の上では、後に描かれる方が手前)
            _fallbackPanel.transform.SetAsLastSibling();

            var background = _fallbackPanel.AddComponent<UnityEngine.UI.Image>();
            background.color = new Color(0.04f, 0.05f, 0.07f, 0.92f);

            UI.ArsistUiLayers.MatchParent(_fallbackPanel, canvasRect);
            Debug.Log($"[Arsist] Text entry: showing the in-app keyboard " +
                      $"({rect.sizeDelta.x:F0}x{rect.sizeDelta.y:F0}, layer={LayerMask.LayerToName(_fallbackPanel.layer)}).");

            _fallback = _fallbackPanel.AddComponent<UI.ArsistVirtualKeyboard>();
            _fallback.Configure(
                target.Value,
                onChanged: text => { if (_target != null) _target.Value = text; },
                onSubmit: text =>
                {
                    if (_target != null) _target.Value = text;
                    End(submit: true);
                },
                onCancel: () => End(submit: false));
        }

        private static void HideFallback()
        {
            _fallback = null;
            if (_fallbackPanel != null)
            {
                UnityEngine.Object.Destroy(_fallbackPanel);
                _fallbackPanel = null;
            }
        }

        // ---- 毎フレームの面倒を見る ----

        private static void EnsurePump()
        {
            if (_pump != null) return;
            var go = new GameObject("Arsist Text Entry");
            UnityEngine.Object.DontDestroyOnLoad(go);
            _pump = go.AddComponent<Pump>();
        }

        [UnityEngine.Scripting.Preserve]
        private class Pump : MonoBehaviour
        {
            private void Update()
            {
                if (_target == null)
                {
                    // 打っていた欄が消えた (場面の切り替え等)。開きっぱなしのものを片づける。
                    if (_keyboard != null || _fallbackPanel != null)
                    {
                        Debug.Log("[Arsist] Text entry: the field went away; closing the keyboard.");
                        End(submit: false);
                    }
                    return;
                }

                if (_keyboard != null)
                {
                    PumpSystemKeyboard();
                    return;
                }

                // アプリの中のキーボードで打っている間は、物理キーボードも受ける
                // (パソコンでの確認、端末につないだキーボード)。
                PumpHardwareKeys();
            }

            private void PumpSystemKeyboard()
            {
                var text = _keyboard.text ?? "";
                if (text != _lastSystemText)
                {
                    _lastSystemText = text;
                    _target.Value = text;
                    // 端末のキーボードから文字が届いていることを、実機のログで確かめられるように。
                    // 毎打鍵は多すぎるので、最初の 1 文字と 10 文字ごとだけ。
                    if (text.Length <= 1 || text.Length % 10 == 0)
                    {
                        Debug.Log($"[Arsist] Text entry: {text.Length} character(s) from the device keyboard.");
                    }
                }

                if (TouchScreenKeyboard.visible && !_systemKeyboardWasVisible)
                {
                    _systemKeyboardWasVisible = true;
                    Debug.Log("[Arsist] Text entry: the device keyboard is up.");
                }

                var status = _keyboard.status;
                if (status != _lastStatus)
                {
                    _lastStatus = status;
                    Debug.Log($"[Arsist] Text entry: device keyboard status = {status}");
                }

                switch (status)
                {
                    case TouchScreenKeyboard.Status.Done:
                        // 最後の 1 文字が確定と同じフレームで来ることがある。
                        // ここで読み直さないと、その 1 文字が落ちたまま送られる。
                        _target.Value = _keyboard.text ?? _target.Value;
                        End(submit: true);
                        return;

                    case TouchScreenKeyboard.Status.Canceled:
                    case TouchScreenKeyboard.Status.LostFocus:
                        // 一度も出ないまま閉じたなら、「閉じた」ではなく「出せなかった」。
                        // ここで終わってしまうと、押したのに何も起きない端末ができる。
                        if (!_systemKeyboardWasVisible)
                        {
                            FallBackFromSystemKeyboard("the device closed it before it ever appeared");
                            return;
                        }
                        End(submit: false);
                        return;
                }

                // 頼んだのに出てこない端末では、待っていても何も打てない。中のキーボードに落とす。
                if (!_systemKeyboardWasVisible && Time.unscaledTime - _openedAt > SystemKeyboardGraceSeconds)
                {
                    FallBackFromSystemKeyboard("it did not appear");
                }
            }

            /// <summary>端末のキーボードを諦めて、アプリの中のものに切り替える。</summary>
            private void FallBackFromSystemKeyboard(string reason)
            {
                if (_keyboard != null)
                {
                    try { _keyboard.active = false; } catch { /* すでに閉じている */ }
                    _keyboard = null;
                }
                if (_mode == Mode.DeviceOnly)
                {
                    Debug.LogError($"[Arsist] Text entry: the device keyboard is not usable ({reason}) and the " +
                                   "project asks for the device keyboard only. Nothing can be typed.");
                    End(submit: false);
                    return;
                }
                Debug.LogWarning($"[Arsist] Text entry: the device keyboard is not usable ({reason}); showing the in-app one.");
                ShowFallback();
            }

            private void PumpHardwareKeys()
            {
                var typed = UnityEngine.Input.inputString;
                if (string.IsNullOrEmpty(typed)) return;

                var value = _target.Value;
                foreach (var c in typed)
                {
                    if (c == '\b')
                    {
                        if (value.Length > 0) value = value.Substring(0, value.Length - 1);
                    }
                    else if (c == '\n' || c == '\r')
                    {
                        _target.Value = value;
                        End(submit: true);
                        return;
                    }
                    else if (!char.IsControl(c))
                    {
                        value += c;
                    }
                }
                _target.Value = value;
                if (_fallback != null) _fallback.SetText(value);
            }
        }
    }
}
