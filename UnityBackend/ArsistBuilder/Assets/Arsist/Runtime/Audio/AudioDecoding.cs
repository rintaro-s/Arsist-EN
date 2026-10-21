// ==============================================
// Arsist Engine - Audio decoding (UnityEngine に依存しない部分)
//
// スクリプトの audio.play に渡された「音のバイト列」を扱う:
//   - 何の形式か (WAV / MP3 / OGG) を先頭のバイトで見分ける
//   - WAV は自前で読む (PCM 8/16/24/32bit・float 32bit)。読み上げ API やマイクの WAV はこれで足りる
//   - MP3 / OGG は Unity に任せる (一時ファイル → UnityWebRequestMultimedia。AudioWrapper 側)
//   - base64 / data: URL をバイト列に戻す
//
// tools/perception-check (素の .NET) で検証している。
// ==============================================

using System;
using System.Text;

namespace Arsist.Runtime.Audio
{
    public enum AudioFormatKind
    {
        Unknown,
        Wav,
        Mp3,
        Ogg,
    }

    /// <summary>WAV を読んだ結果。Samples はチャンネルが交互に並んだ -1..1。</summary>
    public sealed class DecodedPcm
    {
        public float[] Samples;
        public int Channels;
        public int SampleRate;
        public int Frames => Channels > 0 ? Samples.Length / Channels : 0;
        public double Seconds => SampleRate > 0 ? (double)Frames / SampleRate : 0;
    }

    public static class AudioDecoding
    {
        /// <summary>先頭のバイトから形式を見分ける。</summary>
        public static AudioFormatKind Sniff(byte[] data)
        {
            if (data == null || data.Length < 4) return AudioFormatKind.Unknown;
            if (data.Length >= 12 && data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F'
                && data[8] == 'W' && data[9] == 'A' && data[10] == 'V' && data[11] == 'E')
                return AudioFormatKind.Wav;
            if (data[0] == 'O' && data[1] == 'g' && data[2] == 'g' && data[3] == 'S') return AudioFormatKind.Ogg;
            if (data[0] == 'I' && data[1] == 'D' && data[2] == '3') return AudioFormatKind.Mp3;
            // MPEG のフレーム同期 (11 bit が 1)
            if (data[0] == 0xFF && (data[1] & 0xE0) == 0xE0) return AudioFormatKind.Mp3;
            return AudioFormatKind.Unknown;
        }

        /// <summary>"wav" / "audio/mpeg" / ".ogg" などの名前から形式を決める (見分けられなかったときの手がかり)。</summary>
        public static AudioFormatKind FromName(string name)
        {
            if (string.IsNullOrEmpty(name)) return AudioFormatKind.Unknown;
            var n = name.ToLowerInvariant();
            if (n.Contains("wav") || n.Contains("wave")) return AudioFormatKind.Wav;
            if (n.Contains("mp3") || n.Contains("mpeg")) return AudioFormatKind.Mp3;
            if (n.Contains("ogg") || n.Contains("vorbis") || n.Contains("opus")) return AudioFormatKind.Ogg;
            return AudioFormatKind.Unknown;
        }

