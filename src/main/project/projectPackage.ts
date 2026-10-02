/**
 * プロジェクトの書き出し / 読み込み (`.arsist`、kind: "project")。
 *
 * 入れ物は拡張機能の `.arsist` と同じ zip (src/main/extensions/zip.ts):
 *   arsist-package.json   { format: 1, kind: "project", name, irVersion, targetDevice, createdAt,
 *                           files: { "<path>": "<sha256>" }, extensions: [{ id, version, bundled }] }
 *   project.json / Scenes/ / UI/ / Scripts/ / Assets/ …   プロジェクトのファイル
 *   _extensions/<id>/…    プロジェクトが使う拡張機能 (受け取った人のエディタに無ければ入れられるように)
 *
 * 入れないもの: ビルドの成果物・作業用の Unity プロジェクト・バックアップ・隠しファイル (EXCLUDE)。
 * 読み込みは、一時フォルダに展開 → 全ファイルのハッシュを確かめる → 置き場所に移す、の順で、
 * 途中で失敗しても置き場所には何も残さない。開くときの確認 (足りない拡張機能・端末) はエディタが行う。
 */
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs-extra';
import { openZipFile, writeZipFile, ZipFormatError, type ZipFileInput } from '../extensions/zip';
import { collectExtensionFiles, installExtension, compareVersions, safeEntryPath, PACKAGE_META, type InstallResult } from '../extensions/packages';
import { findAdapterProvider } from '../../shared/extensions';
import { readIrVersion } from '../../shared/irVersion';
import type { InstalledExtension } from '../extensions/ExtensionCatalog';

const EXTENSIONS_PREFIX = '_extensions/';

/** プロジェクトの中で、配らないもの (フォルダ名・ファイル名・拡張子) */
const EXCLUDE_DIRS = new Set(['Build', 'Backups', 'TempUnityProject', 'Library', 'Temp', 'obj', 'node_modules', '.git', '.svn']);
const EXCLUDE_EXT = new Set(['.apk', '.aab', '.arsist', '.log']);

export interface ProjectPackageMeta {
  format: 1;
  kind: 'project';
  name: string;
  id?: string;
  irVersion: number;
  targetDevice?: string;
  createdAt: string;
  files: Record<string, string>;
  extensions: Array<{ id: string; version: string; bundled: boolean }>;
}

async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** プロジェクトの中で配るファイル (相対パス、`/` 区切り)。 */
export async function collectProjectFiles(projectDir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string) => {
    for (const entry of (await fs.readdir(path.join(projectDir, rel), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name.includes('.tmp-')) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await walk(child);
      } else if (entry.isFile() && !EXCLUDE_EXT.has(path.extname(entry.name).toLowerCase())) {
        out.push(child);
      }
    }
  };
  await walk('');
  return out;
}

/** プロジェクトが使う拡張機能 (有効にしたもの + 端末を提供しているもの)。 */
export function extensionsUsedBy(project: Record<string, any>, installed: InstalledExtension[]): InstalledExtension[] {
  const ids = new Set(Object.entries(project.extensions ?? {}).filter(([, st]: [string, any]) => st?.enabled).map(([id]) => id));
  const provider = project.targetDevice ? findAdapterProvider(installed.map((e) => e.manifest), project.targetDevice) : null;
  if (provider) ids.add(provider.manifest.id);
  return installed.filter((e) => ids.has(e.manifest.id));
}

