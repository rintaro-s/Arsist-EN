import { memo, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { SceneTransformControls } from './SceneTransformControls';
import { useProjectStore } from '../../stores/projectStore';
import { loadVrm, peekVrm } from './vrmCache';
import { resolveModelUrl } from './modelUrl';
import { transformOf, type SceneObjectProps } from './sceneObjectProps';
import { previewAnimationFor, useCharacterStore } from '../character/characterStore';
import { retargetedClip } from '../character/animationRetarget';

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

  // キャラクターの動きの試し再生 (選んでいる間だけ)。実機は Unity の Humanoid が同じ FBX を流す
  const animations = useCharacterStore((s) => s.animations);
  const preview = useCharacterStore((s) => s.preview);
  const animationName = previewAnimationFor(preview, object.id, isSelected, object.character?.animation);
  const animationPath = animationName ? animations.find((a) => a.name === animationName)?.assetPath : undefined;
  const animationUrl = animationPath ? resolveModelUrl(animationPath, projectPath) : '';
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  useEffect(() => {
    if (!vrm || !animationUrl) return;
    let alive = true;
    let mixer: THREE.AnimationMixer | null = null;
    retargetedClip(animationUrl, vrm).then(
      (clip) => {
        if (!alive) return;
        mixer = new THREE.AnimationMixer(vrm.scene);
        mixer.clipAction(clip).play();
        mixerRef.current = mixer;
      },
      (err: unknown) => console.warn(`[Arsist] animation preview failed (${animationName}):`, err),
    );
    return () => {
      alive = false;
      if (mixer) {
        mixer.stopAllAction();
        mixer.uncacheRoot(vrm.scene);
      }
      if (mixerRef.current === mixer) mixerRef.current = null;
      // 休みの姿勢に戻す (VRM 自体は読み直さない)
      vrm.humanoid?.resetNormalizedPose();
    };
  }, [vrm, animationUrl, animationName]);

  useFrame((_state: unknown, delta: number) => {
    mixerRef.current?.update(delta);
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
