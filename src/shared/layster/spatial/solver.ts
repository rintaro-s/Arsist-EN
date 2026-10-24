/**
 * Layster.Spatial — 置き方を解く (doc/19-layster.md §3.3)。
 *
 * エディタの Space Lab・エージェントの spatial_solve・ランタイム (C# の写し
 * Runtime/Spatial/Core/PlacementSolver.cs) が同じ計算をする。片方だけ直すと、エディタで見た置き場所と
 * 実機の置き場所がずれる。solver-cases.json の表を TS (solver.test.ts) と C# (tools/perception-check の
 * SpatialChecks) の両方で確かめている。C# に移しやすいよう、ここでは:
 *   - 候補を作る順番を固定し、同点は先の候補 (score < best - EPS のときだけ入れ替える)
 *   - 出力の数は round3 (floor(v * 1000 + 0.5) / 1000) で丸める
 *   - 角度は度、atan2 は (x, z) の順 (yaw は +Z から +X へ回る向きが正)
 * にしてある。
 */

import type {
  Entity, EntityQuery, Facing, FrameRef, Offset, Placement, PlaceMode, Pose, Target, Thing, ThingVisual, Vec2, Vec3,
} from './types';
import { affordancesOf, isVertical, lookupWord, matchesWords } from './vocabulary';

// ========================================
// 入出力
// ========================================

export interface SolveUser {
  /** 足元 (world) */
  at: Vec3;
  /** 頭の水平の向き (度) */
  yaw: number;
  /** 足元から目までの高さ (m) */
  eyeHeight: number;
}

export interface PlacedThing {
  pose: Pose;
  size: Vec3;
}

export interface SolveWorld {
  entities: Entity[];
  user: SolveUser;
  /** もう置いた物 (避ける・ぶつからない・near の基準) */
  things: Record<string, PlacedThing>;
  hands?: { left?: Vec3 | null; right?: Vec3 | null };
}

export interface SolveResult {
  thing: string;
  mode: PlaceMode;
  /** pose がどの frame か。world / body は 'world' */
  frame: FrameRef;
  pose: Pose;
  /** 0 = 本来の置き方、1.. = fallback の何番目か、'default' = どれでも置けなかった */
  rule: number | 'default';
  /** 載せた / 貼った entity */
  host?: string;
  /** 規則ごとの、置けなかった理由 */
  notes: string[];
}

export const EPS = 1e-9;
/** 'visible: true' の視界の半角 (度) */
export const DEFAULT_VIEW_HALF_ANGLE = 35;
/** avoid の隙間 (m) */
export const AVOID_GAP = 0.3;
const GRID_STEP = 0.1;
const RING_STEP = 0.15;
const MAX_CANDIDATES_PER_HOST = 400;
const DEFAULT_FLOOR_RANGE: Vec2 = [0.6, 2.5];
const DEFAULT_AROUND: Vec2 = [0.3, 1.0];

export function round3(v: number): number {
  return Math.floor(v * 1000 + 0.5) / 1000;
}

// ========================================
// 物の大きさ
// ========================================

/** 見た目から、置き方の計算に使う箱の大きさ [幅, 高さ, 奥行き] を決める。 */
export function thingSize(visual: ThingVisual): Vec3 {
  switch (visual.kind) {
    case 'shape': return [visual.size[0], visual.size[1], visual.size[2]];
    case 'panel': return [visual.size[0], visual.size[1], 0.01];
    case 'label': {
      const h = visual.height ?? 0.04;
      return [Math.max(h, visual.text.length * h * 0.6), h, 0.01];
    }
    case 'character': {
      const h = visual.height ?? 1.5;
      return [h * 0.3, h, h * 0.2];
    }
    case 'model': {
      const h = visual.height ?? 0.3;
      return [h, h, h];
    }
    case 'marker': return [0.05, 0.05, 0.05];
  }
}

// ========================================
// 幾何
// ========================================

