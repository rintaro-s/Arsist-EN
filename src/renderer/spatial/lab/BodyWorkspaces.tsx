/**
 * 体 (ロボット) の動ける範囲を、根元の目印 (base.thing) の置き場所に描く。安全の門はこの箱の外への命令を送らない。
 */
import { memo, useEffect, useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Body } from '../../../shared/layster/spatial/types';
import type { SolveResult, SolveWorld } from '../../../shared/layster/spatial/solver';
import { toThree, yawToThree } from './coords';
import { worldPoseOf } from './ThingMeshes';

const BODY_COLOR = '#f0a050';

export const BodyWorkspaces = memo(function BodyWorkspaces({ bodies, results, world, selected }: {
  bodies: Body[]; results: SolveResult[]; world: SolveWorld; selected: string | null;
}) {
  return (
    <group>
      {bodies.map((b) => {
        const r = results.find((x) => x.thing === b.base?.thing);
        if (!r || (b.twin?.showWorkspace === false && b.id !== selected)) return null;
        const pose = worldPoseOf(r, world);
        return (
          <group key={b.id} position={toThree(pose.at)} rotation={[0, yawToThree(pose.yaw), 0]}>
            <Workspace body={b} selected={b.id === selected} />
          </group>
        );
      })}
    </group>
  );
});

function Workspace({ body, selected }: { body: Body; selected: boolean }) {
  const [w, h, d] = body.workspace.size;
  const geometry = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(w, 0.01), Math.max(h, 0.01), Math.max(d, 0.01))), [w, h, d]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const c = body.workspace.center;
  return (
    <group position={toThree(c)}>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color={BODY_COLOR} transparent opacity={selected ? 1 : 0.6} />
      </lineSegments>
      <mesh>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial color={BODY_COLOR} transparent opacity={selected ? 0.12 : 0.05} depthWrite={false} />
      </mesh>
      <Html position={[0, h / 2 + 0.05, 0]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
        <div className="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap" style={{ background: BODY_COLOR, color: '#2a1600' }}>
          {body.name || body.id}
        </div>
      </Html>
    </group>
  );
}
