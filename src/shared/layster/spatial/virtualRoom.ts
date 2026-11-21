/**
 * Layster.Spatial — presentation.reality: 'virtual-room' の「仮の部屋」の見た目 (doc/20 §3.3)。
 *
 * 現実を見せない (パススルーが無い・切った) とき、端末は世界の状態から簡単な部屋を描く:
 * 床の格子、壁、家具の箱。色は控えめ (物より目立たない)。エディタの 3D (SpaceLab) と端末
 * (Runtime/Spatial/SpatialVirtualRoom.cs) が同じ見た目になるよう、色と「何をどう描くか」はここだけで決め、
 * lower.ts が spatial.json の virtualRoom に書いて端末へ渡す。
 */
import type { Entity } from './types';
import { canonicalWord, isVertical, lookupWord } from './vocabulary';

export const VIRTUAL_ROOM_STYLE = {
  /** 背景 (空・天井の向こう)。ARSettings.backgroundColor と同じ */
  background: '#101014',
  floor: '#24272E',
  /** 床の格子の線 */
  grid: '#3B404A',
  /** 格子の間隔 (m) */
  gridCell: 0.5,
  wall: '#1D2026',
  furniture: '#363B45',
  /** 家具の縁 */
  edge: '#4A505C',
} as const;

export type VirtualRoomStyle = typeof VIRTUAL_ROOM_STYLE;

export type VirtualRoomPart = 'floor' | 'wall' | 'furniture';

/**
 * entity を仮の部屋のどの部品として描くか (描かないなら null)。
 * 描くのは薄れない出どころ (部屋のスキャン・試す空間・仮の床) だけ。検出・Mind の推測は「本物があるかもしれない」
 * 程度なので、部屋の一部としては描かない。天井は描かない (見上げても暗いだけの方が落ち着く)。
 */
export function virtualRoomPart(entity: Pick<Entity, 'is' | 'size' | 'source'>): VirtualRoomPart | null {
  const source = entity.source ?? '';
  if (source.startsWith('detector:') || source.startsWith('mind:') || source === 'script') return null;
  const word = entity.is?.[0] ? canonicalWord(entity.is[0]) : '';
  if (word === 'ceiling') return null;
  if (word === 'floor') return 'floor';
  const w = lookupWord(word);
  if (w?.structural && isVertical(entity)) return 'wall';
  return 'furniture';
}
