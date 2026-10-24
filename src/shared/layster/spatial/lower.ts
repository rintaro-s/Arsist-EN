/**
 * Layster.Spatial → 第3層 (ビルドの中間ファイル) への書き出し (doc/19-layster.md §4.1)。
 *
 * Spatial のプロジェクトを、今のビルド (UnityBuilder) が受け取る 5 つにする:
 *   manifestData  UnityBridge.generateBuildManifest に「内部用の ArsistProject」を渡したもの
 *                 (ビルドの機能判定・拡張機能・モデル・ログの中継を Virtual と共有する)
 *   scenesData    シーン 1 つ。物 1 つにつき Unity のシーンの物 1 つ (id = assetId = thing の id)
 *   uiData        パネル・札ごとの canvas レイアウト (layster-<thing id>)
 *   scriptsData   Spatial のスクリプト + memory.persist
 *   spatialData   spatial.json。ランタイム (ArsistSpatialRuntime) が読む
 *
 * 内部用の ArsistProject は IR ではない (保存しない・エディタに見せない)。Virtual と Spatial の互換のためのものではなく、
 * ビルドの機械を 1 つで済ませるための第3層の形。
 */

import { generateBuildManifest } from '../../../bridge/UnityBridge';
import { CURRENT_IR_VERSION } from '../../irVersion';
import type {
  ArsistProject, ARSettings, SceneData, SceneObject, ScriptBundle, UIElement, UILayoutData,
} from '../../types';
import { thingSize } from './solver';
import type { Mind, PanelItem, SpatialProject, Thing, Vec3 } from './types';
import { vocabularyForRuntime } from './vocabulary';

export const SPATIAL_RUNTIME_FORMAT = 'layster.spatial.runtime/1';

/** Unity のシーンの物の、置き場所が決まるまでの位置 (見えない所)。ランタイムが解いてから動かして出す */
const HIDDEN_POSITION = { x: 0, y: -10, z: 0 };
const DEFAULT_PPM = 1000;
const DEFAULT_TEXT_SIZE = 32;
const ITEM_GAP = 16;
/** Unity 側の RectTransform の最小の大きさ (ArsistBuildPipeline.ApplyRectTransformStyle の MIN_SIZE) */
const MIN_RECT = 50;

export class LowerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LowerError';
  }
}

export interface LowerOptions {
  /** 鍵の値 (.layster/secrets.local.json)。Mind の auth.secret をここから引く */
  secrets?: Record<string, string>;
  /** ビルドで選んだ端末 (IR の targetDevice より優先) */
  targetDevice?: string;
}

export interface SpatialRuntimeThing {
  id: string;
  name: string;
  kind: Thing['visual']['kind'];
  object: string;
  size: Vec3;
  place: Thing['place'];
  visibleAtStart: boolean;
  occlusion: 'auto' | 'off';
  grabbable: boolean;
  shape?: { shape: string; color: string; opacity?: number };
  model?: { height: number };
  character?: { height: number; animation?: string };
  panel?: { layoutId: string; bindings: Record<string, string> };
}

export type SpatialRuntimeMind = Omit<Mind, 'auth'> & { auth?: { header: string; value: string } };

export interface SpatialRuntimeData {
  format: typeof SPATIAL_RUNTIME_FORMAT;
  layster: SpatialProject['layster'];
  name: string;
  edge: string;
  presentation: SpatialProject['presentation'];
  interaction: SpatialProject['interaction'];
  vocabulary: ReturnType<typeof vocabularyForRuntime>;
  things: SpatialRuntimeThing[];
  minds: SpatialRuntimeMind[];
  bodies: SpatialProject['bodies'];
  rules: SpatialProject['rules'];
  recording: SpatialProject['recording'];
  memory: SpatialProject['memory'];
}

