/**
 * Layster.Spatial のプレビュー: 試す空間の部屋を「現実の代わり」にして、ユーザーの目から (または斜め上から) 描く。
 *
 * 置き場所は solver.ts (実機と同じ計算)、物の見た目は Space Lab の部品 (ThingMeshes / EntityBoxes / BodyWorkspaces) を
 * そのまま使う。時間の模型は spatialTimeline.ts (おおよそ)。IR は読むだけ。
 */
import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { PanelItem, SpaceFixture, Thing, ThingVisual } from '../../shared/layster/spatial/types';
import { findBuiltinSpace } from '../../shared/layster/spatial/spaces';
import { findEntities, solveAll, thingSize, worldFromSpace, type SolveResult, type SolveWorld } from '../../shared/layster/spatial/solver';
import { EntityBoxes, entityName } from '../spatial/lab/EntityBoxes';
import { ThingMeshes, ruleColor, worldPoseOf } from '../spatial/lab/ThingMeshes';
import { BodyWorkspaces } from '../spatial/lab/BodyWorkspaces';
import { UserRig } from '../spatial/lab/UserRig';
import { toThree, yawToThree } from '../spatial/lab/coords';
import { extractDeviceFov, type DeviceFov } from '../utils/deviceFov';
import { simulateAt, type SimHighlight, type SimState } from './spatialTimeline';
import { ReadyGate } from './ready';
import { SimFrame, deviceAspect, fitBox, fovText } from './frame';
import type { SimFrameInfo, SimPlacement, SpatialJob } from './protocol';

const NOOP = () => {};

/** 解いて、時刻 t の状態を流す (描く前に main へ返す情報もここで作る)。 */
export function prepareSpatial(job: SpatialJob, space: SpaceFixture) {
  const world = worldFromSpace(space);
  const results = solveAll(job.project.things, world);
  const sim = simulateAt(job.project, results, world, job.t);
  const fov = extractDeviceFov(job.adapter);
  const warnings: string[] = [];
  if (!fov) warnings.push(`device "${job.deviceName}" has no display.fieldOfView; using 50° vertical, 16:9`);
  if (sim.skipped.length) warnings.push(`not simulated: ${sim.skipped.join(', ')}`);
  const placements: SimPlacement[] = results.map((r) => {
    const thing = job.project.things.find((x) => x.id === r.thing);
    const pose = worldPoseOf(r, world);
    return {
      thing: r.thing, name: thing?.name, mode: r.mode, frame: r.frame, rule: r.rule,
      at: pose.at, yaw: pose.yaw, host: r.host, notes: r.notes, visible: sim.visible.has(r.thing),
    };
  });
  const info: SimFrameInfo = {
    fov,
    placements,
    timeline: { log: sim.log, skipped: sim.skipped, store: sim.store },
    warnings,
  };
  return { world, results, sim, fov, info };
}

/** 規則が入れた store の値を、パネルの bind された文字に入れる。値が無ければ元のまま ({key} と出る)。 */
function bindVisual(v: ThingVisual, store: Record<string, unknown>): ThingVisual {
  if (v.kind !== 'panel') return v;
  const bindItem = (item: PanelItem): PanelItem => {
    if (item.type === 'row') return { ...item, items: item.items.map(bindItem) };
    if (item.type === 'text' && item.bind && item.bind in store) {
      const value = store[item.bind];
      const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
      return { ...item, text: text === '' ? ' ' : text };
    }
    return item;
  };
  return { ...v, items: v.items.map(bindItem) };
}

function bindsKey(things: Thing[], key: string): boolean {
  const walk = (items: PanelItem[]): boolean => items.some((i) => (i.type === 'row' ? walk(i.items) : 'bind' in i && i.bind === key));
  return things.some((t) => t.visual.kind === 'panel' && walk(t.visual.items));
}

