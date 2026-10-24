import { describe, expect, it } from 'vitest';
import { createSpatialProject, newMind, newThing } from './defaults';
import { estimateLines, LowerError, lowerSpatialProject, panelBindingId, SPATIAL_RUNTIME_FORMAT } from './lower';
import type { SpatialProject, Thing } from './types';

function project(things: Thing[], extra: Partial<SpatialProject> = {}): SpatialProject {
  const p = createSpatialProject({ id: 'p1', name: 'Desk Buddy', targetDevice: 'Meta_Quest', now: '2026-10-21T00:00:00.000Z' });
  return { ...p, things, ...extra };
}

describe('lowerSpatialProject', () => {
  it('turns every visual kind into a scene object, hidden until placed', () => {
    const things: Thing[] = [
      { id: 'box', visual: { kind: 'shape', shape: 'cylinder', size: [0.1, 0.4, 0.1], color: '#ff0000', opacity: 0.5 }, place: { at: { frame: 'user', at: [0, 1, 1] } } },
      { id: 'sheet', visual: { kind: 'shape', shape: 'quad', size: [0.3, 0.2, 0], color: '#00ff00' }, place: { at: { frame: 'user', at: [0, 1, 1] } } },
      { id: 'lamp', visual: { kind: 'model', file: 'Assets/Models/lamp.glb', height: 0.5 }, place: { at: { frame: 'user', at: [0, 1, 1] } } },
      { id: 'buddy', visual: { kind: 'character', file: 'Assets/Characters/b.vrm', animation: 'Idle', height: 1.4 }, place: { near: { user: 'feet' } } },
      newThing('panel', 'quiz'),
      { id: 'tag', visual: { kind: 'label', text: 'hint', height: 0.03 }, place: { near: { thing: 'quiz' } } },
      { id: 'base', visual: { kind: 'marker' }, place: { at: { frame: 'world', at: [0, 0, 1] } } },
    ];
    const out = lowerSpatialProject(project(things));
    const objects = out.scenesData[0].objects;
    expect(objects.map((o) => [o.id, o.type])).toEqual([
      ['box', 'primitive'], ['sheet', 'primitive'], ['lamp', 'model'], ['buddy', 'vrm'], ['quiz', 'canvas'], ['tag', 'canvas'], ['base', 'empty'],
    ]);
    for (const o of objects) {
      expect(o.assetId).toBe(o.id);
      expect(o.transform.position.y).toBeLessThan(-5);
    }
    // 円柱は Unity では高さ 2 m
    expect(objects[0].transform.scale).toEqual({ x: 0.1, y: 0.2, z: 0.1 });
    expect(objects[1].primitiveType).toBe('cube');
    expect(objects[1].transform.scale.z).toBeCloseTo(0.002);
    expect(objects[3].character).toMatchObject({ animation: 'Idle', blink: true, lookAtUser: 'nearby' });
    expect(objects[4].canvasSettings).toEqual({ layoutId: 'layster-quiz', widthMeters: 0.4, heightMeters: 0.25, pixelsPerUnit: 1000 });

    const rt = out.spatialData.things;
    expect(rt.map((t) => t.kind)).toEqual(['shape', 'shape', 'model', 'character', 'panel', 'label', 'marker']);
    expect(rt[0].shape).toEqual({ shape: 'cylinder', color: '#ff0000', opacity: 0.5 });
    expect(rt[2].model).toEqual({ height: 0.5 });
    expect(rt[3].character).toEqual({ height: 1.4, animation: 'Idle' });
    expect(rt[3].size[1]).toBe(1.4);
    expect(rt[4].panel?.layoutId).toBe('layster-quiz');
    expect(rt[5].panel?.bindings).toEqual({ text: 'tag.text' });
    expect(rt.every((t) => t.object === t.id && t.visibleAtStart && t.occlusion === 'auto' && !t.grabbable)).toBe(true);
  });

  it('lays panel items out absolutely with the binding ids scripts and rules use', () => {
    const thing: Thing = {
      id: 'menu',
      visual: {
        kind: 'panel', size: [0.5, 0.5], padding: 20,
        items: [
          { type: 'text', id: 'title', text: 'Menu', size: 40, bind: 'menu.title', reveal: 10 },
          { type: 'row', items: [{ type: 'button', id: 'yes', text: 'Yes' }, { type: 'button', id: 'no', text: 'No', event: 'answer.no' }] },
          { type: 'space', height: 30 },
          { type: 'input', id: 'name', bind: 'user.name', placeholder: 'Your name' },
          { type: 'image', file: 'Assets/Images/a.png', height: 80 },
        ],
      },
      place: { at: { frame: 'user', at: [0, 1.2, 1] } },
    };
    const out = lowerSpatialProject(project([thing]));
    const layout = out.uiData[0];
    expect(layout).toMatchObject({ id: 'layster-menu', scope: 'canvas', resolution: { width: 500, height: 500 } });
    const els = layout.root.children;
    expect(els.map((e) => [e.type, e.bindingId])).toEqual([
      ['Text', 'menu.title'], ['Button', 'menu.yes'], ['Button', 'answer.no'], ['Input', 'menu.name'], ['Image', undefined],
    ]);
    expect(els[0]).toMatchObject({ bind: { key: 'menu.title' }, reveal: { speed: 10 }, style: { position: 'absolute', left: 20, top: 20, fontSize: 40 } });
    // 行の 2 つのボタンは横に並ぶ
    expect(els[1].style.top).toBe(els[2].style.top);
    expect(Number(els[2].style.left)).toBeGreaterThan(Number(els[1].style.left));
    expect(els[3].bind).toEqual({ key: 'user.name' });
    expect(els[4].assetPath).toBe('Assets/Images/a.png');
    for (const e of els) expect(Number(e.style.height)).toBeGreaterThanOrEqual(50);
    expect(out.spatialData.things[0].panel?.bindings).toEqual({ title: 'menu.title', yes: 'menu.yes', no: 'answer.no', name: 'menu.name' });
    expect(out.warnings).toEqual([]);
  });

  it('warns when a panel is too small for its items', () => {
    const thing: Thing = {
      id: 'tiny', visual: { kind: 'panel', size: [0.2, 0.06], items: [{ type: 'text', text: 'a long sentence that will need several lines here' }, { type: 'button', id: 'ok', text: 'OK' }] },
      place: { at: { frame: 'user', at: [0, 1, 1] } },
    };
    expect(lowerSpatialProject(project([thing])).warnings[0]).toMatch(/tiny.*cut off/);
  });

  it('resolves mind keys into headers and never leaves the secret name', () => {
    const mind = { ...newMind('helper'), auth: { secret: 'GROQ_KEY' } };
    const out = lowerSpatialProject(project([newThing('panel', 'p')], { minds: [mind] }), { secrets: { GROQ_KEY: 'sk-123' } });
    expect(out.spatialData.minds[0].auth).toEqual({ header: 'Authorization', value: 'Bearer sk-123' });
    expect(JSON.stringify(out.spatialData)).not.toContain('GROQ_KEY');
    expect(out.bakedSecrets).toEqual(['GROQ_KEY']);

    const raw = lowerSpatialProject(project([], { minds: [{ ...mind, auth: { secret: 'K', header: 'x-api-key', scheme: '' } }] }), { secrets: { K: 'v' } });
    expect(raw.spatialData.minds[0].auth).toEqual({ header: 'x-api-key', value: 'v' });

    expect(() => lowerSpatialProject(project([], { minds: [mind] }))).toThrow(LowerError);
  });

  it('builds a manifest through the shared Virtual path, marked as Spatial', () => {
    const p = project([newThing('character', 'buddy')], {
      scripts: [{ id: 's1', name: 'main', trigger: { type: 'onStart' }, code: 'log(1)', enabled: true }, { id: 's2', name: 'off', trigger: { type: 'onStart' }, code: '', enabled: false }],
      memory: { persist: ['memory.'] },
      presentation: { reality: 'virtual-room' },
      interaction: { controllers: false, hands: true, gazeDwellSeconds: 1.5 },
      extensions: { vrm10: { enabled: true, dataVersion: 1, settings: {} } } as SpatialProject['extensions'],
    });
    p.things[0].visual = { kind: 'character', file: 'Assets/Characters/b.vrm' };
    const out = lowerSpatialProject(p, { targetDevice: 'XREAL_One' });
    const m = out.manifestData as Record<string, any>;
    expect(m.layster).toEqual({ profile: 'spatial', stage: 'beta', version: '1.0.0' });
    expect(m.targetDevice).toBe('XREAL_One');
    expect(m.appType).toBe('3d_ar_scene');
    expect(m.arSettings.backgroundMode).toBe('solidColor');
    expect(m.arSettings.interaction).toEqual({ controllerRay: false, handTracking: true, gazeDwellSeconds: 1.5 });
    expect(m.build.packageName).toBe('com.layster.deskbuddy');
    expect(m.projectExtensions).toEqual({ vrm10: { enabled: true, dataVersion: 1, settings: {} } });
    expect(m.storage).toEqual({ persist: ['memory.'] });
    expect(m.scriptBundle.scripts.map((s: { id: string }) => s.id)).toEqual(['s1']);
    expect(out.scriptsData).toEqual({ version: '1.0', scripts: [{ id: 's1', trigger: { type: 'onStart' }, code: 'log(1)', enabled: true }], storage: { persist: ['memory.'] } });
  });

  it('writes spatial.json in the documented shape', () => {
    const p = project([newThing('panel', 'hello')], { app: { packageName: 'com.a.b', versionCode: 1, minSdkVersion: 32, targetSdkVersion: 34, edge: '192.168.0.23:8000' } });
    const s = lowerSpatialProject(p).spatialData;
    expect(Object.keys(s).sort()).toEqual(['bodies', 'edge', 'format', 'interaction', 'layster', 'memory', 'minds', 'name', 'presentation', 'recording', 'rules', 'things', 'vocabulary'].sort());
    expect(s.format).toBe(SPATIAL_RUNTIME_FORMAT);
    expect(s.edge).toBe('192.168.0.23:8000');
    expect(s.vocabulary.find((w) => w.word === 'desk')?.broader).toEqual(['table']);
    expect(s.things[0].place).toEqual(p.things[0].place);
    expect(s.things[0].size).toEqual([0.4, 0.25, 0.01]);
  });
});

