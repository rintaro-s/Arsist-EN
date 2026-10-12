import { memo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { SceneTransformControls } from './SceneTransformControls';
import { useProjectStore } from '../../stores/projectStore';
import { loadVrm, peekVrm } from './vrmCache';
import { resolveModelUrl } from './modelUrl';
import { transformOf, type SceneObjectProps } from './sceneObjectProps';

/**
 * VRM アバター。読み込んだものは vrmCache が覚えているので、ビューを作り直しても読み直さない。
 * 読み込み中・失敗時も、置き場所 (object.transform) に仮の箱を出して選べるようにしておく。
 */
export const VRMViewer = memo(function VRMViewer({ object, isSelected, transformMode, transformSpace }: SceneObjectProps) {
  const projectPath = useProjectStore((s) => s.projectPath);
  const url = resolveModelUrl(object.modelPath, projectPath);
  const [vrm, setVrm] = useState<VRM | null>(() => (url ? peekVrm(object.id, url) ?? null : null));
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<THREE.Group | null>(null);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    const cached = peekVrm(object.id, url);
    if (cached) {
      setVrm(cached);
      setError(null);
      return;
    }
    setVrm(null);
    loadVrm(object.id, url).then(
      (v) => { if (alive) { setVrm(v); setError(null); } },
      (err: unknown) => {
        console.error('Error loading VRM:', err);
        if (alive) setError((err as Error)?.message || 'Failed to load VRM');
      },
    );
    // VRM の破棄は vrmCache (オブジェクトが消えたとき) に任せる。ここで捨てると、作り直したときに読み直しになる
    return () => { alive = false; };
  }, [object.id, url]);

  useFrame((_state: unknown, delta: number) => {
    vrm?.update(delta);
  });

  const select = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    useProjectStore.getState().selectObjects([object.id]);
  };

  return (
    <>
      <group
        ref={setGroup}
        userData={{ arsistObjectId: object.id }}
        position={[object.transform.position.x, object.transform.position.y, object.transform.position.z]}
        rotation={[
          THREE.MathUtils.degToRad(object.transform.rotation.x),
          THREE.MathUtils.degToRad(object.transform.rotation.y),
          THREE.MathUtils.degToRad(object.transform.rotation.z),
        ]}
        scale={[object.transform.scale.x, object.transform.scale.y, object.transform.scale.z]}
        onClick={select}
      >
        {vrm ? (
          <primitive object={vrm.scene} />
        ) : (
          // 読み込み中は灰色の枠、失敗は赤 (アバターの大きさの見当: 高さ約 1.6 m)
          <mesh position={[0, 0.8, 0]}>
            <boxGeometry args={[0.5, 1.6, 0.3]} />
            <meshStandardMaterial color={error ? '#f14c4c' : '#888888'} wireframe />
          </mesh>
        )}
      </group>

      {isSelected && group && (
        <SceneTransformControls
          object={group}
          mode={transformMode}
          space={transformSpace}
          onObjectChange={() => useProjectStore.getState().updateObject(object.id, { transform: transformOf(group) })}
        />
      )}
    </>
  );
});
