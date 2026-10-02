/**
 * 拡張機能 — エンジン本体を書き換えずに、機能を足すための単位。
 *
 * 1 つの拡張機能は 1 つのフォルダ (Extensions/<id>/) で完結する:
 *
 *   extension.json   何で、どこで動き、どんな設定とデータを持つか (この型)
 *   Runtime/*.cs     実機で動く C#。ArsistRuntimeExtension を継承した入口を 1 つ持つ
 *   Editor/*.cs      ビルド時に動く C# (任意)。IArsistBuildExtension を実装する
 *   README.md        使い方
 *
 * エンジンとの約束 (どちらも変えずに済むように、ここだけで噛み合わせる):
 *   - どこで動くか        → requires (タグの条件)。合わない端末のビルドには C# ごと入らない。
 *                            だから Quest 専用の拡張は Meta の SDK を #if 無しで直接使ってよい。
 *   - 設定                → project.json の extensions.<id>.settings。エディタの画面は
 *                            data.settings の項目定義から自動で作られる。
 *   - オブジェクトごとの指定 → シーンの物の ext.<id>。画面は data.object から自動で作られる。
 *   - データの形を変えた  → data.version を上げ、data.migrations に宣言的な操作を足す。
 *                            エンジン本体の IR の版とは独立に、その拡張のデータだけが移行される。
 *   - スクリプトの API    → 入口のクラスが名前を登録する (script.globals に書いた名前)。
 *   - Android の権限      → android.permissions / features / metadata。ビルドが AndroidManifest に足す。
 *   - 端末を足す          → provides.adapters + Adapters/<名前>/ (adapter.json・AndroidManifest.xml)。
 *                            その端末を targetDevice にしたプロジェクトでは、この拡張機能が自動で入る。
 *   - SDK (Unity パッケージ) → unity.packages。入るビルドでだけ Packages/manifest.json に足す。
 *   - エンジンを改変する  → unity.overrides。エンジンの Assets/Arsist/<path> を Overrides/<path> で置き換える。
 *                            元のファイルのハッシュ (replaces) が合わなければビルドを止める (エンジンの更新で
 *                            前提が崩れたまま上書きしない)。`npm run ext:override` で作る。
 *
 * 配り方: フォルダのまま、または `.arsist` (フォルダを 1 つにまとめた zip。`npm run ext:pack`)。
 * どちらもエディタの「拡張機能 → インポート」で入る (src/main/extensions/packages.ts)。
 *
 * 詳しくは doc/17-extensions.md。雛形は `npm run ext:new -- <id>`。
 */
import { applyIrOps, validateIrOps, type IrOp } from './irOps';
import { matchAdapterName } from './adapterNames';
import {
  describeTagQuery,
  isKnownNamespace,
  isValidTag,
  matchTagQuery,
  normalizeTag,
  validateTagQuery,
  type Tag,
  type TagQuery,
} from './tags';

export interface LocalizedText {
  en: string;
  ja: string;
}

export type ExtensionFieldType = 'boolean' | 'number' | 'string' | 'select';

/** 設定 1 項目。エディタはこの定義から入力欄を作る。 */
export interface ExtensionField {
  key: string;
  type: ExtensionFieldType;
  label: LocalizedText;
  help?: LocalizedText;
  default: unknown;
  /** type === 'select' の選択肢 */
  options?: Array<{ value: string; label: LocalizedText }>;
  min?: number;
  max?: number;
  step?: number;
}

/** 拡張機能のデータの移行 1 段。settings と各オブジェクトの ext.<id> に別々に掛ける。 */
export interface ExtensionDataMigration {
  from: number;
  to: number;
  /** extensions.<id>.settings に掛ける操作 (パスは settings からの相対) */
  settings?: IrOp[];
  /** シーンの物の ext.<id> に掛ける操作 (パスは ext.<id> からの相対) */
  object?: IrOp[];
}