const DEG = Math.PI / 180;

/** yaw (度) でローカルの (x, z) を回す。+Z が yaw の向き。 */
function rotate(x: number, z: number, yaw: number): [number, number] {
  const c = Math.cos(yaw * DEG);
  const s = Math.sin(yaw * DEG);
  // ローカル +Z (0,1) → (sin, cos)、ローカル +X (1,0) → (cos, -sin)
  return [x * c + z * s, -x * s + z * c];
}

/** world の (x, z) を entity のローカルに戻す。 */
function toLocal(entity: { at: Vec3; yaw?: number }, x: number, z: number): [number, number] {
  return rotate(x - entity.at[0], z - entity.at[2], -(entity.yaw ?? 0));
}

/** (dx, dz) の向きの yaw (度)。 */
export function yawToward(dx: number, dz: number): number {
  return Math.atan2(dx, dz) / DEG;
}

function normYaw(yaw: number): number {
  let y = yaw % 360;
  if (y > 180) y -= 360;
  if (y <= -180) y += 360;
  return y;
}

function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

interface Aabb { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

function aabbOf(center: Vec3, size: Vec3, yaw: number): Aabb {
  const c = Math.abs(Math.cos(yaw * DEG));
  const s = Math.abs(Math.sin(yaw * DEG));
  const hx = (size[0] * c + size[2] * s) / 2;
  const hz = (size[0] * s + size[2] * c) / 2;
  return {
    minX: center[0] - hx, maxX: center[0] + hx,
    minY: center[1] - size[1] / 2, maxY: center[1] + size[1] / 2,
    minZ: center[2] - hz, maxZ: center[2] + hz,
  };
}

/** 重なり。tolerance だけ食い込むのは許す (面に載せた物と面の接触など)。 */
function overlaps(a: Aabb, b: Aabb, tolerance = 0.01): boolean {
  return a.minX < b.maxX - tolerance && a.maxX > b.minX + tolerance
    && a.minY < b.maxY - tolerance && a.maxY > b.minY + tolerance
    && a.minZ < b.maxZ - tolerance && a.maxZ > b.minZ + tolerance;
}

/** 水平方向の隙間 (重なっていれば 0)。 */
function horizontalGap(a: Aabb, b: Aabb): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dz = Math.max(0, Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ));
  return Math.hypot(dx, dz);
}

function topOf(e: Entity): number {
  return e.at[1] + e.size[1] / 2;
}

function isStructural(e: Entity): boolean {
  return !!(e.is?.[0] && lookupWord(e.is[0])?.structural);
}

function headOf(world: SolveWorld): Vec3 {
  return [world.user.at[0], world.user.at[1] + world.user.eyeHeight, world.user.at[2]];
}

// ========================================
// frame と target
// ========================================

interface FramePose { origin: Vec3; yaw: number }

/** frame の原点と向き (world)。分からなければ undefined。head / hand は位置だけ (向きはユーザーの向き)。 */
export function framePose(frame: FrameRef, world: SolveWorld): FramePose | undefined {
  switch (frame) {
    case 'world': return { origin: [0, 0, 0], yaw: 0 };
    case 'user': return { origin: world.user.at, yaw: world.user.yaw };
    case 'head': return { origin: headOf(world), yaw: world.user.yaw };
    case 'hand.left': return world.hands?.left ? { origin: world.hands.left, yaw: world.user.yaw } : undefined;
    case 'hand.right': return world.hands?.right ? { origin: world.hands.right, yaw: world.user.yaw } : undefined;
  }
  if (frame.startsWith('thing:')) {
    const t = world.things[frame.slice(6)];
    return t ? { origin: t.pose.at, yaw: t.pose.yaw } : undefined;
  }
  if (frame.startsWith('entity:')) {
    const id = frame.slice(7);
    const e = world.entities.find((x) => x.id === id);
    return e ? { origin: e.at, yaw: e.yaw ?? 0 } : undefined;
  }
  return undefined; // body:<id> はランタイムだけが知っている
}

