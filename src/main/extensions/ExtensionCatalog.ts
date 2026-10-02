/**
 * 入っている拡張機能を探して、extension.json を確かめる。
 *
 * 探す場所 (後に書いたものほど優先。同じ id があれば後のものが勝つ):
 *   1. <リポジトリ>/Extensions            開発中・エンジンに同梱するもの
 *   2. <resources>/Extensions             パッケージ版に同梱したもの (electron-builder の extraResources)
 *   3. <ユーザーデータ>/extensions        ユーザーが自分で置いたもの (同梱のものを差し替えて更新できる)
 *
 * 形の崩れた拡張機能は一覧に入れず、problems に理由を積む (エディタとビルドログに出す)。
 * 半端な拡張機能を通すと、壊れ方が実機でしか分からないため。
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { isLocalPackageRef, validateExtensionManifest, type ExtensionManifest } from '../../shared/extensions';

export interface InstalledExtension {
  manifest: ExtensionManifest;
  /** 拡張機能のフォルダ (extension.json のある場所) */
  dir: string;
  /** どこから来たか */
  source: 'repo' | 'bundled' | 'user';
  /** 同じ id の拡張機能を上書きしたなら、その場所 */
  overrides?: string;
}

export interface ExtensionProblem {
  dir: string;
  problems: string[];
}

export interface ExtensionCatalog {
  extensions: InstalledExtension[];
  problems: ExtensionProblem[];
  /** 探した場所 (存在しなかったものも含む) */
  searched: string[];
}

export interface ExtensionRoot {
  dir: string;
  source: InstalledExtension['source'];
}

/** 探す場所を決める。repoRoot / userDir が無ければその分は探さない。 */
export function extensionRoots(options: { repoRoot?: string | null; resourcesPath?: string | null; userDir?: string | null }): ExtensionRoot[] {
  const roots: ExtensionRoot[] = [];
  if (options.repoRoot) roots.push({ dir: path.join(options.repoRoot, 'Extensions'), source: 'repo' });
  if (options.resourcesPath) roots.push({ dir: path.join(options.resourcesPath, 'Extensions'), source: 'bundled' });
  if (options.userDir) roots.push({ dir: options.userDir, source: 'user' });
  // 同じ場所を二度読まない (開発中は repo と resources が同じことがある)
  const seen = new Set<string>();
  return roots.filter((r) => {
    const key = path.resolve(r.dir);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function loadExtensionCatalog(roots: ExtensionRoot[]): Promise<ExtensionCatalog> {
  const byId = new Map<string, InstalledExtension>();
  const problems: ExtensionProblem[] = [];

  for (const root of roots) {
    if (!await fs.pathExists(root.dir)) continue;
    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(root.dir, { withFileTypes: true });
    } catch (e) {
      problems.push({ dir: root.dir, problems: [`cannot read folder: ${(e as Error).message}`] });
      continue;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const dir = path.join(root.dir, entry.name);
      const file = path.join(dir, 'extension.json');
      if (!await fs.pathExists(file)) continue;

      let raw: unknown;
      try {
        raw = await fs.readJSON(file);
      } catch (e) {
        problems.push({ dir, problems: [`extension.json is not valid JSON: ${(e as Error).message}`] });
        continue;
      }

      const { manifest, problems: found } = validateExtensionManifest(raw, entry.name);
      const extra = manifest ? await checkFiles(manifest, dir) : [];
      if (!manifest || extra.length > 0) {
        problems.push({ dir, problems: [...found, ...extra] });
        continue;
      }

      const previous = byId.get(manifest.id);
      byId.set(manifest.id, { manifest, dir, source: root.source, overrides: previous?.dir });
    }
  }

  return {
    extensions: [...byId.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)),
    problems,
    searched: roots.map((r) => r.dir),
  };
}

/** extension.json が指しているフォルダ・クラス・アダプタ・パッケージ・上書き元が実在するか。 */
export async function checkExtensionFiles(manifest: ExtensionManifest, dir: string): Promise<string[]> {
  return checkFiles(manifest, dir);
}

async function checkFiles(manifest: ExtensionManifest, dir: string): Promise<string[]> {
  const problems: string[] = [];
  for (const adapter of manifest.provides?.adapters ?? []) {
    if (!await fs.pathExists(path.join(dir, 'Adapters', adapter, 'adapter.json'))) {
      problems.push(`provides.adapters: Adapters/${adapter}/adapter.json does not exist`);
    }
  }
  for (const [name, ref] of Object.entries(manifest.unity?.packages ?? {})) {
    if (isLocalPackageRef(ref) && !await fs.pathExists(path.join(dir, ref))) {
      problems.push(`unity.packages.${name}: ${ref} does not exist in the extension`);
    }
  }
  for (const o of manifest.unity?.overrides ?? []) {
    if (!await fs.pathExists(path.join(dir, 'Overrides', o.path))) {
      problems.push(`unity.overrides: Overrides/${o.path} does not exist in the extension`);
    }
  }
  const runtimeDir = path.join(dir, manifest.unity?.runtimeDir ?? 'Runtime');
  const entry = manifest.unity?.entry;
  if (entry) {
    if (!await fs.pathExists(runtimeDir)) {
      problems.push(`unity.entry is set but ${path.relative(dir, runtimeDir) || runtimeDir}/ does not exist`);
    } else {
      const className = entry.split('.').pop()!;
      const sources = await listCs(runtimeDir);
      let found = false;
      for (const file of sources) {
        const text = await fs.readFile(file, 'utf8');
        if (new RegExp(`class\\s+${className}\\b`).test(text)) { found = true; break; }
      }
      if (!found) problems.push(`unity.entry: class ${className} was not found under ${path.relative(dir, runtimeDir)}/`);
    }
  }
  return problems;
}

async function listCs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listCs(p));
    else if (entry.name.endsWith('.cs')) out.push(p);
  }
  return out;
}

/** ログに出す 1 行ずつの説明。 */
export function describeCatalogProblems(catalog: ExtensionCatalog): string[] {
  return catalog.problems.flatMap((p) => p.problems.map((msg) => `${p.dir}: ${msg}`));
}
