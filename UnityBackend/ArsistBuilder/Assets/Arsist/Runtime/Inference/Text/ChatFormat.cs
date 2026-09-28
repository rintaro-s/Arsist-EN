// ==============================================
// Arsist Engine - Inference / Text
// 会話をモデルが学習した書式の文章にする
//
// 指示に従う LLM は、学習したときと同じ書式 (ChatML の <|im_start|> など) で話しかけないと
// まともに答えない。HuggingFace は書式を Jinja で配っているが、Jinja を実装するのは重いので、
// よく使われる書式を名前で選べるようにし、それ以外は {system} / {prompt} を埋める型で書けるようにする。
//
//   chatml  Qwen / SmolLM / 多くの派生      llama3  Llama 3.x
//   phi3    Phi-3 / Phi-3.5                gemma   Gemma
//   mistral Mistral / Llama 2              none    そのまま (補完用のモデル)
//
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;
using System.Text;

namespace Arsist.Runtime.Inference.Text
{
    public sealed class ChatMessage
    {
        /// <summary>"system" / "user" / "assistant"</summary>
        public string Role;
        public string Content;

        public ChatMessage(string role, string content)
        {
            Role = role ?? "user";
            Content = content ?? "";
        }
    }

    public static class ChatFormat
    {
        public static readonly string[] Names = { "chatml", "llama3", "phi3", "gemma", "mistral", "none", "custom" };

        /// <summary>
        /// 会話を 1 本の文章にする。最後は「アシスタントが話し始める所」で終わる。
        /// custom のときは template の {system} と {prompt} を埋める (最後の user の発言が prompt)。
        /// </summary>
        public static string Render(string format, IList<ChatMessage> messages, string template = null)
        {
            messages ??= new List<ChatMessage>();
            string system = null;
            var turns = new List<ChatMessage>();
            foreach (var m in messages)
            {
                if (string.Equals(m.Role, "system", StringComparison.OrdinalIgnoreCase))
                    system = string.IsNullOrEmpty(system) ? m.Content : system + "\n" + m.Content;
                else turns.Add(m);
            }

            var sb = new StringBuilder();
            switch ((format ?? "chatml").ToLowerInvariant())
            {
                case "chatml":
                    if (!string.IsNullOrEmpty(system)) sb.Append("<|im_start|>system\n").Append(system).Append("<|im_end|>\n");
                    foreach (var t in turns) sb.Append("<|im_start|>").Append(Role(t)).Append('\n').Append(t.Content).Append("<|im_end|>\n");
                    sb.Append("<|im_start|>assistant\n");
                    return sb.ToString();

                case "llama3":
                    sb.Append("<|begin_of_text|>");
                    if (!string.IsNullOrEmpty(system))
                        sb.Append("<|start_header_id|>system<|end_header_id|>\n\n").Append(system).Append("<|eot_id|>");
                    foreach (var t in turns)
                        sb.Append("<|start_header_id|>").Append(Role(t)).Append("<|end_header_id|>\n\n").Append(t.Content).Append("<|eot_id|>");
                    sb.Append("<|start_header_id|>assistant<|end_header_id|>\n\n");
                    return sb.ToString();

                case "phi3":
                    if (!string.IsNullOrEmpty(system)) sb.Append("<|system|>\n").Append(system).Append("<|end|>\n");
                    foreach (var t in turns) sb.Append("<|").Append(Role(t)).Append("|>\n").Append(t.Content).Append("<|end|>\n");
                    sb.Append("<|assistant|>\n");
                    return sb.ToString();

                case "gemma":
                {
                    // Gemma に system の役は無い。最初の user の発言の前に置く。
                    sb.Append("<bos>");
                    bool first = true;
                    foreach (var t in turns)
                    {
                        var role = Role(t) == "assistant" ? "model" : "user";
                        var content = t.Content;
                        if (first && role == "user" && !string.IsNullOrEmpty(system)) content = system + "\n\n" + content;
                        first = false;
                        sb.Append("<start_of_turn>").Append(role).Append('\n').Append(content).Append("<end_of_turn>\n");
                    }
                    sb.Append("<start_of_turn>model\n");
                    return sb.ToString();
                }

                case "mistral":
                {
                    sb.Append("<s>");
                    bool first = true;
                    foreach (var t in turns)
                    {
                        if (Role(t) == "assistant")
                        {
                            sb.Append(' ').Append(t.Content).Append("</s>");
                            continue;
                        }
                        var content = t.Content;
                        if (first && !string.IsNullOrEmpty(system)) content = system + "\n\n" + content;
                        first = false;
                        sb.Append("[INST] ").Append(content).Append(" [/INST]");
                    }
                    return sb.ToString();
                }

                case "custom":
                {
                    string prompt = "";
                    for (int i = turns.Count - 1; i >= 0; i--)
                    {
                        if (Role(turns[i]) == "user") { prompt = turns[i].Content; break; }
                    }
                    return (template ?? "{prompt}").Replace("{system}", system ?? "").Replace("{prompt}", prompt);
                }

                default: // none: 発言を改行で繋ぐだけ (補完用)
                {
                    if (!string.IsNullOrEmpty(system)) sb.Append(system).Append("\n\n");
                    for (int i = 0; i < turns.Count; i++)
                    {
                        if (i > 0) sb.Append('\n');
                        sb.Append(turns[i].Content);
                    }
                    return sb.ToString();
                }
            }
        }

        private static string Role(ChatMessage m)
        {
            var role = (m.Role ?? "user").ToLowerInvariant();
            return role == "assistant" || role == "model" ? "assistant" : role == "system" ? "system" : "user";
        }

        /// <summary>書式ごとの「発言の終わり」のトークン。生成を止める目印に足す。</summary>
        public static string[] EndTokens(string format)
        {
            switch ((format ?? "").ToLowerInvariant())
            {
                case "chatml": return new[] { "<|im_end|>", "<|endoftext|>" };
                case "llama3": return new[] { "<|eot_id|>", "<|end_of_text|>" };
                case "phi3": return new[] { "<|end|>", "<|endoftext|>" };
                case "gemma": return new[] { "<end_of_turn>", "<eos>" };
                case "mistral": return new[] { "</s>" };
                default: return Array.Empty<string>();
            }
        }
    }
}