        /// <summary>
        /// base64 か data: URL をバイト列にする。どちらでもなければ null。
        /// 改行・空白は無視する (API の応答に混ざることがある)。mimeType には data: URL の型を返す。
        /// </summary>
        public static byte[] DecodeBase64(string text, out string mimeType)
        {
            mimeType = null;
            if (string.IsNullOrWhiteSpace(text)) return null;
            var body = text.Trim();
            if (body.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            {
                int comma = body.IndexOf(',');
                if (comma < 0) return null;
                var header = body.Substring(5, comma - 5);
                int semi = header.IndexOf(';');
                mimeType = semi >= 0 ? header.Substring(0, semi) : header;
                if (header.IndexOf("base64", StringComparison.OrdinalIgnoreCase) < 0) return null;
                body = body.Substring(comma + 1);
            }

            var sb = new StringBuilder(body.Length);
            foreach (var c in body)
            {
                if (char.IsWhiteSpace(c)) continue;
                // base64url も受ける
                if (c == '-') sb.Append('+');
                else if (c == '_') sb.Append('/');
                else sb.Append(c);
            }
            while (sb.Length % 4 != 0) sb.Append('=');
            try { return Convert.FromBase64String(sb.ToString()); }
            catch (FormatException) { return null; }
        }

        /// <summary>
        /// WAV (RIFF) を読む。対応: PCM 8/16/24/32bit、IEEE float 32bit、WAVE_FORMAT_EXTENSIBLE (中身が PCM / float のもの)。
        /// 読めなければ null と理由。
        /// </summary>
        public static DecodedPcm DecodeWav(byte[] data, out string error)
        {
            error = null;
            if (Sniff(data) != AudioFormatKind.Wav) { error = "notWav"; return null; }

            int pos = 12;
            int format = 0, channels = 0, sampleRate = 0, bits = 0;
            int dataStart = -1, dataLength = 0;
            while (pos + 8 <= data.Length)
            {
                string id = Encoding.ASCII.GetString(data, pos, 4);
                int size = ReadInt32(data, pos + 4);
                int body = pos + 8;
                if (size < 0) { error = "badChunk"; return null; }
                if (id == "fmt ")
                {
                    if (size < 16 || body + 16 > data.Length) { error = "badFmt"; return null; }
                    format = ReadUInt16(data, body);
                    channels = ReadUInt16(data, body + 2);
                    sampleRate = ReadInt32(data, body + 4);
                    bits = ReadUInt16(data, body + 14);
                    // WAVE_FORMAT_EXTENSIBLE: 本当の形式は SubFormat GUID の先頭 2 バイト
                    if (format == 0xFFFE && size >= 40 && body + 26 <= data.Length) format = ReadUInt16(data, body + 24);
                }
                else if (id == "data")
                {
                    dataStart = body;
                    // ストリーミングで書かれた WAV は data の長さが 0 / 0xFFFFFFFF のことがある → 末尾まで
                    dataLength = (size == 0 || body + size > data.Length) ? data.Length - body : size;
                    break;
                }
                // チャンクは偶数バイトに揃えられている
                pos = body + size + (size & 1);
            }

            if (dataStart < 0) { error = "noData"; return null; }
            if (channels <= 0 || sampleRate <= 0) { error = "badFmt"; return null; }
            bool isFloat = format == 3;
            if (format != 1 && !isFloat) { error = "unsupportedFormat:" + format; return null; }
            if (isFloat && bits != 32) { error = "unsupportedFloatBits:" + bits; return null; }
            if (!isFloat && bits != 8 && bits != 16 && bits != 24 && bits != 32) { error = "unsupportedBits:" + bits; return null; }

            int bytesPerSample = bits / 8;
            int frameBytes = bytesPerSample * channels;
            int frames = dataLength / frameBytes;
            var samples = new float[frames * channels];
            int p = dataStart;
            for (int i = 0; i < samples.Length; i++, p += bytesPerSample)
            {
                float v;
                if (isFloat) v = BitConverter.ToSingle(data, p);
                else if (bits == 8) v = (data[p] - 128) / 128f;                       // 8bit は符号なし
                else if (bits == 16) v = (short)(data[p] | (data[p + 1] << 8)) / 32768f;
                else if (bits == 24) v = ((data[p] | (data[p + 1] << 8) | (data[p + 2] << 16)) << 8 >> 8) / 8388608f;
                else v = ReadInt32(data, p) / 2147483648f;
                samples[i] = v < -1f ? -1f : (v > 1f ? 1f : v);
            }
            return new DecodedPcm { Samples = samples, Channels = channels, SampleRate = sampleRate };
        }

        private static int ReadInt32(byte[] d, int p) => d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24);
        private static int ReadUInt16(byte[] d, int p) => d[p] | (d[p + 1] << 8);
    }

    /// <summary>
    /// 口の開き (リップシンク) と音の大きさ。鳴っている音のサンプルから 0..1 を作る。
    /// 小さな声でも口が動き、ノイズでは閉じたままになるよう dB で見る。
    /// </summary>
    public static class LipSyncMath
    {
        /// <summary>これより小さい音 (dBFS) は 0。</summary>
        public const double FloorDb = -50;
        /// <summary>これより大きい音 (dBFS) は 1。</summary>
        public const double CeilingDb = -12;

        public static double Rms(float[] samples, int count)
        {
            if (samples == null || count <= 0) return 0;
            count = Math.Min(count, samples.Length);
            double sum = 0;
            for (int i = 0; i < count; i++) sum += samples[i] * samples[i];
            return Math.Sqrt(sum / count);
        }

        /// <summary>RMS → 0..1 (FloorDb..CeilingDb を直線に)。</summary>
        public static double Level(double rms)
        {
            if (rms <= 1e-9) return 0;
            double db = 20 * Math.Log10(rms);
            double t = (db - FloorDb) / (CeilingDb - FloorDb);
            return t < 0 ? 0 : (t > 1 ? 1 : t);
        }

        /// <summary>
        /// 前の値から次の値へ。開くのは速く (attack)、閉じるのはゆっくり (release)。
        /// 毎フレームそのまま使うと口がばたつく。秒数は 63% 追従するまでの時間。
        /// </summary>
        public static double Smooth(double previous, double target, double dt, double attackSeconds = 0.04, double releaseSeconds = 0.12)
        {
            if (dt <= 0) return previous;
            double tau = target > previous ? attackSeconds : releaseSeconds;
            double k = 1 - Math.Exp(-dt / Math.Max(1e-4, tau));
            return previous + (target - previous) * k;
        }
    }
}