export function offsetToWorld(offset: Offset, world: SolveWorld): Pose | undefined {
  const f = framePose(offset.frame, world);
  if (!f) return undefined;
  const [x, z] = rotate(offset.at[0], offset.at[2], f.yaw);
  return { at: [f.origin[0] + x, f.origin[1] + offset.at[1], f.origin[2] + z], yaw: normYaw(f.yaw + (offset.yaw ?? 0)) };
}

/** query に合う entity (位置の条件 within / minSize も見る)。並びは元の順。 */
export function findEntities(query: EntityQuery, world: SolveWorld): Entity[] {
  return world.entities.filter((e) => {
    if (!matchesWords(e, query)) return false;
    if (query.within !== undefined && horizontalDistance(e.at, world.user.at) > query.within) return false;
    if (query.minSize) {
      const vertical = isVertical(e);
      const a = e.size[0];
      const b = vertical ? e.size[1] : e.size[2];
      if (a < query.minSize[0] || b < query.minSize[1]) return false;
    }
    return true;
  });
}

/** target の点 (world)。entity はユーザーに一番近いもの。 */
export function targetPoint(target: Target, world: SolveWorld): Vec3 | undefined {
  if ('thing' in target) return world.things[target.thing]?.pose.at;
  if ('entity' in target) {
    let best: Entity | undefined;
    let bestD = Infinity;
    for (const e of findEntities(target.entity, world)) {
      const d = horizontalDistance(e.at, world.user.at);
      if (d < bestD - EPS) { best = e; bestD = d; }
    }
    return best?.at;
  }
  if ('frame' in target) {
    return offsetToWorld({ frame: target.frame, at: target.at ?? [0, 0, 0] }, world)?.at;
  }
  switch (target.user) {
    case 'head': return headOf(world);
    case 'feet': return world.user.at;
    case 'hand.left': return world.hands?.left ?? undefined;
    case 'hand.right': return world.hands?.right ?? undefined;
  }
  return undefined;
}

// ========================================
// 候補
// ========================================

interface Candidate {
  at: Vec3;
  /** 向きが面で決まる (壁に貼る) なら yaw */
  surfaceYaw?: number;
  host?: Entity;
}

/** 等間隔の点 (端から端まで)。half が負なら真ん中の 1 点。 */
function span(half: number, step: number): number[] {
  if (half <= EPS) return [0];
  const n = Math.floor((2 * half) / step + EPS);
  const used = n * step;
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(-used / 2 + i * step);
  return out;
}

/** 幅 a × 高さ b の格子の間隔。点が MAX_CANDIDATES_PER_HOST を超えないように広げる。 */
function gridStep(a: number, b: number): number {
  const count = (Math.floor(a / GRID_STEP + EPS) + 1) * (Math.floor(b / GRID_STEP + EPS) + 1);
  if (count <= MAX_CANDIDATES_PER_HOST) return GRID_STEP;
  return Math.max(GRID_STEP, Math.sqrt((a * b) / MAX_CANDIDATES_PER_HOST) + 0.01);
}

/** 輪の角度を「正面から、左右交互に」並べる (同点なら正面に近い方が勝つ)。 */
function ringAngles(): number[] {
  const out = [0];
  for (let a = 15; a < 180; a += 15) out.push(a, -a);
  out.push(180);
  return out;
}

