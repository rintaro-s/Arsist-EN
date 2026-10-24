/**
 * presentation.reality: 'virtual-room' のときの「仮の部屋」(端末の SpatialVirtualRoom.cs と同じ見た目)。
 * 何をどの色で描くかは src/shared/layster/spatial/virtualRoom.ts だけで決める。
 *   床      平らな面 + 格子 (中心から gridCell ごと)
 *   壁      面の裏 (部屋の外側) に 2 cm の厚み
 *   家具    箱 + 縁の線。上の面ほど明るく (端末のシェーダーと同じ考え)
 */
import { memo, useMemo } from 'react';
import * as THREE from 'three';
import type { Entity } from '../../../shared/layster/spatial/types';
import { VIRTUAL_ROOM_STYLE as STYLE, virtualRoomPart } from '../../../shared/layster/spatial/virtualRoom';
import { toThree, yawToThree } from './coords';

const THICKNESS = 0.02;

export const VirtualRoom = memo(function VirtualRoom({ entities }: { entities: Entity[] }) {
  return (
    <group>
      {entities.map((e) => {
        const part = virtualRoomPart(e);
        if (!part) return null;
        return (
          <group key={e.id} position={toThree(e.at)} rotation={[0, yawToThree(e.yaw ?? 0), 0]}>
            {part === 'floor' ? <Floor size={e.size} /> : part === 'wall' ? <Wall size={e.size} /> : <Furniture size={e.size} />}
          </group>
        );
      })}
    </group>
  );
});

function Floor({ size }: { size: Entity['size'] }) {
  const [w, , d] = size;
  const grid = useMemo(() => {
    const pts: number[] = [];
    const cell = STYLE.gridCell;
    const y = 0.001;
    for (let x = 0; x <= w / 2; x += cell) for (const s of x === 0 ? [1] : [1, -1]) pts.push(s * x, y, -d / 2, s * x, y, d / 2);
    for (let z = 0; z <= d / 2; z += cell) for (const s of z === 0 ? [1] : [1, -1]) pts.push(-w / 2, y, s * z, w / 2, y, s * z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [w, d]);
  return (
    <group>
      <mesh position={[0, -THICKNESS / 2, 0]}>
        <boxGeometry args={[Math.max(w, 0.01), THICKNESS, Math.max(d, 0.01)]} />
        <meshBasicMaterial color={STYLE.floor} />
      </mesh>
      <lineSegments geometry={grid}>
        <lineBasicMaterial color={STYLE.grid} />
      </lineSegments>
    </group>
  );
}

/** 上の面ほど明るい箱 (端末の ArsistSpatialRoom.shader と同じ 0.82 .. 1.0) */
function useShadedBox(w: number, h: number, d: number, color: string): THREE.BoxGeometry {
  return useMemo(() => {
    const g = new THREE.BoxGeometry(w, h, d);
    const base = new THREE.Color(color);
    const normals = g.getAttribute('normal');
    const colors: number[] = [];
    for (let i = 0; i < normals.count; i++) {
      const k = 0.82 + 0.18 * Math.min(1, Math.max(0, normals.getY(i) * 0.5 + 0.5));
      colors.push(base.r * k, base.g * k, base.b * k);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }, [w, h, d, color]);
}

function Wall({ size }: { size: Entity['size'] }) {
  const [w, h, d] = size;
  const depth = Math.max(d, THICKNESS);
  const geometry = useShadedBox(Math.max(w, 0.01), Math.max(h, 0.01), depth, STYLE.wall);
  // IR の箱の +Z (部屋の内側) は three では -Z。厚みは外側 (three の +Z) に足す
  return (
    <mesh geometry={geometry} position={[0, 0, d > THICKNESS ? 0 : depth / 2]}>
      <meshBasicMaterial vertexColors />
    </mesh>
  );
}

function Furniture({ size }: { size: Entity['size'] }) {
  const geometry = useShadedBox(Math.max(size[0], 0.01), Math.max(size[1], 0.01), Math.max(size[2], 0.01), STYLE.furniture);
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);
  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial vertexColors />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={STYLE.edge} />
      </lineSegments>
    </group>
  );
}
