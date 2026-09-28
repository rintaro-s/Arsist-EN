// ==============================================
// Arsist Engine - Inference
// モデルを「用途」で使う口 (スクリプトの model.* と エディタの「試す」が同じものを呼ぶ)
//
//   run         名前つきのテンソルを渡して、そのまま出力を受け取る (どんな ONNX でも)
//   generate    LLM に文章を書かせる (1 トークンずつ届く)
//   embed       文をベクトルにする
//   classifyText 文章にラベルを付ける
//   runImage    画像のモデル (分類 / 検出 / 分割) を 1 枚の画に掛ける
//   tokenize / detokenize
//
// 推論器 (IModelRunner) と tokenizer.json の読み方は外から渡す。実機では Inference Engine と
// Resources、エディタのツールでは ONNX Runtime とファイル。ここはどちらでも同じに動く。
//
// 結果は素の木 (Dictionary / List / 数 / 文字列) で返す。スクリプトにはそのまま JSON で渡せる。
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Inference.Text;
using Arsist.Runtime.Perception.Models;
using Arsist.Runtime.Perception.Pipeline;
using Arsist.Runtime.Perception.Vision.Classic;

namespace Arsist.Runtime.Inference
{
    /// <summary>IR の ModelDefinition 1 つ分。</summary>
    public sealed class ModelEntry
    {
        public string Id;
        public string Name;
        /// <summary>"image" / "text" / "tensor"</summary>
        public string Use = "image";
        public string File;
        public string Backend = "auto";
        /// <summary>実機で何に動かしてもらうか ("unity" / "onnxruntime")。ビルド時に決まる。</summary>
        public string Runtime = "unity";
        /// <summary>APK に入れたファイルの名前 (ONNX Runtime 用。端末側へ写すときに使う)。</summary>
        public List<string> Files = new List<string>();
        public Dictionary<string, object> Plain;
        /// <summary>use が image のときの読み方 (画像認識の `infer` op と同じ)。</summary>
        public ModelSpec Image;
        /// <summary>use が text のときの設定。</summary>
        public TextModelSpec Text;

        public ModelRef Ref => new ModelRef { Id = Id, File = File, Backend = Backend };

        public static ModelEntry FromPlain(Dictionary<string, object> plain)
        {
            if (plain == null) return null;
            var entry = new ModelEntry
            {
                Id = MiniJson.Text(plain, "id"),
                Name = MiniJson.Text(plain, "name"),
                Use = MiniJson.Text(plain, "use", "image"),
                File = MiniJson.Text(plain, "file"),
                Backend = MiniJson.Text(plain, "backend", "auto"),
                Runtime = MiniJson.Text(plain, "runtime", "unity"),
                Plain = plain,
            };
            foreach (var name in MiniJson.Strings(plain, "files")) entry.Files.Add(name);
            if (string.IsNullOrEmpty(entry.Id)) return null;
            if (entry.Use == "image") entry.Image = ModelSpec.FromPlain(plain);
            if (entry.Use == "text") entry.Text = TextModelSpec.FromPlain(MiniJson.Obj(plain, "text"));
            return entry;
        }

        public Dictionary<string, object> Summary() => new Dictionary<string, object>
        {
            ["id"] = Id,
            ["name"] = Name,
            ["use"] = Use,
            ["runtime"] = Runtime,
            ["task"] = Use == "text" ? Text?.Task : Use == "image" ? MiniJson.Text(Plain, "task") : null,
        };
    }

    public sealed class InferenceService
    {
        /// <summary>
        /// モデルごとの推論器。実機では Unity の Inference Engine と、同梱の ONNX Runtime の 2 つがあり、
        /// モデルによって使い分ける (Unity が読めない書き出しは ONNX Runtime へ)。
        /// まだ用意できていなければ null を返してよい (「準備中」として断る)。
        /// </summary>
        private readonly Func<ModelEntry, IModelRunner> _runnerFor;
        private readonly Func<ModelEntry, string> _tokenizerJson;
        private readonly Dictionary<string, ModelEntry> _models = new Dictionary<string, ModelEntry>(StringComparer.Ordinal);
        private readonly Dictionary<string, HfTokenizer> _tokenizers = new Dictionary<string, HfTokenizer>(StringComparer.Ordinal);
        private readonly Dictionary<string, TextGenerationDriver> _generating = new Dictionary<string, TextGenerationDriver>(StringComparer.Ordinal);

        /// <param name="tokenizerJson">モデルの tokenizer.json の中身を返す (無ければ null)。</param>
        public InferenceService(IModelRunner runner, IEnumerable<ModelEntry> models, Func<ModelEntry, string> tokenizerJson)
            : this(_ => runner, models, tokenizerJson)
        {
        }