function hostCandidates(host: Entity, size: Vec3, place: Placement, world: SolveWorld): Candidate[] {
  const out: Candidate[] = [];
  const yaw = host.yaw ?? 0;
  if (isVertical(host)) {
    // 前面に、裏を面に付けて貼る
    const halfW = host.size[0] / 2 - size[0] / 2;
    const halfH = host.size[1] / 2 - size[1] / 2;
    if (halfW < -EPS || halfH < -EPS) return out;
    // 点が多すぎるときは間隔を広げる (打ち切ると、上の方の段が丸ごと候補から消える)
    const step = gridStep(Math.max(0, halfW) * 2, Math.max(0, halfH) * 2);
    const xs = span(Math.max(0, halfW), step);
    const ys = span(Math.max(0, halfH), step);
    const push = host.size[2] / 2 + size[2] / 2 + 0.01;
    for (const ly of ys) {
      for (const lx of xs) {
        const [wx, wz] = rotate(lx, push, yaw);
        out.push({ at: [host.at[0] + wx, host.at[1] + ly, host.at[2] + wz], surfaceYaw: normYaw(yaw), host });
      }
    }
    return out;
  }

  const top = topOf(host);
  const cy = top + size[1] / 2;
  const affordances = affordancesOf(host);
  if (affordances.includes('walk') && isStructural(host)) {
    // 床: 全体に点を撒くと多すぎるので、ユーザーの周りの輪にする
    const range = place.distance ?? DEFAULT_FLOOR_RANGE;
    const angles = ringAngles();
    const rings = Math.max(1, Math.floor(MAX_CANDIDATES_PER_HOST / angles.length));
    const step = Math.max(RING_STEP, (range[1] - range[0]) / Math.max(1, rings - 1));
    for (let i = 0; range[0] + i * step <= range[1] + EPS; i++) {
      const r = range[0] + i * step;
      for (const a of angles) {
        const [dx, dz] = rotate(0, r, world.user.yaw + a);
        const x = world.user.at[0] + dx;
        const z = world.user.at[2] + dz;
        const [lx, lz] = toLocal(host, x, z);
        if (Math.abs(lx) > host.size[0] / 2 || Math.abs(lz) > host.size[2] / 2) continue;
        out.push({ at: [x, cy, z], host });
      }
    }
    return out;
  }

  // 机・棚など: 上面に格子。縁から (物の半分か、空けてほしい広さの半分) 内側
  const r = Math.max(size[0], size[2]) / 2;
  const cw = place.clearance ? place.clearance[0] / 2 : 0;
  const cd = place.clearance ? place.clearance[1] / 2 : 0;
  const halfX = host.size[0] / 2 - Math.max(r, cw);
  const halfZ = host.size[2] / 2 - Math.max(r, cd);
  if (halfX < -EPS || halfZ < -EPS) return out;
  const step = gridStep(Math.max(0, halfX) * 2, Math.max(0, halfZ) * 2);
  for (const lz of span(Math.max(0, halfZ), step)) {
    for (const lx of span(Math.max(0, halfX), step)) {
      const [wx, wz] = rotate(lx, lz, yaw);
      out.push({ at: [host.at[0] + wx, cy, host.at[2] + wz], host });
    }
  }
  return out;
}

function nearCandidates(point: Vec3, size: Vec3, place: Placement, world: SolveWorld, targetIsHead: boolean): Candidate[] {
  const out: Candidate[] = [];
  const around = place.around ?? DEFAULT_AROUND;
  let cy: number;
  if (place.height) cy = (place.height[0] + place.height[1]) / 2 + size[1] / 2;
  else if (size[1] >= 1.0) cy = size[1] / 2;
  else if (targetIsHead) cy = point[1] - 0.15;
  else cy = point[1];
  // 正面 = 基準からユーザーへ向かう向き (基準がユーザーなら、ユーザーの前)
  const toUser = horizontalDistance(point, world.user.at) > 0.05
    ? yawToward(world.user.at[0] - point[0], world.user.at[2] - point[2])
    : world.user.yaw;
  for (let r = around[0]; r <= around[1] + EPS; r += GRID_STEP) {
    for (const a of ringAngles()) {
      const [dx, dz] = rotate(0, r, toUser + a);
      out.push({ at: [point[0] + dx, cy, point[2] + dz] });
    }
  }
  return out;
}

// ========================================
// 条件
// ========================================

interface Check {
  ok: boolean;
  why?: string;
}

