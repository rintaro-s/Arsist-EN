/**
 * 内蔵エージェント — OpenAI 互換の API (chat/completions + function calling) を話す AI が、
 * MCP と同じツール (src/main/mcp/tools.ts) でプロジェクトを編集する。
 *
 * 対応先は「OpenAI 互換の /chat/completions がツール呼び出しに対応しているもの」なら何でも:
 * OpenAI / OpenRouter / DeepSeek / Qwen (DashScope) / Groq / Ollama / LM Studio / vLLM / llama.cpp server …
 *
 * 1 回の依頼の流れ:
 *   1. 会話 + ツールの一覧を送る
 *   2. ツール呼び出しが返ってきたら、ツールを実行して結果を会話に足し、1 に戻る (上限 maxSteps)
 *   3. 文章だけが返ってきたら終わり
 * 最初にプロジェクトを書き換えるツールを呼ぶ前に、プロジェクトを Backups/agent/<時刻>/ に写す
 * (restoreSnapshot で「元に戻す」)。途中で止めても、そこまでの変更は写しから戻せる。
 *
 * ストリーミングは使わない (互換 API の実装によって挙動の揺れが大きいため)。代わりに、ツールを呼ぶたびに
 * onEvent で途中経過を出す。
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { ARSIST_TOOLS, callArsistTool, ToolSession } from '../mcp/tools';
import { ENGINE_SCRIPT_REFERENCE, IR_REFERENCE } from '../mcp/scriptReference';

export interface AssistantSettings {
  /** 例: https://api.openai.com/v1 (末尾の /chat/completions は付けない) */
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  /** 1 回の依頼でツールを呼ぶ上限 */
  maxSteps?: number;
  /** 1 回の HTTP の待ち時間 (ms) */
  timeoutMs?: number;
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type AssistantEvent =
  | { type: 'thinking'; step: number }
  | { type: 'tool-call'; id: string; name: string; args: unknown }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'snapshot'; snapshotId: string }
  | { type: 'message'; content: string }
  | { type: 'error'; message: string }
  | { type: 'done'; changed: boolean; steps: number };

const TOOL_RESULT_LIMIT = 12000;

export function systemPrompt(context: { projectPath?: string | null; targetDevice?: string; selection?: string; language?: string }): string {
  return [
    'You are the assistant inside Arsist, an editor that builds AR/VR apps for Meta Quest, XREAL glasses and Android phones from one project.',
    'You change the project only through the tools. Never invent ids: list or get things first.',
    'Before writing scripts or placing objects, read arsist_script_reference once. Keep changes small and say what you changed.',
    'After a set of changes, call ir_validate_project and fix what it reports.',
    'If a tool fails, read the error and correct the call; do not repeat the same failing call.',
    context.language === 'ja' ? 'Answer in Japanese.' : 'Answer in the user\'s language.',
    context.projectPath ? `The open project is ${context.projectPath}${context.targetDevice ? ` (target device ${context.targetDevice})` : ''}.` : 'No project is open; ask the user to open one, or use arsist_list_recent_projects.',
    context.selection ? `The user has selected: ${context.selection}.` : '',
    '',
    IR_REFERENCE,
    // スクリプトの早見表は長いので要点だけ。詳しくは arsist_script_reference を呼ぶ
    ENGINE_SCRIPT_REFERENCE.split('\n').slice(0, 12).join('\n'),
  ].filter((l) => l !== undefined).join('\n');
}

export function openAiTools(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return ARSIST_TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
}

