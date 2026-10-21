import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chooseCopy, describeJsonError, resolveSceneAndUiCopies, seenAfterSave, stableStringify, syncStaleCopies } from './sceneCopies';
import { repairScene, repairUILayout } from '../../shared/irRepair';

const obj = (name: string, x = 0) => ({ id: name, name, type: 'primitive', primitiveType: 'cube', transform: { position: { x, y: 0, z: 1 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });

describe('which copy of a scene is used', () => {
  it('uses the copy that changed since it was last seen, and keeps using it while nothing else changes', () => {
    const before = { id: 's', objects: [obj('a')] };
    const seen = seenAfterSave([before], []).get('scene:s');
    const editedInProject = { id: 's', objects: [obj('a'), obj('b')] };
    const first = chooseCopy({ file: before, embedded: editedInProject, seen })!;
    expect(first.source).toBe('embedded');
    // 次に読んだとき (個別ファイルはまだ古いまま): 戻らない
    const again = chooseCopy({ file: before, embedded: editedInProject, seen: first.seen })!;
    expect(again.source).toBe('embedded');
    // 今度は個別ファイルが変わった
    const editedFile = { id: 's', objects: [obj('c')] };
    expect(chooseCopy({ file: editedFile, embedded: editedInProject, seen: again.seen })!.source).toBe('file');
  });

  it('prefers the per-file copy when both changed, and says so', () => {
    const seen = seenAfterSave([{ id: 's', objects: [] }], []).get('scene:s');
    const r = chooseCopy({ file: { id: 's', objects: [obj('f')] }, embedded: { id: 's', objects: [obj('e')] }, seen })!;
    expect(r.source).toBe('file');
    expect(r.conflict).toBe(true);
  });

  it('without history, uses the newer file; same time → the per-file copy', () => {
    const file = { id: 's', objects: [obj('f')] };
    const embedded = { id: 's', objects: [obj('e')] };
    expect(chooseCopy({ file, embedded, fileMtimeMs: 1000, projectMtimeMs: 2000 })!.source).toBe('embedded');
    expect(chooseCopy({ file, embedded, fileMtimeMs: 2000, projectMtimeMs: 2000 })!.source).toBe('file');
  });

  it('keeps what the editor had while the file is half-written', () => {
    const good = { id: 's', objects: [obj('a')] };
    const seen = seenAfterSave([good], []).get('scene:s');
    const r = chooseCopy({ fileError: 'Unexpected end of JSON input', embedded: { id: 's', objects: [] }, seen })!;
    expect(r.source).toBe('previous');
    expect(stableStringify(r.value)).toBe(stableStringify(good));
  });

  it('ignores key order', () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: [1, { e: 1, f: 2 }] } })).toBe(stableStringify({ b: { d: [1, { f: 2, e: 1 }], c: 2 }, a: 1 }));
  });

  it('points at the line and column of a JSON error', () => {
    const text = '{\n  "a": 1,\n  "b": }\n';
    let error: unknown;
    try { JSON.parse(text); } catch (e) { error = e; }
    expect(describeJsonError(text, error)).toMatch(/line 3, column 8/);
    // 途中で切れた書きかけ・末尾のカンマ (エージェントがよくやる)
    expect(describeJsonError('{\n  "a": [1, 2,\n', new Error('Unexpected end of JSON input'))).toMatch(/line 3/);
    expect(describeJsonError('{\n  "a": 1,\n}', new Error('x'))).toMatch(/line 3, column 1/);
  });
});

