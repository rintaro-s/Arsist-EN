import { Suspense, useEffect, useRef, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { 
  OrbitControls, 
  Grid, 
  GizmoHelper, 
  GizmoViewport,
  TransformControls,
  useGLTF,
  Line,
  Text
} from '@react-three/drei';
import * as THREE from 'three';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { SceneObject } from '../../../shared/types';
import { Eye, HelpCircle, Box, Circle, Square, Cylinder } from 'lucide-react';
import { VRMViewer } from './VRMViewer';

// Origin axis display
function OriginAxes() {
  return (
    <group>
      {/* X-axis (red) */}
      <Line points={[[0, 0, 0], [2, 0, 0]]} color="#f14c4c" lineWidth={2} />
      <Line points={[[1.8, 0.1, 0], [2, 0, 0], [1.8, -0.1, 0]]} color="#f14c4c" lineWidth={2} />
      {/* Y-axis (green) */}
      <Line points={[[0, 0, 0], [0, 2, 0]]} color="#4ec9b0" lineWidth={2} />
      <Line points={[[-0.1, 1.8, 0], [0, 2, 0], [0.1, 1.8, 0]]} color="#4ec9b0" lineWidth={2} />
      {/* Z-axis (blue) */}
      <Line points={[[0, 0, 0], [0, 0, 2]]} color="#569cd6" lineWidth={2} />
      <Line points={[[0, 0.1, 1.8], [0, 0, 2], [0, -0.1, 1.8]]} color="#569cd6" lineWidth={2} />
    </group>
  );
}

function StartPoseMarker() {
  return (
    <group>
      {/* Origin */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshStandardMaterial color={'#ffffff'} emissive={'#ffffff'} emissiveIntensity={0.4} />
      </mesh>

      {/* Forward (+Z) marker */}
      <Line points={[[0, 0, 0], [0, 0, 1]]} color="#ffffff" lineWidth={2} />
      <Line points={[[0, 0, 1], [0.08, 0, 0.9]]} color="#ffffff" lineWidth={2} />
      <Line points={[[0, 0, 1], [-0.08, 0, 0.9]]} color="#ffffff" lineWidth={2} />

      {/* 1m scale */}
      <Line points={[[0, 0, 0], [1, 0, 0]]} color="#f14c4c" lineWidth={2} />
      <Text position={[1.05, 0.02, 0]} fontSize={0.15} color="#f14c4c" anchorX="left" anchorY="middle">
        1m
      </Text>

      <Text position={[0, 0.22, 0]} fontSize={0.16} color="#ffffff" anchorX="center" anchorY="middle">
        Start (0,0,0) m
      </Text>
    </group>
  );
}

export function SceneViewport() {
  const { showGrid, showAxes, transformMode, transformSpace, setTransformMode } = useUIStore();
  const { project, currentSceneId, selectedObjectIds, selectObjects, updateObject, addObject } = useProjectStore();
  const [cameraPos, setCameraPos] = useState({ x: 5, y: 5, z: 5 });
  const [showHelp, setShowHelp] = useState(false);
  const trackingMode = project?.arSettings?.trackingMode || '6dof';
  const presentationMode = project?.arSettings?.presentationMode || 'world_anchored';
  
  const currentScene = project?.scenes.find(s => s.id === currentSceneId);

  const handleAddObject = (type: string, primitiveType?: string) => {
    addObject({
      name: `New ${primitiveType || type}`,
      type: type as any,
      primitiveType: primitiveType as any,
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTypingTarget = tag === 'input' || tag === 'textarea' || (target?.getAttribute('contenteditable') === 'true');
      if (isTypingTarget) return;

      const key = event.key.toLowerCase();
      if (key === 'w') setTransformMode('translate');
      if (key === 'e') setTransformMode('rotate');
      if (key === 'r') setTransformMode('scale');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setTransformMode]);

  return (
    <div className="w-full h-full relative">
      {/* 3D Scene toolbar */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-arsist-surface/90 backdrop-blur border border-arsist-border rounded-lg p-1">
        <span className="px-2 text-xs text-arsist-muted">Add:</span>
        <button
          onClick={() => handleAddObject('primitive', 'cube')}
          className="btn-icon"
          title="Add Cube"
        >
          <Box size={16} />
        </button>
        <button
          onClick={() => handleAddObject('primitive', 'sphere')}
          className="btn-icon"
          title="Add Sphere"
        >
          <Circle size={16} />
        </button>
        <button
          onClick={() => handleAddObject('primitive', 'plane')}
          className="btn-icon"
          title="Add Plane"
        >
          <Square size={16} />
        </button>
        <button
          onClick={() => handleAddObject('primitive', 'cylinder')}
          className="btn-icon"
          title="Add Cylinder"
        >
          <Cylinder size={16} />
        </button>
      </div>

      {/* Camera info panel */}
      <div className="absolute top-2 right-2 z-10 bg-arsist-surface/90 backdrop-blur border border-arsist-border rounded-lg p-2 text-xs">
        <div className="flex items-center gap-2 text-arsist-muted mb-1">
          <Eye size={12} />
          <span>Camera</span>
        </div>
        <div className="font-mono text-arsist-text">
          <span className="text-red-400">X</span>: {cameraPos.x.toFixed(1)} 
          <span className="mx-1 text-arsist-border">|</span>
          <span className="text-green-400">Y</span>: {cameraPos.y.toFixed(1)} 
          <span className="mx-1 text-arsist-border">|</span>
          <span className="text-blue-400">Z</span>: {cameraPos.z.toFixed(1)}
        </div>
        <div className="mt-2 text-[10px] text-arsist-muted">
          <div>Tracking: <span className="text-arsist-text">{trackingMode.toUpperCase()}</span></div>
          <div>Mode: <span className="text-arsist-text">{presentationMode.replace('_', ' ')}</span></div>
          <div>Units: <span className="text-arsist-text">1 = 1m</span></div>
        </div>
      </div>

      {/* Help button */}
      <button
        onClick={() => setShowHelp(!showHelp)}
        className="absolute bottom-2 right-2 z-10 btn-icon bg-arsist-surface/90 backdrop-blur border border-arsist-border"
        title="Operation help"
      >
        <HelpCircle size={16} />
      </button>

      {/* Operation help panel */}
      {showHelp && (
        <div className="absolute bottom-12 right-2 z-10 bg-arsist-surface/95 backdrop-blur border border-arsist-border rounded-lg p-3 text-xs w-64">
          <h4 className="font-medium text-arsist-text mb-2">Operation guide</h4>
          <div className="space-y-1 text-arsist-muted">
            <div className="flex justify-between">
              <span>Rotate</span>
              <span className="kbd">Left drag</span>
            </div>
            <div className="flex justify-between">
              <span>Pan</span>
              <span className="kbd">Right drag</span>
            </div>
            <div className="flex justify-between">
              <span>Zoom</span>
              <span className="kbd">Scroll</span>
            </div>
            <div className="flex justify-between">
              <span>Move mode</span>
              <span className="kbd">W</span>
            </div>
            <div className="flex justify-between">
              <span>Rotate mode</span>
              <span className="kbd">E</span>
            </div>
            <div className="flex justify-between">
              <span>Scale mode</span>
              <span className="kbd">R</span>
            </div>
          </div>
        </div>
      )}

      {/* Selected object info */}
      {selectedObjectIds.length > 0 && currentScene && (
        <div className="absolute bottom-2 left-2 z-10 bg-arsist-surface/90 backdrop-blur border border-arsist-border rounded-lg p-2 text-xs">
          <span className="text-arsist-accent">
            {currentScene.objects.find(o => o.id === selectedObjectIds[0])?.name || 'Object'}
          </span>
          <span className="text-arsist-muted ml-2">Selected</span>
        </div>
      )}

      <Canvas 
        shadows
        gl={{ antialias: true, alpha: false }}
        camera={{ position: [5, 5, 5], fov: 50 }}
        onCreated={({ camera }: { camera: THREE.PerspectiveCamera }) => {
          const updateCameraPos = () => {
            setCameraPos({
              x: camera.position.x,
              y: camera.position.y,
              z: camera.position.z,
            });
          };
          updateCameraPos();
        }}
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

        {/* Origin axis */}
        {showAxes && <OriginAxes />}

        {/* For 6DoF, always visualize the start position (origin) */}
        {trackingMode === '6dof' && <StartPoseMarker />}

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

        {/* Scene objects */}
        <Suspense fallback={null}>
          {currentScene?.objects.map(obj => {
            if (obj.type === 'vrm') {
              return (
                <VRMViewer
                  key={obj.id}
                  object={obj}
                  isSelected={selectedObjectIds.includes(obj.id)}
                  onSelect={() => selectObjects([obj.id])}
                  onUpdate={(updates) => updateObject(obj.id, updates)}
                  transformMode={transformMode}
                  transformSpace={transformSpace}
                />
              );
            } else if (obj.type === 'model') {
              return (
                <ModelObject
                  key={obj.id}
                  object={obj}
                  isSelected={selectedObjectIds.includes(obj.id)}
                  onSelect={() => selectObjects([obj.id])}
                  onUpdate={(updates) => updateObject(obj.id, updates)}
                  transformMode={transformMode}
                  transformSpace={transformSpace}
                />
              );
            } else {
              return (
                <SceneObjectMesh
                  key={obj.id}
                  object={obj}
                  isSelected={selectedObjectIds.includes(obj.id)}
                  onSelect={() => selectObjects([obj.id])}
                  onUpdate={(updates) => updateObject(obj.id, updates)}
                  transformMode={transformMode}
                  transformSpace={transformSpace}
                />
              );
            }
          })}
        </Suspense>

        {/* カメラ操作 */}
        <OrbitControls 
          makeDefault 
          minDistance={trackingMode === '3dof' ? 2 : 1}
          maxDistance={trackingMode === '3dof' ? 2 : 50}
          enableDamping
          dampingFactor={0.05}
          enablePan={trackingMode === '6dof'}
          enableZoom={trackingMode === '6dof'}
          enableRotate={trackingMode !== 'head_locked'}
          onChange={(e: any) => {
            if (e?.target) {
              const cam = e.target.object;
              setCameraPos({
                x: cam.position.x,
                y: cam.position.y,
                z: cam.position.z,
              });
            }
          }}
        />

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

interface SceneObjectMeshProps {
  object: SceneObject;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<SceneObject>) => void;
  transformMode: 'translate' | 'rotate' | 'scale';
  transformSpace: 'local' | 'world';
}

function SceneObjectMesh({ 
  object, 
  isSelected, 
  onSelect, 
  onUpdate,
  transformMode,
  transformSpace
}: SceneObjectMeshProps) {
  if (object.type === 'model') return null;
  const meshRef = useRef<THREE.Mesh>(null);
  const transformRef = useRef<any>(null);

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
  }, [object.primitiveType, object.type, object.canvasSettings]);

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
  }, [object.material, object.type, object.canvasSettings]);

  // Handle transform changes from gizmo
  const handleTransformChange = () => {
    if (!meshRef.current) return;
    
    const position = meshRef.current.position;
    const rotation = meshRef.current.rotation;
    const scale = meshRef.current.scale;

    onUpdate({
      transform: {
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { 
          x: THREE.MathUtils.radToDeg(rotation.x),
          y: THREE.MathUtils.radToDeg(rotation.y),
          z: THREE.MathUtils.radToDeg(rotation.z)
        },
        scale: { x: scale.x, y: scale.y, z: scale.z },
      }
    });
  };

  return (
    <>
      <mesh
        ref={meshRef}
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
          onSelect();
        }}
        castShadow
        receiveShadow
      >
        {/* Selection outline */}
        {isSelected && (
          <lineSegments>
            <edgesGeometry args={[geometry]} />
            <lineBasicMaterial color="#4ec9b0" linewidth={2} />
          </lineSegments>
        )}
      </mesh>

      {/* Transform Controls */}
      {isSelected && meshRef.current && (
        <TransformControls
          ref={transformRef}
          object={meshRef.current}
          mode={transformMode}
          space={transformSpace}
          onObjectChange={handleTransformChange}
        />
      )}
    </>
  );
}

