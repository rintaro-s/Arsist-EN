/**
 * IR (右・上・前、RUF) → three.js (右手系) の変換。**3D 表示だけ**で使う (IR に鏡写しの約束は持ち込まない)。
 *
 * three は +Z が手前なので、IR の z を反転する。yaw (上から見て時計回りが正) は three の Y 回りでは負になる。
 * そうすると IR の「物の前 (ローカル +Z)」は three ではローカル -Z (カメラが見る向きと同じ) になる。
 */
import type { Vec3 } from '../../../shared/layster/spatial/types';

export function toThree(v: Vec3): [number, number, number] {
  return [v[0], v[1], -v[2]];
}

export function yawToThree(yawDeg: number): number {
  return (-yawDeg * Math.PI) / 180;
}
