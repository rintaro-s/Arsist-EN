import { describe, it, expect } from 'vitest';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import zlib from 'zlib';
import { extractUnityPackage, readUnityPackage, removeUnityPackageFiles, safeAssetPath, unityPackageLayout } from './unitypackage';

/** ustar のヘッダ + 中身 (512 バイト単位) */
function tarEntry(name: string, data: Buffer | string): Buffer {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, pad]);
}

function unitypackage(assets: Array<{ guid: string; path: string; asset?: string; meta?: string }>): Buffer {
  const parts: Buffer[] = [];
  for (const a of assets) {
    parts.push(tarEntry(`${a.guid}/pathname`, `${a.path}\n00`));
    if (a.asset !== undefined) parts.push(tarEntry(`${a.guid}/asset`, a.asset));
    if (a.meta !== undefined) parts.push(tarEntry(`${a.guid}/asset.meta`, a.meta));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

const PKG = unitypackage([
  { guid: 'aaa', path: 'Packages/com.example.lib', meta: 'folderAsset: yes' },
  { guid: 'bbb', path: 'Packages/com.example.lib/package.json', asset: '{"name":"com.example.lib"}', meta: 'guid: bbb' },
  { guid: 'ccc', path: 'Packages/com.example.lib/Runtime/Thing.cs', asset: 'class Thing {}', meta: 'guid: ccc' },
]);

describe('unitypackage', () => {
  it('reads where each asset goes, with its .meta', () => {
    const entries = readUnityPackage(PKG);
    expect(entries.map((e) => e.path)).toEqual([
      'Packages/com.example.lib',
      'Packages/com.example.lib/Runtime/Thing.cs',
      'Packages/com.example.lib/package.json',
    ]);
    expect(unityPackageLayout(entries)).toEqual({
      files: [
        'Packages/com.example.lib.meta',
        'Packages/com.example.lib/Runtime/Thing.cs',
        'Packages/com.example.lib/Runtime/Thing.cs.meta',
        'Packages/com.example.lib/package.json',
        'Packages/com.example.lib/package.json.meta',
      ],
      dirs: ['Packages/com.example.lib', 'Packages/com.example.lib/Runtime'],
    });
  });

  it('refuses a package that writes outside Assets/ and Packages/', () => {
    expect(safeAssetPath('Assets/X.cs')).toBe('Assets/X.cs');
    expect(safeAssetPath('ProjectSettings/ProjectSettings.asset')).toBeNull();
    expect(safeAssetPath('Assets/../../etc/passwd')).toBeNull();
    expect(safeAssetPath('/etc/passwd')).toBeNull();
    expect(() => readUnityPackage(unitypackage([{ guid: 'x', path: 'Assets/../../evil.cs', asset: 'x' }]))).toThrow(/outside/);
  });

  it('extracts, leaves unchanged files alone, and removes only what it placed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arsist-unitypackage-'));
    try {
      const entries = readUnityPackage(PKG);
      expect(await extractUnityPackage(entries, root)).toBe(5);
      expect(await fs.readFile(path.join(root, 'Packages/com.example.lib/Runtime/Thing.cs'), 'utf8')).toBe('class Thing {}');
      expect(await extractUnityPackage(entries, root)).toBe(0);

      // 利用者が足したファイルのあるフォルダは消さない。keep にあるものも残す
      await fs.writeFile(path.join(root, 'Packages/com.example.lib/Runtime/Mine.cs'), '// mine');
      const layout = unityPackageLayout(entries);
      const removed = await removeUnityPackageFiles(layout, root, new Set(['Packages/com.example.lib/package.json']));
      expect(removed).toBe(4);
      expect(await fs.pathExists(path.join(root, 'Packages/com.example.lib/package.json'))).toBe(true);
      expect(await fs.pathExists(path.join(root, 'Packages/com.example.lib/Runtime/Mine.cs'))).toBe(true);
      expect(await fs.pathExists(path.join(root, 'Packages/com.example.lib/Runtime/Thing.cs'))).toBe(false);

      await fs.remove(path.join(root, 'Packages/com.example.lib/Runtime/Mine.cs'));
      await removeUnityPackageFiles(layout, root);
      expect(await fs.readdir(path.join(root, 'Packages'))).toEqual([]);
    } finally {
      await fs.remove(root);
    }
  });

  it('reads the VRM 1.0 package the official vrm10 extension carries', () => {
    const file = path.resolve(__dirname, '../../../Extensions/vrm10/Packages/VRM-0.131.3_011b.unitypackage');
    const layout = unityPackageLayout(readUnityPackage(fs.readFileSync(file)));
    expect(layout.dirs.filter((d) => d.split('/').length === 2)).toEqual(['Packages/com.vrmc.gltf', 'Packages/com.vrmc.vrm']);
    expect(layout.files).toContain('Packages/com.vrmc.vrm/Runtime/IO/Vrm10.cs');
  });
});
