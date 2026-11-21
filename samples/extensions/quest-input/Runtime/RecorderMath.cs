// ==============================================
// Arsist Extension: quest-input — recorder maths (UnityEngine-free)
// samples/extensions/quest-input/Runtime/RecorderMath.cs
//
// 録画の時刻と大きさの計算。UnityEngine に依存しないので tools/perception-check (QuestInputChecks) で検証している。
//   RecorderClock   録り始めからの経過 (一時停止の分を引く) → 画の pts
//   FramePacer      カメラが描くたびに来る画から、録画の fps のぶんだけ選ぶ
//   AudioClock      音の pts はサンプル数から。ただし実時間から離れすぎたら合わせ直す
//   RecorderMath    エンコードする大きさ・PCM16・ファイル名
// 時刻は秒 (double、Time.realtimeSinceStartupAsDouble) で受け、マイクロ秒 (long) で返す。
// ==============================================

using System;
using System.Text;

namespace Arsist.Extensions.QuestInput
{
    /// <summary>録り始めからの経過。一時停止している間は進まない。</summary>
    public sealed class RecorderClock
    {
        private double _start = -1;
        private double _pausedTotal;
        private double _pausedAt = -1;

        public bool Running => _start >= 0;
        public bool Paused => _pausedAt >= 0;

        public void Begin(double now)
        {
            _start = now;
            _pausedTotal = 0;
            _pausedAt = -1;
        }

        public void Reset()
        {
            _start = -1;
            _pausedTotal = 0;
            _pausedAt = -1;
        }

        public void Pause(double now)
        {
            if (Running && !Paused) _pausedAt = now;
        }

        public void Resume(double now)
        {
            if (!Paused) return;
            _pausedTotal += Math.Max(0, now - _pausedAt);
            _pausedAt = -1;
        }

        /// <summary>録っていた秒数 (一時停止の分を除く)。</summary>
        public double Seconds(double now)
        {
            if (!Running) return 0;
            var end = Paused ? _pausedAt : now;
            return Math.Max(0, end - _start - _pausedTotal);
        }

        public long Micros(double now) => (long)Math.Round(Seconds(now) * 1e6);
    }

    /// <summary>
    /// 録画の fps に間引く。カメラの描画は揺れるので、予定より 1/4 フレームまで早い画も受ける。
    /// 引っかかって遅れたあとは、まとめて何枚も受けず、その時点から数え直す。
    /// </summary>
    public sealed class FramePacer
    {
        private readonly double _interval;
        private double _next = double.NaN;

        public FramePacer(double fps)
        {
            _interval = 1.0 / Math.Max(1.0, fps);
        }

        public bool Due(double now)
        {
            if (double.IsNaN(_next))
            {
                _next = now + _interval;
                return true;
            }
            if (now < _next - _interval * 0.25) return false;
            _next = Math.Max(_next + _interval, now + _interval * 0.75);
            return true;
        }

        public void Reset() => _next = double.NaN;
    }

    /// <summary>
    /// 音の pts。サンプル数で数えるので音は途切れずにつながる。マイクの時計が実時間とずれていく分
    /// (1 時間で数秒ありうる) は、離れが MaxDriftMicros を超えたときに合わせ直す:
    /// 音が遅れていたら先へ飛ばし (少し隙間ができる)、進みすぎていたらその塊を捨てる (戻ると MP4 に書けない)。
    /// </summary>
    public sealed class AudioClock
    {
        public const long MaxDriftMicros = 150_000;

        private readonly int _rate;
        private long _base = -1;
        private long _samples;

        public AudioClock(int rate)
        {
            _rate = Math.Max(1, rate);
        }

        /// <summary>今届いた count サンプルの先頭の pts。捨てるときは -1。wallMicros は今の録画時刻 (この塊の終わり)。</summary>
        public long Next(int count, long wallMicros)
        {
            if (count <= 0) return -1;
            long chunk = count * 1_000_000L / _rate;
            if (_base < 0)
            {
                _base = Math.Max(0, wallMicros - chunk);
                _samples = 0;
            }
            long pts = _base + _samples * 1_000_000L / _rate;
            long drift = pts + chunk - wallMicros; // 正なら音が進んでいる
            if (drift > MaxDriftMicros) return -1;
            if (drift < -MaxDriftMicros)
            {
                _base -= drift;
                pts -= drift;
            }
            _samples += count;
            return pts;
        }