function facingYaw(facing: Facing, c: Candidate, world: SolveWorld, keepYaw: number): number {
  if (c.surfaceYaw !== undefined) return c.surfaceYaw;
  const toUser = yawToward(world.user.at[0] - c.at[0], world.user.at[2] - c.at[2]);
  switch (facing) {
    case 'user': return normYaw(toUser);
    case 'away': return normYaw(toUser + 180);
    case 'keep': return normYaw(keepYaw);
    case 'surface': {
      if (!c.host) return normYaw(toUser);
      // 面の辺にそろえる。4 つの向きのうち、ユーザーの方に一番近いもの
      const base = c.host.yaw ?? 0;
      let best = base;
      let bestDiff = Infinity;
      for (let k = 0; k < 4; k++) {
        const y = base + k * 90;
        const diff = Math.abs(normYaw(y - toUser));
        if (diff < bestDiff - EPS) { best = y; bestDiff = diff; }
      }
      return normYaw(best);
    }
  }
}

/** 物の箱 (中心 at・大きさ size・向き yaw) のどこかが、部屋の壁の裏に出ているか。 */
function isBehindWall(at: Vec3, size: Vec3, yaw: number, world: SolveWorld): boolean {
  for (const e of world.entities) {
    if (!isStructural(e) || !isVertical(e)) continue;
    const [lx, lz] = toLocal(e, at[0], at[2]);
    if (Math.abs(lx) > e.size[0] / 2) continue;
    if (at[1] < e.at[1] - e.size[1] / 2 || at[1] > e.at[1] + e.size[1] / 2) continue;
    // 壁の法線の向きに、箱が中心からどれだけ張り出しているか
    const d = (yaw - (e.yaw ?? 0)) * DEG;
    const reach = Math.abs((size[0] / 2) * Math.sin(d)) + Math.abs((size[2] / 2) * Math.cos(d));
    if (lz - reach < -0.02) return true;
  }
  return false;
}

function avoidBoxes(names: string[], world: SolveWorld, self: string): Aabb[] {
  const out: Aabb[] = [];
  for (const name of names) {
    const t = world.things[name];
    if (t && name !== self) { out.push(aabbOf(t.pose.at, t.size, t.pose.yaw)); continue; }
    for (const e of findEntities({ is: [name] }, world)) out.push(aabbOf(e.at, e.size, e.yaw ?? 0));
  }
  return out;
}

