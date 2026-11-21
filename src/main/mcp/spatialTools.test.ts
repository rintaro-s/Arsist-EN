import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ARSIST_TOOLS, callArsistTool, ToolSession } from './tools';
import { SPATIAL_TOOLS } from './spatialTools';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'layster-tools-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

async function ok(session: ToolSession, name: string, args: Record<string, unknown> = {}) {
  const r = await callArsistTool(session, name, args);
  expect(r.error, name).toBeUndefined();
  return r.result as any;
}

describe('spatial tools', () => {
  it('are part of the Arsist tools (MCP and the built-in assistant)', () => {
    const names = ARSIST_TOOLS.map((t) => t.name);
    for (const t of SPATIAL_TOOLS) expect(names).toContain(t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('create → set → solve → validate, all through the tools', async () => {
    const session = new ToolSession();
    const created = await ok(session, 'spatial_create_project', { parentDir: root, name: 'Desk Buddy' });
    expect(created.format).toBe('Layster.Spatial β 1.0.0');
    expect(session.projectPath).toBe(path.join(root, 'Desk Buddy'));

    const quiz = {
      id: 'quiz',
      visual: { kind: 'panel', size: [0.4, 0.25], items: [{ type: 'text', id: 'q', text: 'x + 3 = 5' }, { type: 'button', id: 'ok', text: 'OK' }] },
      place: { on: { is: ['table'] }, distance: [0.3, 1.6], fallback: [{ at: { frame: 'user', at: [0, 1, 0.8] } }] },
    };
    expect((await ok(session, 'spatial_set_thing', { thing: quiz })).action).toBe('added');
    const rule = { id: 'r1', when: { select: 'quiz.ok' }, do: [{ do: 'ask', mind: 'nobody' }] };
    const setRule = await ok(session, 'spatial_set_rule', { rule });
    expect(setRule.problems.join('\n')).toMatch(/No mind "nobody"/);

    const summary = await ok(session, 'spatial_get_project');
    expect(summary.things.map((t: any) => t.id)).toEqual(['hello', 'quiz']);
    expect(summary.problems.errors).toBeGreaterThan(0);

    const solved = await ok(session, 'spatial_solve', { things: ['quiz'] });
    expect(solved.spaces).toEqual(['studio', 'desk-front', 'living', 'tiny', 'no-scan']);
    const deskFront = solved.results.find((r: any) => r.space === 'desk-front');
    expect(deskFront).toMatchObject({ thing: 'quiz', rule: 0, host: 'desk' });
    expect(solved.results.find((r: any) => r.space === 'no-scan').rule).toBe(1);
    expect(solved.summary.quiz.own + solved.summary.quiz.fallback + solved.summary.quiz.default).toBe(5);

    await ok(session, 'spatial_remove', { kind: 'rule', id: 'r1' });
    const v = await ok(session, 'spatial_validate');
    expect(v.ok).toBe(true);

    expect((await ok(session, 'spatial_get', { kind: 'thing', id: 'quiz' })).place.on).toEqual({ is: ['table'] });
    const settings = await ok(session, 'spatial_set_settings', { app: { edge: '192.168.0.23:8000' }, spaces: { use: ['living'] } });
    expect(settings.changed).toEqual(['app', 'spaces']);
    const got = await ok(session, 'spatial_get', { kind: 'settings' });
    expect(got.app).toMatchObject({ edge: '192.168.0.23:8000', packageName: 'com.layster.deskbuddy' });
    expect(got.spaces.use).toEqual(['living']);
  });

  it('refuses malformed items without writing', async () => {
    const session = new ToolSession();
    await ok(session, 'spatial_create_project', { parentDir: root, name: 'P' });
    const before = fs.readFileSync(path.join(root, 'P', 'project.spatial.json'), 'utf8');
    for (const [name, args] of [
      ['spatial_set_thing', { thing: { id: 'x' } }],
      ['spatial_set_thing', { thing: { id: 'bad id', visual: {}, place: {} } }],
      ['spatial_set_mind', { mind: { id: 'm' } }],
      ['spatial_remove', { kind: 'thing', id: 'missing' }],
    ] as const) {
      const r = await callArsistTool(session, name, args as any);
      expect(r.ok, name).toBe(false);
    }
    expect(fs.readFileSync(path.join(root, 'P', 'project.spatial.json'), 'utf8')).toBe(before);
  });

  it('arsist_open_project recognises a Spatial folder and points at the spatial tools', async () => {
    const session = new ToolSession();
    await ok(session, 'spatial_create_project', { parentDir: root, name: 'S' });
    const other = new ToolSession();
    const opened = await ok(other, 'arsist_open_project', { projectPath: path.join(root, 'S') });
    expect(opened.format).toBe('Layster.Spatial β 1.0.0');
    expect(opened.tools).toMatch(/spatial_\*/);
    const wrong = await callArsistTool(other, 'ir_get_project', {});
    expect(wrong.ok).toBe(false);
  });

  it('spatial tools on a Virtual project say which tools to use', async () => {
    fs.writeFileSync(path.join(root, 'project.json'), JSON.stringify({ name: 'V', irVersion: 5 }));
    const r = await callArsistTool(new ToolSession({ projectPath: root }), 'spatial_get_project', {});
    expect(r.error).toMatch(/ir_\* tools/);
  });

  it('has a reference that covers every part of the format', async () => {
    const text = await ok(new ToolSession(), 'spatial_reference');
    for (const word of ['COORDINATES', 'ENTITIES', 'THINGS', 'ACTIONS', 'RULES', 'MINDS', 'BODIES', 'SAFETY GATE', 'RECORDING', 'world.find', 'layster.mind/1']) {
      expect(text).toContain(word);
    }
  });

  it('lists built-in and project spaces', async () => {
    const session = new ToolSession();
    await ok(session, 'spatial_create_project', { parentDir: root, name: 'L' });
    fs.writeFileSync(path.join(root, 'L', 'spaces', 'mine.json'), JSON.stringify({ id: 'mine', name: 'Mine', entities: [] }));
    const spaces = await ok(session, 'spatial_list_spaces');
    expect(spaces.find((s: any) => s.id === 'studio')).toMatchObject({ origin: 'builtin', used: true });
    expect(spaces.find((s: any) => s.id === 'mine')).toMatchObject({ origin: 'project', used: false, name: 'Mine' });
  });
});
