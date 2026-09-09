// ==============================================
// Arsist Engine - Perception / Text
// 文字認識の契約
//
// 幾何 (RegionRectifier) と文字認識をここで切り離している。
// 認識器はターゲットもホモグラフィも知らず、ただの上向きの画素を受け取るだけ。
// おかげでタスク基盤全体を MockTextRecognizer だけで（カメラも実機も無しで）
// テストでき、エンジンの差し替えが1行で済む。doc/12-ar-behaviors.md §4。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Text
{
    /// <summary>認識器に渡す画素。行は上から下（Android の Bitmap 規約）。</summary>
    public struct RgbaImage
    {
        public byte[] Pixels;
        public int Width;
        public int Height;

        public bool IsValid => Pixels != null && Width > 0 && Height > 0
                               && Pixels.Length >= Width * Height * 4;
    }

    public sealed class TextResult
    {
        public bool Ok;
        public string Text = string.Empty;
        public string[] Lines = Array.Empty<string>();
        /// <summary>失敗理由。UI にそのまま出せる短い識別子。</summary>
        public string Error = string.Empty;
        public int ElapsedMs;

        public static TextResult Failure(string error)
        {
            return new TextResult { Ok = false, Error = error ?? "engine" };
        }

        public static TextResult Success(string text, int elapsedMs)
        {
            var normalized = text ?? string.Empty;
            return new TextResult
            {
                Ok = true,
                Text = normalized,
                Lines = normalized.Length == 0
                    ? Array.Empty<string>()
                    : normalized.Replace("\r\n", "\n").Split('\n'),
                ElapsedMs = elapsedMs,
            };
        }
    }

    public interface IArsistTextRecognizer
    {
        /// <summary>この端末で使えるか。</summary>
        bool IsAvailable { get; }

        /// <summary>ログ表示用。</summary>
        string Description { get; }

        /// <summary>
        /// 認識する。done はメインスレッドで呼ばれること。
        /// </summary>
        /// <param name="script">"latin" または "japanese"</param>
        void Recognize(RgbaImage image, string script, Action<TextResult> done);
    }
}