function checkCandidate(
  thing: string, c: Candidate, yaw: number, size: Vec3, place: Placement, world: SolveWorld,
): Check {
  const head = headOf(world);
  if (place.distance) {
    const d = horizontalDistance(c.at, world.user.at);
    if (d < place.distance[0] - EPS || d > place.distance[1] + EPS) return { ok: false, why: 'distance' };
  }
  const bottom = c.at[1] - size[1] / 2;
  if (place.height) {
    if (bottom < place.height[0] - EPS || bottom > place.height[1] + EPS) return { ok: false, why: 'height' };
  }
  if (place.visible) {
    const half = place.visible === true ? DEFAULT_VIEW_HALF_ANGLE : place.visible;
    const toward = yawToward(c.at[0] - head[0], c.at[2] - head[2]);
    if (Math.abs(normYaw(toward - world.user.yaw)) > half + EPS) return { ok: false, why: 'visible' };
  }
  if (isBehindWall(c.at, size, yaw, world)) return { ok: false, why: 'wall' };

  const box = aabbOf(c.at, size, yaw);
  // 壁に貼る物は、手前 10 cm に何も無いこと (テレビの裏に貼らない)
  const front = c.surfaceYaw !== undefined
    ? (() => {
      const [fx, fz] = rotate(0, 0.05, yaw);
      return aabbOf([c.at[0] + fx, c.at[1], c.at[2] + fz], [size[0], size[1], size[2] + 0.1], yaw);
    })()
    : box;
  // 床に立つ物は、床の上でなければならない
  if (bottom < 0.05) {
    const floors = world.entities.filter((e) => isStructural(e) && affordancesOf(e).includes('walk'));
    if (floors.length > 0 && !floors.some((f) => {
      const [lx, lz] = toLocal(f, c.at[0], c.at[2]);
      return Math.abs(lx) <= f.size[0] / 2 && Math.abs(lz) <= f.size[2] / 2;
    })) return { ok: false, why: 'floor' };
  }
  // 他の物 (家具・もう置いた物) とぶつからない。部屋の面と、載せている面は除く
  for (const e of world.entities) {
    if (e === c.host || isStructural(e)) continue;
    if (overlaps(front, aabbOf(e.at, e.size, e.yaw ?? 0))) return { ok: false, why: 'collision' };
  }
  for (const [id, t] of Object.entries(world.things)) {
    if (id === thing) continue;
    if (overlaps(front, aabbOf(t.pose.at, t.size, t.pose.yaw))) return { ok: false, why: 'collision' };
  }
  // 空けてほしい広さ: 面の中に収まり、その上に物が無い
  if (place.clearance && c.host && !isVertical(c.host)) {
    const [lx, lz] = toLocal(c.host, c.at[0], c.at[2]);
    if (Math.abs(lx) > c.host.size[0] / 2 - place.clearance[0] / 2 + EPS
      || Math.abs(lz) > c.host.size[2] / 2 - place.clearance[1] / 2 + EPS) return { ok: false, why: 'clearance' };
    const top = topOf(c.host);
    const area = aabbOf([c.at[0], top + 0.15, c.at[2]], [place.clearance[0], 0.3, place.clearance[1]], c.host.yaw ?? 0);
    for (const e of world.entities) {
      if (e === c.host || isStructural(e)) continue;
      if (overlaps(area, aabbOf(e.at, e.size, e.yaw ?? 0))) return { ok: false, why: 'clearance' };
    }
  }
  if (place.avoid && place.avoid.length > 0) {
    for (const other of avoidBoxes(place.avoid, world, thing)) {
      if (horizontalGap(box, other) < AVOID_GAP - EPS) return { ok: false, why: 'avoid' };
    }
  }
  return { ok: true };
}

function scoreOf(place: Placement, c: Candidate, ref: Vec3, world: SolveWorld): number {
  const d = horizontalDistance(c.at, ref);
  let score: number;
  switch (place.prefer ?? 'closest') {
    case 'farthest': score = -d; break;
    case 'largest': score = (c.host ? -(c.host.size[0] * (isVertical(c.host) ? c.host.size[1] : c.host.size[2])) : 0) + d * 0.01; break;
    case 'center': score = c.host ? horizontalDistance(c.at, c.host.at) + Math.abs(c.at[1] - c.host.at[1]) * (isVertical(c.host) ? 1 : 0) : d; break;
    case 'inView': {
      const head = headOf(world);
      const angle = Math.abs(normYaw(yawToward(c.at[0] - head[0], c.at[2] - head[2]) - world.user.yaw));
      score = angle / 45 + d * 0.1;
      break;
    }
    default: score = d;
  }
  // 縦の面に貼る物は、目の少し下が見やすい
  if (c.host && isVertical(c.host)) score += Math.abs(c.at[1] - (headOf(world)[1] - 0.1)) * 0.5;
  return score;
}

// ========================================
// 解く
// ========================================

interface RuleOutcome {
  result?: Omit<SolveResult, 'thing' | 'rule' | 'notes'>;
  note?: string;
}