        public InferenceService(Func<ModelEntry, IModelRunner> runnerFor, IEnumerable<ModelEntry> models, Func<ModelEntry, string> tokenizerJson)
        {
            _runnerFor = runnerFor;
            _tokenizerJson = tokenizerJson;
            if (models != null) foreach (var m in models) if (m != null) _models[m.Id] = m;
        }

        /// <summary>そのモデルを動かすもの。まだ用意できていなければ null。</summary>
        private IModelRunner RunnerFor(ModelEntry entry) => _runnerFor?.Invoke(entry);

        public IEnumerable<ModelEntry> Models => _models.Values;

        /// <summary>id か名前で引く (スクリプトで名前を書けると読みやすい)。</summary>
        public ModelEntry Find(string idOrName)
        {
            if (string.IsNullOrEmpty(idOrName)) return null;
            if (_models.TryGetValue(idOrName, out var byId)) return byId;
            foreach (var m in _models.Values) if (string.Equals(m.Name, idOrName, StringComparison.Ordinal)) return m;
            return null;
        }

        // ---- 形 ----

        public Dictionary<string, object> Info(string idOrName, out string error)
        {
            var entry = Find(idOrName);
            if (entry == null) { error = "modelMissing:" + idOrName; return null; }
            var runner = RunnerFor(entry);
            if (runner == null) { error = "modelNotReady"; return null; }
            if (!runner.TryDescribe(entry.Ref, out var signature, out error)) return null;
            var info = signature.ToPlain();
            foreach (var pair in entry.Summary()) info[pair.Key] = pair.Value;
            return info;
        }

        // ---- run: テンソルをそのまま ----

        /// <param name="inputs">{ 入力名: { type?, shape?, data } | 数の配列 }</param>
        public void Run(string idOrName, Dictionary<string, object> inputs, int maxValues, Action<Dictionary<string, object>> done)
        {
            var entry = Find(idOrName);
            if (entry == null) { done(Failure("modelMissing:" + idOrName)); return; }
            var runner = RunnerFor(entry);
            if (runner == null) { done(Failure("modelNotReady")); return; }
            if (!runner.TryDescribe(entry.Ref, out var signature, out var describeError)) { done(Failure(describeError)); return; }

            var tensors = new Dictionary<string, ModelTensor>();
            foreach (var info in signature.Inputs)
            {
                if (inputs == null || !inputs.TryGetValue(info.Name, out var raw))
                {
                    done(Failure("missingInput:" + info.Name));
                    return;
                }
                var tensor = ModelTensor.FromPlain(raw, info, out var error);
                if (tensor == null) { done(Failure($"badInput:{info.Name}:{error}")); return; }
                tensors[info.Name] = tensor;
            }

            runner.Run(entry.Ref, tensors, result =>
            {
                if (!result.Ok) { done(Failure(result.Error)); return; }
                var outputs = new Dictionary<string, object>();
                foreach (var pair in result.Outputs) outputs[pair.Key] = pair.Value.ToPlain(maxValues);
                done(new Dictionary<string, object> { ["ok"] = true, ["ms"] = Math.Round(result.Ms), ["outputs"] = outputs });
            });
        }

        // ---- 文章 ----

        public HfTokenizer Tokenizer(ModelEntry entry, out string error)
        {
            error = null;
            if (entry == null) { error = "modelMissing"; return null; }
            if (_tokenizers.TryGetValue(entry.Id, out var cached)) return cached;
            string json;
            try { json = _tokenizerJson?.Invoke(entry); }
            catch (Exception e) { error = "tokenizerUnreadable:" + e.Message; return null; }
            if (string.IsNullOrEmpty(json)) { error = "tokenizerMissing"; return null; }
            try
            {
                var tokenizer = HfTokenizer.Load(json);
                _tokenizers[entry.Id] = tokenizer;
                return tokenizer;
            }
            catch (Exception e)
            {
                error = "tokenizerUnreadable:" + e.Message;
                return null;
            }
        }

        public int[] Tokenize(string idOrName, string text, out string error)
        {
            var tokenizer = Tokenizer(Find(idOrName), out error);
            return tokenizer?.Encode(text ?? "", false);
        }

        public string Detokenize(string idOrName, IList<int> ids, out string error)
        {
            var tokenizer = Tokenizer(Find(idOrName), out error);
            return tokenizer?.Decode(ids ?? Array.Empty<int>(), true);
        }

        public bool IsGenerating(string idOrName)
        {
            var entry = Find(idOrName);
            return entry != null && _generating.ContainsKey(entry.Id);
        }

