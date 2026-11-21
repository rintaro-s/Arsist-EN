/**
 * Layster.Spatial のプロジェクトのファイル (doc/19-layster.md §4)。
 *
 *   <dir>/project.spatial.json      プロジェクト (唯一の正。写しは持たない)
 *   <dir>/spaces/<id>.json          プロジェクトの「試す空間」
 *   <dir>/.layster/secrets.local.json  鍵 (git に入れない。値は main から外に出さない)
 *   <dir>/Assets/{Models,Characters,Images,Audio,Animations}/
 *
 * エディタ (IPC) とエージェントの道具 (spatialTools.ts) の両方がここを通して読み書きする。
 * 守ること:
 *   - 読むときは書き換えない (足りない項目はメモリの上で補い、notices で知らせる)
 *   - 書くときは一時ファイル → rename (atomicWriteJson)。同じプロジェクトへの書き込みは 1 つずつ
 *   - 新しい Arsist で作られたファイル (版が今より新しい) は読まない・書かない
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { atomicWriteJson } from '../project/projectIO';
import { describeJsonError } from '../project/sceneCopies';
import { importAnimation, listAnimations } from '../project/animationAssets';
import { getExtensionCatalog } from '../extensions/catalogService';
import { listBuiltinAdapterNames } from '../adapters/adapterDirs';
import { checkProjectRequirements, type MissingRequirement } from '../../shared/extensions';
import { CURRENT_IR_VERSION } from '../../shared/irVersion';
import { checkSpatialAnimations, validateSpatialProject, type SpatialProblem } from '../../shared/layster/spatial/validate';
import { compareLayster, formatLayster, LAYSTER_CURRENT, readLaysterHeader, SPATIAL_PROJECT_FILE } from '../../shared/layster/version';
import { createSpatialProject, repairSpatialProject } from '../../shared/layster/spatial/defaults';
import type { SpaceFixture, SpatialProject } from '../../shared/layster/spatial/types';
import type { ImportAssetRequest, ImportAssetResult, SpatialCreateRequest, SpatialLoadResult } from '../../shared/layster/spatial/ipc';

export const SPACES_DIR = 'spaces';
export const SECRETS_FILE = path.join('.layster', 'secrets.local.json');
const ASSET_DIRS = ['Models', 'Characters', 'Images', 'Audio', 'Animations'];

/** 外で書き換えられたかを見張る側に「自分で書いた中身」を知らせる */
export type WriteObserver = (file: string, text: string) => void;
let writeObserver: WriteObserver | null = null;
export function setSpatialWriteObserver(observer: WriteObserver | null): void {
  writeObserver = observer;
}

export class SpatialFormatError extends Error {
  constructor(message: string, public readonly code: 'notFound' | 'tooNew' | 'invalid') {
    super(message);
    this.name = 'SpatialFormatError';
  }
}

export function spatialFile(dir: string): string {
  return path.join(dir, SPATIAL_PROJECT_FILE);
}

// ---- 作る ----------------------------------------------------------------

