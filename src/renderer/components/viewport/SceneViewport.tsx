import { Suspense, memo, useEffect, useRef, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { 
  OrbitControls, 
  Grid, 
  GizmoHelper, 
  GizmoViewport,
  useGLTF,
  Text,
  Billboard
} from '@react-three/drei';
import { StableLine } from './StableLine';
import * as THREE from 'three';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { SceneObject } from '../../../shared/types';
import { Eye, HelpCircle, Box, Circle, Square, Cylinder, PersonStanding, Focus, Video } from 'lucide-react';
import { CameraObject, CameraPreview } from '../camera/CameraGizmo';
import { newCameraObject, previewBox } from '../camera/cameraView';
import { VRMViewer } from './VRMViewer';
import { AnchorPlane } from './AnchorPlane';
import { SceneTransformControls } from './SceneTransformControls';
import { anchorPlacement } from '../../perception/anchorLayout';
import { estimateObjectExtents } from '../../perception/objectExtents';
import { resolvePlacement, regionToBase } from '../../../shared/placement';
import type { PerceptionTarget } from '../../../shared/types';
import { useT } from '../../i18n';
import { useDeviceFov, type DeviceFov } from '../../utils/deviceFov';
import { defaultViewpoint, useSceneView, type SceneViewpoint, type Vec3Tuple } from './sceneView';
import { resolveModelUrl } from './modelUrl';
import { pruneVrmCache, vrmKey } from './vrmCache';
import { transformOf, type SceneObjectProps } from './sceneObjectProps';

// Origin axis display
function OriginAxes() {
  return (
    <group>
      {/* X-axis (red) */}
      <StableLine points={[[0, 0, 0], [2, 0, 0]]} color="#f14c4c" lineWidth={2} />
      <StableLine points={[[1.8, 0.1, 0], [2, 0, 0], [1.8, -0.1, 0]]} color="#f14c4c" lineWidth={2} />
      {/* Y-axis (green) */}
      <StableLine points={[[0, 0, 0], [0, 2, 0]]} color="#4ec9b0" lineWidth={2} />
      <StableLine points={[[-0.1, 1.8, 0], [0, 2, 0], [0.1, 1.8, 0]]} color="#4ec9b0" lineWidth={2} />
      {/* Z-axis (blue) */}
      <StableLine points={[[0, 0, 0], [0, 0, 2]]} color="#569cd6" lineWidth={2} />
      <StableLine points={[[0, 0.1, 1.8], [0, 0, 2], [0, -0.1, 1.8]]} color="#569cd6" lineWidth={2} />
    </group>
  );
}

/** アダプターの adapter.json から読んだ視野角 (度)。 */
/**
 * ユーザーの初期視点（スポーン時の視点）マーカー。
 *
 * Arsist の座標系では 原点 = ユーザーの初期視点、Z+ = 正面 と定義されている
 * （ArsistBuildPipeline の座標系定義コメントを参照）。ビルド時に XROrigin の
 * TrackingOriginMode を Device / CameraYOffset を 0 に固定しているので、実機でも
 * セッション開始時のヘッド位置がここに来る。
 */
function SpawnViewMarker({ fov, distance }: { fov: DeviceFov | null; distance: number }) {
  const t = useT();
  const color = '#4ec9b0';

  // 視錐台: 原点を頂点に、distance[m] 先の可視矩形まで
  const frustum = useMemo(() => {
    if (!fov) return null;
    const halfW = distance * Math.tan((fov.horizontal / 2) * (Math.PI / 180));
    const halfH = distance * Math.tan((fov.vertical / 2) * (Math.PI / 180));
    const corners: [number, number, number][] = [
      [-halfW, halfH, distance],
      [halfW, halfH, distance],
      [halfW, -halfH, distance],
      [-halfW, -halfH, distance],
    ];
    return { halfW, halfH, corners };
  }, [fov, distance]);

  // 文字は Billboard でいつもこちらを向かせる (既定の視点はユーザーの後ろからなので、そのままだと裏返って見える)
  return (
    <group>
      {/* 視点そのもの */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>

      {/* 正面 (+Z) */}
      <StableLine points={[[0, 0, 0], [0, 0, 0.6]]} color={color} lineWidth={2} />
      <StableLine points={[[0, 0, 0.6], [0.06, 0, 0.5]]} color={color} lineWidth={2} />
      <StableLine points={[[0, 0, 0.6], [-0.06, 0, 0.5]]} color={color} lineWidth={2} />
      <Billboard position={[0, -0.12, 0.62]}>
        <Text fontSize={0.1} color={color} anchorX="center" anchorY="middle">
          {t('scene.spawnViewForward')}
        </Text>
      </Billboard>

      {/* 視錐台 */}
      {frustum && (
        <group>
          {frustum.corners.map((corner, i) => (
            <StableLine key={`edge-${i}`} points={[[0, 0, 0], corner]} color={color} lineWidth={1} transparent opacity={0.5} />
          ))}
          <StableLine
            points={[...frustum.corners, frustum.corners[0]]}
            color={color}
            lineWidth={1.5}
            transparent
            opacity={0.8}
          />
          <Billboard position={[0, frustum.halfH + 0.12, distance]}>
            <Text fontSize={0.12} color={color} anchorX="center" anchorY="middle">
              {t('scene.spawnViewFov', {
                h: String(fov!.horizontal),
                v: String(fov!.vertical),
                d: String(distance),
              })}
            </Text>
          </Billboard>
        </group>
      )}

      {/* 1m スケール */}
      <StableLine points={[[0, 0, 0], [1, 0, 0]]} color="#f14c4c" lineWidth={2} />
      <Billboard position={[1.05, 0.02, 0]}>
        <Text fontSize={0.15} color="#f14c4c" anchorX="left" anchorY="middle">
          1m
        </Text>
      </Billboard>

      <Billboard position={[0, 0.3, 0]}>
        <Text fontSize={0.16} color={color} anchorX="center" anchorY="middle">
          {t('scene.spawnView')}
        </Text>
      </Billboard>
      <Billboard position={[0, 0.16, 0]}>
        <Text fontSize={0.1} color="#9a9a9a" anchorX="center" anchorY="middle">
          {fov ? t('scene.spawnViewOrigin') : t('scene.spawnViewFovUnknown')}
        </Text>
      </Billboard>
    </group>
  );
}

export function SceneViewport({ active = true }: { active?: boolean }) {
  const t = useT();
  const { showGrid, showAxes, showSpawnView, transformMode, transformSpace, setTransformMode } = useUIStore();
  const {
    project, projectPath, currentSceneId, selectedObjectIds,
    addObject,
    selectedPerceptionTargetId, selectPerceptionTarget,
  } = useProjectStore();
  const requestView = useSceneView((s) => s.request);
  const [showHelp, setShowHelp] = useState(false);
  const trackingMode = project?.arSettings?.trackingMode || '6dof';
  const presentationMode = project?.arSettings?.presentationMode || 'world_anchored';
  // 視錐台は「デフォルトの奥行き」までを描く。そこがオブジェクトの既定の置き場所なので、
  // 「その距離で視野に入るか」がそのまま知りたい情報になる。
  const spawnViewDistance = project?.arSettings?.defaultDepth && project.arSettings.defaultDepth > 0
    ? project.arSettings.defaultDepth
    : 2;
  const deviceFov = useDeviceFov(project?.targetDevice);
  
  const currentScene = project?.scenes.find(s => s.id === currentSceneId);
  // 選んでいるカメラ (アンカーに貼ったカメラは小窓を出さない: 置き場所が仮なので)
  const selectedCamera = currentScene?.objects.find((o) => o.id === selectedObjectIds[0] && o.type === 'camera' && !o.anchor);

  const perceptionTargets = project?.perception?.targets ?? [];

  // プロジェクトから消えた VRM は、覚えておいた読み込み結果も捨てる (他のシーンの VRM は残す: シーンを切り替えても読み直さない)
  useEffect(() => {
    const keep = new Set<string>();
    for (const scene of project?.scenes ?? []) {
      for (const obj of scene.objects ?? []) {
        if (obj.type === 'vrm') keep.add(vrmKey(obj.id, resolveModelUrl(obj.modelPath, projectPath)));
      }
    }
    pruneVrmCache(keep);
  }, [project?.scenes, projectPath]);

  // 貼り付け済みのオブジェクトは、対応するアンカーのグループ内で描く。
  // 参照先が消えているものは通常のオブジェクトとして扱う（画面から消さない）。
  const { unanchoredObjects, anchoredObjects } = useMemo(() => {
    const unanchored: SceneObject[] = [];
    const anchored = new Map<string, SceneObject[]>();
    const knownTargets = new Set(perceptionTargets.map((x) => x.id));

    for (const obj of currentScene?.objects ?? []) {
      const targetId = obj.anchor?.targetId;
      if (targetId && knownTargets.has(targetId)) {
        const list = anchored.get(targetId);
        if (list) list.push(obj);
        else anchored.set(targetId, [obj]);
      } else {
        unanchored.push(obj);
      }
    }
    return { unanchoredObjects: unanchored, anchoredObjects: anchored };
  }, [currentScene?.objects, project?.perception?.targets]);

  /**
   * placement 指定があれば、その基準位置を返す（無ければ null）。
   * ランタイムと同じ src/shared/placement.ts を使うので、
   * ここで見た位置がそのまま実機の位置になる。
   */
  const placementOffset = (obj: SceneObject, target: PerceptionTarget): [number, number, number] | null => {
    const placement = obj.anchor?.placement;
    if (!placement) return null;

    const height = target.physicalHeight && target.physicalHeight > 0
      ? target.physicalHeight
      : target.physicalWidth;
    const region = placement.regionId
      ? target.regions?.find((r) => r.id === placement.regionId)
      : undefined;

    const at = resolvePlacement(
      placement,
      regionToBase(target.physicalWidth, height, region?.rect),
      estimateObjectExtents(obj),
    );
    return [at.x, at.y, at.z];
  };

  const renderSceneObject = (obj: SceneObject) => {
    const isSelected = selectedObjectIds.includes(obj.id);
    if (obj.type === 'vrm') {
      return <VRMViewer key={obj.id} object={obj} isSelected={isSelected} transformMode={transformMode} transformSpace={transformSpace} />;
    }
    if (obj.type === 'camera') {
      return <CameraObject key={obj.id} object={obj} isSelected={isSelected} transformMode={transformMode} transformSpace={transformSpace} />;
    }
    if (obj.type === 'model') {
      // モデルごとに Suspense を分ける。1 つにまとめると、1 つ読み込むあいだ全部のオブジェクトが消える
      return (
        <Suspense key={obj.id} fallback={<LoadingPlaceholder object={obj} />}>
          <ModelObject object={obj} isSelected={isSelected} transformMode={transformMode} transformSpace={transformSpace} />
        </Suspense>
      );
    }
    return <SceneObjectMesh key={obj.id} object={obj} isSelected={isSelected} transformMode={transformMode} transformSpace={transformSpace} />;
  };

  const handleAddObject = (type: string, primitiveType?: string) => {
    addObject({
      name: `New ${primitiveType || type}`,
      type: type as any,
      primitiveType: primitiveType as any,
    });
  };

  useEffect(() => {
    // 他のタブを開いているあいだも 3D ビューは残っているので、キーは見えているときだけ受ける
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTypingTarget = tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable === true;
      if (isTypingTarget) return;

      const key = event.key.toLowerCase();
      if (key === 'w') setTransformMode('translate');
      if (key === 'e') setTransformMode('rotate');
      if (key === 'r') setTransformMode('scale');
      if (key === 'f') requestView('focus');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, setTransformMode, requestView]);

  return (
    <div className="w-full h-full relative">
      {/* 3D Scene toolbar */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-arsist-surface/90 backdrop-blur border border-arsist-border rounded-lg p-1">
        <span className="px-2 text-xs text-arsist-muted">{t('scene.addLabel')}</span>
        <button
          onClick={() => handleAddObject('primitive', 'cube')}
          className="btn-icon"
          title={t('scene.addCube')}
        >
          <Box size={16} />
        </button>
        <button
          onClick={() => handleAddObject('primitive', 'sphere')}
          className="btn-icon"
          title={t('scene.addSphere')}
        >
          <Circle size={16} />
        </button>
        <button
          onClick={() => handleAddObject('primitive', 'plane')}
          className="btn-icon"
          title={t('scene.addPlane')}
        >
          <Square size={16} />
        </button>
        <button
          onClick={() => handleAddObject('primitive', 'cylinder')}
          className="btn-icon"
          title={t('scene.addCylinder')}
        >
          <Cylinder size={16} />
        </button>
        <button
          onClick={() => addObject(newCameraObject(t('camera.defaultName'), currentScene?.objects ?? []))}
          className="btn-icon"
          title={t('camera.addTitle')}
        >
          <Video size={16} />
        </button>
      </div>

      {/* Camera info panel */}
      <div className="absolute top-2 right-2 z-10 bg-arsist-surface/90 backdrop-blur border border-arsist-border rounded-lg p-2 text-xs">
        <div className="flex items-center gap-2 text-arsist-muted mb-1">
          <Eye size={12} />
          <span className="flex-1">{t('scene.camera')}</span>
          <button className="btn-icon p-0.5" title={t('scene.resetView')} onClick={() => requestView('reset')}>
            <PersonStanding size={13} />
          </button>
          <button
            className="btn-icon p-0.5 disabled:opacity-40"
            title={`${t('scene.focusSelected')} (F)`}
            disabled={selectedObjectIds.length === 0}
            onClick={() => requestView('focus')}
          >
            <Focus size={13} />
          </button>
        </div>
        <CameraReadout />
        <div className="mt-2 text-[10px] text-arsist-muted">
          <div>{t('scene.trackingLabel')}: <span className="text-arsist-text">{trackingMode.toUpperCase()}</span></div>
          <div>{t('scene.modeLabel')}: <span className="text-arsist-text">{presentationMode.replace('_', ' ')}</span></div>
          <div>{t('scene.unitsLabel')}: <span className="text-arsist-text">1 = 1m</span></div>
        </div>
      </div>

      {/* Help button */}
      <button
        onClick={() => setShowHelp(!showHelp)}
        className="absolute bottom-2 right-2 z-10 btn-icon bg-arsist-surface/90 backdrop-blur border border-arsist-border"
        title={t('scene.operationHelp')}
      >
        <HelpCircle size={16} />
      </button>

      {/* Operation help panel */}
      {showHelp && (
        <div className="absolute bottom-12 right-2 z-10 bg-arsist-surface/95 backdrop-blur border border-arsist-border rounded-lg p-3 text-xs w-64">
          <h4 className="font-medium text-arsist-text mb-2">{t('scene.operationGuide')}</h4>
          <div className="space-y-1 text-arsist-muted">
            <div className="flex justify-between">
              <span>{t('scene.rotate')}</span>
              <span className="kbd">{t('scene.leftDrag')}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('scene.pan')}</span>
              <span className="kbd">{t('scene.rightDrag')}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('scene.zoom')}</span>
              <span className="kbd">{t('scene.scroll')}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('scene.moveMode')}</span>
              <span className="kbd">W</span>
            </div>
            <div className="flex justify-between">
              <span>{t('scene.rotateMode')}</span>
              <span className="kbd">E</span>
            </div>
            <div className="flex justify-between">
              <span>{t('scene.scaleMode')}</span>
              <span className="kbd">R</span>
            </div>
            <div className="flex justify-between">
              <span>{t('scene.focusSelected')}</span>
              <span className="kbd">F</span>
            </div>
          </div>
        </div>
      )}

      {/* Selected object info */}
      {selectedObjectIds.length > 0 && currentScene && (
        <div className="absolute bottom-2 left-2 z-10 bg-arsist-surface/90 backdrop-blur border border-arsist-border rounded-lg p-2 text-xs">
          <span className="text-arsist-accent">
            {currentScene.objects.find(o => o.id === selectedObjectIds[0])?.name || t('scene.object')}
          </span>
          <span className="text-arsist-muted ml-2">{t('scene.selected')}</span>
        </div>
      )}

      {/* 選んだカメラの画 (小窓は Canvas の中の CameraPreview が描く。ここは見出しだけ) */}
      {selectedCamera && (
        <div
          className="absolute z-10 px-1.5 py-0.5 rounded text-[10px] bg-arsist-surface/90 text-arsist-muted pointer-events-none"
          style={{ left: 8, bottom: 44 + previewBox(selectedCamera.camera).height + 4 }}
        >
          {t('camera.previewLabel', { name: selectedCamera.name })}
        </div>
      )}

      <Canvas 
        shadows
        // 他のタブを開いているあいだは描かない (ビューは残すが GPU は使わない)
        frameloop={active ? 'always' : 'never'}
        gl={{ antialias: true, alpha: false }}
        camera={{ position: defaultViewpoint(spawnViewDistance).position, fov: 50, near: 0.05, far: 500 }}
      >
        {/* 背景色 */}
        <color attach="background" args={['#1e1e1e']} />
        
        {/* ライティング */}
        <ambientLight intensity={0.5} />
        <directionalLight 
          position={[5, 10, 5]} 
          intensity={0.8} 
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <hemisphereLight args={['#606060', '#404040', 0.5]} />

        {/* エディタの補助 (arsistEditorOnly)。カメラの画には写さない */}
        <group userData={{ arsistEditorOnly: true }}>
        {/* Origin axis */}
        {showAxes && <OriginAxes />}

        {/* ユーザーの初期視点（原点）。トラッキングモードに関係なく「どこから見るか」は常に要る */}
        {showSpawnView && <SpawnViewMarker fov={deviceFov} distance={spawnViewDistance} />}

        {/* Grid */}
        {showGrid && (
          <Grid
            args={[20, 20]}
            cellSize={1}
            cellThickness={0.5}
            cellColor="#3c3c3c"
            sectionSize={5}
            sectionThickness={1}
            sectionColor="#4a4a4a"
            fadeDistance={30}
            fadeStrength={1}
            followCamera={false}
            position={[0, -0.01, 0]}
          />
        )}

        {/* AR mode guide */}
        {presentationMode === 'floating_screen' && (
          <mesh position={[0, 0, 2]}>
            <planeGeometry args={[1.6, 0.9]} />
            <meshBasicMaterial color="#3c3c3c" wireframe opacity={0.6} transparent />
          </mesh>
        )}
        {presentationMode === 'head_locked_hud' && (
          <mesh position={[0, 0, 1]}>
            <planeGeometry args={[1.2, 0.6]} />
            <meshBasicMaterial color="#4ec9b0" wireframe opacity={0.4} transparent />
          </mesh>
        )}
        </group>

        {/* 選んだカメラから見た画 (左下の小窓) */}
        {selectedCamera && active && <CameraPreview object={selectedCamera} />}

        {/* Scene objects (読み込みを待つものは、それぞれの中で待つ) */}
        <Suspense fallback={null}>
          {unanchoredObjects.map(renderSceneObject)}

          {/* 画像アンカー。実行時の姿勢は現実の物体次第なので、ここは編集用の仮置き。
              貼り付けたオブジェクトはこのグループの子として描くので、
              作者はいつも通りのギズモでアンカーからのオフセットを編集できる。 */}
          {perceptionTargets.map((target, index) => {
            const placement = anchorPlacement(index, perceptionTargets.length);
            return (
              <group key={target.id} position={placement.position} rotation={[0, placement.rotationY, 0]}>
                <Suspense fallback={null}>
                  <AnchorPlane
                    target={target}
                    projectPath={projectPath}
                    isSelected={selectedPerceptionTargetId === target.id}
                    onSelect={() => selectPerceptionTarget(target.id)}
                  />
                </Suspense>
                {(anchoredObjects.get(target.id) ?? []).map((obj) => {
                  const offset = placementOffset(obj, target);
                  // placement 指定のオブジェクトは、計算した基準位置のグループの中に置く。
                  // こうすると object.transform は「微調整」として上に乗り、
                  // ギズモの編集結果もランタイムと同じ意味になる。
                  return offset
                    ? <group key={obj.id} position={offset}>{renderSceneObject(obj)}</group>
                    : renderSceneObject(obj);
                })}
              </group>
            );
          })}
        </Suspense>

        {/* カメラ操作 */}
        <OrbitControls 
          makeDefault 
          minDistance={trackingMode === '3dof' ? 2 : 0.3}
          maxDistance={trackingMode === '3dof' ? 2 : 50}
          enableDamping
          dampingFactor={0.1}
          enablePan={trackingMode === '6dof'}
          enableZoom={trackingMode === '6dof'}
          enableRotate={trackingMode !== 'head_locked'}
        />
        <CameraRig viewKey={projectPath ?? ''} depth={spawnViewDistance} />

        {/* ギズモヘルパー */}
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport 
            axisColors={['#f14c4c', '#4ec9b0', '#569cd6']} 
            labelColor="white" 
          />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}

/** 右上のカメラ座標。ここだけが視点の変化で描き直される。 */
function CameraReadout() {
  const { x, y, z } = useSceneView((s) => s.readout);
  return (
    <div className="font-mono text-arsist-text">
      <span className="text-red-400">X</span>: {x.toFixed(1)}
      <span className="mx-1 text-arsist-border">|</span>
      <span className="text-green-400">Y</span>: {y.toFixed(1)}
      <span className="mx-1 text-arsist-border">|</span>
      <span className="text-blue-400">Z</span>: {z.toFixed(1)}
    </div>
  );
}

/**
 * 視点の出し入れ。
 *   - 開いたとき / プロジェクトが変わったとき: 覚えている視点 (無ければ既定) に置く
 *   - 操作を終えたとき・ビューが消えるとき: 今の視点を覚える
 *   - 「ユーザーの視点に戻す」「選んだものに寄る (F)」の指示を受ける
 */
/** OrbitControls (makeDefault) のうち、ここで使うところだけ */
interface OrbitControlsLike {
  target: THREE.Vector3;
  update(): void;
  addEventListener(type: 'change' | 'end', listener: () => void): void;
  removeEventListener(type: 'change' | 'end', listener: () => void): void;
}

function CameraRig({ viewKey, depth }: { viewKey: string; depth: number }) {
  const camera = useThree((s: { camera: THREE.Camera }) => s.camera);
  const scene = useThree((s: { scene: THREE.Scene }) => s.scene);
  const controls = useThree((s: { controls: unknown }) => s.controls) as unknown as OrbitControlsLike | null;
  const command = useSceneView((s) => s.command);
  // 作り直したときに、前に出た指示をもう一度実行しない
  const handledNonce = useRef(command?.nonce ?? 0);

  useEffect(() => {
    if (!controls) return;
    const store = useSceneView.getState();
    const publish = () => store.setReadout(camera.position.x, camera.position.y, camera.position.z);
    const current = (): SceneViewpoint => ({
      position: camera.position.toArray() as Vec3Tuple,
      target: controls.target.toArray() as Vec3Tuple,
    });

    const view = store.viewpoints[viewKey] ?? defaultViewpoint(depth);
    camera.position.set(...view.position);
    controls.target.set(...view.target);
    controls.update();
    publish();

    // 表示の更新は間引く (毎フレーム React を動かさない)
    let last = 0;
    let trailing: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      const now = performance.now();
      if (now - last > 100) {
        last = now;
        publish();
      } else if (!trailing) {
        trailing = setTimeout(() => { trailing = null; last = performance.now(); publish(); }, 120);
      }
    };
    const onEnd = () => useSceneView.getState().saveViewpoint(viewKey, current());
    controls.addEventListener('change', onChange);
    controls.addEventListener('end', onEnd);
    return () => {
      controls.removeEventListener('change', onChange);
      controls.removeEventListener('end', onEnd);
      if (trailing) clearTimeout(trailing);
      useSceneView.getState().saveViewpoint(viewKey, current());
    };
    // depth は既定の視点にしか使わない (奥行きを変えるたびに視点を飛ばさない)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, camera, viewKey]);

  useEffect(() => {
    if (!command || !controls || command.nonce <= handledNonce.current) return;
    handledNonce.current = command.nonce;

    if (command.kind === 'reset') {
      const view = defaultViewpoint(depth);
      camera.position.set(...view.position);
      controls.target.set(...view.target);
    } else {
      const id = useProjectStore.getState().selectedObjectIds[0];
      let node: THREE.Object3D | undefined;
      if (id) scene.traverse((o: THREE.Object3D) => { if (!node && o.userData?.arsistObjectId === id) node = o; });
      if (!node) return;
      const box = new THREE.Box3().setFromObject(node);
      const center = box.isEmpty() ? node.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
      const radius = box.isEmpty() ? 0.5 : Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.2);
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
      const distance = (radius / Math.sin(THREE.MathUtils.degToRad(fov) / 2)) * 1.1;
      // 今見ている向きのまま近づく (向きまで変えると、どこを見ているか分からなくなる)
      const direction = camera.position.clone().sub(controls.target);
      if (direction.lengthSq() < 1e-6) direction.set(0, 0.3, -1);
      direction.normalize();
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, distance);
    }
    controls.update();
    useSceneView.getState().saveViewpoint(viewKey, {
      position: camera.position.toArray() as Vec3Tuple,
      target: controls.target.toArray() as Vec3Tuple,
    });
    useSceneView.getState().setReadout(camera.position.x, camera.position.y, camera.position.z);
  }, [command, controls, camera, scene, depth, viewKey]);

  return null;
}

