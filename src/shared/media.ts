/**
 * カメラ・UI の画像に映すもの (source)・自分の体 (embody) の小道具 (Layster.Virtual β1.1.0〜、doc/23)。
 *
 * 既定を埋める (Unity に渡す前・エディタの表示)、MCP の値の確かめ、ビルド前の確かめ (ir_validate_project) が
 * ここを使う。型そのものは src/shared/types.ts。
 */
import {
  CAMERA_DEFAULTS,
  EMBODY_DEFAULTS,
  type ArsistProject,
  type CameraSettings,
  type EmbodySettings,
  type MediaSource,
  type SceneObject,
  type UIElement,
} from './types';

/** インスペクタの解像度の候補 (横長 2 つと縦長 1 つ) */
export const CAMERA_RESOLUTION_PRESETS: ReadonlyArray<readonly [number, number]> = [
  [1920, 1080],
  [1280, 720],
  [1080, 1920],
];
/** 解像度の一辺の下限・上限 (px)。外れたらビルド前の確かめで error */
export const CAMERA_RESOLUTION_MIN = 16;
export const CAMERA_RESOLUTION_MAX = 4096;

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** 既定を埋めたカメラの設定 (足りない項目は CAMERA_DEFAULTS)。 */
export function cameraSettingsOf(settings: CameraSettings | undefined | null): Required<CameraSettings> {
  const s = (isObj(settings) ? settings : {}) as Record<string, unknown>;
  const out: Required<CameraSettings> = { ...CAMERA_DEFAULTS, resolution: [...CAMERA_DEFAULTS.resolution] as [number, number] };
  for (const key of Object.keys(CAMERA_DEFAULTS) as Array<keyof CameraSettings>) {
    if (s[key] !== undefined && s[key] !== null) (out as Record<string, unknown>)[key] = s[key];
  }
  // 形の崩れた解像度は既定に戻す (食い違いは mediaIssues が言う)
  out.resolution = Array.isArray(out.resolution) && out.resolution.length === 2
    ? [Number(out.resolution[0]), Number(out.resolution[1])]
    : [...CAMERA_DEFAULTS.resolution] as [number, number];
  return out;
}

/** 既定を埋めた embody (足りない項目は EMBODY_DEFAULTS。enabled が書かれていなければ true)。 */
export function embodySettingsOf(settings: EmbodySettings | undefined | null): Required<EmbodySettings> {
  const s = (isObj(settings) ? settings : {}) as Record<string, unknown>;
  const out: Required<EmbodySettings> = { ...EMBODY_DEFAULTS };
  for (const key of Object.keys(EMBODY_DEFAULTS) as Array<keyof EmbodySettings>) {
    if (s[key] !== undefined && s[key] !== null) (out as Record<string, unknown>)[key] = s[key];
  }
  return out;
}

/** 物 (と子) を平らに並べる */
export function allSceneObjects(project: Pick<ArsistProject, 'scenes'>): SceneObject[] {
  const out: SceneObject[] = [];
  const visit = (objects: SceneObject[] | undefined) => {
    for (const obj of objects ?? []) {
      out.push(obj);
      visit(obj.children);
    }
  };
  for (const scene of project.scenes ?? []) visit(scene.objects);
  return out;
}

export function cameraObjects(project: Pick<ArsistProject, 'scenes'>): SceneObject[] {
  return allSceneObjects(project).filter((o) => o.type === 'camera');
}

/** source.camera の参照 (物の id か assetId) からカメラの物を引く。無ければ undefined */
export function findCameraObject(project: Pick<ArsistProject, 'scenes'>, ref: string | undefined): SceneObject | undefined {
  if (!ref) return undefined;
  const cams = cameraObjects(project);
  return cams.find((o) => o.id === ref) ?? cams.find((o) => o.assetId === ref);
}

/** スクリプト・source から呼ぶときの名前 (assetId があればそれ、無ければ id) */
export function cameraRefOf(obj: SceneObject): string {
  return obj.assetId || obj.id;
}

