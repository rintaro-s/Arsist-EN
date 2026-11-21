/**
 * Arsist のプロジェクトを操作するツール群。MCP サーバー (外部のエージェント) と内蔵エージェントが、
 * どちらもこの同じ実装を呼ぶ (ツールの振る舞いが入口によって違う、を作らない)。
 *
 * 読み書きは src/main/project/projectIO.ts を通す:
 *   - 1 ファイルずつ原子的に書く / 同じプロジェクトへの書き込みは 1 つずつ
 *   - IR の版が今と違うプロジェクトには書かない (古い版はエディタでアップグレードしてから)
 * エディタが開いているプロジェクトを書き換えると、エディタはファイルの変化を見て読み直す
 * (src/main/project/projectWatcher.ts)。
 *
 * 旧 scripts/mcp-ir-server.mjs のツール (ir_get_project 〜 ir_remove_transform) は、名前と引数を変えずに残している。
 * projectPath はどのツールでも省略でき、そのときは arsist_open_project で開いたもの (または起動時の
 * ARSIST_PROJECT_PATH) を使う。
 */
import * as crypto from 'crypto';
import * as path from 'path';
import * as vm from 'vm';
import * as fs from 'fs-extra';
import { projectReadNotes, readProjectFiles, withProjectWrite } from '../project/projectIO';
import { getExtensionCatalog } from '../extensions/catalogService';
import { listAdapterLocations, listBuiltinAdapterNames } from '../adapters/adapterDirs';
import { adapterTags } from '../../shared/adapterTags';
import { matchAdapterName } from '../../shared/adapterNames';
import {
  checkProjectRequirements,
  defaultObjectData,
  newExtensionState,
  type ExtensionField,
  type ExtensionManifest,
} from '../../shared/extensions';
import { matchTagQuery } from '../../shared/tags';
import { projectFeatureTags, unsupportedFeatures } from '../../shared/engineFeatures';
import { CURRENT_IR_VERSION, readIrVersion } from '../../shared/irVersion';
import { describeVirtualIrVersion } from '../../shared/layster/version';
import { scriptReferenceFor } from './scriptReference';
import { importAnimation, listAnimations } from '../project/animationAssets';
import { characterAnimationIssues } from '../../shared/characterChecks';
import { readVrmSpec } from '../project/vrmInfo';
import { enginePart, enginePartLabel, planReplacements } from '../../shared/engineParts';
import { SPATIAL_TOOLS } from './spatialTools';
import { detectProjectKind } from '../layster/projectKind';
import { CAMERA_DEFAULTS, CHARACTER_DEFAULTS, EMBODY_DEFAULTS } from '../../shared/types';
import { checkCameraSettings, checkEmbodySettings, checkMediaSource, mediaIssues } from '../../shared/media';

type Args = Record<string, any>;

export interface ToolSessionOptions {
  /** 最初に開いておくプロジェクト (MCP なら ARSIST_PROJECT_PATH、内蔵エージェントならエディタで開いているもの) */
  projectPath?: string | null;
  /** 最近開いたプロジェクト (エディタの設定から) */
  recentProjects?: () => string[];
}

export class ToolSession {
  projectPath: string | null;
  readonly recentProjects: () => string[];
  /** このセッションで書き換えたファイルがあるか (内蔵エージェントがエディタに読み直しを頼むのに使う) */
  changed = false;

  constructor(options: ToolSessionOptions = {}) {
    this.projectPath = options.projectPath ?? null;
    this.recentProjects = options.recentProjects ?? (() => []);
  }

  resolve(args: Args): string {
    const p = typeof args.projectPath === 'string' && args.projectPath.trim() ? args.projectPath.trim() : this.projectPath;
    if (!p) {
      const recent = this.recentProjects().slice(0, 5);
      throw new Error('no project selected: pass projectPath or call arsist_open_project first' +
        (recent.length ? ` (recent projects: ${recent.join(', ')})` : ''));
    }
    return p;
  }
}

export interface ArsistTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  /** 何も書き換えない (エージェントの確認なしで呼んでよい) */
  readOnly: boolean;
  run(args: Args, session: ToolSession): Promise<unknown>;
}

// ---- 小道具 ----------------------------------------------------------------

const uid = () => crypto.randomUUID();
const vec3 = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } };
const projectPathProp = { projectPath: { type: 'string', description: 'Project folder (contains project.json). Optional after arsist_open_project.' } };
const schema = (properties: Record<string, any>, required: string[] = []) => ({
  type: 'object',
  properties: { ...projectPathProp, ...properties },
  ...(required.length ? { required } : {}),
});

