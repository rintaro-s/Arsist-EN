// ==============================================
// Arsist Extension: quest-input — microphone maths (UnityEngine-free)
// Extensions/quest-input/Runtime/MicMath.cs
//
// 音量 (RMS → 0..1)、話し始め / 話し終わりの判定、サンプルレート変換、WAV への書き出し。
// UnityEngine に依存しないので tools/perception-check (MicChecks) で数値検証している。
// ==============================================

using System;
using System.IO;
using System.Text;

namespace Arsist.Extensions.QuestInput
{
    public static class MicMath
    {
        /// <summary>二乗平均平方根 (-1..1 のサンプル)。</summary>
        public static float Rms(float[] samples, int offset, int count)
        {
            if (samples == null || count <= 0) return 0f;
            double sum = 0;
            int end = Math.Min(samples.Length, offset + count);
            int n = 0;
            for (int i = Math.Max(0, offset); i < end; i++) { sum += samples[i] * samples[i]; n++; }
            return n == 0 ? 0f : (float)Math.Sqrt(sum / n);
        }

        /// <summary>
        /// 音量 0..1。-60 dBFS 以下を 0、0 dBFS を 1 として dB で線形に並べる
        /// (耳の感じ方に近く、メーター表示にそのまま使える)。
        /// </summary>
        public static float Level(float rms)
        {
            if (rms <= 1e-6f) return 0f;
            var db = 20.0 * Math.Log10(rms);
            var level = (db + 60.0) / 60.0;
            return (float)(level < 0 ? 0 : level > 1 ? 1 : level);
        }

        /// <summary>線形補間でサンプルレートを変える (音声認識に渡す 16 kHz に落とす用)。</summary>
        public static float[] Resample(float[] input, int fromRate, int toRate)
        {
            if (input == null || input.Length == 0) return Array.Empty<float>();
            if (fromRate <= 0 || toRate <= 0 || fromRate == toRate) return (float[])input.Clone();
            int outLength = (int)Math.Max(1, Math.Round((long)input.Length * toRate / (double)fromRate));
            var output = new float[outLength];
            double step = (double)fromRate / toRate;
            for (int i = 0; i < outLength; i++)
            {
                double pos = i * step;
                int a = (int)pos;
                if (a >= input.Length - 1) { output[i] = input[input.Length - 1]; continue; }
                float t = (float)(pos - a);
                output[i] = input[a] + (input[a + 1] - input[a]) * t;
            }
            return output;
        }

        /// <summary>16 bit PCM モノラルの WAV。</summary>
        public static byte[] EncodeWav16(float[] samples, int sampleRate)
        {
            samples ??= Array.Empty<float>();
            using var ms = new MemoryStream(44 + samples.Length * 2);
            using var w = new BinaryWriter(ms, Encoding.ASCII);
            int dataBytes = samples.Length * 2;
            w.Write(Encoding.ASCII.GetBytes("RIFF"));
            w.Write(36 + dataBytes);
            w.Write(Encoding.ASCII.GetBytes("WAVE"));
            w.Write(Encoding.ASCII.GetBytes("fmt "));
            w.Write(16);                 // fmt チャンクの大きさ
            w.Write((short)1);           // PCM
            w.Write((short)1);           // モノラル
            w.Write(sampleRate);
            w.Write(sampleRate * 2);     // byte rate
            w.Write((short)2);           // block align
            w.Write((short)16);          // bits per sample
            w.Write(Encoding.ASCII.GetBytes("data"));
            w.Write(dataBytes);
            foreach (var s in samples)
            {
                var c = s < -1f ? -1f : s > 1f ? 1f : s;
                w.Write((short)Math.Round(c * 32767f));
            }
            w.Flush();
            return ms.ToArray();
        }
    }

    /// <summary>最後の数秒を覚えておく輪っかのバッファ。</summary>
    public sealed class SampleRing
    {
        private readonly float[] _buffer;
        private long _written;

        public SampleRing(int capacity) { _buffer = new float[Math.Max(1, capacity)]; }

        public int Capacity => _buffer.Length;

        /// <summary>これまでに書いた総サンプル数 (位置の目印に使う)。</summary>
        public long Written => _written;

        public void Append(float[] samples, int offset, int count)
        {
            for (int i = 0; i < count; i++)
            {
                _buffer[(int)(_written % _buffer.Length)] = samples[offset + i];
                _written++;
            }
        }

        /// <summary>
        /// 位置 from (Written の値) から to までを取り出す。もう上書きされた古い部分は切り捨てる。
        /// </summary>
        public float[] Range(long from, long to)
        {
            long oldest = Math.Max(0, _written - _buffer.Length);
            from = Math.Max(from, oldest);
            to = Math.Min(to, _written);
            if (to <= from) return Array.Empty<float>();
            var result = new float[to - from];
            for (long i = from; i < to; i++) result[i - from] = _buffer[(int)(i % _buffer.Length)];
            return result;
        }
    }

    /// <summary>
    /// 話し始め / 話し終わりの判定。
    ///   - 音量が threshold を startSeconds 続けて超えたら「話し始め」
    ///     (咳やキーボードの音のような短い音では始まらない)
    ///   - 話している間に threshold を下回る時間が endSeconds 続いたら「話し終わり」
    ///     (言葉の切れ目の短い無音では終わらない)
    ///   - maxSeconds を超えたら強制的に終わり (喋り続けても切れ目を作る)
    /// </summary>
    public sealed class VoiceActivity
    {
        public float Threshold = 0.45f;
        public float StartSeconds = 0.12f;
        public float EndSeconds = 0.7f;
        public float MaxSeconds = 15f;

        private float _above;
        private float _below;
        private float _length;

        public bool Speaking { get; private set; }

        /// <summary>話し始めを判定するまでに使った時間 (発話の頭を切り落とさないための巻き戻し量)。</summary>
        public float LeadSeconds => StartSeconds;

        /// <summary>音量 (0..1) と経過時間を渡す。戻り値: +1 話し始め / -1 話し終わり / 0 変化なし。</summary>
        public int Update(float level, float dt)
        {
            if (dt <= 0) return 0;
            if (!Speaking)
            {
                _above = level >= Threshold ? _above + dt : 0f;
                if (_above >= StartSeconds)
                {
                    Speaking = true;
                    _below = 0f;
                    _length = _above;
                    return +1;
                }
                return 0;
            }

            _length += dt;
            _below = level < Threshold ? _below + dt : 0f;
            if (_below >= EndSeconds || _length >= MaxSeconds)
            {
                Speaking = false;
                _above = 0f;
                return -1;
            }
            return 0;
        }

        public void Reset()
        {
            Speaking = false;
            _above = _below = _length = 0f;
        }
    }
}