export interface LoweredSpatialBuild {
  manifestData: Record<string, unknown>;
  scenesData: SceneData[];
  uiData: UILayoutData[];
  scriptsData: ScriptBundle;
  spatialData: SpatialRuntimeData;
  /** APK に焼き込んだ鍵の名前 (ログで知らせる。値は入れない) */
  bakedSecrets: string[];
  warnings: string[];
}

// ========================================
// パネル → canvas レイアウト
// ========================================

/** 文字 1 つの幅 (px) の見積もり。全角は字の大きさ、半角はその 0.55 倍 */
function charWidth(ch: string, size: number): number {
  return /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? size : size * 0.55;
}

/** 文字が幅 width (px) の中で何行になるか。 */
export function estimateLines(text: string, size: number, width: number): number {
  let lines = 0;
  for (const segment of String(text ?? '').split('\n')) {
    let w = 0;
    for (const ch of segment) w += charWidth(ch, size);
    lines += Math.max(1, Math.ceil(w / Math.max(1, width)));
  }
  return Math.max(1, lines);
}

function itemHeight(item: PanelItem, width: number): number {
  switch (item.type) {
    case 'text': {
      const size = item.size ?? DEFAULT_TEXT_SIZE;
      return Math.max(MIN_RECT, Math.ceil(estimateLines(item.text, size, width) * size * 1.35));
    }
    case 'button':
    case 'input':
      return Math.max(MIN_RECT, Math.ceil((item.size ?? DEFAULT_TEXT_SIZE) * 2.2));
    case 'image': return Math.max(MIN_RECT, item.height);
    case 'space': return Math.max(0, item.height);
    case 'row': {
      const n = Math.max(1, item.items.length);
      const gap = item.gap ?? ITEM_GAP;
      const w = (width - gap * (n - 1)) / n;
      return item.items.reduce((h, child) => Math.max(h, itemHeight(child, w)), 0);
    }
  }
}

/** パネルの項目の bindingId。ボタンは event か <thing>.<item>、id のある文字・入力・画像は <thing>.<item> */
export function panelBindingId(thingId: string, item: PanelItem): string | undefined {
  if (item.type === 'button') return item.event || `${thingId}.${item.id}`;
  if ((item.type === 'text' || item.type === 'input' || item.type === 'image') && item.id) return `${thingId}.${item.id}`;
  return undefined;
}

function lowerItems(
  thingId: string, items: PanelItem[], left: number, top: number, width: number,
  out: UIElement[], bindings: Record<string, string>,
): number {
  let y = top;
  items.forEach((item, i) => {
    if (i > 0) y += ITEM_GAP;
    const h = itemHeight(item, width);
    if (item.type === 'row') {
      const n = Math.max(1, item.items.length);
      const gap = item.gap ?? ITEM_GAP;
      const w = (width - gap * (n - 1)) / n;
      item.items.forEach((child, j) => {
        lowerItems(thingId, [child], left + j * (w + gap), y, w, out, bindings);
      });
      y += h;
      return;
    }
    if (item.type === 'space') { y += h; return; }
    const style = { position: 'absolute' as const, left: Math.round(left), top: Math.round(y), width: Math.round(width), height: Math.round(h) };
    const binding = panelBindingId(thingId, item);
    if (binding && 'id' in item && item.id) bindings[item.id] = binding;
    const id = `${thingId}-${out.length + 1}`;
    switch (item.type) {
      case 'text':
        out.push({
          id, type: 'Text', content: item.text, children: [],
          ...(binding ? { bindingId: binding } : {}),
          ...(item.bind ? { bind: { key: item.bind } } : {}),
          ...(item.reveal ? { reveal: { speed: item.reveal } } : {}),
          style: { ...style, fontSize: item.size ?? DEFAULT_TEXT_SIZE, color: item.color ?? '#FFFFFF', textAlign: item.align ?? 'left' },
        });
        break;
      case 'button':
        out.push({
          id, type: 'Button', content: item.text, children: [], bindingId: binding,
          style: {
            ...style, fontSize: item.size ?? DEFAULT_TEXT_SIZE, color: item.color ?? '#FFFFFF',
            backgroundColor: item.background ?? '#3A6FD8', borderRadius: 12,
          },
        });
        break;
      case 'input':
        out.push({
          id, type: 'Input', content: item.placeholder ?? '', children: [], bindingId: binding, bind: { key: item.bind },
          style: { ...style, fontSize: item.size ?? DEFAULT_TEXT_SIZE, color: '#FFFFFF', backgroundColor: '#FFFFFF14', borderRadius: 8 },
        });
        break;
      case 'image':
        out.push({ id, type: 'Image', assetPath: item.file, children: [], ...(binding ? { bindingId: binding } : {}), style });
        break;
    }
    y += h;
  });
  return y;
}

