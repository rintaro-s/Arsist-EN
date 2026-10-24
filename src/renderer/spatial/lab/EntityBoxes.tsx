/**
 * 試す空間の entity (床・壁・家具・見つけた物・Mind の推測) を、半透明の箱で描く。
 * 色は何ができるか (affordance) で決める。札は DOM (日本語が出る) で、選んだときと家具だけに出す。
 */
import { memo, useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Entity } from '../../../shared/layster/spatial/types';
import { affordancesOf, isVertical, lookupWord } from '../../../shared/layster/spatial/vocabulary';
import { useI18n } from '../../i18n';
import { toThree, yawToThree } from './coords';

export function entityColor(e: Entity): string {
  if (e.source.startsWith('mind:') || e.source === 'script') return '#e06cbf';
  const w = e.is[0] ? lookupWord(e.is[0]) : undefined;
  if (w?.word === 'floor') return e.source === 'assumed' ? '#7a6a5a' : '#5d6670';
  if (w?.word === 'ceiling') return '#5d6670';
  if (w?.structural || isVertical(e)) return '#8191a3';
  const has = affordancesOf(e);
  if (has.includes('screen')) return '#4fb3d9';
  if (has.includes('sit')) return '#a487d6';
  if (has.includes('grasp')) return '#7fc97f';
  if (has.includes('support')) return '#d6a35c';
  return '#9aa0a6';
}

export function entityName(e: Entity, lang: 'en' | 'ja'): string {
  const w = e.is[0] ? lookupWord(e.is[0]) : undefined;
  return w ? w.label[lang] : (e.is[0] ?? e.id);
}

interface Props {
  entities: Entity[];
  selected: string | null;
  onPick: (id: string) => void;
}

export const EntityBoxes = memo(function EntityBoxes({ entities, selected, onPick }: Props) {
  const { lang } = useI18n();
  return (
    <group>
      {entities.map((e) => (
        <EntityBox key={e.id} entity={e} selected={e.id === selected} label={entityName(e, lang)} onPick={onPick} />
      ))}
    </group>
  );
});

function EntityBox({ entity, selected, label, onPick }: { entity: Entity; selected: boolean; label: string; onPick: (id: string) => void }) {
  const color = entityColor(entity);
  const w = lookupWord(entity.is[0] ?? '');
  const structural = !!w?.structural;
  const ceiling = w?.word === 'ceiling';
  // 厚み 0 の面は、薄い箱にして見えるようにする
  const size: [number, number, number] = [Math.max(entity.size[0], 0.005), Math.max(entity.size[1], 0.005), Math.max(entity.size[2], 0.005)];
  const geometry = useMemo(() => new THREE.BoxGeometry(...size), [size[0], size[1], size[2]]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);
  const lowConfidence = entity.confidence < 0.5;
  if (ceiling) return null;
  const opacity = structural ? (w?.word === 'floor' ? 0.25 : 0.07) : lowConfidence ? 0.15 : 0.35;
  const showLabel = selected || !structural;

  return (
    <group position={toThree(entity.at)} rotation={[0, yawToThree(entity.yaw ?? 0), 0]}>
      <mesh
        geometry={geometry}
        onClick={(ev) => { ev.stopPropagation(); onPick(entity.id); }}
        renderOrder={structural ? 0 : 1}
      >
        <meshStandardMaterial color={color} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={selected ? '#4ec9b0' : color} transparent opacity={selected ? 1 : structural ? 0.35 : 0.8} />
      </lineSegments>
      {showLabel && (
        <Html position={[0, size[1] / 2 + 0.04, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div
            className="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap"
            style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', opacity: lowConfidence ? 0.7 : 1 }}
          >
            {label}{lowConfidence ? ` ${Math.round(entity.confidence * 100)}%` : ''}
          </div>
        </Html>
      )}
    </group>
  );
}