export interface ExtensionManifest {
  /** 一意な名前。kebab-case。フォルダ名と同じにする */
  id: string;
  /** 拡張機能そのものの版 (semver)。データの形の版は data.version */
  version: string;
  name: LocalizedText;
  description: LocalizedText;
  /** この拡張機能が何であるか (検索・表示用)。`ext:<id>` は自動で付く */
  tags?: Tag[];
  /** どこで動くか。端末 (アダプタ) のタグ + ビルド時の sdk:* + プロジェクトの feature:* に対する条件 */
  requires?: TagQuery;
  /** これより古いエンジン (IR の版) では使えない */
  minIrVersion?: number;
  /** この拡張機能が IR に持つデータ */
  data?: {
    /** データの形の版。形を変えたら上げて migrations を足す */
    version: number;
    settings?: ExtensionField[];
    object?: ExtensionField[];
    migrations?: ExtensionDataMigration[];
  };
  /** スクリプトに出す名前 (例: ['room'])。組み込みの名前とは重ねられない */
  script?: { globals?: string[] };
  /** AndroidManifest.xml に足すもの */
  android?: {
    permissions?: string[];
    features?: Array<{ name: string; required?: boolean }>;
    metadata?: Array<{ name: string; value: string }>;
  };
  /** この拡張機能が足すもの */
  provides?: {
    /**
     * 端末アダプタ。拡張機能の Adapters/<名前>/ に、エンジン同梱の Adapters/ と同じ形
     * (adapter.json・AndroidManifest.xml) で置く。名前がそのままプロジェクトの targetDevice になる。
     */
    adapters?: string[];
  };
  /** Unity 側 */
  unity?: {
    /** ArsistRuntimeExtension を継承したクラスの完全名 (名前空間込み) */
    entry?: string;
    /** C# の置き場所 (拡張機能のフォルダからの相対)。既定は Runtime / Editor */
    runtimeDir?: string;
    editorDir?: string;
    /** IL2CPP に消させない名前空間。既定は entry の名前空間 */
    preserve?: string[];
    /**
     * Unity パッケージ (端末の SDK など)。名前 → 版 ("1.2.3"、レジストリから) か、
     * 拡張機能の中のパス ("Packages/com.vendor.sdk-1.0.0.tgz" / "Packages/com.vendor.sdk")。
     */
    packages?: Record<string, string>;
    /**
     * エンジンの改変。path は Assets/Arsist からの相対 ("Runtime/Input/ArsistGazeInput.cs")、
     * 中身は拡張機能の Overrides/<path>。replaces は置き換える元ファイルの SHA-256 (16 進)。
     * 元のファイルが無い (新しく足す) ときだけ省略できる。
     */
    overrides?: Array<{ path: string; replaces?: string }>;
  };
}

/** project.json の extensions.<id> */
export interface ProjectExtensionState {
  enabled: boolean;
  /** 保存したときのデータの形の版 (manifest.data.version) */
  dataVersion: number;
  settings: Record<string, unknown>;
}

/** スクリプトの組み込みの名前 (ScriptEngineManager.InitEngine)。拡張機能はこれを上書きできない。 */
export const BUILTIN_SCRIPT_GLOBALS = [
  'api', 'ui', 'store', 'scene', 'vrm', 'remote', 'viewer', 'perception', 'model', 'log', 'error',
  'globalThis', 'window', 'console',
];

const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;
const CS_TYPE_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;
const CS_NS_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const JS_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const ANDROID_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isLocalized(v: unknown): v is LocalizedText {
  return isPlainObject(v) && typeof v.en === 'string' && typeof v.ja === 'string';
}

