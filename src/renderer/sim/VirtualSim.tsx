/**
 * Layster.Virtual のプレビュー: 起動したときの視点 (IR の原点、+Z を向く) から、デバイスの視野角で描く。
 *
 * 3D はライブ配置モードの FirstPersonView / PlacedObjectMesh、UI はプレビューの SimpleUIRenderer を画像にして使う (rasterizeUi.ts)。
 * 空間の Canvas は IR の大きさ (widthMeters × heightMeters) の板に、常時表示 (uhd) は頭に固定した板
 * (ビルドの GenerateCanvasUI と同じ: 1.92 × 1.08 m、頭から floatingScreen.distance × 0.5 (最小 0.3 m、既定 1 m)) に描く。
 *
 * 座標: IR をそのまま three に置く (エディタの 3D ビューと同じ。IR の X+ = ユーザーの左が、画面の左に出る)。
 *
 * カメラ・画像に映すもの・自分の体 (β1.1.0、doc/23) はおおよそ:
 *   - カメラの物は形と撮る範囲 (showGizmo のとき)。画像の source が camera なら、読み込みが済んでから
 *     そのカメラで 1 枚撮って (shootCamera) 画像に貼る。stream は「配信: <url>」の板
 *   - 自分の体の VRM (embody) は頭 (原点) の下に立たせ、hideFromSelf なら自分の目 (この画) からは隠す。カメラの画には写る
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { FirstPersonView } from '../live/FirstPersonView';
import type { PlacedObject, ViewerPose } from '../live/useLiveScene';
import { runtimeIdOf } from '../live/useLiveScene';
import { rasterizeLayout } from './rasterizeUi';
import { DataStoreProvider } from '../stores/dataStoreContext';
import { loadVrm } from '../components/viewport/vrmCache';
import { repairScene, repairUILayout } from '../../shared/irRepair';
import type { BackgroundMode, SceneObject, UILayoutData } from '../../shared/types';
import { extractDeviceFov } from '../utils/deviceFov';
import { ReadyGate, beginLoad, pendingLoads } from './ready';
import { CameraGizmo } from '../components/camera/CameraGizmo';
import { shootCamera } from '../components/camera/cameraView';
import type { MediaView } from '../components/camera/MediaPlaceholder';
import { cameraSettingsOf, embodySettingsOf, findCameraObject, isEmbodied } from '../../shared/media';
import { SimFrame, fovText } from './frame';
import type { SimFrameInfo, VirtualJob } from './protocol';

const VIEWER: ViewerPose = {
  position: { x: 0, y: 0, z: 0 },
  forward: { x: 0, y: 0, z: 1 },
  up: { x: 0, y: 1, z: 0 },
  source: 'simulated',
  tracking: false,
};

function placedFromIr(obj: SceneObject): PlacedObject {
  return {
    runtimeId: runtimeIdOf(obj),
    irId: obj.id,
    name: obj.name,
    position: obj.transform.position,
    rotation: obj.transform.rotation,
    scale: obj.transform.scale,
    type: obj.type,
    primitiveType: obj.primitiveType,
    color: obj.material?.color,
    canvasSize: obj.canvasSettings ? { width: obj.canvasSettings.widthMeters, height: obj.canvasSettings.heightMeters } : undefined,
    source: 'project',
  };
}

function flatten(objects: SceneObject[]): SceneObject[] {
  return objects.flatMap((o) => [o, ...flatten((o.children as SceneObject[] | undefined) ?? [])]);
}

const DEG = Math.PI / 180;
/** GenerateCanvasUI: 常時表示の Canvas はレイアウトの解像度によらず 1920×1080 px × 0.001 */
const HUD_SIZE_M: [number, number] = [1.92, 1.08];

/**
 * UI レイアウトを、幅 w × 高さ h (m) の板として描く。表はユーザー (-Z 側) を向く。
 * DOM (SimpleUIRenderer) を SVG の foreignObject で画像にして、3D の板に貼る (物に隠れる・奥行きが正しい)。
 */
