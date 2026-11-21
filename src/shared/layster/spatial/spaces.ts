/**
 * 組み込みの「試す空間」(doc/19-layster.md §3.4)。
 *
 * 作者は自分の部屋でしか試せない。エディタの Space Lab とエージェントの spatial_solve は、
 * ここにある部屋すべてで置き方を解いて見せる (「どんな空間でも、どこかには置かれる」を確かめる)。
 *
 * どの空間も world の原点 = 起動したときのユーザーの足元、+Z = ユーザーが向いている向き。
 * 壁は厚み 0 の箱で、ローカル +Z (= yaw の向き) が部屋の内側。
 */

import type { Entity, SpaceFixture, Vec3 } from './types';

function box(id: string, is: string[], at: Vec3, size: Vec3, yaw = 0, extra: Partial<Entity> = {}): Entity {
  return { id, is, at, size, yaw, confidence: 0.95, source: 'space', ...extra };
}

/**
 * 床・天井・4 枚の壁。中心 (cx, cz)、幅 w (x)、奥行き d (z)、天井の高さ h。
 * 壁の向き: 前 (+Z 側) の壁は内側が -Z なので yaw 180、右 (+X) は -90、左 (-X) は 90、後ろは 0。
 */
function room(prefix: string, cx: number, cz: number, w: number, d: number, h = 2.4): Entity[] {
  return [
    box(`${prefix}floor`, ['floor'], [cx, 0, cz], [w, 0, d]),
    box(`${prefix}ceiling`, ['ceiling'], [cx, h, cz], [w, 0, d]),
    box(`${prefix}wall-front`, ['wall'], [cx, h / 2, cz + d / 2], [w, h, 0], 180),
    box(`${prefix}wall-back`, ['wall'], [cx, h / 2, cz - d / 2], [w, h, 0], 0),
    box(`${prefix}wall-right`, ['wall'], [cx + w / 2, h / 2, cz], [d, h, 0], -90),
    box(`${prefix}wall-left`, ['wall'], [cx - w / 2, h / 2, cz], [d, h, 0], 90),
  ];
}

/** 家具の箱は、底が床に着くように中心の高さを決める。 */
function onFloor(id: string, is: string[], x: number, z: number, size: Vec3, yaw = 0): Entity {
  return box(id, is, [x, size[1] / 2, z], size, yaw);
}

