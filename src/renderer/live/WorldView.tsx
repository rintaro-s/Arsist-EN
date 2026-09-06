/**
 * Arsist Engine — ライブ配置モードの3D俯瞰ビュー
 *
 * ユーザー視点オブジェクト（＋視線）とシーンのオブジェクトを、外から眺める。
 * 「ユーザーが今どこを向いているか」を一目で見るための画面。
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { GroundReference, PlacedObjectMesh, ViewerMarker } from './SceneVisuals';
import type { PlacedObject, ViewerPose } from './useLiveScene';
import type { DeviceFov } from '../utils/deviceFov';

export function WorldView({
  objects,
  viewer,
  fov,
  selectedId,
  onSelect,
  frustumDistance = 2,
  viewerLabel,
  eyeHeight = 1.6,
}: {
  objects: PlacedObject[];
  viewer: ViewerPose;
  fov: DeviceFov | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  frustumDistance?: number;
  viewerLabel?: string;
  eyeHeight?: number;
}) {
  return (
    <Canvas
      gl={{ antialias: true }}
      camera={{ position: [3.5, 2.2, -3.5], fov: 50, near: 0.05, far: 200 }}
      onPointerMissed={() => onSelect('')}
    >
      <color attach="background" args={['#15171b']} />

      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 4]} intensity={0.7} />
      <hemisphereLight args={['#6a7a8a', '#302c28', 0.5]} />

      <GroundReference eyeHeight={eyeHeight} />

      {objects.map((obj) => (
        <PlacedObjectMesh
          key={obj.runtimeId}
          object={obj}
          selected={obj.runtimeId === selectedId}
          onSelect={onSelect}
        />
      ))}

      <ViewerMarker
        viewer={viewer}
        fov={fov}
        frustumDistance={frustumDistance}
        label={viewerLabel}
      />

      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={0.5} maxDistance={40} />

      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#f14c4c', '#4ec9b0', '#569cd6']} labelColor="white" />
      </GizmoHelper>
    </Canvas>
  );
}