function UiBoard({ layout, w, h, hud = false, media }: { layout: UILayoutData; w: number; h: number; hud?: boolean; media: MediaView | null }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    const done = beginLoad();
    let alive = true;
    let tex: THREE.Texture | null = null;
    rasterizeLayout(layout, media)
      .then((canvas) => {
        if (!alive) return;
        tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        setTexture(tex);
      })
      .catch(() => { /* 描けなければ板だけ (PlacedObjectMesh の色) */ })
      .finally(done);
    return () => { alive = false; tex?.dispose(); };
  }, [layout, media]);
  if (!texture) return null;
  return (
    <mesh rotation={[0, Math.PI, 0]} position={[0, 0, -0.002]} renderOrder={hud ? 1000 : 1}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthTest={!hud} depthWrite={!hud} />
    </mesh>
  );
}

function CanvasBoard({ obj, layout, media }: { obj: SceneObject; layout: UILayoutData; media: MediaView | null }) {
  const t = obj.transform;
  const cs = obj.canvasSettings!;
  return (
    <group position={[t.position.x, t.position.y, t.position.z]} rotation={[t.rotation.x * DEG, t.rotation.y * DEG, t.rotation.z * DEG]}>
      <UiBoard layout={layout} w={cs.widthMeters * t.scale.x} h={cs.heightMeters * t.scale.y} media={media} />
    </group>
  );
}

/** カメラの物: 形と撮る範囲 (showGizmo のとき。実機もヘッドセットの中に出す) */
function SimCamera({ obj }: { obj: SceneObject }) {
  const t = obj.transform;
  if (!cameraSettingsOf(obj.camera).showGizmo) return null;
  return (
    <group position={[t.position.x, t.position.y, t.position.z]} rotation={[t.rotation.x * DEG, t.rotation.y * DEG, t.rotation.z * DEG]}>
      <CameraGizmo settings={obj.camera} />
    </group>
  );
}

/**
 * 画像の source が camera のカメラで 1 枚ずつ撮る。ほかの読み込み (VRM・UI の板) が済んで数フレーム描いてから。
 * 撮れた画は onShots で UI の板に渡り、板が描き直される (ReadyGate はそれも待つ)。
 */
function CameraShots({ cameras, onShots }: { cameras: SceneObject[]; onShots: (shots: Record<string, string>) => void }) {
  const done = useRef<(() => void) | null>(null);
  const frames = useRef(0);
  const fired = useRef(false);
  useEffect(() => {
    done.current = beginLoad();
    return () => done.current?.();
  }, []);
  useFrame(({ gl, scene }: { gl: THREE.WebGLRenderer; scene: THREE.Scene }) => {
    if (fired.current) return;
    if (pendingLoads() > 1) { frames.current = 0; return; } // 1 = この CameraShots 自身
    if (++frames.current < 3) return;
    fired.current = true;
    const shots: Record<string, string> = {};
    for (const cam of cameras) {
      try { shots[cam.id] = shootCamera(gl, scene, cam); } catch { /* 撮れなければ名前だけの板 */ }
    }
    onShots(shots);
    // 板の描き直し (beginLoad) が始まってから手放す
    setTimeout(() => done.current?.(), 100);
  });
  return null;
}