function validateFields(fields: unknown, where: string): string[] {
  if (fields === undefined) return [];
  if (!Array.isArray(fields)) return [`${where}: must be an array`];
  const problems: string[] = [];
  const keys = new Set<string>();
  fields.forEach((f, i) => {
    const at = `${where}[${i}]`;
    if (!isPlainObject(f)) { problems.push(`${at}: must be an object`); return; }
    if (typeof f.key !== 'string' || !JS_NAME_RE.test(f.key)) problems.push(`${at}.key: must be an identifier`);
    else if (keys.has(f.key)) problems.push(`${at}.key: "${f.key}" is defined twice`);
    else keys.add(f.key);
    if (!['boolean', 'number', 'string', 'select'].includes(f.type)) problems.push(`${at}.type: boolean / number / string / select`);
    if (!isLocalized(f.label)) problems.push(`${at}.label: needs { en, ja }`);
    if (f.help !== undefined && !isLocalized(f.help)) problems.push(`${at}.help: needs { en, ja }`);
    if (!('default' in f)) problems.push(`${at}: needs a default`);
    if (f.type === 'boolean' && 'default' in f && typeof f.default !== 'boolean') problems.push(`${at}.default: must be true / false`);
    if (f.type === 'number' && 'default' in f && typeof f.default !== 'number') problems.push(`${at}.default: must be a number`);
    if (f.type === 'string' && 'default' in f && typeof f.default !== 'string') problems.push(`${at}.default: must be a string`);
    if (f.type === 'select') {
      if (!Array.isArray(f.options) || f.options.length === 0) {
        problems.push(`${at}.options: a select needs options`);
      } else {
        f.options.forEach((o: unknown, j: number) => {
          if (!isPlainObject(o) || typeof o.value !== 'string' || !isLocalized(o.label)) {
            problems.push(`${at}.options[${j}]: needs { value, label: { en, ja } }`);
          }
        });
        if (!f.options.some((o: any) => o?.value === f.default)) problems.push(`${at}.default: must be one of the options`);
      }
    }
  });
  return problems;
}

/**
 * extension.json の中身を確かめる。問題が 1 つでもあれば manifest は返さない
 * (半端な拡張機能をビルドに混ぜると、壊れ方が実機でしか分からない)。
 */
