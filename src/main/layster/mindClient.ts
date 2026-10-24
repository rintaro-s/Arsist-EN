/**
 * エディタから Mind を試す (main から HTTP)。
 *
 * ランタイム (Runtime/Spatial/Core/MindProtocol.cs) と同じ要求を作り、同じ規則で返事を読む
 * (mindProtocol.ts)。main から送るのは、renderer の CORS を避けるためと、鍵を renderer に渡さないため。
 * 返す `sent` は本文だけ (鍵はヘッダーにしか入れない)。
 */
import {
  MIND_PROTOCOL, openAiChatBody, parseLaysterReply, parseOpenAiChatReply, resolveEdge,
} from '../../shared/layster/spatial/mindProtocol';
import type { Mind, MindRequest } from '../../shared/layster/spatial/types';
import type { TryMindResult } from '../../shared/layster/spatial/ipc';

export interface CallMindOptions {
  /** {edge} を置き換えるアドレス */
  edge?: string;
  /** 鍵の値 (名前 → 値) */
  secrets?: Record<string, string>;
  /** 既定は mind.run.timeoutMs、無ければ 10 秒 */
  timeoutMs?: number;
  /** テスト用 */
  fetchImpl?: typeof fetch;
}

/** Mind に 1 回問い合わせる。例外は投げず、ok: false と理由を返す。 */
export async function callMind(mind: Mind, request: MindRequest, options: CallMindOptions = {}): Promise<TryMindResult> {
  const started = Date.now();
  const url = resolveEdge(mind.endpoint ?? '', options.edge);
  if (!/^https?:\/\/[^/{}]+/.test(url)) {
    return { ok: false, ms: 0, error: url.includes('{edge') || /^https?:\/\/(\/|:)/.test(url)
      ? `the endpoint needs the PC address ({edge}); set it first (got "${url}")`
      : `not an http(s) URL: "${url}"` };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'Layster/1' };
  if (mind.auth) {
    const value = options.secrets?.[mind.auth.secret];
    if (!value) return { ok: false, ms: 0, error: `the key "${mind.auth.secret}" is not set` };
    const scheme = mind.auth.scheme ?? 'Bearer';
    headers[mind.auth.header || 'Authorization'] = scheme ? `${scheme} ${value}` : value;
  }

  const req: MindRequest = { ...request, protocol: MIND_PROTOCOL as MindRequest['protocol'], mind: mind.id };
  const body = mind.protocol === 'openai-chat'
    ? openAiChatBody(mind, req)
    : { ...req, ...(mind.extra ? { extra: mind.extra } : {}) };

  const timeoutMs = options.timeoutMs ?? mind.run?.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const raw = await res.text();
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, ms, status: res.status, sent: body, raw, error: `HTTP ${res.status}` };
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, ms, status: res.status, sent: body, raw, error: 'the reply is not JSON' };
    }
    const reply = mind.protocol === 'openai-chat' ? parseOpenAiChatReply(json) : parseLaysterReply(json);
    return { ok: true, ms, status: res.status, sent: body, raw, reply };
  } catch (e) {
    const ms = Date.now() - started;
    const aborted = (e as Error).name === 'AbortError';
    return { ok: false, ms, sent: body, error: aborted ? `no reply within ${timeoutMs} ms` : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
