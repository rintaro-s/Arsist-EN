import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exportProject, importProject, peekPackageKind } from './projectPackage';
import { setStreamThreshold, writeZipFile, openZipFile } from '../extensions/zip';
import { packExtension } from '../extensions/packages';
import type { InstalledExtension } from '../extensions/ExtensionCatalog';
import type { ExtensionManifest } from '../../shared/extensions';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arsist-proj-')); });
afterEach(() => { setStreamThreshold(64 * 1024 * 1024); fs.rmSync(tmp, { recursive: true, force: true }); });

function put(rel: string, data: string | Buffer) {
  const f = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
}

function makeProject(extensions: Record<string, unknown> = {}) {
  put('src/My App/project.json', JSON.stringify({ id: 'p1', name: 'My App', irVersion: 4, targetDevice: 'Meta_Quest', extensions, scenes: [{ id: 's1' }], uiLayouts: [] }));
  put('src/My App/Scenes/s1.json', JSON.stringify({ id: 's1', name: 'Main', objects: [] }));
  put('src/My App/Assets/Models/big.onnx', Buffer.alloc(300 * 1024, 7));
  put('src/My App/Assets/a.png', 'png');
  put('src/My App/Build/MyApp.apk', 'apk');
  put('src/My App/Backups/project.v3.json', '{}');
  put('src/My App/.git/HEAD', 'ref');
  return path.join(tmp, 'src', 'My App');
}

function makeExtension(version: string): InstalledExtension {
  const dir = path.join(tmp, 'exts', version, 'demo-thing');
  const manifest: ExtensionManifest = { id: 'demo-thing', version, name: { en: 'D', ja: 'D' }, description: { en: 'D', ja: 'D' } };
  put(path.relative(tmp, path.join(dir, 'extension.json')), JSON.stringify(manifest));
  put(path.relative(tmp, path.join(dir, 'README.md')), '# d');
  return { manifest, dir, source: 'user' };
}

const listFiles = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(child); else out.push(child);
    }
  };
  walk('');
  return out.sort();
};

describe('project packages', () => {
  it('exports the project without build outputs, and imports it back with its extensions', async () => {
    setStreamThreshold(100 * 1024); // big.onnx を「大きなファイル」として流して書く
    const project = makeProject({ 'demo-thing': { enabled: true, dataVersion: 1, settings: {} } });
    const ext = makeExtension('1.0.0');
    const out = path.join(tmp, 'out', 'My App.arsist');
    const exported = await exportProject(project, out, { installed: [ext] });
    expect(exported.files).toBe(4);
    expect(exported.extensions).toEqual([{ id: 'demo-thing', version: '1.0.0', bundled: true }]);
    expect(await peekPackageKind(out)).toBe('project');

    const userDir = path.join(tmp, 'user-ext');
    const imported = await importProject(out, path.join(tmp, 'dest'), { installed: [], userExtensionsDir: userDir });
    expect(imported.name).toBe('My App');
    expect(listFiles(imported.projectPath)).toEqual(['Assets/Models/big.onnx', 'Assets/a.png', 'Scenes/s1.json', 'project.json']);
    expect(fs.readFileSync(path.join(imported.projectPath, 'Assets/Models/big.onnx')).equals(Buffer.alloc(300 * 1024, 7))).toBe(true);
    expect(imported.extensions).toEqual([{ id: 'demo-thing', version: '1.0.0', action: 'installed' }]);
    expect(fs.existsSync(path.join(userDir, 'demo-thing', 'extension.json'))).toBe(true);
    // 拡張機能はプロジェクトの中に残らない・一時フォルダも残らない
    expect(fs.existsSync(path.join(imported.projectPath, '_extensions'))).toBe(false);
    expect(fs.readdirSync(path.join(tmp, 'dest'))).toEqual(['My App']);

    // もう一度読み込むと別の名前になる (上書きしない)
    const again = await importProject(out, path.join(tmp, 'dest'), { installed: [], userExtensionsDir: userDir });
    expect(again.name).toBe('My App (2)');
  });

  it('keeps an installed extension of the same or newer version, and asks before upgrading an older one', async () => {
    const project = makeProject({ 'demo-thing': { enabled: true, dataVersion: 1, settings: {} } });
    const out = path.join(tmp, 'p.arsist');
    await exportProject(project, out, { installed: [makeExtension('1.2.0')] });

    const same = await importProject(out, path.join(tmp, 'd1'), { installed: [makeExtension('1.2.0')], userExtensionsDir: path.join(tmp, 'u') });
    expect(same.extensions[0]).toMatchObject({ action: 'kept', installedVersion: '1.2.0' });

    const older = await importProject(out, path.join(tmp, 'd2'), { installed: [makeExtension('1.0.0')], userExtensionsDir: path.join(tmp, 'u'), stagingRoot: path.join(tmp, 'stage') });
    expect(older.extensions[0]).toMatchObject({ action: 'needsConfirm', installedVersion: '1.0.0', version: '1.2.0' });
    expect(fs.existsSync(path.join(older.extensions[0].stagedDir!, 'extension.json'))).toBe(true);
  });

  it('refuses a damaged package and leaves nothing behind', async () => {
    const project = makeProject();
    const out = path.join(tmp, 'p.arsist');
    await exportProject(project, out, { installed: [] });
    // project.json の中身だけを差し替えた zip を作る (目録のハッシュと合わない)
    const entries = await openZipFile(out);
    const rebuilt = [];
    for (const e of entries) rebuilt.push({ name: e.name, data: e.name === 'project.json' ? Buffer.from('{"name":"evil"}') : await e.read() });
    await writeZipFile(path.join(tmp, 'bad.arsist'), rebuilt);

    await expect(importProject(path.join(tmp, 'bad.arsist'), path.join(tmp, 'dest'), { installed: [], userExtensionsDir: null }))
      .rejects.toThrow(/damaged or modified: project.json/);
    expect(fs.readdirSync(path.join(tmp, 'dest'))).toEqual([]);
  });

  it('accepts a plain zip of a project folder', async () => {
    const project = makeProject();
    await writeZipFile(path.join(tmp, 'plain.zip'), [
      { name: 'My App/project.json', file: path.join(project, 'project.json') },
      { name: 'My App/Scenes/s1.json', file: path.join(project, 'Scenes/s1.json') },
    ]);
    expect(await peekPackageKind(path.join(tmp, 'plain.zip'))).toBe('project');
    const r = await importProject(path.join(tmp, 'plain.zip'), path.join(tmp, 'dest'), { installed: [], userExtensionsDir: null });
    expect(listFiles(r.projectPath)).toEqual(['Scenes/s1.json', 'project.json']);
  });

  it('tells extension packages apart', async () => {
    const ext = makeExtension('1.0.0');
    const packed = await packExtension(ext.dir, path.join(tmp, 'e.arsist'));
    expect(await peekPackageKind(packed.file)).toBe('extension');
    expect(await peekPackageKind(path.join(tmp, 'nothing.arsist'))).toBeNull();
  });
});