export function validateExtensionManifest(raw: unknown, folderName?: string): { manifest?: ExtensionManifest; problems: string[] } {
  const problems: string[] = [];
  if (!isPlainObject(raw)) return { problems: ['extension.json: must be an object'] };
  const m = raw;

  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) problems.push('id: kebab-case, 2-41 characters, starting with a letter');
  else if (folderName && folderName !== m.id) problems.push(`id: "${m.id}" must match the folder name "${folderName}"`);
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+/.test(m.version)) problems.push('version: semver (e.g. 1.0.0)');
  if (!isLocalized(m.name)) problems.push('name: needs { en, ja }');
  if (!isLocalized(m.description)) problems.push('description: needs { en, ja }');

  if (m.tags !== undefined) {
    if (!Array.isArray(m.tags)) problems.push('tags: must be an array');
    else for (const t of m.tags) {
      const tag = typeof t === 'string' ? normalizeTag(t) : '';
      if (!isValidTag(tag)) problems.push(`tags: "${String(t)}" is not a tag (namespace:value)`);
      else if (!isKnownNamespace(tag)) problems.push(`tags: "${tag}" uses an unknown namespace`);
    }
  }
  problems.push(...validateTagQuery(m.requires, 'requires'));
  if (m.minIrVersion !== undefined && (!Number.isInteger(m.minIrVersion) || m.minIrVersion < 1)) problems.push('minIrVersion: a positive integer');

  if (m.data !== undefined) {
    if (!isPlainObject(m.data)) problems.push('data: must be an object');
    else {
      const d = m.data;
      if (!Number.isInteger(d.version) || d.version < 1) problems.push('data.version: a positive integer');
      problems.push(...validateFields(d.settings, 'data.settings'));
      problems.push(...validateFields(d.object, 'data.object'));
      if (d.migrations !== undefined) {
        if (!Array.isArray(d.migrations)) problems.push('data.migrations: must be an array');
        else {
          d.migrations.forEach((mig: any, i: number) => {
            const at = `data.migrations[${i}]`;
            if (!isPlainObject(mig) || !Number.isInteger(mig.from) || mig.to !== mig.from + 1) {
              problems.push(`${at}: needs from and to = from + 1`);
              return;
            }
            problems.push(...validateIrOps(mig.settings, `${at}.settings`));
            problems.push(...validateIrOps(mig.object, `${at}.object`));
          });
          if (Number.isInteger(d.version)) {
            for (let v = 1; v < d.version; v++) {
              if (!d.migrations.some((mig: any) => mig?.from === v)) problems.push(`data.migrations: no step from ${v} to ${v + 1}`);
            }
          }
        }
      } else if (Number.isInteger(d.version) && d.version > 1) {
        problems.push(`data.migrations: data.version is ${d.version} but there are no migrations`);
      }
    }
  }

  if (m.script !== undefined) {
    const globals = m.script?.globals;
    if (!isPlainObject(m.script) || (globals !== undefined && !Array.isArray(globals))) problems.push('script.globals: must be an array of names');
    else for (const g of globals ?? []) {
      if (typeof g !== 'string' || !JS_NAME_RE.test(g)) problems.push(`script.globals: "${String(g)}" is not a JavaScript name`);
      else if (BUILTIN_SCRIPT_GLOBALS.includes(g)) problems.push(`script.globals: "${g}" is a built-in name and cannot be replaced`);
    }
  }

  if (m.android !== undefined) {
    const a = m.android;
    if (!isPlainObject(a)) problems.push('android: must be an object');
    else {
      for (const p of a.permissions ?? []) {
        if (typeof p !== 'string' || !ANDROID_NAME_RE.test(p)) problems.push(`android.permissions: "${String(p)}" is not a permission name`);
      }
      for (const f of a.features ?? []) {
        if (!isPlainObject(f) || typeof f.name !== 'string' || !ANDROID_NAME_RE.test(f.name)) problems.push('android.features: needs { name, required? }');
      }
      for (const md of a.metadata ?? []) {
        if (!isPlainObject(md) || typeof md.name !== 'string' || typeof md.value !== 'string') problems.push('android.metadata: needs { name, value }');
      }
    }
  }

  if (m.unity !== undefined) {
    const u = m.unity;
    if (!isPlainObject(u)) problems.push('unity: must be an object');
    else {
      if (u.entry !== undefined && (typeof u.entry !== 'string' || !CS_TYPE_RE.test(u.entry))) {
        problems.push('unity.entry: a full C# class name with its namespace (e.g. Arsist.Extensions.MyThing.MyThingExtension)');
      }
      for (const key of ['runtimeDir', 'editorDir'] as const) {
        if (u[key] !== undefined && (typeof u[key] !== 'string' || u[key].includes('..') || u[key].startsWith('/'))) {
          problems.push(`unity.${key}: a folder inside the extension`);
        }
      }
      for (const ns of u.preserve ?? []) {
        if (typeof ns !== 'string' || !CS_NS_RE.test(ns)) problems.push(`unity.preserve: "${String(ns)}" is not a C# namespace`);
      }
    }
  }

  if (m.provides !== undefined) {
    if (!isPlainObject(m.provides)) problems.push('provides: must be an object');
    else if (m.provides.adapters !== undefined) {
      if (!Array.isArray(m.provides.adapters)) problems.push('provides.adapters: must be an array of folder names');
      else for (const a of m.provides.adapters) {
        if (typeof a !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{1,60}$/.test(a)) {
          problems.push(`provides.adapters: "${String(a)}" must be a folder name (letters, digits, _)`);
        }
      }
    }
  }

  if (isPlainObject(m.unity)) {
    const u = m.unity;
    if (u.packages !== undefined) {
      if (!isPlainObject(u.packages)) problems.push('unity.packages: must be { "com.vendor.name": "1.2.3" | "Packages/…" }');
      else for (const [name, value] of Object.entries(u.packages)) {
        if (!/^[a-z0-9][a-z0-9._-]*\.[a-z0-9._-]+$/.test(name)) problems.push(`unity.packages: "${name}" is not a Unity package name`);
        if (typeof value !== 'string' || value.trim() === '') problems.push(`unity.packages.${name}: needs a version or a path`);
        else if (isLocalPackageRef(value) && !isSafeRelative(value)) problems.push(`unity.packages.${name}: "${value}" must stay inside the extension`);
      }
    }
    if (u.overrides !== undefined) {
      if (!Array.isArray(u.overrides)) problems.push('unity.overrides: must be an array of { path, replaces? }');
      else u.overrides.forEach((o: any, i: number) => {
        const at = `unity.overrides[${i}]`;
        if (!isPlainObject(o) || typeof o.path !== 'string' || !isSafeRelative(o.path)) {
          problems.push(`${at}.path: a path inside Assets/Arsist (no "..", not absolute)`);
        }
        if (o?.replaces !== undefined && (typeof o.replaces !== 'string' || !/^[0-9a-f]{64}$/.test(o.replaces))) {
          problems.push(`${at}.replaces: the SHA-256 (64 hex characters) of the engine file it replaces`);
        }
      });
    }
  }

  return problems.length > 0 ? { problems } : { manifest: m as ExtensionManifest, problems };
}

