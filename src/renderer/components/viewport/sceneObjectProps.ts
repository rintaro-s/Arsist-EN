import * as THREE from 'three';
import type { SceneObject } from '../../../shared/types';

/**
 * 3D ビューのオブジェクト 1 つぶんの props。
 * 選択・更新はストアを直接呼ぶ (毎回新しい関数を渡すと memo が効かず、ギズモを動かすたびに
 * 全オブジェクトが描き直しになる)。
 */
export interface SceneObjectProps {
  object: SceneObject;
  isSelected: boolean;
  transformMode: 'translate' | 'rotate' | 'scale';
  transformSpace: 'local' | 'world';
}

/** ギズモで動かした three の Object3D から、IR の transform (角度は度) を作る。 */
export function transformOf(node: THREE.Object3D): SceneObject['transform'] {
  return {
    position: { x: node.position.x, y: node.position.y, z: node.position.z },
    rotation: {
      x: THREE.MathUtils.radToDeg(node.rotation.x),
      y: THREE.MathUtils.radToDeg(node.rotation.y),
      z: THREE.MathUtils.radToDeg(node.rotation.z),
    },
    scale: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
  };
}