function CameraRig({ view, eye, fov }: { view: SpatialJob['view']; eye: number; fov: DeviceFov | null }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (view === 'overview') {
      cam.position.set(2.2, 3.2, 2.6);
      cam.fov = 55;
      cam.up.set(0, 1, 0);
      cam.lookAt(0, 0.7, -1.2);
    } else {
      // 頭は world の原点の上、+Z (IR) を向く → three では -Z
      cam.position.set(...toThree([0, eye, 0]));
      cam.fov = fov?.vertical ?? 50;
      cam.up.set(0, 1, 0);
      cam.lookAt(...toThree([0, eye, 1]));
    }
    cam.near = 0.02;
    cam.far = 100;
    cam.aspect = size.width / Math.max(1, size.height);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height, view, eye, fov]);
  return null;
}

/** highlight の行動: 囲む線の箱と札。 */
function Highlights({ highlights, things, results, world }: {
  highlights: SimHighlight[]; things: Thing[]; results: SolveResult[]; world: SolveWorld;
}) {
  const boxes = useMemo(() => highlights.flatMap((h) => {
    const color = h.color || '#ffd54a';
    const tg = h.target;
    if ('thing' in tg) {
      const r = results.find((x) => x.thing === tg.thing);
      const t = things.find((x) => x.id === tg.thing);
      if (!r || !t) return [];
      const p = worldPoseOf(r, world);
      return [{ at: p.at, yaw: p.yaw, size: thingSize(t.visual), color, label: h.label }];
    }
    if ('entity' in tg) {
      const e = findEntities(tg.entity, world)[0];
      return e ? [{ at: e.at, yaw: e.yaw ?? 0, size: e.size, color, label: h.label }] : [];
    }
    return [];
  }), [highlights, things, results, world]);
  return (
    <group>
      {boxes.map((b, i) => (
        <group key={i} position={toThree(b.at)} rotation={[0, yawToThree(b.yaw), 0]}>
          <lineSegments>
            <edgesGeometry args={[new THREE.BoxGeometry(b.size[0] + 0.04, b.size[1] + 0.04, Math.max(b.size[2], 0.01) + 0.04)]} />
            <lineBasicMaterial color={b.color} />
          </lineSegments>
          {b.label && (
            <Html position={[0, b.size[1] / 2 + 0.08, 0]} center wrapperClass="sim-keep" style={{ pointerEvents: 'none' }}>
              <div style={{ background: b.color, color: '#1a1400', font: '600 12px system-ui, sans-serif', padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                {b.label}
              </div>
            </Html>
          )}
        </group>
      ))}
    </group>
  );
}

function ruleText(rule: SolveResult['rule']): string {
  return rule === 0 ? 'intended' : rule === 'default' ? 'default spot (nothing fit)' : `fallback ${rule}`;
}

/** --overlays: 置き方の一覧 (色 = どの置き方で置けたか) と理由。 */
function PlacementOverlay({ things, results, world, sim, lang }: {
  things: Thing[]; results: SolveResult[]; world: SolveWorld; sim: SimState; lang: 'en' | 'ja';
}) {
  return (
    <div style={{
      position: 'absolute', top: 8, right: 8, maxWidth: '42%', padding: '6px 9px', borderRadius: 6,
      background: 'rgba(12,14,18,0.82)', color: '#e8e8e8', font: '11px/1.45 system-ui, sans-serif',
    }}>
      {results.map((r) => {
        const t = things.find((x) => x.id === r.thing);
        const host = r.host ? world.entities.find((e) => e.id === r.host) : undefined;
        return (
          <div key={r.thing} style={{ marginBottom: 3, opacity: sim.visible.has(r.thing) ? 1 : 0.5 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: ruleColor(r.rule), marginRight: 5 }} />
            <b>{t?.name || r.thing}</b> — {ruleText(r.rule)}
            {host ? ` · on ${entityName(host, lang)}` : ''}{r.frame !== 'world' ? ` · ${r.frame}` : ''}
            {!sim.visible.has(r.thing) ? ' · hidden' : ''}
            {r.notes.length > 0 && <div style={{ color: '#a9b0b8', fontSize: 10, marginLeft: 13 }}>{r.notes.slice(0, 2).join(' / ')}</div>}
          </div>
        );
      })}
      {sim.skipped.length > 0 && (
        <div style={{ color: '#a9b0b8', fontSize: 10, marginTop: 4 }}>not simulated: {sim.skipped.join(', ')}</div>
      )}
    </div>
  );
}

export function SpatialSim({ job, onReady }: { job: SpatialJob; onReady: (info: SimFrameInfo) => void }) {
  const space = job.projectSpaces.find((s) => s.id === job.spaceId) ?? findBuiltinSpace(job.spaceId);
  useEffect(() => {
    if (!space) onReady({ fov: null, warnings: [], error: `space "${job.spaceId}" is neither built in nor in the project's spaces/` });
  }, [space]);
  if (!space) return null;
  return <SpatialSimView job={job} space={space} onReady={onReady} />;
}

function SpatialSimView({ job, space, onReady }: { job: SpatialJob; space: SpaceFixture; onReady: (info: SimFrameInfo) => void }) {
  const prepared = useMemo(() => prepareSpatial(job, space), [job, space]);
  const { world, results, sim, fov, info } = prepared;
  const firstPerson = job.view === 'first-person';
  const box = firstPerson ? fitBox(job.width, job.height, deviceAspect(fov)) : null;

  const shown = useMemo(
    () => job.project.things.filter((t) => sim.visible.has(t.id)).map((t) => ({ ...t, visual: bindVisual(t.visual, sim.store) })),
    [job.project.things, sim],
  );
  const sayText = typeof sim.store['say.text'] === 'string' ? (sim.store['say.text'] as string) : '';
  // say.text を出すパネルが無ければ、実機は視界の下に字幕を 1 行出す (doc/20 §7)
  const subtitle = sayText && !bindsKey(shown, 'say.text') ? sayText : '';
  const caption = `preview (approximate) — space: ${space.id} · t=${job.t}s · ${job.deviceName} ${fovText(fov)}${firstPerson ? '' : ' · overview'}`;

  return (
    <SimFrame
      width={job.width}
      height={job.height}
      box={box}
      caption={caption}
      outside={job.overlays ? <PlacementOverlay things={job.project.things} results={results} world={world} sim={sim} lang={job.lang} /> : null}
    >
      <div className={job.overlays ? '' : 'sim-hide-html'} style={{ position: 'absolute', inset: 0 }}>
        <Canvas
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          camera={{ fov: fov?.vertical ?? 50, near: 0.02, far: 100 }}
          style={{ background: '#1c1f24' }}
        >
          <CameraRig view={job.view} eye={space.user.eyeHeight} fov={fov} />
          <ambientLight intensity={0.75} />
          <directionalLight position={[3, 6, 2]} intensity={0.8} />
          <Grid
            args={[20, 20]} cellSize={0.25} sectionSize={1} position={[0, -0.001, 0]}
            cellColor="#2e3238" sectionColor="#3d434b" fadeDistance={14} infiniteGrid
          />
          <EntityBoxes entities={world.entities} selected={null} onPick={NOOP} />
          {!firstPerson && <UserRig world={world} />}
          <ThingMeshes things={shown} results={results} world={world} selected={null} onPick={NOOP} />
          <BodyWorkspaces bodies={job.project.bodies} results={results} world={world} selected={null} />
          <Highlights highlights={sim.highlights} things={job.project.things} results={results} world={world} />
          <ReadyGate onReady={() => onReady(info)} />
        </Canvas>
        {subtitle && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: '9%', display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ maxWidth: '80%', padding: '4px 12px', borderRadius: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', font: '500 18px system-ui, sans-serif' }}>
              {subtitle}
            </div>
          </div>
        )}
      </div>
    </SimFrame>
  );
}