/** 読み込み中のモデルの仮置き (置き場所は分かっているので、そこに枠を出す) */
function LoadingPlaceholder({ object }: { object: SceneObject }) {
  return (
    <mesh
      position={[object.transform.position.x, object.transform.position.y, object.transform.position.z]}
      onClick={(e) => { e.stopPropagation(); useProjectStore.getState().selectObjects([object.id]); }}
    >
      <boxGeometry args={[0.3, 0.3, 0.3]} />
      <meshBasicMaterial color="#888888" wireframe />
    </mesh>
  );
}

const SceneObjectMesh = memo(function SceneObjectMesh({ object, isSelected, transformMode, transformSpace }: SceneObjectProps) {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);

  // Create geometry based on primitive type
  const geometry = useMemo(() => {
    if (object.type === 'canvas') {
      const width = object.canvasSettings?.widthMeters || 1.2;
      const height = object.canvasSettings?.heightMeters || 0.7;
      return new THREE.PlaneGeometry(width, height);
    }
    switch (object.primitiveType) {
      case 'cube':
        return new THREE.BoxGeometry(1, 1, 1);
      case 'sphere':
        return new THREE.SphereGeometry(0.5, 32, 32);
      case 'plane':
        return new THREE.PlaneGeometry(1, 1);
      case 'cylinder':
        return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
      case 'capsule':
        return new THREE.CapsuleGeometry(0.25, 0.5, 8, 16);
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [object.primitiveType, object.type, object.canvasSettings?.widthMeters, object.canvasSettings?.heightMeters]);

  // Create material
  const material = useMemo(() => {
    if (object.type === 'canvas') {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color('#2a2f3a'),
        emissive: new THREE.Color('#4ec9b0'),
        emissiveIntensity: 0.2,
        metalness: 0,
        roughness: 1,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
    }
    const color = new THREE.Color(object.material?.color || '#FFFFFF');
    return new THREE.MeshStandardMaterial({
      color,
      metalness: object.material?.metallic || 0,
      roughness: object.material?.roughness || 0.5,
    });
  }, [object.type, object.material?.color, object.material?.metallic, object.material?.roughness]);

  // 作り直した古いものは GPU から下ろす (色を変えるたびにメモリが増えないように)
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  const edges = useMemo(() => (isSelected ? new THREE.EdgesGeometry(geometry) : null), [geometry, isSelected]);
  useEffect(() => () => edges?.dispose(), [edges]);

  return (
    <>
      <mesh
        ref={setMesh}
        userData={{ arsistObjectId: object.id }}
        geometry={geometry}
        material={material}
        position={[
          object.transform.position.x,
          object.transform.position.y,
          object.transform.position.z
        ]}
        rotation={[
          THREE.MathUtils.degToRad(object.transform.rotation.x),
          THREE.MathUtils.degToRad(object.transform.rotation.y),
          THREE.MathUtils.degToRad(object.transform.rotation.z)
        ]}
        scale={[
          object.transform.scale.x,
          object.transform.scale.y,
          object.transform.scale.z
        ]}
        onClick={(e) => {
          e.stopPropagation();
          useProjectStore.getState().selectObjects([object.id]);
        }}
        castShadow
        receiveShadow
      >
        {/* Selection outline */}
        {edges && (
          <lineSegments geometry={edges}>
            <lineBasicMaterial color="#4ec9b0" linewidth={2} />
          </lineSegments>
        )}
      </mesh>

      {/* Transform Controls */}
      {isSelected && mesh && (
        <SceneTransformControls
          object={mesh}
          mode={transformMode}
          space={transformSpace}
          onObjectChange={() => useProjectStore.getState().updateObject(object.id, { transform: transformOf(mesh) })}
        />
      )}
    </>
  );
});

const ModelObject = memo(function ModelObject({ object, isSelected, transformMode, transformSpace }: SceneObjectProps) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const projectPath = useProjectStore((s) => s.projectPath);
  const url = resolveModelUrl(object.modelPath, projectPath);

  return (
    <>
      <group
        ref={setGroup}
        userData={{ arsistObjectId: object.id }}
        position={[
          object.transform.position.x,
          object.transform.position.y,
          object.transform.position.z
        ]}
        rotation={[
          THREE.MathUtils.degToRad(object.transform.rotation.x),
          THREE.MathUtils.degToRad(object.transform.rotation.y),
          THREE.MathUtils.degToRad(object.transform.rotation.z)
        ]}
        scale={[
          object.transform.scale.x,
          object.transform.scale.y,
          object.transform.scale.z
        ]}
        onClick={(e) => {
          e.stopPropagation();
          useProjectStore.getState().selectObjects([object.id]);
        }}
      >
        {url ? <GltfScene url={url} /> : (
          <mesh>
            <boxGeometry args={[0.3, 0.3, 0.3]} />
            <meshBasicMaterial color="#f14c4c" wireframe />
          </mesh>
        )}
      </group>

      {isSelected && group && (
        <SceneTransformControls
          object={group}
          mode={transformMode}
          space={transformSpace}
          onObjectChange={() => useProjectStore.getState().updateObject(object.id, { transform: transformOf(group) })}
        />
      )}
    </>
  );
});

/** GLB / glTF の中身。読み込み結果は useGLTF が URL ごとに覚えているので、作り直しても読み直さない。 */
function GltfScene({ url }: { url: string }) {
  const gltf = useGLTF(url) as unknown as { scene: THREE.Group };
  const scene = useMemo(() => gltf.scene.clone(), [gltf]);
  return <primitive object={scene} />;
}
