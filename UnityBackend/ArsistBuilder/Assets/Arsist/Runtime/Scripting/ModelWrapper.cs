// ==============================================
// Arsist Engine - Model Wrapper
// Assets/Arsist/Runtime/Scripting/ModelWrapper.cs
//
// Jint に "model" として公開される。プロジェクトに取り込んだ ONNX を、画像認識に限らず
// スクリプトから直接使うための口。
//
//   model.list()                                   → [{ id, name, use, task }]
//   model.info(id)                                 → { inputs:[{name,type,shape}], outputs:[…] }
//   model.run(id, { 入力名: {type, shape, data} | [数…] }, cb)  → cb({ ok, outputs:{名前:{type,shape,data}}, ms })
//   model.generate(id, "質問" | [{role, content}…], [options], cb)
//                                                  → cb({ ok, text, tokens, reason, ms, tokensPerSecond })
//        options: system, maxNewTokens, temperature, topK, topP, repetitionPenalty, stop, seed, raw,
//                 onToken: function(delta, textSoFar) { … }   (書けたそばから届く)
//   model.stop(id?)  model.busy(id)
//   model.embed(id, "文", cb)                      → cb({ ok, vector:[…] })
//   model.similarity(a, b)                         → -1..1 (ベクトルのコサイン類似度)
//   model.classifyText(id, "文", cb)               → cb({ ok, label, score, top:[{label,score}] })
//   model.runImage(id, cb)                         → いまのカメラの画に画像のモデルを掛ける
//   model.tokenize(id, "文") / model.detokenize(id, [番号…])
//
// id の代わりにモデルの名前も書ける。コールバックは api.get と同じく、終わったら 1 回呼ばれる。
// 推論はメインスレッドを止めない (GPU で動かし、非同期に読み出す)。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Inference;
using Arsist.Runtime.Inference.Text;
using Arsist.Runtime.Perception;
using Jint;
using Jint.Native;
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    [UnityEngine.Scripting.Preserve]
    public class ModelWrapper
    {
        /// <summary>run の出力をスクリプトに渡すときの上限 (値の数)。LLM の logits を丸ごと JS に渡すと重すぎる。</summary>
        private const int MaxValuesToScript = 65536;

        private readonly Engine _engine;
        private readonly JsValue _stringify;
        private readonly JsValue _parse;
        private readonly JsValue _pick;
        private readonly JsValue _typeOf;

        public ModelWrapper(Engine engine)
        {
            _engine = engine;
            // JS の値 ⇄ C# の素の木 は JSON を通す (Jint の型変換に頼らない方が挙動がはっきりする)
            _stringify = engine.Evaluate("JSON.stringify");
            _parse = engine.Evaluate("JSON.parse");
            _pick = engine.Evaluate("(function (o, k) { return o == null ? undefined : o[k]; })");
            _typeOf = engine.Evaluate("(function (v) { return Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v; })");
        }

        private static InferenceService Service => ArsistModelCatalog.Service;

        // ---- 一覧 ----

        [UnityEngine.Scripting.Preserve]
        public JsValue list()
        {
            var service = Service;
            var list = new List<object>();
            if (service != null) foreach (var entry in service.Models) list.Add(entry.Summary());
            return ToJs(list);
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue info(string id)
        {
            var service = Service;
            if (service == null) return ToJs(InferenceService.Failure("noModels"));
            var info = service.Info(id, out var error);
            return ToJs(info ?? InferenceService.Failure(error));
        }

        // ---- テンソルをそのまま ----

        [UnityEngine.Scripting.Preserve]
        public void run(string id, JsValue inputs, JsValue callback)
        {
            var service = Service;
            if (service == null) { Reply(callback, InferenceService.Failure("noModels")); return; }
            var plain = FromJs(inputs) as Dictionary<string, object>;
            if (plain == null) { Reply(callback, InferenceService.Failure("inputsMustBeObject")); return; }
            service.Run(id, plain, MaxValuesToScript, result => Reply(callback, result));
        }

        // ---- 文章 ----

        [UnityEngine.Scripting.Preserve]
        public void generate(string id, JsValue prompt, JsValue callbackOrOptions)
        {
            // model.generate(id, prompt, { onToken }) のように、コールバック無しで options だけ渡されることもある
            if (TypeOf(callbackOrOptions) == "object") generate(id, prompt, callbackOrOptions, JsValue.Undefined);
            else generate(id, prompt, JsValue.Undefined, callbackOrOptions);
        }

        [UnityEngine.Scripting.Preserve]
        public void generate(string id, JsValue prompt, JsValue options, JsValue callback)
        {
            var service = Service;
            if (service == null) { Reply(callback, InferenceService.Failure("noModels")); return; }

            var messages = new List<ChatMessage>();
            var kind = TypeOf(prompt);
            if (kind == "string")
            {
                messages.Add(new ChatMessage("user", prompt.AsString()));
            }
            else if (kind == "array")
            {
                if (FromJs(prompt) is List<object> list)
                {
                    foreach (var raw in list)
                    {
                        if (raw is Dictionary<string, object> m)
                            messages.Add(new ChatMessage(MiniJson.Text(m, "role", "user"), MiniJson.Text(m, "content", "")));
                        else if (raw is string s)
                            messages.Add(new ChatMessage("user", s));
                    }
                }
            }
            else
            {
                Reply(callback, InferenceService.Failure("promptMustBeTextOrMessages"));
                return;
            }

            var plainOptions = TypeOf(options) == "object" ? FromJs(options) as Dictionary<string, object> : null;
            var onToken = TypeOf(options) == "object" ? Pick(options, "onToken") : JsValue.Undefined;
            bool streaming = TypeOf(onToken) == "function";

            service.Generate(id, messages, plainOptions,
                (delta, text) =>
                {
                    if (!streaming) return;
                    try { _engine.Invoke(onToken, JsValue.Undefined, new object[] { delta, text }); }
                    catch (Exception e) { Debug.LogError($"[ArsistJS] model.generate onToken failed: {e.Message}"); }
                },
                result => Reply(callback, result));
        }

        [UnityEngine.Scripting.Preserve]
        public void stop()
        {
            Service?.Stop(null);
        }

        [UnityEngine.Scripting.Preserve]
        public void stop(string id)
        {
            Service?.Stop(id);
        }

        [UnityEngine.Scripting.Preserve]
        public bool busy(string id)
        {
            return Service != null && Service.IsGenerating(id);
        }

        [UnityEngine.Scripting.Preserve]
        public void embed(string id, string text, JsValue callback)
        {
            var service = Service;
            if (service == null) { Reply(callback, InferenceService.Failure("noModels")); return; }
            service.Embed(id, text, result => Reply(callback, result));
        }

        [UnityEngine.Scripting.Preserve]
        public double similarity(JsValue a, JsValue b)
        {
            return TextEncoding.Cosine(ToFloats(FromJs(a)), ToFloats(FromJs(b)));
        }

        [UnityEngine.Scripting.Preserve]
        public void classifyText(string id, string text, JsValue callback)
        {
            var service = Service;
            if (service == null) { Reply(callback, InferenceService.Failure("noModels")); return; }
            service.ClassifyText(id, text, result => Reply(callback, result));
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue tokenize(string id, string text)
        {
            var service = Service;
            if (service == null) return JsValue.Null;
            var ids = service.Tokenize(id, text, out var error);
            if (ids == null) { Debug.LogWarning($"[ArsistJS] model.tokenize: {error}"); return JsValue.Null; }
            var list = new List<object>(ids.Length);
            foreach (var i in ids) list.Add((double)i);
            return ToJs(list);
        }

        [UnityEngine.Scripting.Preserve]
        public string detokenize(string id, JsValue ids)
        {
            var service = Service;
            if (service == null) return null;
            var list = new List<int>();
            if (FromJs(ids) is List<object> raw) foreach (var v in raw) if (v is double d) list.Add((int)d);
            var text = service.Detokenize(id, list, out var error);
            if (text == null) Debug.LogWarning($"[ArsistJS] model.detokenize: {error}");
            return text;
        }

        // ---- 画像 ----

        [UnityEngine.Scripting.Preserve]
        public void runImage(string id, JsValue callback)
        {
            var service = Service;
            if (service == null) { Reply(callback, InferenceService.Failure("noModels")); return; }
            var entry = service.Find(id);
            if (entry == null) { Reply(callback, InferenceService.Failure("modelMissing:" + id)); return; }
            if (entry.Use != "image" || entry.Image == null) { Reply(callback, InferenceService.Failure("notImageModel")); return; }

            var manager = ArsistPerceptionManager.Instance;
            if (manager == null) { Reply(callback, InferenceService.Failure("noCamera")); return; }

            // モデルの入力の 2 倍あれば縮めても足りる。GPU で縮めてから読むので、大きく取る意味は無い。
            int width = Math.Max(320, Math.Max(entry.Image.Input.Width, entry.Image.Input.Height) * 2);
            manager.RequestStill(still =>
            {
                if (!still.Valid || still.Color == null) { Reply(callback, InferenceService.Failure("noFrame")); return; }
                service.RunImage(id, still.Color, result => Reply(callback, result));
            }, wantColor: true, maxWidth: width);
        }

        // ---- JS との受け渡し ----

        private void Reply(JsValue callback, Dictionary<string, object> result)
        {
            if (TypeOf(callback) != "function")
            {
                if (result != null && result.TryGetValue("ok", out var ok) && ok is bool b && !b)
                    Debug.LogWarning($"[ArsistJS] model: {MiniJson.Text(result, "error")}");
                return;
            }
            try
            {
                _engine.Invoke(callback, JsValue.Undefined, new object[] { ToJs(result) });
            }
            catch (Exception e)
            {
                Debug.LogError($"[ArsistJS] model callback failed: {e.Message}");
            }
        }

        private JsValue ToJs(object plain)
        {
            return _engine.Invoke(_parse, JsValue.Undefined, new object[] { MiniJson.Write(plain) });
        }

        private object FromJs(JsValue value)
        {
            if (value == null || value.IsUndefined() || value.IsNull()) return null;
            var json = _engine.Invoke(_stringify, JsValue.Undefined, new object[] { value });
            if (json == null || json.IsUndefined() || json.IsNull()) return null;
            try { return MiniJson.Parse(json.AsString()); }
            catch (Exception) { return null; }
        }

        private string TypeOf(JsValue value)
        {
            if (value == null) return "undefined";
            return _engine.Invoke(_typeOf, JsValue.Undefined, new object[] { value }).AsString();
        }

        private JsValue Pick(JsValue obj, string key)
        {
            return _engine.Invoke(_pick, JsValue.Undefined, new object[] { obj, key });
        }

        private static float[] ToFloats(object plain)
        {
            if (!(plain is List<object> list)) return Array.Empty<float>();
            var result = new float[list.Count];
            for (int i = 0; i < result.Length; i++) result[i] = list[i] is double d ? (float)d : 0f;
            return result;
        }
    }
}
