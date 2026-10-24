/**
 * Layster.Spatial — Mind が受け取る観測 (MindRequest) を作る (doc/19-layster.md §3.5)。
 *
 * エディタの「Mind の入出力」は、選んだ試す空間でこれを作って見せ、そのまま Mind に送って試す。
 * ランタイム (Runtime/Spatial/Core/MindProtocol.cs) は実機の世界の状態から同じ規則で作る。規則:
 *
 *   - 位置は observe.frame (既定 'user') で書く。frame の原点と**水平の向き (yaw) だけ**を使う
 *     (head でも頭の傾きは掛けない。重力に沿った向きの方が、モデルにとって読みやすく、揺れない)
 *     'thing:<id>' はその物の置いた姿勢、'body:<id>' はその体の根元 (base.thing) の置いた姿勢。
 *     分からない frame (まだ置いていない物など) は 'user' として書き、request.frame も 'user' にする
 *   - world: 確かさ (既定 0.2 以上)・言葉 (is)・ユーザーからの水平距離 (within) で絞り、近い順に max (既定 30) まで
 *   - entity の has は、書かれていなければ語彙から決めたものを入れる (Mind が語彙を知らなくてよいように)
 *   - things: 置いた物の姿勢 (head / hand に付く物も world に直してから frame へ)
 *   - user.head.forward は水平の向きの単位ベクトル (frame で)
 *   - events は新しいものから observe.events 件 (古い順に並べて渡す)、store は observe.store のキー
 *     (末尾 '.' は前方一致) だけ
 *   - 数は小数 3 桁 (round3)
 */

import type { Entity, FrameRef, Mind, MindRequest, SpatialProject, Vec3 } from './types';
import { framePose, offsetToWorld, round3, type SolveResult, type SolveWorld } from './solver';
import { affordancesOf, matchesWords } from './vocabulary';

export interface ObserveEvent {
  t: number;
  name: string;
  data?: unknown;
}

export interface ObserveInput {
  project: Pick<SpatialProject, 'things'> & Partial<Pick<SpatialProject, 'bodies'>>;
  mind: Mind;
  world: SolveWorld;
  /** 置いた結果 (solveAll の結果) */
  placed: SolveResult[];
  tick?: number;
  /** 起動からの秒 */
  time?: number;
  events?: ObserveEvent[];
  store?: Record<string, unknown>;
  gaze?: MindRequest['user'] extends infer U ? U extends { gaze?: infer G } ? G : never : never;
  camera?: MindRequest['camera'];
}

const DEG = Math.PI / 180;
const DEFAULT_MAX_ENTITIES = 30;
const DEFAULT_MIN_CONFIDENCE = 0.2;

function r3(v: Vec3): Vec3 {
  return [round3(v[0]), round3(v[1]), round3(v[2])];
}

function normYaw(yaw: number): number {
  let y = yaw % 360;
  if (y > 180) y -= 360;
  if (y <= -180) y += 360;
  return y;
}

interface FrameXf {
  origin: Vec3;
  yaw: number;
}

/** world の点を frame のローカルに (原点を引き、yaw だけ戻す)。 */
export function pointToFrame(p: Vec3, f: FrameXf): Vec3 {
  const dx = p[0] - f.origin[0];
  const dz = p[2] - f.origin[2];
  const c = Math.cos(-f.yaw * DEG);
  const s = Math.sin(-f.yaw * DEG);
  // solver.ts の rotate と同じ向き (ローカル +Z → (sin, cos))
  return [dx * c + dz * s, p[1] - f.origin[1], -dx * s + dz * c];
}

function directionToFrame(d: Vec3, f: FrameXf): Vec3 {
  const c = Math.cos(-f.yaw * DEG);
  const s = Math.sin(-f.yaw * DEG);
  return [d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c];
}

function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function keyWanted(key: string, wanted: string[]): boolean {
  const k = key.toLowerCase();
  return wanted.some((raw) => {
    const w = raw.toLowerCase();
    return w.endsWith('.') ? k.startsWith(w) : k === w;
  });
}

