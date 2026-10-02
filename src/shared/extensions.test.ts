import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  BUILTIN_SCRIPT_GLOBALS,
  checkProjectRequirements,
  findAdapterProvider,
  countObjectsWithExtension,
  defaultObjectData,
  migrateExtensionData,
  newExtensionState,
  resolveExtensions,
  validateExtensionManifest,
  type ExtensionManifest,
} from './extensions';
import { adapterTags } from './adapterTags';
import { matchAdapterName } from './adapterNames';

const ROOT = path.resolve(__dirname, '../..');
const EXTENSIONS = path.join(ROOT, 'Extensions');

function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'demo',
    version: '1.0.0',
    name: { en: 'Demo', ja: 'デモ' },
    description: { en: 'Demo', ja: 'デモ' },
    requires: { all: ['cap:hand-tracking'] },
    data: {
      version: 1,
      settings: [{ key: 'speed', type: 'number', default: 1, label: { en: 'Speed', ja: '速さ' } }],
      object: [{ key: 'glow', type: 'boolean', default: false, label: { en: 'Glow', ja: '光る' } }],
    },
    unity: { entry: 'Arsist.Extensions.Demo.DemoExtension' },
    ...overrides,
  };
}

describe('extension manifests', () => {
  it('every extension in the repo is valid and matches its folder', () => {
    const folders = fs.readdirSync(EXTENSIONS).filter((f) => fs.existsSync(path.join(EXTENSIONS, f, 'extension.json')));
    expect(folders.length).toBeGreaterThan(0);
    for (const folder of folders) {
      const raw = JSON.parse(fs.readFileSync(path.join(EXTENSIONS, folder, 'extension.json'), 'utf8'));
      const { manifest: m, problems } = validateExtensionManifest(raw, folder);
      expect(problems, folder).toEqual([]);
      // 入口のクラスが本当に Runtime/ にあること (無いとビルドの最後で C# が通らない)
      if (m?.unity?.entry) {
        const className = m.unity.entry.split('.').pop()!;
        const dir = path.join(EXTENSIONS, folder, m.unity.runtimeDir ?? 'Runtime');
        const sources = fs.readdirSync(dir).filter((f) => f.endsWith('.cs')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
        const ns = m.unity.entry.split('.').slice(0, -1).join('.');
        expect(sources.some((src) => src.includes(`class ${className}`) && src.includes(`namespace ${ns}`)), `${folder}: ${m.unity.entry}`).toBe(true);
      }
    }
  });

  it('rejects the mistakes that would only show up on the device', () => {
    const bad = (o: Record<string, unknown>) => validateExtensionManifest({ ...manifest(), ...o }).problems;
    expect(bad({ id: 'Quest Room' })).not.toEqual([]);
    expect(validateExtensionManifest(manifest(), 'other-folder').problems[0]).toMatch(/folder name/);
    expect(bad({ requires: { all: ['quest'] } })[0]).toMatch(/not a tag/);
    expect(bad({ script: { globals: ['store'] } })[0]).toMatch(/built-in/);
    expect(bad({ unity: { entry: 'NoNamespace' } })[0]).toMatch(/unity.entry/);
    expect(bad({ unity: { runtimeDir: '../elsewhere' } })[0]).toMatch(/runtimeDir/);
    expect(bad({ android: { permissions: ['not a permission'] } })[0]).toMatch(/permission/);
    expect(bad({ data: { version: 2 } })[0]).toMatch(/no migrations/);
    expect(bad({ data: { version: 1, settings: [{ key: 'm', type: 'select', default: 'z', label: { en: 'M', ja: 'M' }, options: [{ value: 'a', label: { en: 'A', ja: 'A' } }] }] } })[0])
      .toMatch(/one of the options/);
  });

  it('keeps the built-in script names in sync with ScriptEngineManager', () => {
    const src = fs.readFileSync(path.join(ROOT, 'UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/Scripting/ScriptEngineManager.cs'), 'utf8');
    const names = [...src.matchAll(/_engine\.SetValue\("([A-Za-z_$][A-Za-z0-9_$]*)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) expect(BUILTIN_SCRIPT_GLOBALS, `ScriptEngineManager exposes "${name}"`).toContain(name);

    // 実機側で上書きを断る表 (ArsistScriptBridge.BuiltInNames) も同じであること
    const bridge = fs.readFileSync(path.join(ROOT, 'UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/Extensions/ArsistScriptBridge.cs'), 'utf8');
    const block = bridge.slice(bridge.indexOf('BuiltInNames ='), bridge.indexOf('};', bridge.indexOf('BuiltInNames =')));
    const csNames = [...block.matchAll(/"([A-Za-z_$][A-Za-z0-9_$]*)"/g)].map((m) => m[1]);
    expect([...csNames].sort()).toEqual([...BUILTIN_SCRIPT_GLOBALS].sort());
  });
});

describe('which extensions go into a build', () => {
  const catalog = [manifest(), manifest({ id: 'everywhere', requires: undefined, unity: undefined })];

  it('follows the device tags', () => {
    const project = { demo: newExtensionState(catalog[0]), everywhere: newExtensionState(catalog[1]) };
    const onQuest = resolveExtensions(project, catalog, ['cap:hand-tracking'], { irVersion: 4 });
    expect(onQuest.active.map((a) => a.manifest.id)).toEqual(['demo', 'everywhere']);

    const onXreal = resolveExtensions(project, catalog, ['cap:optical-see-through'], { irVersion: 4 });
    expect(onXreal.active.map((a) => a.manifest.id)).toEqual(['everywhere']);
    expect(onXreal.skipped).toEqual([expect.objectContaining({ id: 'demo', reason: 'unsupported', missing: ['cap:hand-tracking'] })]);
  });

  it('explains every other reason it skips one', () => {
    const states = {
      demo: { ...newExtensionState(catalog[0]), enabled: false },
      gone: { enabled: true, dataVersion: 1, settings: {} },
      future: { ...newExtensionState(catalog[1]), dataVersion: 7 },
    };
    const r = resolveExtensions(states, [catalog[0], { ...catalog[1], id: 'future' }], ['cap:hand-tracking'], { irVersion: 4 });
    expect(r.active).toEqual([]);
    expect(Object.fromEntries(r.skipped.map((s) => [s.id, s.reason]))).toEqual({ demo: 'disabled', gone: 'notInstalled', future: 'dataTooNew' });

    const old = resolveExtensions({ demo: newExtensionState(catalog[0]) }, [{ ...catalog[0], minIrVersion: 9 }], ['cap:hand-tracking'], { irVersion: 4 });
    expect(old.skipped[0].reason).toBe('engineTooOld');
  });

  it('layers project settings over the defaults', () => {
    const r = resolveExtensions({ demo: { enabled: true, dataVersion: 1, settings: { speed: 3 } } }, catalog, ['cap:hand-tracking'], { irVersion: 4 });
    expect(r.active[0].settings).toEqual({ speed: 3 });
    const d = resolveExtensions({ demo: { enabled: true, dataVersion: 1, settings: {} } }, catalog, ['cap:hand-tracking'], { irVersion: 4 });
    expect(d.active[0].settings).toEqual({ speed: 1 });
  });

  it('the Quest room extension is on for Quest builds with MRUK, and only there', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(EXTENSIONS, 'quest-room', 'extension.json'), 'utf8'));
    const room = validateExtensionManifest(raw, 'quest-room').manifest!;
    const tagsOf = (folder: string) => adapterTags(JSON.parse(fs.readFileSync(path.join(ROOT, 'Adapters', folder, 'adapter.json'), 'utf8')));
    const project = { 'quest-room': newExtensionState(room) };

    // エディタ上 (sdk:* はまだ分からない)
    const editorQuest = resolveExtensions(project, [room], tagsOf('Meta_Quest'), { irVersion: 4, deferred: ['sdk'] });
    expect(editorQuest.active).toHaveLength(1);
    expect(editorQuest.active[0].deferred).toEqual(['sdk:meta-mruk']);

    // ビルド時: MRUK が sdk/quest にあれば入る、無ければ理由付きで外れる
    expect(resolveExtensions(project, [room], [...tagsOf('Meta_Quest'), 'sdk:meta-mruk'], { irVersion: 4 }).active).toHaveLength(1);
    const noMruk = resolveExtensions(project, [room], tagsOf('Meta_Quest'), { irVersion: 4 });
    expect(noMruk.skipped[0]).toMatchObject({ reason: 'unsupported', missing: ['sdk:meta-mruk'] });

    for (const other of ['XREAL_One', 'Android_Phone']) {
      expect(resolveExtensions(project, [room], [...tagsOf(other), 'sdk:meta-mruk'], { irVersion: 4 }).active, other).toEqual([]);
    }
  });
});

describe('the Quest input extension', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(EXTENSIONS, 'quest-input', 'extension.json'), 'utf8'));
  const input = validateExtensionManifest(raw, 'quest-input').manifest!;
  const tagsOf = (folder: string) => adapterTags(JSON.parse(fs.readFileSync(path.join(ROOT, 'Adapters', folder, 'adapter.json'), 'utf8')));

  it('is valid and goes only into Quest builds that have the Meta SDK', () => {
    expect(input).toBeDefined();
    const project = { 'quest-input': newExtensionState(input) };
    expect(resolveExtensions(project, [input], [...tagsOf('Meta_Quest'), 'sdk:meta-core'], { irVersion: 4 }).active).toHaveLength(1);
    for (const other of ['XREAL_One', 'Android_Phone']) {
      expect(resolveExtensions(project, [input], [...tagsOf(other), 'sdk:meta-core'], { irVersion: 4 }).active, other).toEqual([]);
    }
  });

  it('names the engine features it needs, so the build adds the keyboard and hand declarations', () => {
    expect(input.tags).toEqual(expect.arrayContaining(['feature:text-input', 'feature:hand-tracking']));
    expect(input.android?.permissions).toContain('android.permission.RECORD_AUDIO');
  });

  it('exposes one script name per input area, none of them built-in', () => {
    expect(input.script?.globals).toEqual(['controller', 'hands', 'mic', 'keyboard', 'headset']);
  });
});

