// ==============================================
// Arsist Engine - Extensions: registry
// Assets/Arsist/Runtime/Extensions/ArsistExtensions.cs
//
// どの拡張機能が「入っていて」「このビルドで有効か」を突き合わせる場所。
//
//   入っている  = ビルドが生成した ArsistExtensionRegistry.g.cs が Register(new X()) したもの
//                 (C# がこの APK に入っている)
//   有効        = Resources/ArsistManifest.json の extensions に載っているもの
//                 (エディタで有効にし、端末のタグが条件を満たしたもの。設定もここにある)
//
// 両者は同じビルドが作るので普通は一致する。一致しないときはログに理由を出す
// (黙って動かない拡張機能を作らない)。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Inference;
using Jint;
using UnityEngine;

namespace Arsist.Runtime.Extensions
{
    [UnityEngine.Scripting.Preserve]
    public static class ArsistExtensions
    {
        private sealed class Entry
        {
            public ArsistRuntimeExtension Extension;
            public ArsistExtensionContext Context;
            public bool Started;
        }

        private static readonly Dictionary<string, ArsistRuntimeExtension> Registered =
            new Dictionary<string, ArsistRuntimeExtension>(StringComparer.Ordinal);

        private static List<Entry> _active;
        private static Dictionary<string, object> _manifest;

