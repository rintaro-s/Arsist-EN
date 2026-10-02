import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { crc32, readZip, writeZip } from './zip';
import { compareVersions, installExtension, packExtension, safeEntryPath, uninstallExtension, PACKAGE_META } from './packages';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arsist-pkg-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function makeExtension(root: string, id = 'demo-thing', version = '1.0.0', extra: Record<string, unknown> = {}): string {
  const dir = path.join(root, id);
  fs.mkdirSync(path.join(dir, 'Runtime'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'extension.json'), JSON.stringify({
    id, version, name: { en: 'Demo', ja: 'デモ' }, description: { en: 'Demo', ja: 'デモ' },
    unity: { entry: 'Arsist.Extensions.DemoThing.DemoThingExtension' },
    ...extra,
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'Runtime', 'DemoThingExtension.cs'), 'namespace Arsist.Extensions.DemoThing { public class DemoThingExtension {} }');
  fs.writeFileSync(path.join(dir, 'README.md'), '# デモ\n');
  fs.writeFileSync(path.join(dir, '.DS_Store'), 'junk');
  return dir;
}

describe('zip', () => {
  it('round-trips files, compressed or stored', () => {
    const big = Buffer.from('あいう'.repeat(5000));
    const tiny = Buffer.from([1, 2, 3]);
    const zip = writeZip([{ name: 'a/b.txt', data: big }, { name: 'c.bin', data: tiny }, { name: 'empty', data: Buffer.alloc(0) }]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['a/b.txt', 'c.bin', 'empty']);
    expect(entries[0].read().equals(big)).toBe(true);
    expect(entries[0].compressedSize).toBeLessThan(big.length);
    expect(entries[1].read().equals(tiny)).toBe(true);
    expect(entries[2].read().length).toBe(0);
    // 同じ中身なら同じバイト列 (日時を固定している)
    expect(writeZip([{ name: 'a/b.txt', data: big }, { name: 'c.bin', data: tiny }, { name: 'empty', data: Buffer.alloc(0) }]).equals(zip)).toBe(true);
  });

  it('crc32 matches the standard value and zlib\'s own', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    // gzip の末尾 8 バイトの先頭 4 バイトは、zlib が計算した CRC32
    for (const text of ['The quick brown fox', '', 'あいうえお'.repeat(100)]) {
      const data = Buffer.from(text);
      const gz = zlib.gzipSync(data);
      expect(crc32(data), text.slice(0, 10)).toBe(gz.readUInt32LE(gz.length - 8));
    }
  });

  it('detects damage', () => {
    const zip = writeZip([{ name: 'x.txt', data: Buffer.from('hello hello hello hello hello') }]);
    // 中身の 1 バイトを壊す (ローカルヘッダの直後)
    const broken = Buffer.from(zip);
    broken[30 + 'x.txt'.length + 2] ^= 0xff;
    expect(() => readZip(broken)[0].read()).toThrow();
    expect(() => readZip(Buffer.from('not a zip at all, definitely not'))).toThrow(/not a zip/);
  });
});

