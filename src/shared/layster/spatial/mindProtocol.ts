/**
 * Layster.Spatial — Mind との話し方 (doc/19-layster.md §3.5)。
 *
 * エディタの「Mind を試す」(main から HTTP) とランタイム (C# の写し Runtime/Spatial/Core/MindProtocol.cs) が
 * 同じ要求を作り、同じ規則で返事を読む。片方だけ変えると「エディタでは動いたのに実機では動かない」になる。
 *
 *   layster      要求 = MindRequest をそのまま POST。返事 = MindReply の JSON
 *   openai-chat  要求 = OpenAI 互換の chat/completions。観測を JSON の文として渡し、返事の文から JSON を拾う
 */

import type { Action, ActionKind, Mind, MindReply, MindRequest } from './types';

export const MIND_PROTOCOL = 'layster.mind/1';

/** openai-chat の指示文に書く、行動ごとの形 (1 行 1 つ)。 */
export const ACTION_SHAPES: Record<ActionKind, string> = {
  place: '{"do":"place","thing":"<thing id>","at":{"frame":"user","at":[x,y,z]}}',
  move: '{"do":"move","thing":"<thing id>","to":{"entity":{"id":"<entity id>"}}}',
  look: '{"do":"look","thing":"<thing id>","at":{"user":"head"}}',
  say: '{"do":"say","text":"<short sentence>"}',
  animate: '{"do":"animate","thing":"<thing id>","clip":"<animation name>"}',
  show: '{"do":"show","thing":"<thing id>"}',
  hide: '{"do":"hide","thing":"<thing id>"}',
  highlight: '{"do":"highlight","target":{"entity":{"id":"<entity id>"}},"label":"<few words>","seconds":5}',
  set: '{"do":"set","key":"<store key>","value":<any>}',
  emit: '{"do":"emit","event":"<event name>"}',
  believe: '{"do":"believe","entity":{"id":"<id>","is":["cup"],"at":[x,y,z],"size":[w,h,d],"confidence":0.6}}',
  forget: '{"do":"forget","entity":"<entity id>"}',
  ask: '{"do":"ask","mind":"<mind id>"}',
  command: '{"do":"command","body":"<body id>","name":"<command>","args":{}}',
};

const ROLE_TEXT: Record<Mind['role'], string> = {
  decide: 'Decide what the app should do next, if anything. Doing nothing (an empty "actions" list) is often right.',
  converse: 'Talk with the user. Keep replies short and natural.',
  perceive: 'Report what is in the space as beliefs (entities). Do not invent things you cannot see.',
  predict: 'Predict what is likely true now or soon (hidden or moving things) as beliefs with honest confidence.',
  act: 'Choose commands for the physical body to reach the goal safely. One small step at a time.',
};

/** openai-chat の system の文。 */
export function systemPromptFor(mind: Mind, frame: string): string {
  const allowed = mind.output.actions ?? [];
  const lines = [
    (mind.instructions ?? '').trim(),
    '',
    'You are connected to a mixed-reality app through Layster.',
    ROLE_TEXT[mind.role],
    `Each user message is a JSON observation of the space. Units are metres and seconds; x is right, y is up, z is forward; positions are in the "${frame}" frame.`,
    'Reply with ONLY one JSON object, no prose around it: {"actions":[...],"beliefs":[...],"text":"..."} (every field optional).',
  ];
  if (allowed.length > 0) {
    lines.push('Allowed actions (anything else is ignored):');
    for (const k of allowed) lines.push(`  ${ACTION_SHAPES[k]}`);
  } else {
    lines.push('Do not return actions.');
  }
  if (mind.output.beliefs) {
    lines.push('Beliefs: entities you think exist, e.g. {"id":"cup-1","is":["cup"],"at":[x,y,z],"size":[w,h,d],"confidence":0.6}.');
  }
  return lines.filter((l, i) => i > 0 || l !== '').join('\n');
}

/** OpenAI 互換の要求の本文。カメラの画は image_url で添え、観測の文からは外す。 */
export function openAiChatBody(mind: Mind, request: MindRequest): Record<string, unknown> {
  const { camera, extra: _extra, ...observation } = request;
  const text = JSON.stringify(observation);
  const content = camera
    ? [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: `data:${camera.mime};base64,${camera.data}` } },
      ]
    : text;
  return {
    ...(mind.model ? { model: mind.model } : {}),
    messages: [
      { role: 'system', content: systemPromptFor(mind, request.frame) },
      { role: 'user', content },
    ],
    temperature: 0.2,
    max_tokens: 600,
    stream: false,
    ...(mind.extra ?? {}),
  };
}

/** 文の中から最初の JSON オブジェクトを拾う。考え (<think>…</think>) と ``` の囲みは外す。 */
export function extractJsonObject(text: string): Record<string, unknown> | undefined {
  let t = String(text ?? '');
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const v = JSON.parse(t.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** 返事の形を整える (足りない・違う型の項目は捨てる)。 */
export function normalizeReply(raw: Record<string, unknown> | undefined, fallbackText?: string): MindReply {
  if (!raw) return fallbackText ? { text: fallbackText } : {};
  const reply: MindReply = {};
  if (Array.isArray(raw.actions)) reply.actions = raw.actions.filter((a): a is Action => !!a && typeof a === 'object' && typeof (a as { do?: unknown }).do === 'string');
  if (Array.isArray(raw.beliefs)) reply.beliefs = raw.beliefs.filter((b): b is NonNullable<MindReply['beliefs']>[number] => !!b && typeof b === 'object' && typeof (b as { id?: unknown }).id === 'string');
  if (typeof raw.text === 'string') reply.text = raw.text;
  if (typeof raw.nextInMs === 'number') reply.nextInMs = raw.nextInMs;
  return reply;
}

/** openai-chat の返事 (chat/completions の JSON) を読む。 */
export function parseOpenAiChatReply(json: unknown): MindReply {
  const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : '';
  return normalizeReply(extractJsonObject(text), text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || undefined);
}

/** layster の返事を読む。 */
export function parseLaysterReply(json: unknown): MindReply {
  return normalizeReply(json && typeof json === 'object' ? json as Record<string, unknown> : undefined);
}

/** '{edge}' と '{edge-host}' を置き換える。 */
export function resolveEdge(url: string, edge: string | undefined): string {
  const e = (edge ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const host = e.replace(/:\d+$/, '');
  return url.split('{edge-host}').join(host).split('{edge}').join(e);
}
