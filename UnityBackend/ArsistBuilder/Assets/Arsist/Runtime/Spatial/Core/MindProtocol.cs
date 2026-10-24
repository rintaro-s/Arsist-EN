// ==============================================
// Arsist Engine - Layster.Spatial core: Mind との話し方
// Assets/Arsist/Runtime/Spatial/Core/MindProtocol.cs
//
// src/shared/layster/spatial/mindProtocol.ts の写し。エディタの「Mind を試す」と実機が同じ要求を作り、
// 同じ規則で返事を読む (指示文の文字まで同じ)。片方だけ変えると「エディタでは動いたのに実機では動かない」になる。
//   layster      要求 = 観測 (MindRequest) をそのまま POST。返事 = MindReply の JSON
//   openai-chat  要求 = OpenAI 互換の chat/completions。観測を JSON の文として渡し、返事の文から JSON を拾う
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Arsist.Runtime.Inference;

namespace Arsist.Runtime.Spatial.Core
{
    public sealed class MindReply
    {
        public List<Dictionary<string, object>> Actions = new List<Dictionary<string, object>>();
        public List<Dictionary<string, object>> Beliefs = new List<Dictionary<string, object>>();
        public string Text;
        public double? NextInMs;

        public Dictionary<string, object> ToPlain()
        {
            var d = new Dictionary<string, object>
            {
                ["actions"] = new List<object>(Actions),
                ["beliefs"] = new List<object>(Beliefs),
            };
            d["text"] = Text;
            if (NextInMs.HasValue) d["nextInMs"] = NextInMs.Value;
            return d;
        }
    }

    public static class MindProtocol
    {
        public const string Protocol = "layster.mind/1";

        public static readonly Dictionary<string, string> ActionShapes = new Dictionary<string, string>
        {
            ["place"] = "{\"do\":\"place\",\"thing\":\"<thing id>\",\"at\":{\"frame\":\"user\",\"at\":[x,y,z]}}",
            ["move"] = "{\"do\":\"move\",\"thing\":\"<thing id>\",\"to\":{\"entity\":{\"id\":\"<entity id>\"}}}",
            ["look"] = "{\"do\":\"look\",\"thing\":\"<thing id>\",\"at\":{\"user\":\"head\"}}",
            ["say"] = "{\"do\":\"say\",\"text\":\"<short sentence>\"}",
            ["animate"] = "{\"do\":\"animate\",\"thing\":\"<thing id>\",\"clip\":\"<animation name>\"}",
            ["show"] = "{\"do\":\"show\",\"thing\":\"<thing id>\"}",
            ["hide"] = "{\"do\":\"hide\",\"thing\":\"<thing id>\"}",
            ["highlight"] = "{\"do\":\"highlight\",\"target\":{\"entity\":{\"id\":\"<entity id>\"}},\"label\":\"<few words>\",\"seconds\":5}",
            ["set"] = "{\"do\":\"set\",\"key\":\"<store key>\",\"value\":<any>}",
            ["emit"] = "{\"do\":\"emit\",\"event\":\"<event name>\"}",
            ["believe"] = "{\"do\":\"believe\",\"entity\":{\"id\":\"<id>\",\"is\":[\"cup\"],\"at\":[x,y,z],\"size\":[w,h,d],\"confidence\":0.6}}",
            ["forget"] = "{\"do\":\"forget\",\"entity\":\"<entity id>\"}",
            ["ask"] = "{\"do\":\"ask\",\"mind\":\"<mind id>\"}",
            ["command"] = "{\"do\":\"command\",\"body\":\"<body id>\",\"name\":\"<command>\",\"args\":{}}",
        };

        private static readonly Dictionary<string, string> RoleText = new Dictionary<string, string>
        {
            ["decide"] = "Decide what the app should do next, if anything. Doing nothing (an empty \"actions\" list) is often right.",
            ["converse"] = "Talk with the user. Keep replies short and natural.",
            ["perceive"] = "Report what is in the space as beliefs (entities). Do not invent things you cannot see.",
            ["predict"] = "Predict what is likely true now or soon (hidden or moving things) as beliefs with honest confidence.",
            ["act"] = "Choose commands for the physical body to reach the goal safely. One small step at a time.",
        };

        /// <summary>openai-chat の system の文 (systemPromptFor と同じ)。</summary>
        public static string SystemPromptFor(MindDef mind, string frame)
        {
            var lines = new List<string>
            {
                (mind.Instructions ?? "").Trim(),
                "",
                "You are connected to a mixed-reality app through Layster.",
                RoleText.TryGetValue(mind.Role ?? "decide", out var role) ? role : RoleText["decide"],
                $"Each user message is a JSON observation of the space. Units are metres and seconds; x is right, y is up, z is forward; positions are in the \"{frame}\" frame.",
                "Reply with ONLY one JSON object, no prose around it: {\"actions\":[...],\"beliefs\":[...],\"text\":\"...\"} (every field optional).",
            };
            if (mind.OutputActions.Count > 0)
            {
                lines.Add("Allowed actions (anything else is ignored):");
                foreach (var k in mind.OutputActions)
                    if (ActionShapes.TryGetValue(k, out var shape)) lines.Add("  " + shape);
            }
            else
            {
                lines.Add("Do not return actions.");
            }
            if (mind.OutputBeliefs)
                lines.Add("Beliefs: entities you think exist, e.g. {\"id\":\"cup-1\",\"is\":[\"cup\"],\"at\":[x,y,z],\"size\":[w,h,d],\"confidence\":0.6}.");
            // TS: lines.filter((l, i) => i > 0 || l !== '') — 先頭が空なら先頭だけ落とす
            if (lines[0].Length == 0) lines.RemoveAt(0);
            return string.Join("\n", lines);
        }

