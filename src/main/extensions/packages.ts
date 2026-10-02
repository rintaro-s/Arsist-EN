/**
 * 拡張機能の配り方: フォルダのまま / `.arsist` パッケージ。
 *
 * `.arsist` は拡張機能のフォルダを 1 つにまとめた zip:
 *   arsist-package.json   { format: 1, kind: "extension", id, version, createdAt, files: { "<path>": "<sha256>" } }
 *   extension.json
 *   Runtime/… Editor/… Adapters/… Packages/… Overrides/… README.md
 * files に全ファイルの SHA-256 が入っていて、インストールのときに 1 つずつ確かめる
 * (途中で壊れた・書き換えられたパッケージを入れない)。
 *
 * インストール先は <ユーザーデータ>/extensions/<id>。入れ方はどちらも同じ流れ:
 *   1. 一時フォルダに展開 / 写す           (既存の拡張機能にはまだ触れない)
 *   2. パスの安全性・ハッシュ・extension.json・参照しているファイルを確かめる
 *   3. 同じ id が入っていれば、版を比べて確認を求める (上書き / 古い版に戻す)
 *   4. 入れ替える (失敗したら元に戻す)
 */
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs-extra';
import { validateExtensionManifest, type ExtensionManifest } from '../../shared/extensions';
import { checkExtensionFiles } from './ExtensionCatalog';
import { readZip, writeZip, ZipFormatError } from './zip';

export const PACKAGE_EXTENSION = '.arsist';
export const PACKAGE_META = 'arsist-package.json';
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // SDK の tgz を同梱できる程度
const MAX_FILES = 20000;

export interface PackageMeta {
  format: 1;
  kind: 'extension';
  id: string;
  version: string;
  createdAt: string;
  files: Record<string, string>;
}

function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** パッケージに入れないもの: 隠しファイル・Unity の .meta・依存の山 */
function skipName(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules' || name.endsWith('.meta') || name === PACKAGE_META;
}

/** 拡張機能のフォルダの中身 (相対パス、`/` 区切り、並び順は固定)。 */
export async function collectExtensionFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string) => {
    for (const entry of (await fs.readdir(path.join(dir, rel), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (skipName(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue; // 外を指すリンクは配らない
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) out.push(child);
    }
  };
  await walk('');
  return out;
}

/** フォルダの拡張機能を確かめる (形の崩れ・参照先の欠け)。 */
export async function inspectExtensionDir(dir: string): Promise<{ manifest?: ExtensionManifest; problems: string[] }> {
  const file = path.join(dir, 'extension.json');
  if (!await fs.pathExists(file)) return { problems: [`${dir} has no extension.json`] };
  let raw: unknown;
  try {
    raw = await fs.readJSON(file);
  } catch (e) {
    return { problems: [`extension.json is not valid JSON: ${(e as Error).message}`] };
  }
  const { manifest, problems } = validateExtensionManifest(raw);
  if (!manifest) return { problems };
  const missing = await checkExtensionFiles(manifest, dir);
  return missing.length > 0 ? { problems: missing } : { manifest, problems: [] };
}

// ---- 書き出す ----------------------------------------------------------------

export async function packExtension(dir: string, outFile?: string): Promise<{ file: string; manifest: ExtensionManifest; files: number; bytes: number }> {
  const { manifest, problems } = await inspectExtensionDir(dir);
  if (!manifest) throw new Error(`cannot package ${dir}:\n- ${problems.join('\n- ')}`);
  if (path.basename(path.resolve(dir)) !== manifest.id) {
    throw new Error(`the folder name "${path.basename(dir)}" must match the extension id "${manifest.id}"`);
  }

  const names = await collectExtensionFiles(dir);
  const entries = [];
  const files: Record<string, string> = {};
  for (const name of names) {
    const data = await fs.readFile(path.join(dir, name));
    files[name] = sha256(data);
    entries.push({ name, data });
  }
  const meta: PackageMeta = {
    format: 1,
    kind: 'extension',
    id: manifest.id,
    version: manifest.version,
    createdAt: new Date().toISOString(),
    files,
  };
  const zip = writeZip([{ name: PACKAGE_META, data: Buffer.from(JSON.stringify(meta, null, 2)) }, ...entries]);
  const file = outFile ?? path.join(path.dirname(path.resolve(dir)), `${manifest.id}-${manifest.version}${PACKAGE_EXTENSION}`);
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, zip);
  return { file, manifest, files: names.length, bytes: zip.length };
}

// ---- 入れる ------------------------------------------------------------------

export type InstallResult =
  | { ok: true; id: string; version: string; path: string; replaced?: string; from: 'package' | 'folder' }
  | {
      ok: false;
      error: string;
      problems?: string[];
      /** 同じ id が入っている。force で入れ直すかを訊く */
      needsConfirm?: { id: string; installed: string; incoming: string; downgrade: boolean };
    };

/** パッケージの中のパスを、展開先の外に出ない相対パスにする。危なければ null。 */
export function safeEntryPath(name: string): string | null {
  const norm = name.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return null;
  const parts = norm.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length === 0 || parts.some((p) => p === '..')) return null;
  return parts.join('/');
}