export async function createSpatialProjectOnDisk(req: SpatialCreateRequest, id: string): Promise<{ project: SpatialProject; path: string }> {
  const name = String(req.name ?? '').trim();
  if (!name) throw new Error('a project name is required');
  if (/[\\/:*?"<>|]/.test(name)) throw new Error(`the project name cannot contain \\ / : * ? " < > | (got "${name}")`);
  const dir = path.join(req.parentDir, name);
  if (await fs.pathExists(path.join(dir, SPATIAL_PROJECT_FILE)) || await fs.pathExists(path.join(dir, 'project.json'))) {
    throw new Error(`a project already exists in ${dir}`);
  }
  for (const sub of ASSET_DIRS) await fs.ensureDir(path.join(dir, 'Assets', sub));
  await fs.ensureDir(path.join(dir, SPACES_DIR));
  await fs.ensureDir(path.join(dir, 'Scripts'));
  const gitignore = path.join(dir, '.gitignore');
  if (!await fs.pathExists(gitignore)) await fs.writeFile(gitignore, '# 鍵 (Layster.Spatial)。共有しない\n.layster/\nBuild/\n', 'utf8');

  const project = createSpatialProject({ id, name, targetDevice: req.targetDevice || 'Meta_Quest' });
  const text = await atomicWriteJson(spatialFile(dir), project);
  writeObserver?.(spatialFile(dir), text);
  return { project, path: dir };
}

// ---- 読む ----------------------------------------------------------------

/** 読んで確かめる。足りない項目は補うが、ファイルは書き換えない。 */
export async function readSpatialProject(dir: string): Promise<{ project: SpatialProject; notices: string[] }> {
  const file = spatialFile(dir);
  if (!await fs.pathExists(file)) throw new SpatialFormatError(`${SPATIAL_PROJECT_FILE} not found in ${dir}`, 'notFound');
  const text = await fs.readFile(file, 'utf8');
  let raw: Record<string, any>;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SpatialFormatError(`${SPATIAL_PROJECT_FILE}: ${describeJsonError(text, e)}`, 'invalid');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SpatialFormatError(`${SPATIAL_PROJECT_FILE} is not a JSON object`, 'invalid');
  const header = readLaysterHeader(raw);
  if (!header || header.profile !== 'spatial') {
    throw new SpatialFormatError(`${SPATIAL_PROJECT_FILE} has no "layster": { "profile": "spatial", … } header`, 'invalid');
  }
  if (compareLayster(header, LAYSTER_CURRENT.spatial) > 0) {
    throw new SpatialFormatError(
      `this project is ${formatLayster(header)}, newer than this Arsist (${formatLayster(LAYSTER_CURRENT.spatial)}); update Arsist`, 'tooNew');
  }
  const fixed = repairSpatialProject(raw);
  const notices = fixed.map((f) => `filled in a missing "${f}"`);
  return { project: raw as SpatialProject, notices };
}

/**
 * このプロジェクトが使う拡張機能と端末が、このエディタに揃っているか (Virtual の ProjectManager.loadProject と同じ確認)。
 * 足りないまま開くと、拡張機能の設定が画面に出ないまま保存され、ビルドからも黙って外れる。
 * minIrVersion は Virtual の版で書かれているので、今の Virtual の版と比べる (拡張機能のランタイムは両方で同じ)。
 */
export async function spatialRequirements(project: SpatialProject): Promise<MissingRequirement[]> {
  const catalog = await getExtensionCatalog(true);
  return checkProjectRequirements(project, catalog.extensions.map((e) => e.manifest), await listBuiltinAdapterNames(), CURRENT_IR_VERSION);
}

/**
 * フォルダが分かるときの確かめ: validateSpatialProject + 動きの名前 (Assets/Animations/*.fbx)。
 * エディタのビルド・エージェントの spatial_validate・scripts/layster-build.mjs が使う。
 */
export async function validateSpatialProjectAt(dir: string, project: SpatialProject): Promise<SpatialProblem[]> {
  const animations = (await listAnimations(dir).catch(() => [])).map((a) => a.name);
  return [...validateSpatialProject(project), ...checkSpatialAnimations(project, animations)];
}

export async function loadSpatialProject(dir: string): Promise<SpatialLoadResult> {
  try {
    const { project, notices } = await readSpatialProject(dir);
    const missing = await spatialRequirements(project);
    if (missing.length > 0) return { success: false, error: 'requirementsMissing', missing, path: dir };
    return { success: true, project, path: dir, notices: notices.length ? notices : undefined };
  } catch (e) {
    if (e instanceof SpatialFormatError && e.code === 'tooNew') return { success: false, tooNew: true, error: e.message };
    return { success: false, error: (e as Error).message };
  }
}

// ---- 書く ----------------------------------------------------------------

const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const key = path.resolve(dir);
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(key, run);
  return run.finally(() => { if (queues.get(key) === run) queues.delete(key); });
}

async function writeNow(dir: string, project: SpatialProject, touch: boolean): Promise<void> {
  const header = readLaysterHeader(project);
  if (!header || header.profile !== 'spatial') throw new Error('refusing to save: the data has no Layster.Spatial header');
  if (compareLayster(header, LAYSTER_CURRENT.spatial) > 0) throw new Error(`refusing to save a ${formatLayster(header)} project with an older Arsist`);
  // ディスクの方が新しい版なら上書きしない (新しいエディタで開いたものを、古いエディタの画面から消さない)
  const onDisk = await fs.readJson(spatialFile(dir)).catch(() => undefined);
  const diskHeader = readLaysterHeader(onDisk);
  if (diskHeader && compareLayster(diskHeader, LAYSTER_CURRENT.spatial) > 0) {
    throw new Error(`refusing to save: the file on disk is ${formatLayster(diskHeader)}, newer than this Arsist`);
  }
  if (touch) project.updatedAt = new Date().toISOString();
  const text = await atomicWriteJson(spatialFile(dir), project);
  writeObserver?.(spatialFile(dir), text);
}

/** エディタの保存。 */
export function saveSpatialProject(dir: string, project: SpatialProject): Promise<void> {
  return enqueue(dir, () => writeNow(dir, project, true));
}

/** 読んで・変えて・書く、を 1 つずつ (エージェントの道具用)。mutate が投げたら書かない。 */
export function withSpatialWrite<T>(dir: string, mutate: (project: SpatialProject) => Promise<T> | T): Promise<T> {
  return enqueue(dir, async () => {
    const { project } = await readSpatialProject(dir);
    const result = await mutate(project);
    await writeNow(dir, project, true);
    return result;
  });
}

// ---- 試す空間 ------------------------------------------------------------

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export async function listProjectSpaces(dir: string): Promise<SpaceFixture[]> {
  const spacesDir = path.join(dir, SPACES_DIR);
  if (!await fs.pathExists(spacesDir)) return [];
  const out: SpaceFixture[] = [];
  for (const name of (await fs.readdir(spacesDir)).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const v = await fs.readJson(path.join(spacesDir, name));
      if (v && typeof v === 'object' && Array.isArray(v.entities)) {
        out.push({
          id: typeof v.id === 'string' && v.id ? v.id : name.replace(/\.json$/, ''),
          name: v.name && typeof v.name === 'object' ? v.name : { en: String(v.name ?? name), ja: String(v.name ?? name) },
          ...(v.description ? { description: v.description } : {}),
          user: { eyeHeight: typeof v.user?.eyeHeight === 'number' ? v.user.eyeHeight : 1.6 },
          knows: Array.isArray(v.knows) ? v.knows : ['scan'],
          entities: v.entities,
        });
      }
    } catch (e) {
      console.warn(`[Arsist] spaces/${name}: ${(e as Error).message}`);
    }
  }
  return out;
}

export async function saveProjectSpace(dir: string, fixture: SpaceFixture): Promise<void> {
  if (!fixture || !SAFE_ID.test(String(fixture.id))) throw new Error('a space needs an id of letters, digits, "-" and "_"');
  if (!Array.isArray(fixture.entities)) throw new Error('a space needs an "entities" array');
  const file = path.join(dir, SPACES_DIR, `${fixture.id}.json`);
  const text = await atomicWriteJson(file, fixture);
  writeObserver?.(file, text);
}

// ---- 鍵 ------------------------------------------------------------------

const SECRET_NAME = /^[A-Za-z0-9_.-]+$/;

export async function readSecrets(dir: string): Promise<Record<string, string>> {
  try {
    const v = await fs.readJson(path.join(dir, SECRETS_FILE));
    const out: Record<string, string> = {};
    if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val;
    return out;
  } catch {
    return {};
  }
}

export async function setSecret(dir: string, name: string, value: string | null): Promise<string[]> {
  if (!SECRET_NAME.test(String(name))) throw new Error('a key name may use letters, digits, ".", "-" and "_"');
  const secrets = await readSecrets(dir);
  if (value === null) delete secrets[name];
  else secrets[name] = String(value);
  const file = path.join(dir, SECRETS_FILE);
  await atomicWriteJson(file, secrets);
  // 念のため .layster/ を git から外す (作成時に書くが、外から持ってきたプロジェクトには無いことがある)
  const gitignore = path.join(dir, '.gitignore');
  const current = await fs.readFile(gitignore, 'utf8').catch(() => '');
  if (!/^\.layster\/?\s*$/m.test(current)) await fs.writeFile(gitignore, `${current}${current && !current.endsWith('\n') ? '\n' : ''}.layster/\n`, 'utf8');
  return Object.keys(secrets).sort();
}

// ---- 素材 ----------------------------------------------------------------

export const ASSET_KINDS: Record<ImportAssetRequest['kind'], { dir: string; extensions: string[] }> = {
  model: { dir: 'Assets/Models', extensions: ['.glb', '.gltf'] },
  character: { dir: 'Assets/Characters', extensions: ['.vrm'] },
  image: { dir: 'Assets/Images', extensions: ['.png', '.jpg', '.jpeg'] },
  audio: { dir: 'Assets/Audio', extensions: ['.wav', '.mp3', '.ogg'] },
  animation: { dir: 'Assets/Animations', extensions: ['.fbx'] },
};

/** 素材をプロジェクトに写す。同じ名前の別のファイルがあれば _2, _3 … を付ける (同じ中身なら写さない)。 */
export async function importSpatialAsset(dir: string, kind: ImportAssetRequest['kind'], sourcePath: string): Promise<ImportAssetResult> {
  const spec = ASSET_KINDS[kind];
  if (!spec) return { success: false, error: `unknown asset kind: ${kind}` };
  const ext = path.extname(sourcePath).toLowerCase();
  if (!spec.extensions.includes(ext)) return { success: false, error: `${kind} must be ${spec.extensions.join(' / ')} (got ${ext || 'no extension'})` };
  if (!await fs.pathExists(sourcePath)) return { success: false, error: `file not found: ${sourcePath}` };
  // 動きはファイル名がそのまま動きの名前になる (ハッシュを付けない)。Virtual と同じ取り込み
  if (kind === 'animation') {
    const imported = await importAnimation(dir, sourcePath);
    return { success: true, file: imported.assetPath };
  }
  const destDir = path.join(dir, spec.dir);
  await fs.ensureDir(destDir);
  const base = path.basename(sourcePath, path.extname(sourcePath)).replace(/[^\w.-]+/g, '_') || kind;
  const source = await fs.readFile(sourcePath);
  for (let n = 1; n < 1000; n++) {
    const name = `${n === 1 ? base : `${base}_${n}`}${ext}`;
    const dest = path.join(destDir, name);
    if (await fs.pathExists(dest)) {
      if ((await fs.readFile(dest)).equals(source)) return { success: true, file: `${spec.dir}/${name}` };
      continue;
    }
    if (path.resolve(sourcePath) !== path.resolve(dest)) await fs.copyFile(sourcePath, dest);
    return { success: true, file: `${spec.dir}/${name}` };
  }
  return { success: false, error: `too many files named ${base}` };
}
