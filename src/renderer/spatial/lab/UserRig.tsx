/**
 * 試す空間のユーザー: 足元・頭 (目の高さ)・視界 (水平 ±35°、置き方の visible と同じ)・手。
 * 線は StableLine (drei の Line は描き直しのたびにマテリアルを捨てる。CLAUDE.md の Gotchas)。
 */
import { memo } from 'react';
import type { SolveWorld } from '../../../shared/layster/spatial/solver';
import { DEFAULT_VIEW_HALF_ANGLE } from '../../../shared/layster/spatial/solver';
import { StableLine } from '../../components/viewport/StableLine';
import { toThree } from './coords';

const USER_COLOR = '#569cd6';

export const UserRig = memo(function UserRig({ world }: { world: SolveWorld }) {
  const { at, yaw, eyeHeight } = world.user;
  const head: [number, number, number] = [at[0], at[1] + eyeHeight, at[2]];
  const reach = 1.6;
  const ray = (deg: number): [number, number, number] => {
    const a = ((yaw + deg) * Math.PI) / 180;
    return toThree([head[0] + Math.sin(a) * reach, head[1], head[2] + Math.cos(a) * reach]);
  };
  const h3 = toThree(head);
  const arc: Array<[number, number, number]> = [];
  for (let d = -DEFAULT_VIEW_HALF_ANGLE; d <= DEFAULT_VIEW_HALF_ANGLE; d += 5) arc.push(ray(d));
  return (
    <group>
      <mesh position={toThree([at[0], 0.002, at[2]])} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.18, 0.22, 32]} />
        <meshBasicMaterial color={USER_COLOR} transparent opacity={0.8} />
      </mesh>
      <StableLine points={[toThree([at[0], 0, at[2]]), h3]} color={USER_COLOR} lineWidth={1.5} transparent opacity={0.6} />
      <mesh position={h3}>
        <sphereGeometry args={[0.09, 20, 14]} />
        <meshStandardMaterial color={USER_COLOR} />
      </mesh>
      <StableLine points={[h3, ray(-DEFAULT_VIEW_HALF_ANGLE)]} color={USER_COLOR} lineWidth={1} transparent opacity={0.5} />
      <StableLine points={[h3, ray(DEFAULT_VIEW_HALF_ANGLE)]} color={USER_COLOR} lineWidth={1} transparent opacity={0.5} />
      <StableLine points={arc} color={USER_COLOR} lineWidth={1} transparent opacity={0.5} />
      {[world.hands?.left, world.hands?.right].map((h, i) => h && (
        <mesh key={i} position={toThree(h)}>
          <sphereGeometry args={[0.035, 12, 10]} />
          <meshStandardMaterial color="#9cdcfe" />
        </mesh>
      ))}
    </group>
  );
});
