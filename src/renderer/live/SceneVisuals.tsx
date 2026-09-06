/**
 * Arsist Engine — ライブ配置モード / シミュレーション共通の3D表示物
 *
 * ここに描くものは全て **Unity ワールド座標** で扱う（実機の値をそのまま入れられる）。
 * three.js も Y-up・Z前方で同じ手系の扱いができるため、変換なしでそのまま置ける。
 */
import { useMemo } from 'react';
import { Billboard, Line, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { PlacedObject, ViewerPose } from './useLiveScene';
import type { DeviceFov } from '../utils/deviceFov';

const SELECTED_COLOR = '#ffb454';
const VIEWER_COLOR = '#4ec9b0';

function eulerFrom(rotation: { x: number; y: number; z: number }): [number, number, number] {
  const d = Math.PI / 180;
  return [rotation.x * d, rotation.y * d, rotation.z * d];
}

/** オブジェクト1つ分の見た目。IRで型が分かるものはその形、分からないものは箱で描く。 */
export function PlacedObjectMesh({
  object,
  selected,
  onSelect,
  showLabel = true,
}: {
  object: PlacedObject;
  selected: boolean;
  onSelect?: (id: string) => void;
  showLabel?: boolean;
}) {
  const color = selected ? SELECTED_COLOR : object.color || (object.orphan ? '#8a8a8a' : '#569cd6');
  const position: [number, number, number] = [object.position.x, object.position.y, object.position.z];
  const rotation = eulerFrom(object.rotation);
  const scale: [number, number, number] = [object.scale.x, object.scale.y, object.scale.z];

  // VRM / GLB は実物の形をここでは持っていないので代理形状で描く。
  // 1m の立方体で描くと「実機でもこの大きさ」と誤読されるため、
  // VRM は等身大の人型サイズ、モデルはワイヤーフレーム箱にして代理だと分かるようにする。
  const geometry = useMemo(() => {
    if (object.type === 'canvas') {
      const w = object.canvasSize?.width ?? 1.6;
      const h = object.canvasSize?.height ?? 0.9;
      return <planeGeometry args={[w, h]} />;
    }
    if (object.type === 'vrm') {
      return <capsuleGeometry args={[0.22, 1.15, 6, 14]} />;
    }
    if (object.type === 'model') {
      return <boxGeometry args={[0.5, 0.5, 0.5]} />;
    }
    if (object.type === 'light' || object.type === 'camera' || object.type === 'empty') {
      return <sphereGeometry args={[0.08, 12, 8]} />;
    }
    switch (object.primitiveType) {
      case 'sphere':
        return <sphereGeometry args={[0.5, 24, 16]} />;
      case 'plane':
        return <planeGeometry args={[1, 1]} />;
      case 'cylinder':
        return <cylinderGeometry args={[0.5, 0.5, 1, 24]} />;
      case 'capsule':
        return <capsuleGeometry args={[0.5, 1, 8, 16]} />;
      default:
        return <boxGeometry args={[1, 1, 1]} />;
    }
  }, [object.type, object.primitiveType, object.canvasSize?.width, object.canvasSize?.height]);

  const isFlat = object.type === 'canvas' || object.primitiveType === 'plane';
  // 実物ではなく代理形状であることを見た目でも示す
  const isProxy = object.type === 'vrm' || object.type === 'model';
  // VRM は足元が原点なので、代理カプセルを上に持ち上げて立たせる
  const proxyOffsetY = object.type === 'vrm' ? 0.8 : 0;

  // ラベルは「位置だけ」を継承する外側のグループに置く。
  // 内側（回転・スケール付き）に入れると、裏から見たとき鏡文字になり、
  // 小さいオブジェクトではラベルまで縮んで読めなくなる。
  const labelHeight = proxyOffsetY + (isFlat ? 0.6 : 0.75) * Math.max(scale[1], 0.2);

  return (
    <group position={position}>
      <group rotation={rotation} scale={scale}>
        <mesh
          position={[0, proxyOffsetY, 0]}
          onClick={(e) => {
            if (!onSelect) return;
            e.stopPropagation();
            onSelect(object.runtimeId);
          }}
        >
          {geometry}
          <meshStandardMaterial
            color={color}
            transparent
            opacity={isProxy ? 0.55 : isFlat ? 0.75 : 0.9}
            wireframe={object.type === 'model'}
            side={isFlat ? THREE.DoubleSide : THREE.FrontSide}
            emissive={selected ? SELECTED_COLOR : '#000000'}
            emissiveIntensity={selected ? 0.35 : 0}
          />
        </mesh>
      </group>

      {showLabel && (
        <Billboard position={[0, labelHeight, 0]}>
          <Text
            fontSize={0.12}
            color={selected ? SELECTED_COLOR : '#d4d4d4'}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.004}
            outlineColor="#101215"
          >
            {object.name}
          </Text>
        </Billboard>
      )}
    </group>
  );
}