export async function exportProject(
  projectDir: string,
  outFile: string,
  options: { installed: InstalledExtension[]; bundleExtensions?: boolean },
): Promise<{ file: string; files: number; bytes: number; extensions: ProjectPackageMeta['extensions'] }> {
  const projectFile = path.join(projectDir, 'project.json');
  if (!await fs.pathExists(projectFile)) throw new Error(`${projectDir} has no project.json`);
  const project = await fs.readJSON(projectFile);

  const names = await collectProjectFiles(projectDir);
  const entries: ZipFileInput[] = [];
  const files: Record<string, string> = {};
  for (const name of names) {
    const file = path.join(projectDir, ...name.split('/'));
    files[name] = await sha256File(file);
    entries.push({ name, file });
  }

  const used = extensionsUsedBy(project, options.installed);
  const extensions: ProjectPackageMeta['extensions'] = [];
  for (const ext of used) {
    const bundle = options.bundleExtensions !== false;
    extensions.push({ id: ext.manifest.id, version: ext.manifest.version, bundled: bundle });
    if (!bundle) continue;
    for (const rel of await collectExtensionFiles(ext.dir)) {
      const name = `${EXTENSIONS_PREFIX}${ext.manifest.id}/${rel}`;
      const file = path.join(ext.dir, ...rel.split('/'));
      files[name] = await sha256File(file);
      entries.push({ name, file });
    }
  }

  const meta: ProjectPackageMeta = {
    format: 1,
    kind: 'project',
    name: String(project.name ?? path.basename(projectDir)),
    id: project.id,
    irVersion: readIrVersion(project),
    targetDevice: project.targetDevice,
    createdAt: new Date().toISOString(),
    files,
    extensions,
  };
  await fs.ensureDir(path.dirname(outFile));
  const tmp = `${outFile}.tmp-${process.pid}`;
  try {
    const bytes = await writeZipFile(tmp, [{ name: PACKAGE_META, data: Buffer.from(JSON.stringify(meta, null, 2)) }, ...entries]);
    await fs.move(tmp, outFile, { overwrite: true });
    return { file: outFile, files: names.length, bytes, extensions };
  } catch (e) {
    await fs.remove(tmp).catch(() => {});
    throw e;
  }
}

/** `.arsist` の中身の種類 (拡張機能かプロジェクトか)。読めなければ null。 */
export async function peekPackageKind(file: string): Promise<'extension' | 'project' | null> {
  try {
    const entries = await openZipFile(file);
    const meta = entries.find((e) => e.name === PACKAGE_META);
    if (meta) {
      const kind = JSON.parse((await meta.read()).toString('utf8'))?.kind;
      return kind === 'project' || kind === 'extension' ? kind : null;
    }
    if (entries.some((e) => /(^|\/)extension\.json$/.test(e.name))) return 'extension';
    if (entries.some((e) => /(^|\/)project\.json$/.test(e.name))) return 'project';
    return null;
  } catch {
    return null;
  }
}

export interface ImportedExtension {
  id: string;
  version: string;
  /** installed: 入れた / kept: 同じか新しい版が入っている / needsConfirm: 入っているものより新しい (確認して入れる) / failed */
  action: 'installed' | 'kept' | 'needsConfirm' | 'failed';
  installedVersion?: string;
  message?: string;
  /** needsConfirm のとき、入れ直すための一時フォルダ (installExtension に force で渡す) */
  stagedDir?: string;
}

export interface ImportResult {
  projectPath: string;
  name: string;
  files: number;
  extensions: ImportedExtension[];
}

function safeFolderName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 80);
  return cleaned || 'ArsistProject';
}

/**
 * `.arsist` (kind: project) を destParent/<名前> に展開する。名前が使われていれば (2), (3) … を付ける。
 * 入っている拡張機能は、無ければ userExtensionsDir に入れる。入っているものより新しければ、確認用に残す。
 */
