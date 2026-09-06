import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  distanceBetween,
  irToRuntime,
  normalizeAngle,
  pointInFront,
  runtimeToIr,
  type Vec3,
} from './coords';

const DEG = Math.PI / 180;

/** ビルドパイプライン (CreateGameObject) と同じ変換を、独立に計算した参照実装。 */
function referenceMirror(rotation: Vec3): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation.x * DEG, rotation.y * DEG, rotation.z * DEG, 'XYZ'),
  );
  return new THREE.Quaternion(-q.x, q.y, q.z, -q.w);
}

/** 回転の等価性は「オイラー角が一致するか」ではなく「同じ姿勢か」で見る。 */
function expectSameOrientation(actual: Vec3, expected: THREE.Quaternion) {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(actual.x * DEG, actual.y * DEG, actual.z * DEG, 'XYZ'),
  );
  // q と -q は同じ姿勢を表すため、内積の絶対値で比較する
  expect(Math.abs(q.dot(expected))).toBeCloseTo(1, 6);
}

describe('irToRuntime', () => {
  it('位置の X を反転する（IRのX+=ユーザーの左 → Unityでは-x）', () => {
    const out = irToRuntime({
      position: { x: 1.5, y: 0.4, z: 2 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    expect(out.position).toEqual({ x: -1.5, y: 0.4, z: 2 });
  });

  it('回転はビルドパイプラインと同じ X 軸鏡像になる', () => {
    const rotation = { x: 12, y: -47, z: 30 };
    const out = irToRuntime({ position: { x: 0, y: 0, z: 0 }, rotation });
    expectSameOrientation(out.rotation, referenceMirror(rotation));
  });

  it('回転なしなら回転は変わらない', () => {
    const out = irToRuntime({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });
    expectSameOrientation(out.rotation, new THREE.Quaternion());
  });

  it('Y軸回転（一番よく使う）は左右が反転する', () => {
    const out = irToRuntime({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 30, z: 0 } });
    expectSameOrientation(out.rotation, referenceMirror({ x: 0, y: 30, z: 0 }));
    // Y のみの回転なら符号反転で表せるはず（実装が壊れたら気づけるように直接も見る）
    expect(out.rotation.y).toBeCloseTo(-30, 4);
  });
});

describe('runtimeToIr', () => {
  it('irToRuntime の逆変換になっている（往復して元に戻る）', () => {
    const original = {
      position: { x: -0.8, y: 1.2, z: 3.4 },
      rotation: { x: 15, y: 200, z: -40 },
    };
    const roundTrip = runtimeToIr(irToRuntime(original));

    expect(roundTrip.position.x).toBeCloseTo(original.position.x, 6);
    expect(roundTrip.position.y).toBeCloseTo(original.position.y, 6);
    expect(roundTrip.position.z).toBeCloseTo(original.position.z, 6);
    expectSameOrientation(
      roundTrip.rotation,
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(original.rotation.x * DEG, original.rotation.y * DEG, original.rotation.z * DEG, 'XYZ'),
      ),
    );
  });
});

describe('pointInFront', () => {
  it('正面ベクトル方向に distance だけ進んだ点を返す', () => {
    const p = pointInFront({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 2.5);
    expect(p).toEqual({ x: 0, y: 0, z: 2.5 });
  });

  it('正規化されていない向きでも距離が守られる', () => {
    const p = pointInFront({ x: 1, y: 1, z: 1 }, { x: 0, y: 0, z: 5 }, 3);
    expect(distanceBetween({ x: 1, y: 1, z: 1 }, p)).toBeCloseTo(3, 6);
  });

  it('ゼロベクトルでも落ちない', () => {
    const p = pointInFront({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 }, 2);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
  });
});

describe('normalizeAngle', () => {
  it('-180..180 に畳む', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(190)).toBeCloseTo(-170, 6);
    expect(normalizeAngle(359)).toBeCloseTo(-1, 6);
    expect(normalizeAngle(-350)).toBeCloseTo(10, 6);
    expect(normalizeAngle(720)).toBeCloseTo(0, 6);
  });
});
