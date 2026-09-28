// ==============================================
// Arsist Engine - Inference / Text
// 次のトークンを選ぶ (温度・top-k・top-p・繰り返しの抑制)
//
// 語彙は 15 万語を超えることがあるので、全体を並べ替えない。top-k は大きさ k のヒープで拾う。
// 温度 0 は「一番強いものを選ぶ」(毎回同じ答え)。
//
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Inference.Text
{
    public sealed class SamplingOptions
    {
        /// <summary>0 以下なら一番強いトークンを選ぶ (決まった答え)。</summary>
        public double Temperature = 0.7;
        /// <summary>上位いくつから選ぶか。0 以下なら全体 (遅い)。</summary>
        public int TopK = 40;
        /// <summary>確率の累積がここに達するまでの候補から選ぶ。1 なら使わない。</summary>
        public double TopP = 0.95;
        /// <summary>既に出たトークンを出にくくする。1 なら使わない。</summary>
        public double RepetitionPenalty = 1.1;
    }

    public static class Sampler
    {
        /// <summary>
        /// logits[offset .. offset+vocab) から次のトークンを選ぶ。history は既に出たトークン (繰り返しの抑制用)。
        /// logits は書き換えない。
        /// </summary>
        public static int Next(float[] logits, int offset, int vocab, SamplingOptions options, IEnumerable<int> history, Random random)
        {
            options ??= new SamplingOptions();

            // 繰り返しの抑制は、対象のトークンだけ値を変えて持つ (配列を複製しない)
            Dictionary<int, float> penalized = null;
            if (history != null && options.RepetitionPenalty > 0 && Math.Abs(options.RepetitionPenalty - 1) > 1e-6)
            {
                penalized = new Dictionary<int, float>();
                foreach (var id in history)
                {
                    if (id < 0 || id >= vocab || penalized.ContainsKey(id)) continue;
                    float v = logits[offset + id];
                    penalized[id] = v > 0 ? (float)(v / options.RepetitionPenalty) : (float)(v * options.RepetitionPenalty);
                }
            }
            float Value(int id) => penalized != null && penalized.TryGetValue(id, out var p) ? p : logits[offset + id];

            if (options.Temperature <= 0)
            {
                int best = 0;
                float bestValue = float.NegativeInfinity;
                for (int i = 0; i < vocab; i++)
                {
                    float v = Value(i);
                    if (v > bestValue) { bestValue = v; best = i; }
                }
                return best;
            }

            int k = options.TopK > 0 ? Math.Min(options.TopK, vocab) : vocab;
            var top = TopK(Value, vocab, k); // 強い順

            // 温度つきの softmax (候補の中だけ)
            double max = top[0].value;
            var probs = new double[top.Count];
            double sum = 0;
            for (int i = 0; i < top.Count; i++)
            {
                probs[i] = Math.Exp((top[i].value - max) / options.Temperature);
                sum += probs[i];
            }
            for (int i = 0; i < probs.Length; i++) probs[i] /= sum;

            int count = probs.Length;
            if (options.TopP > 0 && options.TopP < 1)
            {
                double cumulative = 0;
                for (int i = 0; i < probs.Length; i++)
                {
                    cumulative += probs[i];
                    if (cumulative >= options.TopP) { count = i + 1; break; }
                }
            }

            double total = 0;
            for (int i = 0; i < count; i++) total += probs[i];
            double r = random.NextDouble() * total;
            for (int i = 0; i < count; i++)
            {
                r -= probs[i];
                if (r <= 0) return top[i].id;
            }
            return top[count - 1].id;
        }

        /// <summary>値の大きい順に k 個。最小ヒープで拾ってから並べる。</summary>
        public static List<(int id, float value)> TopK(Func<int, float> value, int vocab, int k)
        {
            var heap = new List<(int id, float value)>(k + 1);
            for (int i = 0; i < vocab; i++)
            {
                float v = value(i);
                if (float.IsNaN(v)) continue;
                if (heap.Count < k)
                {
                    heap.Add((i, v));
                    SiftUp(heap, heap.Count - 1);
                }
                else if (v > heap[0].value)
                {
                    heap[0] = (i, v);
                    SiftDown(heap, 0);
                }
            }
            heap.Sort((a, b) => b.value.CompareTo(a.value));
            if (heap.Count == 0) heap.Add((0, 0f));
            return heap;
        }

        private static void SiftUp(List<(int id, float value)> heap, int i)
        {
            while (i > 0)
            {
                int parent = (i - 1) / 2;
                if (heap[parent].value <= heap[i].value) break;
                (heap[parent], heap[i]) = (heap[i], heap[parent]);
                i = parent;
            }
        }

        private static void SiftDown(List<(int id, float value)> heap, int i)
        {
            while (true)
            {
                int left = 2 * i + 1, right = left + 1, smallest = i;
                if (left < heap.Count && heap[left].value < heap[smallest].value) smallest = left;
                if (right < heap.Count && heap[right].value < heap[smallest].value) smallest = right;
                if (smallest == i) return;
                (heap[smallest], heap[i]) = (heap[i], heap[smallest]);
                i = smallest;
            }
        }

        /// <summary>softmax (分類の出力用)。</summary>
        public static double[] Softmax(float[] values, int offset, int count)
        {
            double max = double.NegativeInfinity;
            for (int i = 0; i < count; i++) max = Math.Max(max, values[offset + i]);
            var result = new double[count];
            double sum = 0;
            for (int i = 0; i < count; i++)
            {
                result[i] = Math.Exp(values[offset + i] - max);
                sum += result[i];
            }
            for (int i = 0; i < count; i++) result[i] /= sum;
            return result;
        }
    }
}
