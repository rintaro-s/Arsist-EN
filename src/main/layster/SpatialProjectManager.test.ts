import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createSpatialProjectOnDisk, importSpatialAsset, listProjectSpaces, loadSpatialProject, readSecrets, readSpatialProject,
  saveProjectSpace, saveSpatialProject, setSecret, validateSpatialProjectAt, withSpatialWrite,
} from './SpatialProjectManager';
import { detectProjectKind } from './projectKind';
import { callMind } from './mindClient';
import { newMind } from '../../shared/layster/spatial/defaults';
import type { MindRequest } from '../../shared/layster/spatial/types';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'layster-spatial-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('SpatialProjectManager', () => {
  it('creates the folder layout and a loadable project', async () => {
    const { project, path: dir } = await createSpatialProjectOnDisk({ parentDir: root, name: 'Desk Buddy', targetDevice: 'Meta_Quest' }, 'id-1');
    expect(dir).toBe(path.join(root, 'Desk Buddy'));
    for (const sub of ['Assets/Models', 'Assets/Characters', 'Assets/Images', 'Assets/Audio', 'Assets/Animations', 'spaces', 'Scripts']) {
      expect(fs.existsSync(path.join(dir, sub)), sub).toBe(true);
    }
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toContain('.layster/');
    expect(project.layster).toEqual({ profile: 'spatial', stage: 'beta', version: '1.0.0' });
    const loaded = await loadSpatialProject(dir);
    expect(loaded.success).toBe(true);
    expect(loaded.project?.id).toBe('id-1');
    await expect(createSpatialProjectOnDisk({ parentDir: root, name: 'Desk Buddy', targetDevice: 'Meta_Quest' }, 'x')).rejects.toThrow(/already exists/);
  });

  it('refuses to open a project whose extensions / device are missing (like Virtual)', async () => {
    const { project, path: dir } = await createSpatialProjectOnDisk({ parentDir: root, name: 'Req', targetDevice: 'Meta_Quest' }, 'id-r');
    project.extensions = { 'no-such-extension': { enabled: true, dataVersion: 1, settings: {} } };
    await saveSpatialProject(dir, project);
    const loaded = await loadSpatialProject(dir);
    expect(loaded.success).toBe(false);
    expect(loaded.error).toBe('requirementsMissing');
    expect(loaded.missing?.map((m) => [m.kind, m.id])).toEqual([['extension', 'no-such-extension']]);
  });

  it('checks animation names against Assets/Animations when the folder is known', async () => {
    const { project, path: dir } = await createSpatialProjectOnDisk({ parentDir: root, name: 'Anim', targetDevice: 'Meta_Quest' }, 'id-a');
    project.rules.push({ id: 'r', when: { start: true }, do: [{ do: 'animate', thing: 'hello', clip: 'Wave' }] });
    expect((await validateSpatialProjectAt(dir, project)).some((p) => p.path === 'rules[r].do[0].clip')).toBe(true);
    fs.writeFileSync(path.join(dir, 'Assets', 'Animations', 'Wave.fbx'), 'x');
    expect((await validateSpatialProjectAt(dir, project)).some((p) => p.path === 'rules[r].do[0].clip')).toBe(false);
  });

  it('detects Spatial and Virtual folders with their labels', async () => {
    const { path: dir } = await createSpatialProjectOnDisk({ parentDir: root, name: 'S', targetDevice: 'Meta_Quest' }, 'id');
    expect(await detectProjectKind(dir)).toMatchObject({ kind: 'spatial', label: 'Layster.Spatial β 1.0.0', name: 'S' });
    const v = path.join(root, 'V');
    fs.mkdirSync(v);
    fs.writeFileSync(path.join(v, 'project.json'), JSON.stringify({ name: 'Old', irVersion: 5 }));
    expect(await detectProjectKind(v)).toMatchObject({ kind: 'virtual', label: 'Layster.Virtual α5', name: 'Old' });
    fs.writeFileSync(path.join(v, 'project.json'), JSON.stringify({ name: 'New', irVersion: 6, layster: { profile: 'virtual', stage: 'beta', version: '1.0.0' } }));
    expect((await detectProjectKind(v)).label).toBe('Layster.Virtual β 1.0.0');
    expect(await detectProjectKind(path.join(root, 'nothing'))).toEqual({ kind: 'none' });
  });

  it('fills missing fields in memory without rewriting the file, and reports JSON errors with a position', async () => {
    const dir = path.join(root, 'p');
    fs.mkdirSync(dir);
    const file = path.join(dir, 'project.spatial.json');
    const text = JSON.stringify({ layster: { profile: 'spatial', stage: 'beta', version: '1.0.0' }, id: 'a', name: 'A', things: [] });
    fs.writeFileSync(file, text);
    const { project, notices } = await readSpatialProject(dir);
    expect(project.minds).toEqual([]);
    expect(notices.some((n) => n.includes('minds'))).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe(text);

    fs.writeFileSync(file, '{ "layster": { "profile": "spatial" ,, }');
    const bad = await loadSpatialProject(dir);
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/line \d+/);
  });

  it('refuses projects made by a newer Arsist, and files without the Spatial header', async () => {
    const dir = path.join(root, 'n');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'project.spatial.json'), JSON.stringify({ layster: { profile: 'spatial', stage: 'beta', version: '2.0.0' }, id: 'x', name: 'X' }));
    const res = await loadSpatialProject(dir);
    expect(res).toMatchObject({ success: false, tooNew: true });
    await expect(withSpatialWrite(dir, () => {})).rejects.toThrow(/newer/);

    fs.writeFileSync(path.join(dir, 'project.spatial.json'), JSON.stringify({ id: 'x', name: 'X' }));
    expect((await loadSpatialProject(dir)).error).toMatch(/header/);
  });

  it('saves atomically, one write at a time', async () => {
    const { project, path: dir } = await createSpatialProjectOnDisk({ parentDir: root, name: 'W', targetDevice: 'Meta_Quest' }, 'id');
    project.name = 'Renamed';
    await saveSpatialProject(dir, project);
    expect((await readSpatialProject(dir)).project.name).toBe('Renamed');
    await Promise.all([1, 2, 3, 4].map((n) => withSpatialWrite(dir, (p) => { p.memory.persist.push(`k${n}`); })));
    expect((await readSpatialProject(dir)).project.memory.persist.sort()).toEqual(['k1', 'k2', 'k3', 'k4']);
    expect(fs.readdirSync(dir).some((f) => f.includes('.tmp-'))).toBe(false);
    await expect(saveSpatialProject(dir, { ...project, layster: { profile: 'virtual', stage: 'beta', version: '1.0.0' } } as any)).rejects.toThrow(/header/);
  });

  it('keeps project spaces and secrets', async () => {
    const { path: dir } = await createSpatialProjectOnDisk({ parentDir: root, name: 'K', targetDevice: 'Meta_Quest' }, 'id');
    await saveProjectSpace(dir, { id: 'my-room', name: { en: 'My room', ja: '自分の部屋' }, user: { eyeHeight: 1.5 }, knows: ['scan'], entities: [] });
    expect((await listProjectSpaces(dir)).map((s) => s.id)).toEqual(['my-room']);
    await expect(saveProjectSpace(dir, { id: '../x' } as any)).rejects.toThrow();

    expect(await setSecret(dir, 'GROQ_KEY', 'sk-1')).toEqual(['GROQ_KEY']);
    expect(await readSecrets(dir)).toEqual({ GROQ_KEY: 'sk-1' });
    expect(await setSecret(dir, 'GROQ_KEY', null)).toEqual([]);
    await expect(setSecret(dir, 'bad name', 'v')).rejects.toThrow();
  });

  it('imports assets into the right folder without duplicating identical files', async () => {
    const { path: dir } = await createSpatialProjectOnDisk({ parentDir: root, name: 'A', targetDevice: 'Meta_Quest' }, 'id');
    const src = path.join(root, 'buddy.vrm');
    fs.writeFileSync(src, 'vrm-1');
    expect(await importSpatialAsset(dir, 'character', src)).toEqual({ success: true, file: 'Assets/Characters/buddy.vrm' });
    expect(await importSpatialAsset(dir, 'character', src)).toEqual({ success: true, file: 'Assets/Characters/buddy.vrm' });
    fs.writeFileSync(src, 'vrm-2');
    expect((await importSpatialAsset(dir, 'character', src)).file).toBe('Assets/Characters/buddy_2.vrm');
    expect((await importSpatialAsset(dir, 'model', src)).success).toBe(false);
  });
});

