import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ARSIST_TOOLS, callArsistTool, checkScriptSyntax, ToolSession } from './tools';
import { CURRENT_IR_VERSION } from '../../shared/irVersion';
import { setLinkedFoldersSource } from '../extensions/catalogService';

// サンプルの拡張機能 (quest-room / quest-input) を、この環境と同じく登録したフォルダとして見せる
setLinkedFoldersSource(() => [path.resolve(__dirname, '../../../samples/extensions')]);

let dir: string;

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p', name: 'Test', version: '1.0.0', irVersion: CURRENT_IR_VERSION, appType: '3d_ar_scene', targetDevice: 'Meta_Quest',
    arSettings: { trackingMode: '6dof', presentationMode: 'world_anchored', worldScale: 1, defaultDepth: 2, interaction: { controllerRay: true, handTracking: false } },
    designSystem: {}, dataFlow: { dataSources: [], transforms: [] },
    scenes: [{ id: 's1', name: 'Main', objects: [] }],
    uiLayouts: [{ id: 'l1', name: 'Panel', scope: 'canvas', resolution: { width: 1024, height: 1024 }, root: { id: 'r', type: 'Panel', style: {}, children: [] } }],
    buildSettings: {}, scripts: [], extensions: {},
    ...overrides,
  };
}

function write(p: unknown) {
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(p));
}

