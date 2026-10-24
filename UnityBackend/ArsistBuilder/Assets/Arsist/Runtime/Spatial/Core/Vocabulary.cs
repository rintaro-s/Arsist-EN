// ==============================================
// Arsist Engine - Layster.Spatial core: 語彙
// Assets/Arsist/Runtime/Spatial/Core/Vocabulary.cs
//
// src/shared/layster/spatial/vocabulary.ts の規則の写し。言葉の表そのものは持たない
// (spatial.json の vocabulary を読む。エディタと実機で「机」の意味がずれないように)。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Spatial.Core
{
    public sealed class Vocabulary
    {
        public sealed class Word
        {
            public string Name;
            public List<string> Synonyms = new List<string>();
            public List<string> Has = new List<string>();
            public bool Vertical;
            public bool Structural;
            public List<string> Broader = new List<string>();
        }

        /// <summary>
        /// 部屋の面 (床・壁・天井)。vocabulary.ts の structural。spatial.json の語彙に structural が
        /// 書かれていればそちらを使い、無ければこの 3 つ (今の語彙で structural なのはこれだけ)。
        /// </summary>
        private static readonly string[] DefaultStructural = { "floor", "wall", "ceiling" };

        private readonly Dictionary<string, Word> _index = new Dictionary<string, Word>(StringComparer.Ordinal);
        private readonly Dictionary<string, List<string>> _broader = new Dictionary<string, List<string>>(StringComparer.Ordinal);

        public readonly List<Word> Words = new List<Word>();

        public static Vocabulary FromPlain(List<object> list)
        {
            var v = new Vocabulary();
            if (list == null) return v;
            bool anyStructuralField = false;
            foreach (var raw in list)
            {
                var d = J.Obj(raw);
                if (d == null) continue;
                var w = new Word
                {
                    Name = (J.Str(d, "word", "") ?? "").Trim().ToLowerInvariant(),
                    Synonyms = J.Strings(d, "synonyms") ?? new List<string>(),
                    Has = J.Strings(d, "has") ?? new List<string>(),
                    Vertical = J.Bool(d, "vertical", false),
                    Broader = J.Strings(d, "broader") ?? new List<string>(),
                };
                if (d.ContainsKey("structural")) { anyStructuralField = true; w.Structural = J.Bool(d, "structural", false); }
                if (w.Name.Length == 0) continue;
                v.Words.Add(w);
            }
            if (!anyStructuralField)
                foreach (var w in v.Words) w.Structural = Array.IndexOf(DefaultStructural, w.Name) >= 0;
            // 正規の言葉を先に、同義語は後から (先に入ったものが勝つ。vocabulary.ts の INDEX と同じ)
            foreach (var w in v.Words)
            {
                v._index[w.Name] = w;
                foreach (var s in w.Synonyms)
                {
                    var key = s.ToLowerInvariant();
                    if (!v._index.ContainsKey(key)) v._index[key] = w;
                }
                v._broader[w.Name] = w.Broader;
            }
            return v;
        }

        public Word Lookup(string word)
        {
            var key = (word ?? "").Trim().ToLowerInvariant();
            return _index.TryGetValue(key, out var w) ? w : null;
        }

        public string Canonical(string word)
        {
            var key = (word ?? "").Trim().ToLowerInvariant();
            return _index.TryGetValue(key, out var w) ? w.Name : key;
        }

        /// <summary>entity の言葉が wanted に当たるか (同義語、狭い → 広い)。</summary>
        public bool WordMatches(string entityWord, string wanted)
        {
            var a = Canonical(entityWord);
            var b = Canonical(wanted);
            if (a == b) return true;
            return _broader.TryGetValue(a, out var broader) && broader.Contains(b);
        }

        public List<string> AffordancesOf(Entity e)
        {
            if (e.Has != null && e.Has.Count > 0) return e.Has;
            var set = new List<string>();
            foreach (var w in e.Is)
            {
                var word = Lookup(w);
                if (word == null) continue;
                foreach (var a in word.Has) if (!set.Contains(a)) set.Add(a);
            }
            return set;
        }

        public bool IsVertical(Entity e)
        {
            var w = e.Is.Count > 0 ? Lookup(e.Is[0]) : null;
            if (w != null && w.Vertical) return true;
            double width = e.Size.X, height = e.Size.Y, depth = e.Size.Z;
            return depth < 0.05 && height > 0.3 && height > depth * 4 && width > 0.1;
        }

        public bool IsStructural(Entity e)
        {
            var w = e.Is.Count > 0 ? Lookup(e.Is[0]) : null;
            return w != null && w.Structural;
        }

        private bool AnyWord(Entity e, List<string> wanted)
        {
            foreach (var want in wanted)
                foreach (var w in e.Is)
                    if (WordMatches(w, want)) return true;
            return false;
        }

        /// <summary>言葉・除外・できること・確かさ (位置の条件は solver が見る)。</summary>
        public bool MatchesWords(Entity e, EntityQuery q)
        {
            if (!string.IsNullOrEmpty(q.Id) && e.Id != q.Id) return false;
            if (q.Is != null && q.Is.Count > 0 && !AnyWord(e, q.Is)) return false;
            if (q.Not != null && q.Not.Count > 0 && AnyWord(e, q.Not)) return false;
            if (q.Has != null && q.Has.Count > 0)
            {
                var has = AffordancesOf(e);
                foreach (var a in q.Has) if (!has.Contains(a)) return false;
            }
            double min = q.MinConfidence ?? 0.2;
            return e.Confidence >= min;
        }
    }
}