/** `.arsist` (や、拡張機能のフォルダを丸ごと zip にしたもの) を stage に展開して確かめる。 */
async function extractPackage(file: string, stage: string): Promise<{ problems: string[]; root: string }> {
  let entries;
  try {
    entries = readZip(await fs.readFile(file));
  } catch (e) {
    return { problems: [e instanceof ZipFormatError ? e.message : `cannot read ${path.basename(file)}: ${(e as Error).message}`], root: stage };
  }
  if (entries.length > MAX_FILES) return { problems: [`too many files (${entries.length})`], root: stage };
  const total = entries.reduce((n, e) => n + e.size, 0);
  if (total > MAX_TOTAL_BYTES) return { problems: [`too large when unpacked (${Math.round(total / 1e6)} MB)`], root: stage };

  const problems: string[] = [];
  const written = new Map<string, Buffer>();
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const rel = safeEntryPath(entry.name);
    if (!rel) { problems.push(`unsafe path in the package: ${entry.name}`); continue; }
    if (entry.isSymlink) { problems.push(`symbolic links are not allowed: ${entry.name}`); continue; }
    let data: Buffer;
    try {
      data = entry.read();
    } catch (e) {
      problems.push((e as Error).message);
      continue;
    }
    written.set(rel, data);
  }
  if (problems.length > 0) return { problems, root: stage };

  // arsist-package.json があれば、全ファイルのハッシュを確かめる
  const metaRaw = written.get(PACKAGE_META);
  let root = '';
  if (metaRaw) {
    let meta: PackageMeta;
    try {
      meta = JSON.parse(metaRaw.toString('utf8'));
    } catch {
      return { problems: [`${PACKAGE_META} is not valid JSON`], root: stage };
    }
    if (meta.format !== 1 || meta.kind !== 'extension') {
      return { problems: [`not an extension package (format ${meta.format}, kind ${meta.kind})`], root: stage };
    }
    for (const [name, hash] of Object.entries(meta.files ?? {})) {
      const data = written.get(name);
      if (!data) problems.push(`missing from the package: ${name}`);
      else if (sha256(data) !== hash) problems.push(`damaged or modified: ${name}`);
    }
    for (const name of written.keys()) {
      if (name !== PACKAGE_META && !(name in (meta.files ?? {}))) problems.push(`not listed in ${PACKAGE_META}: ${name}`);
    }
    written.delete(PACKAGE_META);
  } else {
    // 手で zip にしたフォルダ: extension.json が直下か、1 段下の 1 フォルダの中にあれば受け付ける (ハッシュは無い)
    if (!written.has('extension.json')) {
      const tops = new Set([...written.keys()].map((n) => n.split('/')[0]));
      const only = tops.size === 1 ? [...tops][0] : null;
      if (only && written.has(`${only}/extension.json`)) root = only;
      else return { problems: ['no extension.json at the top of the package (and no arsist-package.json)'], root: stage };
    }
  }
  if (problems.length > 0) return { problems, root: stage };

  for (const [name, data] of written) {
    const target = path.join(stage, ...name.split('/'));
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, data);
  }
  return { problems: [], root: root ? path.join(stage, root) : stage };
}

