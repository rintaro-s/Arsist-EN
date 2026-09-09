/**
 * 画像アンカーをエディタのビューポートに置く位置を決める。
 *
 * 実行時の姿勢は現実の物体次第なので、エディタ上のこれは「編集用の仮置き」でしかない。
 * 大事なのは向きの規約のほう:
 *
 *   アンカーのローカル系 = +X 印刷面の右 / +Y 上 / +Z 面から手前（見る側）
 *
 * エディタ座標系は +Z がユーザーの前方・+X がユーザーの左なので、
 * ユーザーの方を向いた面は Y 軸まわりに 180° 回した姿勢になる。
 * この回転により、面のローカル +X はエディタの -X（＝ユーザーから見た右）を、
 * ローカル +Z はエディタの -Z（＝ユーザー側）を向く。
 * 詳細と Unity 側との対応は doc/11-perception.md を参照。
 */

export interface AnchorPlacement {
  position: [number, number, number];
  /** ラジアン。Y 軸まわりのみ。 */
  rotationY: number;
}

/** アンカー同士の間隔 (m)。 */
const SPACING = 1.2;
/** ユーザーからの距離 (m)。 */
const DISTANCE = 1.5;

export function anchorPlacement(index: number, count: number): AnchorPlacement {
  const centered = index - (count - 1) / 2;
  // +X はユーザーの左なので、符号を反転して index 0 が左端に見えるようにする
  // （centered が 0 のとき -0 にならないよう明示的に潰す）
  const x = centered === 0 ? 0 : -centered * SPACING;
  return {
    position: [x, 0, DISTANCE],
    rotationY: Math.PI,
  };
}

/**
 * 実物の高さ (m)。指定が無ければ写真のアスペクト比から求める。
 * 写真がまだ読めていない場合は正方形として扱う。
 */
export function resolvePhysicalHeight(
  physicalWidth: number,
  physicalHeight: number | undefined,
  imageAspect: number | null,
): number {
  if (physicalHeight && physicalHeight > 0) return physicalHeight;
  if (imageAspect && imageAspect > 0) return physicalWidth / imageAspect;
  return physicalWidth;
}
