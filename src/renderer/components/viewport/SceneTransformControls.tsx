/**
 * TransformControls をシーンのルートに逃がすラッパー。
 *
 * ギズモは掴んでいるオブジェクトの「ワールド行列」を見て自分の位置を決めるので、
 * 親グループの中に置くとその親の変換がもう一度かかってしまう。
 * 画像アンカーのように、オブジェクトを原点以外のグループの下に置くようになった時点で
 * これが表面化した（アンカーに貼ったオブジェクトを選ぶと、ギズモだけ別の場所に出る）。
 *
 * three.js の TransformControls 自体は親を考慮して localPosition を書き戻すので、
 * 描画位置だけをルートへ移せば編集結果は正しいまま。
 */
import { createPortal, useThree } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import type * as THREE from 'three';

interface SceneTransformControlsProps {
  object: THREE.Object3D;
  mode: 'translate' | 'rotate' | 'scale';
  space: 'local' | 'world';
  onObjectChange: () => void;
}

export function SceneTransformControls({ object, mode, space, onObjectChange }: SceneTransformControlsProps) {
  const { scene } = useThree();
  return createPortal(
    <TransformControls object={object} mode={mode} space={space} onObjectChange={onObjectChange} />,
    scene,
  );
}
