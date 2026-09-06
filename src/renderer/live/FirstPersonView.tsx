/**
 * Arsist Engine — 「ユーザーに見えている画面」ビュー
 *
 * 与えられた視点姿勢とデバイスの視野角で、シーンをそのまま描く。
 * 実機接続中は実機の姿勢、未接続時は仮想視点（シミュレーション）が入る。
 * どちらも同じコンポーネントを使うので、「PC上のシミュレーション」と
 * 「実機で今見えているもの」の見え方がズレない。
 *
 * 注意: パススルー(MR)の背景は現実のカメラ映像なので再現できない。
 * それらしい絵を描くと誤解を生むため、透過であることが分かる市松模様を敷く。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PlacedObjectMesh } from './SceneVisuals';
import type { PlacedObject, ViewerPose } from './useLiveScene';
import type { DeviceFov } from '../utils/deviceFov';
import type { BackgroundMode } from '../../shared/types';

/** 視点姿勢を毎フレームカメラへ流し込む。 */
function CameraRig({ viewer, fov }: { viewer: ViewerPose; fov: DeviceFov | null }) {
  const { camera, size } = useThree();
  const target = useRef(new THREE.Vector3());

  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(viewer.position.x, viewer.position.y, viewer.position.z);
    target.current.set(
      viewer.position.x + viewer.forward.x,
      viewer.position.y + viewer.forward.y,
      viewer.position.z + viewer.forward.z,
    );
    cam.up.set(viewer.up.x, viewer.up.y, viewer.up.z);
    cam.lookAt(target.current);

    // 縦FOVはデバイス値。横は表示領域のアスペクトで決まるので、
    // コンテナ側をデバイスのアスペクト比に合わせてある（下の FirstPersonView）。
    const desiredFov = fov?.vertical ?? 50;
    if (Math.abs(cam.fov - desiredFov) > 0.01) {
      cam.fov = desiredFov;
    }
    const aspect = size.width / Math.max(1, size.height);
    if (Math.abs(cam.aspect - aspect) > 0.001) {
      cam.aspect = aspect;
    }
    cam.updateProjectionMatrix();
  });

  return null;
}

/** パススルー背景であることを示す市松模様（現実の映像は再現できない） */
function PassthroughBackdrop() {
  return (
    <div
      className="absolute inset-0"
      style={{
        backgroundColor: '#14161a',
        backgroundImage:
          'linear-gradient(45deg, #1c1f25 25%, transparent 25%), linear-gradient(-45deg, #1c1f25 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1c1f25 75%), linear-gradient(-45deg, transparent 75%, #1c1f25 75%)',
        backgroundSize: '24px 24px',
        backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
      }}
    />
  );
}

/**
 * 親の大きさに収まる、指定アスペクト比の枠を計算する。
 *
 * CSS の aspect-ratio だけだと、幅が確定サイズになった時点で高さが決まってしまい、
 * max-height では“縮む”のではなく“はみ出す/切れる”ことになるため、実測して決める。
 */
function useFittedBox(aspect: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      const byWidth = { width: w, height: w / aspect };
      setBox(byWidth.height <= h ? byWidth : { width: h * aspect, height: h });
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [aspect]);

  return { ref, box };
}

export interface FirstPersonViewProps {
  objects: PlacedObject[];
  viewer: ViewerPose;
  fov: DeviceFov | null;
  backgroundMode: BackgroundMode;
  backgroundColor?: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  showLabels?: boolean;
  /** 中心の十字（どこを見ているかの目安） */
  showCrosshair?: boolean;
  className?: string;
}

export function FirstPersonView({
  objects,
  viewer,
  fov,
  backgroundMode,
  backgroundColor = '#000000',
  selectedId,
  onSelect,
  showLabels = false,
  showCrosshair = true,
  className = '',
}: FirstPersonViewProps) {
  // デバイスの視野角から画面のアスペクト比を出す。
  // 視野角が分からない場合は 16:9 にしておく（“それっぽい”比率で描かない方がマシだが、
  // 何も出さないと確認手段が消えるので、比率不明であることはUI側で明示する）
  const aspect = useMemo(() => {
    if (!fov) return 16 / 9;
    const h = Math.tan((fov.horizontal / 2) * (Math.PI / 180));
    const v = Math.tan((fov.vertical / 2) * (Math.PI / 180));
    return v > 0 ? h / v : 16 / 9;
  }, [fov]);

  const isPassthrough = backgroundMode === 'passthrough';
  const { ref, box } = useFittedBox(aspect);

  return (
    <div
      ref={ref}
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
    >
      <div
        className="relative"
        style={{ width: box.width || '100%', height: box.height || '100%' }}
      >
        {isPassthrough && <PassthroughBackdrop />}

        <Canvas
          gl={{ antialias: true, alpha: true }}
          camera={{ fov: fov?.vertical ?? 50, near: 0.03, far: 200 }}
          style={{ position: 'absolute', inset: 0 }}
        >
          {!isPassthrough && (
            <color
              attach="background"
              args={[backgroundMode === 'solidColor' ? backgroundColor : '#101418']}
            />
          )}

          <ambientLight intensity={0.7} />
          <directionalLight position={[3, 6, 3]} intensity={0.8} />
          <hemisphereLight args={['#8899aa', '#332e2a', 0.5]} />

          <CameraRig viewer={viewer} fov={fov} />

          {objects.map((obj) => (
            <PlacedObjectMesh
              key={obj.runtimeId}
              object={obj}
              selected={obj.runtimeId === selectedId}
              onSelect={onSelect}
              showLabel={showLabels}
            />
          ))}
        </Canvas>

        {showCrosshair && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="w-4 h-px bg-white/40" />
            <div className="h-4 w-px bg-white/40 -ml-px" />
          </div>
        )}

        {/* 実際の画面の枠 */}
        <div className="pointer-events-none absolute inset-0 border border-white/15 rounded-sm" />
      </div>
    </div>
  );
}