        public void Reset()
        {
            _base = -1;
            _samples = 0;
        }
    }

    public static class RecorderMath
    {
        /// <summary>H.264 で無理なく扱える上限 (Quest のエンコーダは 4K まで)。</summary>
        public const int MaxSide = 3840;

        /// <summary>
        /// エンコードする大きさ。width / height の片方だけなら縦横比を保つ。幅は 16 の倍数、高さは偶数に
        /// 切り下げる (幅が 16 の倍数でないと崩れるエンコーダがある。高さは 1080 のような値を残したい)。最小 16。
        /// </summary>
        public static void FitSize(int sourceWidth, int sourceHeight, int width, int height, out int outWidth, out int outHeight)
        {
            sourceWidth = Math.Max(16, sourceWidth);
            sourceHeight = Math.Max(16, sourceHeight);
            double w, h;
            if (width > 0 && height > 0) { w = width; h = height; }
            else if (width > 0) { w = width; h = width * (double)sourceHeight / sourceWidth; }
            else if (height > 0) { h = height; w = height * (double)sourceWidth / sourceHeight; }
            else { w = sourceWidth; h = sourceHeight; }

            var longest = Math.Max(w, h);
            if (longest > MaxSide)
            {
                w *= MaxSide / longest;
                h *= MaxSide / longest;
            }
            outWidth = Math.Max(16, ((int)Math.Round(w)) & ~15);
            outHeight = Math.Max(16, ((int)Math.Round(h)) & ~1);
        }

        /// <summary>行 (rowBytes バイト) の並びを上下逆にする (その場で)。</summary>
        public static void FlipRows(byte[] pixels, int rowBytes, int rows)
        {
            if (pixels == null || rowBytes <= 0 || rows < 2 || pixels.Length < rowBytes * rows) return;
            var tmp = new byte[rowBytes];
            for (int top = 0, bottom = rows - 1; top < bottom; top++, bottom--)
            {
                Buffer.BlockCopy(pixels, top * rowBytes, tmp, 0, rowBytes);
                Buffer.BlockCopy(pixels, bottom * rowBytes, pixels, top * rowBytes, rowBytes);
                Buffer.BlockCopy(tmp, 0, pixels, bottom * rowBytes, rowBytes);
            }
        }

        /// <summary>-1..1 の float を PCM16 (リトルエンディアン) にして dst に書く。書いたバイト数。</summary>
        public static int ToPcm16(float[] src, int offset, int count, byte[] dst)
        {
            if (src == null || dst == null) return 0;
            count = Math.Min(count, Math.Min(src.Length - offset, dst.Length / 2));
            for (int i = 0; i < count; i++)
            {
                var f = src[offset + i];
                if (float.IsNaN(f)) f = 0;
                int s = (int)Math.Round(Math.Max(-1f, Math.Min(1f, f)) * 32767f);
                dst[i * 2] = (byte)(s & 0xFF);
                dst[i * 2 + 1] = (byte)((s >> 8) & 0xFF);
            }
            return Math.Max(0, count) * 2;
        }

        /// <summary>"Arsist_20261025_142530.mp4" のような名前 (時刻は端末の現地時刻)。</summary>
        public static string FileName(DateTime time, string prefix, string extension) =>
            $"{SafeName(prefix, "Arsist")}_{time:yyyyMMdd_HHmmss}.{extension}";

        /// <summary>フォルダ名に使えない文字を除く (Movies/〈これ〉/ の部分)。空になったら fallback。</summary>
        public static string SafeName(string name, string fallback)
        {
            if (string.IsNullOrWhiteSpace(name)) return fallback;
            var sb = new StringBuilder();
            foreach (var c in name.Trim())
            {
                if (c < 0x20 || "/\\:*?\"<>|".IndexOf(c) >= 0) continue;
                sb.Append(c);
            }
            var s = sb.ToString().Trim().Trim('.');
            return s.Length == 0 ? fallback : s;
        }
    }
}