function canvasLayout(thingId: string, name: string, width: number, height: number, background: string, radius: number, children: UIElement[]): UILayoutData {
  return {
    id: `layster-${thingId}`,
    name,
    scope: 'canvas',
    resolution: { width, height },
    root: {
      id: `layster-${thingId}-root`,
      type: 'Panel',
      layout: 'Absolute',
      style: { width: '100%', height: '100%', backgroundColor: background, borderRadius: radius },
      children,
    },
  };
}

// ========================================
// 物 → シーンの物
// ========================================

interface LoweredThing {
  object: SceneObject;
  layout?: UILayoutData;
  runtime: SpatialRuntimeThing;
}

function lowerThing(thing: Thing, warnings: string[]): LoweredThing {
  const v = thing.visual;
  const size = thingSize(v);
  const name = thing.name || thing.id;
  const base: SceneObject = {
    id: thing.id,
    name,
    assetId: thing.id,
    type: 'empty',
    transform: { position: { ...HIDDEN_POSITION }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ...(thing.ext && Object.keys(thing.ext).length > 0 ? { ext: thing.ext } : {}),
  };
  const runtime: SpatialRuntimeThing = {
    id: thing.id,
    name,
    kind: v.kind,
    object: thing.id,
    size,
    place: thing.place,
    visibleAtStart: thing.visibleAtStart !== false,
    occlusion: thing.occlusion ?? 'auto',
    grabbable: thing.grabbable === true,
  };

  switch (v.kind) {
    case 'shape': {
      // Unity の円柱・カプセルは高さ 2 m、それ以外は 1 m。quad は薄い箱 (向きをランタイムの yaw だけで決められるように)
      const primitive = v.shape === 'quad' ? 'cube' : v.shape;
      const ySpan = v.shape === 'cylinder' || v.shape === 'capsule' ? 2 : 1;
      const depth = v.shape === 'quad' ? 0.002 : v.size[2];
      runtime.shape = { shape: v.shape, color: v.color, ...(v.opacity !== undefined ? { opacity: v.opacity } : {}) };
      return {
        runtime,
        object: {
          ...base,
          type: 'primitive',
          primitiveType: primitive,
          transform: { ...base.transform, scale: { x: v.size[0], y: v.size[1] / ySpan, z: depth } },
          material: { color: v.color, metallic: 0, roughness: 0.5 },
        },
      };
    }
    case 'model':
      runtime.model = { height: v.height ?? size[1] };
      return { runtime, object: { ...base, type: 'model', modelPath: v.file } };
    case 'character':
      runtime.character = { height: v.height ?? size[1], ...(v.animation ? { animation: v.animation } : {}) };
      return {
        runtime,
        object: {
          ...base,
          type: 'vrm',
          modelPath: v.file,
          character: {
            ...(v.animation ? { animation: v.animation } : {}),
            blink: v.blink ?? true,
            breathe: v.breathe ?? true,
            lookAtUser: v.lookAtUser ?? 'nearby',
          },
        },
      };
    case 'panel': {
      const ppm = v.ppm ?? DEFAULT_PPM;
      const width = Math.max(MIN_RECT, Math.round(v.size[0] * ppm));
      const height = Math.max(MIN_RECT, Math.round(v.size[1] * ppm));
      const padding = v.padding ?? 24;
      const children: UIElement[] = [];
      const bindings: Record<string, string> = {};
      const bottom = lowerItems(thing.id, v.items ?? [], padding, padding, width - padding * 2, children, bindings);
      if (bottom + padding > height + 1) {
        warnings.push(`things[${thing.id}]: the items need about ${Math.round(bottom + padding)} px but the panel is ${height} px tall (${v.size[1]} m × ${ppm} px/m); the bottom is cut off`);
      }
      const layout = canvasLayout(thing.id, name, width, height, v.background ?? '#1E1E28E6', 24, children);
      runtime.panel = { layoutId: layout.id, bindings };
      return {
        runtime,
        layout,
        object: {
          ...base,
          type: 'canvas',
          canvasSettings: { layoutId: layout.id, widthMeters: v.size[0], heightMeters: v.size[1], pixelsPerUnit: ppm },
        },
      };
    }
    case 'label': {
      const h = v.height ?? 0.04;
      // 文字の箱が Unity の最小 (50 px) を下回らないよう、小さい札ほど細かくする
      const ppm = Math.max(DEFAULT_PPM, 64 / h);
      const width = Math.max(MIN_RECT, Math.round(size[0] * ppm));
      const height = Math.max(MIN_RECT, Math.round(size[1] * ppm));
      const binding = `${thing.id}.text`;
      const layout = canvasLayout(thing.id, name, width, height, '#00000080', 8, [{
        id: `${thing.id}-1`, type: 'Text', content: v.text, bindingId: binding, children: [],
        style: { position: 'absolute', left: 0, top: 0, width, height, fontSize: Math.round(height * 0.75), color: v.color ?? '#FFFFFF', textAlign: 'center' },
      }]);
      runtime.panel = { layoutId: layout.id, bindings: { text: binding } };
      return {
        runtime,
        layout,
        object: {
          ...base,
          type: 'canvas',
          canvasSettings: { layoutId: layout.id, widthMeters: size[0], heightMeters: size[1], pixelsPerUnit: ppm },
        },
      };
    }
    case 'marker':
      return { runtime, object: base };
  }
}

// ========================================
// Mind の鍵
// ========================================

function lowerMind(mind: Mind, secrets: Record<string, string>, baked: Set<string>): SpatialRuntimeMind {
  const { auth, ...rest } = mind;
  if (!auth) return rest;
  const value = secrets[auth.secret];
  if (value === undefined || value === '') {
    throw new LowerError(`minds[${mind.id}]: the secret "${auth.secret}" is not set (Mind settings → key, or .layster/secrets.local.json)`);
  }
  baked.add(auth.secret);
  const scheme = auth.scheme ?? 'Bearer';
  return { ...rest, auth: { header: auth.header || 'Authorization', value: scheme ? `${scheme} ${value}` : value } };
}

// ========================================
// まとめ
// ========================================

function arSettingsFor(project: SpatialProject): ARSettings {
  return {
    trackingMode: '6dof',
    presentationMode: 'world_anchored',
    worldScale: 1,
    defaultDepth: 2,
    enableRemoteControl: false,
    remoteControlPort: 8765,
    remoteControlPassword: '',
    // 現実を見せない設定のときは暗い単色 (仮の部屋はランタイムが描く)
    backgroundMode: project.presentation?.reality === 'virtual-room' ? 'solidColor' : 'passthrough',
    backgroundColor: '#101014',
    interaction: {
      controllerRay: project.interaction?.controllers !== false,
      handTracking: project.interaction?.hands === true,
      ...(project.interaction?.gazeDwellSeconds ? { gazeDwellSeconds: project.interaction.gazeDwellSeconds } : {}),
    },
  };
}

/** Spatial のプロジェクトを、ビルドに渡す 5 つにする。鍵が足りなければ LowerError。 */
export function lowerSpatialProject(project: SpatialProject, options: LowerOptions = {}): LoweredSpatialBuild {
  const warnings: string[] = [];
  const baked = new Set<string>();
  const secrets = options.secrets ?? {};
  const targetDevice = options.targetDevice || project.targetDevice;

  const lowered = (project.things ?? []).map((t) => lowerThing(t, warnings));
  const scene: SceneData = { id: 'layster-scene', name: project.name || 'Spatial', objects: lowered.map((l) => l.object) };
  const uiLayouts = lowered.flatMap((l) => (l.layout ? [l.layout] : []));
  const minds = (project.minds ?? []).map((m) => lowerMind(m, secrets, baked));

  const now = new Date().toISOString();
  const scripts = (project.scripts ?? []).map((s) => ({
    id: s.id, name: s.name, trigger: s.trigger, code: s.code, enabled: s.enabled, createdAt: now, updatedAt: now,
  }));
  const persist = project.memory?.persist ?? [];

  // ビルドの機械に渡すための、内部用の ArsistProject (保存しない)
  const internal: ArsistProject = {
    id: project.id,
    name: project.name,
    version: project.version,
    irVersion: CURRENT_IR_VERSION,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    appType: '3d_ar_scene',
    targetDevice,
    arSettings: arSettingsFor(project),
    designSystem: {
      defaultFont: 'Roboto-Regular.ttf',
      primaryColor: '#569cd6',
      secondaryColor: '#4ec9b0',
      backgroundColor: '#1e1e1e',
      textColor: '#FFFFFF',
    },
    dataFlow: { dataSources: [], transforms: [] },
    scenes: [scene],
    uiLayouts,
    buildSettings: {
      packageName: project.app.packageName,
      version: project.version,
      versionCode: project.app.versionCode,
      minSdkVersion: project.app.minSdkVersion,
      targetSdkVersion: project.app.targetSdkVersion,
    },
    scripts,
    models: project.models ?? [],
    extensions: project.extensions ?? {},
    storage: { persist },
  };

  const manifestData: Record<string, unknown> = {
    ...generateBuildManifest(internal, { targetDevice }),
    // Virtual の見出しが入っていても上書きする: この APK は Spatial
    layster: project.layster,
    scripting: { enabled: scripts.some((s) => s.enabled) },
    // スクリプトの中身からは分からない機能。UnityBuilder が features に足す (カメラは無いと ArsistPerceptionManager が入らない)
    requiresFeatures: requiredFeatures(project),
  };

  const scriptsData: ScriptBundle = {
    version: '1.0',
    scripts: scripts.filter((s) => s.enabled).map((s) => ({ id: s.id, trigger: s.trigger, code: s.code, enabled: s.enabled })),
    storage: { persist },
  };

  const spatialData: SpatialRuntimeData = {
    format: SPATIAL_RUNTIME_FORMAT,
    layster: project.layster,
    name: project.name,
    edge: project.app.edge ?? '',
    presentation: project.presentation,
    interaction: project.interaction,
    vocabulary: vocabularyForRuntime(),
    things: lowered.map((l) => l.runtime),
    minds,
    bodies: project.bodies ?? [],
    rules: project.rules ?? [],
    recording: project.recording,
    memory: { persist },
  };

  return { manifestData, scenesData: [scene], uiData: uiLayouts, scriptsData, spatialData, bakedSecrets: [...baked], warnings };
}

/** IR から決まる、ビルドに入れる機能。Mind がカメラの画を見る・記録にカメラを含める → feature:camera。 */
export function requiredFeatures(project: SpatialProject): string[] {
  const out: string[] = [];
  const minds = project.minds ?? [];
  const recordsCamera = !!project.recording?.enabled && (project.recording.streams ?? []).includes('camera');
  if (minds.some((m) => !!m.observe?.camera) || recordsCamera) out.push('feature:camera');
  return out;
}
