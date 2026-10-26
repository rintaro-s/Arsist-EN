// MJPEG の区切りの解析 (Runtime/Media/MjpegParser.cs) の検証。doc/23-cameras-media.md。
//
// PC の画面の配信 (products/ScreenCast) と、よくある IP カメラの配信を、届き方を変えて (1 バイトずつ・
// 区切りの途中で切れる・途中から読み始める) 食わせ、JPEG が 1 枚も欠けず・混ざらずに出てくるかを見る。
// 実機では「画が固まる」「たまに崩れる」としか見えないので、ここで固定する。
using System;
using System.Collections.Generic;
using System.Text;
using Arsist.Runtime.Media;

internal static class MjpegChecks
{
    private static int _failures;

    private static void Expect(string label, bool ok, string detail = null)
    {
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}{(detail != null ? $": {detail}" : "")}");
        if (!ok) _failures++;
    }

    /// <summary>それらしい JPEG (SOI, APP0, EXIF のサムネイル入り APP1, SOS, 圧縮データ, EOI)。</summary>
    private static byte[] FakeJpeg(int seed, int bodyBytes, bool withThumbnail = false, bool withBoundaryInside = false)
    {
        var rng = new Random(seed);
        var list = new List<byte> { 0xFF, 0xD8 };
        // APP0 (JFIF)
        list.AddRange(new byte[] { 0xFF, 0xE0, 0x00, 0x10, (byte)'J', (byte)'F', (byte)'I', (byte)'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0 });
        if (withThumbnail)
        {
            // APP1 の中に小さな JPEG (FF D8 … FF D9) が入っている
            var thumb = new byte[] { 0xFF, 0xD8, 0xFF, 0xD9, 0x11, 0x22 };
            int len = 2 + thumb.Length;
            list.Add(0xFF); list.Add(0xE1); list.Add((byte)(len >> 8)); list.Add((byte)len);
            list.AddRange(thumb);
        }
        // SOS
        list.AddRange(new byte[] { 0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0x3F, 0 });
        for (int i = 0; i < bodyBytes; i++)
        {
            byte b = (byte)rng.Next(0, 256);
            list.Add(b);
            if (b == 0xFF) list.Add(0x00); // 圧縮データの中の FF は FF 00 になる
        }
        if (withBoundaryInside)
        {
            list.AddRange(Encoding.ASCII.GetBytes("\r\n--arsistframe\r\n"));
        }
        list.AddRange(new byte[] { 0xFF, 0xD9 });
        return list.ToArray();
    }

    private static byte[] Multipart(string boundary, IList<byte[]> frames, bool contentLength, string newline = "\r\n", bool preamble = false)
    {
        var list = new List<byte>();
        if (preamble) list.AddRange(Encoding.ASCII.GetBytes("this is a preamble" + newline));
        foreach (var f in frames)
        {
            var head = "--" + boundary + newline + "Content-Type: image/jpeg" + newline;
            if (contentLength) head += "Content-Length: " + f.Length + newline;
            head += newline;
            list.AddRange(Encoding.ASCII.GetBytes(head));
            list.AddRange(f);
            list.AddRange(Encoding.ASCII.GetBytes(newline));
        }
        return list.ToArray();
    }

    private static List<byte[]> FeedInChunks(MjpegParser parser, byte[] data, int chunk, int seed = 0)
    {
        var rng = new Random(seed);
        var got = new List<byte[]>();
        int p = 0;
        while (p < data.Length)
        {
            int n = chunk > 0 ? chunk : rng.Next(1, 4000);
            n = Math.Min(n, data.Length - p);
            parser.Feed(data, p, n);
            p += n;
            byte[] f;
            while ((f = parser.TakeFrame()) != null) got.Add(f);
        }
        return got;
    }

    private static bool Same(byte[] a, byte[] b)
    {
        if (a == null || b == null || a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
        return true;
    }

    private static bool AllSame(IList<byte[]> expected, IList<byte[]> got, int skipFirst = 0)
    {
        if (got.Count != expected.Count - skipFirst) return false;
        for (int i = 0; i < got.Count; i++) if (!Same(expected[i + skipFirst], got[i])) return false;
        return true;
    }

    private static void TestScreenCastFormat()
    {
        // products/ScreenCast: boundary=arsistframe、Content-Length あり。最後の枚はまだ次の区切りが来ていない
        var frames = new List<byte[]> { FakeJpeg(1, 3000), FakeJpeg(2, 50), FakeJpeg(3, 12000, withBoundaryInside: true) };
        var data = Multipart("arsistframe", frames, contentLength: true);
        foreach (var chunk in new[] { 1, 7, 64, 100000, 0 })
        {
            var parser = new MjpegParser("multipart/x-mixed-replace; boundary=arsistframe");
            var got = FeedInChunks(parser, data, chunk, seed: chunk);
            Expect($"Content-Length parts, chunk={(chunk == 0 ? "random" : chunk.ToString())}", AllSame(frames, got), $"{got.Count}/{frames.Count} frames");
        }
    }

    private static void TestNoContentLength()
    {
        // Content-Length の無い配信: 次の区切りで切る。最後の 1 枚は次の区切りが来るまで出ない
        var frames = new List<byte[]> { FakeJpeg(4, 2000), FakeJpeg(5, 9000), FakeJpeg(6, 10) };
        var data = Multipart("myboundary", frames, contentLength: false);
        var tail = Encoding.ASCII.GetBytes("--myboundary\r\n");
        var all = new byte[data.Length + tail.Length];
        Buffer.BlockCopy(data, 0, all, 0, data.Length);
        Buffer.BlockCopy(tail, 0, all, data.Length, tail.Length);
        foreach (var chunk in new[] { 1, 13, 0 })
        {
            var parser = new MjpegParser("myboundary");
            var got = FeedInChunks(parser, all, chunk, seed: 3);
            Expect($"boundary-delimited parts, chunk={(chunk == 0 ? "random" : chunk.ToString())}", AllSame(frames, got), $"{got.Count}/{frames.Count} frames");
        }
    }

    private static void TestBoundaryLearnedFromStream()
    {
        // Content-Type ヘッダーが取れなかった (区切りが分からない) ときは、最初の "--xxx" の行を使う。\n だけの改行も
        var frames = new List<byte[]> { FakeJpeg(7, 500), FakeJpeg(8, 700) };
        var data = Multipart("--weird_boundary-123", frames, contentLength: true, newline: "\n", preamble: true);
        var parser = new MjpegParser();
        var got = FeedInChunks(parser, data, 0, seed: 9);
        Expect("boundary learned from the first dash line (LF only, preamble)", AllSame(frames, got), $"{got.Count}/{frames.Count}, boundary={parser.Boundary}");
    }

    private static void TestJoinMidStream()
    {
        // つなぎ直して途中から読み始めた: 最初の半端な部分は捨て、次の区切りから正しく出る
        var frames = new List<byte[]> { FakeJpeg(10, 4000), FakeJpeg(11, 4000), FakeJpeg(12, 4000) };
        var data = Multipart("arsistframe", frames, contentLength: true);
        int cut = 2500;
        var partial = new byte[data.Length - cut];
        Buffer.BlockCopy(data, cut, partial, 0, partial.Length);
        var parser = new MjpegParser("arsistframe");
        var got = FeedInChunks(parser, partial, 0, seed: 4);
        Expect("joining mid-stream drops the broken first part only", AllSame(frames, got, skipFirst: 1), $"{got.Count} frames, skipped {parser.BytesSkipped} bytes");
    }

    private static void TestRawJpegConcatenation()
    {
        // 区切りの無い配信 (JPEG をそのまま並べる)。EXIF のサムネイルの FF D9 で切らない
        var frames = new List<byte[]> { FakeJpeg(13, 800, withThumbnail: true), FakeJpeg(14, 300, withThumbnail: true), FakeJpeg(15, 1000) };
        var list = new List<byte>();
        foreach (var f in frames) list.AddRange(f);
        var parser = new MjpegParser();
        var got = FeedInChunks(parser, list.ToArray(), 0, seed: 5);
        Expect("raw concatenated JPEGs (thumbnail inside)", AllSame(frames, got), $"{got.Count}/{frames.Count}");
    }

    private static void TestTakeLatest()
    {
        var frames = new List<byte[]> { FakeJpeg(16, 100), FakeJpeg(17, 100), FakeJpeg(18, 100) };
        var parser = new MjpegParser("arsistframe");
        parser.Feed(Multipart("arsistframe", frames, contentLength: true));
        var latest = parser.TakeLatest();
        Expect("TakeLatest returns the newest frame and empties the queue", Same(latest, frames[2]) && parser.QueuedFrames == 0);
    }

    private static void TestGarbageIsDropped()
    {
        // 区切りの後が JPEG でない部分 (テキストのエラーなど) は出さない
        var parser = new MjpegParser("b");
        var bad = Encoding.ASCII.GetBytes("--b\r\nContent-Type: text/plain\r\n\r\nnot a picture\r\n");
        var good = Multipart("b", new List<byte[]> { FakeJpeg(19, 64) }, contentLength: true);
        parser.Feed(bad);
        parser.Feed(good);
        var got = new List<byte[]>();
        byte[] f;
        while ((f = parser.TakeFrame()) != null) got.Add(f);
        Expect("non-JPEG parts are not emitted", got.Count == 1 && got[0][0] == 0xFF && got[0][1] == 0xD8, $"{got.Count} frames");
    }

    private static void TestBoundaryExtraction()
    {
        Expect("boundary from Content-Type", MjpegParser.ExtractBoundary("multipart/x-mixed-replace; boundary=arsistframe") == "arsistframe");
        Expect("quoted boundary with a trailing parameter", MjpegParser.ExtractBoundary("multipart/x-mixed-replace;boundary=\"--abc\"; charset=x") == "abc");
        Expect("a Content-Type without a boundary gives none", MjpegParser.ExtractBoundary("image/jpeg") == null);
        Expect("a bare boundary is used as is", MjpegParser.ExtractBoundary("--frame") == "frame");
    }

    private static void TestUrlTemplate()
    {
        var values = new Dictionary<string, string> { ["pc.address"] = "192.168.1.5:8090", ["empty"] = "" };
        Func<string, string> lookup = k => values.TryGetValue(k, out var v) ? v : null;
        Expect("{store:key} is replaced", MediaUrlTemplate.Resolve("http://{store:pc.address}/stream/slides", lookup) == "http://192.168.1.5:8090/stream/slides");
        Expect("http:// is added when missing", MediaUrlTemplate.Resolve("{store:pc.address}/stream/notes", lookup) == "http://192.168.1.5:8090/stream/notes");
        Expect("an empty value means: do not connect yet", MediaUrlTemplate.Resolve("http://{store:empty}/s", lookup) == null);
        Expect("a missing key means: do not connect yet", MediaUrlTemplate.Resolve("http://{store:nope}/s", lookup) == null);
        Expect("a plain URL is unchanged", MediaUrlTemplate.Resolve("http://10.0.0.2:8090/stream/slides?token=x", lookup) == "http://10.0.0.2:8090/stream/slides?token=x");
    }

    public static int Run()
    {
        Console.WriteLine();
        Console.WriteLine("== MJPEG stream parser (Runtime/Media/MjpegParser.cs) ==");
        TestScreenCastFormat();
        TestNoContentLength();
        TestBoundaryLearnedFromStream();
        TestJoinMidStream();
        TestRawJpegConcatenation();
        TestTakeLatest();
        TestGarbageIsDropped();
        TestBoundaryExtraction();
        TestUrlTemplate();
        return _failures;
    }
}
