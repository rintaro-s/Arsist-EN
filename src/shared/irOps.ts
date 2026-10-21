/**
 * IR を書き換える「宣言的な操作」。
 *
 * IR の形を変えるたびに、移行 (migration) を手で書くのは面倒で、しかも間違えやすい
 * (冪等でない、配列の中を見落とす、別の型の値を壊す)。よくある変更はほとんどが
 *   - 項目を足す (無ければ既定値)
 *   - 名前を変える
 *   - 項目を消す
 *   - 値の言い換え ('old' → 'new')
 * のどれかなので、それを 1 行のデータで書けるようにしたのがこれ。
 *
 *   { op: 'default', path: 'arSettings.interaction.textInput', value: 'auto' }
 *   { op: 'rename',  path: 'scenes[].objects[].assetPath', to: 'modelPath' }
 *   { op: 'remove',  path: 'logicGraphs' }
 *   { op: 'map',     path: 'appType', values: { '3D_AR': '3d_ar_scene' } }
 *
 * どの操作も**冪等** (2 回掛けても 1 回と同じ)。エンジン本体の移行 (src/main/project/migrations.ts) と、
 * 拡張機能が自分のデータに掛ける移行 (extension.json の data.migrations) の両方がこれを使う。
 *
 * パスの書き方:
 *   a.b.c      入れ子の項目
 *   list[]     配列の要素すべて
 *   *          そのオブジェクトの値すべて (例: extensions.*.settings)
 * キーに `.` `[` `]` を含む項目は指せない (IR にはそういうキーを作らない)。
 */

export type IrOp =
  | { op: 'default'; path: string; value: unknown }
  | { op: 'set'; path: string; value: unknown }
  | { op: 'rename'; path: string; to: string }
  | { op: 'remove'; path: string }
  | { op: 'map'; path: string; values: Record<string, unknown> };

interface Segment {
  key?: string;
  /** key の値 (配列) の要素すべて */
  each?: boolean;
  /** そのオブジェクトの値すべて */
  wildcard?: boolean;
}

export function parseIrPath(path: string): Segment[] {
  if (typeof path !== 'string' || path.trim() === '') throw new Error('empty IR path');
  return path.split('.').map((part) => {
    if (part === '*') return { wildcard: true };
    if (part.endsWith('[]')) {
      const key = part.slice(0, -2);
      if (!key) throw new Error(`bad IR path segment "${part}" in "${path}"`);
      return { key, each: true };
    }
    if (!/^[A-Za-z0-9_$-]+$/.test(part)) throw new Error(`bad IR path segment "${part}" in "${path}"`);
    return { key: part };
  });
}

type Container = Record<string, any> | any[];

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * パスの最後の段を指す (親, キー) の組を全部集める。
 * create が真なら、途中のオブジェクトが無いときに {} を作る (配列は作らない)。
 */