describe('callMind', () => {
  const request: MindRequest = { protocol: 'layster.mind/1', mind: 'm', tick: 1, time: 2, frame: 'user', actions: ['say'] };

  it('speaks openai-chat with the key in the header only, and reads the JSON in the reply', async () => {
    const mind = { ...newMind('helper'), auth: { secret: 'K' } };
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ choices: [{ message: { content: '<think>hmm</think>```json\n{"actions":[{"do":"say","text":"hi"}]}\n```' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await callMind(mind, request, { edge: '192.168.0.9:11434', secrets: { K: 'sk-9' }, fetchImpl });
    expect(r.ok).toBe(true);
    expect(seen!.url).toBe('http://192.168.0.9:11434/v1/chat/completions');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-9');
    expect(JSON.stringify(r.sent)).not.toContain('sk-9');
    expect((r.sent as any).reasoning_effort).toBe('none');
    expect(r.reply).toEqual({ actions: [{ do: 'say', text: 'hi' }] });
  });

  it('reports a missing edge address, a missing key, HTTP errors and timeouts', async () => {
    expect((await callMind(newMind('m'), request)).error).toMatch(/PC address/);
    expect((await callMind({ ...newMind('m'), auth: { secret: 'K' } }, request, { edge: 'h:1' })).error).toMatch(/key "K"/);
    const http500 = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    expect(await callMind(newMind('m', 'layster'), request, { edge: 'h:1', fetchImpl: http500 })).toMatchObject({ ok: false, status: 500, raw: 'boom' });
    const never = ((_u: string, init: RequestInit) => new Promise((_r, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as unknown as typeof fetch;
    expect((await callMind(newMind('m', 'layster'), request, { edge: 'h:1', fetchImpl: never, timeoutMs: 20 })).error).toMatch(/no reply within 20/);
  });

  it('posts the Layster request as is', async () => {
    let body: any;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ beliefs: [{ id: 'cup', is: ['cup'] }], text: 'ok', junk: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await callMind(newMind('wm', 'layster'), request, { edge: 'pc:8000', fetchImpl });
    expect(body).toMatchObject({ protocol: 'layster.mind/1', mind: 'wm', frame: 'user' });
    expect(r.reply).toEqual({ beliefs: [{ id: 'cup', is: ['cup'] }], text: 'ok' });
  });
});