/** Mind に渡す観測を作る。 */
export function buildMindRequest(input: ObserveInput): MindRequest {
  const { mind, world } = input;
  const observe = mind.observe ?? {};
  const wantedFrame: FrameRef = observe.frame ?? 'user';
  const resolved = resolveFrame(wantedFrame, input);
  const frame: FrameRef = resolved ? wantedFrame : 'user';
  const f: FrameXf = resolved ?? { origin: world.user.at, yaw: world.user.yaw };

  const request: MindRequest = {
    protocol: 'layster.mind/1',
    mind: mind.id,
    tick: input.tick ?? 0,
    time: round3(input.time ?? 0),
    frame,
    actions: [...(mind.output?.actions ?? [])],
  };

  if (observe.world) {
    const w = observe.world;
    const minConfidence = w.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    const candidates = world.entities
      .map((e, index) => ({ e, index, d: horizontalDistance(e.at, world.user.at) }))
      .filter(({ e, d }) => {
        if ((e.confidence ?? 0) < minConfidence) return false;
        if (w.within !== undefined && d > w.within) return false;
        if (w.is && w.is.length > 0 && !matchesWords(e, { is: w.is, minConfidence: 0 })) return false;
        return true;
      })
      .sort((a, b) => a.d - b.d || a.index - b.index)
      .slice(0, w.max ?? DEFAULT_MAX_ENTITIES);
    request.world = candidates.map(({ e }) => entityInFrame(e, f));
  }

  if (observe.things) {
    const wanted = Array.isArray(observe.things) ? new Set(observe.things) : undefined;
    const byId = new Map(input.placed.map((r) => [r.thing, r]));
    request.things = [];
    for (const t of input.project.things) {
      if (wanted && !wanted.has(t.id)) continue;
      const r = byId.get(t.id);
      if (!r) {
        request.things.push({ id: t.id, at: [0, 0, 0], yaw: 0, placed: false, visible: false });
        continue;
      }
      const pose = r.frame === 'world' ? r.pose : offsetToWorld({ frame: r.frame, at: r.pose.at, yaw: r.pose.yaw }, world) ?? r.pose;
      request.things.push({
        id: t.id,
        at: r3(pointToFrame(pose.at, f)),
        yaw: round3(normYaw(pose.yaw - f.yaw)),
        placed: true,
        visible: t.visibleAtStart !== false,
      });
    }
  }

  const userParts = observe.user ?? [];
  if (userParts.length > 0) {
    const user: NonNullable<MindRequest['user']> = {};
    if (userParts.includes('head')) {
      const head: Vec3 = [world.user.at[0], world.user.at[1] + world.user.eyeHeight, world.user.at[2]];
      const forward: Vec3 = [Math.sin(world.user.yaw * DEG), 0, Math.cos(world.user.yaw * DEG)];
      user.head = { at: r3(pointToFrame(head, f)), forward: r3(directionToFrame(forward, f)) };
    }
    if (userParts.includes('hands')) {
      const hand = (p: Vec3 | null | undefined) => (p ? { at: r3(pointToFrame(p, f)) } : null);
      user.hands = { left: hand(world.hands?.left), right: hand(world.hands?.right) };
    }
    if (userParts.includes('gaze')) user.gaze = input.gaze ?? null;
    request.user = user;
  }

  if (observe.camera && input.camera) request.camera = input.camera;

  if (observe.events && observe.events > 0 && input.events) {
    request.events = input.events.slice(-observe.events);
  }

  if (observe.store && observe.store.length > 0 && input.store) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input.store)) if (keyWanted(k, observe.store)) out[k] = v;
    request.store = out;
  }

  const goal = (mind.instructions ?? '').trim();
  if (goal) request.goal = goal;
  return request;
}

/** 置いた物の world での姿勢 (head / hand に付く物も world に直す)。 */
function placedPose(thingId: string, input: ObserveInput): FrameXf | undefined {
  const r = input.placed.find((x) => x.thing === thingId);
  if (!r) return undefined;
  const pose = r.frame === 'world' ? r.pose : offsetToWorld({ frame: r.frame, at: r.pose.at, yaw: r.pose.yaw }, input.world);
  return pose ? { origin: pose.at, yaw: pose.yaw } : undefined;
}

/** frame の原点と向き。thing / body は置いた結果から、それ以外は solver の framePose。 */
export function resolveFrame(frame: FrameRef, input: ObserveInput): FrameXf | undefined {
  if (frame.startsWith('thing:')) return placedPose(frame.slice(6), input);
  if (frame.startsWith('body:')) {
    const body = (input.project.bodies ?? []).find((b) => b.id === frame.slice(5));
    return body ? placedPose(body.base.thing, input) : undefined;
  }
  return framePose(frame, input.world);
}

function entityInFrame(e: Entity, f: FrameXf): Entity {
  const out: Entity = {
    id: e.id,
    is: [...e.is],
    at: r3(pointToFrame(e.at, f)),
    yaw: round3(normYaw((e.yaw ?? 0) - f.yaw)),
    size: r3(e.size),
    has: affordancesOf(e),
    confidence: round3(e.confidence),
    source: e.source,
  };
  if (e.seenAt !== undefined) out.seenAt = round3(e.seenAt);
  if (e.data !== undefined) out.data = e.data;
  return out;
}