        public void Stop(string idOrName)
        {
            if (string.IsNullOrEmpty(idOrName))
            {
                foreach (var driver in _generating.Values) driver.Cancel();
                return;
            }
            var entry = Find(idOrName);
            if (entry != null && _generating.TryGetValue(entry.Id, out var d)) d.Cancel();
        }

        /// <summary>
        /// LLM に書かせる。messages は [{role, content}]、prompt だけなら user の 1 発言。
        /// options: system, maxNewTokens, temperature, topK, topP, repetitionPenalty, stop[], seed, raw
        /// </summary>
        public void Generate(
            string idOrName, IList<ChatMessage> messages, Dictionary<string, object> options,
            Action<string, string> onDelta, Action<Dictionary<string, object>> done)
        {
            var entry = Find(idOrName);
            if (entry == null) { done(Failure("modelMissing:" + idOrName)); return; }
            if (entry.Use != "text" || entry.Text == null) { done(Failure("notTextModel")); return; }
            if (_generating.ContainsKey(entry.Id)) { done(Failure("busy")); return; }

            var tokenizer = Tokenizer(entry, out var tokError);
            if (tokenizer == null) { done(Failure(tokError)); return; }
            var runner = RunnerFor(entry);
            if (runner == null) { done(Failure("modelNotReady")); return; }
            if (!runner.TryDescribe(entry.Ref, out var signature, out var describeError)) { done(Failure(describeError)); return; }
            var check = TextGenerationSession.Check(signature);
            if (check != null) { done(Failure("notGenerative:" + check)); return; }

            var spec = entry.Text;
            var conversation = new List<ChatMessage>();
            var system = MiniJson.Text(options, "system", spec.SystemPrompt);
            if (!string.IsNullOrEmpty(system)) conversation.Add(new ChatMessage("system", system));
            foreach (var m in messages ?? new List<ChatMessage>()) conversation.Add(m);

            bool raw = MiniJson.Bool(options, "raw", false);
            var prompt = spec.RenderPrompt(conversation, raw);
            // 書式が BOS を自分で書いているなら、分割器にもう一度足させない
            var ids = tokenizer.Encode(prompt, !tokenizer.StartsWithSpecialToken(prompt));

            TextGenerationSession session;
            try
            {
                session = new TextGenerationSession(tokenizer, signature, ids, spec.ToGenerationOptions(tokenizer, options));
            }
            catch (Exception e)
            {
                done(Failure(e.Message));
                return;
            }

            TextGenerationDriver driver = null;
            driver = new TextGenerationDriver(runner, entry.Ref, session, onDelta, result =>
            {
                _generating.Remove(entry.Id);
                done(result.ToPlain());
            });
            _generating[entry.Id] = driver;
            driver.Start();
        }

        public void Embed(string idOrName, string text, Action<Dictionary<string, object>> done)
        {
            var entry = Find(idOrName);
            if (entry == null) { done(Failure("modelMissing:" + idOrName)); return; }
            if (entry.Use != "text" || entry.Text == null) { done(Failure("notTextModel")); return; }
            var tokenizer = Tokenizer(entry, out var tokError);
            if (tokenizer == null) { done(Failure(tokError)); return; }
            var runner = RunnerFor(entry);
            if (runner == null) { done(Failure("modelNotReady")); return; }
            if (!runner.TryDescribe(entry.Ref, out var signature, out var describeError)) { done(Failure(describeError)); return; }

            var inputs = TextEncoding.Inputs(tokenizer, signature, text, entry.Text.MaxLength, out var count, out var inputError);
            if (inputs == null) { done(Failure(inputError)); return; }

            runner.Run(entry.Ref, inputs, result =>
            {
                if (!result.Ok) { done(Failure(result.Error)); return; }
                var vector = TextEncoding.Embedding(result.Outputs, count, entry.Text.Pooling, entry.Text.Normalize, entry.Text.OutputName, out var error);
                if (vector == null) { done(Failure(error)); return; }
                var list = new List<object>(vector.Length);
                foreach (var v in vector) list.Add((double)v);
                done(new Dictionary<string, object> { ["ok"] = true, ["vector"] = list, ["tokens"] = (double)count, ["ms"] = Math.Round(result.Ms) });
            });
        }