function endpoint(baseUrl: string, suffix: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/${suffix}`;
}

function headers(settings: AssistantSettings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey) h.Authorization = `Bearer ${settings.apiKey}`;
  return h;
}

/** 接続の確認とモデルの一覧 (GET /models)。一覧を出さない実装もあるので、失敗しても致命的ではない。 */
export async function listModels(settings: AssistantSettings): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  try {
    const res = await fetch(endpoint(settings.baseUrl, 'models'), { headers: headers(settings), signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    const data = JSON.parse(text);
    const models = (Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [])
      .map((m: any) => (typeof m === 'string' ? m : m?.id ?? m?.name)).filter(Boolean);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---- 元に戻すための写し ----

const SNAPSHOT_ITEMS = ['project.json', 'Scenes', 'UI'];

export async function snapshotProject(projectPath: string): Promise<string> {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(projectPath, 'Backups', 'agent', id);
  for (const item of SNAPSHOT_ITEMS) {
    const src = path.join(projectPath, item);
    if (await fs.pathExists(src)) await fs.copy(src, path.join(dir, item));
  }
  return id;
}

export async function restoreSnapshot(projectPath: string, snapshotId: string): Promise<void> {
  if (!/^[0-9TZ-]+$/.test(snapshotId)) throw new Error('bad snapshot id');
  const dir = path.join(projectPath, 'Backups', 'agent', snapshotId);
  if (!await fs.pathExists(path.join(dir, 'project.json'))) throw new Error(`snapshot ${snapshotId} not found`);
  for (const item of SNAPSHOT_ITEMS) {
    const dest = path.join(projectPath, item);
    const src = path.join(dir, item);
    if (await fs.pathExists(src)) {
      await fs.remove(dest);
      await fs.copy(src, dest);
    }
  }
}

// ---- 会話 ----

export class AssistantConversation {
  readonly messages: ChatMessage[] = [];
  private controller: AbortController | null = null;

  constructor(private readonly session: ToolSession) {}

  get running(): boolean {
    return this.controller !== null;
  }

  abort(): void {
    this.controller?.abort();
  }

  /**
   * ユーザーの依頼を 1 つ処理する。
   * @param system 毎回作り直す (開いているプロジェクトや選択が変わるため)。履歴の先頭の system を置き換える
   */
  async send(userText: string, settings: AssistantSettings, system: string, onEvent: (e: AssistantEvent) => void): Promise<void> {
    if (this.controller) throw new Error('already running');
    if (!settings.baseUrl || !settings.model) {
      onEvent({ type: 'error', message: 'set the API URL and model in Settings → AI assistant' });
      onEvent({ type: 'done', changed: false, steps: 0 });
      return;
    }
    this.controller = new AbortController();
    const signal = this.controller.signal;
    if (this.messages[0]?.role === 'system') this.messages[0] = { role: 'system', content: system };
    else this.messages.unshift({ role: 'system', content: system });
    this.messages.push({ role: 'user', content: userText });

    const maxSteps = settings.maxSteps ?? 24;
    let snapshotTaken = false;
    let changed = false;
    let step = 0;
    try {
      while (step < maxSteps) {
        step++;
        onEvent({ type: 'thinking', step });
        const reply = await this.complete(settings, signal);
        const calls = reply.tool_calls ?? [];
        this.messages.push({ role: 'assistant', content: reply.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
        if (reply.content && reply.content.trim()) onEvent({ type: 'message', content: reply.content.trim() });
        if (calls.length === 0) break;

        for (const call of calls) {
          if (signal.aborted) throw new DOMException('aborted', 'AbortError');
          let args: Record<string, unknown> = {};
          let parseError: string | null = null;
          try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch (e) {
            parseError = `the arguments were not valid JSON: ${(e as Error).message}`;
          }
          onEvent({ type: 'tool-call', id: call.id, name: call.function.name, args });

          const tool = ARSIST_TOOLS.find((t) => t.name === call.function.name);
          if (tool && !tool.readOnly && !snapshotTaken && this.session.projectPath) {
            // 書き換える前に一度だけ写す (この依頼の変更を、まとめて元に戻せるように)
            const id = await snapshotProject(this.session.projectPath);
            snapshotTaken = true;
            onEvent({ type: 'snapshot', snapshotId: id });
          }

          const outcome = parseError ? { ok: false, error: parseError } : await callArsistTool(this.session, call.function.name, args);
          if (outcome.ok && tool && !tool.readOnly) changed = true;
          const body = outcome.ok ? (typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result)) : JSON.stringify({ error: outcome.error });
          const content = body.length > TOOL_RESULT_LIMIT ? `${body.slice(0, TOOL_RESULT_LIMIT)}… (truncated, ${body.length} chars)` : body;
          this.messages.push({ role: 'tool', tool_call_id: call.id, content });
          onEvent({ type: 'tool-result', id: call.id, name: call.function.name, ok: outcome.ok, summary: outcome.ok ? summarize(outcome.result) : String(outcome.error) });
        }
      }
      if (step >= maxSteps) onEvent({ type: 'error', message: `stopped after ${maxSteps} steps (raise the limit in Settings if this was expected)` });
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError' || signal.aborted;
      onEvent({ type: 'error', message: aborted ? 'stopped' : (e as Error).message });
      // 途中で止まった呼び出しに対応する tool の返事が無いと、次の依頼で API が会話を受け付けないので整える
      this.repairDanglingToolCalls();
    } finally {
      this.controller = null;
      onEvent({ type: 'done', changed, steps: step });
    }
  }

  reset(): void {
    this.messages.length = 0;
  }

  private repairDanglingToolCalls(): void {
    const answered = new Set(this.messages.filter((m): m is Extract<ChatMessage, { role: 'tool' }> => m.role === 'tool').map((m) => m.tool_call_id));
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i];
      if (m.role !== 'assistant' || !m.tool_calls) continue;
      const missing = m.tool_calls.filter((c) => !answered.has(c.id));
      let at = i + 1;
      while (at < this.messages.length && this.messages[at].role === 'tool') at++;
      for (const c of missing) {
        this.messages.splice(at++, 0, { role: 'tool', tool_call_id: c.id, content: JSON.stringify({ error: 'stopped by the user' }) });
        answered.add(c.id);
      }
    }
  }

  private async complete(settings: AssistantSettings, signal: AbortSignal): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
    const timeout = AbortSignal.timeout(settings.timeoutMs ?? 120000);
    const both = anySignal([signal, timeout]);
    const body: Record<string, unknown> = {
      model: settings.model,
      messages: this.messages,
      tools: openAiTools(),
      tool_choice: 'auto',
    };
    if (settings.temperature !== undefined) body.temperature = settings.temperature;
    const res = await fetch(endpoint(settings.baseUrl, 'chat/completions'), {
      method: 'POST', headers: headers(settings), body: JSON.stringify(body), signal: both,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${settings.baseUrl}: ${text.slice(0, 500)}`);
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`the API did not return JSON: ${text.slice(0, 200)}`);
    }
    const message = data?.choices?.[0]?.message;
    if (!message) throw new Error(`unexpected response: ${text.slice(0, 300)}`);
    const calls: ToolCall[] = (message.tool_calls ?? []).map((c: any, i: number) => ({
      id: c.id || `call_${Date.now()}_${i}`,
      type: 'function',
      function: {
        name: c.function?.name ?? '',
        arguments: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {}),
      },
    }));
    return { content: typeof message.content === 'string' ? message.content : null, tool_calls: calls };
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) { controller.abort(s.reason); break; }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

function summarize(result: unknown): string {
  if (typeof result === 'string') return `${result.length} chars`;
  if (result && typeof result === 'object') {
    const r = result as Record<string, any>;
    if (r.object?.name) return `${r.object.name} (${r.object.id})`;
    if (r.element?.type) return `${r.element.type} ${r.element.bindingId ?? r.element.id}`;
    if (r.script?.name) return `script ${r.script.name}`;
    if (Array.isArray(r.problems)) return r.ok ? 'no problems' : `${r.problems.length} problem(s)`;
    return Object.keys(r).slice(0, 4).join(', ');
  }
  return String(result);
}
