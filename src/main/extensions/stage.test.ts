import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  collectAndroidAdditions,
  manifestEntries,
  mergeAndroidManifest,
  preservedNamespaces,
  renderLinkXml,
  renderRegistrySource,
} from './stage';
import { extensionRoots, loadExtensionCatalog } from './ExtensionCatalog';
import { newExtensionState, resolveExtensions, type ExtensionManifest } from '../../shared/extensions';

const ROOT = path.resolve(__dirname, '../../..');

function ext(id: string, extra: Partial<ExtensionManifest> = {}): { manifest: ExtensionManifest } {
  return {
    manifest: {
      id, version: '1.2.3',
      name: { en: id, ja: id }, description: { en: id, ja: id },
      unity: { entry: `Arsist.Extensions.${id.replace(/-/g, '')}.Entry` },
      ...extra,
    },
  };
}

describe('extension staging', () => {
  it('generates a registry that news up each entry class', () => {
    const src = renderRegistrySource([ext('b-thing'), ext('a-thing'), ext('no-code', { unity: undefined })]);
    expect(src).toContain('RuntimeInitializeLoadType.SubsystemRegistration');
    expect(src).toContain('ArsistExtensions.Register(new global::Arsist.Extensions.athing.Entry()); // a-thing 1.2.3');
    expect(src.indexOf('a-thing')).toBeLessThan(src.indexOf('b-thing'));
    expect(src).not.toContain('no-code');
    // 生成物は ASCII だけ (Unity が別の文字コードで読んでも壊れない)
    expect(/^[\x00-\x7F]*$/.test(src)).toBe(true);
    expect(renderRegistrySource([])).toBe('');
  });

  it('preserves the entry namespace (or the listed ones) from IL2CPP stripping', () => {
    expect(preservedNamespaces([ext('a'), ext('b', { unity: { entry: 'X.Y.Z', preserve: ['X.Y', 'X.Other'] } })]))
      .toEqual(['Arsist.Extensions.a', 'X.Other', 'X.Y']);
    expect(renderLinkXml([ext('a')])).toContain('<namespace fullname="Arsist.Extensions.a" preserve="all" />');
    expect(renderLinkXml([])).toBe('');
  });

  it('adds only missing Android declarations, once', () => {
    const quest = fs.readFileSync(path.join(ROOT, 'Adapters/Meta_Quest/AndroidManifest.xml'), 'utf8');
    const additions = collectAndroidAdditions([
      ext('a', { android: { permissions: ['com.oculus.permission.USE_SCENE', 'com.oculus.permission.USE_ANCHOR_API'] } }),
      ext('b', { android: { features: [{ name: 'oculus.software.scene', required: false }], metadata: [{ name: 'x.y', value: 'v' }] } }),
    ]);
    const first = mergeAndroidManifest(quest, additions);
    // USE_SCENE はアダプタの manifest に既にあるので足さない
    expect(first.added).toEqual(['uses-permission com.oculus.permission.USE_ANCHOR_API', 'uses-feature oculus.software.scene', 'meta-data x.y']);
    expect(first.xml.match(/USE_SCENE/g)).toHaveLength(1);
    expect(first.xml.indexOf('USE_ANCHOR_API')).toBeLessThan(first.xml.lastIndexOf('</manifest>'));
    expect(first.xml.indexOf('android:name="x.y"')).toBeLessThan(first.xml.lastIndexOf('</application>'));

    const second = mergeAndroidManifest(first.xml, additions);
    expect(second.added).toEqual([]);
    expect(second.xml).toBe(first.xml);
  });

  it('says required if any extension requires a feature', () => {
    const a = collectAndroidAdditions([
      ext('a', { android: { features: [{ name: 'f.g', required: false }] } }),
      ext('b', { android: { features: [{ name: 'f.g', required: true }] } }),
    ]);
    expect(a.features).toEqual([{ name: 'f.g', required: true }]);
  });

  it('writes the resolved entries Unity reads', () => {
    const m = ext('a', { script: { globals: ['thing'] }, data: { version: 2, settings: [], migrations: [{ from: 1, to: 2 }] } }).manifest;
    expect(manifestEntries([{ manifest: m, settings: { k: 1 }, dataVersion: 2, deferred: [] }])).toEqual([
      { id: 'a', version: '1.2.3', dataVersion: 2, settings: { k: 1 }, entry: 'Arsist.Extensions.a.Entry', scriptGlobals: ['thing'] },
    ]);
  });
});

describe('extension catalog', () => {
  it('loads the repo extensions without problems', async () => {
    const catalog = await loadExtensionCatalog(extensionRoots({ repoRoot: ROOT }));
    expect(catalog.problems).toEqual([]);
    expect(catalog.extensions.map((e) => e.manifest.id)).toContain('quest-room');
  });

  it('lets a user copy override the bundled one, and rejects broken ones with a reason', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arsist-ext-'));
    try {
      const bundled = path.join(tmp, 'res', 'Extensions');
      const user = path.join(tmp, 'user');
      const write = (dir: string, json: unknown, runtime?: string) => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'extension.json'), JSON.stringify(json));
        if (runtime) {
          fs.mkdirSync(path.join(dir, 'Runtime'), { recursive: true });
          fs.writeFileSync(path.join(dir, 'Runtime', 'Entry.cs'), runtime);
        }
      };
      const good = (version: string) => ({
        id: 'thing', version, name: { en: 'T', ja: 'T' }, description: { en: 'T', ja: 'T' },
        unity: { entry: 'Arsist.Extensions.Thing.ThingExtension' },
      });
      const cs = 'namespace Arsist.Extensions.Thing { public class ThingExtension {} }';
      write(path.join(bundled, 'thing'), good('1.0.0'), cs);
      write(path.join(user, 'thing'), good('1.1.0'), cs);
      write(path.join(user, 'no-class'), { ...good('1.0.0'), id: 'no-class' }, 'class Other {}');
      fs.mkdirSync(path.join(user, 'bad-json'));
      fs.writeFileSync(path.join(user, 'bad-json', 'extension.json'), '{ nope');

      const catalog = await loadExtensionCatalog(extensionRoots({ resourcesPath: path.join(tmp, 'res'), userDir: user }));
      expect(catalog.extensions).toHaveLength(1);
      expect(catalog.extensions[0]).toMatchObject({ source: 'user', overrides: path.join(bundled, 'thing') });
      expect(catalog.extensions[0].manifest.version).toBe('1.1.0');
      const reasons = catalog.problems.map((p) => `${path.basename(p.dir)}: ${p.problems.join('; ')}`);
      expect(reasons.find((r) => r.startsWith('no-class'))).toMatch(/ThingExtension was not found/);
      expect(reasons.find((r) => r.startsWith('bad-json'))).toMatch(/not valid JSON/);

      // 解決にそのまま使える
      const r = resolveExtensions({ thing: newExtensionState(catalog.extensions[0].manifest) }, catalog.extensions.map((e) => e.manifest), [], { irVersion: 4 });
      expect(r.active).toHaveLength(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