/** 拡張機能の中のパスとして安全か (外に出ない・絶対パスでない)。 */
export function isSafeRelative(p: string): boolean {
  if (typeof p !== 'string' || p.trim() === '') return false;
  const norm = p.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return false;
  return !norm.split('/').some((seg) => seg === '..');
}

/** unity.packages の値が「拡張機能の中のファイル / フォルダ」か (そうでなければレジストリの版)。 */
export function isLocalPackageRef(value: string): boolean {
  return /[\\/]/.test(value) || /\.tgz$/i.test(value);
}

/** その端末 (targetDevice) のアダプタを提供している拡張機能。 */
export function findAdapterProvider(catalog: ExtensionManifest[], targetDevice: string): { manifest: ExtensionManifest; adapter: string } | null {
  const names: Array<{ manifest: ExtensionManifest; adapter: string }> = [];
  for (const m of catalog) for (const a of m.provides?.adapters ?? []) names.push({ manifest: m, adapter: a });
  const hit = matchAdapterName(names.map((n) => n.adapter), targetDevice);
  return hit ? names.find((n) => n.adapter === hit) ?? null : null;
}

/** この拡張機能が名乗るタグ (自分で書いたもの + ext:<id>)。 */
export function extensionTags(manifest: ExtensionManifest): Tag[] {
  return [...new Set([`ext:${manifest.id}`, ...(manifest.tags ?? []).map(normalizeTag)])].sort();
}

function defaultsOf(fields: ExtensionField[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields ?? []) out[f.key] = JSON.parse(JSON.stringify(f.default));
  return out;
}

export function defaultExtensionSettings(manifest: ExtensionManifest): Record<string, unknown> {
  return defaultsOf(manifest.data?.settings);
}

export function defaultObjectData(manifest: ExtensionManifest): Record<string, unknown> {
  return defaultsOf(manifest.data?.object);
}

/** 新しく有効にしたときの状態。 */
export function newExtensionState(manifest: ExtensionManifest): ProjectExtensionState {
  return { enabled: true, dataVersion: manifest.data?.version ?? 1, settings: defaultExtensionSettings(manifest) };
}

// ---- どの拡張機能がビルドに入るか ------------------------------------------

export type ExtensionSkipReason =
  | 'disabled'
  | 'notInstalled'
  | 'unsupported'
  | 'dataTooNew'
  | 'engineTooOld';

export interface ResolvedExtension {
  manifest: ExtensionManifest;
  /** なぜ入るか: プロジェクトで有効にした / ビルドする端末のアダプタを提供している */
  because?: 'enabled' | 'device';
  /** 既定値の上に、プロジェクトの設定を重ねたもの */
  settings: Record<string, unknown>;
  dataVersion: number;
  /** ビルド時にもう一度確かめる条件 (sdk:* など) */
  deferred: Tag[];
}

export interface SkippedExtension {
  id: string;
  reason: ExtensionSkipReason;
  /** reason === 'unsupported' のとき、足りないタグ */
  missing?: Tag[];
  detail?: string;
}

export interface ExtensionResolution {
  active: ResolvedExtension[];
  skipped: SkippedExtension[];
}

/**
 * プロジェクトで有効にした拡張機能のうち、この端末でビルドに入るものを決める。
 *
 * @param tags     端末のタグ + プロジェクトの feature:* (+ ビルド時なら sdk:*)
 * @param options.deferred  まだ分からない名前空間 (エディタ上では ['sdk'])
 */
