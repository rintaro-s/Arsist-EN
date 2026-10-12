/**
 * 登録したフォルダ (コピーせずに使う拡張機能) の一覧の読み書き。
 *
 * 置き場は electron-store の config.json の extensionFolders。エディタ以外 (MCP サーバー・
 * scripts/ext-tools.mjs・scripts/run-unity-build.js) も同じ一覧を見るので、ファイルを直接読み書きする
 * 関数もここに置く。書くときは他のキーに触れず、一時ファイル + rename で置き換える。
 */
import * as path from 'path';
import * as fs from 'fs-extra';

export const LINKED_FOLDERS_KEY = 'extensionFolders';

/** 設定の値を、絶対パスの重複の無い一覧にする (壊れた値は捨てる)。 */
export function normalizeLinkedFolders(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || !v.trim() || !path.isAbsolute(v)) continue;
    const dir = path.resolve(v);
    if (seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out;
}

export function readLinkedFoldersFile(configFile: string): string[] {
  try {
    return normalizeLinkedFolders(fs.readJSONSync(configFile)?.[LINKED_FOLDERS_KEY]);
  } catch {
    return [];
  }
}

/** config.json の extensionFolders だけを書き換える。読めない config.json には書かない。 */
export async function writeLinkedFoldersFile(configFile: string, folders: string[]): Promise<void> {
  let data: Record<string, unknown> = {};
  if (await fs.pathExists(configFile)) {
    try {
      data = await fs.readJSON(configFile);
    } catch (e) {
      throw new Error(`${configFile} is not valid JSON; not touching it (${(e as Error).message})`);
    }
  }
  data[LINKED_FOLDERS_KEY] = normalizeLinkedFolders(folders);
  await fs.ensureDir(path.dirname(configFile));
  const tmp = `${configFile}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, '\t'), 'utf8');
  await fs.rename(tmp, configFile);
}

/**
 * 登録してよいフォルダか: それ自体が拡張機能 (extension.json がある) か、
 * 直下に拡張機能のフォルダが 1 つ以上ある。
 */
export async function checkLinkableFolder(dir: string): Promise<{ ok: boolean; error?: string; ids?: string[] }> {
  if (!path.isAbsolute(dir) || !await fs.pathExists(dir)) return { ok: false, error: `${dir} does not exist` };
  if (!(await fs.stat(dir)).isDirectory()) return { ok: false, error: `${dir} is not a folder` };
  if (await fs.pathExists(path.join(dir, 'extension.json'))) return { ok: true, ids: [path.basename(dir)] };
  const ids: string[] = [];
  for (const name of await fs.readdir(dir)) {
    if (name.startsWith('.') || name.startsWith('_')) continue;
    if (await fs.pathExists(path.join(dir, name, 'extension.json'))) ids.push(name);
  }
  return ids.length > 0 ? { ok: true, ids } : { ok: false, error: `${dir} has no extension.json, and no sub-folder has one` };
}
