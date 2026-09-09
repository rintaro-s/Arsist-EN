// ==============================================
// Arsist Engine - Perception / Text
// 固定文字列を返す認識器
//
// これがあるおかげで、トリガ・キュー・DataStore への書き込み・UI バインドまで、
// カメラも実機も無しに通しで確認できる。エディタのプレビューや自動テスト用。
// ==============================================

using System;
using UnityEngine;

namespace Arsist.Runtime.Perception.Text
{
    public sealed class MockTextRecognizer : IArsistTextRecognizer
    {
        private readonly string _text;

        public MockTextRecognizer(string text)
        {
            _text = string.IsNullOrEmpty(text) ? "mock text" : text;
        }

        public bool IsAvailable => true;

        public string Description => "Mock recognizer (returns a fixed string)";

        public void Recognize(RgbaImage image, string script, Action<TextResult> done)
        {
            if (!image.IsValid)
            {
                done?.Invoke(TextResult.Failure("invalidImage"));
                return;
            }
            Debug.Log($"[Arsist] Mock OCR on {image.Width}x{image.Height} ({script})");
            done?.Invoke(TextResult.Success(_text, 0));
        }
    }
}
