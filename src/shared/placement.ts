/**
 * 画像アンカーへの相対配置の計算。
 *
 * 「その物の右に10cm」を、ターゲットと置くオブジェクトの実寸から
 * ターゲット座標系のオフセットに変換する。
 *
 * ここを純関数にしてあるのは、まったく同じ計算をエディタのビューポート
 * プレビューとランタイム (C# の ArsistImageAnchor) の両方が必要とするため。
 * 片方だけ直すと、エディタで見た位置と実機の位置がずれる。
 * C# 側はこのファイルの写しであり、placement.test.ts の表と同じ値を返す。
 *
 * 座標系: +X = 印刷面の右 / +Y = 上 / +Z = 面から手前（doc/11-perception.md §3.3）
 */
import type { AnchorPlacement, PlacementSide, Vector3 } from './types';

/** 基準となる矩形（ターゲット全体か、その上の領域）。ターゲット座標系のメートル。 */
export interface PlacementBase {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
}

/** 置くオブジェクトの半サイズ（メートル）。 */
export interface PlacementExtents {
  halfWidth: number;
  halfHeight: number;
  halfDepth: number;
}

const ZERO_EXTENTS: PlacementExtents = { halfWidth: 0, halfHeight: 0, halfDepth: 0 };

/** side を単位ベクトルにする。 */
export function sideDirection(side: PlacementSide): Vector3 {
  switch (side) {
    case 'left': return { x: -1, y: 0, z: 0 };
    case 'right': return { x: 1, y: 0, z: 0 };
    case 'above': return { x: 0, y: 1, z: 0 };
    case 'below': return { x: 0, y: -1, z: 0 };
    case 'front': return { x: 0, y: 0, z: 1 };
    case 'behind': return { x: 0, y: 0, z: -1 };
    default: return { x: 0, y: 0, z: 0 };
  }
}

/**
 * placement をターゲット座標系のオフセットに解決する。
 * 呼び出し側で SceneObject.transform.position を加算すること（微調整として合成される）。
 */
export function resolvePlacement(
  placement: AnchorPlacement,
  base: PlacementBase,
  object: PlacementExtents = ZERO_EXTENTS,
): Vector3 {
  const dir = sideDirection(placement.side);
  const gap = Number.isFinite(placement.gap) ? placement.gap : 0;

  // 基準の縁までの距離。面 (front/behind) には厚みが無いので 0。
  const baseExtent =
    placement.side === 'left' || placement.side === 'right' ? base.halfWidth :
    placement.side === 'above' || placement.side === 'below' ? base.halfHeight :
    0;

  // 'near' はオブジェクトの手前の縁を基準の縁に合わせる → 自分の半サイズぶん押し出す。
  const objectExtent = placement.align === 'near'
    ? (placement.side === 'left' || placement.side === 'right' ? object.halfWidth :
       placement.side === 'above' || placement.side === 'below' ? object.halfHeight :
       placement.side === 'front' || placement.side === 'behind' ? object.halfDepth :
       0)
    : 0;

  const distance = placement.side === 'center' ? 0 : baseExtent + gap + objectExtent;

  const cross = crossOffset(placement, base, object);

  return {
    x: base.centerX + dir.x * distance + cross.x,
    y: base.centerY + dir.y * distance + cross.y,
    z: dir.z * distance + cross.z,
  };
}

/**
 * 縁に沿った方向の揃え。
 * 左右に置くときは上下方向、上下に置くときは左右方向に効く。
 * front / behind / center では意味を持たないので 0。
 */
function crossOffset(
  placement: AnchorPlacement,
  base: PlacementBase,
  object: PlacementExtents,
): Vector3 {
  if (placement.cross === 'center') return { x: 0, y: 0, z: 0 };

  const sign = placement.cross === 'start' ? -1 : 1;

  if (placement.side === 'left' || placement.side === 'right') {
    // 'start' = 下端揃え, 'end' = 上端揃え
    return { x: 0, y: sign * (base.halfHeight - object.halfHeight), z: 0 };
  }
  if (placement.side === 'above' || placement.side === 'below') {
    // 'start' = 左端揃え, 'end' = 右端揃え
    return { x: sign * (base.halfWidth - object.halfWidth), y: 0, z: 0 };
  }
  return { x: 0, y: 0, z: 0 };
}

/**
 * 領域 (正規化された写真上の矩形) を、ターゲット座標系の基準矩形に直す。
 * regionRect を省略するとターゲット全体になる。
 */
export function regionToBase(
  physicalWidth: number,
  physicalHeight: number,
  regionRect?: { x: number; y: number; width: number; height: number },
): PlacementBase {
  if (!regionRect) {
    return {
      centerX: 0,
      centerY: 0,
      halfWidth: physicalWidth / 2,
      halfHeight: physicalHeight / 2,
    };
  }
  // 正規化座標は原点が写真の左下。ターゲット座標系は中心が原点。
  return {
    centerX: (regionRect.x + regionRect.width / 2 - 0.5) * physicalWidth,
    centerY: (regionRect.y + regionRect.height / 2 - 0.5) * physicalHeight,
    halfWidth: (regionRect.width * physicalWidth) / 2,
    halfHeight: (regionRect.height * physicalHeight) / 2,
  };
}

/** エディタで新しく貼り付けたときの既定値。 */
export function defaultPlacement(): AnchorPlacement {
  return { side: 'right', gap: 0.05, align: 'near', cross: 'center', facing: 'user' };
}