        /// <summary>OpenAI 互換の要求の本文。カメラの画は image_url で添え、観測の文からは外す。</summary>
        public static Dictionary<string, object> OpenAiChatBody(MindDef mind, Dictionary<string, object> request)
        {
            var observation = new Dictionary<string, object>();
            Dictionary<string, object> camera = null;
            foreach (var pair in request)
            {
                if (pair.Key == "camera") { camera = pair.Value as Dictionary<string, object>; continue; }
                if (pair.Key == "extra") continue;
                observation[pair.Key] = pair.Value;
            }
            var text = MiniJson.Write(observation);
            object content = text;
            if (camera != null)
            {
                content = new List<object>
                {
                    new Dictionary<string, object> { ["type"] = "text", ["text"] = text },
                    new Dictionary<string, object>
                    {
                        ["type"] = "image_url",
                        ["image_url"] = new Dictionary<string, object> { ["url"] = $"data:{J.Str(camera, "mime", "image/jpeg")};base64,{J.Str(camera, "data", "")}" },
                    },
                };
            }
            var body = new Dictionary<string, object>();
            if (!string.IsNullOrEmpty(mind.Model)) body["model"] = mind.Model;
            body["messages"] = new List<object>
            {
                new Dictionary<string, object> { ["role"] = "system", ["content"] = SystemPromptFor(mind, J.Str(request, "frame", "user")) },
                new Dictionary<string, object> { ["role"] = "user", ["content"] = content },
            };
            body["temperature"] = 0.2;
            body["max_tokens"] = 600.0;
            body["stream"] = false;
            if (mind.Extra != null) foreach (var pair in mind.Extra) body[pair.Key] = pair.Value;
            return body;
        }

        private static readonly Regex Think = new Regex("<think>[\\s\\S]*?</think>", RegexOptions.IgnoreCase);
        private static readonly Regex Fence = new Regex("```(?:json)?", RegexOptions.IgnoreCase);

        /// <summary>文の中から最初の JSON オブジェクトを拾う。考えと ``` の囲みは外す。</summary>
        public static Dictionary<string, object> ExtractJsonObject(string text)
        {
            var t = text ?? "";
            t = Think.Replace(t, "");
            t = Fence.Replace(t, "");
            int start = t.IndexOf('{');
            int end = t.LastIndexOf('}');
            if (start < 0 || end <= start) return null;
            try
            {
                return MiniJson.Parse(t.Substring(start, end - start + 1)) as Dictionary<string, object>;
            }
            catch (Exception)
            {
                return null;
            }
        }

        public static MindReply NormalizeReply(Dictionary<string, object> raw, string fallbackText)
        {
            var reply = new MindReply();
            if (raw == null)
            {
                if (!string.IsNullOrEmpty(fallbackText)) reply.Text = fallbackText;
                return reply;
            }
            var actions = J.List(raw, "actions");
            if (actions != null)
                foreach (var a in actions)
                    if (a is Dictionary<string, object> ad && ad.TryGetValue("do", out var d) && d is string) reply.Actions.Add(ad);
            var beliefs = J.List(raw, "beliefs");
            if (beliefs != null)
                foreach (var b in beliefs)
                    if (b is Dictionary<string, object> bd && bd.TryGetValue("id", out var id) && id is string) reply.Beliefs.Add(bd);
            if (raw.TryGetValue("text", out var text) && text is string s) reply.Text = s;
            if (raw.TryGetValue("nextInMs", out var next) && next is double n) reply.NextInMs = n;
            return reply;
        }

        public static MindReply ParseOpenAiChatReply(object json)
        {
            var choices = J.List(J.Obj(json), "choices");
            var message = choices != null && choices.Count > 0 ? J.Obj(J.Obj(choices[0]), "message") : null;
            string text = message != null && message.TryGetValue("content", out var c) && c is string cs ? cs : "";
            var fallback = Think.Replace(text, "").Trim();
            return NormalizeReply(ExtractJsonObject(text), fallback.Length > 0 ? fallback : null);
        }

        public static MindReply ParseLaysterReply(object json) => NormalizeReply(json as Dictionary<string, object>, null);

        /// <summary>'{edge}' と '{edge-host}' を置き換える。</summary>
        public static string ResolveEdge(string url, string edge)
        {
            var e = (edge ?? "").Trim();
            e = Regex.Replace(e, "^https?://", "");
            e = Regex.Replace(e, "/+$", "");
            var host = Regex.Replace(e, ":\\d+$", "");
            return (url ?? "").Replace("{edge-host}", host).Replace("{edge}", e);
        }
    }
}
