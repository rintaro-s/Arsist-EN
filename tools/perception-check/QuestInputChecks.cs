// 拡張機能 quest-input の、実機を使わずに確かめられる部分。
//
//   - 手のジェスチャー (HandGestureMath): 合成した手の形 (指ごとの曲げ角) から
//     グー / パー / 指差し / ピース / ピンチ / サムズアップを正しく言えるか
//   - マイク (MicMath): 音量、話し始め / 話し終わり、サンプルレート変換、WAV、輪っかのバッファ
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
        return _failures;
    }
}
