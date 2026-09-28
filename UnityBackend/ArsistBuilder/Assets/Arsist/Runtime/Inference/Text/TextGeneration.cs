// ==============================================
// Arsist Engine - Inference / Text
// LLM の生成 (1 トークンずつ、KV キャッシュつき)
//
// ONNX の書き出し方はいくつかあるが、入出力の名前はほぼ揃っている (Optimum / transformers.js /
// onnxruntime-genai):
//   入力  input_ids, attention_mask, position_ids?, past_key_values.<n>.key/value?,
//         use_cache_branch?, cache_position?, (num_)logits_to_keep?
//   出力  logits, present.<n>.key/value?
// past を取るモデルなら、前の一歩の present をそのまま次の past にする (キャッシュ)。
// 取らないモデルなら、毎回全部を流し直す (遅いが動く)。
//
// 推論そのものはここに無い。セッションは「次に流す入力」を作り、「出てきた出力」を受け取るだけ。
// 実機 (非同期、メインスレッド) でも エディタのツール (同期) でも同じセッションが動く。
//
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace Arsist.Runtime.Inference.Text
{
    public sealed class GenerationOptions
    {
        public int MaxNewTokens = 128;
        public int MaxContext = 2048;
        public SamplingOptions Sampling = new SamplingOptions();
        public string[] Stop = Array.Empty<string>();
        public HashSet<int> EndIds = new HashSet<int>();
        public int? Seed;
        /// <summary>
        /// 考えている途中 (&lt;think&gt; … &lt;/think&gt;) を答えから外す。
        /// Qwen3 系や R1 系は答えの前に考えを書く。UI に出すのは答えだけでよいことが多い。
        /// </summary>
        public bool HideThinking = true;
    }

    public sealed class GenerationStep
    {
        public bool Done;
        /// <summary>今回の一歩で増えた文章 (まだ確定していない部分は次に回す)。</summary>
        public string Delta = "";
        /// <summary>"eos" / "stop" / "length" / "context"</summary>
        public string Reason;
    }

    public sealed class GenerationResult
    {
        public bool Ok;
        public string Text = "";
        public int PromptTokens;
        public int Tokens;
        /// <summary>"eos" / "stop" / "length" / "context" / "cancelled" / "error"</summary>
        public string Reason;
        public string Error;
        public double Ms;
        public bool UsedCache;

        public Dictionary<string, object> ToPlain() => new Dictionary<string, object>
        {
            ["ok"] = Ok,
            ["text"] = Text,
            ["promptTokens"] = (double)PromptTokens,
            ["tokens"] = (double)Tokens,
            ["reason"] = Reason,
            ["error"] = Error,
            ["ms"] = Math.Round(Ms),
            ["tokensPerSecond"] = Ms > 0 ? Math.Round(Tokens * 1000.0 / Ms, 1) : 0.0,
            ["usedCache"] = UsedCache,
        };
    }

    public sealed class TextGenerationSession
    {
        private readonly HfTokenizer _tokenizer;
        private readonly ModelSignature _signature;
        private readonly GenerationOptions _options;
        private readonly Random _random;

        // 入出力の名前 (Plan で決める)
        private readonly string _ids;
        private readonly TensorInfo _idsInfo;
        private readonly string _mask;
        private readonly string _positions;
        private readonly string _tokenTypes;
        private readonly string _useCacheBranch;
        private readonly string _cachePosition;
        private readonly string _logitsToKeep;
        private readonly string _logits;
        private readonly List<(TensorInfo input, string output)> _cache = new List<(TensorInfo, string)>();

        private readonly List<int> _context = new List<int>();
        private readonly List<int> _generated = new List<int>();
        private readonly Dictionary<string, ModelTensor> _past = new Dictionary<string, ModelTensor>();
        private int _pastLength;
        private string _emitted = "";

        public bool Done { get; private set; }
        public string Reason { get; private set; }
        public int PromptTokens { get; }
        public int GeneratedTokens => _generated.Count;
        public bool UsesCache => _cache.Count > 0;
        /// <summary>止める目印より前の、確定した文章。</summary>
        public string Text { get; private set; } = "";

        /// <summary>このモデルで生成できるか。できなければ理由 (unsupportedInput:name など)。</summary>
        public static string Check(ModelSignature signature)
        {
            try
            {
                Plan(signature, out _, out _, out _, out _, out _, out _, out _, out _, out _, out _);
                return null;
            }
            catch (InvalidOperationException e)
            {
                return e.Message;
            }
        }

        public TextGenerationSession(HfTokenizer tokenizer, ModelSignature signature, int[] promptIds, GenerationOptions options)
        {
            _tokenizer = tokenizer ?? throw new ArgumentNullException(nameof(tokenizer));
            _signature = signature ?? throw new ArgumentNullException(nameof(signature));
            _options = options ?? new GenerationOptions();
            _random = _options.Seed.HasValue ? new Random(_options.Seed.Value) : new Random();

            Plan(signature, out _ids, out _mask, out _positions, out _tokenTypes, out _useCacheBranch,
                out _cachePosition, out _logitsToKeep, out _logits, out var cache, out _idsInfo);
            _cache.AddRange(cache);

            // プロンプトが長すぎたら先頭から捨てる (生成の分は空けておく)
            var prompt = new List<int>(promptIds ?? Array.Empty<int>());
            int room = Math.Max(1, _options.MaxContext - Math.Max(1, _options.MaxNewTokens));
            if (prompt.Count > room) prompt.RemoveRange(0, prompt.Count - room);
            if (prompt.Count == 0) throw new InvalidOperationException("emptyPrompt");
            _context.AddRange(prompt);
            PromptTokens = prompt.Count;

            foreach (var (input, _) in _cache) _past[input.Name] = EmptyPast(input);
        }

        private static void Plan(
            ModelSignature signature,
            out string ids, out string mask, out string positions, out string tokenTypes, out string useCacheBranch,
            out string cachePosition, out string logitsToKeep, out string logits,
            out List<(TensorInfo input, string output)> cache, out TensorInfo idsInfo)
        {
            ids = mask = positions = tokenTypes = useCacheBranch = cachePosition = logitsToKeep = logits = null;
            idsInfo = null;
            cache = new List<(TensorInfo, string)>();
            var pastInputs = new List<TensorInfo>();

            foreach (var input in signature.Inputs)
            {
                var name = input.Name ?? "";
                if (name == "input_ids") { ids = name; idsInfo = input; }
                else if (name == "attention_mask") mask = name;
                else if (name == "position_ids") positions = name;
                else if (name == "token_type_ids") tokenTypes = name;
                else if (name == "use_cache_branch") useCacheBranch = name;
                else if (name == "cache_position") cachePosition = name;
                else if (name == "num_logits_to_keep" || name == "logits_to_keep") logitsToKeep = name;
                else if (name.StartsWith("past", StringComparison.Ordinal)) pastInputs.Add(input);
                else if (ids == null && input.Kind != TensorKind.Float && (input.Shape == null || input.Shape.Length == 2)) { ids = name; idsInfo = input; }
                else throw new InvalidOperationException("unsupportedInput:" + name);
            }
            if (ids == null) throw new InvalidOperationException("noInputIds");

            foreach (var output in signature.Outputs)
            {
                if (output.Name == "logits") { logits = output.Name; break; }
            }
            if (logits == null)
            {
                foreach (var output in signature.Outputs)
                {
                    if (!output.Name.StartsWith("present", StringComparison.Ordinal)) { logits = output.Name; break; }
                }
            }
            if (logits == null) throw new InvalidOperationException("noLogits");

            if (pastInputs.Count > 0)
            {
                var presents = signature.Outputs.FindAll(o => o.Name.StartsWith("present", StringComparison.Ordinal));
                for (int i = 0; i < pastInputs.Count; i++)
                {
                    var input = pastInputs[i];
                    // 名前の付け方は書き出し方で違う。同じモデルの中に混ざっていることもある (Qwen3.5 の
                    // 畳み込み・再帰の状態は past_conv.0 → present_conv.0、注意のキャッシュは
                    // past_key_values.3.key → present.3.key)。
                    var match = signature.Output("present" + input.Name.Substring("past".Length));
                    if (match == null && input.Name.StartsWith("past_key_values", StringComparison.Ordinal))
                        match = signature.Output("present" + input.Name.Substring("past_key_values".Length));
                    if (match == null && presents.Count == pastInputs.Count) match = presents[i]; // それでも分からなければ順番で
                    if (match == null) throw new InvalidOperationException("noPresentFor:" + input.Name);
                    if (input.Shape == null) throw new InvalidOperationException("cacheShapeUnknown:" + input.Name);
                    cache.Add((input, match.Name));
                }
            }
        }

        /// <summary>
        /// 最初の一歩に渡す「空の」状態。
        ///
        /// 注意のキャッシュは長さの軸が決まっていない ([batch, heads, past_sequence_length, dim]) ので、
        /// そこを 0 にした空のテンソルを渡す。畳み込みや再帰の状態 (Qwen3.5 の past_conv / past_recurrent) は
        /// 大きさが決まっているので、その形のままゼロで埋める (0 にすると形が合わない)。
        /// 先頭はバッチなので 1。それ以外に決まっていない軸があるモデルは扱えない。
        /// </summary>
        private static ModelTensor EmptyPast(TensorInfo info)
        {
            var shape = (int[])info.Shape.Clone();
            for (int i = 0; i < shape.Length; i++)
            {
                if (shape[i] >= 0) continue;
                if (i == 0) shape[i] = 1;
                else if (i == shape.Length - 2) shape[i] = 0;
                else throw new InvalidOperationException("cacheShapeUnknown:" + info.Name);
            }
            return ModelTensor.Filled(info.Kind == TensorKind.Float ? TensorKind.Float : info.Kind, shape, 0);
        }

        /// <summary>次の一歩で流す入力。</summary>
        public Dictionary<string, ModelTensor> NextInputs()
        {
            if (Done) throw new InvalidOperationException("finished");

            // キャッシュがあれば、まだキャッシュに入っていないトークンだけを流す
            int start = UsesCache ? _pastLength : 0;
            int count = _context.Count - start;
            int past = UsesCache ? _pastLength : 0;

            var feed = new long[count];
            for (int i = 0; i < count; i++) feed[i] = _context[start + i];

            var inputs = new Dictionary<string, ModelTensor>();
            var idsKind = _idsInfo != null && _idsInfo.Kind == TensorKind.Int32 ? TensorKind.Int32 : TensorKind.Int64;
            inputs[_ids] = ModelTensor.Int64(new[] { 1, count }, feed).As(idsKind);

            if (_mask != null) inputs[_mask] = ModelTensor.Filled(TensorKind.Int64, new[] { 1, past + count }, 1);
            if (_tokenTypes != null) inputs[_tokenTypes] = ModelTensor.Filled(TensorKind.Int64, new[] { 1, count }, 0);
            if (_positions != null || _cachePosition != null)
            {
                var positions = new long[count];
                for (int i = 0; i < count; i++) positions[i] = past + i;
                if (_positions != null) inputs[_positions] = ModelTensor.Int64(new[] { 1, count }, positions);
                if (_cachePosition != null) inputs[_cachePosition] = ModelTensor.Int64(new[] { count }, positions);
            }
            if (_useCacheBranch != null) inputs[_useCacheBranch] = ModelTensor.Bool(new[] { 1 }, new long[] { past > 0 ? 1 : 0 });
            if (_logitsToKeep != null) inputs[_logitsToKeep] = ModelTensor.Int64(new int[0], new long[] { 1 });

            foreach (var (input, _) in _cache) inputs[input.Name] = _past[input.Name];
            return inputs;
        }

        /// <summary>出力を受け取り、次のトークンを選ぶ。</summary>
        public GenerationStep Accept(Dictionary<string, ModelTensor> outputs)
        {
            if (Done) return new GenerationStep { Done = true, Reason = Reason };
            if (outputs == null || !outputs.TryGetValue(_logits, out var logits))
                throw new InvalidOperationException("noLogitsOutput");

            // キャッシュを次の一歩のために持つ
            if (UsesCache)
            {
                foreach (var (input, output) in _cache)
                {
                    if (!outputs.TryGetValue(output, out var present)) throw new InvalidOperationException("noPresentOutput:" + output);
                    _past[input.Name] = present.Kind == input.Kind ? present : present.As(input.Kind);
                }
                _pastLength = _context.Count;
            }

            int vocab = logits.Dim(logits.Rank - 1);
            if (vocab <= 0 || logits.Length < vocab) throw new InvalidOperationException("badLogits:" + logits.ShapeText());
            int offset = logits.Length - vocab; // 最後の位置の行
            int next = Sampler.Next(logits.ToFloats(), offset, vocab, _options.Sampling, _context, _random);

            var step = new GenerationStep();
            if (_options.EndIds.Contains(next))
            {
                Finish(step, "eos");
                return step;
            }

            _context.Add(next);
            _generated.Add(next);

            var full = _tokenizer.Decode(_generated, true);
            if (_options.HideThinking) full = StripThinking(full);
            int stopAt = -1;
            foreach (var stop in _options.Stop)
            {
                if (string.IsNullOrEmpty(stop)) continue;
                int at = full.IndexOf(stop, StringComparison.Ordinal);
                if (at >= 0 && (stopAt < 0 || at < stopAt)) stopAt = at;
            }

            if (stopAt >= 0)
            {
                Text = full.Substring(0, stopAt);
                Finish(step, "stop");
                return step;
            }

            Text = full;
            if (_generated.Count >= _options.MaxNewTokens) { Finish(step, "length"); return step; }
            if (_context.Count >= _options.MaxContext) { Finish(step, "context"); return step; }

            // まだ確定していない所 (途中のマルチバイト文字、止める目印の書きかけ) は出さない
            var visible = HoldBack(full);
            step.Delta = Advance(visible);
            return step;
        }

        private void Finish(GenerationStep step, string reason)
        {
            Done = true;
            Reason = reason;
            step.Done = true;
            step.Reason = reason;
            step.Delta = Advance(Text);
        }

        private string Advance(string visible)
        {
            if (!visible.StartsWith(_emitted, StringComparison.Ordinal)) return "";
            var delta = visible.Substring(_emitted.Length);
            _emitted = visible;
            return delta;
        }

        /// <summary>&lt;think&gt; … &lt;/think&gt; を落とす。閉じる前は「まだ答えは出ていない」として空。</summary>
        private static string StripThinking(string text)
        {
            int close = text.IndexOf("</think>", StringComparison.Ordinal);
            if (close >= 0) return text.Substring(close + "</think>".Length).TrimStart('\n', '\r', ' ');
            return text.TrimStart().StartsWith("<think>", StringComparison.Ordinal) ? "" : text;
        }

        private string HoldBack(string text)
        {
            int end = text.Length;
            while (end > 0 && text[end - 1] == '�') end--;
            foreach (var stop in _options.Stop)
            {
                if (string.IsNullOrEmpty(stop)) continue;
                for (int k = Math.Min(stop.Length - 1, end); k > 0; k--)
                {
                    if (string.CompareOrdinal(text, end - k, stop, 0, k) == 0) { end -= k; break; }
                }
            }
            return text.Substring(0, end);
        }

        public GenerationResult ToResult(string reasonOverride = null, string error = null, double ms = 0) => new GenerationResult
        {
            Ok = error == null,
            Text = Text,
            PromptTokens = PromptTokens,
            Tokens = _generated.Count,
            Reason = reasonOverride ?? Reason,
            Error = error,
            Ms = ms,
            UsedCache = UsesCache,
        };
    }

    /// <summary>
    /// セッションを推論器で回す。推論器が同期でも非同期でも動く
    /// (同期のときは再帰せずにループで回す。トークン数だけスタックが深くならないように)。
    /// </summary>
    public sealed class TextGenerationDriver
    {
        private readonly IModelRunner _runner;
        private readonly ModelRef _model;
        private readonly TextGenerationSession _session;
        private readonly Action<string, string> _onDelta;
        private readonly Action<GenerationResult> _onDone;
        private readonly Stopwatch _clock = new Stopwatch();

        private bool _pumping;
        private bool _again;
        private bool _cancelled;

        public bool Finished { get; private set; }

        public TextGenerationDriver(IModelRunner runner, ModelRef model, TextGenerationSession session,
            Action<string, string> onDelta, Action<GenerationResult> onDone)
        {
            _runner = runner;
            _model = model;
            _session = session;
            _onDelta = onDelta;
            _onDone = onDone;
        }

        public void Start()
        {
            _clock.Start();
            Pump();
        }

        /// <summary>次の一歩の前で止める (走っている推論は最後まで行く)。</summary>
        public void Cancel() => _cancelled = true;

        private void Pump()
        {
            if (_pumping) { _again = true; return; }
            _pumping = true;
            do
            {
                _again = false;
                StepOnce();
            } while (_again && !Finished);
            _pumping = false;
        }

        private void StepOnce()
        {
            if (Finished) return;
            if (_cancelled) { Complete(_session.ToResult("cancelled", null, _clock.Elapsed.TotalMilliseconds)); return; }

            Dictionary<string, ModelTensor> inputs;
            try
            {
                inputs = _session.NextInputs();
            }
            catch (Exception e)
            {
                Complete(_session.ToResult("error", e.Message, _clock.Elapsed.TotalMilliseconds));
                return;
            }

            _runner.Run(_model, inputs, result =>
            {
                if (Finished) return;
                if (result == null || !result.Ok)
                {
                    Complete(_session.ToResult("error", result?.Error ?? "runFailed", _clock.Elapsed.TotalMilliseconds));
                    return;
                }

                GenerationStep step;
                try
                {
                    step = _session.Accept(result.Outputs);
                }
                catch (Exception e)
                {
                    Complete(_session.ToResult("error", e.Message, _clock.Elapsed.TotalMilliseconds));
                    return;
                }

                if (!string.IsNullOrEmpty(step.Delta))
                {
                    try { _onDelta?.Invoke(step.Delta, _session.Text); }
                    catch { /* 呼び出し側の失敗で生成を止めない */ }
                }
                if (step.Done) { Complete(_session.ToResult(null, null, _clock.Elapsed.TotalMilliseconds)); return; }
                Pump();
            });
        }

        private void Complete(GenerationResult result)
        {
            if (Finished) return;
            Finished = true;
            _clock.Stop();
            _onDone?.Invoke(result);
        }
    }
}