/**
 * ユーザー視点（頭）の表示。
 * 球体＋視線レイ＋視錐台で「今どこを向いているか」を示す。
 */
export function ViewerMarker({
  viewer,
  fov,
  frustumDistance = 2,
  gazeLength = 6,
  label,
}: {
  viewer: ViewerPose;
  fov: DeviceFov | null;
  frustumDistance?: number;
  gazeLength?: number;
  label?: string;
}) {
  const { position, forward } = viewer;

  // 視点姿勢のクォータニオン（視錐台を正しい向きに置くため）
  const quaternion = useMemo(() => {
    const f = new THREE.Vector3(forward.x, forward.y, forward.z).normalize();
    const up = new THREE.Vector3(viewer.up.x, viewer.up.y, viewer.up.z).normalize();
    const m = new THREE.Matrix4();
    // three.js のカメラは -Z 前方だが、ここで置くのは「マーカー」なので
    // +Z 前方として扱い、視錐台の頂点計算と一致させる。
    const right = new THREE.Vector3().crossVectors(up, f).normalize();
    const trueUp = new THREE.Vector3().crossVectors(f, right).normalize();
    m.makeBasis(right, trueUp, f);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }, [forward.x, forward.y, forward.z, viewer.up.x, viewer.up.y, viewer.up.z]);

  const frustumCorners = useMemo(() => {
    if (!fov) return null;
    const halfW = frustumDistance * Math.tan((fov.horizontal / 2) * (Math.PI / 180));
    const halfH = frustumDistance * Math.tan((fov.vertical / 2) * (Math.PI / 180));
    return [
      [-halfW, halfH, frustumDistance],
      [halfW, halfH, frustumDistance],
      [halfW, -halfH, frustumDistance],
      [-halfW, -halfH, frustumDistance],
    ] as [number, number, number][];
  }, [fov, frustumDistance]);

  const gazeEnd: [number, number, number] = [0, 0, gazeLength];

  return (
    <group position={[position.x, position.y, position.z]} quaternion={quaternion}>
      {/* 視点そのもの */}
      <mesh>
        <sphereGeometry args={[0.08, 20, 16]} />
        <meshStandardMaterial color={VIEWER_COLOR} emissive={VIEWER_COLOR} emissiveIntensity={0.6} />
      </mesh>
      {/* 鼻: 向きが一目で分かるように前方に小さな円錐 */}
      <mesh position={[0, 0, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.04, 0.12, 12]} />
        <meshStandardMaterial color={VIEWER_COLOR} />
      </mesh>

      {/* 視線 */}
      <Line points={[[0, 0, 0], gazeEnd]} color={VIEWER_COLOR} lineWidth={2} transparent opacity={0.9} />
      <mesh position={gazeEnd}>
        <sphereGeometry args={[0.03, 12, 8]} />
        <meshBasicMaterial color={VIEWER_COLOR} />
      </mesh>

      {/* 視錐台 */}
      {frustumCorners && (
        <group>
          {frustumCorners.map((corner, i) => (
            <Line
              key={`fedge-${i}`}
              points={[[0, 0, 0], corner]}
              color={VIEWER_COLOR}
              lineWidth={1}
              transparent
              opacity={0.4}
            />
          ))}
          <Line
            points={[...frustumCorners, frustumCorners[0]]}
            color={VIEWER_COLOR}
            lineWidth={1.5}
            transparent
            opacity={0.7}
          />
        </group>
      )}

      {label && (
        <Billboard position={[0, 0.24, 0]}>
          <Text
            fontSize={0.11}
            color={VIEWER_COLOR}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.004}
            outlineColor="#101215"
          >
            {label}
          </Text>
        </Billboard>
      )}
    </group>
  );
}

/** 床グリッドと原点（＝スポーン視点）の目印。 */
export function GroundReference({ eyeHeight = 1.6 }: { eyeHeight?: number }) {
  return (
    <group>
      {/* 原点(=スポーン視点)から見た床面。IRの原点は目の高さなので床は -eyeHeight */}
      <gridHelper
        args={[20, 20, '#4a4a4a', '#3c3c3c']}
        position={[0, -eyeHeight, 0]}
      />
      {/* 原点マーカー */}
      <mesh>
        <sphereGeometry args={[0.035, 12, 8]} />
        <meshBasicMaterial color="#f14c4c" />
      </mesh>
      <Line points={[[0, 0, 0], [0, -eyeHeight, 0]]} color="#f14c4c" lineWidth={1} transparent opacity={0.4} />
    </group>
  );
}