async function call(session: ToolSession, name: string, args: Record<string, unknown> = {}) {
  const r = await callArsistTool(session, name, args);
  return r;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arsist-tools-'));
  write(project());
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('Arsist tools', () => {
  it('every tool has a unique name, a description and an object schema', () => {
    const names = ARSIST_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of ARSIST_TOOLS) {
      expect(t.description.length, t.name).toBeGreaterThan(10);
      expect(t.inputSchema.type, t.name).toBe('object');
    }
    // 旧サーバーのツールは名前を変えずに残っている
    for (const old of ['ir_get_project', 'ir_import_model_asset', 'ir_place_model', 'ir_list_scene_objects', 'ir_update_object_transform',
      'ir_remove_scene_object', 'ir_add_canvas_object', 'ir_add_ui_element', 'ir_list_ui_layouts', 'ir_update_ui_element', 'ir_remove_ui_element',
      'ir_add_datasource', 'ir_update_datasource', 'ir_remove_datasource', 'ir_add_transform', 'ir_update_transform', 'ir_remove_transform']) {
      expect(names).toContain(old);
    }
  });

  it('asks for a project, then remembers the opened one', async () => {
    const session = new ToolSession({ recentProjects: () => ['/somewhere/A'] });
    const none = await call(session, 'ir_get_project');
    expect(none.ok).toBe(false);
    expect(none.error).toMatch(/arsist_open_project.*\/somewhere\/A/);
    expect((await call(session, 'arsist_open_project', { projectPath: dir })).ok).toBe(true);
    const summary = await call(session, 'ir_get_project');
    expect(summary).toMatchObject({ ok: true, result: { name: 'Test', irVersion: CURRENT_IR_VERSION, readOnly: false } });
  });

  it('builds a scene, a panel and a script, and the editor layout on disk follows', async () => {
    const s = new ToolSession({ projectPath: dir });
    const cube = await call(s, 'ir_add_primitive', { primitiveType: 'cube', assetId: 'Box', color: '#ff0000', position: { z: 1 } });
    expect(cube.ok).toBe(true);
    const id = (cube.result as any).object.id;
    expect((await call(s, 'ir_update_object_transform', { objectId: 'Box', position: { x: 0.5 } })).ok).toBe(true);
    expect((await call(s, 'ir_add_canvas_object', {})).ok).toBe(true);
    expect((await call(s, 'ir_add_ui_element', { type: 'Button', bindingId: 'go', content: 'Go' })).ok).toBe(true);
    expect((await call(s, 'ir_update_ui_element', { elementId: 'go', content: 'Start' })).ok).toBe(true);
    expect((await call(s, 'ir_add_script', { name: 'onGo', trigger: { type: 'event', value: 'go' }, code: "scene.setVisible('Box', false);" })).ok).toBe(true);
    expect(s.changed).toBe(true);

    // エディタが読む形 (Scenes/ と UI/ にも) で書かれている
    const sceneFile = JSON.parse(fs.readFileSync(path.join(dir, 'Scenes', 's1.json'), 'utf8'));
    expect(sceneFile.objects.find((o: any) => o.id === id).transform.position).toEqual({ x: 0.5, y: 0, z: 1 });
    const ui = JSON.parse(fs.readFileSync(path.join(dir, 'UI', 'l1.json'), 'utf8'));
    expect(ui.root.children[0]).toMatchObject({ type: 'Button', bindingId: 'go', content: 'Start' });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')).scripts[0].trigger).toEqual({ type: 'event', value: 'go' });
    // 一時ファイルが残っていない
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('resizes a canvas panel, changes a layout and removes a layout nobody shows', async () => {
    const s = new ToolSession({ projectPath: dir });
    const panel = await call(s, 'ir_add_canvas_object', { name: 'Card' });
    const objectId = (panel.result as any).object.id;
    const resized = await call(s, 'ir_update_object', { objectId, canvas: { widthMeters: 0.32, heightMeters: 0.18, pixelsPerUnit: 3200 } });
    expect((resized.result as any).object.canvasSettings).toEqual({ layoutId: 'l1', widthMeters: 0.32, heightMeters: 0.18, pixelsPerUnit: 3200 });
    expect((await call(s, 'ir_update_object', { objectId, canvas: { pixelsPerUnit: 0 } })).error).toMatch(/positive/);
    expect((await call(s, 'ir_update_ui_layout', { layoutId: 'Panel', name: 'Card', resolution: { width: 1024, height: 576 } })).ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'UI', 'l1.json'), 'utf8'))).toMatchObject({ name: 'Card', resolution: { width: 1024, height: 576 } });
    // 見せている物があるうちは消さない
    expect((await call(s, 'ir_remove_ui_layout', { layoutId: 'l1' })).error).toMatch(/shown by Card/);
    expect((await call(s, 'ir_remove_scene_object', { objectId })).ok).toBe(true);
    expect((await call(s, 'ir_remove_ui_layout', { layoutId: 'l1' })).ok).toBe(true);
    expect(fs.existsSync(path.join(dir, 'UI', 'l1.json'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')).uiLayouts).toEqual([]);
  });

  it('refuses scripts that would not run', async () => {
    const s = new ToolSession({ projectPath: dir });
    const broken = await call(s, 'ir_add_script', { name: 'x', trigger: { type: 'onStart' }, code: 'log("a"' });
    expect(broken.ok).toBe(false);
    expect(broken.error).toMatch(/syntax error/);
    expect((await call(s, 'ir_add_script', { name: 'x', trigger: { type: 'interval' }, code: 'log(1)' })).error).toMatch(/milliseconds/);
    expect((await call(s, 'ir_add_script', { name: 'x', trigger: { type: 'whenever' }, code: 'log(1)' })).error).toMatch(/trigger.type/);
    expect(checkScriptSyntax('const a = 1;\nlet b = a +;').line).toBe(2);
  });

  it('never rewrites a project in an old format, and refuses one from a newer Arsist', async () => {
    write(project({ irVersion: CURRENT_IR_VERSION - 1 }));
    const s = new ToolSession({ projectPath: dir });
    expect((await call(s, 'ir_get_project')).result).toMatchObject({ readOnly: expect.stringMatching(/old format/) });
    const edit = await call(s, 'ir_add_primitive', { primitiveType: 'cube' });
    expect(edit.ok).toBe(false);
    expect(edit.error).toMatch(/accept the upgrade/);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')).scenes[0].objects).toEqual([]);

    write(project({ irVersion: CURRENT_IR_VERSION + 1 }));
    expect((await call(s, 'ir_get_project')).error).toMatch(/newer than this Arsist/);
  });

  it('does not lose writes that arrive at the same time', async () => {
    const s = new ToolSession({ projectPath: dir });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => call(s, 'ir_add_primitive', { primitiveType: 'sphere', name: `S${i}` })));
    expect(results.every((r) => r.ok)).toBe(true);
    const list = await call(s, 'ir_list_scene_objects');
    expect((list.result as any).objects.map((o: any) => o.name).sort()).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
  });

  it('checks extension settings and object options against extension.json', async () => {
    const s = new ToolSession({ projectPath: dir });
    expect((await call(s, 'ir_set_extension', { id: 'not-there' })).error).toMatch(/not installed/);
    expect((await call(s, 'ir_set_extension', { id: 'quest-room', settings: { showSurfaces: 'yes' } })).error).toMatch(/true\/false/);
    expect((await call(s, 'ir_set_extension', { id: 'quest-room', settings: { nope: 1 } })).error).toMatch(/unknown key "nope"/);
    const on = await call(s, 'ir_set_extension', { id: 'quest-room', settings: { showSurfaces: true } });
    expect(on).toMatchObject({ ok: true, result: { state: { enabled: true, dataVersion: 1 } } });

    await call(s, 'ir_add_primitive', { primitiveType: 'cube', assetId: 'Box' });
    expect((await call(s, 'ir_set_object_extension', { objectId: 'Box', extensionId: 'quest-room', values: { snapTo: 'shelf' } })).error).toMatch(/must be one of/);
    const snap = await call(s, 'ir_set_object_extension', { objectId: 'Box', extensionId: 'quest-room', values: { snapTo: 'table' } });
    expect((snap.result as any).ext['quest-room']).toEqual({ snapTo: 'table', pick: 'ahead', lie: 'upright', offset: 0.02 });

    const list = await call(s, 'ir_list_extensions');
    const room = (list.result as any).extensions.find((e: any) => e.id === 'quest-room');
    expect(room).toMatchObject({ enabled: true, fitsTargetDevice: true, scriptGlobals: ['room'] });
  });

  it('validation finds what would break the build', async () => {
    const s = new ToolSession({ projectPath: dir });
    write(project({
      scenes: [{ id: 's1', name: 'Main', objects: [{ id: 'c', name: 'Lost', type: 'canvas', canvasSettings: { layoutId: 'gone' } }] }],
      scripts: [{ id: 'x', name: 'Broken', trigger: { type: 'onStart' }, code: 'if (', enabled: true }],
      extensions: { 'not-installed': { enabled: true, dataVersion: 1, settings: {} } },
      arSettings: { interaction: { controllerRay: true, handTracking: true } },
      targetDevice: 'XREAL_One',
    }));
    const v = (await call(s, 'ir_validate_project')).result as any;
    expect(v.ok).toBe(false);
    expect(v.problems.join('\n')).toMatch(/not-installed/);
    expect(v.problems.join('\n')).toMatch(/canvas "Lost"/);
    expect(v.problems.join('\n')).toMatch(/script "Broken"/);
    expect(v.warnings.join('\n')).toMatch(/feature:hand-tracking/);
  });

  it('knows the devices, including the target-device check', async () => {
    const s = new ToolSession({ projectPath: dir });
    const devices = (await call(s, 'ir_list_devices')).result as any;
    expect(devices.devices.map((d: any) => d.device)).toEqual(expect.arrayContaining(['Meta_Quest', 'XREAL_One', 'Android_Phone']));
    expect((await call(s, 'ir_set_target_device', { device: 'meta-quest3' })).result).toEqual({ targetDevice: 'Meta_Quest' });
    expect((await call(s, 'ir_set_target_device', { device: 'Pico_9' })).error).toMatch(/unknown device/);
  });

  it('gives a script reference that names every engine global and installed extension globals', async () => {
    const ref = (await call(new ToolSession(), 'arsist_script_reference')).result as string;
    for (const g of ['store.set', 'ui.setText', 'scene.setPosition', 'api.post', 'model.generate', 'viewer.placeInFront', 'perception.run']) expect(ref).toContain(g);
    expect(ref).toMatch(/Extension quest-input .* controller, hands, mic, keyboard, headset/);
    expect(ref).toContain('room.onReady');
    // v5 で足した名前もエージェントに見えている (エディタの早見表と同じ元 src/shared/scriptApi.ts)
    for (const g of ['setTimeout', 'api.request', 'audio.play', 'camera.capture', 'storage.forget', 'vrm.walkTo', 'viewer.isLookingAt', 'scene.moveTo']) expect(ref).toContain(g);
    expect(ref).toContain('project.storage.persist');
  });

  it('makes a VRM a character with imported animations, writes text reveal and the saved keys', async () => {
    const s = new ToolSession({ projectPath: dir });
    const src = path.join(dir, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'Sitting Idle.fbx'), 'fbx-1');
    fs.writeFileSync(path.join(src, 'other.fbx'), 'fbx-2');
    fs.writeFileSync(path.join(src, 'sis.vrm'), 'vrm');

    const first = await call(s, 'ir_import_animation', { sourcePath: path.join(src, 'Sitting Idle.fbx') });
    expect(first.result).toMatchObject({ name: 'Sitting_Idle', assetPath: 'Assets/Animations/Sitting_Idle.fbx', existed: false });
    // 同じ中身はそのまま、同じ名前で別の中身は _2
    expect((await call(s, 'ir_import_animation', { sourcePath: path.join(src, 'Sitting Idle.fbx') })).result).toMatchObject({ existed: true });
    expect((await call(s, 'ir_import_animation', { sourcePath: path.join(src, 'other.fbx'), name: 'Sitting Idle' })).result).toMatchObject({ name: 'Sitting_Idle_2' });
    expect((await call(s, 'ir_import_animation', { sourcePath: path.join(src, 'sis.vrm') })).error).toMatch(/fbx/);
    expect(((await call(s, 'ir_list_animations')).result as any).animations.map((a: any) => a.name)).toEqual(['Sitting_Idle', 'Sitting_Idle_2']);

    const model = await call(s, 'ir_import_model_asset', { sourcePath: path.join(src, 'sis.vrm') });
    const placed = await call(s, 'ir_place_model', { modelAssetPath: (model.result as any).assetPath, assetId: 'Sister' });
    expect((placed.result as any).object.character).toEqual({ blink: true, breathe: true, lookAtUser: 'nearby' });
    const updated = await call(s, 'ir_update_object', { objectId: 'Sister', character: { animation: 'Sitting_Idle', lookAtUser: 'always' } });
    expect((updated.result as any).object.character).toEqual({ blink: true, breathe: true, lookAtUser: 'always', animation: 'Sitting_Idle' });
    expect((await call(s, 'ir_update_object', { objectId: 'Sister', character: null })).ok).toBe(true);
    expect((await call(s, 'ir_add_primitive', { primitiveType: 'cube', assetId: 'Box' })).ok).toBe(true);
    expect((await call(s, 'ir_update_object', { objectId: 'Box', character: { blink: true } })).error).toMatch(/VRM/);

    expect((await call(s, 'ir_add_ui_element', { type: 'Text', bindingId: 'quiz', content: '2x + 3 = 7', reveal: { speed: 8 } })).ok).toBe(true);
    expect((await call(s, 'ir_update_ui_element', { elementId: 'quiz', reveal: null })).ok).toBe(true);
    expect((await call(s, 'ir_set_storage', { persist: ['memory.', 'user.name', 'memory.'] })).ok).toBe(true);
    expect((await call(s, 'ir_set_storage', { persist: [''] })).ok).toBe(false);

    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
    expect(saved.storage).toEqual({ persist: ['memory.', 'user.name'] });
    expect('character' in saved.scenes[0].objects.find((o: any) => o.assetId === 'Sister')).toBe(false);
    expect('reveal' in saved.uiLayouts[0].root.children[0]).toBe(false);
  });
});
