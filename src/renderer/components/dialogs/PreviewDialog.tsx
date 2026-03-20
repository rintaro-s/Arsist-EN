import { useMemo, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Eye, Monitor, Compass, Zap } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useProjectStore } from '../../stores/projectStore';
import { DataStoreProvider, useDataStore } from '../../stores/dataStoreContext';
import type { SceneObject, UIElement } from '../../../shared/types';

interface PreviewDialogProps {
  onClose: () => void;
}

type PreviewMode = 'user' | 'orbit';

/* ================================================================
 * Lightweight UIElementRenderer (preview-only)
 * Independent lightweight version from UIEditor.tsx ElementRenderer
 * ================================================================ */
function SimpleUIRenderer({ element }: { element: UIElement }) {
  let storeCtx: { data: Record<string, unknown> } | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    storeCtx = useDataStore();
  } catch {
    // outside provider
  }
  const data = storeCtx?.data || {};

  const resolveContent = (el: UIElement): string => {
    if (el.bind?.key) {
      const raw = data[el.bind.key];
      const val = raw != null ? String(raw) : '—';
      return el.bind.format ? el.bind.format.replace('{value}', val) : val;
    }
    return el.content || '';
  };

  const styleObj: React.CSSProperties = {
    width: el2css(element.style.width) || '100%',
    height: el2css(element.style.height) || '100%',
    display: 'flex',
    flexDirection: element.style.flexDirection === 'row' ? 'row' : 'column',
    justifyContent: element.style.justifyContent || 'flex-start',
    alignItems: element.style.alignItems || 'stretch',
    gap: element.style.gap,
    padding: spacingToCss(element.style.padding),
    margin: spacingToCss(element.style.margin),
    backgroundColor: element.style.backgroundColor,
    color: element.style.color || '#ffffff',
    borderRadius: element.style.borderRadius,
    borderWidth: element.style.borderWidth,
    borderColor: element.style.borderColor,
    borderStyle: element.style.borderWidth ? 'solid' : undefined,
    opacity: element.style.opacity,
    fontSize: element.style.fontSize || 14,
    fontWeight: element.style.fontWeight,
    textAlign: element.style.textAlign,
    position: element.style.position === 'absolute' ? 'absolute' : 'relative',
    top: element.style.top,
    right: element.style.right,
    bottom: element.style.bottom,
    left: element.style.left,
    overflow: 'hidden',
    boxSizing: 'border-box',
  };

  if (element.type === 'Text') {
    return <div style={styleObj}>{resolveContent(element)}</div>;
  }

  if (element.type === 'Button') {
    return (
      <div style={{ ...styleObj, cursor: 'pointer', userSelect: 'none' }}>
        {resolveContent(element) || 'Button'}
      </div>
    );
  }

  if (element.type === 'Image') {
    return (
      <div style={styleObj}>
        <div style={{ width: '100%', height: '100%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#888' }}>
          IMG
        </div>
      </div>
    );
  }

  if (element.type === 'Gauge') {
    const val = element.bind?.key ? Number(data[element.bind.key]) || 0 : 50;
    return (
      <div style={styleObj}>
        <div style={{ width: '100%', height: 8, backgroundColor: '#333', borderRadius: 4 }}>
          <div style={{ width: `${Math.min(100, Math.max(0, val))}%`, height: '100%', backgroundColor: '#4ec9b0', borderRadius: 4 }} />
        </div>
      </div>
    );
  }

  // Panel or other container
  return (
    <div style={styleObj}>
      {element.children?.map((child) => (
        <SimpleUIRenderer key={child.id} element={child} />
      ))}
    </div>
  );
}

function el2css(v: number | string | undefined): string | undefined {
  if (v == null) return undefined;
  return typeof v === 'number' ? `${v}px` : v;
}

function spacingToCss(s?: { top: number; right: number; bottom: number; left: number }): string | undefined {
  if (!s) return undefined;
  return `${s.top}px ${s.right}px ${s.bottom}px ${s.left}px`;
}

/* ================================================================
 * Main Dialog
 * ================================================================ */
