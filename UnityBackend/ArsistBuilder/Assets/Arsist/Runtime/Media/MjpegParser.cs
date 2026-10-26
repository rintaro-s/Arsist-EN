// ==============================================
// Arsist Engine - Media: MJPEG の区切りの解析 (UnityEngine 非依存)
// Assets/Arsist/Runtime/Media/MjpegParser.cs
//
// multipart/x-mixed-replace で届くバイト列から、JPEG 1 枚ずつを取り出す。doc/23-cameras-media.md。
// tools/perception-check (MjpegChecks) が `npm run test:perception` で確かめる。
//
//   --<boundary>\r\n
//   Content-Type: image/jpeg\r\n
//   Content-Length: 12345\r\n          (無いこともある)
//   \r\n
//   <JPEG>\r\n
//   --<boundary>\r\n …
//
// - Content-Length があればそのバイト数だけ取る (JPEG の中に区切りと同じ並びがあっても切れない)。
// - 無ければ次の区切りの手前まで。区切りが分からない (ヘッダーで来なかった) ときは、
//   最初に見えた "--xxx" の行を区切りとして使う。
// - 区切りの無い「JPEG をそのまま並べただけ」の配信 (一部の IP カメラ) は SOI (FF D8) 〜 EOI (FF D9) で切る。
// - 途中から読み始めても (つなぎ直し)、壊れた部分は捨てて次の区切りから続ける。
//
// 届いた分を Feed し、TakeFrame で取り出す。古いフレームは呼ぶ側が捨てる (最新だけ見せる)。
// スレッド: 1 つのインスタンスを同時に複数のスレッドから触らないこと (呼ぶ側で 1 本にする)。
// ==============================================

using System;
using System.Collections.Generic;
using System.Text;

namespace Arsist.Runtime.Media
{
    public sealed class MjpegParser
    {
        /// <summary>1 枚の上限。これを超えたら壊れた配信とみなして捨てる。</summary>
        public const int MaxFrameBytes = 16 * 1024 * 1024;
        private const int MaxHeaderBytes = 8 * 1024;

        private byte[] _buf = new byte[64 * 1024];
        private int _start, _end;
        private byte[] _boundaryLine;          // "--" + boundary
        private readonly Queue<byte[]> _frames = new Queue<byte[]>();
        private int _pendingLength = -1;       // ヘッダーを読み終えて本体を待っているときの Content-Length (-1 = なし)
        private bool _inBody;                  // ヘッダーを読み終えた
        private bool _rawJpeg;                 // 区切りの無い配信

        /// <summary>取り出した枚数 (捨てた分も含む)。</summary>
        public long FramesParsed { get; private set; }
        /// <summary>壊れていて捨てたバイト数の合計 (診断用)。</summary>
        public long BytesSkipped { get; private set; }

        /// <summary>今の区切り (無ければ null)。</summary>
        public string Boundary => _boundaryLine == null ? null : Encoding.ASCII.GetString(_boundaryLine, 2, _boundaryLine.Length - 2);

        public MjpegParser(string boundary = null)
        {
            SetBoundary(boundary);
        }

        /// <summary>
        /// 区切りを決める。Content-Type ヘッダーの値 ("multipart/x-mixed-replace; boundary=xxx") でも、
        /// 区切りだけ ("xxx" / "--xxx") でもよい。null / 空なら最初に見えた "--" の行を使う。
        /// </summary>
        public void SetBoundary(string boundaryOrContentType)
        {
            var b = ExtractBoundary(boundaryOrContentType);
            _boundaryLine = string.IsNullOrEmpty(b) ? null : Encoding.ASCII.GetBytes("--" + b);
        }

        /// <summary>Content-Type から boundary を取り出す。無ければ引数を区切りそのものとして扱う。</summary>
        public static string ExtractBoundary(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            var v = value.Trim();
            int i = v.IndexOf("boundary=", StringComparison.OrdinalIgnoreCase);
            if (i >= 0)
            {
                v = v.Substring(i + "boundary=".Length);
                int semi = v.IndexOf(';');
                if (semi >= 0) v = v.Substring(0, semi);
                v = v.Trim().Trim('"');
            }
            else if (v.IndexOf('/') >= 0 || v.IndexOf(';') >= 0)
            {
                return null; // "image/jpeg" など、区切りの書かれていない Content-Type
            }
            if (v.StartsWith("--", StringComparison.Ordinal)) v = v.Substring(2);
            return v.Length == 0 ? null : v;
        }