function resolveSlots(root: unknown, segments: Segment[], create: boolean): Array<{ parent: Container; key: string | number }> {
  const slots: Array<{ parent: Container; key: string | number }> = [];

  const walk = (node: unknown, i: number) => {
    const seg = segments[i];
    const last = i === segments.length - 1;

    if (seg.wildcard) {
      if (!isPlainObject(node)) return;
      for (const k of Object.keys(node)) {
        if (last) slots.push({ parent: node, key: k });
        else walk(node[k], i + 1);
      }
      return;
    }

    if (!isPlainObject(node)) return;
    const key = seg.key!;

    if (seg.each) {
      const list = node[key];
      if (!Array.isArray(list)) return;
      for (let j = 0; j < list.length; j++) {
        if (last) slots.push({ parent: list, key: j });
        else walk(list[j], i + 1);
      }
      return;
    }

    if (last) {
      slots.push({ parent: node, key });
      return;
    }
    if (node[key] === undefined && create) node[key] = {};
    walk(node[key], i + 1);
  };

  walk(root, 0);
  return slots;
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/**
 * 操作を順に掛ける (その場で書き換える)。
 * 返すのは実際に変わったパスの一覧 (変わらなければ空)。ログとアップグレード画面に出す。
 */
export function applyIrOps(root: Record<string, any>, ops: IrOp[]): string[] {
  const changes: string[] = [];
  const touched = (path: string) => { if (!changes.includes(path)) changes.push(path); };

  for (const op of ops) {
    const segments = parseIrPath(op.path);
    switch (op.op) {
      case 'default': {
        for (const { parent, key } of resolveSlots(root, segments, true)) {
          if ((parent as any)[key] === undefined) {
            (parent as any)[key] = clone(op.value);
            touched(op.path);
          }
        }
        break;
      }
      case 'set': {
        const wanted = JSON.stringify(op.value);
        for (const { parent, key } of resolveSlots(root, segments, true)) {
          if (JSON.stringify((parent as any)[key]) !== wanted) {
            (parent as any)[key] = clone(op.value);
            touched(op.path);
          }
        }
        break;
      }
      case 'rename': {
        if (!/^[A-Za-z0-9_$-]+$/.test(op.to)) throw new Error(`rename target "${op.to}" must be a single key`);
        for (const { parent, key } of resolveSlots(root, segments, false)) {
          if (Array.isArray(parent) || typeof key !== 'string') continue;
          if (!(key in parent)) continue;
          // 新しい名前が既にあるなら、新しい方を正とする (途中まで移行されたファイルを壊さない)
          if (!(op.to in parent)) parent[op.to] = parent[key];
          delete parent[key];
          touched(op.path);
        }
        break;
      }
      case 'remove': {
        for (const { parent, key } of resolveSlots(root, segments, false)) {
          if (Array.isArray(parent)) continue; // 配列の要素を消すと添字がずれるので扱わない
          if (key in parent) {
            delete (parent as Record<string, any>)[key as string];
            touched(op.path);
          }
        }
        break;
      }
      case 'map': {
        for (const { parent, key } of resolveSlots(root, segments, false)) {
          const current = (parent as any)[key];
          if (current === undefined || current === null || typeof current === 'object') continue;
          const k = String(current);
          if (Object.prototype.hasOwnProperty.call(op.values, k) && op.values[k] !== current) {
            (parent as any)[key] = clone(op.values[k]);
            touched(op.path);
          }
        }
        break;
      }
      default:
        throw new Error(`unknown IR op ${(op as { op?: string }).op}`);
    }
  }
  return changes;
}

/** 操作の並びの形を確かめる (拡張機能の extension.json を読むときに使う)。 */
export function validateIrOps(ops: unknown, where: string): string[] {
  if (ops === undefined) return [];
  if (!Array.isArray(ops)) return [`${where}: must be an array of IR ops`];
  const problems: string[] = [];
  ops.forEach((raw, i) => {
    const at = `${where}[${i}]`;
    if (!isPlainObject(raw)) { problems.push(`${at}: must be an object`); return; }
    try {
      parseIrPath(raw.path);
    } catch (e) {
      problems.push(`${at}.path: ${(e as Error).message}`);
    }
    switch (raw.op) {
      case 'default':
      case 'set':
        if (!('value' in raw)) problems.push(`${at}: "${raw.op}" needs a value`);
        break;
      case 'rename':
        if (typeof raw.to !== 'string' || !/^[A-Za-z0-9_$-]+$/.test(raw.to)) problems.push(`${at}: "rename" needs "to" (a single key)`);
        break;
      case 'remove':
        break;
      case 'map':
        if (!isPlainObject(raw.values)) problems.push(`${at}: "map" needs "values" ({ old: new })`);
        break;
      default:
        problems.push(`${at}: unknown op "${String(raw.op)}" (default / set / rename / remove / map)`);
    }
  });
  return problems;
}
