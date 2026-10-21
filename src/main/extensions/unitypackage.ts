/**
 * .unitypackage を Unity を起動せずに展開する。
 *
 * .unitypackage は tar.gz で、アセット 1 つにつき <guid>/pathname (置き場所)・<guid>/asset (中身)・
 * <guid>/asset.meta (GUID を含む .meta) が入っている。Unity のインポートがやることは「pathname の場所に
 * asset と .meta を置く」だけなので、ここで同じことをする。こうすると
 *   - 何を置いたかが正確に分かる (拡張機能が外れたときに、置いたものだけを消せる)
 *   - Unity をもう 1 回起動しなくてよい (インポートだけで数分かかる)
 *
 * 置き場所は Assets/ か Packages/ の中だけを受け付ける (外に書く .unitypackage は拒む)。
 */
import fs from 'fs-extra';
import path from 'path';
import zlib from 'zlib';

export interface UnityPackageEntry {
  /** "Packages/com.vrmc.vrm/Runtime/Foo.cs" のような、Unity プロジェクトからの相対パス */
  path: string;
  /** 中身。無ければフォルダ */
  asset?: Buffer;
  meta?: Buffer;
}

function readString(block: Buffer, start: number, length: number): string {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? raw.length : end).toString('utf8');
}

/** tar のファイル (名前 → 中身)。フォルダ・リンクは飛ばす。 */
export function readTar(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(readString(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = readString(header, 345, 155);
    let name = readString(header, 0, 100);
    if (prefix) name = `${prefix}/${name}`;
    const data = buf.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === 'L') { longName = data.toString('utf8').replace(/\0+$/, ''); continue; }
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      paxPath = m ? m[1] : null;
      continue;
    }
    if (type === 'g') continue;
    const full = paxPath ?? longName ?? name;
    longName = null;
    paxPath = null;
    if (type !== '0' && type !== '\0' && type !== '7') continue;
    files.set(full.replace(/^\.\//, ''), Buffer.from(data));
  }
  return files;
}

/** Unity プロジェクトの中に収まる置き場所か。収まらなければ null。 */
export function safeAssetPath(raw: string): string | null {
  const first = raw.split('\n')[0].replace(/\r$/, '').trim().replace(/\\/g, '/');
  if (!first || first.startsWith('/') || /^[A-Za-z]:/.test(first)) return null;
  const parts = first.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  if (parts[0] !== 'Assets' && parts[0] !== 'Packages') return null;
  return parts.join('/');
}

/** .unitypackage の中身。置き場所が外に出るものがあれば例外。 */
export function readUnityPackage(gz: Buffer): UnityPackageEntry[] {
  const files = readTar(zlib.gunzipSync(gz));
  const byGuid = new Map<string, Partial<Record<'pathname' | 'asset' | 'asset.meta', Buffer>>>();
  for (const [name, data] of files) {
    const slash = name.indexOf('/');
    if (slash < 0) continue;
    const guid = name.slice(0, slash);
    const part = name.slice(slash + 1);
    if (part !== 'pathname' && part !== 'asset' && part !== 'asset.meta') continue;
    byGuid.set(guid, { ...(byGuid.get(guid) ?? {}), [part]: data });
  }
  const entries: UnityPackageEntry[] = [];
  for (const [guid, parts] of byGuid) {
    if (!parts.pathname) continue;
    const where = safeAssetPath(parts.pathname.toString('utf8'));
    if (!where) throw new Error(`unitypackage entry ${guid} would be written outside Assets/ and Packages/: ${parts.pathname.toString('utf8').split('\n')[0]}`);
    entries.push({ path: where, asset: parts.asset, meta: parts['asset.meta'] });
  }
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** 展開したときに置かれるファイル (.meta 込み) とフォルダ。 */
export function unityPackageLayout(entries: UnityPackageEntry[]): { files: string[]; dirs: string[] } {
  const files = new Set<string>();
  const dirs = new Set<string>();
  for (const e of entries) {
    if (e.asset) files.add(e.path);
    else dirs.add(e.path);
    if (e.meta) files.add(`${e.path}.meta`);
    // 親フォルダ (Packages/ と Assets/ 自体は除く)
    const parts = e.path.split('/');
    for (let i = 2; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return { files: [...files].sort(), dirs: [...dirs].sort() };
}

/**
 * 展開する。中身が同じファイルは書かない (mtime が変わると Unity が再インポート・再コンパイルする)。
 * @returns 書いたファイルの数
 */
export async function extractUnityPackage(entries: UnityPackageEntry[], projectRoot: string): Promise<number> {
  let written = 0;
  const put = async (rel: string, data: Buffer) => {
    const dest = path.join(projectRoot, ...rel.split('/'));
    const current = await fs.readFile(dest).catch(() => null);
    if (current && current.equals(data)) return;
    await fs.ensureDir(path.dirname(dest));
    await fs.writeFile(dest, data);
    written++;
  };
  for (const e of entries) {
    if (e.asset) await put(e.path, e.asset);
    else await fs.ensureDir(path.join(projectRoot, ...e.path.split('/')));
    if (e.meta) await put(`${e.path}.meta`, e.meta);
  }
  return written;
}

/**
 * 展開したものを消す。keep にあるもの (今回も別のパッケージが置くもの) は残す。
 * フォルダは空になったときだけ消す (利用者が足したファイルは消さない)。
 */
export async function removeUnityPackageFiles(
  layout: { files: string[]; dirs: string[] },
  projectRoot: string,
  keep: Set<string> = new Set(),
): Promise<number> {
  let removed = 0;
  for (const rel of layout.files) {
    if (keep.has(rel)) continue;
    const p = path.join(projectRoot, ...rel.split('/'));
    if (await fs.pathExists(p)) { await fs.remove(p); removed++; }
  }
  const dirs = [...layout.dirs].sort((a, b) => b.split('/').length - a.split('/').length);
  for (const rel of dirs) {
    if (keep.has(rel)) continue;
    const p = path.join(projectRoot, ...rel.split('/'));
    const left = await fs.readdir(p).catch(() => null);
    if (left && left.length === 0) {
      await fs.remove(p);
      if (!keep.has(`${rel}.meta`)) await fs.remove(`${p}.meta`).catch(() => {});
    }
  }
  return removed;
}
