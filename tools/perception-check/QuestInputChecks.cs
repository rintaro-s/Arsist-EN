// 拡張機能 quest-input の、実機を使わずに確かめられる部分。
//
//   - 手のジェスチャー (HandGestureMath): 合成した手の形 (指ごとの曲げ角) から
//     グー / パー / 指差し / ピース / ピンチ / サムズアップを正しく言えるか
//   - マイク (MicMath): 音量、話し始め / 話し終わり、サンプルレート変換、WAV、輪っかのバッファ
//   - 録画 (RecorderMath): 一時停止を引いた時刻、fps への間引き、音の時刻とずれの直し、大きさ、PCM16、行の反転
//
// どちらも実機では「グーがパーに見える」「話しても反応しない」としか分からないので、ここで固定する。
using System;
using Arsist.Extensions.QuestInput;

internal static class QuestInputChecks
{
    private static int _failures;

    private static void Expect(string label, bool ok, string detail = null)
    {
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}{(detail != null ? $": {detail}" : "")}");
        if (!ok) _failures++;
    }

    // ---- 合成した手 ----
    // 手首が原点、指は +Z へ伸び、手のひらは -Y を向く (曲げると指先が -Y へ巻き込む)。

    private static readonly float[] FingerX = { 0.035f, 0.02f, 0f, -0.018f, -0.034f }; // 親指 … 小指

    /// <summary>pip: 根元の関節 (MCP) / 第二関節 / 第一関節 の曲げ角 (度)。</summary>
    private static void AddFinger(V3[] j, int metacarpal, int fingerIndex, float mcp, float pip, float dip, float[] lengths)
    {
        var x = FingerX[fingerIndex];
        j[metacarpal] = new V3(x, 0, 0.02f);
        j[metacarpal + 1] = new V3(x, 0, 0.09f); // 基節の付け根 (指の付け根の関節)
        var pos = j[metacarpal + 1];
        float angle = 0;
        var bends = new[] { mcp, pip, dip };
        for (int s = 0; s < 3; s++)
        {
            angle += bends[s];
            var rad = angle * Math.PI / 180.0;
            var dir = new V3(0, (float)-Math.Sin(rad), (float)Math.Cos(rad));
            pos = pos + dir * lengths[s];
            j[metacarpal + 2 + s] = pos;
        }
    }

    private static V3[] Hand(float[] index, float[] middle, float[] ring, float[] little, Func<V3[], V3[]> thumb = null)
    {
        var j = new V3[Joint.Count];
        j[Joint.Wrist] = new V3(0, 0, 0);
        j[Joint.Palm] = new V3(0, 0, 0.05f);
        var lengths = new[] { 0.045f, 0.026f, 0.02f };
        AddFinger(j, Joint.IndexMetacarpal, 1, index[0], index[1], index[2], lengths);
        AddFinger(j, Joint.MiddleMetacarpal, 2, middle[0], middle[1], middle[2], lengths);
        AddFinger(j, Joint.RingMetacarpal, 3, ring[0], ring[1], ring[2], lengths);
        AddFinger(j, Joint.LittleMetacarpal, 4, little[0], little[1], little[2], new[] { 0.035f, 0.02f, 0.018f });
        // 親指: 既定は横に伸ばす (+X 寄り、手のひら側)
        j[Joint.ThumbMetacarpal] = new V3(0.02f, -0.01f, 0.02f);
        j[Joint.ThumbProximal] = new V3(0.045f, -0.015f, 0.045f);
        j[Joint.ThumbDistal] = new V3(0.065f, -0.018f, 0.065f);
        j[Joint.ThumbTip] = new V3(0.08f, -0.02f, 0.08f);
        return thumb != null ? thumb(j) : j;
    }

    private static readonly float[] Straight = { 0, 0, 0 };
    private static readonly float[] Curled = { 80, 100, 60 };
    private static readonly float[] Half = { 40, 50, 10 };
    private static readonly V3 Up = new V3(0, 1, 0);

    private static string Gesture(V3[] j) => HandGestureMath.Classify(j, HandGestureMath.IsPinching(j, false), Up);

    private static void TestGestures()
    {
        var open = Hand(Straight, Straight, Straight, Straight);
        Expect("open hand", Gesture(open) == "open", Gesture(open));
        Expect("open hand: index is extended", HandGestureMath.IsExtended(open, Finger.Index), $"{HandGestureMath.Bend(open, Finger.Index):F0}°");

        var fist = Hand(Curled, Curled, Curled, Curled);
        Expect("fist", Gesture(fist) == "fist", $"{Gesture(fist)} (index bend {HandGestureMath.Bend(fist, Finger.Index):F0}°)");

        var point = Hand(Straight, Curled, Curled, Curled);
        Expect("point", Gesture(point) == "point", Gesture(point));

        var peace = Hand(Straight, Straight, Curled, Curled);
        Expect("peace", Gesture(peace) == "peace", Gesture(peace));

        // 親指の先を人差し指の先に付ける (他の指は開いたまま)
        var pinch = Hand(Straight, Straight, Straight, Straight, j =>
        {
            var t = j[Joint.IndexTip];
            j[Joint.ThumbTip] = new V3(t.X + 0.008f, t.Y - 0.004f, t.Z);
            j[Joint.ThumbDistal] = new V3(t.X + 0.02f, t.Y - 0.015f, t.Z - 0.02f);
            return j;
        });
        Expect("pinch", Gesture(pinch) == "pinch", $"{Gesture(pinch)} (gap {HandGestureMath.PinchDistance(pinch) * 100:F1} cm)");
        Expect("pinch strength is full when touching", HandGestureMath.PinchStrength(pinch) > 0.99f);
        Expect("pinch strength is zero on an open hand", HandGestureMath.PinchStrength(open) < 0.01f,
            $"{HandGestureMath.PinchStrength(open):F2} (gap {HandGestureMath.PinchDistance(open) * 100:F1} cm)");

        // 握って親指を真上に
        var thumbsUp = Hand(Curled, Curled, Curled, Curled, j =>
        {
            j[Joint.ThumbMetacarpal] = new V3(0.03f, 0.0f, 0.04f);
            j[Joint.ThumbProximal] = new V3(0.03f, 0.03f, 0.045f);
            j[Joint.ThumbDistal] = new V3(0.03f, 0.055f, 0.047f);
            j[Joint.ThumbTip] = new V3(0.03f, 0.075f, 0.048f);
            return j;
        });
        Expect("thumbs up", Gesture(thumbsUp) == "thumbsUp", Gesture(thumbsUp));
        // 同じ形で手を下に向けたら (= 上が逆) サムズアップではない
        Expect("thumbs down is a fist, not thumbs up",
            HandGestureMath.Classify(thumbsUp, false, new V3(0, -1, 0)) == "fist");

        // 中途半端に曲げた指が混じると、どれとも言わない (誤検出しない)
        var vague = Hand(Half, Half, Straight, Straight);
        Expect("half-bent fingers are not a gesture", Gesture(vague) == "none",
            $"{Gesture(vague)} (index bend {HandGestureMath.Bend(vague, Finger.Index):F0}°)");

        // 手の大きさが違っても同じ (角度で見ているため)
        var bigFist = Scale(fist, 1.3f);
        Expect("a larger hand makes the same fist", Gesture(bigFist) == "fist");
    }

    private static V3[] Scale(V3[] j, float s)
    {
        var r = new V3[j.Length];
        for (int i = 0; i < j.Length; i++) r[i] = j[i] * s;
        return r;
    }

    private static void TestPinchHysteresis()
    {
        var j = Hand(Straight, Straight, Straight, Straight, h =>
        {
            var t = h[Joint.IndexTip];
            h[Joint.ThumbTip] = new V3(t.X + 0.028f, t.Y, t.Z); // 2.8 cm: 始まりと終わりの間
            return h;
        });
        Expect("a 2.8 cm gap does not start a pinch", !HandGestureMath.IsPinching(j, false));
        Expect("a 2.8 cm gap keeps a pinch that already started", HandGestureMath.IsPinching(j, true));
    }

    // ---- マイク ----

    private static float[] Sine(float amplitude, int rate, float seconds, float hz = 220f)
    {
        var s = new float[(int)(rate * seconds)];
        for (int i = 0; i < s.Length; i++) s[i] = amplitude * (float)Math.Sin(2 * Math.PI * hz * i / rate);
        return s;
    }

    private static void TestLevels()
    {
        var sine = Sine(0.5f, 16000, 1f);
        var rms = MicMath.Rms(sine, 0, sine.Length);
        Expect("rms of a sine is amplitude/√2", Math.Abs(rms - 0.3536f) < 0.002f, $"{rms:F4}");
        Expect("full scale is level 1", Math.Abs(MicMath.Level(1f) - 1f) < 1e-4f);
        Expect("-30 dBFS is level 0.5", Math.Abs(MicMath.Level(0.03162f) - 0.5f) < 0.01f, $"{MicMath.Level(0.03162f):F3}");
        Expect("-60 dBFS and below is silence", MicMath.Level(0.001f) < 1e-4f && MicMath.Level(0.0005f) == 0f && MicMath.Level(0f) == 0f);
    }

    private static void TestVoiceActivity()
    {
        var vad = new VoiceActivity { Threshold = 0.45f, StartSeconds = 0.12f, EndSeconds = 0.7f, MaxSeconds = 15f };
        const float dt = 0.02f;
        int starts = 0, ends = 0;
        float t = 0, startedAt = -1, endedAt = -1;
        void Feed(float level, float seconds)
        {
            for (float e = 0; e < seconds - 1e-4f; e += dt)
            {
                var r = vad.Update(level, dt);
                t += dt;
                if (r > 0) { starts++; startedAt = t; }
                if (r < 0) { ends++; endedAt = t; }
            }
        }

        Feed(0.1f, 1f);                       // 静か
        Feed(0.8f, 0.06f);                    // 咳 (短い)
        Feed(0.1f, 0.5f);
        Expect("a short noise does not start speech", starts == 0);

        float speechAt = t;
        Feed(0.8f, 0.6f);                     // 話す
        Expect("speech starts after ~0.12 s of voice", starts == 1 && Math.Abs(startedAt - speechAt - 0.12f) < 0.03f,
            $"after {startedAt - speechAt:F2} s");
        Feed(0.1f, 0.3f);                     // 言葉の切れ目
        Feed(0.8f, 0.5f);
        Expect("a short pause does not end speech", ends == 0 && vad.Speaking);

        float silenceAt = t;
        Feed(0.1f, 1.2f);
        Expect("speech ends after ~0.7 s of silence", ends == 1 && Math.Abs(endedAt - silenceAt - 0.7f) < 0.03f,
            $"after {endedAt - silenceAt:F2} s");

        var longTalk = new VoiceActivity { MaxSeconds = 2f };
        int forced = 0;
        for (int i = 0; i < 200; i++) if (longTalk.Update(0.9f, dt) < 0) forced++;
        Expect("talking without a pause is cut at maxSeconds", forced >= 1);
    }

    private static void TestResampleAndWav()
    {
        var src = Sine(0.5f, 48000, 0.5f);
        var dst = MicMath.Resample(src, 48000, 16000);
        Expect("48 kHz → 16 kHz keeps the duration", dst.Length == src.Length / 3, $"{dst.Length} vs {src.Length / 3}");
        Expect("resampling keeps the loudness", Math.Abs(MicMath.Rms(dst, 0, dst.Length) - MicMath.Rms(src, 0, src.Length)) < 0.01f);

        var wav = MicMath.EncodeWav16(new[] { 0f, 1f, -1f, 2f }, 16000);
        string Ascii(int at) => System.Text.Encoding.ASCII.GetString(wav, at, 4);
        Expect("wav header", Ascii(0) == "RIFF" && Ascii(8) == "WAVE" && Ascii(12) == "fmt " && Ascii(36) == "data");
        Expect("wav sizes", BitConverter.ToInt32(wav, 4) == 36 + 8 && BitConverter.ToInt32(wav, 40) == 8 && wav.Length == 44 + 8);
        Expect("wav sample rate", BitConverter.ToInt32(wav, 24) == 16000 && BitConverter.ToInt16(wav, 34) == 16);
        Expect("wav samples are clamped 16-bit",
            BitConverter.ToInt16(wav, 44) == 0 && BitConverter.ToInt16(wav, 46) == 32767 &&
            BitConverter.ToInt16(wav, 48) == -32767 && BitConverter.ToInt16(wav, 50) == 32767);
    }

    private static void TestRing()
    {
        var ring = new SampleRing(10);
        var data = new float[15];
        for (int i = 0; i < data.Length; i++) data[i] = i;
        ring.Append(data, 0, 7);
        ring.Append(data, 7, 8);
        var all = ring.Range(0, ring.Written);
        Expect("ring keeps only the newest samples", all.Length == 10 && all[0] == 5 && all[9] == 14, string.Join(",", all));
        var mid = ring.Range(8, 12);
        Expect("ring returns a range by position", mid.Length == 4 && mid[0] == 8 && mid[3] == 11);
        Expect("an empty range is empty", ring.Range(12, 12).Length == 0);
    }


    // ---- 録画 ----

    private static void TestRecorderClock()
    {
        var c = new RecorderClock();
        Expect("clock is 0 before it begins", c.Micros(5) == 0);
        c.Begin(10);
        Expect("clock counts from the start", c.Micros(12.5) == 2_500_000, c.Micros(12.5).ToString());
        c.Pause(13);
        Expect("clock stands still while paused", c.Micros(20) == 3_000_000, c.Micros(20).ToString());
        c.Resume(20);
        Expect("paused time is not counted", c.Micros(21) == 4_000_000, c.Micros(21).ToString());
        c.Pause(22); c.Pause(25); c.Resume(26); c.Resume(30);
        Expect("double pause / resume is harmless", c.Micros(27) == 6_000_000, c.Micros(27).ToString());
    }

    private static void TestFramePacer()
    {
        // カメラ 72 Hz → 録画 30 fps: 1 秒で 30 枚前後
        var p = new FramePacer(30);
        int taken = 0;
        for (int i = 0; i < 72; i++) if (p.Due(i / 72.0)) taken++;
        Expect("72 Hz camera -> 30 fps", taken >= 29 && taken <= 31, taken.ToString());

        // 揺れのある 30 Hz → 30 fps: 落とさない
        p = new FramePacer(30);
        taken = 0;
        var rnd = new Random(1);
        for (int i = 0; i < 300; i++) if (p.Due(i / 30.0 + (rnd.NextDouble() - 0.5) * 0.008)) taken++;
        Expect("jittery 30 Hz camera keeps every frame", taken == 300, taken.ToString());

        // 引っかかったあと、まとめて受けない
        p = new FramePacer(30);
        p.Due(0); p.Due(1 / 30.0);
        Expect("after a stall the next frame is taken", p.Due(1.0));
        Expect("but no burst right after", !p.Due(1.0 + 0.005));
        Expect("and the rhythm continues", p.Due(1.0 + 1 / 30.0));
    }

    private static void TestAudioClock()
    {
        // 16 kHz、1 フレーム 16.7 ms ごとに 267 サンプル: 時刻はサンプル数どおりにつながる
        var a = new AudioClock(16000);
        long first = a.Next(267, 16_687);
        long second = a.Next(267, 33_375);
        Expect("first chunk starts at wall - its length", Math.Abs(first - (16_687 - 16_687)) <= 1, first.ToString());
        Expect("audio pts follow the sample count", second - first == 267 * 1_000_000L / 16000, (second - first).ToString());

        // マイクの時計が 1% 遅い: いずれ合わせ直し、ずれは MaxDrift 以内に保たれる
        a = new AudioClock(16000);
        long worst = 0, last = -1;
        bool monotonic = true;
        for (int i = 1; i <= 3000; i++)
        {
            long wall = i * 20_000L;               // 20 ms ごと
            long pts = a.Next(317, wall);          // 本当は 320 サンプル届くはず
            if (pts < 0) continue;
            if (pts < last) monotonic = false;
            last = pts;
            worst = Math.Max(worst, Math.Abs(pts + 317 * 1_000_000L / 16000 - wall));
        }
        Expect("slow mic clock is pulled back within the drift limit", worst <= AudioClock.MaxDriftMicros + 20_000, worst.ToString());
        Expect("audio pts never go backwards", monotonic);

        // 進みすぎた塊は捨てる
        a = new AudioClock(16000);
        a.Next(1600, 100_000);
        Expect("a chunk far ahead of the wall clock is dropped", a.Next(16000, 150_000) == -1);
    }

    private static void TestRecorderSizes()
    {
        RecorderMath.FitSize(1920, 1080, 0, 0, out var w, out var h);
        Expect("1920x1080 stays", w == 1920 && h == 1080, $"{w}x{h}");
        RecorderMath.FitSize(1920, 1080, 1280, 0, out w, out h);
        Expect("width only keeps the aspect", w == 1280 && h == 720, $"{w}x{h}");
        RecorderMath.FitSize(1000, 563, 0, 0, out w, out h);
        Expect("width is a multiple of 16, height even", w == 992 && h == 562, $"{w}x{h}");
        RecorderMath.FitSize(8000, 4000, 0, 0, out w, out h);
        Expect("capped at 3840", w == 3840 && h == 1920, $"{w}x{h}");
        RecorderMath.FitSize(4, 4, 0, 0, out w, out h);
        Expect("at least 16", w == 16 && h == 16, $"{w}x{h}");
    }

    private static void TestRecorderBytes()
    {
        var pcm = new byte[8];
        int n = RecorderMath.ToPcm16(new[] { 0f, 1f, -1f, 2f }, 0, 4, pcm);
        Expect("PCM16 bytes", n == 8
            && BitConverter.ToInt16(pcm, 0) == 0 && BitConverter.ToInt16(pcm, 2) == 32767
            && BitConverter.ToInt16(pcm, 4) == -32767 && BitConverter.ToInt16(pcm, 6) == 32767);
        Expect("PCM16 stops at the buffer", RecorderMath.ToPcm16(new float[10], 0, 10, new byte[6]) == 6);

        var px = new byte[] { 1, 1, 2, 2, 3, 3 };
        RecorderMath.FlipRows(px, 2, 3);
        Expect("rows flip", px[0] == 3 && px[2] == 2 && px[4] == 1, string.Join(",", px));

        Expect("file name", RecorderMath.FileName(new DateTime(2026, 10, 25, 14, 5, 9), "Arsist", "mp4") == "Arsist_20261025_140509.mp4");
        Expect("folder names lose path characters", RecorderMath.SafeName("../My:Clips/", "Arsist") == "MyClips"
            && RecorderMath.SafeName("  ", "Arsist") == "Arsist", RecorderMath.SafeName("../My:Clips/", "Arsist"));
    }

    public static int Run()
    {
        Console.WriteLine("\n--- quest-input: hand gestures ---");
        TestGestures();
        TestPinchHysteresis();
        Console.WriteLine("\n--- quest-input: microphone ---");
        TestLevels();
        TestVoiceActivity();
        TestResampleAndWav();
        TestRing();
        Console.WriteLine("\n--- quest-input: recorder ---");
        TestRecorderClock();
        TestFramePacer();
        TestAudioClock();
        TestRecorderSizes();
        TestRecorderBytes();
        return _failures;
    }
}
