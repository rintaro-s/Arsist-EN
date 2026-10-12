/**
 * 手で書かれた IR (AI エージェントがテキストとして直接編集したものなど) を、エディタが描けるところまで補う。
 *
 * IR はテキストなので、エージェントは JSON を書き換えるだけで編集できる。ただ、足りない項目
 * (transform の無い物、children の無い UI 要素…) があると、画面がそこで落ちる。
 * ここでは「無ければ既定値」で埋め、埋めたことを notes に返す (エディタはコンソールに出す)。
 *
 *   - 意味は変えない: 書いてある値は、形が合っている限りそのまま
 *   - id が無いものには、位置から決まる id を付ける (読み直すたびに変わると選択が外れるため)
 *   - ここで補った値は、エディタが次に保存したときにファイルにも入る
 */
import type { SceneData, SceneObject, UIElement, UILayoutData, Vector3 } from './types';

const OBJECT_TYPES = new Set(['primitive', 'model', 'vrm', 'light', 'camera', 'empty', 'canvas']);
const PRIMITIVES = new Set(['cube', 'sphere', 'plane', 'cylinder', 'capsule']);
const UI_TYPES = new Set(['Panel', 'Text', 'Button', 'Image', 'Slider', 'Input', 'Gauge', 'Graph', 'Keyboard']);

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function vec(value: unknown, fallback: number): { value: Vector3; fixed: boolean } {
  const v = isObject(value) ? value : {};
  // [x, y, z] と書かれていても受ける (エージェントがよく書く形)
  const arr = Array.isArray(value) ? value : null;
  const pick = (key: 'x' | 'y' | 'z', i: number) => {
    const raw = arr ? arr[i] : v[key];
    return finite(raw) ? raw : fallback;
  };
  const out = { x: pick('x', 0), y: pick('y', 1), z: pick('z', 2) };
  const fixed = arr !== null || !isObject(value) || !finite(v.x) || !finite(v.y) || !finite(v.z);
  return { value: out, fixed };
}

/** シーン 1 つを補う。notes には「どこを何で埋めたか」を短く積む。 */
export function repairScene(scene: unknown, where: string, notes: string[]): SceneData {
  const s: Record<string, any> = isObject(scene) ? scene : {};
  if (!Array.isArray(s.objects)) {
    if (s.objects !== undefined) notes.push(`${where}: "objects" is not an array; treated as empty`);
    s.objects = [];
  }
  s.objects = s.objects.map((o: unknown, i: number) => repairObject(o, `${where} objects[${i}]`, `${s.id ?? 'scene'}-obj-${i}`, notes));
  return s as SceneData;
}

function repairObject(raw: unknown, where: string, fallbackId: string, notes: string[]): SceneObject {
  const o: Record<string, any> = isObject(raw) ? raw : {};
  const fixed: string[] = [];
  if (!isObject(raw)) fixed.push('not an object');
  if (typeof o.id !== 'string' || !o.id) { o.id = fallbackId; fixed.push('id'); }
  if (!OBJECT_TYPES.has(o.type)) {
    const guess = typeof o.modelPath === 'string'
      ? (/\.vrm$/i.test(o.modelPath) ? 'vrm' : 'model')
      : 'primitive';
    if (o.type !== undefined) fixed.push(`type "${o.type}" → ${guess}`);
    else fixed.push(`type → ${guess}`);
    o.type = guess;
  }
  if (o.type === 'primitive' && !PRIMITIVES.has(o.primitiveType)) { o.primitiveType = 'cube'; fixed.push('primitiveType'); }
  if (typeof o.name !== 'string' || !o.name) { o.name = o.type === 'primitive' ? o.primitiveType : o.type; fixed.push('name'); }

  const t = isObject(o.transform) ? o.transform : {};
  if (!isObject(o.transform)) fixed.push('transform');
  const position = vec(t.position, 0);
  const rotation = vec(t.rotation, 0);
  const scale = vec(t.scale, 1);
  if (isObject(o.transform)) {
    if (position.fixed) fixed.push('transform.position');
    if (rotation.fixed) fixed.push('transform.rotation');
    if (scale.fixed) fixed.push('transform.scale');
  }
  o.transform = { ...t, position: position.value, rotation: rotation.value, scale: scale.value };

  if (o.material !== undefined && !isObject(o.material)) { delete o.material; fixed.push('material'); }
  if (o.type === 'canvas' && !isObject(o.canvasSettings)) {
    o.canvasSettings = { layoutId: '', widthMeters: 1.2, heightMeters: 0.7, pixelsPerUnit: 1000 };
    fixed.push('canvasSettings');
  }
  if (o.children !== undefined) {
    if (!Array.isArray(o.children)) { delete o.children; fixed.push('children'); }
    else o.children = o.children.map((c: unknown, i: number) => repairObject(c, `${where}.children[${i}]`, `${o.id}-child-${i}`, notes));
  }
  if (fixed.length > 0) notes.push(`${where} (${o.name}): filled in ${fixed.join(', ')}`);
  return o as SceneObject;
}

/** UI レイアウト 1 つを補う。 */
export function repairUILayout(layout: unknown, where: string, notes: string[]): UILayoutData {
  const l: Record<string, any> = isObject(layout) ? layout : {};
  if (l.scope !== 'uhd' && l.scope !== 'canvas') {
    if (l.scope !== undefined) notes.push(`${where}: scope "${l.scope}" → uhd`);
    l.scope = 'uhd';
  }
  if (!isObject(l.resolution) || !finite(l.resolution.width) || !finite(l.resolution.height)) {
    l.resolution = l.scope === 'canvas' ? { width: 1024, height: 1024 } : { width: 1920, height: 1080 };
    notes.push(`${where}: filled in resolution`);
  }
  if (!isObject(l.root)) {
    l.root = { id: `${l.id ?? 'layout'}-root`, type: 'Panel', style: {}, children: [] };
    notes.push(`${where}: filled in root`);
  } else {
    l.root = repairElement(l.root, `${where} root`, `${l.id ?? 'layout'}-root`, notes);
  }
  return l as UILayoutData;
}

function repairElement(raw: Record<string, any>, where: string, fallbackId: string, notes: string[]): UIElement {
  const e = raw;
  const fixed: string[] = [];
  if (typeof e.id !== 'string' || !e.id) { e.id = fallbackId; fixed.push('id'); }
  if (!UI_TYPES.has(e.type)) { fixed.push(e.type === undefined ? 'type → Panel' : `type "${e.type}" → Panel`); e.type = 'Panel'; }
  if (!isObject(e.style)) { e.style = {}; fixed.push('style'); }
  if (!Array.isArray(e.children)) {
    if (e.children !== undefined) fixed.push('children');
    e.children = [];
  }
  e.children = e.children
    .filter((c: unknown) => {
      if (isObject(c)) return true;
      fixed.push('dropped a child that is not an object');
      return false;
    })
    .map((c: Record<string, any>, i: number) => repairElement(c, `${where} > children[${i}]`, `${e.id}-${i}`, notes));
  if (fixed.length > 0) notes.push(`${where} (${e.id}): ${fixed.join(', ')}`);
  return e as UIElement;
}
