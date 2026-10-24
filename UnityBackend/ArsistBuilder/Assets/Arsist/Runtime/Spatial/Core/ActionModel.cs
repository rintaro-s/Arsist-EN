// ==============================================
// Arsist Engine - Layster.Spatial core: 行動と規則の条件
// Assets/Arsist/Runtime/Spatial/Core/ActionModel.cs
//
// 行動 (doc/19-layster.md §3.6) は規則・Mind の返事・スクリプト (world.act) で同じ形
// ({ do: "...", ... } の素の木)。ここは形の確認と、Mind が返してよい行動の絞り込み、規則の条件の評価。
// 実行は Unity 側 (ActionExecutor)。UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;
using System.Globalization;

namespace Arsist.Runtime.Spatial.Core
{
    public static class ActionModel
    {
        public static readonly string[] Kinds =
        {
            "place", "move", "look", "say", "animate", "show", "hide", "highlight", "set", "emit", "believe", "forget", "ask", "command",
        };

        public static string KindOf(Dictionary<string, object> action) => J.Str(action, "do", "");

        public static bool IsKnown(string kind) => Array.IndexOf(Kinds, kind) >= 0;

        /// <summary>形の確認。問題があればその説明 (無ければ null)。</summary>
        public static string Problem(Dictionary<string, object> a)
        {
            if (a == null) return "not an object";
            var kind = KindOf(a);
            if (!IsKnown(kind)) return $"unknown action \"{kind}\"";
            switch (kind)
            {
                case "place": case "move": case "look": case "animate": case "show": case "hide":
                    if (string.IsNullOrEmpty(J.Str(a, "thing"))) return $"{kind} needs \"thing\"";
                    break;
            }
            switch (kind)
            {
                case "move": if (J.Obj(a, "to") == null) return "move needs \"to\""; break;
                case "look": if (J.Obj(a, "at") == null) return "look needs \"at\""; break;
                case "say": if (J.Str(a, "text") == null) return "say needs \"text\""; break;
                case "animate": if (string.IsNullOrEmpty(J.Str(a, "clip"))) return "animate needs \"clip\""; break;
                case "highlight": if (J.Obj(a, "target") == null) return "highlight needs \"target\""; break;
                case "set": if (string.IsNullOrEmpty(J.Str(a, "key"))) return "set needs \"key\""; break;
                case "emit": if (string.IsNullOrEmpty(J.Str(a, "event"))) return "emit needs \"event\""; break;
                case "believe": if (string.IsNullOrEmpty(J.Str(J.Obj(a, "entity"), "id"))) return "believe needs \"entity.id\""; break;
                case "forget": if (string.IsNullOrEmpty(J.Str(a, "entity"))) return "forget needs \"entity\""; break;
                case "ask": if (string.IsNullOrEmpty(J.Str(a, "mind"))) return "ask needs \"mind\""; break;
                case "command":
                    if (string.IsNullOrEmpty(J.Str(a, "body")) || string.IsNullOrEmpty(J.Str(a, "name"))) return "command needs \"body\" and \"name\"";
                    break;
            }
            return null;
        }

        /// <summary>Mind が返してよい行動だけを残す (output.actions に無いものは捨てる)。</summary>
        public static List<Dictionary<string, object>> FilterForMind(MindDef mind, List<Dictionary<string, object>> actions, out List<Dictionary<string, object>> dropped)
        {
            var kept = new List<Dictionary<string, object>>();
            dropped = new List<Dictionary<string, object>>();
            if (actions == null) return kept;
            foreach (var a in actions)
            {
                if (a != null && mind.OutputActions.Contains(KindOf(a))) kept.Add(a);
                else dropped.Add(a);
            }
            return kept;
        }

        // ---- 規則の条件 ----

        /// <summary>条件を評価する。store は値を返す関数、has は entity の問い合わせ。</summary>
        public static bool Evaluate(Dictionary<string, object> condition, Func<string, object> store, Func<EntityQuery, bool> has)
        {
            if (condition == null) return true;
            if (condition.TryGetValue("not", out var inner) && inner is Dictionary<string, object> innerCond)
                return !Evaluate(innerCond, store, has);
            if (condition.TryGetValue("has", out var q) && q is Dictionary<string, object> query)
                return has != null && has(EntityQuery.FromPlain(query));
            var key = J.Str(condition, "store");
            if (key == null) return true;
            var value = store?.Invoke(key);
            if (condition.ContainsKey("exists") && J.Bool(condition, "exists", true) != (value != null)) return false;
            if (condition.ContainsKey("eq") && !SameValue(value, condition["eq"])) return false;
            if (condition.ContainsKey("ne") && SameValue(value, condition["ne"])) return false;
            if (condition.ContainsKey("gt") && !(ToNumber(value, out var g) && g > J.Num(condition, "gt", 0))) return false;
            if (condition.ContainsKey("lt") && !(ToNumber(value, out var l) && l < J.Num(condition, "lt", 0))) return false;
            return true;
        }

        public static bool SameValue(object a, object b)
        {
            if (a == null || b == null) return a == null && b == null;
            if (ToNumber(a, out var x) && ToNumber(b, out var y) && !(a is string) && !(b is string)) return Math.Abs(x - y) < 1e-9;
            if (a is bool ab && b is bool bb) return ab == bb;
            return string.Equals(Convert.ToString(a, CultureInfo.InvariantCulture), Convert.ToString(b, CultureInfo.InvariantCulture), StringComparison.Ordinal);
        }

        private static bool ToNumber(object v, out double n)
        {
            n = 0;
            switch (v)
            {
                case double d: n = d; return true;
                case float f: n = f; return true;
                case int i: n = i; return true;
                case long l: n = l; return true;
                case bool _: return false;
                case string s: return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out n);
                default: return false;
            }
        }
    }
}
