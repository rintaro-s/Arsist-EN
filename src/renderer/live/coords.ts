/**
 * Arsist Engine — ライブ配置モード / シミュレーション用 座標変換
 *
 * エディタのIR座標と、実機で動いている Unity のワールド座標は同じではない。
 *   IR:    原点=ユーザーのスポーン視点, Z+=正面, X+=ユーザーの左
 *   Unity: X が反転 (x → -x)、回転は X 軸まわりの鏡像
 * 変換の本体は ArsistBuildPipeline.CreateGameObject にあり、ここはその写し。
 * (doc/01-ir-types.md「Coordinate system」も参照)
 *
 * ライブ配置モードは実機の値をそのまま扱う＝Unity空間なので、
 *   ・IRのオブジェクトを実機と同じ見え方で描く → irToRuntime
 *   ・実機で調整した結果をプロジェクトに書き戻す → runtimeToIr
 * が要る。X反転も回転鏡像も自分自身が逆変換になる（2回かけると元に戻る）ので、
 * 実装は1つで足りるが、呼び出し側の意図が読めるように名前を分けている。
 */
import * as THREE from 'three';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** 位置の X 反転。 */
function mirrorPosition(p: Vec3): Vec3 {
  return { x: -p.x, y: p.y, z: p.z };
}

/**
 * 回転（オイラー角・度）の X 軸鏡像。
 * ビルドパイプラインと同じく、クォータニオン (x,y,z,w) → (-x,y,z,-w) で行う。
 * オイラー角のまま符号を弄ると軸順序の解釈で破綻するため、必ずクォータニオン経由。
 */
function mirrorRotation(r: Vec3): Vec3 {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(r.x * DEG, r.y * DEG, r.z * DEG, 'XYZ'),
  );
  const mirrored = new THREE.Quaternion(-q.x, q.y, q.z, -q.w);
  const e = new THREE.Euler().setFromQuaternion(mirrored, 'XYZ');
  return { x: e.x * RAD, y: e.y * RAD, z: e.z * RAD };
}

/** IR座標 → 実機(Unity)ワールド座標 */
export function irToRuntime(t: { position: Vec3; rotation: Vec3 }): {
  position: Vec3;
  rotation: Vec3;
} {
  return { position: mirrorPosition(t.position), rotation: mirrorRotation(t.rotation) };
}

/** 実機(Unity)ワールド座標 → IR座標 */
export function runtimeToIr(t: { position: Vec3; rotation: Vec3 }): {
  position: Vec3;
  rotation: Vec3;
} {
  return { position: mirrorPosition(t.position), rotation: mirrorRotation(t.rotation) };
}

/** 角度を -180..180 に畳む（インスペクタ表示のちらつき防止） */
export function normalizeAngle(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function normalizeEuler(r: Vec3): Vec3 {
  return { x: normalizeAngle(r.x), y: normalizeAngle(r.y), z: normalizeAngle(r.z) };
}

/**
 * 「ユーザーの正面 distance[m]」のワールド座標。
 * viewer.placeInFront と同じ計算をエディタ側でも行い、プレビュー表示に使う。
 */
export function pointInFront(position: Vec3, forward: Vec3, distance: number): Vec3 {
  const len = Math.hypot(forward.x, forward.y, forward.z) || 1;
  return {
    x: position.x + (forward.x / len) * distance,
    y: position.y + (forward.y / len) * distance,
    z: position.z + (forward.z / len) * distance,
  };
}

/** 2点間の距離[m]。インスペクタの「ユーザーからの距離」表示に使う。 */
export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