describe('project settings that reach the build', () => {
  it('passes the log relay setting to arSettings (on by default, off when turned off)', () => {
    const on = lowerSpatialProject(project([newThing('panel', 'p')]));
    expect((on.manifestData.arSettings as { logRelay?: unknown }).logRelay).toEqual({ enabled: true });
    const p = project([newThing('panel', 'p')]);
    p.app.logRelay = { enabled: false, port: 9800 };
    const off = lowerSpatialProject(p);
    expect((off.manifestData.arSettings as { logRelay?: unknown }).logRelay).toEqual({ enabled: false, port: 9800 });
    // 古いプロジェクト (logRelay が無い) は何も書かない = UnityBuilder の既定 (有効)
    const old = project([newThing('panel', 'p')]);
    delete old.app.logRelay;
    expect((lowerSpatialProject(old).manifestData.arSettings as { logRelay?: unknown }).logRelay).toBeUndefined();
  });

  it('sends the virtual-room style only when reality is virtual-room', () => {
    const p = project([newThing('panel', 'p')]);
    expect(lowerSpatialProject(p).spatialData.virtualRoom).toBeUndefined();
    p.presentation = { reality: 'virtual-room' };
    const out = lowerSpatialProject(p);
    expect(out.spatialData.virtualRoom?.gridCell).toBe(0.5);
    expect((out.manifestData.arSettings as { backgroundMode?: string }).backgroundMode).toBe('solidColor');
  });
});

describe('panel helpers', () => {
  it('estimates wrapped lines for Latin and Japanese', () => {
    expect(estimateLines('abc', 32, 1000)).toBe(1);
    expect(estimateLines('あ'.repeat(20), 40, 400)).toBe(2);
    expect(estimateLines('a\nb', 32, 1000)).toBe(2);
  });
  it('names bindings', () => {
    expect(panelBindingId('t', { type: 'text', text: 'x' })).toBeUndefined();
    expect(panelBindingId('t', { type: 'button', id: 'ok', text: 'OK' })).toBe('t.ok');
  });
});