export function resolveExtensions(
  projectExtensions: Record<string, ProjectExtensionState> | undefined,
  catalog: ExtensionManifest[],
  tags: Iterable<Tag>,
  options: { irVersion: number; deferred?: string[]; targetDevice?: string },
): ExtensionResolution {
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const tagList = [...tags];
  const active: ResolvedExtension[] = [];
  const skipped: SkippedExtension[] = [];

  // 端末を提供する拡張機能は、その端末向けのビルドには必ず入る (有効にし忘れても)
  const states: Record<string, ProjectExtensionState> = { ...(projectExtensions ?? {}) };
  const provider = options.targetDevice ? findAdapterProvider(catalog, options.targetDevice) : null;
  const providerId = provider?.manifest.id;
  if (provider && states[provider.manifest.id]?.enabled !== true) {
    states[provider.manifest.id] = { ...newExtensionState(provider.manifest), ...(states[provider.manifest.id] ?? {}), enabled: true };
  }

  for (const [id, state] of Object.entries(states).sort(([a], [b]) => a.localeCompare(b))) {
    if (!state || state.enabled !== true) {
      skipped.push({ id, reason: 'disabled' });
      continue;
    }
    const manifest = byId.get(id);
    if (!manifest) {
      skipped.push({ id, reason: 'notInstalled', detail: `Extensions/${id}/extension.json was not found` });
      continue;
    }
    if (manifest.minIrVersion !== undefined && manifest.minIrVersion > options.irVersion) {
      skipped.push({ id, reason: 'engineTooOld', detail: `needs IR v${manifest.minIrVersion}, this editor is v${options.irVersion}` });
      continue;
    }
    const dataVersion = Number.isInteger(state.dataVersion) ? state.dataVersion : 1;
    const wanted = manifest.data?.version ?? 1;
    if (dataVersion > wanted) {
      skipped.push({ id, reason: 'dataTooNew', detail: `project data v${dataVersion}, extension understands up to v${wanted}` });
      continue;
    }
    const match = matchTagQuery(manifest.requires, tagList, { deferred: options.deferred });
    if (!match.ok) {
      skipped.push({
        id,
        reason: 'unsupported',
        missing: [...match.missing, ...match.missingAny, ...match.blocked.map((t) => `!${t}`)],
        detail: `requires ${describeTagQuery(manifest.requires)}`,
      });
      continue;
    }
    active.push({
      manifest,
      because: id === providerId ? 'device' : 'enabled',
      settings: { ...defaultExtensionSettings(manifest), ...(isPlainObject(state.settings) ? state.settings : {}) },
      dataVersion,
      deferred: match.deferred,
    });
  }

  return { active, skipped };
}

// ---- 拡張機能のデータの移行 -------------------------------------------------

export interface ExtensionDataUpgrade {
  id: string;
  from: number;
  to: number;
  changes: string[];
}

/** シーンの物 (入れ子の children も) を全部たどる。 */
function forEachSceneObject(project: Record<string, any>, visit: (obj: Record<string, any>) => void): void {
  const walk = (objects: unknown) => {
    if (!Array.isArray(objects)) return;
    for (const obj of objects) {
      if (!isPlainObject(obj)) continue;
      visit(obj);
      walk(obj.children);
    }
  };
  for (const scene of Array.isArray(project.scenes) ? project.scenes : []) {
    if (isPlainObject(scene)) walk(scene.objects);
  }
}

/** この拡張機能のデータを持っている物の数 (表示用)。 */
export function countObjectsWithExtension(project: Record<string, any>, id: string): number {
  let n = 0;
  forEachSceneObject(project, (obj) => { if (isPlainObject(obj.ext?.[id])) n++; });
  return n;
}

/**
 * 古い形で保存された拡張機能のデータを、今入っている拡張機能の形に移す (その場で書き換える)。
 *
 * エンジン本体の IR の版とは独立。拡張機能を更新しても、その拡張機能のデータだけが
 * 移行され、他の部分には触れない。入っていない拡張機能のデータには一切触れない
 * (消すと、その拡張機能を入れ直したときに設定が戻らない)。
 */
