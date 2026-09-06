import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';

// UnityBuilder は electron の app を import するが、同期ロジックのテストでは使わない。
vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
    getAppPath: () => process.cwd(),
  },
}));

import { UnityBuilder } from './UnityBuilder';

/**
 * syncDirectory / removeEmptyDirs は private だが、
 * 「毎回フルコピーせずに Library/ を温存する」ビルド高速化の中核であり、
 * ファイル削除を伴うためテストで固定しておく。
 */
type SyncHarness = {
  syncDirectory(
    src: string,
    dest: string,
    options?: { prune?: 'none' | 'mirror' | 'tracked' },
  ): Promise<{ stamps: Record<string, string>; copied: number; removed: number }>;
};

let root: string;
let src: string;
let dest: string;
let builder: SyncHarness;

const write = async (base: string, rel: string, content: string) => {
  const target = path.join(base, rel);
  await fs.ensureDir(path.dirname(target));
  await fs.writeFile(target, content);
};

const exists = (base: string, rel: string) => fs.pathExists(path.join(base, rel));

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'arsist-sync-'));
  src = path.join(root, 'src');
  dest = path.join(root, 'dest');
  await fs.ensureDir(src);
  builder = new UnityBuilder('/nonexistent/unity') as unknown as SyncHarness;
});

afterEach(async () => {
  await fs.remove(root);
});

describe('syncDirectory', () => {
  it('copies everything on the first run', async () => {
    await write(src, 'a.cs', 'a');
    await write(src, 'nested/b.cs', 'b');

    const result = await builder.syncDirectory(src, dest);

    expect(result.copied).toBe(2);
    expect(await fs.readFile(path.join(dest, 'nested/b.cs'), 'utf-8')).toBe('b');
  });

  it('copies nothing when the source is unchanged (this is what keeps Library/ warm)', async () => {
    await write(src, 'a.cs', 'a');
    await write(src, 'nested/b.cs', 'b');
    await builder.syncDirectory(src, dest);

    const second = await builder.syncDirectory(src, dest);

    expect(second.copied).toBe(0);
    expect(second.removed).toBe(0);
  });

  it('re-copies only the files that actually changed', async () => {
    await write(src, 'a.cs', 'a');
    await write(src, 'b.cs', 'b');
    await builder.syncDirectory(src, dest);

    await write(src, 'b.cs', 'b-modified');
    const second = await builder.syncDirectory(src, dest);

    expect(second.copied).toBe(1);
    expect(await fs.readFile(path.join(dest, 'b.cs'), 'utf-8')).toBe('b-modified');
  });

  it('skips Unity-invisible directories (Samples~/Tools~) and VCS metadata', async () => {
    await write(src, 'Runtime/a.cs', 'a');
    await write(src, 'Samples~/big.bin', 'x');
    await write(src, 'Tools~/tool.exe', 'x');
    await write(src, '.git/config', 'x');

    const result = await builder.syncDirectory(src, dest);

    expect(result.copied).toBe(1);
    expect(await exists(dest, 'Samples~/big.bin')).toBe(false);
    expect(await exists(dest, 'Tools~/tool.exe')).toBe(false);
    expect(await exists(dest, '.git/config')).toBe(false);
  });

  it('leaves generated files alone when prune is "none"', async () => {
    await write(src, 'a.cs', 'a');
    await builder.syncDirectory(src, dest);
    await write(dest, 'Generated/manifest.json', '{}');

    const second = await builder.syncDirectory(src, dest);

    expect(second.removed).toBe(0);
    expect(await exists(dest, 'Generated/manifest.json')).toBe(true);
  });

  it('mirror prune removes files that disappeared from the source', async () => {
    await write(src, 'keep.cs', 'k');
    await write(src, 'gone.cs', 'g');
    await builder.syncDirectory(src, dest, { prune: 'mirror' });

    await fs.remove(path.join(src, 'gone.cs'));
    const second = await builder.syncDirectory(src, dest, { prune: 'mirror' });

    expect(second.removed).toBe(1);
    expect(await exists(dest, 'gone.cs')).toBe(false);
    expect(await exists(dest, 'keep.cs')).toBe(true);
  });

  it('mirror prune keeps Unity-generated .meta while its asset still exists', async () => {
    await write(src, 'Models/model.glb', 'glb');
    await builder.syncDirectory(src, dest, { prune: 'mirror' });
    // Unity が生成する .meta（ファイル用とフォルダ用）を模す
    await write(dest, 'Models/model.glb.meta', 'guid: 1');
    await write(dest, 'Models.meta', 'guid: 2');

    const second = await builder.syncDirectory(src, dest, { prune: 'mirror' });

    expect(second.removed).toBe(0);
    expect(await exists(dest, 'Models/model.glb.meta')).toBe(true);
    expect(await exists(dest, 'Models.meta')).toBe(true);
  });

  it('mirror prune drops an orphaned .meta once its asset is gone', async () => {
    await write(src, 'Models/model.glb', 'glb');
    await builder.syncDirectory(src, dest, { prune: 'mirror' });
    await write(dest, 'Models/model.glb.meta', 'guid: 1');

    await fs.remove(path.join(src, 'Models/model.glb'));
    const second = await builder.syncDirectory(src, dest, { prune: 'mirror' });

    expect(await exists(dest, 'Models/model.glb.meta')).toBe(false);
    // 空になった中間ディレクトリも掃除されるが、同期先そのものは残る
    expect(await exists(dest, 'Models')).toBe(false);
    expect(await fs.pathExists(dest)).toBe(true);
    expect(second.removed).toBeGreaterThan(0);
  });

  it('tracked prune only removes previously-synced files, never generated ones', async () => {
    await write(src, 'a.cs', 'a');
    await write(src, 'b.cs', 'b');
    await builder.syncDirectory(src, dest, { prune: 'tracked' });
    await write(dest, 'Generated/scene.unity', 'scene');

    await fs.remove(path.join(src, 'b.cs'));
    const second = await builder.syncDirectory(src, dest, { prune: 'tracked' });

    expect(await exists(dest, 'b.cs')).toBe(false);
    expect(await exists(dest, 'Generated/scene.unity')).toBe(true);
    expect(second.removed).toBe(1);
  });

  it('never writes into the source directory', async () => {
    await write(src, 'a.cs', 'a');
    await builder.syncDirectory(src, dest, { prune: 'mirror' });
    await write(dest, 'only-in-dest.cs', 'x');

    await builder.syncDirectory(src, dest, { prune: 'mirror' });

    expect(await exists(src, 'only-in-dest.cs')).toBe(false);
    expect((await fs.readdir(src)).sort()).toEqual(['a.cs']);
  });
});