        /// <summary>すべて捨てて最初から (つなぎ直したとき)。区切りは残す。</summary>
        public void Reset()
        {
            _start = _end = 0;
            _frames.Clear();
            _pendingLength = -1;
            _inBody = false;
            _rawJpeg = false;
        }

        public int QueuedFrames => _frames.Count;

        /// <summary>取り出せた JPEG を 1 枚。無ければ null。</summary>
        public byte[] TakeFrame() => _frames.Count > 0 ? _frames.Dequeue() : null;

        /// <summary>いちばん新しい JPEG だけを取り、残りは捨てる。無ければ null。</summary>
        public byte[] TakeLatest()
        {
            byte[] last = null;
            while (_frames.Count > 0) last = _frames.Dequeue();
            return last;
        }

        public void Feed(byte[] data, int offset, int count)
        {
            if (data == null || count <= 0) return;
            Append(data, offset, count);
            Parse();
        }

        public void Feed(byte[] data) => Feed(data, 0, data?.Length ?? 0);

        // ---- 内部 ----

        private void Append(byte[] data, int offset, int count)
        {
            if (_end + count > _buf.Length)
            {
                // 前を詰める。それでも足りなければ大きくする
                int live = _end - _start;
                if (live + count <= _buf.Length && _start > 0)
                {
                    Buffer.BlockCopy(_buf, _start, _buf, 0, live);
                }
                else
                {
                    int size = _buf.Length;
                    while (size < live + count) size *= 2;
                    var next = new byte[size];
                    Buffer.BlockCopy(_buf, _start, next, 0, live);
                    _buf = next;
                }
                _start = 0;
                _end = live;
            }
            Buffer.BlockCopy(data, offset, _buf, _end, count);
            _end += count;
        }

        private int Live => _end - _start;

        private void Parse()
        {
            while (true)
            {
                if (Live > MaxFrameBytes + MaxHeaderBytes)
                {
                    // 区切りも終わりも見つからないまま大きくなり過ぎた。捨てて次の区切りを待つ
                    BytesSkipped += Live;
                    _start = _end = 0;
                    _inBody = false;
                    _pendingLength = -1;
                    return;
                }

                if (_rawJpeg) { if (!ParseRawJpeg()) return; continue; }

                if (!_inBody)
                {
                    if (!ReadPartHeaders()) return;
                    continue;
                }

                if (!ReadPartBody()) return;
            }
        }

