// ==============================================
// Arsist Engine - Extensions: the script engine, as an extension sees it
// Assets/Arsist/Runtime/Extensions/ArsistScriptBridge.cs
//
// 拡張機能がスクリプト (Jint) に名前を出し、値を受け渡すための口。
// 値の受け渡しは ModelWrapper と同じく「素の値 (Dictionary / List / string / double / bool) ⇔ JSON」で行う。
// CLR のオブジェクトをそのまま JS に渡すと、プロパティ名が C# 流 (PascalCase) になり、
// IL2CPP で消された getter が実機でだけ undefined になる。JSON を通せばどちらも起きない。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Inference;
using Jint;
using Jint.Native;
using UnityEngine;

namespace Arsist.Runtime.Extensions
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistScriptBridge
    {
        /// <summary>
        /// 組み込みの名前。拡張機能は、extension.json の replaces に "script:<名前>" と書いたときだけ上書きできる。
        /// src/shared/extensions.ts の BUILTIN_SCRIPT_GLOBALS と同じ並び (テストで照合している)。
        /// </summary>
        public static readonly string[] BuiltInNames =
        {
            "api", "ui", "store", "scene", "vrm", "remote", "viewer", "perception", "model", "log", "error",
            "audio", "camera", "storage", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "__arsistTimers",
            "globalThis", "window", "console",
        };

        /// <summary>どの拡張機能がどの名前を出したか (重複の検出用)。</summary>
        private static readonly Dictionary<string, string> Owners = new Dictionary<string, string>();

        /// <summary>その名前を、どれかの拡張機能が既に出しているか。</summary>
        internal static bool IsTaken(string name) => !string.IsNullOrEmpty(name) && Owners.ContainsKey(name);

        private readonly Engine _engine;
        private readonly string _owner;
        private readonly JsValue _parse;
        private readonly JsValue _stringify;
        private readonly JsValue _typeOf;

        internal ArsistScriptBridge(Engine engine, string owner)
        {
            _engine = engine;
            _owner = owner;
            _parse = engine.Evaluate("JSON.parse");
            _stringify = engine.Evaluate("JSON.stringify");
            _typeOf = engine.Evaluate("(function (v) { return typeof v; })");
        }

        /// <summary>Jint のエンジン。普通は Set / Call / ToJs で足りる。</summary>
        public Engine Engine => _engine;

        /// <summary>
        /// スクリプトに名前を出す。value は [Preserve] を付けたクラスのインスタンスにすること
        /// (メソッドは Jint がリフレクションで呼ぶので、IL2CPP に消されないように)。
        /// </summary>
        public bool Set(string name, object value)
        {
            if (string.IsNullOrEmpty(name))
            {
                Debug.LogError($"[Arsist:{_owner}] script global without a name was ignored");
                return false;
            }
            var builtIn = Array.IndexOf(BuiltInNames, name) >= 0;
            if (builtIn && ArsistExtensions.ReplacementOwner(ArsistEngineParts.ScriptPrefix + name) != _owner)
            {
                Debug.LogError(
                    $"[Arsist:{_owner}] '{name}' is a built-in script name; to replace it, list \"{ArsistEngineParts.ScriptPrefix}{name}\" " +
                    "in this extension's \"replaces\" (extension.json)");
                return false;
            }
            if (Owners.TryGetValue(name, out var owner) && owner != _owner)
            {
                Debug.LogError($"[Arsist:{_owner}] script name '{name}' is already used by extension '{owner}'");
                return false;
            }
            Owners[name] = _owner;
            _engine.SetValue(name, value);
            Debug.Log(builtIn
                ? $"[Arsist:{_owner}] script global '{name}' replaces the engine's built-in '{name}'"
                : $"[Arsist:{_owner}] script global '{name}' registered");
            return true;
        }

        /// <summary>素の値 (Dictionary / List / string / double / bool / null) を JS の値にする。</summary>
        public JsValue ToJs(object plain)
        {
            if (plain == null) return JsValue.Null;
            return _engine.Invoke(_parse, JsValue.Undefined, new object[] { MiniJson.Write(plain) });
        }

        /// <summary>JS の値を素の値にする。関数など JSON にならないものは null。</summary>
        public object FromJs(JsValue value)
        {
            if (value == null || value.IsUndefined() || value.IsNull()) return null;
            var json = _engine.Invoke(_stringify, JsValue.Undefined, new object[] { value });
            if (json == null || json.IsUndefined() || json.IsNull()) return null;
            try { return MiniJson.Parse(json.AsString()); }
            catch (Exception) { return null; }
        }

        public bool IsFunction(JsValue value)
        {
            if (value == null) return false;
            return _engine.Invoke(_typeOf, JsValue.Undefined, new object[] { value }).AsString() == "function";
        }

        /// <summary>
        /// JS の関数を呼ぶ (メインスレッドから)。引数は素の値で渡す。
        /// 例外はここで受けてログに出す (拡張機能の呼び出し元までは上げない)。
        /// </summary>
        public void Call(JsValue function, params object[] plainArgs)
        {
            if (!IsFunction(function)) return;
            try
            {
                var args = new object[plainArgs?.Length ?? 0];
                for (int i = 0; i < args.Length; i++) args[i] = ToJs(plainArgs[i]);
                _engine.Invoke(function, JsValue.Undefined, args);
            }
            catch (Exception e)
            {
                Debug.LogError($"[ArsistJS] callback from extension '{_owner}' failed: {e.Message}");
            }
        }
    }
}
