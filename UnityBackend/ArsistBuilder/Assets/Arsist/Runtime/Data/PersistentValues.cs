// ==============================================
// Arsist Engine - 端末に保存する値の規則とファイル形式 (UnityEngine に依存しない)
//
// どのキーを残すかは project.storage.persist (scripts.json の storage.persist) で決まる。
//   'memory.'   末尾が '.' → 前方一致 (memory.〜 すべて)
//   'user.name' それ以外 → そのキーだけ
// エディタ側の isPersistedKey (src/shared/types.ts) と同じ規則。ただしストア (ArsistDataStore) が
// 大文字小文字を区別しないので、ここも区別しない。
//
// ファイル (Application.persistentDataPath/arsist-storage.json):
//   { "version": 1, "savedAt": "<ISO>", "values": { "<key>": <JSON の値>, … } }
//
// tools/perception-check で検証している。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Inference;

namespace Arsist.Runtime.Data
{
    public static class PersistentValues
    {
        public const int FileVersion = 1;

        public static bool IsPersisted(string key, IReadOnlyList<string> rules)
        {
            if (string.IsNullOrEmpty(key) || rules == null) return false;
            for (int i = 0; i < rules.Count; i++)
            {
                var rule = rules[i];
                if (string.IsNullOrEmpty(rule)) continue;
                if (rule.EndsWith(".", StringComparison.Ordinal))
                {
                    if (key.StartsWith(rule, StringComparison.OrdinalIgnoreCase)) return true;
                }
                else if (string.Equals(key, rule, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>'memory.' なら memory.〜、'x' なら x と x.〜 (入れ子として書いた子) に当たるか。storage.forget 用。</summary>
        public static bool MatchesForget(string key, string keyOrPrefix)
        {
            if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(keyOrPrefix)) return false;
            if (keyOrPrefix.EndsWith(".", StringComparison.Ordinal))
                return key.StartsWith(keyOrPrefix, StringComparison.OrdinalIgnoreCase);
            return string.Equals(key, keyOrPrefix, StringComparison.OrdinalIgnoreCase)
                || key.StartsWith(keyOrPrefix + ".", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>ストアの中身から、残すものだけを選ぶ (キーは名前順)。</summary>
        public static SortedDictionary<string, object> Select(IEnumerable<KeyValuePair<string, object>> snapshot, IReadOnlyList<string> rules)
        {
            var picked = new SortedDictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            if (snapshot == null) return picked;
            foreach (var pair in snapshot)
            {
                if (pair.Value == null) continue;               // 消した値は残さない
                if (IsPersisted(pair.Key, rules)) picked[pair.Key] = pair.Value;
            }
            return picked;
        }

        public static string Serialize(IDictionary<string, object> values, DateTime savedAtUtc)
        {
            var root = new Dictionary<string, object>
            {
                ["version"] = (double)FileVersion,
                ["savedAt"] = savedAtUtc.ToString("o"),
                ["values"] = new Dictionary<string, object>(values ?? new Dictionary<string, object>()),
            };
            return MiniJson.Write(root);
        }

        /// <summary>ファイルを読む。壊れていれば null と理由 (呼ぶ側は「何も無かった」として続ける)。</summary>
        public static Dictionary<string, object> Deserialize(string text, out string error)
        {
            error = null;
            if (string.IsNullOrWhiteSpace(text)) { error = "empty"; return null; }
            try
            {
                var root = MiniJson.Parse(text) as Dictionary<string, object>;
                if (root == null) { error = "notAnObject"; return null; }
                var values = MiniJson.Obj(root, "values");
                if (values == null) { error = "noValues"; return null; }
                return values;
            }
            catch (Exception e)
            {
                error = e.Message;
                return null;
            }
        }
    }
}
