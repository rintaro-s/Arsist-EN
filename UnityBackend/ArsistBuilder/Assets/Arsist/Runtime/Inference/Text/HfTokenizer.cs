// ==============================================
// Arsist Engine - Inference / Text
// HuggingFace の tokenizer.json を読んで、文章 ⇄ トークン番号 を行う
//
// 文章のモデル (LLM・埋め込み・文章分類) の ONNX には分割器が入っていない。
// 学習に使ったのと同じ分割をしないとモデルは意味のある答えを返さないので、
// HuggingFace が配っている tokenizer.json をそのまま読む (変換しない)。
//
// 対応 (よく使われる組み合わせ):
//   model:         BPE (byte-level の GPT-2 / Qwen / Llama 3 / SmolLM、SentencePiece 由来の
//                  Llama 2 / Mistral / Phi-3 の byte_fallback)、WordPiece (BERT 系)、WordLevel
//   normalizer:    Sequence, NFC/NFD/NFKC/NFKD, Lowercase, Strip, StripAccents, Replace, Prepend,
//                  BertNormalizer
//   pre_tokenizer: ByteLevel, Split, Metaspace, Whitespace, WhitespaceSplit, BertPreTokenizer,
//                  Punctuation, Digits, Sequence
//   post_processor: TemplateProcessing, BertProcessing, RobertaProcessing, ByteLevel, Sequence
//   decoder:       ByteLevel, Metaspace, WordPiece, Replace, ByteFallback, Fuse, Strip, BPEDecoder, Sequence
// 未対応: Unigram (T5 / XLM-R)。読み込み時にはっきり失敗させる。
//
// UnityEngine に依存しない。tools/perception-check で、公開されている分割結果と突き合わせる。
// ==============================================

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Arsist.Runtime.Inference.Text
{
    public sealed class TokenizerException : Exception
    {
        public TokenizerException(string message) : base(message) { }
    }

    public sealed class HfTokenizer
    {
        // ---- 語彙 ----
        private readonly Dictionary<string, int> _vocab = new Dictionary<string, int>(StringComparer.Ordinal);
        private readonly Dictionary<int, string> _idToToken = new Dictionary<int, string>();

        private sealed class AddedToken
        {
            public int Id;
            public string Content;
            public bool Special;
            public bool LStrip;
            public bool RStrip;
        }
        private readonly List<AddedToken> _added = new List<AddedToken>();
        private readonly HashSet<int> _specialIds = new HashSet<int>();

        // ---- 部品 ----
        private readonly Dictionary<string, object> _normalizer;
        private readonly Dictionary<string, object> _preTokenizer;
        private readonly Dictionary<string, object> _postProcessor;
        private readonly Dictionary<string, object> _decoder;

        private enum ModelKind { Bpe, WordPiece, WordLevel }
        private readonly ModelKind _kind;

        // BPE
        private readonly Dictionary<(string, string), int> _merges = new Dictionary<(string, string), int>();
        private readonly bool _byteFallback;
        private readonly bool _fuseUnk;
        private readonly bool _ignoreMerges;
        private readonly string _continuingSubwordPrefix;
        private readonly string _endOfWordSuffix;
        private readonly Dictionary<string, int[]> _wordCache = new Dictionary<string, int[]>(StringComparer.Ordinal);

        // WordPiece
        private readonly int _maxInputCharsPerWord = 100;

        private readonly string _unkToken;

        public int VocabSize { get; private set; }
        public string ModelType => _kind.ToString();

        public static HfTokenizer Load(string json) => new HfTokenizer(MiniJson.ParseObject(json));

        public HfTokenizer(Dictionary<string, object> root)
        {
            var model = MiniJson.Obj(root, "model") ?? throw new TokenizerException("tokenizer.json has no model");
            var type = MiniJson.Text(model, "type");
            if (type == null) type = MiniJson.List(model, "merges") != null ? "BPE" : "WordPiece";

            switch (type)
            {
                case "BPE": _kind = ModelKind.Bpe; break;
                case "WordPiece": _kind = ModelKind.WordPiece; break;
                case "WordLevel": _kind = ModelKind.WordLevel; break;
                case "Unigram":
                    throw new TokenizerException("Unigram tokenizers (T5, XLM-R, …) are not supported yet; use a BPE or WordPiece model.");
                default:
                    throw new TokenizerException($"unknown tokenizer model '{type}'");
            }

            if (MiniJson.Obj(model, "vocab") is Dictionary<string, object> vocab)
            {
                foreach (var pair in vocab)
                {
                    int id = (int)Math.Round(Convert.ToDouble(pair.Value, CultureInfo.InvariantCulture));
                    _vocab[pair.Key] = id;
                    _idToToken[id] = pair.Key;
                }
            }
            else
            {
                throw new TokenizerException("tokenizer model has no vocab");
            }

            _unkToken = MiniJson.Text(model, "unk_token");
            _continuingSubwordPrefix = MiniJson.Text(model, "continuing_subword_prefix") ?? (_kind == ModelKind.WordPiece ? "##" : null);
            _endOfWordSuffix = MiniJson.Text(model, "end_of_word_suffix");
            _byteFallback = MiniJson.Bool(model, "byte_fallback", false);
            _fuseUnk = MiniJson.Bool(model, "fuse_unk", false);
            _ignoreMerges = MiniJson.Bool(model, "ignore_merges", false);
            _maxInputCharsPerWord = MiniJson.Int(model, "max_input_chars_per_word", 100);

            if (_kind == ModelKind.Bpe)
            {
                var merges = MiniJson.List(model, "merges") ?? new List<object>();
                for (int rank = 0; rank < merges.Count; rank++)
                {
                    string a, b;
                    if (merges[rank] is List<object> pair && pair.Count == 2)
                    {
                        a = pair[0] as string;
                        b = pair[1] as string;
                    }
                    else if (merges[rank] is string text)
                    {
                        // 古い形式 "a b"。トークンに空白は入らない (byte-level なら Ġ、SentencePiece なら ▁)。
                        int space = text.IndexOf(' ', 1);
                        if (space < 0) continue;
                        a = text.Substring(0, space);
                        b = text.Substring(space + 1);
                    }
                    else continue;
                    if (a == null || b == null) continue;
                    var key = (a, b);
                    if (!_merges.ContainsKey(key)) _merges[key] = rank;
                }
            }

            foreach (var raw in MiniJson.List(root, "added_tokens") ?? new List<object>())
            {
                if (!(raw is Dictionary<string, object> entry)) continue;
                var token = new AddedToken
                {
                    Id = MiniJson.Int(entry, "id", -1),
                    Content = MiniJson.Text(entry, "content"),
                    Special = MiniJson.Bool(entry, "special", false),
                    LStrip = MiniJson.Bool(entry, "lstrip", false),
                    RStrip = MiniJson.Bool(entry, "rstrip", false),
                };
                if (token.Id < 0 || string.IsNullOrEmpty(token.Content)) continue;
                _added.Add(token);
                _vocab[token.Content] = token.Id;
                _idToToken[token.Id] = token.Content;
                if (token.Special) _specialIds.Add(token.Id);
            }
            // 長いものから当てる ("<|im_start|>" より先に "<|im_start|>assistant" のような重なりがあっても正しく切る)
            _added.Sort((x, y) => y.Content.Length.CompareTo(x.Content.Length));

            _normalizer = MiniJson.Obj(root, "normalizer");
            _preTokenizer = MiniJson.Obj(root, "pre_tokenizer");
            _postProcessor = MiniJson.Obj(root, "post_processor");
            _decoder = MiniJson.Obj(root, "decoder");

            int max = -1;
            foreach (var id in _idToToken.Keys) if (id > max) max = id;
            VocabSize = max + 1;
        }

        // ================================================================
        // 引く
        // ================================================================

        public int? IdOf(string token) => token != null && _vocab.TryGetValue(token, out var id) ? id : (int?)null;
        public string TokenOf(int id) => _idToToken.TryGetValue(id, out var token) ? token : null;
        public bool IsSpecial(int id) => _specialIds.Contains(id);

        /// <summary>特別なトークンの文字列 (&lt;|im_end|&gt; など) か。</summary>
        public bool IsSpecialToken(string content)
        {
            foreach (var added in _added) if (added.Special && added.Content == content) return true;
            return false;
        }

        /// <summary>文章が特別なトークンで始まっているか (チャットの型が BOS を自分で書いているか)。</summary>
        public bool StartsWithSpecialToken(string text)
        {
            if (string.IsNullOrEmpty(text)) return false;
            foreach (var added in _added)
                if (added.Special && text.StartsWith(added.Content, StringComparison.Ordinal)) return true;
            return false;
        }

        // ================================================================
        // 文章 → 番号
        // ================================================================

        public int[] Encode(string text, bool addSpecialTokens = true)
        {
            var ids = new List<int>();
            text ??= "";

            // 1. 追加トークン (<|im_start|> など) で切る。追加トークンは分割器を通さない。
            var segments = SplitOnAddedTokens(text);
            bool firstPiece = true;
            foreach (var (segmentText, addedId) in segments)
            {
                if (addedId >= 0) { ids.Add(addedId); firstPiece = false; continue; }
                if (segmentText.Length == 0) continue;

                // 2. 正規化 → 3. 単語に分ける → 4. モデル
                var normalized = Normalize(_normalizer, segmentText);
                var words = PreTokenize(_preTokenizer, new List<string> { normalized }, firstPiece);
                foreach (var word in words)
                {
                    if (word.Length == 0) continue;
                    EncodeWord(word, ids);
                }
                firstPiece = false;
            }

            // 5. 前後に特別なトークンを足す ([CLS] ... [SEP]、<s> ... など)
            if (addSpecialTokens) ids = PostProcess(_postProcessor, ids);
            return ids.ToArray();
        }

        private List<(string text, int addedId)> SplitOnAddedTokens(string text)
        {
            var result = new List<(string, int)>();
            if (_added.Count == 0) { result.Add((text, -1)); return result; }

            var current = new StringBuilder();
            int i = 0;
            while (i < text.Length)
            {
                AddedToken hit = null;
                foreach (var added in _added)
                {
                    if (string.CompareOrdinal(text, i, added.Content, 0, added.Content.Length) == 0) { hit = added; break; }
                }
                if (hit == null)
                {
                    current.Append(text[i]);
                    i++;
                    continue;
                }

                var before = current.ToString();
                if (hit.LStrip) before = before.TrimEnd();
                if (before.Length > 0) result.Add((before, -1));
                current.Clear();
                result.Add((hit.Content, hit.Id));
                i += hit.Content.Length;
                if (hit.RStrip) while (i < text.Length && char.IsWhiteSpace(text[i])) i++;
            }
            if (current.Length > 0) result.Add((current.ToString(), -1));
            return result;
        }

        // ---- 正規化 ----

        private static string Normalize(Dictionary<string, object> spec, string text)
        {
            if (spec == null) return text;
            switch (MiniJson.Text(spec, "type"))
            {
                case "Sequence":
                    foreach (var item in MiniJson.List(spec, "normalizers") ?? new List<object>())
                        text = Normalize(item as Dictionary<string, object>, text);
                    return text;
                case "NFC": return text.Normalize(NormalizationForm.FormC);
                case "NFD": return text.Normalize(NormalizationForm.FormD);
                case "NFKC": return text.Normalize(NormalizationForm.FormKC);
                case "NFKD": return text.Normalize(NormalizationForm.FormKD);
                case "Lowercase": return text.ToLowerInvariant();
                case "Strip":
                {
                    bool left = MiniJson.Bool(spec, "strip_left", true), right = MiniJson.Bool(spec, "strip_right", true);
                    if (left) text = text.TrimStart();
                    if (right) text = text.TrimEnd();
                    return text;
                }
                case "StripAccents": return StripAccents(text);
                case "Replace": return ApplyReplace(spec, text);
                case "Prepend":
                {
                    var prepend = MiniJson.Text(spec, "prepend") ?? "";
                    return text.Length == 0 ? text : prepend + text;
                }
                case "BertNormalizer": return BertNormalize(spec, text);
                case "Precompiled":
                    // SentencePiece の正規化表。中身は NFKC に近いので、それで代える。
                    return text.Normalize(NormalizationForm.FormKC);
                default:
                    return text;
            }
        }

        private static string ApplyReplace(Dictionary<string, object> spec, string text)
        {
            var pattern = MiniJson.Obj(spec, "pattern");
            var content = MiniJson.Text(spec, "content") ?? "";
            if (pattern == null) return text;
            var literal = MiniJson.Text(pattern, "String");
            if (literal != null) return literal.Length == 0 ? text : text.Replace(literal, content);
            var regex = MiniJson.Text(pattern, "Regex");
            return regex != null ? Regex.Replace(text, regex, content) : text;
        }

        private static string StripAccents(string text)
        {
            var decomposed = text.Normalize(NormalizationForm.FormD);
            var sb = new StringBuilder(decomposed.Length);
            foreach (var c in decomposed)
                if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
            return sb.ToString();
        }

        private static string BertNormalize(Dictionary<string, object> spec, string text)
        {
            bool clean = MiniJson.Bool(spec, "clean_text", true);
            bool chinese = MiniJson.Bool(spec, "handle_chinese_chars", true);
            bool lower = MiniJson.Bool(spec, "lowercase", true);
            // strip_accents が null なら lowercase に従う (HF と同じ)
            bool strip = spec.TryGetValue("strip_accents", out var raw) && raw is bool b ? b : lower;

            var sb = new StringBuilder(text.Length);
            foreach (var c in text)
            {
                if (clean)
                {
                    if (c == 0 || c == 0xFFFD) continue;
                    if (c != '\t' && c != '\n' && c != '\r' && char.IsControl(c)) continue;
                    if (char.IsWhiteSpace(c)) { sb.Append(' '); continue; }
                }
                if (chinese && IsCjk(c)) { sb.Append(' ').Append(c).Append(' '); continue; }
                sb.Append(c);
            }
            var result = sb.ToString();
            if (strip) result = StripAccents(result);
            if (lower) result = result.ToLowerInvariant();
            return result;
        }

        private static bool IsCjk(char c) =>
            (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) || (c >= 0xF900 && c <= 0xFAFF);

        // ---- 単語に分ける ----

        private static readonly Regex Gpt2Split = new Regex(
            @"'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

        private static readonly Regex WhitespaceSplitRegex = new Regex(@"\w+|[^\w\s]+", RegexOptions.Compiled | RegexOptions.CultureInvariant);

        private static readonly Dictionary<string, Regex> RegexCache = new Dictionary<string, Regex>();

        private static Regex CachedRegex(string pattern)
        {
            lock (RegexCache)
            {
                if (!RegexCache.TryGetValue(pattern, out var regex))
                {
                    regex = new Regex(pattern, RegexOptions.CultureInvariant);
                    RegexCache[pattern] = regex;
                }
                return regex;
            }
        }

        private static List<string> PreTokenize(Dictionary<string, object> spec, List<string> pieces, bool firstPiece)
        {
            if (spec == null) return pieces;
            var type = MiniJson.Text(spec, "type");
            if (type == "Sequence")
            {
                foreach (var item in MiniJson.List(spec, "pretokenizers") ?? new List<object>())
                    pieces = PreTokenize(item as Dictionary<string, object>, pieces, firstPiece);
                return pieces;
            }

            var result = new List<string>();
            for (int p = 0; p < pieces.Count; p++)
            {
                var piece = pieces[p];
                switch (type)
                {
                    case "ByteLevel":
                    {
                        var text = piece;
                        if (MiniJson.Bool(spec, "add_prefix_space", false) && p == 0 && text.Length > 0 && text[0] != ' ') text = " " + text;
                        if (MiniJson.Bool(spec, "use_regex", true))
                        {
                            foreach (Match m in Gpt2Split.Matches(text)) result.Add(ByteLevelEncode(m.Value));
                        }
                        else
                        {
                            result.Add(ByteLevelEncode(text));
                        }
                        break;
                    }
                    case "Split":
                        SplitByPattern(spec, piece, result);
                        break;
                    case "Metaspace":
                    {
                        var replacement = MiniJson.Text(spec, "replacement") ?? "▁";
                        var scheme = MiniJson.Text(spec, "prepend_scheme");
                        if (scheme == null) scheme = MiniJson.Bool(spec, "add_prefix_space", true) ? "always" : "never";
                        var text = piece.Replace(" ", replacement);
                        bool prepend = scheme == "always" || (scheme == "first" && firstPiece && p == 0);
                        if (prepend && !text.StartsWith(replacement, StringComparison.Ordinal)) text = replacement + text;
                        if (MiniJson.Bool(spec, "split", true))
                        {
                            // ▁ の直前で切る (▁ は次の単語の頭に付く)
                            int start = 0;
                            for (int i = 1; i < text.Length; i++)
                            {
                                if (string.CompareOrdinal(text, i, replacement, 0, replacement.Length) == 0)
                                {
                                    result.Add(text.Substring(start, i - start));
                                    start = i;
                                }
                            }
                            if (start < text.Length) result.Add(text.Substring(start));
                        }
                        else
                        {
                            result.Add(text);
                        }
                        break;
                    }
                    case "Whitespace":
                        foreach (Match m in WhitespaceSplitRegex.Matches(piece)) result.Add(m.Value);
                        break;
                    case "WhitespaceSplit":
                        foreach (var w in piece.Split((char[])null, StringSplitOptions.RemoveEmptyEntries)) result.Add(w);
                        break;
                    case "BertPreTokenizer":
                        foreach (var w in piece.Split((char[])null, StringSplitOptions.RemoveEmptyEntries)) IsolatePunctuation(w, result);
                        break;
                    case "Punctuation":
                        IsolatePunctuation(piece, result);
                        break;
                    case "Digits":
                        SplitDigits(piece, MiniJson.Bool(spec, "individual_digits", false), result);
                        break;
                    default:
                        result.Add(piece);
                        break;
                }
            }
            return result;
        }

        /// <summary>HF の Split。pattern の当たりを区切りとして、behavior に従って残す。</summary>
        private static void SplitByPattern(Dictionary<string, object> spec, string text, List<string> into)
        {
            var pattern = MiniJson.Obj(spec, "pattern");
            Regex regex;
            var literal = pattern != null ? MiniJson.Text(pattern, "String") : null;
            var source = pattern != null ? MiniJson.Text(pattern, "Regex") : null;
            if (literal != null) regex = CachedRegex(Regex.Escape(literal));
            else if (source != null) regex = CachedRegex(source);
            else { into.Add(text); return; }

            var behavior = MiniJson.Text(spec, "behavior") ?? "Isolated";
            bool invert = MiniJson.Bool(spec, "invert", false);

            // (文字列, 当たりか) の列にする
            var parts = new List<(string text, bool match)>();
            int last = 0;
            foreach (Match m in regex.Matches(text))
            {
                if (m.Length == 0) continue;
                if (m.Index > last) parts.Add((text.Substring(last, m.Index - last), false));
                parts.Add((m.Value, true));
                last = m.Index + m.Length;
            }
            if (last < text.Length) parts.Add((text.Substring(last), false));
            if (invert) for (int i = 0; i < parts.Count; i++) parts[i] = (parts[i].text, !parts[i].match);

            switch (behavior)
            {
                case "Removed":
                    foreach (var part in parts) if (!part.match) into.Add(part.text);
                    break;
                case "MergedWithPrevious":
                {
                    var sb = new StringBuilder();
                    foreach (var part in parts)
                    {
                        sb.Append(part.text);
                        if (part.match) { into.Add(sb.ToString()); sb.Clear(); }
                    }
                    if (sb.Length > 0) into.Add(sb.ToString());
                    break;
                }
                case "MergedWithNext":
                {
                    var sb = new StringBuilder();
                    foreach (var part in parts)
                    {
                        if (part.match && sb.Length > 0) { into.Add(sb.ToString()); sb.Clear(); }
                        sb.Append(part.text);
                    }
                    if (sb.Length > 0) into.Add(sb.ToString());
                    break;
                }
                case "Contiguous":
                {
                    var sb = new StringBuilder();
                    bool? previous = null;
                    foreach (var part in parts)
                    {
                        if (previous.HasValue && previous.Value != part.match && sb.Length > 0) { into.Add(sb.ToString()); sb.Clear(); }
                        sb.Append(part.text);
                        previous = part.match;
                    }
                    if (sb.Length > 0) into.Add(sb.ToString());
                    break;
                }
                default: // Isolated
                    foreach (var part in parts) into.Add(part.text);
                    break;
            }
        }

        private static bool IsBertPunctuation(char c)
        {
            if ((c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)) return true;
            var category = CharUnicodeInfo.GetUnicodeCategory(c);
            return category == UnicodeCategory.ConnectorPunctuation || category == UnicodeCategory.DashPunctuation ||
                   category == UnicodeCategory.OpenPunctuation || category == UnicodeCategory.ClosePunctuation ||
                   category == UnicodeCategory.InitialQuotePunctuation || category == UnicodeCategory.FinalQuotePunctuation ||
                   category == UnicodeCategory.OtherPunctuation;
        }

        private static void IsolatePunctuation(string text, List<string> into)
        {
            var sb = new StringBuilder();
            foreach (var c in text)
            {
                if (IsBertPunctuation(c))
                {
                    if (sb.Length > 0) { into.Add(sb.ToString()); sb.Clear(); }
                    into.Add(c.ToString());
                }
                else sb.Append(c);
            }
            if (sb.Length > 0) into.Add(sb.ToString());
        }

        private static void SplitDigits(string text, bool individual, List<string> into)
        {
            var sb = new StringBuilder();
            bool inDigits = false;
            foreach (var c in text)
            {
                bool digit = char.IsDigit(c);
                if (digit && individual)
                {
                    if (sb.Length > 0) { into.Add(sb.ToString()); sb.Clear(); }
                    into.Add(c.ToString());
                    inDigits = false;
                    continue;
                }
                if (sb.Length > 0 && digit != inDigits) { into.Add(sb.ToString()); sb.Clear(); }
                sb.Append(c);
                inDigits = digit;
            }
            if (sb.Length > 0) into.Add(sb.ToString());
        }

        // ---- byte-level (GPT-2) の 1 バイト ⇄ 1 文字 ----

        private static readonly char[] ByteToChar = BuildByteToChar();
        private static readonly Dictionary<char, byte> CharToByte = BuildCharToByte();

        private static char[] BuildByteToChar()
        {
            var table = new char[256];
            var direct = new bool[256];
            for (int b = '!'; b <= '~'; b++) direct[b] = true;
            for (int b = 0xA1; b <= 0xAC; b++) direct[b] = true;
            for (int b = 0xAE; b <= 0xFF; b++) direct[b] = true;
            int n = 0;
            for (int b = 0; b < 256; b++) table[b] = direct[b] ? (char)b : (char)(256 + n++);
            return table;
        }

        private static Dictionary<char, byte> BuildCharToByte()
        {
            var map = new Dictionary<char, byte>();
            var table = BuildByteToChar();
            for (int b = 0; b < 256; b++) map[table[b]] = (byte)b;
            return map;
        }

        private static string ByteLevelEncode(string text)
        {
            var bytes = Encoding.UTF8.GetBytes(text);
            var chars = new char[bytes.Length];
            for (int i = 0; i < bytes.Length; i++) chars[i] = ByteToChar[bytes[i]];
            return new string(chars);
        }

        // ---- モデル ----

        private void EncodeWord(string word, List<int> ids)
        {
            switch (_kind)
            {
                case ModelKind.Bpe: ids.AddRange(EncodeBpe(word)); break;
                case ModelKind.WordPiece: EncodeWordPiece(word, ids); break;
                default:
                    if (_vocab.TryGetValue(word, out var id)) ids.Add(id);
                    else if (_unkToken != null && _vocab.TryGetValue(_unkToken, out var unk)) ids.Add(unk);
                    break;
            }
        }

        private int[] EncodeBpe(string word)
        {
            if (_wordCache.TryGetValue(word, out var cached)) return cached;

            if (_ignoreMerges && _vocab.TryGetValue(word, out var whole))
            {
                cached = new[] { whole };
                if (_wordCache.Count < 50000) _wordCache[word] = cached;
                return cached;
            }

            // 1 文字ずつ (サロゲートペアは 1 文字として) に分ける
            var symbols = new List<string>();
            for (int i = 0; i < word.Length; i++)
            {
                if (char.IsHighSurrogate(word[i]) && i + 1 < word.Length && char.IsLowSurrogate(word[i + 1]))
                {
                    symbols.Add(word.Substring(i, 2));
                    i++;
                }
                else symbols.Add(word[i].ToString());
            }
            if (_continuingSubwordPrefix != null)
                for (int i = 1; i < symbols.Count; i++) symbols[i] = _continuingSubwordPrefix + symbols[i];
            if (_endOfWordSuffix != null && symbols.Count > 0)
                symbols[symbols.Count - 1] += _endOfWordSuffix;

            // 一番順位の高い (番号の小さい) 隣り合う組から合わせていく
            while (symbols.Count > 1)
            {
                int bestRank = int.MaxValue, bestIndex = -1;
                for (int i = 0; i < symbols.Count - 1; i++)
                {
                    if (_merges.TryGetValue((symbols[i], symbols[i + 1]), out var rank) && rank < bestRank)
                    {
                        bestRank = rank;
                        bestIndex = i;
                    }
                }
                if (bestIndex < 0) break;
                var right = symbols[bestIndex + 1];
                if (_continuingSubwordPrefix != null && right.StartsWith(_continuingSubwordPrefix, StringComparison.Ordinal))
                    right = right.Substring(_continuingSubwordPrefix.Length);
                symbols[bestIndex] = symbols[bestIndex] + right;
                symbols.RemoveAt(bestIndex + 1);
            }

            var result = new List<int>(symbols.Count);
            int unkId = _unkToken != null && _vocab.TryGetValue(_unkToken, out var u) ? u : -1;
            bool lastWasUnk = false;
            foreach (var symbol in symbols)
            {
                if (_vocab.TryGetValue(symbol, out var id))
                {
                    result.Add(id);
                    lastWasUnk = false;
                    continue;
                }
                if (_byteFallback)
                {
                    bool all = true;
                    var bytes = Encoding.UTF8.GetBytes(symbol);
                    var byteIds = new List<int>(bytes.Length);
                    foreach (var b in bytes)
                    {
                        if (_vocab.TryGetValue($"<0x{b:X2}>", out var byteId)) byteIds.Add(byteId);
                        else { all = false; break; }
                    }
                    if (all) { result.AddRange(byteIds); lastWasUnk = false; continue; }
                }
                if (unkId >= 0 && !(_fuseUnk && lastWasUnk)) result.Add(unkId);
                lastWasUnk = true;
            }

            cached = result.ToArray();
            if (_wordCache.Count < 50000) _wordCache[word] = cached;
            return cached;
        }

        private void EncodeWordPiece(string word, List<int> ids)
        {
            int unkId = _unkToken != null && _vocab.TryGetValue(_unkToken, out var u) ? u : -1;
            if (word.Length > _maxInputCharsPerWord)
            {
                if (unkId >= 0) ids.Add(unkId);
                return;
            }
            var pieces = new List<int>();
            int start = 0;
            while (start < word.Length)
            {
                int end = word.Length;
                int found = -1;
                while (start < end)
                {
                    var sub = word.Substring(start, end - start);
                    if (start > 0) sub = _continuingSubwordPrefix + sub;
                    if (_vocab.TryGetValue(sub, out var id)) { found = id; break; }
                    end--;
                }
                if (found < 0)
                {
                    if (unkId >= 0) ids.Add(unkId);
                    return;
                }
                pieces.Add(found);
                start = end;
            }
            ids.AddRange(pieces);
        }

        // ---- 前後の特別なトークン ----

        private List<int> PostProcess(Dictionary<string, object> spec, List<int> ids)
        {
            if (spec == null) return ids;
            switch (MiniJson.Text(spec, "type"))
            {
                case "Sequence":
                    foreach (var item in MiniJson.List(spec, "processors") ?? new List<object>())
                        ids = PostProcess(item as Dictionary<string, object>, ids);
                    return ids;
                case "BertProcessing":
                case "RobertaProcessing":
                {
                    var cls = PairId(MiniJson.List(spec, "cls"));
                    var sep = PairId(MiniJson.List(spec, "sep"));
                    var result = new List<int>(ids.Count + 2);
                    if (cls >= 0) result.Add(cls);
                    result.AddRange(ids);
                    if (sep >= 0) result.Add(sep);
                    return result;
                }
                case "TemplateProcessing":
                {
                    var single = MiniJson.List(spec, "single");
                    if (single == null) return ids;
                    var specials = MiniJson.Obj(spec, "special_tokens");
                    var result = new List<int>(ids.Count + 4);
                    foreach (var raw in single)
                    {
                        if (!(raw is Dictionary<string, object> item)) continue;
                        if (MiniJson.Obj(item, "Sequence") != null) { result.AddRange(ids); continue; }
                        var special = MiniJson.Obj(item, "SpecialToken");
                        if (special == null) continue;
                        var name = MiniJson.Text(special, "id");
                        var entry = MiniJson.Obj(specials, name ?? "");
                        var list = MiniJson.List(entry, "ids");
                        if (list != null)
                        {
                            foreach (var id in list) result.Add((int)Math.Round(Convert.ToDouble(id, CultureInfo.InvariantCulture)));
                        }
                        else if (name != null && _vocab.TryGetValue(name, out var direct))
                        {
                            result.Add(direct);
                        }
                    }
                    return result;
                }
                default:
                    return ids;
            }
        }

        private int PairId(List<object> pair)
        {
            if (pair == null || pair.Count < 2) return -1;
            return (int)Math.Round(Convert.ToDouble(pair[1], CultureInfo.InvariantCulture));
        }

        // ================================================================
        // 番号 → 文章
        // ================================================================

        public string Decode(IList<int> ids, bool skipSpecialTokens = true)
        {
            var tokens = new List<string>(ids.Count);
            foreach (var id in ids)
            {
                if (skipSpecialTokens && _specialIds.Contains(id)) continue;
                var token = TokenOf(id);
                if (token != null) tokens.Add(token);
            }
            if (_decoder == null) return string.Join(" ", tokens);
            return string.Concat(DecodeChain(_decoder, tokens));
        }

        private List<string> DecodeChain(Dictionary<string, object> spec, List<string> tokens)
        {
            if (spec == null) return tokens;
            switch (MiniJson.Text(spec, "type"))
            {
                case "Sequence":
                    foreach (var item in MiniJson.List(spec, "decoders") ?? new List<object>())
                        tokens = DecodeChain(item as Dictionary<string, object>, tokens);
                    return tokens;

                case "ByteLevel":
                {
                    var bytes = new List<byte>();
                    foreach (var token in tokens)
                    {
                        foreach (var c in token)
                        {
                            if (CharToByte.TryGetValue(c, out var b)) bytes.Add(b);
                            else bytes.AddRange(Encoding.UTF8.GetBytes(c.ToString()));
                        }
                    }
                    return new List<string> { Encoding.UTF8.GetString(bytes.ToArray()) };
                }

                case "Metaspace":
                {
                    var replacement = MiniJson.Text(spec, "replacement") ?? "▁";
                    var scheme = MiniJson.Text(spec, "prepend_scheme");
                    bool stripFirst = scheme != null ? scheme != "never" : MiniJson.Bool(spec, "add_prefix_space", true);
                    var result = new List<string>(tokens.Count);
                    for (int i = 0; i < tokens.Count; i++)
                    {
                        var t = tokens[i].Replace(replacement, " ");
                        if (i == 0 && stripFirst && t.StartsWith(" ", StringComparison.Ordinal)) t = t.Substring(1);
                        result.Add(t);
                    }
                    return result;
                }

                case "WordPiece":
                {
                    var prefix = MiniJson.Text(spec, "prefix") ?? "##";
                    bool cleanup = MiniJson.Bool(spec, "cleanup", true);
                    var result = new List<string>(tokens.Count);
                    for (int i = 0; i < tokens.Count; i++)
                    {
                        var t = tokens[i];
                        if (i > 0)
                        {
                            if (t.StartsWith(prefix, StringComparison.Ordinal)) t = t.Substring(prefix.Length);
                            else t = " " + t;
                        }
                        if (cleanup) t = CleanupWordPiece(t);
                        result.Add(t);
                    }
                    return result;
                }

                case "Replace":
                {
                    var result = new List<string>(tokens.Count);
                    foreach (var t in tokens) result.Add(ApplyReplace(spec, t));
                    return result;
                }

                case "ByteFallback":
                {
                    var result = new List<string>(tokens.Count);
                    var pending = new List<byte>();
                    void Flush()
                    {
                        if (pending.Count == 0) return;
                        result.Add(DecodeUtf8OrReplace(pending));
                        pending.Clear();
                    }
                    foreach (var t in tokens)
                    {
                        if (t.Length == 6 && t.StartsWith("<0x", StringComparison.Ordinal) && t[5] == '>' &&
                            byte.TryParse(t.Substring(3, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var b))
                        {
                            pending.Add(b);
                            continue;
                        }
                        Flush();
                        result.Add(t);
                    }
                    Flush();
                    return result;
                }

                case "Fuse":
                    return new List<string> { string.Concat(tokens) };

                case "Strip":
                {
                    var content = MiniJson.Text(spec, "content") ?? " ";
                    int start = MiniJson.Int(spec, "start", 0), stop = MiniJson.Int(spec, "stop", 0);
                    var result = new List<string>(tokens.Count);
                    foreach (var token in tokens)
                    {
                        var t = token;
                        for (int i = 0; i < start && t.StartsWith(content, StringComparison.Ordinal); i++) t = t.Substring(content.Length);
                        for (int i = 0; i < stop && t.EndsWith(content, StringComparison.Ordinal); i++) t = t.Substring(0, t.Length - content.Length);
                        result.Add(t);
                    }
                    return result;
                }

                case "BPEDecoder":
                {
                    var suffix = MiniJson.Text(spec, "suffix") ?? "</w>";
                    var result = new List<string>(tokens.Count);
                    for (int i = 0; i < tokens.Count; i++)
                        result.Add(tokens[i].Replace(suffix, i == tokens.Count - 1 ? "" : " "));
                    return result;
                }

                default:
                    return tokens;
            }
        }

        private static string CleanupWordPiece(string t) =>
            t.Replace(" .", ".").Replace(" ?", "?").Replace(" !", "!").Replace(" ,", ",").Replace(" ' ", "'")
             .Replace(" n't", "n't").Replace(" 'm", "'m").Replace(" 's", "'s").Replace(" 've", "'ve").Replace(" 're", "'re");

        /// <summary>UTF-8 として読めなければ、1 バイトにつき U+FFFD (HF の ByteFallback と同じ)。</summary>
        private static string DecodeUtf8OrReplace(List<byte> bytes)
        {
            try
            {
                return new UTF8Encoding(false, true).GetString(bytes.ToArray());
            }
            catch (DecoderFallbackException)
            {
                return new string('�', bytes.Count);
            }
        }
    }
}