export const BUILTIN_SPACES: readonly SpaceFixture[] = [
  {
    id: 'studio',
    name: { en: 'Studio apartment', ja: 'ワンルーム' },
    description: { en: 'A 3.5 × 4 m room: desk and chair to the front right, bed on the left, a shelf and a TV.', ja: '3.5 × 4 m。右前に机と椅子、左にベッド、棚とテレビ。' },
    user: { eyeHeight: 1.6 },
    knows: ['scan', 'hands', 'camera'],
    entities: [
      ...room('', 0, 0.6, 3.5, 4),
      onFloor('desk', ['desk'], 1.0, 2.2, [1.2, 0.72, 0.6], 180),
      onFloor('chair', ['chair'], 1.0, 1.6, [0.5, 0.85, 0.5], 0),
      onFloor('bed', ['bed'], -1.05, 0.6, [1.4, 0.5, 2.0], 0),
      onFloor('shelf', ['shelf'], 1.57, -0.6, [0.8, 1.2, 0.35], -90),
      box('tv', ['screen'], [-0.3, 1.2, 2.55], [1.0, 0.6, 0.06], 180),
    ],
  },
  {
    id: 'desk-front',
    name: { en: 'Seated at a desk', ja: '机の前に座っている' },
    description: { en: 'Sitting 0.5 m from a desk against a wall. Little room to the sides.', ja: '壁際の机の前、0.5 m の所に座っている。横はあまり空いていない。' },
    user: { eyeHeight: 1.2 },
    knows: ['scan', 'hands', 'camera'],
    entities: [
      ...room('', 0, 0.2, 2.6, 1.8),
      onFloor('desk', ['desk'], 0, 0.8, [1.2, 0.72, 0.6], 180),
      onFloor('chair', ['chair'], 0, 0, [0.5, 0.85, 0.5], 0),
      box('laptop', ['laptop'], [0.05, 0.73, 0.8], [0.33, 0.02, 0.23], 180),
      box('cup', ['cup'], [0.45, 0.77, 0.75], [0.08, 0.1, 0.08], 0),
      onFloor('shelf', ['shelf'], -1.125, 0.6, [0.6, 1.6, 0.35], 90),
    ],
  },
  {
    id: 'living',
    name: { en: 'Living room', ja: 'リビング' },
    description: { en: 'A 5 × 6 m room with a couch, a low coffee table, a TV, a plant and a lamp.', ja: '5 × 6 m。ソファ・低いローテーブル・テレビ・植木・ランプ。' },
    user: { eyeHeight: 1.6 },
    knows: ['scan', 'hands', 'camera'],
    entities: [
      ...room('', 0, 1.0, 5, 6, 2.5),
      onFloor('couch', ['couch'], 0, -0.9, [1.9, 0.8, 0.9], 0),
      onFloor('coffee-table', ['table'], 0, 0.6, [1.0, 0.4, 0.55], 0),
      box('tv', ['screen'], [0, 1.1, 3.95], [1.4, 0.8, 0.08], 180),
      onFloor('tv-stand', ['shelf'], 0, 3.75, [1.6, 0.45, 0.4], 180),
      onFloor('plant', ['plant'], 2.1, 3.5, [0.45, 1.0, 0.45]),
      onFloor('lamp', ['lamp'], -2.1, -1.4, [0.3, 1.5, 0.3]),
    ],
  },
  {
    id: 'classroom',
    name: { en: 'Classroom', ja: '教室' },
    description: { en: 'Rows of small desks; the user stands between them. A whiteboard on the front wall.', ja: '小さな机が並び、ユーザーはその間に立つ。前の壁にホワイトボード。' },
    user: { eyeHeight: 1.6 },
    knows: ['scan', 'hands', 'camera'],
    entities: [
      ...room('', 0, 2.0, 7, 8, 2.8),
      box('board', ['screen'], [0, 1.4, 5.95], [3.0, 1.2, 0.03], 180),
      // 真ん中 (x = ±0.3 の間) が通路で、ユーザーはそこに立つ
      ...[-1.6, -0.6, 0.6, 1.6].flatMap((x, i) => [1.0, 2.2, 3.4].map((z, j) =>
        onFloor(`desk-${i}-${j}`, ['desk'], x, z, [0.6, 0.7, 0.45], 180))),
    ],
  },
  {
    id: 'open-floor',
    name: { en: 'Open floor', ja: '何も無い広い所' },
    description: { en: 'Only a large floor is known — no furniture, no walls nearby.', ja: '広い床だけ。家具も、近くの壁も無い。' },
    user: { eyeHeight: 1.6 },
    knows: ['scan', 'hands', 'camera'],
    entities: [box('floor', ['floor'], [0, 0, 0], [12, 0, 12])],
  },
  {
    id: 'tiny',
    name: { en: 'Tiny room', ja: '狭い部屋' },
    description: { en: '2 × 2.2 m. A wall 0.8 m in front of the user, a small side table.', ja: '2 × 2.2 m。目の前 0.8 m に壁、横に小さな台。' },
    user: { eyeHeight: 1.6 },
    knows: ['scan', 'hands'],
    entities: [
      ...room('', 0, -0.3, 2.0, 2.2),
      onFloor('side-table', ['table'], 0.7, 0.4, [0.45, 0.55, 0.4], -90),
    ],
  },
  {
    id: 'no-scan',
    name: { en: 'No room data', ja: '部屋が分からない' },
    description: { en: 'A device that knows only the head (phone, XREAL without planes). The floor is a guess.', ja: '頭の位置しか分からない端末 (スマホ、平面の無い XREAL)。床は推定。' },
    user: { eyeHeight: 1.5 },
    knows: [],
    entities: [box('floor', ['floor'], [0, 0, 0], [6, 0, 6], 0, { confidence: 0.3, source: 'assumed' })],
  },
];

export function findBuiltinSpace(id: string): SpaceFixture | undefined {
  return BUILTIN_SPACES.find((s) => s.id === id);
}

/** 新しいプロジェクトで最初から試す空間。 */
export const DEFAULT_SPACE_IDS: readonly string[] = ['studio', 'desk-front', 'living', 'tiny', 'no-scan'];
