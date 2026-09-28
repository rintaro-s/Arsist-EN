// ==============================================
// Arsist Engine - Inference / Text
// 文章を 1 回流すモデル (文の埋め込み・文章の分類) の入出力
//
// 埋め込み: 文を数百次元のベクトルにする (all-MiniLM-L6-v2 など)。似た意味の文ほど
// ベクトルの向きが近い。「言われたことに一番近い操作を選ぶ」「メモを意味で探す」に使う。
// 分類: 文章にラベルを付ける (感情、意図など)。
//
// BERT 系の書き出しは input_ids / attention_mask / token_type_ids を取り、
// last_hidden_state [1, n, D] (または sentence_embedding [1, D]) か logits [1, C] を出す。
//
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Inference.Text
{
    public static class TextEncoding
    {
        /// <summary>1 文を入力にする。長すぎたら最後のトークン ([SEP] など) を残して切る。</summary>
        public static Dictionary<string, ModelTensor> Inputs(
            HfTokenizer tokenizer, ModelSignature signature, string text, int maxLength, out int tokenCount, out string error)
        {
            error = null;
            var ids = tokenizer.Encode(text ?? "", true);
            if (maxLength > 1 && ids.Length > maxLength)
            {
                var cut = new int[maxLength];
                Array.Copy(ids, cut, maxLength - 1);
                cut[maxLength - 1] = ids[ids.Length - 1];
                ids = cut;
            }
            tokenCount = ids.Length;
            if (ids.Length == 0) { error = "emptyText"; return null; }

            var feed = new long[ids.Length];
            for (int i = 0; i < ids.Length; i++) feed[i] = ids[i];

            var inputs = new Dictionary<string, ModelTensor>();
            foreach (var input in signature.Inputs)
            {
                var shape = new[] { 1, ids.Length };
                switch (input.Name)
                {
                    case "input_ids":
                        inputs[input.Name] = ModelTensor.Int64(shape, feed).As(input.Kind == TensorKind.Float ? TensorKind.Int64 : input.Kind);
                        break;
                    case "attention_mask":
                        inputs[input.Name] = ModelTensor.Filled(input.Kind == TensorKind.Float ? TensorKind.Int64 : input.Kind, shape, 1);
                        break;
                    case "token_type_ids":
                        inputs[input.Name] = ModelTensor.Filled(input.Kind == TensorKind.Float ? TensorKind.Int64 : input.Kind, shape, 0);
                        break;
                    case "position_ids":
                    {
                        var positions = new long[ids.Length];
                        for (int i = 0; i < positions.Length; i++) positions[i] = i;
                        inputs[input.Name] = ModelTensor.Int64(shape, positions);
                        break;
                    }
                    default:
                        if (!inputs.ContainsKey("input_ids") && input.Kind != TensorKind.Float && !signature.HasInput("input_ids"))
                        {
                            inputs[input.Name] = ModelTensor.Int64(shape, feed).As(input.Kind);
                            break;
                        }
                        error = "unsupportedInput:" + input.Name;
                        return null;
                }
            }
            return inputs;
        }

        private static readonly string[] EmbeddingNames = { "sentence_embedding", "embeddings", "text_embeds", "sentence_embeddings" };

        /// <summary>出力から文のベクトルを取り出す。</summary>
        public static float[] Embedding(
            Dictionary<string, ModelTensor> outputs, int tokenCount, string pooling, bool normalize, string outputName, out string error)
        {
            error = null;
            ModelTensor tensor = null;
            if (!string.IsNullOrEmpty(outputName)) outputs.TryGetValue(outputName, out tensor);
            if (tensor == null) foreach (var name in EmbeddingNames) if (outputs.TryGetValue(name, out tensor)) break;
            if (tensor == null) outputs.TryGetValue("last_hidden_state", out tensor);
            if (tensor == null) foreach (var pair in outputs) { tensor = pair.Value; break; }
            if (tensor == null) { error = "noOutputs"; return null; }

            var data = tensor.ToFloats();
            float[] vector;
            if (tensor.Rank <= 2)
            {
                int d = tensor.Dim(tensor.Rank - 1);
                vector = new float[d];
                Array.Copy(data, 0, vector, 0, d);
            }
            else
            {
                int n = tensor.Dim(tensor.Rank - 2), d = tensor.Dim(tensor.Rank - 1);
                int used = Math.Max(1, Math.Min(n, tokenCount > 0 ? tokenCount : n));
                vector = new float[d];
                switch ((pooling ?? "mean").ToLowerInvariant())
                {
                    case "cls":
                        Array.Copy(data, 0, vector, 0, d);
                        break;
                    case "last":
                        Array.Copy(data, (used - 1) * d, vector, 0, d);
                        break;
                    default:
                        for (int t = 0; t < used; t++)
                            for (int j = 0; j < d; j++) vector[j] += data[t * d + j];
                        for (int j = 0; j < d; j++) vector[j] /= used;
                        break;
                }
            }

            if (normalize)
            {
                double norm = 0;
                foreach (var v in vector) norm += v * v;
                norm = Math.Sqrt(norm);
                if (norm > 1e-12) for (int j = 0; j < vector.Length; j++) vector[j] = (float)(vector[j] / norm);
            }
            return vector;
        }

        /// <summary>分類の出力 (logits [1, C]) を確率の高い順に。</summary>
        public static List<(int index, double score)> Classify(
            Dictionary<string, ModelTensor> outputs, string outputName, bool softmax, int topK, out string error)
        {
            error = null;
            ModelTensor tensor = null;
            if (!string.IsNullOrEmpty(outputName)) outputs.TryGetValue(outputName, out tensor);
            if (tensor == null) outputs.TryGetValue("logits", out tensor);
            if (tensor == null) foreach (var pair in outputs) { tensor = pair.Value; break; }
            if (tensor == null) { error = "noOutputs"; return null; }

            int c = tensor.Dim(tensor.Rank - 1);
            var data = tensor.ToFloats();
            double[] scores;
            if (softmax) scores = Sampler.Softmax(data, 0, c);
            else
            {
                scores = new double[c];
                for (int i = 0; i < c; i++) scores[i] = data[i];
            }
            var ranked = new List<(int, double)>(c);
            for (int i = 0; i < c; i++) ranked.Add((i, scores[i]));
            ranked.Sort((a, b) => b.Item2.CompareTo(a.Item2));
            if (topK > 0 && ranked.Count > topK) ranked.RemoveRange(topK, ranked.Count - topK);
            return ranked;
        }

        /// <summary>コサイン類似度 (-1..1)。長さが違えば 0。</summary>
        public static double Cosine(IList<float> a, IList<float> b)
        {
            if (a == null || b == null || a.Count != b.Count || a.Count == 0) return 0;
            double dot = 0, na = 0, nb = 0;
            for (int i = 0; i < a.Count; i++)
            {
                dot += a[i] * b[i];
                na += a[i] * a[i];
                nb += b[i] * b[i];
            }
            if (na <= 0 || nb <= 0) return 0;
            return dot / (Math.Sqrt(na) * Math.Sqrt(nb));
        }
    }
}
