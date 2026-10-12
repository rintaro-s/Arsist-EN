/**
 * 太さのある線 (three の Line2)。drei の <Line> の代わり。
 *
 * drei の <Line> は points の配列が「別の配列」になるたびに形を作り直し、そのときマテリアルまで dispose する。
 * JSX に points={[[0,0,0],[2,0,0]]} と書くと描き直しのたびに別の配列になるので、3D ビューが描き直される
 * (プロジェクトの読み直し・選択・ギズモの操作) たびに全部の線のマテリアルが捨てられ、シェーダーの作り直しで
 * 画面が 2 秒ほど止まっていた (getProgramInfoLog で同期的に待つため)。
 *
 * ここでは:
 *   - マテリアルは線が消えるまで 1 つを使い続ける (色や太さは値を変えるだけ)
 *   - points は中身で比べ、中身が変わったときだけ形を作り直す (古い形は捨てる)
 */
import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

type Point = readonly [number, number, number] | THREE.Vector3;

interface StableLineProps {
  points: readonly Point[];
  color?: THREE.ColorRepresentation;
  lineWidth?: number;
  transparent?: boolean;
  opacity?: number;
}

const flat = (points: readonly Point[]) =>
  points.flatMap((p) => (p instanceof THREE.Vector3 ? [p.x, p.y, p.z] : [p[0], p[1], p[2]]));

export function StableLine({ points, color = '#ffffff', lineWidth = 1, transparent = false, opacity = 1 }: StableLineProps) {
  const size = useThree((s: { size: { width: number; height: number } }) => s.size);
  const positions = flat(points);
  const key = positions.join(',');

  const [line] = useState(() => new Line2());
  const [material] = useState(() => new LineMaterial());
  const geometry = useMemo(() => {
    const g = new LineGeometry();
    g.setPositions(positions);
    return g;
    // key は positions の中身
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    line.geometry = geometry;
    line.computeLineDistances();
    return () => geometry.dispose();
  }, [line, geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    material.color.set(color);
    material.linewidth = lineWidth;
    material.transparent = transparent;
    material.opacity = opacity;
    material.resolution.set(size.width, size.height);
  }, [material, color, lineWidth, transparent, opacity, size.width, size.height]);

  line.material = material;
  if (line.geometry !== geometry) line.geometry = geometry;
  return <primitive object={line} />;
}