        /// <summary>
        /// 拡張機能の名前が無い端末で、その名前に入れる「何もしない代役」。
        /// どんな呼び出しも undefined を返し、最初の 1 回だけ理由をログに出す。
        /// room.onReady(fn) のような書き方は、その端末では静かに何も起きない。
        /// </summary>
        private const string StandInFactory = @"(function (name, id, reason) {
  var warned = false;
  globalThis[name] = new Proxy({}, {
    get: function (target, key) {
      if (typeof key !== 'string') return undefined;
      return function () {
        if (!warned) { warned = true; log('[' + id + '] ' + name + '.' + key + '() does nothing here: ' + reason); }
        return undefined;
      };
    }
  });
})";

        /// <summary>ビルドが生成する登録コードから呼ばれる。同じ id は後勝ち。</summary>
        public static void Register(ArsistRuntimeExtension extension)
        {
            if (extension == null || string.IsNullOrEmpty(extension.Id)) return;
            Registered[extension.Id] = extension;
            _active = null; // 次に使うときに突き合わせ直す
        }

        /// <summary>このビルドで有効な拡張機能の id。</summary>
        public static IReadOnlyList<string> ActiveIds
        {
            get
            {
                var ids = new List<string>();
                foreach (var e in Active()) ids.Add(e.Extension.Id);
                return ids;
            }
        }

        /// <summary>id の拡張機能のコンテキスト。無効なら null。</summary>
        public static ArsistExtensionContext ContextOf(string id)
        {
            foreach (var e in Active()) if (e.Extension.Id == id) return e.Context;
            return null;
        }

        private static List<Entry> Active()
        {
            if (_active != null) return _active;
            _active = new List<Entry>();

            Dictionary<string, object> manifest = null;
            try
            {
                var text = Resources.Load<TextAsset>("ArsistManifest");
                if (text != null && !string.IsNullOrEmpty(text.text)) manifest = MiniJson.ParseObject(text.text);
                _manifest = manifest;
            }
            catch (Exception e)
            {
                Debug.LogError($"[Arsist] Extensions: could not read ArsistManifest: {e.Message}");
            }

            var listed = MiniJson.List(manifest, "extensions") ?? new List<object>();
            var deviceTags = MiniJson.Strings(manifest, "deviceTags");
            var features = MiniJson.Strings(manifest, "features");
            var targetDevice = MiniJson.Text(manifest, "targetDevice", "");
            var seen = new HashSet<string>();

            foreach (var raw in listed)
            {
                if (!(raw is Dictionary<string, object> item)) continue;
                var id = MiniJson.Text(item, "id");
                if (string.IsNullOrEmpty(id)) continue;
                seen.Add(id);

                if (!Registered.TryGetValue(id, out var extension))
                {
                    Debug.LogError(
                        $"[Arsist] Extension '{id}' is enabled for this build but its C# is not in the app " +
                        "(ArsistExtensionRegistry.g.cs did not register it). Rebuild; if it persists, check unity.entry in extension.json.");
                    continue;
                }

                var context = new ArsistExtensionContext(
                    id,
                    MiniJson.Int(item, "dataVersion", 1),
                    MiniJson.Obj(item, "settings"),
                    deviceTags,
                    features,
                    targetDevice);
                _active.Add(new Entry { Extension = extension, Context = context });
            }

            foreach (var id in Registered.Keys)
            {
                if (!seen.Contains(id))
                    Debug.LogWarning($"[Arsist] Extension '{id}' is in the app but not enabled in its manifest; it stays off.");
            }

            if (_active.Count > 0 || Registered.Count > 0)
            {
                var names = new List<string>();
                foreach (var e in _active) names.Add(e.Extension.Id);
                Debug.Log($"[Arsist] Extensions active: {(names.Count == 0 ? "(none)" : string.Join(", ", names))} " +
                          $"(device tags: {string.Join(" ", deviceTags)})");
            }
            return _active;
        }

        /// <summary>
        /// スクリプトエンジンの初期化中に、各拡張機能に名前を出させる (ScriptEngineManager.InitEngine)。
        /// 1 つの拡張機能が失敗しても、他の拡張機能とスクリプトそのものは止めない。
        /// </summary>
        public static void InstallScriptGlobals(Engine engine)
        {
            if (engine == null) return;
            foreach (var e in Active())
            {
                try
                {
                    e.Extension.RegisterScriptGlobals(new ArsistScriptBridge(engine, e.Extension.Id), e.Context);
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[Arsist:{e.Extension.Id}] RegisterScriptGlobals failed: {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}");
                }
            }

            InstallStandIns(engine);
        }

        /// <summary>
        /// プロジェクトでは有効なのに、この端末のビルドには入らなかった拡張機能の名前に代役を入れる
        /// (manifest の absentExtensions)。同じプロジェクトのスクリプトが、別の端末で
        /// "room is not defined" のように落ちないようにするため。
        /// </summary>
        private static void InstallStandIns(Engine engine)
        {
            var absent = MiniJson.List(_manifest, "absentExtensions");
            if (absent == null || absent.Count == 0) return;
            Jint.Native.JsValue factory;
            try
            {
                factory = engine.Evaluate(StandInFactory);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[Arsist] Extensions: stand-ins unavailable ({ex.Message}); scripts using absent extensions will fail on this device");
                return;
            }

            foreach (var raw in absent)
            {
                if (!(raw is Dictionary<string, object> item)) continue;
                var id = MiniJson.Text(item, "id", "?");
                var reason = MiniJson.Text(item, "reason", "not in this build");
                foreach (var name in MiniJson.Strings(item, "globals"))
                {
                    if (Array.IndexOf(ArsistScriptBridge.BuiltInNames, name) >= 0 || ArsistScriptBridge.IsTaken(name)) continue;
                    try
                    {
                        engine.Invoke(factory, Jint.Native.JsValue.Undefined, new object[] { name, id, reason });
                        Debug.Log($"[Arsist] Extension '{id}' is not on this device; script name '{name}' does nothing here ({reason})");
                    }
                    catch (Exception ex)
                    {
                        Debug.LogWarning($"[Arsist] Extensions: stand-in for '{name}' failed: {ex.Message}");
                    }
                }
            }
        }

        private static bool _partsReplaced;

        /// <summary>
        /// 有効な拡張機能に、エンジンの部品を置き換えさせる (ArsistEngineParts.Get の初回)。1 回だけ。
        /// 失敗した拡張機能があっても、その部品はエンジン標準のまま動く。
        /// </summary>
        internal static void EnsureEnginePartsReplaced()
        {
            if (_partsReplaced) return;
            _partsReplaced = true;
            foreach (var e in Active())
            {
                try
                {
                    e.Extension.ReplaceEngineParts(new ArsistEngineParts.Replacer(e.Extension.Id), e.Context);
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[Arsist:{e.Extension.Id}] ReplaceEngineParts failed: {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}");
                }
            }
        }

        /// <summary>manifest.replacements: その部品を置き換えてよい拡張機能の id。無ければ null。</summary>
        internal static string ReplacementOwner(string part)
        {
            if (string.IsNullOrEmpty(part)) return null;
            Active();
            var owner = MiniJson.Text(MiniJson.Obj(_manifest, "replacements"), part, null);
            return string.IsNullOrEmpty(owner) ? null : owner;
        }

        /// <summary>シーンの最初の Start で 1 回 (ArsistExtensionHost)。</summary>
        internal static void StartAll(MonoBehaviour host)
        {
            foreach (var e in Active())
            {
                if (e.Started) continue;
                e.Started = true;
                e.Context.Host = host;
                try
                {
                    e.Extension.OnStart(e.Context);
                    Debug.Log($"[Arsist:{e.Extension.Id}] started");
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[Arsist:{e.Extension.Id}] OnStart failed: {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}");
                }
            }
        }
    }
}