function ModelObject({ 
  object, 
  isSelected, 
  onSelect, 
  onUpdate,
  transformMode,
  transformSpace
}: SceneObjectMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const transformRef = useRef<any>(null);

  const projectPath = useProjectStore((s) => s.projectPath);

  const toArsistFileUrl = (absPath: string) => {
    // Windows パス（バックスラッシュ）をフォワードスラッシュに統一
    let normalized = absPath.replace(/\\/g, '/');
    // 先頭のスラッシュを除去（ただし //で始まる UNC パスは保護）
    if (!normalized.startsWith('//')) {
      normalized = normalized.replace(/^\/+/, '');
    }
    // Windows ドライブレター (C: など) の場合は arsist-file://C:/... 形式
    if (/^[A-Za-z]:/.test(normalized)) {
      return `arsist-file://${encodeURI(normalized)}`;
    }
    // Unix パスは arsist-file:///... 形式
    return `arsist-file:///${encodeURI(normalized)}`;
  };

  const resolveModelUrl = (modelPath: string | undefined | null): string => {
    if (!modelPath) return '';
    if (modelPath.startsWith('arsist-file:')) return modelPath;
    if (modelPath.startsWith('http://') || modelPath.startsWith('https://')) {
      return modelPath;
    }

    if (modelPath.startsWith('file:')) {
      try {
        const u = new URL(modelPath);
        let rawPath = u.pathname;
        // Windows: file:///C:/Users/... の場合、/C: 部分を処理
        if (rawPath.startsWith('/') && /^[A-Za-z]:/.test(rawPath.slice(1))) {
          rawPath = rawPath.slice(1);
        }
        return toArsistFileUrl(rawPath);
      } catch {
        // fallthrough
      }
    }

    const normalized = modelPath.replace(/\\/g, '/');
    
    // Absolute path (both /path and C:/path for Windows)
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
      return toArsistFileUrl(normalized);
    }

    // Project-relative asset path (e.g. Assets/Models/foo.glb)
    if (projectPath) {
      const base = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
      const rel = normalized.replace(/^\/+/, '');
      return toArsistFileUrl(`${base}/${rel}`);
    }

    // Fallback (legacy): interpret as absolute-ish
    return toArsistFileUrl(normalized);
  };

  const url = resolveModelUrl(object.modelPath);

  const gltf = useGLTF(url || '') as any;
  const scene = useMemo(() => gltf?.scene ? gltf.scene.clone() : new THREE.Group(), [gltf]);

  const handleTransformChange = () => {
    if (!groupRef.current) return;
    const position = groupRef.current.position;
    const rotation = groupRef.current.rotation;
    const scale = groupRef.current.scale;

    onUpdate({
      transform: {
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { 
          x: THREE.MathUtils.radToDeg(rotation.x),
          y: THREE.MathUtils.radToDeg(rotation.y),
          z: THREE.MathUtils.radToDeg(rotation.z)
        },
        scale: { x: scale.x, y: scale.y, z: scale.z },
      }
    });
  };

  return (
    <>
      <group
        ref={groupRef}
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
          onSelect();
        }}
      >
        <primitive object={scene} />
      </group>

      {isSelected && groupRef.current && (
        <TransformControls
          ref={transformRef}
          object={groupRef.current}
          mode={transformMode}
          space={transformSpace}
          onObjectChange={handleTransformChange}
        />
      )}
    </>
  );
}

