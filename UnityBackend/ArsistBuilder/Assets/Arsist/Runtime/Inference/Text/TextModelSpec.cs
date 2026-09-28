// ==============================================
// Arsist Engine - Inference / Text
// 文章のモデルの定義 (IR の ModelDefinition.text をそのまま写したもの)
//
// ONNX に書かれていないこと (どの分割器か、どの会話の書式か、どこで止めるか、
// 埋め込みをどうまとめるか) だけを持つ。重みは ONNX のまま。
//
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Inference.Text
{
    public sealed class TextModelSpec
    {
        /// <summary>"generate" (LLM) / "embed" (文の埋め込み) / "classify" (文章の分類)</summary>
        public string Task = "generate";
        /// <summary>tokenizer.json のパス。エディタではプロジェクト相対、ツールでは絶対、実機では使わない (Resources)。</summary>
        public string Tokenizer;

        // ---- generate ----
        public string ChatFormat = "chatml";
        /// <summary>ChatFormat が custom のときの型。{system} と {prompt} を埋める。</summary>
        public string PromptTemplate;
        public string SystemPrompt;
        public int MaxNewTokens = 128;
        public double Temperature = 0.7;
        public int TopK = 40;
        public double TopP = 0.95;
        public double RepetitionPenalty = 1.1;
        public string[] Stop = Array.Empty<string>();
        /// <summary>生成を止めるトークン (文字列)。&lt;|im_end|&gt; など。</summary>
        public string[] EosTokens = Array.Empty<string>();
        /// <summary>プロンプトと生成を合わせた長さの上限 (トークン)。超えた分はプロンプトの先頭から捨てる。</summary>
        public int MaxContext = 2048;
        /// <summary>考えている途中 (&lt;think&gt; … &lt;/think&gt;) を答えから外す。</summary>
        public bool HideThinking = true;

        // ---- embed / classify ----
        /// <summary>"mean" / "cls" / "last"。出力が既に [1, D] ならそのまま使う。</summary>
        public string Pooling = "mean";
        public bool Normalize = true;
        /// <summary>使う出力の名前。省略時は既知の名前から探す。</summary>
        public string OutputName;
        /// <summary>入力の長さの上限 (トークン)。</summary>
        public int MaxLength = 256;
        public string[] Labels = Array.Empty<string>();

        public static TextModelSpec FromPlain(Dictionary<string, object> plain)
        {
            var spec = new TextModelSpec();
            if (plain == null) return spec;
            spec.Task = MiniJson.Text(plain, "task", spec.Task);
            spec.Tokenizer = MiniJson.Text(plain, "tokenizer");
            spec.ChatFormat = MiniJson.Text(plain, "chatFormat", spec.ChatFormat);
            spec.PromptTemplate = MiniJson.Text(plain, "promptTemplate");
            spec.SystemPrompt = MiniJson.Text(plain, "systemPrompt");
            spec.MaxNewTokens = MiniJson.Int(plain, "maxNewTokens", spec.MaxNewTokens);
            spec.Temperature = MiniJson.Number(plain, "temperature", spec.Temperature);
            spec.TopK = MiniJson.Int(plain, "topK", spec.TopK);
            spec.TopP = MiniJson.Number(plain, "topP", spec.TopP);
            spec.RepetitionPenalty = MiniJson.Number(plain, "repetitionPenalty", spec.RepetitionPenalty);
            spec.Stop = MiniJson.Strings(plain, "stop");
            spec.EosTokens = MiniJson.Strings(plain, "eosTokens");
            spec.MaxContext = MiniJson.Int(plain, "maxContext", spec.MaxContext);
            spec.HideThinking = MiniJson.Bool(plain, "hideThinking", spec.HideThinking);
            spec.Pooling = MiniJson.Text(plain, "pooling", spec.Pooling);
            spec.Normalize = MiniJson.Bool(plain, "normalize", spec.Normalize);
            spec.OutputName = MiniJson.Text(plain, "outputName");
            spec.MaxLength = MiniJson.Int(plain, "maxLength", spec.MaxLength);
            spec.Labels = MiniJson.Strings(plain, "labels");
            return spec;
        }

        /// <summary>生成の設定を作る。overrides (スクリプトの options) があれば上書きする。</summary>
        public GenerationOptions ToGenerationOptions(HfTokenizer tokenizer, Dictionary<string, object> overrides = null)
        {
            var options = new GenerationOptions
            {
                MaxNewTokens = MiniJson.Int(overrides, "maxNewTokens", MaxNewTokens),
                MaxContext = MiniJson.Int(overrides, "maxContext", MaxContext),
                HideThinking = MiniJson.Bool(overrides, "hideThinking", HideThinking),
                Sampling = new SamplingOptions
                {
                    Temperature = MiniJson.Number(overrides, "temperature", Temperature),
                    TopK = MiniJson.Int(overrides, "topK", TopK),
                    TopP = MiniJson.Number(overrides, "topP", TopP),
                    RepetitionPenalty = MiniJson.Number(overrides, "repetitionPenalty", RepetitionPenalty),
                },
            };
            if (overrides != null && overrides.TryGetValue("seed", out var seed) && seed is double s) options.Seed = (int)s;

            var stop = new List<string>(Stop);
            foreach (var extra in MiniJson.Strings(overrides, "stop")) if (!stop.Contains(extra)) stop.Add(extra);
            options.Stop = stop.ToArray();

            // 止める目印: 定義の eos + 書式の「発言の終わり」。語彙に無いものは捨てる。
            var ends = new List<string>(EosTokens);
            ends.AddRange(Text.ChatFormat.EndTokens(ChatFormat));
            foreach (var end in ends)
            {
                var id = tokenizer.IdOf(end);
                if (id.HasValue) options.EndIds.Add(id.Value);
            }
            return options;
        }

        /// <summary>プロンプト (または会話) をモデルに渡す文章にする。raw なら書式を使わない。</summary>
        public string RenderPrompt(IList<ChatMessage> messages, bool raw)
        {
            if (raw) return Text.ChatFormat.Render("none", messages);
            return Text.ChatFormat.Render(ChatFormat, messages, PromptTemplate);
        }
    }
}