describe('extension data migrations', () => {
  const v2: ExtensionManifest = manifest({
    data: {
      version: 2,
      settings: [
        { key: 'velocity', type: 'number', default: 1, label: { en: 'Speed', ja: '速さ' } },
        { key: 'mode', type: 'string', default: 'calm', label: { en: 'Mode', ja: 'モード' } },
      ],
      object: [{ key: 'glow', type: 'select', default: 'off', label: { en: 'Glow', ja: '光る' },
        options: [{ value: 'off', label: { en: 'Off', ja: 'なし' } }, { value: 'on', label: { en: 'On', ja: 'あり' } }] }],
      migrations: [{
        from: 1, to: 2,
        settings: [{ op: 'rename', path: 'speed', to: 'velocity' }],
        object: [{ op: 'map', path: 'glow', values: { true: 'on', false: 'off' } }],
      }],
    },
  });

  function oldProject(): Record<string, any> {
    return {
      extensions: {
        demo: { enabled: true, dataVersion: 1, settings: { speed: 5 } },
        stranger: { enabled: true, dataVersion: 1, settings: { untouched: true } },
      },
      scenes: [{ objects: [
        { id: 'a', ext: { demo: { glow: true } } },
        { id: 'b', children: [{ id: 'c', ext: { demo: { glow: false }, stranger: { glow: true } } }] },
        { id: 'd' },
      ] }],
    };
  }

  it('moves only that extension\'s data to its new shape', () => {
    expect(validateExtensionManifest(v2).problems).toEqual([]);
    const p = oldProject();
    const { upgrades, problems } = migrateExtensionData(p, [v2]);
    expect(problems).toEqual([]);
    expect(upgrades).toEqual([{ id: 'demo', from: 1, to: 2, changes: expect.arrayContaining(['settings.speed', 'object.glow', 'settings.mode']) }]);
    expect(p.extensions.demo).toEqual({ enabled: true, dataVersion: 2, settings: { velocity: 5, mode: 'calm' } });
    expect(p.scenes[0].objects[0].ext.demo.glow).toBe('on');
    expect(p.scenes[0].objects[1].children[0].ext.demo.glow).toBe('off');
    // 入っていない拡張機能のデータには触れない
    expect(p.extensions.stranger.settings).toEqual({ untouched: true });
    expect(p.scenes[0].objects[1].children[0].ext.stranger.glow).toBe(true);
    expect(countObjectsWithExtension(p, 'demo')).toBe(2);

    // 2 回目は何もしない
    expect(migrateExtensionData(p, [v2]).upgrades).toEqual([]);
  });

  it('reports a gap instead of half-migrating', () => {
    const broken = { ...v2, data: { ...v2.data!, version: 3 } };
    const p = oldProject();
    const r = migrateExtensionData(p, [broken]);
    expect(r.problems[0]).toMatch(/no data migration from v2/);
    expect(r.upgrades).toEqual([]);
  });

  it('gives object defaults from the field list', () => {
    expect(defaultObjectData(v2)).toEqual({ glow: 'off' });
  });
});

