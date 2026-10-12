// スクリプトの実行時 API のうち、UnityEngine に依存しない部分の検証。
//
//   - audio.play: 形式の見分け・WAV の読み (8/16/24/32bit・float・拡張形式・奇数長のチャンク)・base64 / data: URL
//   - リップシンク / audio.level: 音の大きさ → 0..1、口の開け閉じのなめらかさ
//   - camera.capture の around / camera.project: ワールドの点 → 画のピクセル (認識と同じ規約。行は下から上)
//   - storage: どのキーを残すか、ファイルの読み書き、壊れたファイル
//   - store: 名前にドットが入った値の中を bind で辿れること ("memory.episodes[0].event")
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Arsist.Runtime.Audio;
using Arsist.Runtime.Data;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Scripting;

internal static class ScriptRuntimeChecks
{
    private static int _failures;

    private static void Expect(string label, bool ok, string detail = null)
    {
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}{(detail != null ? $": {detail}" : "")}");
        if (!ok) _failures++;
    }

    // ---- WAV を作る ----

    private static byte[] Wav(int format, int channels, int rate, int bits, byte[] pcm, bool extensible = false, bool oddChunk = false, bool streamingSize = false)
    {
        var ms = new MemoryStream();
        var w = new BinaryWriter(ms);
        w.Write(Encoding.ASCII.GetBytes("RIFF"));
        w.Write(0);
        w.Write(Encoding.ASCII.GetBytes("WAVE"));
        if (oddChunk)
        {
            // 奇数長のチャンクは 1 バイト詰め物が入る
            w.Write(Encoding.ASCII.GetBytes("LIST"));
            w.Write(3);
            w.Write(new byte[] { 1, 2, 3, 0 });
        }
        w.Write(Encoding.ASCII.GetBytes("fmt "));
        w.Write(extensible ? 40 : 16);
        w.Write((short)(extensible ? 0xFFFE : format));
        w.Write((short)channels);
        w.Write(rate);
        w.Write(rate * channels * bits / 8);
        w.Write((short)(channels * bits / 8));
        w.Write((short)bits);
        if (extensible)
        {
            w.Write((short)22);
            w.Write((short)bits);
            w.Write(0);
            w.Write((short)format);   // SubFormat GUID の先頭 2 バイト
            w.Write(new byte[14]);
        }
        w.Write(Encoding.ASCII.GetBytes("data"));
        w.Write(streamingSize ? 0 : pcm.Length);
        w.Write(pcm);
        var bytes = ms.ToArray();
        BitConverter.GetBytes(bytes.Length - 8).CopyTo(bytes, 4);
        return bytes;
    }

    private static void TestWav()
    {
        // 16bit ステレオ: (0.5, -0.5), (-1, 32767/32768)
        var pcm16 = new byte[8];
        BitConverter.GetBytes((short)16384).CopyTo(pcm16, 0);
        BitConverter.GetBytes((short)-16384).CopyTo(pcm16, 2);
        BitConverter.GetBytes(short.MinValue).CopyTo(pcm16, 4);
        BitConverter.GetBytes(short.MaxValue).CopyTo(pcm16, 6);
        var wav = Wav(1, 2, 16000, 16, pcm16);
        Expect("a WAV is recognised", AudioDecoding.Sniff(wav) == AudioFormatKind.Wav);
        var d = AudioDecoding.DecodeWav(wav, out var error);
        Expect("16-bit stereo decodes", d != null && d.Channels == 2 && d.SampleRate == 16000 && d.Frames == 2, error);
        Expect("16-bit values", d != null && Math.Abs(d.Samples[0] - 0.5f) < 1e-4 && Math.Abs(d.Samples[1] + 0.5f) < 1e-4 && d.Samples[2] == -1f && d.Samples[3] > 0.999f);

        var pcm8 = new byte[] { 128, 255, 0 };
        var d8 = AudioDecoding.DecodeWav(Wav(1, 1, 8000, 8, pcm8), out error);
        Expect("8-bit is unsigned around 128", d8 != null && d8.Samples[0] == 0f && d8.Samples[1] > 0.99f && d8.Samples[2] == -1f, error);

        // 24bit: -0.25 → 0xE00000
        var pcm24 = new byte[] { 0x00, 0x00, 0xE0, 0x00, 0x00, 0x20 };
        var d24 = AudioDecoding.DecodeWav(Wav(1, 1, 48000, 24, pcm24), out error);
        Expect("24-bit sign-extends", d24 != null && Math.Abs(d24.Samples[0] + 0.25f) < 1e-6 && Math.Abs(d24.Samples[1] - 0.25f) < 1e-6, error);

        var pcmFloat = new byte[8];
        BitConverter.GetBytes(0.75f).CopyTo(pcmFloat, 0);
        BitConverter.GetBytes(-2f).CopyTo(pcmFloat, 4);
        var df = AudioDecoding.DecodeWav(Wav(3, 1, 24000, 32, pcmFloat), out error);
        Expect("float 32 decodes and clamps", df != null && df.Samples[0] == 0.75f && df.Samples[1] == -1f, error);

        var dx = AudioDecoding.DecodeWav(Wav(1, 2, 16000, 16, pcm16, extensible: true, oddChunk: true), out error);
        Expect("WAVE_FORMAT_EXTENSIBLE after an odd-sized chunk", dx != null && dx.Frames == 2 && Math.Abs(dx.Samples[0] - 0.5f) < 1e-4, error);

        var ds = AudioDecoding.DecodeWav(Wav(1, 2, 16000, 16, pcm16, streamingSize: true), out error);
        Expect("a streamed WAV (data size 0) reads to the end", ds != null && ds.Frames == 2, error);

        Expect("ADPCM is refused with a reason", AudioDecoding.DecodeWav(Wav(2, 1, 8000, 4, new byte[4]), out error) == null && error.StartsWith("unsupportedFormat"), error);
        Expect("a truncated header is refused", AudioDecoding.DecodeWav(Encoding.ASCII.GetBytes("RIFF\0\0\0\0WAVE"), out error) == null, error);
    }

    private static void TestSniffAndBase64()
    {
        Expect("ID3 → mp3", AudioDecoding.Sniff(new byte[] { (byte)'I', (byte)'D', (byte)'3', 4, 0 }) == AudioFormatKind.Mp3);
        Expect("MPEG frame sync → mp3", AudioDecoding.Sniff(new byte[] { 0xFF, 0xFB, 0x90, 0x00 }) == AudioFormatKind.Mp3);
        Expect("OggS → ogg", AudioDecoding.Sniff(Encoding.ASCII.GetBytes("OggS\0\0")) == AudioFormatKind.Ogg);
        Expect("text is unknown", AudioDecoding.Sniff(Encoding.ASCII.GetBytes("{\"error\":1}")) == AudioFormatKind.Unknown);
        Expect("type names", AudioDecoding.FromName("audio/mpeg") == AudioFormatKind.Mp3 && AudioDecoding.FromName("x.WAV") == AudioFormatKind.Wav && AudioDecoding.FromName("audio/ogg; codecs=opus") == AudioFormatKind.Ogg);

        var raw = new byte[] { 0, 1, 2, 250, 251, 252, 253 };
        var b64 = Convert.ToBase64String(raw);
        var back = AudioDecoding.DecodeBase64("data:audio/wav;base64," + b64.Substring(0, 4) + "\n " + b64.Substring(4), out var mime);
        Expect("data: URL with line breaks", back != null && back.Length == raw.Length && back[6] == 253 && mime == "audio/wav");
        var urlSafe = b64.Replace('+', '-').Replace('/', '_').TrimEnd('=');
        var back2 = AudioDecoding.DecodeBase64(urlSafe, out _);
        Expect("base64url without padding", back2 != null && back2.Length == raw.Length && back2[5] == 252);
        Expect("not base64 → null", AudioDecoding.DecodeBase64("hello world!", out _) == null);
    }

    private static void TestLipSync()
    {
        var silence = new float[512];
        Expect("silence is closed", LipSyncMath.Level(LipSyncMath.Rms(silence, silence.Length)) == 0);

        double LevelOfSine(double amplitude)
        {
            var s = new float[512];
            for (int i = 0; i < s.Length; i++) s[i] = (float)(amplitude * Math.Sin(2 * Math.PI * 220 * i / 16000.0));
            return LipSyncMath.Level(LipSyncMath.Rms(s, s.Length));
        }
        Expect("a loud voice opens fully", LevelOfSine(0.9) == 1, $"{LevelOfSine(0.9):F2}");
        // -30 dBFS 付近の声 (RMS ≈ 0.0316 → 振幅 ≈ 0.0447) は半分ほど
        double mid = LevelOfSine(0.0447);
        Expect("a quiet voice opens about half", mid > 0.4 && mid < 0.65, $"{mid:F2}");
        Expect("room noise (-60 dBFS) stays closed", LevelOfSine(0.0014) == 0);

        double open = LipSyncMath.Smooth(0, 1, 1 / 72.0);
        double close = 1 - LipSyncMath.Smooth(1, 0, 1 / 72.0);
        Expect("opening is quicker than closing", open > close, $"open {open:F2} vs close {close:F2}");
        Expect("smoothing settles", Math.Abs(Run(0, 1, 2.0) - 1) < 1e-3);

        static double Run(double v, double target, double seconds)
        {
            for (double t = 0; t < seconds; t += 1 / 72.0) v = LipSyncMath.Smooth(v, target, 1 / 72.0);
            return v;
        }
    }

    private static CameraPoseData Yaw(double degrees, double x = 0, double y = 0, double z = 0)
    {
        double h = degrees * Math.PI / 360;
        return new CameraPoseData { Px = x, Py = y, Pz = z, Qx = 0, Qy = Math.Sin(h), Qz = 0, Qw = Math.Cos(h) };
    }

    private static void TestCameraGeometry()
    {
        const double fx = 500, fy = 500, cx = 320, cy = 240;
        var front = Yaw(0, 0, 1.5, 0);

        Expect("straight ahead → image centre",
            CameraRegionMath.Project(front, fx, fy, cx, cy, 0, 1.5, 2, out var u, out var v, out var depth) && Math.Abs(u - cx) < 1e-9 && Math.Abs(v - cy) < 1e-9 && Math.Abs(depth - 2) < 1e-9);
        CameraRegionMath.Project(front, fx, fy, cx, cy, 0.4, 1.9, 2, out u, out v, out _);
        // 右 (+x) は右へ、上 (+y) は v が増える (行は下から上 = ColorImage / 認識と同じ)
        Expect("right is +u, up is +v (rows bottom-up)", Math.Abs(u - (cx + 100)) < 1e-9 && Math.Abs(v - (cy + 100)) < 1e-9, $"u={u:F1} v={v:F1}");
        Expect("behind the camera is not projected", !CameraRegionMath.Project(front, fx, fy, cx, cy, 0, 1.5, -1, out _, out _, out _));

        // 右を向いたカメラ (Unity の Euler(0, 90, 0)): ワールドの +X が正面
        var right = Yaw(90);
        CameraRegionMath.Project(right, fx, fy, cx, cy, 3, 0, 0, out u, out v, out depth);
        Expect("a camera turned right sees +X in the centre", Math.Abs(u - cx) < 1e-6 && Math.Abs(v - cy) < 1e-6 && Math.Abs(depth - 3) < 1e-9);
        CameraRegionMath.Project(right, fx, fy, cx, cy, 3, 0, -1, out u, out _, out _);
        Expect("…and -Z is to its right", u > cx, $"u={u:F1}");

        // 机 (0.5 m 四方) を 1 m 先から: 250 px 四方
        Expect("region around a point",
            CameraRegionMath.RegionAround(front, fx, fy, cx, cy, 640, 480, 0, 1.5, 1, 0.5, out var rect)
            && rect.X == 195 && rect.Width == 250 && rect.Y == 115 && rect.Height == 250, $"{rect.X},{rect.Y} {rect.Width}x{rect.Height}");
        Expect("region is clamped to the picture",
            CameraRegionMath.RegionAround(front, fx, fy, cx, cy, 640, 480, 0.5, 1.5, 1, 0.5, out rect)
            && rect.X + rect.Width == 640 && rect.X == 445, $"{rect.X} {rect.Width}");
        Expect("a region outside the picture is refused", !CameraRegionMath.RegionAround(front, fx, fy, cx, cy, 640, 480, 5, 1.5, 1, 0.5, out _));
        Expect("a region behind is refused", !CameraRegionMath.RegionAround(front, fx, fy, cx, cy, 640, 480, 0, 1.5, -1, 0.5, out _));

        // 切り出しと縮小
        int w = 4, h = 3;
        var rgb = new byte[w * h * 3];
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) rgb[(y * w + x) * 3] = (byte)(y * 10 + x);
        var crop = CameraRegionMath.CropRgb(rgb, w, h, new PixelRect { X = 1, Y = 1, Width = 2, Height = 2 });
        Expect("crop keeps rows bottom-up", crop[0] == 11 && crop[3] == 12 && crop[6] == 21 && crop[9] == 22);
        var flat = new byte[8 * 4 * 3];
        for (int i = 0; i < flat.Length; i += 3) flat[i] = (byte)((i / 3) % 8 < 4 ? 0 : 200);
        var small = CameraRegionMath.DownscaleRgb(flat, 8, 4, 2, out var sw, out var sh);
        Expect("downscale averages", sw == 2 && sh == 1 && small[0] == 0 && small[3] == 200, $"{sw}x{sh} {small[0]} {small[3]}");
        Expect("no upscale", CameraRegionMath.DownscaleRgb(flat, 8, 4, 100, out sw, out _) == flat && sw == 8);
    }

    private static void TestPersistentValues()
    {
        var rules = new List<string> { "memory.", "user.name" };
        Expect("prefix rule", PersistentValues.IsPersisted("memory.episodes", rules) && PersistentValues.IsPersisted("Memory.count", rules));
        Expect("exact rule", PersistentValues.IsPersisted("user.name", rules) && !PersistentValues.IsPersisted("user.names", rules) && !PersistentValues.IsPersisted("user", rules));
        Expect("the prefix itself without a dot is not a key", !PersistentValues.IsPersisted("memory", rules));
        Expect("forget a prefix", PersistentValues.MatchesForget("memory.x", "memory.") && !PersistentValues.MatchesForget("memoryx", "memory."));
        Expect("forget a key and its children", PersistentValues.MatchesForget("user.name", "user") && PersistentValues.MatchesForget("user", "user") && !PersistentValues.MatchesForget("username", "user"));

        var snapshot = new Dictionary<string, object>
        {
            ["memory.episodes"] = new List<object> { new Dictionary<string, object> { ["event"] = "solved", ["confidence"] = 1.0 } },
            ["memory.mood"] = -0.25,
            ["memory.gone"] = null,
            ["chat.input"] = "draft",
            ["user.name"] = "りん",
        };
        var picked = PersistentValues.Select(snapshot, rules);
        Expect("only listed, non-null keys are saved", picked.Count == 3 && !picked.ContainsKey("chat.input") && !picked.ContainsKey("memory.gone"));
        var text = PersistentValues.Serialize(picked, DateTime.UtcNow);
        var back = PersistentValues.Deserialize(text, out var error);
        Expect("file round trip", back != null && (double)back["memory.mood"] == -0.25 && (string)back["user.name"] == "りん"
            && back["memory.episodes"] is List<object> list && list[0] is Dictionary<string, object> ep && (string)ep["event"] == "solved", error);
        Expect("a broken file is reported, not thrown", PersistentValues.Deserialize("{\"values\": [", out error) == null && error != null);
        Expect("an empty file is reported", PersistentValues.Deserialize("", out error) == null && error == "empty");
    }

    private static void TestFileStorageBackend()
    {
        var dir = Path.Combine(Path.GetTempPath(), "arsist-storage-check-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var file = Path.Combine(dir, "arsist-storage.json");
            IArsistStorageBackend backend = new ArsistFileStorageBackend(file);
            Expect("nothing saved yet reads as null", backend.Read() == null);
            backend.Write("{\"values\":{\"a\":1}}");
            Expect("written text reads back", backend.Read() == "{\"values\":{\"a\":1}}");
            backend.Write("{\"values\":{\"a\":2}}");
            Expect("a second write replaces the first", backend.Read() == "{\"values\":{\"a\":2}}");
            Expect("no temporary file is left behind", !File.Exists(file + ".tmp"));
            backend.KeepUnreadable("{broken");
            Expect("unreadable text is kept aside, the file untouched",
                File.ReadAllText(file + ".broken") == "{broken" && backend.Read() == "{\"values\":{\"a\":2}}");
        }
        finally
        {
            try { Directory.Delete(dir, true); } catch (Exception) { }
        }
    }

    private static void TestDottedNamesInStore()
    {
        var store = ArsistDataStore.Instance;
        store.Clear();
        store.SetValue("memory.episodes", new List<object> { new Dictionary<string, object> { ["event"] = "solved" } });
        Expect("bind into a value stored under a dotted name",
            store.TryGetValueByPath("memory.episodes[0].event", out var ev) && (string)ev == "solved");
        store.SetValue("memory", new Dictionary<string, object> { ["episodes"] = "nested" });
        Expect("the longest stored name wins", store.TryGetValueByPath("memory.episodes[0].event", out ev) && (string)ev == "solved");
        Expect("plain nesting still works", store.TryGetValueByPath("memory.episodes", out var whole) && whole is List<object>);
        store.Clear();
    }

    public static int Run()
    {
        _failures = 0;
        Console.WriteLine("\n== script runtime (audio / camera / storage) ==");
        TestWav();
        TestSniffAndBase64();
        TestLipSync();
        TestCameraGeometry();
        TestPersistentValues();
        TestFileStorageBackend();
        TestDottedNamesInStore();
        return _failures;
    }
}
