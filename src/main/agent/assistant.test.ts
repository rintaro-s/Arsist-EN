import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AssistantConversation, listModels, restoreSnapshot, type AssistantEvent } from './assistant';
import { ToolSession } from '../mcp/tools';
import { CURRENT_IR_VERSION } from '../../shared/irVersion';

let dir: string;
let server: http.Server;
let baseUrl: string;
let replies: Array<(body: any) => { status?: number; json?: unknown; text?: string; delayMs?: number }>;
let requests: any[];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arsist-agent-'));
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    id: 'p', name: 'A', irVersion: CURRENT_IR_VERSION, targetDevice: 'Meta_Quest', arSettings: {}, dataFlow: { dataSources: [], transforms: [] },
    scenes: [{ id: 's1', name: 'Main', objects: [] }], uiLayouts: [], scripts: [], extensions: {},
  }));
  replies = [];
  requests = [];
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'm-small' }, { id: 'm-large' }] }));
        return;
      }
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ auth: req.headers.authorization, body });
      const next = replies.shift() ?? (() => ({ json: { choices: [{ message: { role: 'assistant', content: 'ok' } }] } }));
      const r = next(body);
      setTimeout(() => {
        res.writeHead(r.status ?? 200, { 'Content-Type': 'application/json' });
        res.end(r.text ?? JSON.stringify(r.json));
      }, r.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}/v1`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

const toolCall = (id: string, name: string, args: unknown) => ({
  json: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] } }] },
});

async function run(conv: AssistantConversation, text: string, extra: Partial<{ apiKey: string }> = {}): Promise<AssistantEvent[]> {
  const events: AssistantEvent[] = [];
  await conv.send(text, { baseUrl, apiKey: extra.apiKey ?? 'sk-test', model: 'm-small' }, 'SYSTEM', (e) => events.push(e));
  return events;
}

describe('built-in assistant (OpenAI-compatible)', () => {
  it('runs tools until the model answers, and can undo what it did', async () => {
    replies.push(() => toolCall('c1', 'ir_add_primitive', { primitiveType: 'cube', assetId: 'Box' }));
    replies.push((body) => {
      // ツールの結果が会話に入って返っている
      const toolMsg = body.messages.find((m: any) => m.role === 'tool');
      expect(toolMsg.tool_call_id).toBe('c1');
      expect(JSON.parse(toolMsg.content).object.assetId).toBe('Box');
      return { json: { choices: [{ message: { role: 'assistant', content: '箱を置きました' } }] } };
    });
    const session = new ToolSession({ projectPath: dir });
    const conv = new AssistantConversation(session);
    const events = await run(conv, '箱を置いて');

    expect(events.map((e) => e.type)).toEqual(['thinking', 'tool-call', 'snapshot', 'tool-result', 'thinking', 'message', 'done']);
    expect(events.at(-1)).toMatchObject({ type: 'done', changed: true, steps: 2 });
    expect(requests[0].auth).toBe('Bearer sk-test');
    expect(requests[0].body.tools.length).toBeGreaterThan(30);
    expect(requests[0].body.messages[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    const objects = () => JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')).scenes[0].objects;
    expect(objects()).toHaveLength(1);

    const snapshot = events.find((e) => e.type === 'snapshot') as Extract<AssistantEvent, { type: 'snapshot' }>;
    await restoreSnapshot(dir, snapshot.snapshotId);
    expect(objects()).toHaveLength(0);
  });

  it('keeps the conversation across requests and does not snapshot for read-only tools', async () => {
    replies.push(() => toolCall('r1', 'ir_get_project', {}));
    replies.push(() => ({ json: { choices: [{ message: { role: 'assistant', content: 'A という名前です' } }] } }));
    replies.push((body) => {
      expect(body.messages.filter((m: any) => m.role === 'user').map((m: any) => m.content)).toEqual(['名前は？', 'ありがとう']);
      return { json: { choices: [{ message: { role: 'assistant', content: 'どういたしまして' } }] } };
    });
    const conv = new AssistantConversation(new ToolSession({ projectPath: dir }));
    const first = await run(conv, '名前は？');
    expect(first.some((e) => e.type === 'snapshot')).toBe(false);
    expect(first.at(-1)).toMatchObject({ changed: false });
    await run(conv, 'ありがとう');
  });

  it('reports API errors and broken tool arguments instead of crashing', async () => {
    replies.push(() => ({ status: 401, text: '{"error":"bad key"}' }));
    const conv = new AssistantConversation(new ToolSession({ projectPath: dir }));
    const failed = await run(conv, 'x');
    expect(failed.find((e) => e.type === 'error')).toMatchObject({ message: expect.stringMatching(/HTTP 401.*bad key/) });

    replies.push(() => toolCall('b1', 'ir_add_primitive', '{not json'));
    replies.push((body) => {
      expect(JSON.parse(body.messages.at(-1).content).error).toMatch(/not valid JSON/);
      return { json: { choices: [{ message: { role: 'assistant', content: 'すみません' } }] } };
    });
    const conv2 = new AssistantConversation(new ToolSession({ projectPath: dir }));
    const events = await run(conv2, 'y');
    expect(events.find((e) => e.type === 'tool-result')).toMatchObject({ ok: false });
  });

  it('can be stopped while waiting, and the conversation stays valid for the next request', async () => {
    replies.push(() => toolCall('s1', 'ir_get_project', {}));
    replies.push(() => ({ json: { choices: [{ message: { role: 'assistant', content: 'late' } }] }, delayMs: 2000 }));
    const conv = new AssistantConversation(new ToolSession({ projectPath: dir }));
    const pending = run(conv, 'slow');
    await new Promise((r) => setTimeout(r, 300));
    expect(conv.running).toBe(true);
    conv.abort();
    const events = await pending;
    expect(events.find((e) => e.type === 'error')).toMatchObject({ message: 'stopped' });
    expect(conv.running).toBe(false);
    // すべての tool_call に返事が付いている (次の依頼を API が受け付ける形)
    const callIds = conv.messages.flatMap((m: any) => (m.tool_calls ?? []).map((c: any) => c.id));
    const answered = conv.messages.filter((m: any) => m.role === 'tool').map((m: any) => m.tool_call_id);
    expect(callIds.every((id) => answered.includes(id))).toBe(true);
  });

  it('lists models for the settings screen', async () => {
    expect(await listModels({ baseUrl, apiKey: '', model: '' })).toEqual({ ok: true, models: ['m-small', 'm-large'] });
    expect((await listModels({ baseUrl: 'http://127.0.0.1:1/v1', apiKey: '', model: '' })).ok).toBe(false);
  });
});
