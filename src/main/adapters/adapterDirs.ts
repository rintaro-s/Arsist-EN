/**
 * 端末アダプタの一覧 — エンジン同梱 (Adapters/) と、入っている拡張機能が足したもの (Extensions/<id>/Adapters/)。
 *
 * エディタの端末の選択肢・FOV、ビルド (UnityBuilder.resolveAdapterDir)、プロジェクトを開く前の確認
 * (ProjectManager) が、すべてここを通る。どこかだけが拡張機能の端末を知らない、を作らないため。
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { matchAdapterName } from '../../shared/adapterNames';
import { getExtensionCatalog } from '../extensions/catalogService';

export interface AdapterLocation {
  /** フォルダ名 = targetDevice */
  name: string;
  dir: string;
  source: 'builtin' | 'extension';
  /** source === 'extension' のとき、その拡張機能の id */
  extensionId?: string;
}

/** エンジン同梱の Adapters/ の場所 (パッケージ版は resources/、開発中は作業ツリー)。 */
export function findBuiltinAdaptersDir(): string | null {
  const candidates: string[] = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'Adapters'));
  candidates.push(path.join(process.cwd(), 'Adapters'));
  candidates.push(path.join(__dirname, '../../..', 'Adapters'));
  candidates.push(path.join(__dirname, '../../../..', 'Adapters'));
  for (const p of candidates) {
    try {
      if (fs.pathExistsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

async function listDirs(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries) {
      if (e.isDirectory() && await fs.pathExists(path.join(root, e.name, 'adapter.json'))) out.push(e.name);
    }
    return out.sort();
  } catch {
    return [];
  }
}

/** エンジン同梱のアダプタの名前 (= Adapters/ のフォルダ名)。 */
export async function listBuiltinAdapterNames(builtinRoot = findBuiltinAdaptersDir()): Promise<string[]> {
  return builtinRoot ? listDirs(builtinRoot) : [];
}

/** すべてのアダプタ。同じ名前なら同梱が先 (拡張機能が同梱の端末を黙って乗っ取らない)。 */
export async function listAdapterLocations(builtinRoot = findBuiltinAdaptersDir()): Promise<AdapterLocation[]> {
  const out: AdapterLocation[] = [];
  if (builtinRoot) {
    for (const name of await listDirs(builtinRoot)) out.push({ name, dir: path.join(builtinRoot, name), source: 'builtin' });
  }
  const catalog = await getExtensionCatalog();
  for (const ext of catalog.extensions) {
    for (const name of ext.manifest.provides?.adapters ?? []) {
      if (out.some((a) => a.name === name)) continue;
      out.push({ name, dir: path.join(ext.dir, 'Adapters', name), source: 'extension', extensionId: ext.manifest.id });
    }
  }
  return out;
}

/** targetDevice に当たるアダプタ (照合は src/shared/adapterNames.ts)。 */
export async function resolveAdapter(targetDevice: string, builtinRoot?: string | null): Promise<AdapterLocation | null> {
  const all = await listAdapterLocations(builtinRoot === undefined ? findBuiltinAdaptersDir() : builtinRoot);
  const hit = matchAdapterName(all.map((a) => a.name), targetDevice);
  return hit ? all.find((a) => a.name === hit) ?? null : null;
}