/** 版の比較 (1.2.10 > 1.2.9)。-1 / 0 / 1 */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * `.arsist` かフォルダから拡張機能を入れる。
 * @param options.installedVersionOf 同じ id で今使われている版 (同梱のものも含む)。確認を求めるかに使う
 */
export async function installExtension(
  source: string,
  userDir: string,
  options: { force?: boolean; installedVersionOf?: (id: string) => string | null } = {},
): Promise<InstallResult> {
  if (!await fs.pathExists(source)) return { ok: false, error: `${source} does not exist` };
  const isFolder = (await fs.stat(source)).isDirectory();
  await fs.ensureDir(userDir);
  const stage = path.join(userDir, `.incoming-${process.pid}-${Date.now()}`);
  await fs.ensureDir(stage);

  try {
    let root = stage;
    if (isFolder) {
      for (const name of await collectExtensionFiles(source)) {
        await fs.copy(path.join(source, name), path.join(stage, ...name.split('/')));
      }
    } else {
      const extracted = await extractPackage(source, stage);
      if (extracted.problems.length > 0) {
        return { ok: false, error: `${path.basename(source)} cannot be installed`, problems: extracted.problems };
      }
      root = extracted.root;
    }

    const { manifest, problems } = await inspectExtensionDir(root);
    if (!manifest) return { ok: false, error: 'the extension is not valid', problems };

    const dest = path.join(userDir, manifest.id);
    if (path.resolve(source) === path.resolve(dest)) {
      return { ok: false, error: `"${manifest.id}" is already installed from this folder` };
    }

    const installed = (await readVersion(dest)) ?? options.installedVersionOf?.(manifest.id) ?? null;
    if (installed && !options.force) {
      return {
        ok: false,
        error: `"${manifest.id}" ${installed} is already installed`,
        needsConfirm: {
          id: manifest.id,
          installed,
          incoming: manifest.version,
          downgrade: compareVersions(manifest.version, installed) < 0,
        },
      };
    }

    // 入れ替え。失敗したら古い方を戻す
    const backup = (await fs.pathExists(dest)) ? `${dest}.old-${Date.now()}` : null;
    if (backup) await fs.move(dest, backup);
    try {
      await fs.move(root, dest);
    } catch (e) {
      if (backup) await fs.move(backup, dest).catch(() => {});
      throw e;
    }
    if (backup) await fs.remove(backup).catch(() => {});
    return { ok: true, id: manifest.id, version: manifest.version, path: dest, replaced: installed ?? undefined, from: isFolder ? 'folder' : 'package' };
  } finally {
    await fs.remove(stage).catch(() => {});
  }
}

async function readVersion(dir: string): Promise<string | null> {
  try {
    const raw = await fs.readJSON(path.join(dir, 'extension.json'));
    return typeof raw?.version === 'string' ? raw.version : null;
  } catch {
    return null;
  }
}

/** ユーザーが入れた拡張機能を消す (エンジン同梱のものは消せない)。 */
export async function uninstallExtension(id: string, userDir: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(id)) return { ok: false, error: `bad id "${id}"` };
  const dir = path.join(userDir, id);
  if (!await fs.pathExists(path.join(dir, 'extension.json'))) return { ok: false, error: `"${id}" is not installed in ${userDir}` };
  await fs.remove(dir);
  return { ok: true };
}