function solveRule(thing: string, size: Vec3, place: Placement, world: SolveWorld): RuleOutcome {
  const mode: PlaceMode = place.mode ?? 'world';
  const facing: Facing = place.facing ?? 'user';

  if (mode === 'head' || mode === 'hand') {
    const frame: FrameRef = mode === 'head' ? 'head' : (place.at?.frame === 'hand.left' ? 'hand.left' : 'hand.right');
    const at: Vec3 = place.at ? [place.at.at[0], place.at.at[1], place.at.at[2]] : (mode === 'head' ? [0, -0.1, 1.2] : [0, 0.08, 0]);
    // head の frame ではユーザー (目) が原点なので、こちらを向く = 原点の方を向く
    const yaw = place.at?.yaw !== undefined ? place.at.yaw
      : (mode === 'head' && facing === 'user' ? normYaw(yawToward(-at[0], -at[2])) : 0);
    return { result: { mode, frame, pose: { at, yaw } } };
  }

  let candidates: Candidate[] = [];
  let ref: Vec3 = world.user.at;
  /** at だけで決まる置き場所 (on / near が無いとき) */
  let atPose: Pose | undefined;

  if (place.near) {
    const point = targetPoint(place.near, world);
    if (!point) return { note: 'near: the target is not known here' };
    ref = point;
    if (!place.on) {
      const targetIsHead = 'user' in place.near && place.near.user === 'head';
      candidates = nearCandidates(point, size, place, world, targetIsHead);
    }
  }
  if (place.on) {
    const hosts = findEntities(place.on, world);
    if (hosts.length === 0) return { note: `on: nothing matches ${JSON.stringify(place.on)}` };
    for (const host of hosts) candidates.push(...hostCandidates(host, size, place, world));
    if (candidates.length === 0) return { note: 'on: the matching surfaces are too small' };
  }
  if (!place.on && !place.near) {
    if (!place.at) return { note: 'nothing to place against (no on / near / at)' };
    atPose = offsetToWorld(place.at, world);
    if (!atPose) return { note: `at: frame ${place.at.frame} is not known here` };
    candidates = [{ at: atPose.at }];
  }

  let best: { c: Candidate; yaw: number; score: number } | undefined;
  const reasons: Record<string, number> = {};
  // keep = 起動したときの向きのまま (at があればその frame の向き)
  const keepYaw = atPose ? atPose.yaw : world.user.yaw;
  for (const c of candidates) {
    // at に yaw を書いたなら、それが向き。書かなければ facing
    const yaw = atPose && place.at?.yaw !== undefined ? atPose.yaw : facingYaw(facing, c, world, keepYaw);
    const check = checkCandidate(thing, c, yaw, size, place, world);
    if (!check.ok) {
      reasons[check.why!] = (reasons[check.why!] ?? 0) + 1;
      continue;
    }
    const score = scoreOf(place, c, ref, world);
    if (!best || score < best.score - EPS) best = { c, yaw, score };
  }
  if (!best) {
    const why = Object.entries(reasons).map(([k, n]) => `${k} ×${n}`).join(', ');
    return { note: `${candidates.length} spots, none fit (${why})` };
  }
  return {
    result: {
      mode,
      frame: 'world',
      pose: { at: best.c.at, yaw: best.yaw },
      host: best.c.host?.id,
    },
  };
}

/** どの規則でも置けなかったときの置き場所。ユーザーの前を近くへ順に試し、最後は無条件。 */
function defaultPlacement(thing: string, size: Vec3, world: SolveWorld): Omit<SolveResult, 'thing' | 'rule' | 'notes'> {
  const tall = size[1] >= 1.0;
  const cy = tall ? size[1] / 2 : world.user.at[1] + world.user.eyeHeight - 0.25;
  let fallback: Pose | undefined;
  for (const d of [1.2, 0.9, 0.6]) {
    for (const a of [0, -30, 30]) {
      const [dx, dz] = rotate(0, d, world.user.yaw + a);
      const at: Vec3 = [world.user.at[0] + dx, cy, world.user.at[2] + dz];
      const yaw = normYaw(yawToward(-dx, -dz));
      if (!fallback) fallback = { at, yaw };
      const check = checkCandidate(thing, { at }, yaw, size, {}, world);
      if (check.ok) return { mode: 'world', frame: 'world', pose: { at, yaw } };
    }
  }
  const [dx, dz] = rotate(0, 0.6, world.user.yaw);
  return { mode: 'world', frame: 'world', pose: fallback ?? { at: [world.user.at[0] + dx, cy, world.user.at[2] + dz], yaw: normYaw(world.user.yaw + 180) } };
}

