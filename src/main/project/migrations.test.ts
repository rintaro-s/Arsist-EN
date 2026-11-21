import { describe, it, expect } from 'vitest';
import { CURRENT_IR_VERSION, readIrVersion } from '../../shared/irVersion';
import { defineMigration, IrVersionError, MIGRATIONS, migrateProject, needsMigration, virtualBackupTag } from './migrations';
import { describeVirtualIrVersion, formatLayster, virtualHeaderFor } from '../../shared/layster/version';
import { STRINGS } from '../../renderer/i18n/strings';

function legacyProject(): Record<string, any> {
  // irVersion が無く、旧テンプレート名で、arSettings も dataFlow も無い頃の project.json
  return {
    id: 'p1',
    name: 'Old',
    version: '1.0.0',
    appType: '3D_AR',
    targetDevice: 'XREAL_One',
    logicGraphs: [{ id: 'g' }],
    uiCode: { html: '' },
    scenes: [],
    uiLayouts: [],
    buildSettings: { packageName: 'com.x', version: '1.0.0', versionCode: 1, minSdkVersion: 29, targetSdkVersion: 34 },
    perception: { targets: [], tasks: [{ id: 't', analysis: { kind: 'sky' } }] },
  };
}

describe('IR migrations', () => {
  it('reads a missing irVersion as 1', () => {
    expect(readIrVersion({})).toBe(1);
    expect(readIrVersion({ irVersion: 'x' })).toBe(1);
    expect(readIrVersion({ irVersion: 2 })).toBe(2);
    expect(readIrVersion(null)).toBe(1);
  });

  it('covers every version step up to the current one', () => {
    for (let v = 1; v < CURRENT_IR_VERSION; v++) {
      expect(MIGRATIONS.some((m) => m.from === v && m.to === v + 1)).toBe(true);
    }
  });

  it('brings a legacy project to the current shape', () => {
    const raw = legacyProject();
    const outcome = migrateProject(raw);

    expect(outcome.from).toBe(1);
    expect(outcome.to).toBe(CURRENT_IR_VERSION);
    expect(outcome.applied).toEqual(MIGRATIONS.map((m) => m.id));
    expect(raw.irVersion).toBe(CURRENT_IR_VERSION);

    expect(raw.appType).toBe('3d_ar_scene');
    expect(raw.arSettings.trackingMode).toBe('6dof');
    expect(raw.arSettings.interaction).toEqual({ controllerRay: true, handTracking: false });
    expect(raw.dataFlow).toEqual({ dataSources: [], transforms: [] });
    expect(raw.scripts).toEqual([]);
    expect(raw.models).toEqual([]);
    expect(raw.extensions).toEqual({});
    expect('logicGraphs' in raw).toBe(false);
    expect('uiCode' in raw).toBe(false);
    expect('analysis' in raw.perception.tasks[0]).toBe(false);

    expect(outcome.changes).toEqual(expect.arrayContaining([
      'appType', 'arSettings', 'dataFlow', 'logicGraphs', 'uiCode', 'scripts', 'perception.analysis', 'models',
    ]));
  });

  it('is a no-op on a current project', () => {
    const raw = legacyProject();
    migrateProject(raw);
    const snapshot = JSON.stringify(raw);

    const again = migrateProject(raw);
    expect(again.applied).toEqual([]);
    expect(again.changes).toEqual([]);
    expect(JSON.stringify(raw)).toBe(snapshot);
    expect(needsMigration(raw)).toBe(false);
  });

  it('keeps what a legacy project already had', () => {
    const raw = legacyProject();
    raw.arSettings = { trackingMode: '3dof', presentationMode: 'floating_screen', worldScale: 2, defaultDepth: 3 };
    raw.scripts = [{ id: 's' }];
    migrateProject(raw);
    expect(raw.arSettings.worldScale).toBe(2);
    expect(raw.arSettings.interaction).toBeDefined();
    expect(raw.scripts).toEqual([{ id: 's' }]);
  });

  it('2 → 3 marks existing models as image models and leaves their reading intact', () => {
    const raw: Record<string, any> = {
      ...legacyProject(),
      irVersion: 2,
      models: [
        { id: 'm1', name: 'cls', file: 'Assets/Models/a.onnx', format: 'onnx', task: 'classify', input: { width: 224 }, output: {} },
        { id: 'm2', name: 'llm', file: 'Assets/Models/b.onnx', format: 'onnx', use: 'text', text: { task: 'generate', tokenizer: 't.json' } },
      ],
    };
    const outcome = migrateProject(raw);
    expect(outcome.applied).toEqual(MIGRATIONS.filter((m) => m.from >= 2).map((m) => m.id));
    expect(raw.models[0].use).toBe('image');
    expect(raw.models[0].task).toBe('classify');
    expect(raw.models[0].input.width).toBe(224);
    expect(raw.models[1].use).toBe('text');
    expect(outcome.changes).toContain('models.use');

    // 冪等: もう一度掛けても変わらない
    const again = MIGRATIONS.find((m) => m.from === 2)!.apply(raw);
    expect(again).toEqual([]);
  });

  it('3 → 4 adds the extension slot and keeps extension data that is already there', () => {
    const fresh: Record<string, any> = { ...legacyProject(), irVersion: 3 };
    const outcome = migrateProject(fresh);
    expect(outcome.applied).toEqual(MIGRATIONS.filter((m) => m.from >= 3).map((m) => m.id));
    expect(fresh.extensions).toEqual({});
    expect(outcome.changes).toContain('extensions');

    // 手で先に書かれていたら触らない
    const prefilled: Record<string, any> = {
      ...legacyProject(), irVersion: 3,
      extensions: { 'quest-room': { enabled: true, dataVersion: 1, settings: { loadRoom: false } } },
    };
    migrateProject(prefilled);
    expect(prefilled.extensions['quest-room'].settings.loadRoom).toBe(false);
  });

  it('4 → 5 adds the saved-keys slot and leaves old VRMs without character motion', () => {
    const vrm = { id: 'v', name: 'Sis', type: 'vrm', modelPath: 'Assets/Models/s.vrm', transform: {} };
    const raw: Record<string, any> = { ...legacyProject(), irVersion: 4, extensions: {}, scenes: [{ id: 's', name: 'S', objects: [vrm] }] };
    const outcome = migrateProject(raw);
    expect(outcome.applied).toEqual(MIGRATIONS.filter((m) => m.from >= 4).map((m) => m.id));
    expect(raw.storage).toEqual({ persist: [] });
    // 無い = 今までどおり (瞬きも呼吸もしない)。補うと古いプロジェクトの見た目が変わる
    expect('character' in raw.scenes[0].objects[0]).toBe(false);

    const prefilled: Record<string, any> = { ...legacyProject(), irVersion: 4, storage: { persist: ['memory.'] } };
    migrateProject(prefilled);
    expect(prefilled.storage.persist).toEqual(['memory.']);
  });

  it('5 → 6 (α5 → Layster.Virtual β 1.0.0) adds only the layster heading, at the top', () => {
    const raw: Record<string, any> = { ...legacyProject(), irVersion: 5, extensions: {}, storage: { persist: ['memory.'] } };
    const before = JSON.stringify({ ...raw, irVersion: undefined });
    const outcome = migrateProject(raw);
    expect(outcome.applied).toEqual(MIGRATIONS.filter((m) => m.from >= 5).map((m) => m.id));
    expect(outcome.changes).toEqual(['layster']);
    // 見出しは最後に今の版のものになる (6 で β 1.0.0、その後の版で書き換わる)
    expect(raw.layster).toEqual(virtualHeaderFor(CURRENT_IR_VERSION));
    expect(Object.keys(raw)[0]).toBe('layster');
    // 見出しと版の数のほかは何も変わらない
    const { layster: _h, ...rest } = raw;
    expect(JSON.stringify({ ...rest, irVersion: undefined })).toBe(before);
  });

  it('6 → 7 (β 1.0.0 → β 1.1.0: cameras, image sources, embody) changes nothing but the heading', () => {
    // 古い: β 1.0.0 のカメラの無いプロジェクト。VRM はあるが embody は無い
    const vrm = { id: 'v', name: 'Me', type: 'vrm', modelPath: 'Assets/Models/me.vrm', transform: {}, character: { blink: true } };
    const image = { id: 'img', type: 'Image', assetPath: 'Assets/Textures/a.png' };
    const raw: Record<string, any> = {
      layster: { profile: 'virtual', stage: 'beta', version: '1.0.0' },
      ...legacyProject(), irVersion: 6, extensions: {}, storage: { persist: [] },
      scenes: [{ id: 's', name: 'S', objects: [vrm] }],
      uiLayouts: [{ id: 'l', name: 'L', scope: 'canvas', root: image }],
    };
    const before = JSON.stringify({ ...raw, layster: undefined, irVersion: undefined });
    const outcome = migrateProject(raw);
    expect(outcome.applied).toEqual(['7']);
    expect(outcome.changes).toEqual(['layster']);
    // 新しい: 見出しが β 1.1.0 になるだけ。camera / source / embody は足さない (無い = 今までどおり)
    expect(raw.layster).toEqual({ profile: 'virtual', stage: 'beta', version: '1.1.0' });
    expect(raw.irVersion).toBe(7);
    expect('embody' in raw.scenes[0].objects[0].character).toBe(false);
    expect('source' in raw.uiLayouts[0].root).toBe(false);
    expect(JSON.stringify({ ...raw, layster: undefined, irVersion: undefined })).toBe(before);
  });

  it('gives a current-version file without a heading its heading (and nothing else)', () => {
    const raw: Record<string, any> = { ...legacyProject() };
    migrateProject(raw);
    delete raw.layster;
    const outcome = migrateProject(raw);
    expect(outcome.applied).toEqual([]);
    expect(outcome.changes).toEqual(['layster']);
    expect(raw.layster).toEqual(virtualHeaderFor(CURRENT_IR_VERSION));
    // 2 回目は何もしない
    expect(migrateProject(raw).changes).toEqual([]);
  });

  it('names the versions α1–α5 and β 1.0.0', () => {
    expect(describeVirtualIrVersion(5)).toBe('α5');
    expect(describeVirtualIrVersion(6)).toBe('β 1.0.0');
    expect(formatLayster(virtualHeaderFor(CURRENT_IR_VERSION)!)).toMatch(/^Layster\.Virtual β \d+\.\d+\.\d+$/);
    expect(virtualBackupTag(5)).toBe('alpha5');
    expect(virtualBackupTag(6)).toBe('beta1.0.0');
    expect(describeVirtualIrVersion(7)).toBe('β 1.1.0');
  });

  it('has a name for every version up to the current one', () => {
    for (let v = 1; v <= CURRENT_IR_VERSION; v++) {
      expect(virtualHeaderFor(v), `VIRTUAL_FORMATS[${v}] is missing in src/shared/layster/version.ts`).toBeDefined();
    }
    expect(virtualHeaderFor(CURRENT_IR_VERSION)!.stage).toBe('beta');
  });

  // ---- すべての移行に対して自動で確かめること (版を足しても書き足さなくてよい) ----

  it('ends exactly at CURRENT_IR_VERSION, one step at a time', () => {
    const tos = MIGRATIONS.map((m) => m.to);
    expect(Math.max(...tos)).toBe(CURRENT_IR_VERSION);
    for (const m of MIGRATIONS) {
      expect(m.to).toBe(m.from + 1);
      expect(m.id).toBe(String(m.to));
    }
    expect(new Set(tos).size).toBe(tos.length);
  });

  it('has an upgrade description in both languages for every step', () => {
    for (const m of MIGRATIONS) {
      const entry = STRINGS[`ir.migration.${m.id}`];
      expect(entry, `ir.migration.${m.id} is missing in src/renderer/i18n/strings.ts`).toBeDefined();
      expect(entry.en.length).toBeGreaterThan(10);
      expect(entry.ja.length).toBeGreaterThan(5);
    }
  });

  it('every step is idempotent on its own output', () => {
    for (const m of MIGRATIONS) {
      const raw: Record<string, any> = { ...legacyProject(), irVersion: m.from };
      // そこまでの移行を済ませてから、この段を 2 回掛ける
      for (const earlier of MIGRATIONS.filter((e) => e.to <= m.from)) earlier.apply(raw);
      m.apply(raw);
      const snapshot = JSON.stringify(raw);
      expect(m.apply(raw), `migration ${m.id} changed something on its second run`).toEqual([]);
      expect(JSON.stringify(raw)).toBe(snapshot);
    }
  });

  it('defineMigration runs declarative ops before the custom step', () => {
    const order: string[] = [];
    const step = defineMigration(9, {
      ops: [{ op: 'rename', path: 'scenes[].objects[].oldName', to: 'newName' }],
      apply: (p) => { order.push(p.scenes[0].objects[0].newName); return ['custom']; },
    });
    expect(step.from).toBe(8);
    const raw = { scenes: [{ objects: [{ oldName: 'x' }] }] };
    expect(step.apply(raw)).toEqual(['scenes[].objects[].oldName', 'custom']);
    expect(order).toEqual(['x']);
  });

  it('refuses a project from a newer editor instead of mangling it', () => {
    const raw = { ...legacyProject(), irVersion: CURRENT_IR_VERSION + 1 };
    expect(() => migrateProject(raw)).toThrow(IrVersionError);
    expect(needsMigration(raw)).toBe(false);
  });
});
