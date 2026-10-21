// ==============================================
// Arsist Engine - JS ⇄ C# の受け渡し (スクリプトのラッパー共通)
//
// JS の値は JSON を通して素の木 (Dictionary<string, object> / List<object> / double / string / bool / null)
// にして受け取り、返すときも JSON.parse で本物の JS の値にする (ModelWrapper と同じ方針)。
// Jint にそのまま CLR の List を渡すと、JS からは配列に見えない (Array.isArray が false、map が無い)。
//
// コールバックの呼び出しも、エラーの出し方を ExecuteScript とそろえてここで行う。
// ==============================================

using System;
using System.Collections;
using System.Collections.Generic;
using Arsist.Runtime.Inference;
using Jint;
using Jint.Native;
using Jint.Runtime;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    [UnityEngine.Scripting.Preserve]
    public sealed class JsBridge
    {
        private readonly Engine _engine;
        private readonly JsValue _stringify;
        private readonly JsValue _parse;
        private readonly JsValue _typeOf;

        public JsBridge(Engine engine)
        {
            _engine = engine;
            _stringify = engine.Evaluate("JSON.stringify");
            _parse = engine.Evaluate("JSON.parse");
            _typeOf = engine.Evaluate("(function (v) { return Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v; })");
        }

        public Engine Engine => _engine;

        /// <summary>'undefined' / 'null' / 'string' / 'number' / 'boolean' / 'object' / 'array' / 'function'</summary>
        public string TypeOf(JsValue value)
        {
            if (value == null) return "undefined";
            return _engine.Invoke(_typeOf, JsValue.Undefined, new object[] { value }).AsString();
        }

        public bool IsFunction(JsValue value) => TypeOf(value) == "function";

        /// <summary>JS の値 → 素の木。関数・undefined は null。</summary>
        public object FromJs(JsValue value)
        {
            if (value == null || value.IsUndefined() || value.IsNull()) return null;
            if (value.IsString()) return value.AsString();
            if (value.IsNumber()) return value.AsNumber();
            if (value.IsBoolean()) return value.AsBoolean();
            if (TypeOf(value) == "function") return null;
            var json = _engine.Invoke(_stringify, JsValue.Undefined, new object[] { value });
            if (json == null || json.IsUndefined() || json.IsNull()) return null;
            try { return MiniJson.Parse(json.AsString()); }
            catch (Exception) { return null; }
        }

        /// <summary>素の木 (や CLR の入れ物) → 本物の JS の値。</summary>
        public JsValue ToJs(object plain)
        {
            switch (plain)
            {
                case null: return JsValue.Null;
                case string s: return new JsString(s);
                case bool b: return b ? JsBoolean.True : JsBoolean.False;
                case double d: return new JsNumber(d);
                case float f: return new JsNumber(f);
                case int i: return new JsNumber(i);
                case long l: return new JsNumber(l);
                case JsValue js: return js;
                case JToken token:
                    return _engine.Invoke(_parse, JsValue.Undefined, new object[] { token.ToString(Newtonsoft.Json.Formatting.None) });
                case IDictionary<string, object> _:
                case IEnumerable _:
                    return _engine.Invoke(_parse, JsValue.Undefined, new object[] { MiniJson.Write(Normalize(plain)) });
                default:
                    if (plain is IConvertible c)
                    {
                        try { return new JsNumber(c.ToDouble(System.Globalization.CultureInfo.InvariantCulture)); }
                        catch (Exception) { }
                    }
                    return new JsString(plain.ToString());
            }
        }

        /// <summary>
        /// CLR の入れ物 (ExpandoObject・object[]・JToken・Dictionary・List) を素の木にそろえる。
        /// ストアに入れる値はこれを通す (後から JS 側で元のオブジェクトを書き換えてもストアが変わらないように)。
        /// </summary>
        public static object Normalize(object value)
        {
            switch (value)
            {
                case null: return null;
                case string _: case bool _: case double _: return value;
                case float f: return (double)f;
                case int i: return (double)i;
                case long l: return (double)l;
                case JToken token:
                    try { return MiniJson.Parse(token.ToString(Newtonsoft.Json.Formatting.None)); }
                    catch (Exception) { return token.ToString(); }
                case IDictionary<string, object> map:
                {
                    var copy = new Dictionary<string, object>(map.Count);
                    foreach (var pair in map) copy[pair.Key] = Normalize(pair.Value);
                    return copy;
                }
                case IDictionary legacy:
                {
                    var copy = new Dictionary<string, object>();
                    foreach (DictionaryEntry entry in legacy) copy[Convert.ToString(entry.Key)] = Normalize(entry.Value);
                    return copy;
                }
                case IEnumerable list:
                {
                    var copy = new List<object>();
                    foreach (var item in list) copy.Add(Normalize(item));
                    return copy;
                }
                default:
                    if (value is IConvertible c)
                    {
                        try { return c.ToDouble(System.Globalization.CultureInfo.InvariantCulture); }
                        catch (Exception) { }
                    }
                    return value.ToString();
            }
        }

        /// <summary>JS のオブジェクトから 1 項目 (無ければ undefined)。関数を取り出すのに使う。</summary>
        public JsValue Get(JsValue obj, string key)
        {
            if (obj == null || !obj.IsObject()) return JsValue.Undefined;
            return obj.AsObject().Get(key);
        }

        /// <summary>
        /// スクリプトのコールバックを呼ぶ。エラーは ExecuteScript と同じ形でログに出し、呼んだ側には伝えない。
        /// </summary>
        public void Call(JsValue callback, string label, params object[] args)
        {
            if (callback == null || callback.IsUndefined() || callback.IsNull()) return;
            if (!IsFunction(callback)) return;
            var jsArgs = new JsValue[args?.Length ?? 0];
            for (int i = 0; i < jsArgs.Length; i++) jsArgs[i] = ToJs(args[i]);
            try
            {
                _engine.Invoke(callback, JsValue.Undefined, jsArgs);
            }
            catch (JavaScriptException ex)
            {
                var location = ex.Location.Start.Line > 0 ? $" line={ex.Location.Start.Line}, col={ex.Location.Start.Column}" : string.Empty;
                Debug.LogError($"[ArsistJS] Runtime error in {label}: {ex.Message}{location}");
            }
            catch (RecursionDepthOverflowException ex)
            {
                Debug.LogError($"[ArsistJS] Recursion limit exceeded in {label}: {ex.Message}");
            }
            catch (OperationCanceledException ex)
            {
                Debug.LogError($"[ArsistJS] Execution cancelled (timeout?) in {label}: {ex.Message}");
            }
            catch (Exception ex)
            {
                Debug.LogError($"[ArsistJS] Error in {label} ({ex.GetType().Name}): {ex.Message}");
            }
        }

        // ---- 素の木から値を取り出す小道具 ----

        public static string Text(Dictionary<string, object> d, string key, string fallback = null) =>
            d != null && d.TryGetValue(key, out var v) && v != null ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : fallback;

        public static double Number(Dictionary<string, object> d, string key, double fallback) =>
            d != null && d.TryGetValue(key, out var v) && v is double n && !double.IsNaN(n) ? n : fallback;

        public static bool Flag(Dictionary<string, object> d, string key, bool fallback) =>
            d != null && d.TryGetValue(key, out var v) && v is bool b ? b : fallback;

        public static Dictionary<string, object> Obj(Dictionary<string, object> d, string key) =>
            d != null && d.TryGetValue(key, out var v) ? v as Dictionary<string, object> : null;

        public static bool Has(Dictionary<string, object> d, string key) => d != null && d.ContainsKey(key);
    }
}