/** VRM を自分の体として動かしているか (character.embody があって enabled が false でない) */
export function isEmbodied(obj: SceneObject): boolean {
  return obj.type === 'vrm' && isObj(obj.character?.embody) && obj.character!.embody!.enabled !== false;
}

/** {store:<key>} を除いた url が http(s) で始まるか。全体が {store:…} で始まるものは確かめられないので通す */
export function streamUrlLooksValid(url: string): boolean {
  const u = String(url ?? '').trim();
  if (!u) return false;
  if (/^\{store:[^}]+\}/.test(u)) return true;
  return /^https?:\/\//i.test(u.replace(/\{store:[^}]*\}/g, 'x'));
}

/** url の中の {store:<key>} のキー */
export function storeKeysInUrl(url: string): string[] {
  return [...String(url ?? '').matchAll(/\{store:([^}]+)\}/g)].map((m) => m[1].trim());
}

// ---- 値の確かめ (MCP の入口) ------------------------------------------------

/** CameraSettings として読めるか (部分で可)。だめなら理由を返す */
export function checkCameraSettings(value: unknown): string | null {
  if (!isObj(value)) return 'camera must be an object';
  const known = new Set(Object.keys(CAMERA_DEFAULTS));
  for (const key of Object.keys(value)) if (!known.has(key)) return `camera: unknown key "${key}" (known: ${[...known].join(', ')})`;
  const num = (key: string, min: number, max: number) => {
    if (value[key] === undefined) return null;
    const v = value[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return `camera.${key} must be a number ${min}..${max}`;
    return null;
  };
  const err = num('fov', 1, 179) ?? num('fps', 0, 120) ?? num('near', 0.001, 10) ?? num('far', 0.1, 100000);
  if (err) return err;
  if (value.near !== undefined && value.far !== undefined && value.near >= value.far) return 'camera.near must be smaller than camera.far';
  if (value.resolution !== undefined) {
    const r = value.resolution;
    if (!Array.isArray(r) || r.length !== 2 || r.some((n) => typeof n !== 'number' || !Number.isInteger(n) || n < CAMERA_RESOLUTION_MIN || n > CAMERA_RESOLUTION_MAX)) {
      return `camera.resolution must be [width, height] in whole pixels, each ${CAMERA_RESOLUTION_MIN}..${CAMERA_RESOLUTION_MAX}`;
    }
  }
  if (value.backgroundColor !== undefined && (typeof value.backgroundColor !== 'string' || !HEX.test(value.backgroundColor))) {
    return 'camera.backgroundColor must be #RRGGBB';
  }
  for (const key of ['showSelf', 'showGizmo']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') return `camera.${key} must be true/false`;
  }
  return null;
}

/** MediaSource として読めるか。project を渡すとカメラの参照先も確かめる */
export function checkMediaSource(value: unknown, project?: Pick<ArsistProject, 'scenes'>): string | null {
  if (!isObj(value)) return 'source must be an object ({ kind: "camera", camera } or { kind: "stream", url }) or null';
  if (value.mirror !== undefined && typeof value.mirror !== 'boolean') return 'source.mirror must be true/false';
  if (value.kind === 'camera') {
    for (const key of Object.keys(value)) if (!['kind', 'camera', 'mirror'].includes(key)) return `source: unknown key "${key}" for kind camera`;
    if (typeof value.camera !== 'string' || !value.camera.trim()) return 'source.camera must be the id or assetId of a camera object';
    if (project && !findCameraObject(project, value.camera)) {
      const known = cameraObjects(project).map(cameraRefOf);
      return `source.camera "${value.camera}" is not a camera object (cameras: ${known.join(', ') || 'none — add one with ir_add_camera'})`;
    }
    return null;
  }
  if (value.kind === 'stream') {
    for (const key of Object.keys(value)) if (!['kind', 'url', 'mirror'].includes(key)) return `source: unknown key "${key}" for kind stream`;
    if (typeof value.url !== 'string' || !value.url.trim()) return 'source.url must be a non-empty string (e.g. "http://{store:pc.address}/stream/slides")';
    return null;
  }
  return 'source.kind must be "camera" or "stream"';
}

/** EmbodySettings として読めるか (部分で可) */
export function checkEmbodySettings(value: unknown): string | null {
  if (!isObj(value)) return 'embody must be an object or null';
  const known = new Set(Object.keys(EMBODY_DEFAULTS));
  for (const key of Object.keys(value)) if (!known.has(key)) return `embody: unknown key "${key}" (known: ${[...known].join(', ')})`;
  for (const key of ['enabled', 'lipSync', 'hideFromSelf', 'matchHeight']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') return `embody.${key} must be true/false`;
  }
  if (value.hands !== undefined && !['auto', 'controllers', 'hands'].includes(value.hands)) return 'embody.hands must be auto | controllers | hands';
  return null;
}

// ---- ビルド前の確かめ --------------------------------------------------------

function visitElements(node: UIElement | undefined, fn: (el: UIElement) => void): void {
  if (!node) return;
  fn(node);
  for (const child of node.children ?? []) visitElements(child, fn);
}

/**
 * カメラ・source・embody の食い違い。problems はビルドしても動かないもの、warnings は動くが多分意図と違うもの。
 * MCP の ir_validate_project が使う。
 */
export function mediaIssues(project: Pick<ArsistProject, 'scenes' | 'uiLayouts'>): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const cam of cameraObjects(project)) {
    const raw = cam.camera;
    if (raw !== undefined && !isObj(raw)) { problems.push(`camera "${cam.name}": camera settings must be an object`); continue; }
    const s = cameraSettingsOf(raw);
    const res: unknown = raw?.resolution ?? CAMERA_DEFAULTS.resolution;
    const okSide = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= CAMERA_RESOLUTION_MIN && n <= CAMERA_RESOLUTION_MAX;
    if (!Array.isArray(res) || res.length !== 2 || !okSide(res[0]) || !okSide(res[1])) {
      problems.push(`camera "${cam.name}": resolution ${JSON.stringify(raw?.resolution)} must be two sides of ${CAMERA_RESOLUTION_MIN}..${CAMERA_RESOLUTION_MAX} px`);
    }
    if (!(s.fov > 0 && s.fov < 180)) problems.push(`camera "${cam.name}": fov ${s.fov} must be between 1 and 179 degrees`);
    if (!(s.near > 0 && s.far > s.near)) problems.push(`camera "${cam.name}": near ${s.near} / far ${s.far} must satisfy 0 < near < far`);
    if (!(s.fps >= 0)) problems.push(`camera "${cam.name}": fps ${s.fps} must be 0 or more`);
  }

  for (const layout of project.uiLayouts ?? []) {
    visitElements(layout.root, (el) => {
      const src = el.source as MediaSource | undefined;
      if (src === undefined || src === null) return;
      const where = `UI "${layout.name}" element ${el.bindingId ? `"${el.bindingId}"` : el.id}`;
      if (el.type !== 'Image') warnings.push(`${where}: source only works on Image elements (this is ${el.type}); it is ignored`);
      if (!isObj(src)) { problems.push(`${where}: source must be an object`); return; }
      if (src.kind === 'camera') {
        if (!findCameraObject(project, src.camera)) {
          const known = cameraObjects(project).map(cameraRefOf);
          problems.push(`${where}: shows camera "${src.camera ?? ''}", but there is no camera object with that id or assetId (cameras: ${known.join(', ') || 'none'})`);
        }
      } else if (src.kind === 'stream') {
        if (!streamUrlLooksValid(src.url)) {
          warnings.push(`${where}: stream url "${src.url ?? ''}" should start with http:// or https:// (e.g. "http://{store:pc.address}/stream/slides")`);
        }
      } else {
        problems.push(`${where}: source.kind must be "camera" or "stream"`);
      }
    });
  }

  const embodied = allSceneObjects(project).filter(isEmbodied);
  if (embodied.length > 1) {
    warnings.push(`${embodied.length} VRMs are set to move as your body (${embodied.map((o) => `"${o.name}"`).join(', ')}); only one can follow your head and hands — turn embody off on the others`);
  }
  return { problems, warnings };
}