describe('devices from extensions and what a project needs', () => {
  const builtin = ['Android_Phone', 'Meta_Quest', 'XREAL_One'];
  const device = manifest({ id: 'my-glasses', requires: { all: ['device:my-glasses'] }, provides: { adapters: ['My_Glasses'] } });
  const feature = manifest({ id: 'demo', requires: undefined });

  it('matches device names the way builds always have', () => {
    expect(matchAdapterName(builtin, 'Meta_Quest')).toBe('Meta_Quest');
    expect(matchAdapterName(builtin, 'meta-quest')).toBe('Meta_Quest');
    expect(matchAdapterName(builtin, 'Meta_Quest3')).toBe('Meta_Quest');
    expect(matchAdapterName(builtin, 'Pico_4')).toBeNull();
    expect(findAdapterProvider([feature, device], 'My_Glasses_Pro')?.manifest.id).toBe('my-glasses');
  });

  it('brings in the extension that provides the target device, even if nobody enabled it', () => {
    const r = resolveExtensions({}, [device, feature], ['device:my-glasses'], { irVersion: 4, targetDevice: 'My_Glasses' });
    expect(r.active.map((a) => [a.manifest.id, a.because])).toEqual([['my-glasses', 'device']]);
    // 別の端末向けなら入らない
    expect(resolveExtensions({}, [device], ['device:meta-quest'], { irVersion: 4, targetDevice: 'Meta_Quest' }).active).toEqual([]);
  });

  it('reports every extension and device the project needs but this editor lacks', () => {
    const project = {
      targetDevice: 'My_Glasses',
      extensions: {
        demo: { enabled: true, dataVersion: 1, settings: {} },
        gone: { enabled: true, dataVersion: 2, settings: {} },
        off: { enabled: false, dataVersion: 1, settings: {} },
        future: { enabled: true, dataVersion: 3, settings: {} },
      },
    };
    const catalog = [feature, manifest({ id: 'future', requires: undefined, minIrVersion: 9 })];
    const missing = checkProjectRequirements(project, catalog, builtin, 4);
    expect(missing.map((m) => `${m.kind}:${m.id}`)).toEqual([
      'extensionTooOld:future', 'engineTooOld:future', 'extension:gone', 'device:My_Glasses',
    ]);
    // 端末の拡張機能が入れば、端末は揃う。無効にした拡張機能は要らない
    const ok = checkProjectRequirements({ ...project, extensions: { demo: project.extensions.demo, off: project.extensions.off } }, [feature, device], builtin, 4);
    expect(ok).toEqual([]);
  });

  it('the bundled projects in this repo open with what the repo ships', () => {
    const products = path.join(ROOT, 'products');
    const repoCatalog = fs.readdirSync(EXTENSIONS)
      .filter((f) => fs.existsSync(path.join(EXTENSIONS, f, 'extension.json')))
      .map((f) => validateExtensionManifest(JSON.parse(fs.readFileSync(path.join(EXTENSIONS, f, 'extension.json'), 'utf8')), f).manifest!);
    const adapters = fs.readdirSync(path.join(ROOT, 'Adapters')).filter((f) => fs.existsSync(path.join(ROOT, 'Adapters', f, 'adapter.json')));
    for (const product of fs.existsSync(products) ? fs.readdirSync(products) : []) {
      const file = path.join(products, product, 'project.json');
      if (!fs.existsSync(file)) continue;
      const project = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(checkProjectRequirements(project, repoCatalog, adapters, 4), product).toEqual([]);
    }
  });
});
