// ==============================================
// Arsist Engine - Extensions: engine parts an extension may replace
// Assets/Arsist/Runtime/Extensions/ArsistEngineParts.cs
//
// エンジンの一部を、拡張機能が決まった形 (インターフェース) の実装で置き換える仕組み。
// ファイルを丸ごと差し替える unity.overrides と違い、エンジンの中が変わっても拡張機能は壊れない。
//
//   extension.json    "replaces": ["vrm-loader"]
//   入口              public override void ReplaceEngineParts(ArsistEngineParts.Replacer parts, ArsistExtensionContext context)
//                     {
//                         parts.Replace<IArsistVrmLoader>(ArsistEngineParts.VrmLoader, new MyLoader());
//                     }
//   エンジン          var loader = ArsistEngineParts.Get<IArsistVrmLoader>(ArsistEngineParts.VrmLoader);
//                     if (loader != null) { …拡張機能のもの… } else { …エンジン標準… }
//
// ビルドが manifest.replacements (部品 → 拡張機能) を書く。そこに無い置き換え (extension.json に
// 書いていない・別の拡張機能の部品) はここで断る。一覧は src/shared/engineParts.ts と同じ (テストで照合)。
// 部品を足すときは Parts に 1 行と、エンジンの使う場所で Get を通す。doc/17-extensions.md §2.6。
// ==============================================

using System;
using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.Extensions
{
    [UnityEngine.Scripting.Preserve]
    public static class ArsistEngineParts
    {
        public const string VrmLoader = "vrm-loader";
        public const string StorageBackend = "storage-backend";

        /// <summary>"script:audio" のように書くと、組み込みのスクリプトの名前を置き換える (RegisterScriptGlobals で Set)。</summary>
        public const string ScriptPrefix = "script:";

        /// <summary>部品 → 拡張機能が実装するインターフェース。src/shared/engineParts.ts の ENGINE_PARTS と同じ。</summary>
        private static readonly Dictionary<string, Type> Parts = new Dictionary<string, Type>(StringComparer.Ordinal)
        {
            { VrmLoader, typeof(Arsist.Runtime.VRM.IArsistVrmLoader) },
            { StorageBackend, typeof(Arsist.Runtime.Data.IArsistStorageBackend) },
        };

        private static readonly Dictionary<string, object> Replaced = new Dictionary<string, object>(StringComparer.Ordinal);

        /// <summary>
        /// その部品を置き換えた拡張機能の実装。置き換えられていなければ null (エンジン標準を使う)。
        /// 初めて呼ばれたときに、有効な拡張機能の ReplaceEngineParts を呼ぶ (順番を気にしなくてよいように)。
        /// </summary>
        public static T Get<T>(string part) where T : class
        {
            ArsistExtensions.EnsureEnginePartsReplaced();
            return Replaced.TryGetValue(part, out var impl) ? impl as T : null;
        }

        /// <summary>その部品を置き換えている拡張機能の id (ビルドが決めたもの)。無ければ null。</summary>
        public static string OwnerOf(string part) => ArsistExtensions.ReplacementOwner(part);

        /// <summary>拡張機能が ReplaceEngineParts で受け取る口。</summary>
        [UnityEngine.Scripting.Preserve]
        public sealed class Replacer
        {
            private readonly string _extensionId;

            internal Replacer(string extensionId)
            {
                _extensionId = extensionId;
            }

            /// <summary>
            /// 部品を置き換える。extension.json の replaces に書いた部品だけ。
            /// 断ったときは理由をログに出して false (エンジン標準のまま動く)。
            /// </summary>
            public bool Replace<T>(string part, T implementation) where T : class
            {
                if (string.IsNullOrEmpty(part) || implementation == null)
                {
                    Debug.LogError($"[Arsist:{_extensionId}] ReplaceEngineParts: a part name and an implementation are required");
                    return false;
                }
                if (part.StartsWith(ScriptPrefix, StringComparison.Ordinal))
                {
                    Debug.LogError($"[Arsist:{_extensionId}] '{part}' is a script name: set it with script.Set(\"{part.Substring(ScriptPrefix.Length)}\", …) in RegisterScriptGlobals");
                    return false;
                }
                if (!Parts.TryGetValue(part, out var expected))
                {
                    Debug.LogError($"[Arsist:{_extensionId}] '{part}' is not an engine part that can be replaced (known: {string.Join(", ", Parts.Keys)})");
                    return false;
                }
                if (!expected.IsInstanceOfType(implementation))
                {
                    Debug.LogError($"[Arsist:{_extensionId}] '{part}' needs an implementation of {expected.FullName}; {implementation.GetType().FullName} is not one");
                    return false;
                }
                var owner = ArsistExtensions.ReplacementOwner(part);
                if (owner != _extensionId)
                {
                    Debug.LogError(
                        $"[Arsist:{_extensionId}] may not replace '{part}': " +
                        (string.IsNullOrEmpty(owner) ? "it is not listed in this extension's \"replaces\" (extension.json)" : $"extension '{owner}' replaces it in this build"));
                    return false;
                }
                Replaced[part] = implementation;
                Debug.Log($"[Arsist:{_extensionId}] replaces engine part '{part}' with {implementation.GetType().FullName}");
                return true;
            }
        }
    }
}