        /// <summary>区切りの行とそれに続くヘッダーを読む。読めたら true (本体へ)。</summary>
        private bool ReadPartHeaders()
        {
            // 区切りの行を探す
            int at;
            if (_boundaryLine != null)
            {
                at = IndexOf(_buf, _start, _end, _boundaryLine);
                if (at < 0)
                {
                    // まだ区切りが来ていない。区切りより前に JPEG だけが来ているなら、区切りの無い配信
                    if (_start == 0 && FramesParsed == 0 && LooksLikeRawJpeg()) { _rawJpeg = true; return true; }
                    KeepTail(_boundaryLine.Length);
                    return false;
                }
            }
            else
            {
                if (FramesParsed == 0 && LooksLikeRawJpeg()) { _rawJpeg = true; return true; }
                at = FindDashLine();
                if (at < 0)
                {
                    KeepTail(MaxHeaderBytes);
                    return false;
                }
                // "--xxx" の行の xxx を区切りとして覚える
                int eol = IndexOfLineEnd(at);
                if (eol < 0) return false;
                var line = Encoding.ASCII.GetString(_buf, at + 2, eol - at - 2).Trim();
                if (line.EndsWith("--", StringComparison.Ordinal)) line = line.Substring(0, line.Length - 2);
                if (line.Length == 0) { Skip(eol - _start); return true; }
                _boundaryLine = Encoding.ASCII.GetBytes("--" + line);
            }

            if (at > _start) { BytesSkipped += at - _start; _start = at; }

            // 区切りの行の終わり
            int lineEnd = IndexOfLineEnd(_start);
            if (lineEnd < 0) return false;
            int headersStart = SkipNewline(lineEnd);
            if (headersStart < 0) return false;

            // ヘッダーの終わり (空行)
            int blank = FindBlankLine(headersStart);
            if (blank < 0)
            {
                if (_end - headersStart > MaxHeaderBytes) { BytesSkipped += headersStart - _start; _start = headersStart; }
                return false;
            }

            // 空行の改行がまだ途中までしか届いていない ("\r" で切れた) なら待つ。本体の先頭を 1 バイトずらさないため
            int bodyStart = SkipNewline(blank);
            if (bodyStart < 0) return false;

            // 区切りの行のすぐ後が空行 (= ヘッダー無し) のこともある
            _pendingLength = -1;
            var headers = Encoding.ASCII.GetString(_buf, headersStart, Math.Max(0, blank - headersStart));
            foreach (var raw in headers.Split('\n'))
            {
                var h = raw.Trim();
                int colon = h.IndexOf(':');
                if (colon <= 0) continue;
                var name = h.Substring(0, colon).Trim();
                if (!name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
                if (int.TryParse(h.Substring(colon + 1).Trim(), out var len) && len > 0 && len <= MaxFrameBytes) _pendingLength = len;
            }
            _start = bodyStart;
            _inBody = true;
            return true;
        }

        /// <summary>本体を読む。1 枚取れたら true。</summary>
        private bool ReadPartBody()
        {
            if (_pendingLength > 0)
            {
                if (Live < _pendingLength) return false;
                EmitIfJpeg(_start, _pendingLength);
                _start += _pendingLength;
                _inBody = false;
                _pendingLength = -1;
                return true;
            }

            // 長さが分からない: 次の区切りの手前まで (区切りの前の改行は本体に入れない)
            int next = _boundaryLine != null ? IndexOf(_buf, _start, _end, _boundaryLine) : -1;
            if (next < 0)
            {
                if (Live > MaxFrameBytes) { BytesSkipped += Live; _start = _end; _inBody = false; }
                return false;
            }
            int bodyEnd = next;
            if (bodyEnd - 1 >= _start && _buf[bodyEnd - 1] == (byte)'\n') bodyEnd--;
            if (bodyEnd - 1 >= _start && _buf[bodyEnd - 1] == (byte)'\r') bodyEnd--;
            EmitIfJpeg(_start, bodyEnd - _start);
            _start = next;
            _inBody = false;
            return true;
        }

        /// <summary>区切りの無い配信: SOI から EOI まで。1 枚取れたら true。</summary>
        private bool ParseRawJpeg()
        {
            int soi = IndexOfPair(_start, 0xFF, 0xD8);
            if (soi < 0) { KeepTail(1); return false; }
            if (soi > _start) { BytesSkipped += soi - _start; _start = soi; }
            int eoi = FindJpegEnd(_start);
            if (eoi < 0) return false;
            EmitIfJpeg(_start, eoi - _start);
            _start = eoi;
            return true;
        }

        /// <summary>
        /// JPEG の終わり (EOI の次の位置) を探す。マーカーの長さを辿って、圧縮データ (SOS の後) の中だけで
        /// FF D9 を探す。サムネイル (EXIF の中の小さな JPEG) の FF D9 で早く切らないため。
        /// </summary>
        private int FindJpegEnd(int soi)
        {
            int p = soi + 2;
            while (p + 4 <= _end)
            {
                if (_buf[p] != 0xFF) return ScanForEoi(p); // 形が崩れている: 素直に探す
                byte marker = _buf[p + 1];
                if (marker == 0xFF) { p++; continue; }
                if (marker == 0xD9) return p + 2;
                if (marker >= 0xD0 && marker <= 0xD7 || marker == 0x01) { p += 2; continue; }
                int len = (_buf[p + 2] << 8) | _buf[p + 3];
                if (len < 2) return ScanForEoi(p + 2);
                if (marker == 0xDA) return ScanForEoi(p + 2 + len);
                if (p + 2 + len > _end) return -1;
                p += 2 + len;
            }
            return -1;
        }

        private int ScanForEoi(int from)
        {
            for (int i = Math.Max(from, _start); i + 1 < _end; i++)
            {
                if (_buf[i] != 0xFF) continue;
                byte m = _buf[i + 1];
                if (m == 0xD9) return i + 2;
            }
            return -1;
        }

        private bool LooksLikeRawJpeg() => Live >= 2 && _buf[_start] == 0xFF && _buf[_start + 1] == 0xD8;

        private void EmitIfJpeg(int offset, int count)
        {
            // 先頭の空白・改行は飛ばす (区切りの後に余分な改行を入れるサーバーがある)
            while (count > 0 && (_buf[offset] == (byte)'\r' || _buf[offset] == (byte)'\n' || _buf[offset] == (byte)' '))
            {
                offset++; count--;
            }
            if (count < 4 || _buf[offset] != 0xFF || _buf[offset + 1] != 0xD8)
            {
                BytesSkipped += Math.Max(0, count);
                return;
            }
            var frame = new byte[count];
            Buffer.BlockCopy(_buf, offset, frame, 0, count);
            FramesParsed++;
            _frames.Enqueue(frame);
            // 取り出されないまま溜まり過ぎたら古いものから捨てる
            while (_frames.Count > 4) _frames.Dequeue();
        }

        private void Skip(int count)
        {
            _start = Math.Min(_end, _start + Math.Max(0, count));
        }

        /// <summary>探しているものが途中で切れているかもしれないので、末尾の keep バイトだけ残して捨てる。</summary>
        private void KeepTail(int keep)
        {
            if (Live <= keep) return;
            int drop = Live - keep;
            BytesSkipped += drop;
            _start += drop;
        }

        /// <summary>行頭の "--" を探す (区切りがまだ分からないとき)。</summary>
        private int FindDashLine()
        {
            for (int i = _start; i + 2 < _end; i++)
            {
                if (_buf[i] != (byte)'-' || _buf[i + 1] != (byte)'-') continue;
                if (i == _start || _buf[i - 1] == (byte)'\n') return i;
            }
            return -1;
        }

        private int IndexOfLineEnd(int from)
        {
            for (int i = from; i < _end; i++) if (_buf[i] == (byte)'\n' || _buf[i] == (byte)'\r') return i;
            return -1;
        }

        /// <summary>改行 (\r\n / \n / \r) の次の位置。まだ届いていなければ -1。</summary>
        private int SkipNewline(int at)
        {
            if (at >= _end) return -1;
            if (_buf[at] == (byte)'\r')
            {
                if (at + 1 >= _end) return -1;
                return _buf[at + 1] == (byte)'\n' ? at + 2 : at + 1;
            }
            return at + 1;
        }

        /// <summary>from から始まるヘッダーの終わり (空行の先頭) を探す。from が既に空行ならそこ。</summary>
        private int FindBlankLine(int from)
        {
            int lineStart = from;
            for (int i = from; i < _end; i++)
            {
                if (_buf[i] != (byte)'\n' && _buf[i] != (byte)'\r') continue;
                if (i == lineStart) return i; // 空行
                int next = SkipNewline(i);
                if (next < 0) return -1;
                lineStart = next;
                i = next - 1;
            }
            return -1;
        }

        private int IndexOfPair(int from, byte a, byte b)
        {
            for (int i = from; i + 1 < _end; i++) if (_buf[i] == a && _buf[i + 1] == b) return i;
            return -1;
        }

        private static int IndexOf(byte[] hay, int from, int to, byte[] needle)
        {
            int n = needle.Length;
            byte first = needle[0];
            for (int i = from; i + n <= to; i++)
            {
                if (hay[i] != first) continue;
                int k = 1;
                while (k < n && hay[i + k] == needle[k]) k++;
                if (k == n) return i;
            }
            return -1;
        }
    }

