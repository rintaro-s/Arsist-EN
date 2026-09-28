// ==============================================
// Arsist Engine - Inference
// 依存の無い JSON の読み書き
//
// tokenizer.json (数 MB) とモデル定義を、実機 (Unity) と エディタのツール (.NET) の両方で
// 同じコードで読むためのもの。Unity 側の Newtonsoft とツール側の System.Text.Json を
// 片方ずつ書き分けると、読み方の違いがそのまま「エディタと実機で分割が違う」になる。
//
// 読むと 素の木 になる: Dictionary<string, object> / List<object> / string / double / bool / null。
// ModelSpec.FromPlain と同じ形なので、そのまま渡せる。
//
// UnityEngine に依存しない。tools/perception-check で検証する。
// ==============================================

using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Arsist.Runtime.Inference
{
    public static class MiniJson
    {
        public sealed class JsonException : Exception
        {
            public JsonException(string message) : base(message) { }
        }

        public static object Parse(string text)
        {
            if (text == null) throw new JsonException("null input");
            var reader = new Reader(text);
            reader.SkipSpace();
            var value = reader.ReadValue();
            reader.SkipSpace();
            if (!reader.AtEnd) throw new JsonException($"unexpected text at {reader.Position}");
            return value;
        }

        public static Dictionary<string, object> ParseObject(string text) =>
            Parse(text) as Dictionary<string, object> ?? throw new JsonException("not an object");

        // ---- 書く ----

        public static string Write(object value)
        {
            var sb = new StringBuilder();
            WriteValue(sb, value);
            return sb.ToString();
        }

        private static void WriteValue(StringBuilder sb, object value)
        {
            switch (value)
            {
                case null: sb.Append("null"); return;
                case string s: WriteString(sb, s); return;
                case bool b: sb.Append(b ? "true" : "false"); return;
                case float f: WriteNumber(sb, f); return;
                case double d: WriteNumber(sb, d); return;
                case int i: sb.Append(i.ToString(CultureInfo.InvariantCulture)); return;
                case long l: sb.Append(l.ToString(CultureInfo.InvariantCulture)); return;
                case IDictionary<string, object> map:
                {
                    sb.Append('{');
                    bool first = true;
                    foreach (var pair in map)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        WriteString(sb, pair.Key);
                        sb.Append(':');
                        WriteValue(sb, pair.Value);
                    }
                    sb.Append('}');
                    return;
                }
                case float[] floats:
                {
                    sb.Append('[');
                    for (int i = 0; i < floats.Length; i++)
                    {
                        if (i > 0) sb.Append(',');
                        WriteNumber(sb, floats[i]);
                    }
                    sb.Append(']');
                    return;
                }
                case IEnumerable list:
                {
                    sb.Append('[');
                    bool first = true;
                    foreach (var item in list)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        WriteValue(sb, item);
                    }
                    sb.Append(']');
                    return;
                }
                default:
                    if (value is IConvertible convertible)
                    {
                        WriteNumber(sb, convertible.ToDouble(CultureInfo.InvariantCulture));
                        return;
                    }
                    WriteString(sb, value.ToString());
                    return;
            }
        }

        private static void WriteNumber(StringBuilder sb, double d)
        {
            // NaN / 無限は JSON に無い。null にして、読む側で「値が無い」と分かるようにする。
            if (double.IsNaN(d) || double.IsInfinity(d)) { sb.Append("null"); return; }
            if (Math.Abs(d - Math.Round(d)) < 1e-12 && Math.Abs(d) < 1e15)
                sb.Append(((long)Math.Round(d)).ToString(CultureInfo.InvariantCulture));
            else
                sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
        }

        private static void WriteNumber(StringBuilder sb, float f)
        {
            if (float.IsNaN(f) || float.IsInfinity(f)) { sb.Append("null"); return; }
            // float の "R" は短く正確 (0.1f → 0.1)。double にしてから書くと 0.10000000149 になる。
            sb.Append(f.ToString("R", CultureInfo.InvariantCulture));
        }

        private static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        // ---- 読む ----

        private sealed class Reader
        {
            private readonly string _s;
            private int _i;

            public Reader(string s) { _s = s; }

            public bool AtEnd => _i >= _s.Length;
            public int Position => _i;

            public void SkipSpace()
            {
                while (_i < _s.Length)
                {
                    char c = _s[_i];
                    if (c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '﻿') _i++;
                    else break;
                }
            }

            public object ReadValue()
            {
                if (_i >= _s.Length) throw new JsonException("unexpected end");
                char c = _s[_i];
                switch (c)
                {
                    case '{': return ReadObject();
                    case '[': return ReadArray();
                    case '"': return ReadString();
                    case 't': Expect("true"); return true;
                    case 'f': Expect("false"); return false;
                    case 'n': Expect("null"); return null;
                    default:
                        if (c == '-' || (c >= '0' && c <= '9')) return ReadNumber();
                        throw new JsonException($"unexpected '{c}' at {_i}");
                }
            }

            private void Expect(string word)
            {
                if (string.CompareOrdinal(_s, _i, word, 0, word.Length) != 0)
                    throw new JsonException($"expected {word} at {_i}");
                _i += word.Length;
            }

            private Dictionary<string, object> ReadObject()
            {
                var map = new Dictionary<string, object>(StringComparer.Ordinal);
                _i++; // {
                SkipSpace();
                if (_i < _s.Length && _s[_i] == '}') { _i++; return map; }
                while (true)
                {
                    SkipSpace();
                    if (_i >= _s.Length || _s[_i] != '"') throw new JsonException($"expected key at {_i}");
                    var key = ReadString();
                    SkipSpace();
                    if (_i >= _s.Length || _s[_i] != ':') throw new JsonException($"expected ':' at {_i}");
                    _i++;
                    SkipSpace();
                    map[key] = ReadValue();
                    SkipSpace();
                    if (_i >= _s.Length) throw new JsonException("unexpected end in object");
                    if (_s[_i] == ',') { _i++; continue; }
                    if (_s[_i] == '}') { _i++; return map; }
                    throw new JsonException($"expected ',' or '}}' at {_i}");
                }
            }

            private List<object> ReadArray()
            {
                var list = new List<object>();
                _i++; // [
                SkipSpace();
                if (_i < _s.Length && _s[_i] == ']') { _i++; return list; }
                while (true)
                {
                    SkipSpace();
                    list.Add(ReadValue());
                    SkipSpace();
                    if (_i >= _s.Length) throw new JsonException("unexpected end in array");
                    if (_s[_i] == ',') { _i++; continue; }
                    if (_s[_i] == ']') { _i++; return list; }
                    throw new JsonException($"expected ',' or ']' at {_i}");
                }
            }

            private string ReadString()
            {
                _i++; // "
                StringBuilder sb = null;
                int start = _i;
                while (_i < _s.Length)
                {
                    char c = _s[_i];
                    if (c == '"')
                    {
                        string result = sb == null ? _s.Substring(start, _i - start) : sb.Append(_s, start, _i - start).ToString();
                        _i++;
                        return result;
                    }
                    if (c == '\\')
                    {
                        sb ??= new StringBuilder();
                        sb.Append(_s, start, _i - start);
                        _i++;
                        if (_i >= _s.Length) break;
                        char e = _s[_i];
                        switch (e)
                        {
                            case '"': sb.Append('"'); break;
                            case '\\': sb.Append('\\'); break;
                            case '/': sb.Append('/'); break;
                            case 'b': sb.Append('\b'); break;
                            case 'f': sb.Append('\f'); break;
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case 'u':
                                if (_i + 4 >= _s.Length) throw new JsonException("bad \\u escape");
                                sb.Append((char)int.Parse(_s.Substring(_i + 1, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                                _i += 4;
                                break;
                            default: throw new JsonException($"bad escape '\\{e}' at {_i}");
                        }
                        _i++;
                        start = _i;
                        continue;
                    }
                    _i++;
                }
                throw new JsonException("unterminated string");
            }

            private double ReadNumber()
            {
                int start = _i;
                if (_s[_i] == '-') _i++;
                while (_i < _s.Length)
                {
                    char c = _s[_i];
                    if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') _i++;
                    else break;
                }
                if (!double.TryParse(_s.Substring(start, _i - start), NumberStyles.Float, CultureInfo.InvariantCulture, out var d))
                    throw new JsonException($"bad number at {start}");
                return d;
            }
        }

        // ---- 素の木を読む小道具 ----

        public static string Text(Dictionary<string, object> d, string key, string fallback = null)
        {
            if (d == null || !d.TryGetValue(key, out var raw) || raw == null) return fallback;
            return raw as string ?? Convert.ToString(raw, CultureInfo.InvariantCulture);
        }

        public static double Number(Dictionary<string, object> d, string key, double fallback)
        {
            if (d == null || !d.TryGetValue(key, out var raw) || raw == null) return fallback;
            if (raw is double v) return v;
            if (raw is bool b) return b ? 1 : 0;
            return double.TryParse(Convert.ToString(raw, CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : fallback;
        }

        public static int Int(Dictionary<string, object> d, string key, int fallback) =>
            (int)Math.Round(Number(d, key, fallback));

        public static bool Bool(Dictionary<string, object> d, string key, bool fallback)
        {
            if (d == null || !d.TryGetValue(key, out var raw) || raw == null) return fallback;
            if (raw is bool b) return b;
            if (raw is double v) return v != 0;
            return string.Equals(raw.ToString(), "true", StringComparison.OrdinalIgnoreCase);
        }

        public static Dictionary<string, object> Obj(Dictionary<string, object> d, string key) =>
            d != null && d.TryGetValue(key, out var raw) ? raw as Dictionary<string, object> : null;

        public static List<object> List(Dictionary<string, object> d, string key) =>
            d != null && d.TryGetValue(key, out var raw) ? raw as List<object> : null;

        public static string[] Strings(Dictionary<string, object> d, string key)
        {
            var list = List(d, key);
            if (list == null) return Array.Empty<string>();
            var result = new List<string>(list.Count);
            foreach (var item in list) if (item != null) result.Add(item as string ?? Convert.ToString(item, CultureInfo.InvariantCulture));
            return result.ToArray();
        }
    }
}
