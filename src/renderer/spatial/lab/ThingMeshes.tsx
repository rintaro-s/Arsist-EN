/**
 * アプリの物を、解いた置き場所に描く。見た目は種類ごとの目安 (実機の見た目そのものではない)。
 * head / hand に付く物は、試す空間のユーザーの頭・手の位置に直して描く。
 */
import { memo, useEffect, useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Thing, Vec3 } from '../../../shared/layster/spatial/types';
import { offsetToWorld, thingSize, type SolveResult, type SolveWorld } from '../../../shared/layster/spatial/solver';
import { toThree, yawToThree } from './coords';
import { textureFor } from './panelTexture';

const RULE_COLORS = { intended: '#4ec9b0', fallback: '#dcb862', fallbackDefault: '#f14c4c' } as const;

export function ruleColor(rule: SolveResult['rule']): string {
  return rule === 0 ? RULE_COLORS.intended : rule === 'default' ? RULE_COLORS.fallbackDefault : RULE_COLORS.fallback;
}

/** 解いた結果を world の姿勢に (head / hand は試す空間のユーザーから)。 */
export function worldPoseOf(r: SolveResult, world: SolveWorld): { at: Vec3; yaw: number } {
  if (r.frame === 'world') return r.pose;
  return offsetToWorld({ frame: r.frame, at: r.pose.at, yaw: r.pose.yaw }, world) ?? r.pose;
}

interface Props {
  things: Thing[];
  results: SolveResult[];
  world: SolveWorld;
  selected: string | null;
  onPick: (id: string) => void;
}

export const ThingMeshes = memo(function ThingMeshes({ things, results, world, selected, onPick }: Props) {
  const byId = useMemo(() => new Map(results.map((r) => [r.thing, r])), [results]);
  return (
    <group>
      {things.map((t) => {
        const r = byId.get(t.id);
        if (!r) return null;
        const pose = worldPoseOf(r, world);
        return (
          <group key={t.id} position={toThree(pose.at)} rotation={[0, yawToThree(pose.yaw), 0]}
            onClick={(ev) => { ev.stopPropagation(); onPick(t.id); }}>
            <ThingBody thing={t} />
            <SelectionBox thing={t} selected={t.id === selected} rule={r.rule} />
            {(t.id === selected || r.frame !== 'world') && (
              <Html position={[0, thingSize(t.visual)[1] / 2 + 0.06, 0]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
                <div className="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap font-medium"
                  style={{ background: ruleColor(r.rule), color: '#10221e' }}>
                  {t.name || t.id}{r.frame !== 'world' ? ` · ${r.frame}` : ''}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
});

function SelectionBox({ thing, selected, rule }: { thing: Thing; selected: boolean; rule: SolveResult['rule'] }) {
  const size = thingSize(thing.visual);
  const geometry = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0] + 0.02, size[1] + 0.02, Math.max(size[2], 0.01) + 0.02)),
    [size[0], size[1], size[2]]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={selected ? '#ffffff' : ruleColor(rule)} transparent opacity={selected ? 1 : 0.55} />
    </lineSegments>
  );
}

/** 物の前はローカル -Z (coords.ts)。板は表を -Z に向ける。 */
function ThingBody({ thing }: { thing: Thing }) {
  const v = thing.visual;
  switch (v.kind) {
    case 'panel':
    case 'label':
      return <Board thing={thing} />;
    case 'shape': {
      const color = v.color || '#4ec9b0';
      const opacity = v.opacity ?? 1;
      const [w, h, d] = v.size;
      return (
        <mesh rotation={v.shape === 'quad' ? [0, Math.PI, 0] : [0, 0, 0]}>
          {v.shape === 'cube' && <boxGeometry args={[w, h, d]} />}
          {v.shape === 'sphere' && <sphereGeometry args={[Math.max(w, h, d) / 2, 24, 16]} />}
          {v.shape === 'cylinder' && <cylinderGeometry args={[Math.max(w, d) / 2, Math.max(w, d) / 2, h, 24]} />}
          {v.shape === 'capsule' && <capsuleGeometry args={[Math.max(w, d) / 2, Math.max(0.001, h - Math.max(w, d)), 8, 16]} />}
          {v.shape === 'quad' && <planeGeometry args={[w, h]} />}
          <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} side={v.shape === 'quad' ? THREE.DoubleSide : THREE.FrontSide} />
        </mesh>
      );
    }
    case 'character': {
      const h = v.height ?? 1.5;
      const r = h * 0.11;
      return (
        <group>
          <mesh position={[0, 0, 0]}>
            <capsuleGeometry args={[r, Math.max(0.01, h - r * 2), 6, 16]} />
            <meshStandardMaterial color="#c9a0dc" transparent opacity={0.85} />
          </mesh>
          {/* 顔の向き */}
          <mesh position={[0, h / 2 - r * 1.2, -r * 1.05]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[r * 0.35, r * 0.8, 12]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
        </group>
      );
    }
    case 'model': {
      const h = v.height ?? 0.3;
      return (
        <mesh>
          <boxGeometry args={[h, h, h]} />
          <meshStandardMaterial color="#9cdcfe" transparent opacity={0.4} wireframe />
        </mesh>
      );
    }
    case 'marker':
      return (
        <group>
          <mesh>
            <octahedronGeometry args={[0.04]} />
            <meshStandardMaterial color="#ce9178" />
          </mesh>
          <mesh position={[0, 0, -0.06]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.015, 0.05, 8]} />
            <meshStandardMaterial color="#ce9178" />
          </mesh>
        </group>
      );
  }
}

function Board({ thing }: { thing: Thing }) {
  const v = thing.visual;
  const texture = useMemo(() => textureFor(v), [JSON.stringify(v)]);
  useEffect(() => () => texture?.dispose(), [texture]);
  const size = thingSize(v);
  const h = v.kind === 'label' ? (v.height ?? 0.04) * 1.6 : size[1];
  const w = v.kind === 'label' ? size[0] + (v.height ?? 0.04) : size[0];
  return (
    <group>
      <mesh rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={texture ?? undefined} transparent side={THREE.FrontSide} toneMapped={false} />
      </mesh>
      {/* 裏 */}
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color="#3a3d44" transparent opacity={0.6} />
      </mesh>
    </group>
  );
}