    /// <summary>
    /// 配信の URL の {store:key} を埋める (UnityEngine 非依存)。値が空のものがあれば null (= まだつながない)。
    /// </summary>
    public static class MediaUrlTemplate
    {
        public static bool HasPlaceholders(string template) =>
            !string.IsNullOrEmpty(template) && template.IndexOf("{store:", StringComparison.Ordinal) >= 0;

        /// <summary>lookup(key) が値を返す。空・null のキーがあれば null を返す。</summary>
        public static string Resolve(string template, Func<string, string> lookup)
        {
            if (string.IsNullOrEmpty(template)) return null;
            var sb = new StringBuilder();
            int i = 0;
            while (i < template.Length)
            {
                int open = template.IndexOf("{store:", i, StringComparison.Ordinal);
                if (open < 0) { sb.Append(template, i, template.Length - i); break; }
                int close = template.IndexOf('}', open);
                if (close < 0) { sb.Append(template, i, template.Length - i); break; }
                sb.Append(template, i, open - i);
                var key = template.Substring(open + 7, close - open - 7).Trim();
                var value = lookup != null ? lookup(key) : null;
                if (string.IsNullOrWhiteSpace(value)) return null;
                sb.Append(value.Trim());
                i = close + 1;
            }
            var url = sb.ToString().Trim();
            if (url.Length == 0) return null;
            // スキームが無ければ http:// を付ける ("{store:pc.address}/stream/slides" で pc.address が "192.168.1.5:8090" など)
            if (url.IndexOf("://", StringComparison.Ordinal) < 0) url = "http://" + url;
            return url;
        }
    }
}