/** VRM の本物。腕を下ろし (実機も T ポーズは見せない)、lookAtUser ならユーザーの方を向く。 */
function VrmFigure({ obj, url, onFail }: { obj: SceneObject; url: string; onFail: (msg: string) => void }) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  useEffect(() => {
    const done = beginLoad();
    let alive = true;
    const timer = setTimeout(() => { onFail(`VRM ${obj.name}: timed out loading; drawn as a placeholder`); done(); }, 20000);
    loadVrm(obj.id, url)
      .then((v) => {
        if (!alive) return;
        const h = v.humanoid;
        h?.getNormalizedBoneNode('leftUpperArm')?.rotation.set(0, 0, -1.2);
        h?.getNormalizedBoneNode('rightUpperArm')?.rotation.set(0, 0, 1.2);
        v.update(0);
        setVrm(v);
      })
      .catch((e) => onFail(`VRM ${obj.name}: ${e instanceof Error ? e.message : String(e)}; drawn as a placeholder`))
      .finally(() => { clearTimeout(timer); done(); });
    return () => { alive = false; clearTimeout(timer); };
  }, [obj.id, url]);
  useFrame(() => vrm?.update(0));
  if (!vrm) return null;
  if (isEmbodied(obj)) {
    // 自分の体: 頭 (原点) の下に、前 (+Z) を向いて立つ (実機は頭と手で動く。ここは立ち姿のおおよそ)。
    // 首の分だけ後ろ、目の高さ ≈ 1.5 m。hideFromSelf なら自分の目からは隠す (カメラの画には写す: hideForCameraView)
    const e = embodySettingsOf(obj.character?.embody);
    const s = e.matchHeight ? 1 : obj.transform.scale.y;
    return (
      <group position={[0, -1.5 * s, -0.08]} scale={[s, s, s]} visible={!e.hideFromSelf} userData={{ arsistEmbodied: true }}>
        <primitive object={vrm.scene} />
      </group>
    );
  }
  const p = obj.transform.position;
  const faceUser = obj.character?.lookAtUser && obj.character.lookAtUser !== 'off';
  // 読み込んだ VRM (rotateVRM0 済み) は +Z を向く。ユーザー (原点) の方へ向けるなら atan2(-x, -z)
  const yaw = faceUser ? Math.atan2(-p.x, -p.z) : obj.transform.rotation.y * DEG;
  return (
    <group position={[p.x, p.y, p.z]} rotation={[0, yaw, 0]} scale={[obj.transform.scale.x, obj.transform.scale.y, obj.transform.scale.z]}>
      <primitive object={vrm.scene} />
    </group>
  );
}

export function prepareVirtual(job: VirtualJob) {
  const notes: string[] = [];
  const p = job.project as Record<string, any>;
  const scenes = Array.isArray(p.scenes) ? p.scenes.map((s: unknown, i: number) => repairScene(s, `scenes[${i}]`, notes)) : [];
  const scene = scenes.find((s: { id?: string }) => s.id === job.sceneId) ?? scenes[0];
  const layouts: UILayoutData[] = Array.isArray(p.uiLayouts) ? p.uiLayouts.map((l: unknown, i: number) => repairUILayout(l, `uiLayouts[${i}]`, notes)) : [];
  const fov = extractDeviceFov(job.adapter);
  const warnings = notes.length ? [`IR repaired for display: ${notes.slice(0, 5).join('; ')}${notes.length > 5 ? ' …' : ''}`] : [];
  if (!fov) warnings.push(`device "${job.deviceName}" has no display.fieldOfView; using 50° vertical, 16:9`);
  if (!scene) warnings.push('project has no scenes');
  else if (scene.objects.length === 0 && !layouts.some((l) => l.scope === 'uhd')) {
    warnings.push(`scene "${scene.name ?? scene.id}" has no objects and the project has no uhd layout: nothing to draw (the device shows its "HUD initialized" plate)`);
  }
  return { scene, layouts, fov, warnings, ar: (p.arSettings ?? {}) as Record<string, any> };
}