describe('extension packages', () => {
  it('rejects paths that would leave the install folder', () => {
    expect(safeEntryPath('Runtime/A.cs')).toBe('Runtime/A.cs');
    expect(safeEntryPath('./Runtime//A.cs')).toBe('Runtime/A.cs');
    expect(safeEntryPath('../evil.cs')).toBeNull();
    expect(safeEntryPath('a/../../evil')).toBeNull();
    expect(safeEntryPath('/etc/passwd')).toBeNull();
    expect(safeEntryPath('C:\\Windows\\x')).toBeNull();
  });

  it('compares versions numerically', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBe(-1);
  });

  it('packs a folder and installs the package, with every file hash checked', async () => {
    const dir = makeExtension(path.join(tmp, 'src'));
    const packed = await packExtension(dir, path.join(tmp, 'out', 'demo-thing-1.0.0.arsist'));
    expect(packed.files).toBe(3); // 隠しファイルは入らない

    const meta = JSON.parse(readZip(fs.readFileSync(packed.file)).find((e) => e.name === PACKAGE_META)!.read().toString());
    expect(meta).toMatchObject({ format: 1, kind: 'extension', id: 'demo-thing', version: '1.0.0' });
    expect(Object.keys(meta.files).sort()).toEqual(['README.md', 'Runtime/DemoThingExtension.cs', 'extension.json']);

    const userDir = path.join(tmp, 'user');
    const result = await installExtension(packed.file, userDir);
    expect(result).toMatchObject({ ok: true, id: 'demo-thing', version: '1.0.0', from: 'package' });
    expect(fs.readFileSync(path.join(userDir, 'demo-thing', 'README.md'), 'utf8')).toBe('# デモ\n');
    // 一時フォルダは残らない
    expect(fs.readdirSync(userDir)).toEqual(['demo-thing']);
  });

  it('refuses a package whose files were changed after packing', async () => {
    const dir = makeExtension(path.join(tmp, 'src'));
    const packed = await packExtension(dir, path.join(tmp, 'p.arsist'));
    const entries = readZip(fs.readFileSync(packed.file)).map((e) => ({ name: e.name, data: e.read() }));
    const tampered = entries.map((e) => e.name === 'Runtime/DemoThingExtension.cs' ? { ...e, data: Buffer.from('// evil') } : e);
    fs.writeFileSync(path.join(tmp, 't.arsist'), writeZip(tampered));
    const result = await installExtension(path.join(tmp, 't.arsist'), path.join(tmp, 'user'));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems).toEqual(['damaged or modified: Runtime/DemoThingExtension.cs']);
    expect(fs.existsSync(path.join(tmp, 'user', 'demo-thing'))).toBe(false);
  });

  it('refuses a package that tries to write outside the install folder', async () => {
    const zip = writeZip([
      { name: 'extension.json', data: Buffer.from('{}') },
      { name: '../../outside.txt', data: Buffer.from('x') },
    ]);
    fs.writeFileSync(path.join(tmp, 'evil.arsist'), zip);
    const result = await installExtension(path.join(tmp, 'evil.arsist'), path.join(tmp, 'user'));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems?.[0]).toMatch(/unsafe path/);
    expect(fs.existsSync(path.join(tmp, 'outside.txt'))).toBe(false);
  });

  it('installs straight from a folder, and accepts a hand-made zip of the folder', async () => {
    const dir = makeExtension(path.join(tmp, 'src'));
    const fromFolder = await installExtension(dir, path.join(tmp, 'user1'));
    expect(fromFolder).toMatchObject({ ok: true, from: 'folder' });
    expect(fs.existsSync(path.join(tmp, 'user1', 'demo-thing', '.DS_Store'))).toBe(false);

    const handMade = writeZip(['extension.json', 'Runtime/DemoThingExtension.cs', 'README.md'].map((n) => ({
      name: `demo-thing/${n}`,
      data: fs.readFileSync(path.join(dir, n)),
    })));
    fs.writeFileSync(path.join(tmp, 'hand.zip'), handMade);
    expect(await installExtension(path.join(tmp, 'hand.zip'), path.join(tmp, 'user2'))).toMatchObject({ ok: true, id: 'demo-thing' });
  });

  it('asks before replacing or downgrading, then replaces on force', async () => {
    const userDir = path.join(tmp, 'user');
    const v2 = makeExtension(path.join(tmp, 'v2'), 'demo-thing', '2.0.0');
    const v1 = makeExtension(path.join(tmp, 'v1'), 'demo-thing', '1.0.0');
    expect((await installExtension(v2, userDir)).ok).toBe(true);

    const again = await installExtension(v1, userDir);
    expect(again).toMatchObject({ ok: false, needsConfirm: { id: 'demo-thing', installed: '2.0.0', incoming: '1.0.0', downgrade: true } });
    const forced = await installExtension(v1, userDir, { force: true });
    expect(forced).toMatchObject({ ok: true, version: '1.0.0', replaced: '2.0.0' });

    // 同梱の版より古いものを入れるときも訊く
    const bundled = await installExtension(makeExtension(path.join(tmp, 'v0'), 'other-thing', '0.1.0'), path.join(tmp, 'user3'), {
      installedVersionOf: (id) => (id === 'other-thing' ? '0.5.0' : null),
    });
    expect(bundled).toMatchObject({ ok: false, needsConfirm: { downgrade: true } });
  });

  it('refuses an invalid extension and leaves nothing behind', async () => {
    const dir = makeExtension(path.join(tmp, 'src'), 'demo-thing', '1.0.0', { unity: { entry: 'Arsist.Extensions.Nope.Missing' } });
    const result = await installExtension(dir, path.join(tmp, 'user'));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems?.join(' ')).toMatch(/Missing was not found/);
    expect(fs.readdirSync(path.join(tmp, 'user'))).toEqual([]);
  });

  it('checks that a device extension ships its adapter, packages and overrides', async () => {
    const dir = makeExtension(path.join(tmp, 'src'), 'my-glasses', '1.0.0', {
      provides: { adapters: ['My_Glasses'] },
      unity: {
        entry: 'Arsist.Extensions.DemoThing.DemoThingExtension',
        packages: { 'com.vendor.sdk': 'Packages/com.vendor.sdk-1.0.0.tgz', 'com.unity.xr.something': '1.2.3' },
        overrides: [{ path: 'Runtime/Input/ArsistGazeInput.cs', replaces: 'a'.repeat(64) }],
      },
    });
    const missing = await installExtension(dir, path.join(tmp, 'user'));
    expect(missing.ok === false && missing.problems).toEqual([
      'provides.adapters: Adapters/My_Glasses/adapter.json does not exist',
      'unity.packages.com.vendor.sdk: Packages/com.vendor.sdk-1.0.0.tgz does not exist in the extension',
      'unity.overrides: Overrides/Runtime/Input/ArsistGazeInput.cs does not exist in the extension',
    ]);

    fs.mkdirSync(path.join(dir, 'Adapters', 'My_Glasses'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Adapters', 'My_Glasses', 'adapter.json'), '{"id":"my-glasses"}');
    fs.mkdirSync(path.join(dir, 'Packages'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Packages', 'com.vendor.sdk-1.0.0.tgz'), 'tgz');
    fs.mkdirSync(path.join(dir, 'Overrides', 'Runtime', 'Input'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Overrides', 'Runtime', 'Input', 'ArsistGazeInput.cs'), '// patched');
    expect(await installExtension(dir, path.join(tmp, 'user'))).toMatchObject({ ok: true, id: 'my-glasses' });
  });

  it('uninstalls only what the user installed', async () => {
    const userDir = path.join(tmp, 'user');
    await installExtension(makeExtension(path.join(tmp, 'src')), userDir);
    expect(await uninstallExtension('demo-thing', userDir)).toEqual({ ok: true });
    expect(fs.existsSync(path.join(userDir, 'demo-thing'))).toBe(false);
    expect((await uninstallExtension('demo-thing', userDir)).ok).toBe(false);
    expect((await uninstallExtension('../x', userDir)).ok).toBe(false);
  });
});