export async function importProject(
  file: string,
  destParent: string,
  options: { installed: InstalledExtension[]; userExtensionsDir: string | null; stagingRoot?: string },
): Promise<ImportResult> {
  let entries;
  try {
    entries = await openZipFile(file);
  } catch (e) {
    throw new Error(e instanceof ZipFormatError ? e.message : `cannot read ${path.basename(file)}: ${(e as Error).message}`);
  }
  const metaEntry = entries.find((e) => e.name === PACKAGE_META);
  let meta: ProjectPackageMeta | null = null;
  if (metaEntry) {
    meta = JSON.parse((await metaEntry.read()).toString('utf8'));
    if (meta?.kind !== 'project') throw new Error(`${path.basename(file)} is not a project package (kind ${meta?.kind}); import it as an extension`);
  }

  // フォルダを丸ごと zip にしたもの (メタ無し) も受け付ける: project.json が直下か 1 段下
  let root = '';
  if (!meta) {
    const pj = entries.find((e) => /(^|\/)project\.json$/.test(e.name) && e.name.split('/').length <= 2);
    if (!pj) throw new Error('no project.json in the package');
    root = pj.name.includes('/') ? `${pj.name.split('/')[0]}/` : '';
  }

  const stagingRoot = options.stagingRoot ?? destParent;
  await fs.ensureDir(stagingRoot);
  const stage = path.join(stagingRoot, `.arsist-import-${process.pid}-${Date.now()}`);
  await fs.ensureDir(stage);
  const problems: string[] = [];
  try {
    let count = 0;
    for (const entry of entries) {
      if (entry.isDirectory || entry.name === PACKAGE_META) continue;
      if (!entry.name.startsWith(root)) continue;
      const rel = safeEntryPath(entry.name.slice(root.length));
      if (!rel) { problems.push(`unsafe path in the package: ${entry.name}`); continue; }
      if (entry.isSymlink) { problems.push(`symbolic links are not allowed: ${entry.name}`); continue; }
      const dest = path.join(stage, ...rel.split('/'));
      await fs.ensureDir(path.dirname(dest));
      try {
        await entry.extractTo(dest);
      } catch (e) {
        problems.push((e as Error).message);
        continue;
      }
      if (meta) {
        const expected = meta.files?.[rel];
        if (!expected) problems.push(`not listed in ${PACKAGE_META}: ${rel}`);
        else if (await sha256File(dest) !== expected) problems.push(`damaged or modified: ${rel}`);
      }
      if (!rel.startsWith(EXTENSIONS_PREFIX)) count++;
    }
    if (meta) {
      for (const name of Object.keys(meta.files ?? {})) {
        if (!await fs.pathExists(path.join(stage, ...name.split('/')))) problems.push(`missing from the package: ${name}`);
      }
    }
    if (problems.length > 0) throw new Error(`the package cannot be imported:\n- ${problems.slice(0, 20).join('\n- ')}`);
    if (!await fs.pathExists(path.join(stage, 'project.json'))) throw new Error('no project.json in the package');

    const project = await fs.readJSON(path.join(stage, 'project.json'));
    const name = safeFolderName(meta?.name ?? project.name ?? path.basename(file, path.extname(file)));
    let dest = path.join(destParent, name);
    for (let i = 2; await fs.pathExists(dest); i++) dest = path.join(destParent, `${name} (${i})`);

    // 拡張機能は、プロジェクトの外 (ユーザーの拡張機能の置き場) へ
    const extensions: ImportedExtension[] = [];
    const bundledRoot = path.join(stage, '_extensions');
    if (await fs.pathExists(bundledRoot)) {
      for (const id of (await fs.readdir(bundledRoot)).sort()) {
        const dir = path.join(bundledRoot, id);
        const current = options.installed.find((e) => e.manifest.id === id);
        let version = '?';
        try { version = (await fs.readJSON(path.join(dir, 'extension.json'))).version ?? '?'; } catch { /* 下で install が理由を出す */ }
        if (current && compareVersions(current.manifest.version, version) >= 0) {
          extensions.push({ id, version, action: 'kept', installedVersion: current.manifest.version });
          continue;
        }
        if (!options.userExtensionsDir) {
          extensions.push({ id, version, action: 'failed', message: 'no folder for user extensions' });
          continue;
        }
        if (current) {
          // 入っているものより新しい: 勝手に入れ替えず、確認できるように残す
          const keep = path.join(stagingRoot, `.arsist-ext-${id}-${Date.now()}`);
          await fs.move(dir, keep);
          extensions.push({ id, version, action: 'needsConfirm', installedVersion: current.manifest.version, stagedDir: keep });
          continue;
        }
        const r: InstallResult = await installExtension(dir, options.userExtensionsDir);
        extensions.push(r.ok
          ? { id, version, action: 'installed' }
          : { id, version, action: 'failed', message: [r.error, ...(r.problems ?? [])].join('; ') });
      }
      await fs.remove(bundledRoot);
    }

    await fs.move(stage, dest);
    return { projectPath: dest, name: path.basename(dest), files: count, extensions };
  } finally {
    await fs.remove(stage).catch(() => {});
  }
}