export function VirtualSim({ job, onReady }: { job: VirtualJob; onReady: (info: SimFrameInfo) => void }) {
  const prepared = useMemo(() => prepareVirtual(job), [job]);
  const { scene, layouts, fov, ar } = prepared;
  const [failures, setFailures] = useState<string[]>([]);
  const objects = useMemo(() => flatten(scene?.objects ?? []), [scene]);
  const layoutById = useMemo(() => new Map(layouts.map((l) => [l.id, l])), [layouts]);
  const hud = layouts.filter((l) => l.scope === 'uhd');
  const vrms = objects.filter((o) => o.type === 'vrm' && o.modelPath);
  const failedNames = new Set(failures.map((f) => f.split(':')[0].replace(/^VRM /, '')));
  const cameras = useMemo(() => objects.filter((o) => o.type === 'camera'), [objects]);
  // 画像が映しているカメラ (source.kind === 'camera')。そのカメラだけ撮る
  const shownCameras = useMemo(() => {
    const ids = new Set<string>();
    const visit = (el: UILayoutData['root'] | undefined) => {
      if (!el) return;
      if (el.type === 'Image' && el.source?.kind === 'camera') {
        const cam = findCameraObject({ scenes: scene ? [{ ...scene, objects }] : [] }, el.source.camera);
        if (cam) ids.add(cam.id);
      }
      (el.children ?? []).forEach(visit);
    };
    layouts.forEach((l) => visit(l.root));
    return cameras.filter((c) => ids.has(c.id));
  }, [layouts, cameras, objects, scene]);
  const [shots, setShots] = useState<Record<string, string>>({});
  const media = useMemo<MediaView>(() => {
    const lookup = (ref: string) => findCameraObject({ scenes: scene ? [{ ...scene, objects }] : [] }, ref);
    return { cameraName: (ref) => lookup(ref)?.name, shot: (ref) => { const c = lookup(ref); return c ? shots[c.id] : undefined; } };
  }, [shots, scene, objects]);

  // VRM の本物を描くものは、代理のカプセルを出さない (読めなかったものはカプセルのまま)
  const placed = useMemo(
    () => objects
      .filter((o) => !(o.type === 'vrm' && o.modelPath && !failedNames.has(o.name)))
      // カメラは SimCamera が形を描く
      .filter((o) => o.type !== 'camera')
      // UI の付いた Canvas は UiBoard が描く (板の色を重ねない。実機の Canvas に背景は無い)
      .filter((o) => !(o.type === 'canvas' && o.canvasSettings?.layoutId && layoutById.has(o.canvasSettings.layoutId)))
      .map(placedFromIr),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objects, failures, layoutById],
  );

  const backgroundMode: BackgroundMode = (ar.backgroundMode as BackgroundMode) ?? 'passthrough';
  const hudDistance = Math.max(0.3, (Number(ar.floatingScreen?.distance) || 2) * 0.5);
  const caption = `preview (approximate) — scene: ${scene?.name ?? scene?.id ?? '-'} · t=${job.t}s · ${job.deviceName} ${fovText(fov)}`;

  return (
    <SimFrame width={job.width} height={job.height} box={null} caption={caption}>
      <DataStoreProvider initialData={{}}>
        <div className={job.overlays ? '' : 'sim-hide-html'} style={{ position: 'absolute', inset: 0 }}>
          <FirstPersonView
            className="w-full h-full"
            objects={placed}
            viewer={VIEWER}
            fov={fov}
            backgroundMode={backgroundMode}
            backgroundColor={ar.backgroundColor}
            showLabels={job.overlays}
            showCrosshair={false}
            preserveDrawingBuffer
          >
            {objects.filter((o) => o.type === 'canvas' && o.canvasSettings?.layoutId && layoutById.has(o.canvasSettings.layoutId)).map((o) => (
              <CanvasBoard key={o.id} obj={o} layout={layoutById.get(o.canvasSettings!.layoutId)!} media={media} />
            ))}
            {hud.map((l) => (
              <group key={l.id} position={[0, 0, hudDistance]} userData={{ arsistHeadLocked: true }}>
                <UiBoard layout={l} w={HUD_SIZE_M[0]} h={HUD_SIZE_M[1]} hud media={media} />
              </group>
            ))}
            {cameras.map((o) => <SimCamera key={o.id} obj={o} />)}
            {shownCameras.length > 0 && <CameraShots cameras={shownCameras} onShots={setShots} />}
            {vrms.filter((o) => !failedNames.has(o.name)).map((o) => (
              <VrmFigure key={o.id} obj={o} url={new URL(o.modelPath!.replace(/\\/g, '/'), job.projectUrl).href}
                onFail={(m) => setFailures((f) => (f.includes(m) ? f : [...f, m]))} />
            ))}
            <ReadyGate onReady={() => onReady({ fov, warnings: [...prepared.warnings, ...failures] })} frames={6} />
          </FirstPersonView>
        </div>
      </DataStoreProvider>
    </SimFrame>
  );
}