export function migrateExtensionData(project: Record<string, any>, catalog: ExtensionManifest[]): {
  upgrades: ExtensionDataUpgrade[];
  problems: string[];
} {
  const upgrades: ExtensionDataUpgrade[] = [];
  const problems: string[] = [];
  const states = project.extensions;
  if (!isPlainObject(states)) return { upgrades, problems };

  for (const [id, state] of Object.entries(states)) {
    const manifest = catalog.find((m) => m.id === id);
    if (!manifest || !isPlainObject(state)) continue;
    const wanted = manifest.data?.version ?? 1;
    const from = Number.isInteger(state.dataVersion) ? state.dataVersion as number : 1;
    if (from >= wanted) continue;

    // 先に道筋が全部あるかを確かめる。途中で切れているのに途中まで掛けると、
    // どの版でもない形のデータが残る。
    const steps: ExtensionDataMigration[] = [];
    for (let v = from; v < wanted; v++) {
      const step = manifest.data?.migrations?.find((m) => m.from === v);
      if (!step) break;
      steps.push(step);
    }
    if (steps.length !== wanted - from) {
      problems.push(`${id}: no data migration from v${from + steps.length}`);
      continue;
    }

    const changes: string[] = [];
    for (const step of steps) {
      if (!isPlainObject(state.settings)) state.settings = {};
      if (step.settings?.length) {
        changes.push(...applyIrOps(state.settings, step.settings).map((p) => `settings.${p}`));
      }
      if (step.object?.length) {
        forEachSceneObject(project, (obj) => {
          const data = obj.ext?.[id];
          if (!isPlainObject(data)) return;
          for (const p of applyIrOps(data, step.object!)) {
            const label = `object.${p}`;
            if (!changes.includes(label)) changes.push(label);
          }
        });
      }
    }

    // 新しい形で増えた設定は既定値で埋める (移行で書き忘れても欠けない)
    for (const [key, value] of Object.entries(defaultExtensionSettings(manifest))) {
      if (!(key in state.settings)) {
        state.settings[key] = value;
        changes.push(`settings.${key}`);
      }
    }
    state.dataVersion = wanted;
    upgrades.push({ id, from, to: wanted, changes: [...new Set(changes)] });
  }

  return { upgrades, problems };
}

// ---- プロジェクトを開く前の確認 ----------------------------------------------

export type MissingKind = 'extension' | 'extensionTooOld' | 'engineTooOld' | 'device';

export interface MissingRequirement {
  kind: MissingKind;
  /** 拡張機能の id、または端末名 (targetDevice) */
  id: string;
  detail: string;
}

/**
 * プロジェクトが要るものが、このエディタに揃っているか。
 *
 * IR はタグと拡張機能の id で「何を使うか」を持っているので、開く前に分かる:
 *   - 有効にしている拡張機能が入っていない          → extension
 *   - 入っているが、プロジェクトのデータより古い     → extensionTooOld
 *   - 拡張機能がこのエディタ (IR の版) より新しい    → engineTooOld
 *   - 端末 (targetDevice) のアダプタがどこにも無い   → device (エンジン同梱にも、拡張機能にも)
 * 足りないまま開くと、設定が見えないまま保存されたり、ビルドで黙って外れたりするので、
 * エディタは開く前にこれを見せて止める。
 */
export function checkProjectRequirements(
  project: { targetDevice?: string; extensions?: Record<string, ProjectExtensionState> },
  catalog: ExtensionManifest[],
  builtinAdapters: Iterable<string>,
  irVersion: number,
): MissingRequirement[] {
  const missing: MissingRequirement[] = [];
  const byId = new Map(catalog.map((m) => [m.id, m]));

  for (const [id, state] of Object.entries(project.extensions ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!state || state.enabled !== true) continue;
    const manifest = byId.get(id);
    if (!manifest) {
      missing.push({ kind: 'extension', id, detail: `the project uses extension "${id}" (data v${state.dataVersion ?? 1}) but it is not installed` });
      continue;
    }
    const understood = manifest.data?.version ?? 1;
    if ((state.dataVersion ?? 1) > understood) {
      missing.push({
        kind: 'extensionTooOld',
        id,
        detail: `the project was saved with a newer "${id}" (data v${state.dataVersion}); the installed ${manifest.version} understands up to v${understood}`,
      });
    }
    if (manifest.minIrVersion !== undefined && manifest.minIrVersion > irVersion) {
      missing.push({ kind: 'engineTooOld', id, detail: `"${id}" ${manifest.version} needs a newer Arsist (IR v${manifest.minIrVersion}; this one is v${irVersion})` });
    }
  }

  const target = project.targetDevice;
  if (target && !matchAdapterName(builtinAdapters, target) && !findAdapterProvider(catalog, target)) {
    missing.push({
      kind: 'device',
      id: target,
      detail: `no adapter for the target device "${target}" (neither in Adapters/ nor in an installed extension)`,
    });
  }
  return missing;
}