describe('filling in what a hand-written IR leaves out', () => {
  it('gives objects the fields the editor needs, without touching what is there', () => {
    const notes: string[] = [];
    const scene = repairScene({ id: 's', objects: [
      { name: 'Box', type: 'primitive', primitiveType: 'sphere', transform: { position: [1, 2, 3] } },
      { name: 'Statue', modelPath: 'Assets/Models/x.glb' },
      { id: 'ok', ...obj('ok', 5) },
    ] }, 'Scenes/s.json', notes);
    expect(scene.objects[0]).toMatchObject({ id: 's-obj-0', primitiveType: 'sphere', transform: { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
    expect(scene.objects[1]).toMatchObject({ type: 'model', transform: { scale: { x: 1, y: 1, z: 1 } } });
    expect(scene.objects[2].transform.position.x).toBe(5);
    expect(notes.some((n) => n.includes('objects[1]') && n.includes('type → model'))).toBe(true);
    expect(notes.some((n) => n.includes('objects[2]'))).toBe(false);
  });

  it('makes a UI layout drawable', () => {
    const notes: string[] = [];
    const layout = repairUILayout({ id: 'hud', root: { type: 'Panel', children: [{ type: 'Text', content: 'hi' }, 'junk'] } }, 'UI/hud.json', notes);
    expect(layout.scope).toBe('uhd');
    expect(layout.resolution).toEqual({ width: 1920, height: 1080 });
    expect(layout.root.children).toHaveLength(1);
    expect(layout.root.children[0]).toMatchObject({ id: 'hud-root-0', type: 'Text', style: {}, children: [] });
  });
});

describe('reading a project folder', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arsist-copies-'));
    fs.mkdirSync(path.join(dir, 'Scenes'));
    fs.mkdirSync(path.join(dir, 'UI'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (rel: string, data: unknown, mtime?: number) => {
    const file = path.join(dir, rel);
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    if (mtime) fs.utimesSync(file, mtime, mtime);
  };

  it('picks up an edit made inside project.json, a scene that only exists there, and says which file is unused', async () => {
    const scene = { id: 'main', name: 'Main', objects: [obj('a')] };
    write('Scenes/main.json', scene, 1000);
    write('Scenes/stray.json', { id: 'stray', objects: [] }, 1000);
    const project = {
      scenes: [{ ...scene, objects: [obj('a'), obj('fromAgent')] }, { id: 'second', name: 'Second', objects: [obj('z')] }],
      uiLayouts: [],
    };
    write('project.json', project, 2000);
    const r = await resolveSceneAndUiCopies(dir, project);
    expect(r.scenes.map((s) => s.objects.map((o) => o.name))).toEqual([['a', 'fromAgent'], ['z']]);
    expect(r.notes.join('\n')).toMatch(/Scenes\/main\.json: using the copy in project\.json/);
    expect(r.notes.join('\n')).toMatch(/Scenes\/second\.json does not exist yet/);
    expect(r.notes.join('\n')).toMatch(/Scenes\/stray\.json is not listed/);
  });

  it('keeps the previous content while a scene file is broken, then takes the fixed file', async () => {
    const scene = { id: 'main', name: 'Main', objects: [obj('a')] };
    const project = { scenes: [scene], uiLayouts: [] };
    write('project.json', project);
    write('Scenes/main.json', scene);
    const seen = seenAfterSave([scene], []);

    write('Scenes/main.json', '{ "id": "main", "objects": [ ');
    const broken = await resolveSceneAndUiCopies(dir, project, { seen });
    expect(broken.scenes[0].objects.map((o) => o.name)).toEqual(['a']);
    expect(broken.notes[0]).toMatch(/not valid|Unexpected|Expected/);

    write('Scenes/main.json', { ...scene, objects: [obj('a'), obj('b')] });
    const fixed = await resolveSceneAndUiCopies(dir, project, { seen: broken.seen });
    expect(fixed.scenes[0].objects.map((o) => o.name)).toEqual(['a', 'b']);
  });

  it('mirrors the edited copy into the stale one, touching nothing else in project.json', async () => {
    const scene = { id: 'main', name: 'Main', objects: [obj('a')] };
    const project = { irVersion: 4, name: 'P', arSettings: { defaultDepth: 2 }, scenes: [{ ...scene, objects: [obj('a'), obj('agent')] }], uiLayouts: [] };
    write('Scenes/main.json', scene, 1000);
    write('project.json', project, 2000);
    const first = await resolveSceneAndUiCopies(dir, project);
    expect(first.stale).toEqual([{ kind: 'scene', id: 'main', copy: 'file', value: project.scenes[0] }]);
    await syncStaleCopies(dir, first.stale, async (file, data) => { fs.writeFileSync(file, JSON.stringify(data)); });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'Scenes/main.json'), 'utf8')).objects.map((o: any) => o.name)).toEqual(['a', 'agent']);

    // 今度は個別ファイルが変わった → project.json の写しを差し替える (他の項目はそのまま)
    write('Scenes/main.json', { ...scene, objects: [obj('a'), obj('agent'), obj('more')] }, 3000);
    const second = await resolveSceneAndUiCopies(dir, project, { seen: seenAfterSave([project.scenes[0]], []) });
    await syncStaleCopies(dir, second.stale, async (file, data) => { fs.writeFileSync(file, JSON.stringify(data)); });
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
    expect(pj.scenes[0].objects.map((o: any) => o.name)).toEqual(['a', 'agent', 'more']);
    expect(pj.arSettings).toEqual({ defaultDepth: 2 });
    expect(pj.irVersion).toBe(4);
  });

  it('does not write over a file that is being written', async () => {
    const scene = { id: 'main', name: 'Main', objects: [obj('a')] };
    const project = { scenes: [scene], uiLayouts: [] };
    write('project.json', project);
    write('Scenes/main.json', '{ "id": "main", ');
    const r = await resolveSceneAndUiCopies(dir, project, { seen: seenAfterSave([scene], []) });
    expect(r.stale).toEqual([]);
  });
});

