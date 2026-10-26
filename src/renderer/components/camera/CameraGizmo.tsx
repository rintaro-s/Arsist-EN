/**
 * 仮想カメラ (type 'camera'、doc/23) の 3D の見た目と、エディタの 3D ビューの「カメラの画」の小窓。
 *
 *   CameraGizmo    カメラの形 (箱 + レンズ) と撮る範囲 (視錐台)。前はローカル +Z。エディタとプレビューのシミュレーターが使う
 *   CameraObject   エディタの 3D ビューの 1 台 (選べる・ギズモで動かせる)
 *   CameraPreview  選んだカメラから見た画を、3D ビューの左下に小さく描く (同じ WebGL に 2 回目を描くだけ。読み戻しはしない)
 *
 * 線は StableLine (drei の <Line> は使わない。CLAUDE.md の注意)。
 */
import { memo, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { CameraSettings, SceneObject } from '../../../shared/types';
import { cameraSettingsOf } from '../../../shared/media';
import { StableLine } from '../viewport/StableLine';
import { SceneTransformControls } from '../viewport/SceneTransformControls';
import { transformOf, type SceneObjectProps } from '../viewport/sceneObjectProps';
import { useProjectStore } from '../../stores/projectStore';
import { applyCameraObject, hideForCameraView, previewBox } from './cameraView';

const DEG = Math.PI / 180;
const BODY = '#3a4150';
const FRUSTUM = '#569cd6';
const SELECTED = '#4ec9b0';

/** カメラの形と撮る範囲。userData.arsistEditorOnly = カメラの画には写さない (実機はレイヤー ArsistCameraGizmo) */
export function CameraGizmo({ settings, selected = false, length = 0.5 }: { settings?: CameraSettings; selected?: boolean; length?: number }) {
  const s = cameraSettingsOf(settings);
  const aspect = s.resolution[0] / s.resolution[1];
  const { corners, up } = useMemo(() => {
    const halfH = length * Math.tan((s.fov / 2) * DEG);
    const halfW = halfH * aspect;
    const c: [number, number, number][] = [
      [-halfW, halfH, length], [halfW, halfH, length], [halfW, -halfH, length], [-halfW, -halfH, length],
    ];
    // 上の印 (三角)。どちらが画の上か分かるように
    const u: [number, number, number][] = [[-halfW * 0.3, halfH * 1.05, length], [0, halfH * 1.3, length], [halfW * 0.3, halfH * 1.05, length]];
    return { corners: c, up: u };
  }, [s.fov, aspect, length]);
  const color = selected ? SELECTED : FRUSTUM;
  return (
    <group userData={{ arsistEditorOnly: true }}>
      <mesh>
        <boxGeometry args={[0.1, 0.07, 0.12]} />
        <meshStandardMaterial color={BODY} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.08]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.032, 0.026, 0.05, 20]} />
        <meshStandardMaterial color="#15181e" roughness={0.3} metalness={0.4} />
      </mesh>
      {corners.map((c, i) => (
        <StableLine key={i} points={[[0, 0, 0.1], c]} color={color} lineWidth={1} transparent opacity={0.6} />
      ))}
      <StableLine points={[...corners, corners[0]]} color={color} lineWidth={selected ? 2 : 1.5} />
      <StableLine points={up} color={color} lineWidth={1.5} />
    </group>
  );
}

/** エディタの 3D ビューのカメラ 1 台 */
export const CameraObject = memo(function CameraObject({ object, isSelected, transformMode, transformSpace }: SceneObjectProps) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const t = object.transform;
  return (
    <>
      <group
        ref={setGroup}
        userData={{ arsistObjectId: object.id }}
        position={[t.position.x, t.position.y, t.position.z]}
        rotation={[t.rotation.x * DEG, t.rotation.y * DEG, t.rotation.z * DEG]}
        onClick={(e) => { e.stopPropagation(); useProjectStore.getState().selectObjects([object.id]); }}
      >
        <CameraGizmo settings={object.camera} selected={isSelected} />
      </group>
      {isSelected && group && (
        <SceneTransformControls
          object={group}
          // 大きさは意味を持たない (撮る範囲は画角と解像度で決まる)
          mode={transformMode === 'scale' ? 'translate' : transformMode}
          space={transformSpace}
          onObjectChange={() => {
            const next = transformOf(group);
            useProjectStore.getState().updateObject(object.id, { transform: { ...next, scale: t.scale } });
          }}
        />
      )}
    </>
  );
});

/**
 * 選んだカメラから見た画を、3D ビューの左下 (下から bottom px) に描く。
 * GizmoHelper (drei の Hud、優先 1) がふつうの画を描いたあとに、優先 2 で同じ WebGL の隅にもう 1 回描く。
 * 選んでいる間だけ。
 */
export function CameraPreview({ object, parent, bottom = 44, left = 8 }: { object: SceneObject; parent?: THREE.Matrix4; bottom?: number; left?: number }) {
  const cam = useMemo(() => new THREE.PerspectiveCamera(), []);
  const background = useMemo(() => new THREE.Color(), []);
  useFrame(({ gl, scene }: { gl: THREE.WebGLRenderer; scene: THREE.Scene }) => {
    const s = applyCameraObject(cam, object, parent);
    const { width, height } = previewBox(object.camera);
    const restore = hideForCameraView(scene, s.showSelf);
    const prevBackground = scene.background;
    background.set(s.backgroundColor);
    scene.background = background;
    const prevAutoClear = gl.autoClear;
    const viewport = gl.getViewport(new THREE.Vector4());
    gl.autoClear = false;
    gl.setScissorTest(true);
    gl.setScissor(left, bottom, width, height);
    gl.setViewport(left, bottom, width, height);
    gl.clear(true, true, true);
    gl.render(scene, cam);
    gl.setScissorTest(false);
    gl.setViewport(viewport);
    gl.autoClear = prevAutoClear;
    scene.background = prevBackground;
    restore();
  }, 2);
  return null;
}
