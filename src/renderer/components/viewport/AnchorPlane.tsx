/**
 * AnchorPlane — ビューポートに描く画像アンカーの板。
 *
 * 参照写真を実寸のテクスチャ板として出すことで、作者は「画像認識を設定する」のではなく
 * 「物の写真の上に物を置く」操作をすればよくなる。
 * 親グループがアンカーのローカル系を作っているので、ここは原点にそのまま置く。
 */
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import type { PerceptionTarget } from '../../../shared/types';
import { toArsistFileUrl } from '../../utils/assetUrl';
import { resolvePhysicalHeight } from '../../perception/anchorLayout';
import { regionToBase } from '../../../shared/placement';

interface AnchorPlaneProps {
  target: PerceptionTarget;
  projectPath: string | null;
  isSelected: boolean;
  onSelect: () => void;
}

export function AnchorPlane({ target, projectPath, isSelected, onSelect }: AnchorPlaneProps) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    const url = toArsistFileUrl(projectPath, target.imagePath);

    // useTexture (drei) は読み込み失敗で Suspense ごと落ちるので、自前で読んで
    // 失敗時はプレースホルダの板を出すだけに留める。
    new THREE.TextureLoader().load(
      url,
      (loaded) => {
        if (cancelled) { loaded.dispose(); return; }
        loaded.colorSpace = THREE.SRGBColorSpace;
        setTexture(loaded);
        setAspect(loaded.image?.width && loaded.image?.height
          ? loaded.image.width / loaded.image.height
          : null);
      },
      undefined,
      () => { if (!cancelled) setTexture(null); },
    );

    return () => { cancelled = true; };
  }, [projectPath, target.imagePath]);

  useEffect(() => () => texture?.dispose(), [texture]);

  const width = target.physicalWidth > 0 ? target.physicalWidth : 0.3;
  const height = resolvePhysicalHeight(width, target.physicalHeight, aspect);

  return (
    <group>
      <mesh
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <planeGeometry args={[width, height]} />
        {texture
          ? <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
          : <meshBasicMaterial color="#2a2f3a" side={THREE.DoubleSide} />}
      </mesh>

      {/* 枠。選択中は強調する */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(width, height)]} />
        <lineBasicMaterial color={isSelected ? '#4ec9b0' : '#3fa88f'} />
      </lineSegments>

      {/* 写真の上に描いた枠。配置の基準にも OCR の範囲にもなるので、3D 側でも見えた方がよい */}
      {(target.regions ?? []).map((region) => {
        const base = regionToBase(width, height, region.rect);
        return (
          <group key={region.id} position={[base.centerX, base.centerY, 0.001]}>
            <lineSegments>
              <edgesGeometry args={[new THREE.PlaneGeometry(base.halfWidth * 2, base.halfHeight * 2)]} />
              <lineBasicMaterial color="#4ec9b0" />
            </lineSegments>
          </group>
        );
      })}

      {/* 面の向き（+Z = 面から手前）を示す短い軸。オフセットの符号を間違えないための目印。 */}
      <mesh position={[0, 0, 0.05]}>
        <boxGeometry args={[0.004, 0.004, 0.1]} />
        <meshBasicMaterial color="#569cd6" />
      </mesh>

      <Text
        position={[0, height / 2 + 0.05, 0]}
        fontSize={Math.min(0.06, Math.max(0.02, height * 0.18))}
        color={isSelected ? '#4ec9b0' : '#9a9a9a'}
        anchorX="center"
        anchorY="bottom"
      >
        {target.name}
      </Text>
    </group>
  );
}