        public void ClassifyText(string idOrName, string text, Action<Dictionary<string, object>> done)
        {
            var entry = Find(idOrName);
            if (entry == null) { done(Failure("modelMissing:" + idOrName)); return; }
            if (entry.Use != "text" || entry.Text == null) { done(Failure("notTextModel")); return; }
            var tokenizer = Tokenizer(entry, out var tokError);
            if (tokenizer == null) { done(Failure(tokError)); return; }
            var runner = RunnerFor(entry);
            if (runner == null) { done(Failure("modelNotReady")); return; }
            if (!runner.TryDescribe(entry.Ref, out var signature, out var describeError)) { done(Failure(describeError)); return; }

            var inputs = TextEncoding.Inputs(tokenizer, signature, text, entry.Text.MaxLength, out _, out var inputError);
            if (inputs == null) { done(Failure(inputError)); return; }

            runner.Run(entry.Ref, inputs, result =>
            {
                if (!result.Ok) { done(Failure(result.Error)); return; }
                var ranked = TextEncoding.Classify(result.Outputs, entry.Text.OutputName, true, 5, out var error);
                if (ranked == null || ranked.Count == 0) { done(Failure(error ?? "noOutputs")); return; }
                var top = new List<object>();
                foreach (var (index, score) in ranked)
                    top.Add(new Dictionary<string, object> { ["label"] = LabelOf(entry.Text.Labels, index), ["index"] = (double)index, ["score"] = score });
                done(new Dictionary<string, object>
                {
                    ["ok"] = true,
                    ["label"] = LabelOf(entry.Text.Labels, ranked[0].index),
                    ["score"] = ranked[0].score,
                    ["top"] = top,
                    ["ms"] = Math.Round(result.Ms),
                });
            });
        }

        private static string LabelOf(string[] labels, int index) =>
            labels != null && index >= 0 && index < labels.Length && !string.IsNullOrEmpty(labels[index]) ? labels[index] : index.ToString();

        // ---- 画像 ----

        /// <summary>画像のモデルを 1 枚の画に掛ける。結果は `infer` op と同じ読み方。</summary>
        public void RunImage(string idOrName, ColorImage image, Action<Dictionary<string, object>> done)
        {
            var entry = Find(idOrName);
            if (entry == null) { done(Failure("modelMissing:" + idOrName)); return; }
            if (entry.Use != "image" || entry.Image == null) { done(Failure("notImageModel")); return; }
            if (image == null) { done(Failure("noImage")); return; }
            var runner = RunnerFor(entry);
            if (runner == null) { done(Failure("modelNotReady")); return; }
            if (!runner.TryDescribe(entry.Ref, out var signature, out var describeError)) { done(Failure(describeError)); return; }

            PreparedInput prepared;
            try { prepared = ModelPreprocess.Prepare(image, entry.Image); }
            catch (Exception e) { done(Failure("prepare:" + e.Message)); return; }

            var inputName = entry.Image.Input.Name;
            if (string.IsNullOrEmpty(inputName) && signature.Inputs.Count > 0) inputName = signature.Inputs[0].Name;
            var inputs = new Dictionary<string, ModelTensor>
            {
                [inputName ?? "input"] = ModelTensor.Float(prepared.Tensor.Shape, prepared.Tensor.Data),
            };

            runner.Run(entry.Ref, inputs, result =>
            {
                if (!result.Ok) { done(Failure(result.Error)); return; }
                var outputs = new Dictionary<string, TensorData>();
                try
                {
                    foreach (var pair in result.Outputs)
                    {
                        var shape = (int[])pair.Value.Shape.Clone();
                        for (int i = 0; i < shape.Length; i++) if (shape[i] <= 0) shape[i] = 1;
                        if (pair.Value.Length == 0) continue;
                        outputs[pair.Key] = new TensorData(shape, pair.Value.ToFloats());
                    }
                }
                catch (Exception e)
                {
                    done(Failure("output:" + e.Message));
                    return;
                }

                var value = ModelPostprocess.Interpret(entry.Image, prepared, outputs, out var readError);
                if (value == null) { done(Failure(readError)); return; }
                var plain = new Dictionary<string, object> { ["ok"] = true, ["ms"] = Math.Round(result.Ms), ["kind"] = value.Kind.ToString().ToLowerInvariant() };
                switch (value.Kind)
                {
                    case VisionValueKind.Record:
                        foreach (var pair in value.Record) plain[pair.Key] = pair.Value;
                        break;
                    case VisionValueKind.Blobs:
                        plain["items"] = value.Items;
                        plain["count"] = (double)(value.Items?.Count ?? 0);
                        break;
                    case VisionValueKind.Mask:
                    {
                        int on = 0;
                        foreach (var b in value.Mask.Data) if (b >= 128) on++;
                        plain["coverage"] = value.Mask.Data.Length > 0 ? (double)on / value.Mask.Data.Length : 0.0;
                        plain["width"] = (double)value.Mask.Width;
                        plain["height"] = (double)value.Mask.Height;
                        break;
                    }
                }
                done(plain);
            });
        }

        public static Dictionary<string, object> Failure(string error) =>
            new Dictionary<string, object> { ["ok"] = false, ["error"] = error ?? "failed" };
    }
}
