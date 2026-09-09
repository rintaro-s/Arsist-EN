/**
 * エディタのビューポートで、置くオブジェクトの半サイズを見積もる。
 *
 * ランタイム (ArsistImageAnchor) は実際の Renderer の範囲を測るが、
 * エディタにはメッシュが無い（GLB/VRM は実行時に読み込まれる）。
 * プリミティブと Canvas は正確に出せるので、そこだけ合わせておけば
 * 「右に10cm」のプレビューは実機とほぼ一致する。
 * モデルは概算になるため、ずれる可能性があることを UI 側で承知しておく。
 */
import type { SceneObject } from '../../shared/types';
import type { PlacementExtents } from '../../shared/placement';

export function estimateObjectExtents(object: SceneObject): PlacementExtents {
  const scale = object.transform?.scale ?? { x: 1, y: 1, z: 1 };

  if (object.type === 'canvas') {
    const width = object.canvasSettings?.widthMeters ?? 1.2;
    const height = object.canvasSettings?.heightMeters ?? 0.7;
    return {
      halfWidth: (width * Math.abs(scale.x)) / 2,
      halfHeight: (height * Math.abs(scale.y)) / 2,
      halfDepth: 0,
    };
  }

  // Unity の組み込みプリミティブはどれも 1m 立方に収まる。
  // Plane だけは厚みが無いので、奥行きを 0 として扱う
  // （「手前に置く」ときに存在しない厚みぶん押し出さないため）。
  const isFlat = object.type === 'primitive' && object.primitiveType === 'plane';

  return {
    halfWidth: 0.5 * Math.abs(scale.x),
    halfHeight: 0.5 * Math.abs(scale.y),
    halfDepth: (isFlat ? 0 : 0.5) * Math.abs(scale.z),
  };
}
