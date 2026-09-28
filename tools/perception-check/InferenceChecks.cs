// 汎用の推論 (Runtime/Inference) の検証。
//
// 分割器は「学習時と 1 つでも違う番号を出すと、モデルが黙って変な答えを返す」種類の部品なので、
// 小さな tokenizer.json を手で組んで、番号まで一致することを見る。
// 生成は偽の推論器で、KV キャッシュの長さ・位置・マスクが一歩ごとに正しく渡るかを見る。
//
// ARSIST_HF_DIR に HuggingFace の tokenizer.json (gpt2/ bert/ smol/ minilm/) を置くと、
// 公開されている分割結果とも突き合わせる (無ければ飛ばす)。
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Arsist.Runtime.Inference;
using Arsist.Runtime.Inference.Text;

internal static class InferenceChecks
{
    private static int _failures;

    private static void Expect(string label, bool ok, string detail = null)
    {
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}{(detail != null ? $": {detail}" : "")}");
        if (!ok) _failures++;
    }

    private static string Ids(IEnumerable<int> ids) => "[" + string.Join(",", ids) + "]";

    // ---- JSON ----

    private static void TestMiniJson()
    {
        var text = "{\"a\":[1,2.5,-3e2,true,null],\"b\":\"x\\\"y\\u3042\\n\",\"c\":{}}";
        var parsed = MiniJson.ParseObject(text);
        var list = MiniJson.List(parsed, "a");
        Expect("json: numbers and literals", list.Count == 5 && (double)list[1] == 2.5 && (double)list[2] == -300 && (bool)list[3] && list[4] == null);
        Expect("json: string escapes", MiniJson.Text(parsed, "b") == "x\"yあ\n", MiniJson.Text(parsed, "b"));
        var again = MiniJson.ParseObject(MiniJson.Write(parsed));
        Expect("json: write → parse round trip", MiniJson.Text(again, "b") == "x\"yあ\n" && MiniJson.List(again, "a").Count == 5);
        Expect("json: float written short", MiniJson.Write(new float[] { 0.1f, 2f }) == "[0.1,2]", MiniJson.Write(new float[] { 0.1f, 2f }));
    }

    // ---- 分割器 ----

    // byte-level BPE (GPT-2 系)
    private const string ByteLevelBpe = @"{
      ""added_tokens"": [{""id"": 20, ""content"": ""<|endoftext|>"", ""special"": true}],
      ""normalizer"": null,
      ""pre_tokenizer"": {""type"": ""ByteLevel"", ""add_prefix_space"": false, ""use_regex"": true},
      ""post_processor"": {""type"": ""ByteLevel""},
      ""decoder"": {""type"": ""ByteLevel""},
      ""model"": {""type"": ""BPE"", ""vocab"": {
          ""H"":0,""e"":1,""l"":2,""o"":3,""Ġ"":4,""w"":5,""r"":6,""d"":7,
          ""He"":8,""ll"":9,""llo"":10,""Hello"":11,""Ġw"":12,""or"":13,""Ġwor"":14,""Ġworl"":15,""Ġworld"":16,""!"":17},
        ""merges"": [""H e"", ""l l"", ""ll o"", ""He llo"", ""Ġ w"", ""o r"", ""Ġw or"", ""Ġwor l"", ""Ġworl d""]}
    }";

    // SentencePiece 由来の BPE (Llama 2 系): ▁ と byte_fallback
    private const string MetaspaceBpe = @"{
      ""added_tokens"": [{""id"":0,""content"":""<unk>"",""special"":true},{""id"":1,""content"":""<s>"",""special"":true},{""id"":2,""content"":""</s>"",""special"":true}],
      ""normalizer"": {""type"":""Sequence"",""normalizers"":[{""type"":""Prepend"",""prepend"":""▁""},{""type"":""Replace"",""pattern"":{""String"":"" ""},""content"":""▁""}]},
      ""pre_tokenizer"": null,
      ""post_processor"": {""type"":""TemplateProcessing"",
        ""single"":[{""SpecialToken"":{""id"":""<s>"",""type_id"":0}},{""Sequence"":{""id"":""A"",""type_id"":0}}],
        ""special_tokens"":{""<s>"":{""id"":""<s>"",""ids"":[1],""tokens"":[""<s>""]}}},
      ""decoder"": {""type"":""Sequence"",""decoders"":[
        {""type"":""Replace"",""pattern"":{""String"":""▁""},""content"":"" ""},
        {""type"":""ByteFallback""},{""type"":""Fuse""},{""type"":""Strip"",""content"":"" "",""start"":1,""stop"":0}]},
      ""model"": {""type"":""BPE"",""unk_token"":""<unk>"",""byte_fallback"":true,""fuse_unk"":true,
        ""vocab"":{""<unk>"":0,""<s>"":1,""</s>"":2,""<0xE3>"":3,""<0x81>"":4,""<0x82>"":5,""▁"":6,""h"":7,""i"":8,""▁h"":9,""▁hi"":10},
        ""merges"":[[""▁"",""h""],[""▁h"",""i""]]}
    }";

    // WordPiece (BERT 系)
    private const string WordPiece = @"{
      ""added_tokens"": [{""id"":0,""content"":""[PAD]"",""special"":true},{""id"":1,""content"":""[UNK]"",""special"":true},
                         {""id"":2,""content"":""[CLS]"",""special"":true},{""id"":3,""content"":""[SEP]"",""special"":true}],
      ""normalizer"": {""type"":""BertNormalizer"",""clean_text"":true,""handle_chinese_chars"":true,""strip_accents"":null,""lowercase"":true},
      ""pre_tokenizer"": {""type"":""BertPreTokenizer""},
      ""post_processor"": {""type"":""BertProcessing"",""sep"":[""[SEP]"",3],""cls"":[""[CLS]"",2]},
      ""decoder"": {""type"":""WordPiece"",""prefix"":""##"",""cleanup"":true},
      ""model"": {""type"":""WordPiece"",""unk_token"":""[UNK]"",""continuing_subword_prefix"":""##"",""max_input_chars_per_word"":100,
        ""vocab"":{""[PAD]"":0,""[UNK]"":1,""[CLS]"":2,""[SEP]"":3,""hello"":4,""world"":5,""##s"":6,""!"":7,""un"":8,""##aff"":9,""##able"":10,""cafe"":11}}
    }";

    private static void TestTokenizers()
    {
        var bpe = HfTokenizer.Load(ByteLevelBpe);
        var ids = bpe.Encode("Hello world");
        Expect("byte-level BPE: 'Hello world' → [Hello, Ġworld]", Ids(ids) == "[11,16]", Ids(ids));
        Expect("byte-level BPE: decode back", bpe.Decode(ids) == "Hello world", bpe.Decode(ids));
        ids = bpe.Encode("Hello world<|endoftext|>");
        Expect("byte-level BPE: special token is not split", Ids(ids) == "[11,16,20]", Ids(ids));
        Expect("byte-level BPE: special skipped on decode", bpe.Decode(ids) == "Hello world", bpe.Decode(ids));
        Expect("byte-level BPE: special kept when asked", bpe.Decode(ids, false) == "Hello world<|endoftext|>", bpe.Decode(ids, false));

        var sp = HfTokenizer.Load(MetaspaceBpe);
        ids = sp.Encode("hi あ");
        Expect("metaspace BPE: BOS + ▁hi ▁ + byte fallback for あ", Ids(ids) == "[1,10,6,3,4,5]", Ids(ids));
        Expect("metaspace BPE: decode strips the leading space and joins bytes", sp.Decode(ids) == "hi あ", "'" + sp.Decode(ids) + "'");
        Expect("metaspace BPE: StartsWithSpecialToken", sp.StartsWithSpecialToken("<s>hi") && !sp.StartsWithSpecialToken("hi"));

        var wp = HfTokenizer.Load(WordPiece);
        ids = wp.Encode("Hello worlds! Unaffable");
        Expect("wordpiece: [CLS] hello world ##s ! un ##aff ##able [SEP]", Ids(ids) == "[2,4,5,6,7,8,9,10,3]", Ids(ids));
        Expect("wordpiece: decode", wp.Decode(ids) == "hello worlds! unaffable", wp.Decode(ids));
        ids = wp.Encode("Café");
        Expect("wordpiece: accents stripped with lowercase", Ids(ids) == "[2,11,3]", Ids(ids));
        ids = wp.Encode("xyz");
        Expect("wordpiece: unknown word → [UNK]", Ids(ids) == "[2,1,3]", Ids(ids));

        try
        {
            HfTokenizer.Load(@"{""model"":{""type"":""Unigram"",""vocab"":[]}}");
            Expect("unigram is refused clearly", false);
        }
        catch (TokenizerException e)
        {
            Expect("unigram is refused clearly", e.Message.Contains("Unigram"), e.Message);
        }
    }

    private static void TestPublishedTokenizers()
    {
        var dir = Environment.GetEnvironmentVariable("ARSIST_HF_DIR");
        if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir))
        {
            Console.WriteLine("SKIP  published tokenizers (set ARSIST_HF_DIR to a folder with gpt2/ bert/ smol/ minilm/ tokenizer.json)");
            return;
        }

        HfTokenizer Load(string name)
        {
            var path = Path.Combine(dir, name, "tokenizer.json");
            return File.Exists(path) ? HfTokenizer.Load(File.ReadAllText(path)) : null;
        }

        var gpt2 = Load("gpt2");
        if (gpt2 != null)
        {
            var ids = gpt2.Encode("Hello world");
            Expect("gpt2: 'Hello world' → [15496, 995]", Ids(ids) == "[15496,995]", Ids(ids));
            var text = "Tokenizers aren't magic: 12345 cafés, 東京 😀!";
            Expect("gpt2: round trip with digits, accents, CJK, emoji", gpt2.Decode(gpt2.Encode(text)) == text, gpt2.Decode(gpt2.Encode(text)));
        }

        var bert = Load("bert");
        if (bert != null)
        {
            var ids = bert.Encode("Hello world");
            Expect("bert-base-uncased: 'Hello world' → [101, 7592, 2088, 102]", Ids(ids) == "[101,7592,2088,102]", Ids(ids));
        }

        var minilm = Load("minilm");
        if (minilm != null)
        {
            var ids = minilm.Encode("Hello world");
            Expect("all-MiniLM-L6-v2: 'Hello world' → [101, 7592, 2088, 102]", Ids(ids) == "[101,7592,2088,102]", Ids(ids));
        }

        var smol = Load("smol");
        if (smol != null)
        {
            var text = "<|im_start|>user\nWhat is 2+2? 日本語もOK<|im_end|>\n";
            var ids = smol.Encode(text, false);
            Expect("SmolLM2: chat markers are single tokens", ids.First() == smol.IdOf("<|im_start|>") && ids.Contains(smol.IdOf("<|im_end|>").Value), Ids(ids.Take(6)));
            Expect("SmolLM2: round trip", smol.Decode(ids, false) == text, smol.Decode(ids, false));
            // Digits(individual) → 数字は 1 桁ずつ
            var digits = smol.Encode("2024", false);
            Expect("SmolLM2: digits split one by one", digits.Length == 4, Ids(digits));
        }
    }

    // ---- 次のトークンを選ぶ ----

    private static void TestSampler()
    {
        var logits = new float[] { 0.1f, 3f, 2.9f, -1f };
        int greedy = Sampler.Next(logits, 0, 4, new SamplingOptions { Temperature = 0 }, null, new Random(1));
        Expect("sampler: temperature 0 picks the largest", greedy == 1, greedy.ToString());

        int penalized = Sampler.Next(logits, 0, 4, new SamplingOptions { Temperature = 0, RepetitionPenalty = 1.5 }, new[] { 1 }, new Random(1));
        Expect("sampler: repetition penalty lets the runner-up win", penalized == 2, penalized.ToString());

        var counts = new int[4];
        var random = new Random(7);
        for (int i = 0; i < 2000; i++)
            counts[Sampler.Next(logits, 0, 4, new SamplingOptions { Temperature = 1, TopK = 2, TopP = 1, RepetitionPenalty = 1 }, null, random)]++;
        Expect("sampler: top-k never picks outside the top 2", counts[0] == 0 && counts[3] == 0, string.Join(",", counts));
        Expect("sampler: the two close logits are picked about equally", Math.Abs(counts[1] - counts[2]) < 300, string.Join(",", counts));

        var big = new float[150000];
        big[123456] = 5;
        big[42] = 4;
        var top = Sampler.TopK(i => big[i], big.Length, 2);
        Expect("sampler: top-k over a large vocabulary", top[0].id == 123456 && top[1].id == 42);
    }

    // ---- 生成 ----

    /// <summary>
    /// 偽の LLM。直前のトークンから次を決める (bigram)。KV キャッシュを取る版は、
    /// past の長さ・位置・マスクが正しく渡っているかを毎回確かめる。
    /// </summary>
    private sealed class FakeLm : IModelRunner
    {
        public readonly Dictionary<int, int> Next = new Dictionary<int, int>();
        public int Vocab = 21;
        public bool WithCache;
        public bool WithFixedState;
        public int Calls;
        public string FixedStateShape;
        public int PastSeen = -1;
        public List<string> Problems = new List<string>();
        private int _cached;

        public bool TryDescribe(ModelRef model, out ModelSignature signature, out string error)
        {
            error = null;
            signature = new ModelSignature();
            signature.Inputs.Add(new TensorInfo { Name = "input_ids", Kind = TensorKind.Int64, Shape = new[] { -1, -1 } });
            signature.Inputs.Add(new TensorInfo { Name = "attention_mask", Kind = TensorKind.Int64, Shape = new[] { -1, -1 } });
            signature.Outputs.Add(new TensorInfo { Name = "logits", Kind = TensorKind.Float, Shape = new[] { -1, -1, Vocab } });
            if (WithCache)
            {
                signature.Inputs.Add(new TensorInfo { Name = "position_ids", Kind = TensorKind.Int64, Shape = new[] { -1, -1 } });
                signature.Inputs.Add(new TensorInfo { Name = "past_key_values.0.key", Kind = TensorKind.Float, Shape = new[] { -1, 2, -1, 4 } });
                signature.Inputs.Add(new TensorInfo { Name = "past_key_values.0.value", Kind = TensorKind.Float, Shape = new[] { -1, 2, -1, 4 } });
                signature.Outputs.Add(new TensorInfo { Name = "present.0.key", Kind = TensorKind.Float, Shape = new[] { -1, 2, -1, 4 } });
                signature.Outputs.Add(new TensorInfo { Name = "present.0.value", Kind = TensorKind.Float, Shape = new[] { -1, 2, -1, 4 } });
            }
            if (WithFixedState)
            {
                // Qwen3.5 のような「注意以外の状態」: 大きさが決まっていて、長さで伸びない。
                // 名前も注意のキャッシュと付け方が違う (past_conv.0 → present_conv.0)。
                signature.Inputs.Add(new TensorInfo { Name = "past_conv.0", Kind = TensorKind.Float, Shape = new[] { -1, 8, 3 } });
                signature.Outputs.Add(new TensorInfo { Name = "present_conv.0", Kind = TensorKind.Float, Shape = new[] { -1, 8, 3 } });
            }
            return true;
        }

        public void Run(ModelRef model, Dictionary<string, ModelTensor> inputs, Action<ModelRunResult> done)
        {
            Calls++;
            var ids = inputs["input_ids"];
            int n = ids.Dim(1);
            int past = 0;
            if (WithCache)
            {
                var key = inputs["past_key_values.0.key"];
                past = key.Dim(2);
                if (past != _cached) Problems.Add($"call {Calls}: past length {past}, expected {_cached}");
                if (Calls > 1 && n != 1) Problems.Add($"call {Calls}: fed {n} tokens with a cache");
                var pos = inputs["position_ids"];
                if (pos.LongAt(0) != past) Problems.Add($"call {Calls}: position {pos.LongAt(0)}, expected {past}");
                // 過去の値がそのまま戻ってきているか (前の一歩で書いた値 = 位置)
                for (int t = 0; t < past; t++)
                    if (Math.Abs(key.Floats[(0 * past + t) * 4] - t) > 1e-6) { Problems.Add($"call {Calls}: cache value lost at {t}"); break; }
                PastSeen = past;
            }
            if (WithFixedState)
            {
                var state = inputs["past_conv.0"];
                FixedStateShape = state.ShapeText();
                if (state.Length != 1 * 8 * 3) Problems.Add($"call {Calls}: fixed state has {state.Length} values, expected 24");
            }
            var mask = inputs["attention_mask"];
            if (mask.Dim(1) != past + n) Problems.Add($"call {Calls}: mask {mask.Dim(1)}, expected {past + n}");

            var logits = new float[n * Vocab];
            for (int t = 0; t < n; t++)
            {
                int last = (int)ids.LongAt(t);
                int next = Next.TryGetValue(last, out var v) ? v : 0;
                logits[t * Vocab + next] = 10;
            }
            var outputs = new Dictionary<string, ModelTensor> { ["logits"] = ModelTensor.Float(new[] { 1, n, Vocab }, logits) };
            if (WithCache)
            {
                int total = past + n;
                var present = new float[2 * total * 4];
                for (int h = 0; h < 2; h++)
                    for (int t = 0; t < total; t++)
                        for (int d = 0; d < 4; d++) present[(h * total + t) * 4 + d] = t;
                outputs["present.0.key"] = ModelTensor.Float(new[] { 1, 2, total, 4 }, present);
                outputs["present.0.value"] = ModelTensor.Float(new[] { 1, 2, total, 4 }, (float[])present.Clone());
                _cached = total;
            }
            if (WithFixedState) outputs["present_conv.0"] = ModelTensor.Float(new[] { 1, 8, 3 }, new float[24]);
            done(new ModelRunResult { Ok = true, Outputs = outputs, Ms = 1 });
        }
    }

    private static GenerationResult Generate(FakeLm lm, HfTokenizer tokenizer, int[] prompt, GenerationOptions options, List<string> deltas = null)
    {
        lm.TryDescribe(null, out var signature, out _);
        var session = new TextGenerationSession(tokenizer, signature, prompt, options);
        GenerationResult result = null;
        var driver = new TextGenerationDriver(lm, new ModelRef { Id = "fake" }, session, (d, _) => deltas?.Add(d), r => result = r);
        driver.Start();
        return result;
    }

    private static void TestGeneration()
    {
        var tokenizer = HfTokenizer.Load(ByteLevelBpe);
        // H(0) → Hello(11) → Ġworld(16) → !(17) → <|endoftext|>(20)
        void Chain(FakeLm lm)
        {
            lm.Next[0] = 11; lm.Next[11] = 16; lm.Next[16] = 17; lm.Next[17] = 20;
        }
        var greedy = new GenerationOptions { Sampling = new SamplingOptions { Temperature = 0 }, MaxNewTokens = 16 };
        greedy.EndIds.Add(20);

        var plain = new FakeLm();
        Chain(plain);
        var deltas = new List<string>();
        var result = Generate(plain, tokenizer, new[] { 0 }, greedy, deltas);
        Expect("generate (no cache): text", result.Ok && result.Text == "Hello world!", result.Text);
        Expect("generate (no cache): stops at the end token", result.Reason == "eos" && result.Tokens == 3, $"{result.Reason} {result.Tokens}");
        Expect("generate: streamed pieces add up to the text", string.Concat(deltas) == result.Text, string.Join("|", deltas));

        var cached = new FakeLm { WithCache = true };
        Chain(cached);
        result = Generate(cached, tokenizer, new[] { 0, 0, 0 }, greedy);
        Expect("generate (KV cache): text", result.Ok && result.Text == "Hello world!", $"{result.Text} {result.Error}");
        Expect("generate (KV cache): used the cache", result.UsedCache && cached.PastSeen == 5, $"past {cached.PastSeen}");
        Expect("generate (KV cache): lengths, positions and mask right at every step", cached.Problems.Count == 0, string.Join("; ", cached.Problems));

        var withStop = new GenerationOptions { Sampling = new SamplingOptions { Temperature = 0 }, MaxNewTokens = 16, Stop = new[] { " wor" } };
        var stopLm = new FakeLm();
        Chain(stopLm);
        deltas.Clear();
        result = Generate(stopLm, tokenizer, new[] { 0 }, withStop, deltas);
        Expect("generate: stop string cuts the text", result.Reason == "stop" && result.Text == "Hello", $"{result.Reason} '{result.Text}'");
        Expect("generate: a half-written stop string is never streamed", string.Concat(deltas) == "Hello", string.Join("|", deltas));

        // 注意のキャッシュと、大きさの決まった状態が混ざったモデル (Qwen3.5 のような書き出し)
        var mixed = new FakeLm { WithCache = true, WithFixedState = true };
        Chain(mixed);
        result = Generate(mixed, tokenizer, new[] { 0 }, greedy);
        Expect("generate: attention cache and fixed-size states together", result.Ok && result.Text == "Hello world!", $"{result.Text} {result.Error}");
        Expect("generate: a fixed-size state keeps its shape (not zero-length)", mixed.FixedStateShape == "[1,8,3]", mixed.FixedStateShape);
        Expect("generate: mixed naming (past_conv.0 → present_conv.0) is paired up", mixed.Problems.Count == 0, string.Join("; ", mixed.Problems));

        // 考えている途中 (<think> … </think>) は答えから外す
        var thinker = HfTokenizer.Load(ByteLevelBpe);
        var thinkLm = new FakeLm();
        // <think> … </think> を書いてから答える偽のモデル: トークンは使い回しで、文字列で見る
        var hidden = new GenerationOptions { Sampling = new SamplingOptions { Temperature = 0 }, MaxNewTokens = 8, HideThinking = true };
        var shown = new GenerationOptions { Sampling = new SamplingOptions { Temperature = 0 }, MaxNewTokens = 8, HideThinking = false };
        Expect("generate: thinking is hidden by default", StripCheck(true), "");
        Expect("generate: thinking can be kept", StripCheck(false), "");

        // 同期の推論器で長く回してもスタックが深くならない
        var loop = new FakeLm();
        loop.Next[0] = 0;
        var many = new GenerationOptions { Sampling = new SamplingOptions { Temperature = 0 }, MaxNewTokens = 3000, MaxContext = 10000 };
        result = Generate(loop, tokenizer, new[] { 0 }, many);
        Expect("generate: 3000 tokens with a synchronous runner", result.Ok && result.Tokens == 3000 && result.Reason == "length", $"{result.Tokens} {result.Reason} {result.Error}");

        // 長すぎるプロンプトは先頭から捨てる
        var ctx = new FakeLm();
        Chain(ctx);
        var small = new GenerationOptions { Sampling = new SamplingOptions { Temperature = 0 }, MaxNewTokens = 4, MaxContext = 8 };
        small.EndIds.Add(20);
        ctx.TryDescribe(null, out var sig, out _);
        var session = new TextGenerationSession(tokenizer, sig, Enumerable.Repeat(0, 20).ToArray(), small);
        Expect("generate: an over-long prompt is trimmed to fit", session.PromptTokens == 4, session.PromptTokens.ToString());

        // 扱えない入力を持つモデルは、はっきり断る
        var odd = new ModelSignature();
        odd.Inputs.Add(new TensorInfo { Name = "input_ids", Kind = TensorKind.Int64, Shape = new[] { 1, -1 } });
        odd.Inputs.Add(new TensorInfo { Name = "pixel_values", Kind = TensorKind.Float, Shape = new[] { 1, 3, 224, 224 } });
        odd.Outputs.Add(new TensorInfo { Name = "logits" });
        var why = TextGenerationSession.Check(odd);
        Expect("generate: a model with an unknown input is refused with its name", why == "unsupportedInput:pixel_values", why);
    }

    /// <summary>&lt;think&gt; を外す / 残すを、分割器つきの本物のセッションで見る。</summary>
    private static bool StripCheck(bool hide)
    {
        // "<", "think", ">" … を並べられる小さな語彙を組んで、think ブロックを書かせる
        var vocab = new[] { "<think>", "\n", "</think>", "Hello", "!" };
        var json = "{\"added_tokens\":[],\"normalizer\":null,\"pre_tokenizer\":null,\"post_processor\":null," +
                   "\"decoder\":{\"type\":\"Fuse\"}," +
                   "\"model\":{\"type\":\"WordLevel\",\"vocab\":{" +
                   string.Join(",", vocab.Select((v, i) => $"\"{v.Replace("\n", "\\n")}\":{i}")) + "}}}";
        var tokenizer = HfTokenizer.Load(json);
        var lm = new FakeLm { Vocab = vocab.Length };
        lm.Next[0] = 1; lm.Next[1] = 2; lm.Next[2] = 3; lm.Next[3] = 4; lm.Next[4] = 4;
        var options = new GenerationOptions { Sampling = new SamplingOptions { Temperature = 0, RepetitionPenalty = 1 }, MaxNewTokens = 4, HideThinking = hide };
        var result = Generate(lm, tokenizer, new[] { 0 }, options);
        return hide ? result.Text == "Hello!" : result.Text.StartsWith("\n</think>");
    }

    /// <summary>
    /// 出力を「あちら側の持ち物」として返す推論器 (実機の ONNX Runtime と同じ渡し方)。
    /// 値を運ぶのは、読まれたときだけ。
    /// </summary>
    private sealed class DeviceHeldLm : IModelRunner
    {
        public int Fetches;
        public int CacheFetches;
        private int _cached;

        public bool TryDescribe(ModelRef model, out ModelSignature signature, out string error)
        {
            error = null;
            signature = new ModelSignature();
            signature.Inputs.Add(new TensorInfo { Name = "input_ids", Kind = TensorKind.Int64, Shape = new[] { -1, -1 } });
            signature.Inputs.Add(new TensorInfo { Name = "attention_mask", Kind = TensorKind.Int64, Shape = new[] { -1, -1 } });
            signature.Inputs.Add(new TensorInfo { Name = "past_key_values.0.key", Kind = TensorKind.Float, Shape = new[] { -1, 2, -1, 4 } });
            signature.Outputs.Add(new TensorInfo { Name = "logits", Kind = TensorKind.Float, Shape = new[] { -1, -1, 21 } });
            signature.Outputs.Add(new TensorInfo { Name = "present.0.key", Kind = TensorKind.Float, Shape = new[] { -1, 2, -1, 4 } });
            return true;
        }

        public void Run(ModelRef model, Dictionary<string, ModelTensor> inputs, Action<ModelRunResult> done)
        {
            var ids = inputs["input_ids"];
            int n = ids.Dim(1);
            int last = (int)ids.LongAt(n - 1);
            _cached += n;

            var outputs = new Dictionary<string, ModelTensor>
            {
                // logits: 読まれたときに作る
                ["logits"] = ModelTensor.Device(TensorKind.Float, new[] { 1, n, 21 }, "logits-handle", _ =>
                {
                    Fetches++;
                    var values = new float[n * 21];
                    values[(n - 1) * 21 + (last == 0 ? 11 : last == 11 ? 16 : last == 16 ? 17 : 20)] = 10;
                    return values;
                }),
                // キャッシュ: 読まれない限り値を作らない
                ["present.0.key"] = ModelTensor.Device(TensorKind.Float, new[] { 1, 2, _cached, 4 }, "cache-handle", _ =>
                {
                    CacheFetches++;
                    return new float[2 * _cached * 4];
                }),
            };
            done(new ModelRunResult { Ok = true, Outputs = outputs, Ms = 1 });
        }
    }

    private static void TestDeviceHeldTensors()
    {
        var tokenizer = HfTokenizer.Load(ByteLevelBpe);
        var runner = new DeviceHeldLm();
        runner.TryDescribe(null, out var signature, out _);
        var options = new GenerationOptions { Sampling = new SamplingOptions { Temperature = 0, RepetitionPenalty = 1 }, MaxNewTokens = 8 };
        options.EndIds.Add(20);
        var session = new TextGenerationSession(tokenizer, signature, new[] { 0 }, options);
        GenerationResult result = null;
        new TextGenerationDriver(runner, new ModelRef { Id = "held" }, session, null, r => result = r).Start();

        Expect("device-held outputs: generation works without copying values", result != null && result.Ok && result.Text == "Hello world!", result?.Text ?? result?.Error);
        Expect("device-held outputs: the cache is never copied back", runner.CacheFetches == 0, runner.CacheFetches.ToString());
        Expect("device-held outputs: only the logits are read", runner.Fetches == session.GeneratedTokens + 1, $"{runner.Fetches} reads for {session.GeneratedTokens} tokens");

        // 形だけ分かっていれば、値を運ばずに長さも数えられる
        var held = ModelTensor.Device(TensorKind.Float, new[] { 1, 2, 3, 4 }, "h");
        Expect("device-held outputs: the length comes from the shape", held.Length == 24 && held.IsDeviceHeld, held.Length.ToString());
    }

    // ---- 埋め込み・分類・会話の書式 ----

    private static void TestEncoding()
    {
        var hidden = ModelTensor.Float(new[] { 1, 3, 2 }, new float[] { 1, 0, 3, 0, 2, 0 });
        var outputs = new Dictionary<string, ModelTensor> { ["last_hidden_state"] = hidden };
        var mean = TextEncoding.Embedding(outputs, 3, "mean", false, null, out _);
        Expect("embed: mean pooling", Math.Abs(mean[0] - 2) < 1e-6 && mean[1] == 0, string.Join(",", mean));
        var cls = TextEncoding.Embedding(outputs, 3, "cls", false, null, out _);
        Expect("embed: cls pooling", cls[0] == 1, string.Join(",", cls));
        var normalized = TextEncoding.Embedding(outputs, 3, "mean", true, null, out _);
        Expect("embed: normalised to length 1", Math.Abs(normalized[0] - 1) < 1e-6, string.Join(",", normalized));
        var direct = TextEncoding.Embedding(new Dictionary<string, ModelTensor>
        {
            ["last_hidden_state"] = hidden,
            ["sentence_embedding"] = ModelTensor.Float(new[] { 1, 2 }, new float[] { 3, 4 }),
        }, 3, "mean", true, null, out _);
        Expect("embed: a ready-made sentence_embedding output wins", Math.Abs(direct[0] - 0.6) < 1e-6 && Math.Abs(direct[1] - 0.8) < 1e-6);
        Expect("cosine: same direction = 1, opposite = -1",
            Math.Abs(TextEncoding.Cosine(new float[] { 1, 2 }, new float[] { 2, 4 }) - 1) < 1e-9 &&
            Math.Abs(TextEncoding.Cosine(new float[] { 1, 0 }, new float[] { -1, 0 }) + 1) < 1e-9);

        var ranked = TextEncoding.Classify(new Dictionary<string, ModelTensor> { ["logits"] = ModelTensor.Float(new[] { 1, 3 }, new float[] { 0, 2, 1 }) }, null, true, 2, out _);
        Expect("classify: softmax, best first", ranked[0].index == 1 && ranked.Count == 2 && ranked[0].score > 0.6, $"{ranked[0].index} {ranked[0].score:F3}");

        var wp = HfTokenizer.Load(WordPiece);
        var sig = new ModelSignature();
        sig.Inputs.Add(new TensorInfo { Name = "input_ids", Kind = TensorKind.Int64 });
        sig.Inputs.Add(new TensorInfo { Name = "attention_mask", Kind = TensorKind.Int64 });
        sig.Inputs.Add(new TensorInfo { Name = "token_type_ids", Kind = TensorKind.Int64 });
        var inputs = TextEncoding.Inputs(wp, sig, "hello world hello world", 4, out var count, out var error);
        Expect("encode: truncation keeps [SEP] at the end", count == 4 && inputs["input_ids"].LongAt(3) == 3 && inputs["token_type_ids"].LongAt(0) == 0, error);

        var chat = ChatFormat.Render("chatml", new List<ChatMessage> { new ChatMessage("system", "Be brief."), new ChatMessage("user", "Hi") });
        Expect("chat: ChatML", chat == "<|im_start|>system\nBe brief.<|im_end|>\n<|im_start|>user\nHi<|im_end|>\n<|im_start|>assistant\n", chat.Replace("\n", "\\n"));
        var llama = ChatFormat.Render("llama3", new List<ChatMessage> { new ChatMessage("user", "Hi") });
        Expect("chat: Llama 3 begins with its own BOS", llama.StartsWith("<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\nHi<|eot_id|>"));
        var custom = ChatFormat.Render("custom", new List<ChatMessage> { new ChatMessage("user", "Hi") }, "Q: {prompt}\nA:");
        Expect("chat: custom template", custom == "Q: Hi\nA:", custom);
    }

    // ---- テンソルの受け渡し・サービス ----

    private sealed class EchoRunner : IModelRunner
    {
        public bool TryDescribe(ModelRef model, out ModelSignature signature, out string error)
        {
            error = null;
            signature = new ModelSignature();
            signature.Inputs.Add(new TensorInfo { Name = "x", Kind = TensorKind.Float, Shape = new[] { 1, -1 } });
            signature.Inputs.Add(new TensorInfo { Name = "k", Kind = TensorKind.Int64, Shape = new[] { 1 } });
            signature.Outputs.Add(new TensorInfo { Name = "y", Kind = TensorKind.Float, Shape = new[] { 1, -1 } });
            return true;
        }

        public void Run(ModelRef model, Dictionary<string, ModelTensor> inputs, Action<ModelRunResult> done)
        {
            var x = inputs["x"].ToFloats();
            long k = inputs["k"].LongAt(0);
            var y = x.Select(v => v * k).ToArray();
            done(new ModelRunResult { Ok = true, Outputs = new Dictionary<string, ModelTensor> { ["y"] = ModelTensor.Float(inputs["x"].Shape, y) } });
        }
    }

    private static void TestTensorsAndService()
    {
        var info = new TensorInfo { Name = "x", Kind = TensorKind.Float, Shape = new[] { 1, -1, 2 } };
        var t = ModelTensor.FromPlain(MiniJson.Parse("[[1,2],[3,4],[5,6]]"), info, out var error);
        Expect("tensor: nested array + -1 resolved from the data", t != null && t.ShapeText() == "[1,3,2]", error ?? t.ShapeText());
        t = ModelTensor.FromPlain(MiniJson.Parse("{\"type\":\"int64\",\"shape\":[2],\"data\":[7,8]}"), info, out error);
        Expect("tensor: explicit type and shape", t != null && t.Kind == TensorKind.Int64 && t.LongAt(1) == 8, error);
        t = ModelTensor.FromPlain(MiniJson.Parse("[1,2,3]"), info, out error);
        Expect("tensor: a size that cannot fit is refused", t == null && error.StartsWith("shapeMismatch"), error);
        Expect("tensor: zero-length axis allowed (empty KV cache)", ModelTensor.Filled(TensorKind.Float, new[] { 1, 2, 0, 4 }, 0).Length == 0);

        var service = new InferenceService(new EchoRunner(), new[]
        {
            ModelEntry.FromPlain(MiniJson.ParseObject("{\"id\":\"echo\",\"name\":\"Echo\",\"use\":\"tensor\",\"file\":\"x.onnx\"}")),
        }, _ => null);
        Dictionary<string, object> reply = null;
        service.Run("Echo", MiniJson.ParseObject("{\"x\":[1,2,3],\"k\":[2]}"), 100, r => reply = r);
        var y = MiniJson.List(MiniJson.Obj(MiniJson.Obj(reply, "outputs"), "y"), "data");
        Expect("service.run: by name, bare arrays, typed output", reply != null && (bool)reply["ok"] && y.Count == 3 && (double)y[2] == 6, MiniJson.Write(reply));
        service.Run("echo", MiniJson.ParseObject("{\"x\":[1]}"), 100, r => reply = r);
        Expect("service.run: a missing input is named", MiniJson.Text(reply, "error") == "missingInput:k", MiniJson.Text(reply, "error"));
        service.Generate("echo", new List<ChatMessage> { new ChatMessage("user", "hi") }, null, null, r => reply = r);
        Expect("service.generate: refuses a non-text model", MiniJson.Text(reply, "error") == "notTextModel", MiniJson.Text(reply, "error"));

        // 文章のモデルとして、分割器 → 書式 → 生成 → 文章 を通しで
        var lm = new FakeLm { WithCache = true };
        lm.Next[0] = 11; lm.Next[11] = 16; lm.Next[16] = 17; lm.Next[17] = 20;
        // "H" で終わるプロンプトにしたいので、書式は custom で "{prompt}" だけ
        var textModel = ModelEntry.FromPlain(MiniJson.ParseObject(
            "{\"id\":\"lm\",\"name\":\"Tiny\",\"use\":\"text\",\"file\":\"lm.onnx\",\"text\":{\"task\":\"generate\",\"tokenizer\":\"t.json\"," +
            "\"chatFormat\":\"custom\",\"promptTemplate\":\"{prompt}\",\"temperature\":0,\"eosTokens\":[\"<|endoftext|>\"]}}"));
        var textService = new InferenceService(lm, new[] { textModel }, _ => ByteLevelBpe);
        var streamed = new List<string>();
        textService.Generate("Tiny", new List<ChatMessage> { new ChatMessage("user", "H") }, null, (d, _) => streamed.Add(d), r => reply = r);
        Expect("service.generate: tokenizer → template → cached generation → text",
            reply != null && (bool)reply["ok"] && MiniJson.Text(reply, "text") == "Hello world!" && MiniJson.Text(reply, "reason") == "eos",
            MiniJson.Write(reply));
        Expect("service.generate: streamed", string.Concat(streamed) == "Hello world!", string.Join("|", streamed));
    }

    public static int Run()
    {
        _failures = 0;
        Console.WriteLine("\n--- inference: json ---");
        TestMiniJson();
        Console.WriteLine("\n--- inference: tokenizers ---");
        TestTokenizers();
        TestPublishedTokenizers();
        Console.WriteLine("\n--- inference: sampling ---");
        TestSampler();
        Console.WriteLine("\n--- inference: generation (no cache / KV cache / stop / long) ---");
        TestGeneration();
        Console.WriteLine("\n--- inference: device-held tensors (ONNX Runtime on the headset) ---");
        TestDeviceHeldTensors();
        Console.WriteLine("\n--- inference: embeddings, classification, chat formats ---");
        TestEncoding();
        Console.WriteLine("\n--- inference: tensors and the service ---");
        TestTensorsAndService();
        return _failures;
    }
}