export function PreviewDialog({ onClose }: PreviewDialogProps) {
  const { project, currentSceneId, selectedObjectIds, selectObjects, projectPath } = useProjectStore();
  const [mode, setMode] = useState<PreviewMode>('user');
  const [showUHD, setShowUHD] = useState(true);
  const [autoUpdateData, setAutoUpdateData] = useState(true);

  const currentScene = project?.scenes.find((s) => s.id === currentSceneId);
  const layoutMap = useMemo(() => {
    const map = new Map<string, any>();
    if (!project?.uiLayouts) return map;
    for (const layout of project.uiLayouts) {
      map.set(layout.id, layout);
    }
    return map;
  }, [project?.uiLayouts]);

  const uhdLayout = useMemo(() => {
    if (!project?.uiLayouts) return null;
    return project.uiLayouts.find((l) => l.scope === 'uhd') || null;
  }, [project?.uiLayouts]);

  const initialData = useMemo(() => {
    const d: Record<string, any> = {
      deviceStatus: {
        brightness: 75,
        wearingStatus: 'PUT_ON',
        temperatureLevel: 'LEVEL_NORMAL',
        displayState: 'DISPLAY_ON',
        rgbCamera: 'PLUGIN',
        ecLevel: 50,
        volume: 100,
      },
      xrTracker: {
        position: { x: 0, y: 1.6, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        forward: { x: 0, y: 0, z: -1 },
      },
      systemClock: new Date().toLocaleTimeString(),
      timestamp: Date.now(),
    };
    return d;
  }, []);

  if (!project) return null;

  return createPortal(
    <DataStoreProvider initialData={initialData}>
      <PreviewContent
        currentScene={currentScene}
        uhdLayout={uhdLayout}
        layoutMap={layoutMap}
        projectPath={projectPath}
        selectedObjectIds={selectedObjectIds}
        selectObjects={selectObjects}
        mode={mode}
        setMode={setMode}
        showUHD={showUHD}
        setShowUHD={setShowUHD}
        autoUpdateData={autoUpdateData}
        setAutoUpdateData={setAutoUpdateData}
        onClose={onClose}
      />
    </DataStoreProvider>,
    document.body,
  );
}

interface PreviewContentProps {
  currentScene: any;
  uhdLayout: any;
  layoutMap: Map<string, any>;
  projectPath: string | null;
  selectedObjectIds: string[];
  selectObjects: (ids: string[]) => void;
  mode: PreviewMode;
  setMode: (m: PreviewMode) => void;
  showUHD: boolean;
  setShowUHD: (v: boolean) => void;
  autoUpdateData: boolean;
  setAutoUpdateData: (v: boolean) => void;
  onClose: () => void;
}

function PreviewContent({
  currentScene,
  uhdLayout,
  layoutMap,
  selectedObjectIds,
  selectObjects,
  mode,
  setMode,
  showUHD,
  setShowUHD,
  autoUpdateData,
  setAutoUpdateData,
  onClose,
}: PreviewContentProps) {
  const { data, setData } = useDataStore();

  useEffect(() => {
    if (!autoUpdateData) return;
    const interval = setInterval(() => {
      setData({
        ...data,
        deviceStatus: {
          ...data.deviceStatus,
          brightness: Math.max(30, Math.min(100, (data.deviceStatus?.brightness || 75) + (Math.random() - 0.5) * 10)),
        },
        systemClock: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [autoUpdateData, data, setData]);

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div className="modal max-w-6xl w-[95vw] h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye size={18} className="text-arsist-accent" />
            <span>Full Preview</span>
          </div>
          <button onClick={onClose} className="btn-icon"><X size={18} /></button>
        </div>

        <div className="modal-body h-[calc(100%-96px)] flex flex-col gap-3">
          {/* Controls */}
          <div className="flex items-center justify-between gap-2 text-xs text-arsist-muted">
            <div className="flex items-center gap-2">
              <button className={`btn btn-secondary text-xs ${mode === 'user' ? 'border-arsist-accent' : ''}`} onClick={() => setMode('user')}>
                <Monitor size={14} /> User View
              </button>
              <button className={`btn btn-secondary text-xs ${mode === 'orbit' ? 'border-arsist-accent' : ''}`} onClick={() => setMode('orbit')}>
                <Compass size={14} /> Orbit
              </button>
              <button className={`btn btn-secondary text-xs ${showUHD ? 'border-arsist-accent' : ''}`} onClick={() => setShowUHD(!showUHD)}>
                Show UHD
              </button>
            </div>
            <button className={`btn btn-secondary text-xs ${autoUpdateData ? 'border-arsist-accent' : ''}`} onClick={() => setAutoUpdateData(!autoUpdateData)}>
              <Zap size={14} /> {autoUpdateData ? 'Live' : 'Static'}
            </button>
          </div>

          {/* DataStore preview */}
          <pre className="text-[10px] max-h-20 overflow-y-auto bg-[#1a1a1a] p-2 rounded text-arsist-muted">
            {JSON.stringify(data, null, 2).split('\n').slice(0, 12).join('\n')}…
          </pre>

          {/* 3D Preview */}
          <div className="relative flex-1 rounded-lg border border-arsist-border bg-black overflow-hidden">
            <PreviewScene
              objects={currentScene?.objects || []}
              mode={mode}
              selectedObjectIds={selectedObjectIds}
              onSelect={(id) => selectObjects([id])}
              layoutMap={layoutMap}
            />

            {showUHD && uhdLayout && (
              <div className="absolute inset-0 flex items-start justify-center pt-8 pointer-events-none">
                <div
                  className="relative shadow-2xl"
                  style={{
                    width: uhdLayout.resolution?.width || 1920,
                    height: uhdLayout.resolution?.height || 1080,
                    transform: 'scale(0.25)',
                    transformOrigin: 'top center',
                  }}
                >
                  <SimpleUIRenderer element={uhdLayout.root} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
 * 3D Preview Scene
 * ================================================================ */
function PreviewScene({
  objects,
  mode,
  selectedObjectIds,
  onSelect,
  layoutMap,
}: {
  objects: SceneObject[];
  mode: PreviewMode;
  selectedObjectIds: string[];
  onSelect: (id: string) => void;
  layoutMap: Map<string, any>;
}) {
  const cameraPosition: [number, number, number] = mode === 'user' ? [0, 1.6, 0.05] : [4, 3, 4];

  return (
    <Canvas gl={{ antialias: true, alpha: true }} camera={{ position: cameraPosition, fov: 50 }}>
      <color attach="background" args={['#000000']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} />
      <hemisphereLight args={['#606060', '#404040', 0.5]} />

      {mode === 'user' && <Reticle />}

      {objects.map((obj) => (
        <PreviewObject
          key={obj.id}
          object={obj}
          isSelected={selectedObjectIds.includes(obj.id)}
          onSelect={() => onSelect(obj.id)}
          layoutMap={layoutMap}
        />
      ))}
    </Canvas>
  );
}

function PreviewObject({
  object,
  isSelected,
  onSelect,
  layoutMap,
}: {
  object: SceneObject;
  isSelected: boolean;
  onSelect: () => void;
  layoutMap: Map<string, any>;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const layoutId = object.canvasSettings?.layoutId || '';
  const surfaceLayout = layoutId ? layoutMap.get(layoutId) : null;
  const pixelsPerUnit = object.canvasSettings?.pixelsPerUnit || 1000;
  const widthPx = (object.canvasSettings?.widthMeters || 1.2) * pixelsPerUnit;
  const heightPx = (object.canvasSettings?.heightMeters || 0.7) * pixelsPerUnit;

  const geometry = useMemo(() => {
    if (object.type === 'canvas') {
      const w = object.canvasSettings?.widthMeters || 1.2;
      const h = object.canvasSettings?.heightMeters || 0.7;
      return new THREE.PlaneGeometry(w, h);
    }
    switch (object.primitiveType) {
      case 'cube': return new THREE.BoxGeometry(1, 1, 1);
      case 'sphere': return new THREE.SphereGeometry(0.5, 32, 32);
      case 'plane': return new THREE.PlaneGeometry(1, 1);
      case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
      case 'capsule': return new THREE.CapsuleGeometry(0.25, 0.5, 8, 16);
      default: return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [object.primitiveType, object.type, object.canvasSettings]);

  const material = useMemo(() => {
    if (object.type === 'canvas') {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color('#2a2f3a'),
        emissive: new THREE.Color('#4ec9b0'),
        emissiveIntensity: 0.2,
        metalness: 0,
        roughness: 1,
        transparent: true,
        opacity: 0.9,
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

  return (
    <group
      position={[object.transform.position.x, object.transform.position.y, object.transform.position.z]}
      rotation={[
        THREE.MathUtils.degToRad(object.transform.rotation.x),
        THREE.MathUtils.degToRad(object.transform.rotation.y),
        THREE.MathUtils.degToRad(object.transform.rotation.z),
      ]}
      scale={[object.transform.scale.x, object.transform.scale.y, object.transform.scale.z]}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <mesh ref={meshRef} geometry={geometry} material={material}>
        {isSelected && (
          <lineSegments>
            <edgesGeometry args={[geometry]} />
            <lineBasicMaterial color="#4ec9b0" linewidth={2} />
          </lineSegments>
        )}
      </mesh>

      {object.type === 'canvas' && surfaceLayout && (
        <Html transform position={[0, 0, 0.001]} scale={0.001} style={{ width: widthPx, height: heightPx, pointerEvents: 'none' }}>
          <div style={{ width: widthPx, height: heightPx }}>
            <SimpleUIRenderer element={surfaceLayout.root} />
          </div>
        </Html>
      )}
    </group>
  );
}

function Reticle() {
  return (
    <mesh position={[0, 1.6, 1]}>
      <ringGeometry args={[0.01, 0.015, 32]} />
      <meshBasicMaterial color="#ffffff" />
    </mesh>
  );
}