function toRel(p: string): string {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function scene(project: Args, sceneId?: string): Args {
  const scenes: Args[] = project.scenes ?? [];
  const found = sceneId ? scenes.find((s) => s.id === sceneId) : scenes[0];
  if (!found) throw new Error(sceneId ? `scene not found: ${sceneId}` : 'the project has no scene');
  found.objects = Array.isArray(found.objects) ? found.objects : [];
  return found;
}

function layout(project: Args, layoutId?: string): Args {
  const layouts: Args[] = project.uiLayouts ?? [];
  const found = layoutId ? layouts.find((l) => l.id === layoutId || l.name === layoutId) : layouts[0];
  if (!found) throw new Error(layoutId ? `layout not found: ${layoutId}` : 'the project has no UI layout');
  return found;
}

function findElement(node: Args | undefined, id: string): Args | null {
  if (!node) return null;
  if (node.id === id || node.bindingId === id) return node;
  for (const child of node.children ?? []) {
    const hit = findElement(child, id);
    if (hit) return hit;
  }
  return null;
}

function countElements(node: Args | undefined): number {
  if (!node) return 0;
  return 1 + (node.children ?? []).reduce((n: number, c: Args) => n + countElements(c), 0);
}

function findObject(project: Args, objectId: string, sceneId?: string): { scene: Args; object: Args } {
  const scenes: Args[] = sceneId ? [scene(project, sceneId)] : project.scenes ?? [];
  for (const s of scenes) {
    const obj = (s.objects ?? []).find((o: Args) => o.id === objectId || o.assetId === objectId || o.name === objectId);
    if (obj) return { scene: s, object: obj };
  }
  throw new Error(`object not found: ${objectId}`);
}

function transformFrom(args: Args, base?: Args): Args {
  const t = base ?? { position: { x: 0, y: 0, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
  if (args.position) t.position = { ...t.position, ...args.position };
  if (args.rotation) t.rotation = { ...t.rotation, ...args.rotation };
  if (args.scale) t.scale = { ...t.scale, ...args.scale };
  return t;
}

/** UI の Image の source を確かめて、余計な項目の無い形にする (doc/23) */
function sourceFrom(raw: Args, elementType: string, project: Args): Args {
  if (elementType !== 'Image') throw new Error(`source applies to Image elements only (this is ${elementType})`);
  const err = checkMediaSource(raw, project as any);
  if (err) throw new Error(err);
  const mirror = raw.mirror === true ? { mirror: true } : {};
  return raw.kind === 'camera' ? { kind: 'camera', camera: raw.camera.trim(), ...mirror } : { kind: 'stream', url: raw.url.trim(), ...mirror };
}

/** JavaScript として読めるか (Jint に渡す前の構文チェック)。 */
export function checkScriptSyntax(code: string): { ok: boolean; error?: string; line?: number } {
  try {
    new vm.Script(String(code ?? ''), { filename: 'script.js' });
    return { ok: true };
  } catch (e) {
    const err = e as Error & { stack?: string };
    const m = /script\.js:(\d+)/.exec(err.stack ?? '');
    return { ok: false, error: err.message, line: m ? Number(m[1]) : undefined };
  }
}

const TRIGGERS = ['onStart', 'onUpdate', 'interval', 'event'];

function normalizeTrigger(raw: unknown): Args {
  const t = (raw && typeof raw === 'object' ? raw : { type: raw ?? 'onStart' }) as Args;
  if (!TRIGGERS.includes(t.type)) throw new Error(`trigger.type must be one of ${TRIGGERS.join(', ')}`);
  if (t.type === 'interval' && !(Number(t.value) > 0)) throw new Error('an interval trigger needs value (milliseconds > 0)');
  if (t.type === 'event' && (typeof t.value !== 'string' || !t.value)) throw new Error('an event trigger needs value (the event name)');
  return t.type === 'interval' ? { type: t.type, value: Number(t.value) } : t.type === 'event' ? { type: t.type, value: t.value } : { type: t.type };
}

/** 拡張機能の設定値を、extension.json の項目定義に照らして確かめる。 */
function checkFieldValues(fields: ExtensionField[] | undefined, values: Args, where: string): void {
  const byKey = new Map((fields ?? []).map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(values ?? {})) {
    const f = byKey.get(key);
    if (!f) throw new Error(`${where}: unknown key "${key}" (known: ${[...byKey.keys()].join(', ') || 'none'})`);
    if (f.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${where}.${key}: must be true/false`);
    if (f.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${where}.${key}: must be a number`);
      if (f.min !== undefined && value < f.min) throw new Error(`${where}.${key}: must be ≥ ${f.min}`);
      if (f.max !== undefined && value > f.max) throw new Error(`${where}.${key}: must be ≤ ${f.max}`);
    }
    if (f.type === 'string' && typeof value !== 'string') throw new Error(`${where}.${key}: must be a string`);
    if (f.type === 'select' && !(f.options ?? []).some((o) => o.value === value)) {
      throw new Error(`${where}.${key}: must be one of ${(f.options ?? []).map((o) => o.value).join(', ')}`);
    }
  }
}

async function catalogManifests(): Promise<Array<{ manifest: ExtensionManifest; dir: string }>> {
  const catalog = await getExtensionCatalog();
  return catalog.extensions.map((e) => ({ manifest: e.manifest, dir: e.dir }));
}

async function deviceTagsFor(targetDevice: string | undefined): Promise<string[]> {
  if (!targetDevice) return [];
  const all = await listAdapterLocations();
  const hit = matchAdapterName(all.map((a) => a.name), targetDevice);
  const loc = hit ? all.find((a) => a.name === hit) : null;
  if (!loc) return [];
  try {
    return adapterTags(await fs.readJSON(path.join(loc.dir, 'adapter.json')));
  } catch {
    return [];
  }
}

/** 書き込み系のツール。結果に changed を立てる。 */
async function write<T>(session: ToolSession, args: Args, mutate: (project: Args) => T | Promise<T>): Promise<T> {
  const result = await withProjectWrite(session.resolve(args), mutate);
  session.changed = true;
  return result;
}

async function read(session: ToolSession, args: Args): Promise<Args> {
  return readProjectFiles(session.resolve(args));
}

// ---- ツール ----------------------------------------------------------------

export const ARSIST_TOOLS: ArsistTool[] = [
  // ---- セッション・参照 ----
  {
    name: 'arsist_open_project',
    description: 'Select the Arsist project folder that later calls use when projectPath is omitted. Returns its summary and its format: Layster.Virtual (project.json, use the ir_* tools) or Layster.Spatial (project.spatial.json, use the spatial_* tools).',
    inputSchema: { type: 'object', properties: { projectPath: { type: 'string' } }, required: ['projectPath'] },
    readOnly: true,
    async run(args, session) {
      // Layster.Spatial のフォルダ (project.spatial.json) は別の道具で扱う。形に互換性は無い
      const kind = await detectProjectKind(args.projectPath);
      if (kind.kind === 'spatial') {
        session.projectPath = args.projectPath;
        return {
          opened: args.projectPath, name: kind.name, format: kind.label,
          tools: 'This is a Layster.Spatial project: use the spatial_* tools (start with spatial_reference and spatial_get_project). The ir_* tools do not apply.',
        };
      }
      const project = await readProjectFiles(args.projectPath);
      session.projectPath = args.projectPath;
      return { opened: args.projectPath, name: project.name, irVersion: readIrVersion(project), targetDevice: project.targetDevice };
    },
  },
  {
    name: 'arsist_list_recent_projects',
    description: 'Projects recently opened in the Arsist editor (folder paths).',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    async run(_args, session) {
      return { current: session.projectPath, recent: session.recentProjects() };
    },
  },
  {
    name: 'arsist_script_reference',
    description: 'How Arsist scripts, UI, scenes and the store work, every script global with its methods (engine and installed extensions), and the editor coordinate system. Read this before writing scripts or placing things.',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    async run() {
      return scriptReferenceFor(await catalogManifests());
    },
  },

  // ---- プロジェクト ----
  {
    name: 'ir_get_project',
    description: 'Project summary: format version, target device, scenes, UI layouts, scripts, models, extensions, data flow.',
    inputSchema: schema({}),
    readOnly: true,
    async run(args, session) {
      const p = await read(session, args);
      const version = readIrVersion(p);
      return {
        id: p.id,
        name: p.name,
        appType: p.appType,
        irVersion: version,
        // 人とエージェント向けの形式の名前 ('Layster.Virtual β 1.0.0')。判定は irVersion で
        format: `Layster.Virtual ${describeVirtualIrVersion(version)}`,
        readOnly: version < CURRENT_IR_VERSION
          ? `old format (Layster.Virtual ${describeVirtualIrVersion(version)}; current ${describeVirtualIrVersion(CURRENT_IR_VERSION)}): open it in the Arsist editor and accept the upgrade before editing`
          : false,
        targetDevice: p.targetDevice,
        arSettings: p.arSettings,
        scenes: (p.scenes ?? []).map((s: Args) => ({ id: s.id, name: s.name, objects: (s.objects ?? []).length })),
        uiLayouts: (p.uiLayouts ?? []).map((l: Args) => ({ id: l.id, name: l.name, scope: l.scope, elements: countElements(l.root) })),
        scripts: (p.scripts ?? []).map((s: Args) => ({ id: s.id, name: s.name, trigger: s.trigger, enabled: s.enabled })),
        models: (p.models ?? []).map((m: Args) => ({ id: m.id, name: m.name, use: m.use })),
        extensions: Object.entries(p.extensions ?? {}).filter(([, st]: [string, any]) => st?.enabled).map(([id]) => id),
        dataFlow: { dataSources: p.dataFlow.dataSources.length, transforms: p.dataFlow.transforms.length },
      };
    },
  },
  {
    name: 'ir_validate_project',
    description: 'Check the project before building: missing extensions or device, features the target device cannot do, canvases without a layout, script syntax errors, duplicate assetIds, animation names that do not exist, images showing a camera that does not exist, stream urls, camera resolutions, more than one embodied VRM.',
    inputSchema: schema({}),
    readOnly: true,
    async run(args, session) {
      const p = await read(session, args);
      const problems: string[] = [];
      // ファイルを直接書き換えたときに分かるように: どの写しを使ったか・足りない項目を何で埋めたか
      const warnings: string[] = (projectReadNotes.get(p) ?? []).map((n) => `files: ${n}`);
      const catalog = await catalogManifests();
      for (const m of checkProjectRequirements(p, catalog.map((c) => c.manifest), await listBuiltinAdapterNames(), CURRENT_IR_VERSION)) {
        problems.push(`${m.kind}: ${m.detail}`);
      }
      const tags = await deviceTagsFor(p.targetDevice);
      for (const issue of unsupportedFeatures(p as any, tags)) {
        warnings.push(`${issue.feature} (${issue.summary}) will not work on ${p.targetDevice}: missing ${issue.missing.join(', ')}`);
      }
      for (const [id, st] of Object.entries(p.extensions ?? {}) as Array<[string, any]>) {
        const m = catalog.find((c) => c.manifest.id === id)?.manifest;
        if (!st?.enabled || !m) continue;
        const fit = matchTagQuery(m.requires, [...tags, ...projectFeatureTags(p as any)], { deferred: ['sdk'] });
        if (!fit.ok) warnings.push(`extension ${id} is left out on ${p.targetDevice} (needs ${[...fit.missing, ...fit.missingAny].join(', ')})`);
      }
      const layoutIds = new Set((p.uiLayouts ?? []).map((l: Args) => l.id));
      const assetIds = new Map<string, number>();
      for (const s of p.scenes ?? []) {
        for (const o of s.objects ?? []) {
          if (o.type === 'canvas' && !layoutIds.has(o.canvasSettings?.layoutId)) problems.push(`canvas "${o.name}" has no valid UI layout`);
          if (o.assetId) assetIds.set(o.assetId, (assetIds.get(o.assetId) ?? 0) + 1);
        }
      }
      for (const [a, n] of assetIds) if (n > 1) warnings.push(`assetId "${a}" is used by ${n} objects; scripts will reach only one`);
      // カメラ・画像に映すもの (source)・自分の体 (embody)。doc/23
      const media = mediaIssues(p as any);
      problems.push(...media.problems);
      warnings.push(...media.warnings);
      const animations = (await listAnimations(session.resolve(args))).map((a) => a.name);
      for (const issue of characterAnimationIssues(p as any, animations)) warnings.push(issue);
      // VRM 1.0 は、VRM の読み込みを置き換える拡張機能 (replaces: vrm-loader) が無いと実機で出ない
      const vrmLoaders = catalog.filter(({ manifest: m }) => (m.replaces ?? []).includes('vrm-loader')).map(({ manifest: m }) => m.id);
      const vrmLoaderOn = vrmLoaders.some((id) => p.extensions?.[id]?.enabled === true);
      for (const sc of p.scenes ?? []) {
        for (const o of sc.objects ?? []) {
          if (o.type !== 'vrm' || typeof o.modelPath !== 'string' || vrmLoaderOn) continue;
          if (await readVrmSpec(path.join(session.resolve(args), o.modelPath)) === '1.0') {
            warnings.push(
              `"${o.name}" is a VRM 1.0 model, but the engine's own VRM loader (UniVRM 0.x) reads VRM 0.x only; it will not appear on the device. ` +
              (vrmLoaders.length
                ? `Enable an extension that replaces vrm-loader: ir_set_extension { id: "${vrmLoaders[0]}" }`
                : 'No installed extension replaces vrm-loader (the official extension Extensions/vrm10 does; it ships with the engine), or convert the model to VRM 0.x'));
          }
        }
      }
      // 同じエンジンの部品を 2 つの有効な拡張機能が置き換えていると、ビルドが止まる
      const enabledManifests = catalog.map((c) => c.manifest).filter((m) => p.extensions?.[m.id]?.enabled === true);
      for (const c of planReplacements(enabledManifests).conflicts) {
        problems.push(`extensions ${c.ids.join(' and ')} both replace the engine part ${c.part}; enable only one`);
      }
      for (const sc of p.scripts ?? []) {
        const r = checkScriptSyntax(sc.code);
        if (!r.ok) problems.push(`script "${sc.name}": ${r.error}${r.line ? ` (line ${r.line})` : ''}`);
      }
      return { ok: problems.length === 0, problems, warnings };
    },
  },
  {
    name: 'ir_list_devices',
    description: 'Devices the project can target (built in or added by extensions), with their capability tags.',
    inputSchema: schema({}),
    readOnly: true,
    async run() {
      const out = [];
      for (const loc of await listAdapterLocations()) {
        let raw: Args = {};
        try { raw = await fs.readJSON(path.join(loc.dir, 'adapter.json')); } catch { /* 無視 */ }
        out.push({ device: loc.name, displayName: raw.device?.displayName ?? raw.name ?? loc.name, source: loc.source, extensionId: loc.extensionId, tags: adapterTags(raw) });
      }
      return { devices: out };
    },
  },
  {
    name: 'ir_set_target_device',
    description: 'Set the device the project builds for (a name from ir_list_devices).',
    inputSchema: schema({ device: { type: 'string' } }, ['device']),
    readOnly: false,
    async run(args, session) {
      const all = await listAdapterLocations();
      const hit = matchAdapterName(all.map((a) => a.name), args.device);
      if (!hit) throw new Error(`unknown device "${args.device}" (known: ${all.map((a) => a.name).join(', ')})`);
      return write(session, args, (p) => { p.targetDevice = hit; return { targetDevice: hit }; });
    },
  },
  {
    name: 'ir_update_ar_settings',
    description: 'Change AR settings: backgroundMode (passthrough|skybox|solidColor), backgroundColor (#RRGGBB), interaction { controllerRay, handTracking }, enableRemoteControl, remoteControlPort.',
    inputSchema: schema({
      backgroundMode: { type: 'string', enum: ['passthrough', 'skybox', 'solidColor'] },
      backgroundColor: { type: 'string' },
      interaction: { type: 'object', properties: { controllerRay: { type: 'boolean' }, handTracking: { type: 'boolean' } } },
      enableRemoteControl: { type: 'boolean' },
      remoteControlPort: { type: 'number' },
    }),
    readOnly: false,
    async run(args, session) {
      if (args.backgroundColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(args.backgroundColor)) throw new Error('backgroundColor must be #RRGGBB');
      return write(session, args, (p) => {
        p.arSettings = p.arSettings ?? {};
        for (const key of ['backgroundMode', 'backgroundColor', 'enableRemoteControl', 'remoteControlPort']) {
          if (args[key] !== undefined) p.arSettings[key] = args[key];
        }
        if (args.interaction) p.arSettings.interaction = { ...(p.arSettings.interaction ?? {}), ...args.interaction };
        return { arSettings: p.arSettings };
      });
    },
  },

  // ---- シーン ----
  {
    name: 'ir_list_scene_objects',
    description: 'List the objects of a scene (first scene when sceneId is omitted).',
    inputSchema: schema({ sceneId: { type: 'string' } }),
    readOnly: true,
    async run(args, session) {
      const s = scene(await read(session, args), args.sceneId);
      return {
        sceneId: s.id,
        sceneName: s.name,
        objects: s.objects.map((o: Args) => ({
          id: o.id, name: o.name, type: o.type, assetId: o.assetId, primitiveType: o.primitiveType,
          modelPath: o.modelPath, canvasSettings: o.canvasSettings, camera: o.camera, transform: o.transform, ext: o.ext,
        })),
      };
    },
  },
  {
    name: 'ir_get_scene_object',
    description: 'Everything about one object (by id, assetId or name).',
    inputSchema: schema({ objectId: { type: 'string' }, sceneId: { type: 'string' } }, ['objectId']),
    readOnly: true,
    async run(args, session) {
      const { scene: s, object } = findObject(await read(session, args), args.objectId, args.sceneId);
      return { sceneId: s.id, object };
    },
  },
  {
    name: 'ir_add_primitive',
    description: 'Add a primitive shape (cube, sphere, plane, cylinder, capsule). Editor coordinates: meters, +Z ahead, +X the user\'s left.',
    inputSchema: schema({
      primitiveType: { type: 'string', enum: ['cube', 'sphere', 'plane', 'cylinder', 'capsule'] },
      name: { type: 'string' }, assetId: { type: 'string' }, color: { type: 'string', description: '#RRGGBB' },
      sceneId: { type: 'string' }, position: vec3, rotation: vec3, scale: vec3,
    }, ['primitiveType']),
    readOnly: false,
    async run(args, session) {
      if (!['cube', 'sphere', 'plane', 'cylinder', 'capsule'].includes(args.primitiveType)) throw new Error('primitiveType: cube | sphere | plane | cylinder | capsule');
      return write(session, args, (p) => {
        const s = scene(p, args.sceneId);
        const name = args.name || args.primitiveType;
        const obj: Args = {
          id: uid(), name, type: 'primitive', primitiveType: args.primitiveType, assetId: args.assetId || name,
          transform: transformFrom(args, { position: { x: 0, y: 0, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.2, y: 0.2, z: 0.2 } }),
          material: { color: args.color || '#FFFFFF', metallic: 0, roughness: 0.5 },
        };
        s.objects.push(obj);
        return { success: true, object: obj, sceneId: s.id };
      });
    },
  },
  {
    name: 'ir_add_camera',
    description: 'Add a virtual camera: it films the scene from where it is placed (forward = its local +Z) into a texture that UI images can show ' +
      '(ir_update_ui_element source { kind: "camera", camera: <assetId> }), scripts can move (cameras.*) and extensions can record. ' +
      'Editor coordinates: meters, +Z ahead, +X the user\'s left; rotation in degrees (y: 180 turns it to face the user at the origin).',
    inputSchema: schema({
      name: { type: 'string' }, assetId: { type: 'string', description: 'Name for scripts and image sources (default: the name)' },
      sceneId: { type: 'string' }, position: vec3, rotation: vec3,
      settings: {
        type: 'object',
        description: 'Camera settings; omitted keys use the defaults',
        properties: {
          fov: { type: 'number', description: 'vertical field of view in degrees (default 50)' },
          resolution: { type: 'array', items: { type: 'number' }, description: '[width, height] px (default [1920, 1080]; portrait [1080, 1920])' },
          fps: { type: 'number', description: 'renders per second (default 30; 0 = every frame while used)' },
          backgroundColor: { type: 'string', description: '#RRGGBB (default #1e2430)' },
          near: { type: 'number' }, far: { type: 'number' },
          showSelf: { type: 'boolean', description: 'film the VRM that moves as your body (default true)' },
          showGizmo: { type: 'boolean', description: 'show the camera body and its view cone in the headset (default true)' },
        },
      },
    }),
    readOnly: false,
    async run(args, session) {
      if (args.settings !== undefined) {
        const err = checkCameraSettings(args.settings);
        if (err) throw new Error(err);
      }
      return write(session, args, (p) => {
        const s = scene(p, args.sceneId);
        const name = args.name || 'Camera';
        const obj: Args = {
          id: uid(), name, type: 'camera', assetId: args.assetId || name,
          // 既定: ユーザーの 2 m 先、目の高さから少し下で、ユーザーの方 (-Z) を向く
          transform: transformFrom(args, { position: { x: 0, y: -0.1, z: 2 }, rotation: { x: 0, y: 180, z: 0 }, scale: { x: 1, y: 1, z: 1 } }),
          camera: { ...CAMERA_DEFAULTS, ...(args.settings ?? {}) },
        };
        s.objects.push(obj);
        return { success: true, object: obj, sceneId: s.id };
      });
    },
  },
  {
    name: 'ir_import_model_asset',
    description: 'Copy a GLB/glTF/VRM file into the project (Assets/Models) and return assetPath for ir_place_model.',
    inputSchema: schema({ sourcePath: { type: 'string' } }, ['sourcePath']),
    readOnly: false,
    async run(args, session) {
      const projectPath = session.resolve(args);
      const ext = path.extname(args.sourcePath).toLowerCase();
      if (!['.glb', '.gltf', '.vrm'].includes(ext)) throw new Error(`unsupported model extension: ${ext} (.glb .gltf .vrm)`);
      if (!await fs.pathExists(args.sourcePath)) throw new Error(`source model not found: ${args.sourcePath}`);
      const bytes = await fs.readFile(args.sourcePath);
      const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 8);
      const base = path.basename(args.sourcePath, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'model';
      const rel = toRel(path.join('Assets', 'Models', `${base}_${hash}${ext}`));
      await fs.ensureDir(path.dirname(path.join(projectPath, rel)));
      await fs.copyFile(args.sourcePath, path.join(projectPath, rel));
      session.changed = true;
      return { success: true, assetPath: rel };
    },
  },
  {
    name: 'ir_import_animation',
    description: 'Copy a humanoid FBX animation (e.g. from Mixamo; walking downloaded "In Place") into Assets/Animations. ' +
      'Returns its name — use it for a VRM\'s character.animation and in scripts (vrm.playAnimation(id, name), vrm.walkTo uses "Walk"/"Idle").',
    inputSchema: schema({ sourcePath: { type: 'string' }, name: { type: 'string', description: 'Animation name (default: the file name)' } }, ['sourcePath']),
    readOnly: false,
    async run(args, session) {
      const projectPath = session.resolve(args);
      const imported = await importAnimation(projectPath, args.sourcePath, args.name);
      if (!imported.existed) session.changed = true;
      return { success: true, ...imported };
    },
  },
  {
    name: 'ir_list_animations',
    description: 'Animations in the project (Assets/Animations/*.fbx). The name is what character.animation and vrm.playAnimation take.',
    inputSchema: schema({}),
    readOnly: true,
    async run(args, session) {
      const animations = await listAnimations(session.resolve(args));
      return { animations, hint: animations.length ? undefined : 'none yet — import humanoid FBX files with ir_import_animation' };
    },
  },
  {
    name: 'ir_set_storage',
    description: 'Choose which store keys are kept on the device across launches (project.storage.persist). ' +
      '"memory." keeps every key starting with memory.; any other entry is one exact key. Replaces the list.',
    inputSchema: schema({ persist: { type: 'array', items: { type: 'string' } } }, ['persist']),
    readOnly: false,
    async run(args, session) {
      if (!Array.isArray(args.persist) || args.persist.some((k: unknown) => typeof k !== 'string' || !k.trim())) {
        throw new Error('persist: an array of non-empty strings (store keys, or prefixes ending with ".")');
      }
      return write(session, args, (p) => {
        p.storage = { ...(p.storage ?? {}), persist: [...new Set(args.persist.map((k: string) => k.trim()))] };
        return { success: true, storage: p.storage };
      });
    },
  },
  {
    name: 'ir_place_model',
    description: 'Place an imported model (assetPath from ir_import_model_asset) in a scene. .vrm becomes a VRM character (blinks, breathes, looks at the user nearby; give it motion with ir_update_object character.animation).',
    inputSchema: schema({
      modelAssetPath: { type: 'string' }, name: { type: 'string' }, assetId: { type: 'string' },
      sceneId: { type: 'string' }, position: vec3, rotation: vec3, scale: vec3,
    }, ['modelAssetPath']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const s = scene(p, args.sceneId);
        const rel = toRel(args.modelAssetPath);
        const name = args.name || path.basename(rel, path.extname(rel)) || 'Model';
        const isVrm = path.extname(rel).toLowerCase() === '.vrm';
        const obj: Args = {
          id: uid(), name, type: isVrm ? 'vrm' : 'model', modelPath: rel,
          assetId: args.assetId || name, transform: transformFrom(args),
          // エディタで置いた VRM と同じ既定 (まばたき・呼吸・近くで見られたら見返す)
          ...(isVrm ? { character: { ...CHARACTER_DEFAULTS } } : {}),
        };
        s.objects.push(obj);
        return { success: true, object: obj, sceneId: s.id };
      });
    },
  },
  {
    name: 'ir_update_object_transform',
    description: 'Move / rotate / scale an object (partial vectors are merged).',
    inputSchema: schema({ objectId: { type: 'string' }, sceneId: { type: 'string' }, position: vec3, rotation: vec3, scale: vec3 }, ['objectId']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const { object } = findObject(p, args.objectId, args.sceneId);
        object.transform = transformFrom(args, object.transform);
        return { success: true, objectId: object.id, transform: object.transform };
      });
    },
  },
  {
    name: 'ir_update_object',
    description: 'Rename an object, change its assetId, color (#RRGGBB), primitiveType, a canvas panel\'s size / pixel density / layout, a camera\'s settings, ' +
      'or a VRM\'s character settings (animation, blink, breathe, lookAtUser, embody = move it with your own head and hands).',
    inputSchema: schema({
      objectId: { type: 'string' }, sceneId: { type: 'string' }, name: { type: 'string' }, assetId: { type: 'string' },
      color: { type: 'string' }, primitiveType: { type: 'string', enum: ['cube', 'sphere', 'plane', 'cylinder', 'capsule'] },
      canvas: {
        type: 'object',
        description: 'Canvas objects only: the panel size in space and its pixel density (pixels across = widthMeters × pixelsPerUnit; UI elements are laid out in those pixels), or another canvas layout',
        properties: { widthMeters: { type: 'number' }, heightMeters: { type: 'number' }, pixelsPerUnit: { type: 'number' }, layoutId: { type: 'string' } },
      },
      character: {
        type: ['object', 'null'],
        description: 'VRM only. Merged into the current settings; null removes them (the VRM then just stands relaxed: arms down, no blinking or animation).',
        properties: {
          animation: { type: 'string', description: 'Looping animation at start: an ir_list_animations name, "" for none' },
          blink: { type: 'boolean' }, breathe: { type: 'boolean' },
          lookAtUser: { type: 'string', enum: ['off', 'always', 'nearby'] },
          embody: {
            type: ['object', 'null'],
            description: 'Move this VRM as your own body: head follows your head, hands follow controllers / tracked hands; hidden from your own eyes but seen by cameras; mouth moves with your voice. Merged; null turns it off. Only one VRM should have it.',
            properties: {
              enabled: { type: 'boolean' },
              hands: { type: 'string', enum: ['auto', 'controllers', 'hands'] },
              lipSync: { type: 'boolean' }, hideFromSelf: { type: 'boolean' }, matchHeight: { type: 'boolean' },
            },
          },
        },
      },
      camera: {
        type: 'object',
        description: 'Camera objects only: settings merged into the current ones (fov, resolution [w, h], fps, backgroundColor, near, far, showSelf, showGizmo)',
        properties: {
          fov: { type: 'number' }, resolution: { type: 'array', items: { type: 'number' } }, fps: { type: 'number' },
          backgroundColor: { type: 'string' }, near: { type: 'number' }, far: { type: 'number' },
          showSelf: { type: 'boolean' }, showGizmo: { type: 'boolean' },
        },
      },
    }, ['objectId']),
    readOnly: false,
    async run(args, session) {
      if (args.camera !== undefined) {
        const err = checkCameraSettings(args.camera);
        if (err) throw new Error(err);
      }
      if (args.character && args.character.embody !== undefined && args.character.embody !== null) {
        const err = checkEmbodySettings(args.character.embody);
        if (err) throw new Error(`character.${err}`);
      }
      return write(session, args, (p) => {
        const { object } = findObject(p, args.objectId, args.sceneId);
        if (args.name !== undefined) object.name = args.name;
        if (args.assetId !== undefined) object.assetId = args.assetId;
        if (args.color !== undefined) object.material = { ...(object.material ?? {}), color: args.color };
        if (args.primitiveType !== undefined) {
          if (object.type !== 'primitive') throw new Error('primitiveType applies to primitives only');
          object.primitiveType = args.primitiveType;
        }
        if (args.canvas !== undefined) {
          if (object.type !== 'canvas') throw new Error('canvas applies to canvas objects only');
          const next = { ...(object.canvasSettings ?? {}) };
          for (const key of ['widthMeters', 'heightMeters', 'pixelsPerUnit']) {
            if (args.canvas[key] === undefined) continue;
            const v = Number(args.canvas[key]);
            if (!(v > 0)) throw new Error(`canvas.${key} must be a positive number`);
            next[key] = v;
          }
          if (args.canvas.layoutId !== undefined) {
            const l = layout(p, args.canvas.layoutId);
            if (l.scope !== 'canvas') throw new Error(`layout "${l.name}" is scope ${l.scope}; a canvas object needs a scope "canvas" layout`);
            next.layoutId = l.id;
          }
          object.canvasSettings = next;
        }
        if (args.character !== undefined) {
          if (object.type !== 'vrm') throw new Error('character applies to VRM objects only');
          if (args.character === null) delete object.character;
          else {
            const { embody, ...rest } = args.character;
            const next = { ...(object.character ?? CHARACTER_DEFAULTS), ...rest };
            if (!next.animation) delete next.animation;
            if (embody === null) delete next.embody;
            else if (embody !== undefined) next.embody = { ...(next.embody ?? EMBODY_DEFAULTS), ...embody };
            object.character = next;
          }
        }
        if (args.camera !== undefined) {
          if (object.type !== 'camera') throw new Error('camera applies to camera objects only (add one with ir_add_camera)');
          const next = { ...CAMERA_DEFAULTS, ...(object.camera ?? {}), ...args.camera };
          const err = checkCameraSettings(next);
          if (err) throw new Error(err);
          object.camera = next;
        }
        return { success: true, object };
      });
    },
  },
  {
    name: 'ir_remove_scene_object',
    description: 'Remove an object from a scene.',
    inputSchema: schema({ objectId: { type: 'string' }, sceneId: { type: 'string' } }, ['objectId']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const s = scene(p, args.sceneId);
        const before = s.objects.length;
        s.objects = s.objects.filter((o: Args) => o.id !== args.objectId && o.assetId !== args.objectId);
        return { success: before !== s.objects.length, objectId: args.objectId, sceneId: s.id };
      });
    },
  },
  {
    name: 'ir_add_canvas_object',
    description: 'Show a UI layout (scope canvas) as a panel in space. Without layoutId the first canvas layout is used.',
    inputSchema: schema({
      layoutId: { type: 'string' }, name: { type: 'string' }, sceneId: { type: 'string' },
      widthMeters: { type: 'number' }, heightMeters: { type: 'number' }, pixelsPerUnit: { type: 'number' },
      position: vec3, rotation: vec3, scale: vec3,
    }),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const s = scene(p, args.sceneId);
        const l = args.layoutId ? layout(p, args.layoutId) : (p.uiLayouts ?? []).find((x: Args) => x.scope === 'canvas');
        if (!l) throw new Error('no canvas layout: create one with ir_add_ui_layout (scope "canvas") first');
        if (l.scope !== 'canvas') throw new Error(`layout "${l.name}" is scope ${l.scope}; a canvas object needs a scope "canvas" layout`);
        const obj: Args = {
          id: uid(), name: args.name || 'Canvas', type: 'canvas',
          canvasSettings: {
            layoutId: l.id,
            widthMeters: Number(args.widthMeters ?? 1.6),
            heightMeters: Number(args.heightMeters ?? 0.9),
            pixelsPerUnit: Number(args.pixelsPerUnit ?? 1200),
          },
          transform: transformFrom(args, { position: { x: 0, y: -0.05, z: 1.8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }),
        };
        s.objects.push(obj);
        return { success: true, object: obj, sceneId: s.id };
      });
    },
  },

  // ---- UI ----
  {
    name: 'ir_list_ui_layouts',
    description: 'List UI layouts with scope and element counts.',
    inputSchema: schema({}),
    readOnly: true,
    async run(args, session) {
      const p = await read(session, args);
      return {
        layouts: (p.uiLayouts ?? []).map((l: Args) => ({
          id: l.id, name: l.name, scope: l.scope, resolution: l.resolution, rootId: l.root?.id,
          rootChildren: Array.isArray(l.root?.children) ? l.root.children.length : 0, elements: countElements(l.root),
        })),
      };
    },
  },
  {
    name: 'ir_get_ui_layout',
    description: 'The full element tree of a UI layout (by id or name).',
    inputSchema: schema({ layoutId: { type: 'string' } }),
    readOnly: true,
    async run(args, session) {
      return layout(await read(session, args), args.layoutId);
    },
  },
  {
    name: 'ir_add_ui_layout',
    description: 'Create a UI layout. scope "uhd" = fixed to the view, "canvas" = shown on a panel in space (then add it with ir_add_canvas_object).',
    inputSchema: schema({ name: { type: 'string' }, scope: { type: 'string', enum: ['uhd', 'canvas'] } }, ['name', 'scope']),
    readOnly: false,
    async run(args, session) {
      if (args.scope !== 'uhd' && args.scope !== 'canvas') throw new Error('scope: uhd | canvas');
      return write(session, args, (p) => {
        const l = {
          id: uid(), name: args.name, scope: args.scope,
          resolution: args.scope === 'canvas' ? { width: 1024, height: 1024 } : { width: 1920, height: 1080 },
          root: { id: uid(), type: 'Panel', layout: 'Absolute', style: { width: '100%', height: '100%' }, children: [] },
        };
        p.uiLayouts = [...(p.uiLayouts ?? []), l];
        return { success: true, layout: l };
      });
    },
  },
  {
    name: 'ir_update_ui_layout',
    description: 'Rename a UI layout or change its resolution (the pixel size the editor lays it out in; for a canvas layout match it to its panel: widthMeters × pixelsPerUnit).',
    inputSchema: schema({
      layoutId: { type: 'string' }, name: { type: 'string' },
      resolution: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } } },
    }, ['layoutId']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const l = layout(p, args.layoutId);
        if (args.name !== undefined) {
          if (!String(args.name).trim()) throw new Error('name must not be empty');
          l.name = String(args.name);
        }
        if (args.resolution !== undefined) {
          const width = Number(args.resolution.width ?? l.resolution?.width);
          const height = Number(args.resolution.height ?? l.resolution?.height);
          if (!(width > 0 && height > 0)) throw new Error('resolution width/height must be positive numbers');
          l.resolution = { width: Math.round(width), height: Math.round(height) };
        }
        return { success: true, layout: { id: l.id, name: l.name, scope: l.scope, resolution: l.resolution } };
      });
    },
  },
  {
    name: 'ir_remove_ui_layout',
    description: 'Delete a UI layout. Refused while a canvas object still shows it (remove or re-point that object first).',
    inputSchema: schema({ layoutId: { type: 'string' } }, ['layoutId']),
    readOnly: false,
    async run(args, session) {
      const result = await write(session, args, (p) => {
        const l = layout(p, args.layoutId);
        const users = (p.scenes ?? []).flatMap((sc: Args) => (sc.objects ?? []).filter((o: Args) => o.type === 'canvas' && o.canvasSettings?.layoutId === l.id).map((o: Args) => o.name));
        if (users.length > 0) throw new Error(`layout "${l.name}" is shown by ${users.join(', ')}; remove or re-point those canvas objects first`);
        p.uiLayouts = (p.uiLayouts ?? []).filter((x: Args) => x.id !== l.id);
        return { success: true, removed: { id: l.id, name: l.name } };
      });
      // 個別ファイルも消す (残すと「一覧に無いファイル」と言われ続ける)
      await fs.remove(path.join(session.resolve(args), 'UI', `${result.removed.id}.json`));
      return result;
    },
  },
  {
    name: 'ir_add_ui_element',
    description: 'Add a UI element (Panel, Text, Button, Image, Slider, Input, Gauge, Graph, Keyboard) under the layout root or a parent. bindingId names it for scripts/events; bind { key } shows a store value.',
    inputSchema: schema({
      layoutId: { type: 'string' }, parentElementId: { type: 'string' },
      type: { type: 'string', enum: ['Panel', 'Text', 'Button', 'Image', 'Slider', 'Input', 'Gauge', 'Graph', 'Keyboard'] },
      content: { type: 'string' }, bindingId: { type: 'string' }, assetPath: { type: 'string' },
      bind: { type: 'object', properties: { key: { type: 'string' }, format: { type: 'string' } } },
      style: { type: 'object' }, layout: { type: 'string', enum: ['FlexRow', 'FlexColumn', 'Absolute'] },
      reveal: { type: ['object', 'null'], properties: { speed: { type: 'number', description: 'letters per second' } }, description: 'Text/Button: the text appears letter by letter whenever it changes; null = all at once' },
      source: {
        type: ['object', 'null'],
        description: 'Image only: what it shows instead of assetPath. { kind: "camera", camera: <camera object id or assetId>, mirror? } shows a virtual camera live ' +
          '(mirror: true flips it like a mirror); { kind: "stream", url, mirror? } shows an MJPEG stream (e.g. a PC screen from products/ScreenCast: ' +
          '"http://{store:pc.address}/stream/slides" — {store:key} is replaced by that store value and reconnects when it changes). null = back to assetPath.',
        properties: { kind: { type: 'string', enum: ['camera', 'stream'] }, camera: { type: 'string' }, url: { type: 'string' }, mirror: { type: 'boolean' } },
      },
    }, ['type']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const l = layout(p, args.layoutId);
        const parent = args.parentElementId ? findElement(l.root, args.parentElementId) : l.root;
        if (!parent) throw new Error(`parent element not found: ${args.parentElementId}`);
        const element: Args = { id: uid(), type: args.type, style: args.style || {}, children: [] };
        for (const key of ['content', 'bindingId', 'assetPath', 'bind', 'layout']) if (args[key] !== undefined) element[key] = args[key];
        if (args.reveal) element.reveal = { speed: Number(args.reveal.speed) || 12 };
        if (args.source) element.source = sourceFrom(args.source, element.type, p);
        parent.children = Array.isArray(parent.children) ? parent.children : [];
        parent.children.push(element);
        return { success: true, layoutId: l.id, element };
      });
    },
  },
  {
    name: 'ir_update_ui_element',
    description: 'Change a UI element (by id or bindingId). style is merged.',
    inputSchema: schema({
      layoutId: { type: 'string' }, elementId: { type: 'string' }, type: { type: 'string' }, content: { type: 'string' },
      bindingId: { type: 'string' }, assetPath: { type: 'string' }, bind: { type: 'object' }, style: { type: 'object' }, layout: { type: 'string' },
      reveal: { type: ['object', 'null'], properties: { speed: { type: 'number', description: 'letters per second' } }, description: 'Text/Button: the text appears letter by letter whenever it changes; null = all at once' },
      source: {
        type: ['object', 'null'],
        description: 'Image only: what it shows instead of assetPath. { kind: "camera", camera: <camera object id or assetId>, mirror? } shows a virtual camera live ' +
          '(mirror: true flips it like a mirror); { kind: "stream", url, mirror? } shows an MJPEG stream (e.g. a PC screen from products/ScreenCast: ' +
          '"http://{store:pc.address}/stream/slides" — {store:key} is replaced by that store value and reconnects when it changes). null = back to assetPath.',
        properties: { kind: { type: 'string', enum: ['camera', 'stream'] }, camera: { type: 'string' }, url: { type: 'string' }, mirror: { type: 'boolean' } },
      },
    }, ['elementId']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const layouts: Args[] = args.layoutId ? [layout(p, args.layoutId)] : p.uiLayouts ?? [];
        for (const l of layouts) {
          const el = findElement(l.root, args.elementId);
          if (!el) continue;
          for (const key of ['type', 'content', 'bindingId', 'assetPath', 'bind', 'layout']) if (args[key] !== undefined) el[key] = args[key];
          if (args.style !== undefined) el.style = { ...(el.style ?? {}), ...args.style };
          if (args.reveal === null) delete el.reveal;
          else if (args.reveal !== undefined) el.reveal = { speed: Number(args.reveal.speed) || 12 };
          if (args.source === null) delete el.source;
          else if (args.source !== undefined) el.source = sourceFrom(args.source, el.type, p);
          return { success: true, layoutId: l.id, element: el };
        }
        throw new Error(`element not found: ${args.elementId}`);
      });
    },
  },
  {
    name: 'ir_remove_ui_element',
    description: 'Remove a UI element (and its children).',
    inputSchema: schema({ layoutId: { type: 'string' }, elementId: { type: 'string' } }, ['elementId']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const removeFrom = (node: Args): boolean => {
          if (!Array.isArray(node?.children)) return false;
          const before = node.children.length;
          node.children = node.children.filter((c: Args) => c.id !== args.elementId && c.bindingId !== args.elementId);
          if (node.children.length !== before) return true;
          return node.children.some((c: Args) => removeFrom(c));
        };
        const layouts: Args[] = args.layoutId ? [layout(p, args.layoutId)] : p.uiLayouts ?? [];
        for (const l of layouts) if (removeFrom(l.root)) return { success: true, layoutId: l.id, elementId: args.elementId };
        throw new Error(`element not found: ${args.elementId}`);
      });
    },
  },

  // ---- データフロー (旧ツールと同じ) ----
  {
    name: 'ir_add_datasource',
    description: 'Add a data source (XR_Tracker, Device_Status, REST_Client, WebSocket_Stream, System_Clock, Microphone_Level, …) that writes to the store under storeAs.',
    inputSchema: schema({ type: { type: 'string' }, mode: { type: 'string', enum: ['polling', 'event'] }, storeAs: { type: 'string' }, updateRate: { type: 'number' }, parameters: { type: 'object' } }, ['type', 'mode', 'storeAs']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const ds: Args = { id: uid(), type: args.type, mode: args.mode, storeAs: args.storeAs };
        if (args.updateRate !== undefined) ds.updateRate = args.updateRate;
        if (args.parameters !== undefined) ds.parameters = args.parameters;
        p.dataFlow.dataSources.push(ds);
        return { success: true, datasource: ds };
      });
    },
  },
  {
    name: 'ir_update_datasource',
    description: 'Change a data source.',
    inputSchema: schema({ datasourceId: { type: 'string' }, type: { type: 'string' }, mode: { type: 'string' }, storeAs: { type: 'string' }, updateRate: { type: 'number' }, parameters: { type: 'object' } }, ['datasourceId']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const ds = p.dataFlow.dataSources.find((d: Args) => d.id === args.datasourceId);
        if (!ds) throw new Error(`datasource not found: ${args.datasourceId}`);
        for (const key of ['type', 'mode', 'storeAs', 'updateRate', 'parameters']) if (args[key] !== undefined) ds[key] = args[key];
        return { success: true, datasource: ds };
      });
    },
  },
  {
    name: 'ir_remove_datasource',
    description: 'Remove a data source.',
    inputSchema: schema({ datasourceId: { type: 'string' } }, ['datasourceId']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const before = p.dataFlow.dataSources.length;
        p.dataFlow.dataSources = p.dataFlow.dataSources.filter((d: Args) => d.id !== args.datasourceId);
        if (before === p.dataFlow.dataSources.length) throw new Error(`datasource not found: ${args.datasourceId}`);
        return { success: true, datasourceId: args.datasourceId };
      });
    },
  },
  {
    name: 'ir_add_transform',
    description: 'Add a transform (Formula, Clamper, Remap, Smoother, Comparator, Threshold, State_Mapper, String_Template, Time_Formatter, History_Buffer, Accumulator) from store inputs to storeAs.',
    inputSchema: schema({ type: { type: 'string' }, inputs: { type: 'array', items: { type: 'string' } }, storeAs: { type: 'string' }, expression: { type: 'string' }, updateRate: { type: 'number' }, parameters: { type: 'object' } }, ['type', 'inputs', 'storeAs']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const tf: Args = { id: uid(), type: args.type, inputs: Array.isArray(args.inputs) ? args.inputs : [], storeAs: args.storeAs };
        for (const key of ['expression', 'updateRate', 'parameters']) if (args[key] !== undefined) tf[key] = args[key];
        p.dataFlow.transforms.push(tf);
        return { success: true, transform: tf };
      });
    },
  },
  {
    name: 'ir_update_transform',
    description: 'Change a transform.',
    inputSchema: schema({ transformId: { type: 'string' }, type: { type: 'string' }, inputs: { type: 'array', items: { type: 'string' } }, storeAs: { type: 'string' }, expression: { type: 'string' }, updateRate: { type: 'number' }, parameters: { type: 'object' } }, ['transformId']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const tf = p.dataFlow.transforms.find((t: Args) => t.id === args.transformId);
        if (!tf) throw new Error(`transform not found: ${args.transformId}`);
        for (const key of ['type', 'storeAs', 'expression', 'updateRate', 'parameters']) if (args[key] !== undefined) tf[key] = args[key];
        if (args.inputs !== undefined) tf.inputs = Array.isArray(args.inputs) ? args.inputs : [];
        return { success: true, transform: tf };
      });
    },
  },
  {
    name: 'ir_remove_transform',
    description: 'Remove a transform.',
    inputSchema: schema({ transformId: { type: 'string' } }, ['transformId']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const before = p.dataFlow.transforms.length;
        p.dataFlow.transforms = p.dataFlow.transforms.filter((t: Args) => t.id !== args.transformId);
        if (before === p.dataFlow.transforms.length) throw new Error(`transform not found: ${args.transformId}`);
        return { success: true, transformId: args.transformId };
      });
    },
  },

  // ---- スクリプト ----
  {
    name: 'ir_list_scripts',
    description: 'List scripts (id, name, trigger, enabled, size).',
    inputSchema: schema({}),
    readOnly: true,
    async run(args, session) {
      const p = await read(session, args);
      return { scripts: p.scripts.map((s: Args) => ({ id: s.id, name: s.name, trigger: s.trigger, enabled: s.enabled, lines: String(s.code ?? '').split('\n').length })) };
    },
  },
  {
    name: 'ir_get_script',
    description: 'One script with its code (by id or name).',
    inputSchema: schema({ scriptId: { type: 'string' } }, ['scriptId']),
    readOnly: true,
    async run(args, session) {
      const s = (await read(session, args)).scripts.find((x: Args) => x.id === args.scriptId || x.name === args.scriptId);
      if (!s) throw new Error(`script not found: ${args.scriptId}`);
      return s;
    },
  },
  {
    name: 'ir_check_script',
    description: 'Check JavaScript syntax without saving.',
    inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
    readOnly: true,
    async run(args) {
      return checkScriptSyntax(args.code);
    },
  },
  {
    name: 'ir_add_script',
    description: 'Add a script. trigger: { type: "onStart" | "onUpdate" | "interval" (value ms) | "event" (value = event name) }. Refuses code with syntax errors. Read arsist_script_reference first.',
    inputSchema: schema({
      name: { type: 'string' }, code: { type: 'string' }, enabled: { type: 'boolean' }, description: { type: 'string' },
      trigger: { type: 'object', properties: { type: { type: 'string', enum: TRIGGERS }, value: {} }, required: ['type'] },
    }, ['name', 'code', 'trigger']),
    readOnly: false,
    async run(args, session) {
      const syntax = checkScriptSyntax(args.code);
      if (!syntax.ok) throw new Error(`syntax error${syntax.line ? ` on line ${syntax.line}` : ''}: ${syntax.error}`);
      const trigger = normalizeTrigger(args.trigger);
      return write(session, args, (p) => {
        const now = new Date().toISOString();
        const s: Args = { id: uid(), name: args.name, trigger, code: args.code, enabled: args.enabled !== false, createdAt: now, updatedAt: now };
        if (args.description) s.description = args.description;
        p.scripts.push(s);
        return { success: true, script: { id: s.id, name: s.name, trigger: s.trigger, enabled: s.enabled } };
      });
    },
  },
  {
    name: 'ir_update_script',
    description: 'Change a script\'s code, name, trigger or enabled flag (by id or name). Refuses code with syntax errors.',
    inputSchema: schema({
      scriptId: { type: 'string' }, name: { type: 'string' }, code: { type: 'string' }, enabled: { type: 'boolean' },
      trigger: { type: 'object', properties: { type: { type: 'string', enum: TRIGGERS }, value: {} } },
    }, ['scriptId']),
    readOnly: false,
    async run(args, session) {
      if (args.code !== undefined) {
        const syntax = checkScriptSyntax(args.code);
        if (!syntax.ok) throw new Error(`syntax error${syntax.line ? ` on line ${syntax.line}` : ''}: ${syntax.error}`);
      }
      const trigger = args.trigger !== undefined ? normalizeTrigger(args.trigger) : undefined;
      return write(session, args, (p) => {
        const s = p.scripts.find((x: Args) => x.id === args.scriptId || x.name === args.scriptId);
        if (!s) throw new Error(`script not found: ${args.scriptId}`);
        if (args.name !== undefined) s.name = args.name;
        if (args.code !== undefined) s.code = args.code;
        if (args.enabled !== undefined) s.enabled = args.enabled;
        if (trigger) s.trigger = trigger;
        s.updatedAt = new Date().toISOString();
        return { success: true, script: { id: s.id, name: s.name, trigger: s.trigger, enabled: s.enabled } };
      });
    },
  },
  {
    name: 'ir_remove_script',
    description: 'Remove a script (by id or name).',
    inputSchema: schema({ scriptId: { type: 'string' } }, ['scriptId']),
    readOnly: false,
    async run(args, session) {
      return write(session, args, (p) => {
        const before = p.scripts.length;
        p.scripts = p.scripts.filter((x: Args) => x.id !== args.scriptId && x.name !== args.scriptId);
        if (before === p.scripts.length) throw new Error(`script not found: ${args.scriptId}`);
        return { success: true, scriptId: args.scriptId };
      });
    },
  },

  // ---- 拡張機能 ----
  {
    name: 'ir_list_extensions',
    description: 'Installed extensions: what they do, where they run, their settings and per-object options, script globals, which engine parts they replace (e.g. vrm-loader: the vrm10 extension loads VRM 1.0), whether this project enables them and whether they fit its target device.',
    inputSchema: schema({}),
    readOnly: true,
    async run(args, session) {
      let project: Args | null = null;
      try { project = await read(session, args); } catch { /* プロジェクト無しでも一覧は出す */ }
      const tags = project ? [...await deviceTagsFor(project.targetDevice), ...projectFeatureTags(project as any)] : [];
      const field = (f: ExtensionField) => ({ key: f.key, type: f.type, default: f.default, label: f.label.en, options: f.options?.map((o) => o.value), min: f.min, max: f.max });
      return {
        extensions: (await catalogManifests()).map(({ manifest: m }) => ({
          id: m.id, version: m.version, name: m.name.en, description: m.description.en,
          requires: m.requires, providesDevices: m.provides?.adapters ?? [], scriptGlobals: m.script?.globals ?? [],
          replacesEngineParts: (m.replaces ?? []).map((part) => ({ part, name: enginePartLabel(part, 'en'), description: enginePart(part)?.description.en })),
          settings: (m.data?.settings ?? []).map(field), objectOptions: (m.data?.object ?? []).map(field),
          enabled: project?.extensions?.[m.id]?.enabled === true,
          currentSettings: project?.extensions?.[m.id]?.settings,
          fitsTargetDevice: project ? matchTagQuery(m.requires, tags, { deferred: ['sdk'] }).ok : undefined,
        })),
      };
    },
  },
  {
    name: 'ir_set_extension',
    description: 'Enable or disable an extension for this project and/or change its settings (keys from ir_list_extensions).',
    inputSchema: schema({ id: { type: 'string' }, enabled: { type: 'boolean' }, settings: { type: 'object' } }, ['id']),
    readOnly: false,
    async run(args, session) {
      const m = (await catalogManifests()).find((c) => c.manifest.id === args.id)?.manifest;
      if (!m) throw new Error(`extension "${args.id}" is not installed`);
      if (args.settings) checkFieldValues(m.data?.settings, args.settings, `${m.id}.settings`);
      return write(session, args, (p) => {
        p.extensions = p.extensions ?? {};
        const state = p.extensions[m.id] ?? { ...newExtensionState(m), enabled: false };
        if (args.enabled !== undefined) state.enabled = args.enabled;
        else if (!p.extensions[m.id]) state.enabled = true;
        if (args.settings) state.settings = { ...state.settings, ...args.settings };
        p.extensions[m.id] = state;
        return { success: true, id: m.id, state };
      });
    },
  },
  {
    name: 'ir_set_object_extension',
    description: 'Set an extension\'s per-object options on a scene object (e.g. quest-room snapTo, quest-input grab). values null removes them.',
    inputSchema: schema({ objectId: { type: 'string' }, extensionId: { type: 'string' }, values: { type: ['object', 'null'] }, sceneId: { type: 'string' } }, ['objectId', 'extensionId']),
    readOnly: false,
    async run(args, session) {
      const m = (await catalogManifests()).find((c) => c.manifest.id === args.extensionId)?.manifest;
      if (!m) throw new Error(`extension "${args.extensionId}" is not installed`);
      if (args.values) checkFieldValues(m.data?.object, args.values, `${m.id} object options`);
      return write(session, args, (p) => {
        const { object } = findObject(p, args.objectId, args.sceneId);
        const ext = { ...(object.ext ?? {}) };
        if (args.values === null) delete ext[m.id];
        else ext[m.id] = { ...defaultObjectData(m), ...(ext[m.id] ?? {}), ...(args.values ?? {}) };
        if (Object.keys(ext).length > 0) object.ext = ext;
        else delete object.ext;
        const warn = p.extensions?.[m.id]?.enabled ? undefined : `extension ${m.id} is not enabled in this project yet (ir_set_extension)`;
        return { success: true, objectId: object.id, ext: object.ext ?? {}, warning: warn };
      });
    },
  },
  // Layster.Spatial (project.spatial.json) の道具。spatialTools.ts
  ...SPATIAL_TOOLS,
];

const BY_NAME = new Map(ARSIST_TOOLS.map((t) => [t.name, t]));

export interface ToolCallResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** ツールを 1 つ呼ぶ。例外は投げず、{ ok: false, error } にする (エージェントが読んで直せるように)。 */
export async function callArsistTool(session: ToolSession, name: string, args: Args | undefined): Promise<ToolCallResult> {
  const tool = BY_NAME.get(name);
  if (!tool) return { ok: false, error: `unknown tool: ${name}` };
  try {
    return { ok: true, result: await tool.run(args ?? {}, session) };
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? String(e) };
  }
}