function roundPose(pose: Pose): Pose {
  return { at: [round3(pose.at[0]), round3(pose.at[1]), round3(pose.at[2])], yaw: round3(normYaw(pose.yaw)) };
}

/** 1 つの物を置く。world.things には足さない (solveAll が足す)。 */
export function solvePlacement(thing: string, size: Vec3, place: Placement, world: SolveWorld): SolveResult {
  const rules: Placement[] = [place, ...(place.fallback ?? [])];
  const notes: string[] = [];
  for (let i = 0; i < rules.length; i++) {
    // fallback は親の mode / keep を受け継がない (書いたものだけ)。facing は書かなければ 'user'
    const outcome = solveRule(thing, size, rules[i], world);
    if (outcome.result) {
      return { thing, rule: i, notes, ...outcome.result, pose: roundPose(outcome.result.pose) };
    }
    notes.push(`${i === 0 ? 'place' : `fallback ${i}`}: ${outcome.note}`);
  }
  const d = defaultPlacement(thing, size, world);
  return { thing, rule: 'default', notes, ...d, pose: roundPose(d.pose) };
}

/** 置き方が他の物を参照しているか (先に置く順を決める)。 */
export function placementDependencies(place: Placement): string[] {
  const out = new Set<string>();
  const visit = (p: Placement) => {
    if (p.near && 'thing' in p.near) out.add(p.near.thing);
    if (p.near && 'frame' in p.near && p.near.frame.startsWith('thing:')) out.add(p.near.frame.slice(6));
    if (p.at?.frame.startsWith('thing:')) out.add(p.at.frame.slice(6));
    for (const a of p.avoid ?? []) out.add(a);
    for (const f of p.fallback ?? []) visit(f);
  };
  visit(place);
  return [...out];
}

/** 置く順番。参照される物を先に。輪になっていたら元の順。 */
export function placementOrder(things: Thing[]): Thing[] {
  const byId = new Map(things.map((t) => [t.id, t]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const order: Thing[] = [];
  const visit = (t: Thing) => {
    if (done.has(t.id) || visiting.has(t.id)) return;
    visiting.add(t.id);
    for (const dep of placementDependencies(t.place)) {
      const d = byId.get(dep);
      if (d) visit(d);
    }
    visiting.delete(t.id);
    done.add(t.id);
    order.push(t);
  };
  for (const t of things) visit(t);
  return order;
}

/**
 * 物をすべて置く。置いた物は次の物にとって「ぶつからない・避ける・near の基準」になる。
 * head / hand に付く物は world に場所を持たないので、他の物の邪魔にならない。
 */
export function solveAll(things: Thing[], world: SolveWorld): SolveResult[] {
  const w: SolveWorld = { ...world, things: { ...world.things } };
  const results = new Map<string, SolveResult>();
  for (const t of placementOrder(things)) {
    const size = thingSize(t.visual);
    const r = solvePlacement(t.id, size, t.place, w);
    results.set(t.id, r);
    if (r.frame === 'world') w.things[t.id] = { pose: r.pose, size };
  }
  return things.map((t) => results.get(t.id)!);
}

/** 試す空間からの world (ユーザーは原点、+Z 向き)。 */
export function worldFromSpace(space: { entities: Entity[]; user: { eyeHeight: number } }): SolveWorld {
  return {
    entities: space.entities,
    user: { at: [0, 0, 0], yaw: 0, eyeHeight: space.user.eyeHeight },
    things: {},
    hands: { left: [-0.2, space.user.eyeHeight - 0.5, 0.35], right: [0.2, space.user.eyeHeight - 0.5, 0.35] },
  };
}
