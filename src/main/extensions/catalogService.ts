/**
 * エディタ (Electron main) から見た拡張機能の一覧。
 *
 * 探す場所は ExtensionCatalog.extensionRoots と同じ 4 か所。リポジトリの場所は
 * AdapterManager と同じ探し方をする (開発中は作業ツリー、パッケージ版は resources/)。
 * 一覧は数秒だけ覚えておく (画面を開くたびにディスクを舐めないように)。
 * 拡張機能のフォルダを足したり書き換えたりしたら、その数秒後には反映される。
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { extensionRoots, loadExtensionCatalog, type ExtensionCatalog } from './ExtensionCatalog';

const CACHE_MS = 2000;

let userDir: string | null = null;
let linkedSource: () => string[] = () => [];
let cached: { at: number; catalog: ExtensionCatalog } | null = null;

/** <ユーザーデータ>/extensions。main.ts が app の準備ができたら設定する。 */
export function setUserExtensionsDir(dir: string | null): void {
  userDir = dir;
  cached = null;
}

export function getUserExtensionsDir(): string | null {
  return userDir;
}

/**
 * 登録したフォルダ (コピーせずに使う拡張機能) の読み出し方。エディタは electron-store、MCP サーバーや
 * scripts/ は config.json を直接読む (linkedFolders.ts)。一覧を作るたびに読むので、別のプロセスが
 * 登録を変えても数秒で反映される。
 */
export function setLinkedFoldersSource(source: () => string[]): void {
  linkedSource = source;
  cached = null;
}

export function getLinkedFolders(): string[] {
  try {
    return linkedSource();
  } catch {
    return [];
  }
}

/** Extensions/ を持つリポジトリ (またはパッケージの resources) を探す。 */
export function findExtensionsRepoRoot(): string | null {
  const candidates = [
    process.cwd(),
    path.join(__dirname, '../../..'),
    path.join(__dirname, '../../../..'),
  ];
  for (const root of candidates) {
    try {
      if (fs.pathExistsSync(path.join(root, 'Extensions'))) return root;
    } catch {
      // ignore
    }
  }
  return null;
}

export async function getExtensionCatalog(force = false): Promise<ExtensionCatalog> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.catalog;
  const catalog = await loadExtensionCatalog(extensionRoots({
    repoRoot: findExtensionsRepoRoot(),
    resourcesPath: process.resourcesPath ?? null,
    userDir,
    linked: getLinkedFolders(),
  }));
  cached = { at: Date.now(), catalog };
  return catalog;
}

/** 入れた / 消した直後に呼ぶ (覚えている一覧を捨てる)。 */
export function invalidateExtensionCatalog(): void {
  cached = null;
}
