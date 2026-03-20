import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import type { SceneObject } from '../../../shared/types';
import { useProjectStore } from '../../stores/projectStore';

interface VRMViewerProps {
  object: SceneObject;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<SceneObject>) => void;
  transformMode: 'translate' | 'rotate' | 'scale';
  transformSpace: 'local' | 'world';
}

function VRMModel({ 
  url, 
  object,
  isSelected,
  onSelect,
  onUpdate,
  transformMode,
  transformSpace
}: VRMViewerProps & { url: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const transformRef = useRef<any>(null);
  const [vrm, setVrm] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;

    const loader = new GLTFLoader();
    loader.register((parser: any) => new VRMLoaderPlugin(parser));

    loader.load(
      url,
      (gltf: any) => {
        const vrmInstance = gltf.userData.vrm;
        if (vrmInstance) {
          // Adjust model orientation using VRMUtils.rotateVRM0
          VRMUtils.rotateVRM0(vrmInstance);
          setVrm(vrmInstance);
          setError(null);
        } else {
          setError('VRM data not found in file');
        }
      },
      (progress: any) => {
        console.log('Loading VRM...', (progress.loaded / progress.total) * 100, '%');
      },
      (err: any) => {
        console.error('Error loading VRM:', err);
        setError(err.message || 'Failed to load VRM');
      }
    );

    return () => {
      if (vrm) {
        VRMUtils.deepDispose(vrm.scene);
      }
    };
  }, [url]);

  useFrame((_state: any, delta: number) => {
    if (vrm) {
      vrm.update(delta);
    }
  });

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

  if (error) {
    return (
      <mesh position={[0, 1, 0]} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial color="#ff0000" />
      </mesh>
    );
  }

  if (!vrm) {
    return (
      <mesh position={[0, 1, 0]} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshStandardMaterial color="#888888" wireframe />
      </mesh>
    );
  }

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
        <primitive object={vrm.scene} />
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

export function VRMViewer(props: VRMViewerProps) {
  const { object } = props;
  const projectPath = useProjectStore((s) => s.projectPath);

  const toArsistFileUrl = (absPath: string) => {
    let normalized = absPath.replace(/\\/g, '/');
    if (!normalized.startsWith('//')) {
      normalized = normalized.replace(/^\/+/, '');
    }
    if (/^[A-Za-z]:/.test(normalized)) {
      return `arsist-file://${encodeURI(normalized)}`;
    }
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
        if (rawPath.startsWith('/') && /^[A-Za-z]:/.test(rawPath.slice(1))) {
          rawPath = rawPath.slice(1);
        }
        return toArsistFileUrl(rawPath);
      } catch {
        // fallthrough
      }
    }

    const normalized = modelPath.replace(/\\/g, '/');

    // Absolute path (/path or C:/path)
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
      return toArsistFileUrl(normalized);
    }

    // Project-relative path (e.g., assets/Models/foo.vrm)
    if (projectPath) {
      const base = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
      const rel = normalized.replace(/^\/+/, '');
      return toArsistFileUrl(`${base}/${rel}`);
    }

    // Fallback
    return toArsistFileUrl(normalized);
  };

  const url = resolveModelUrl(object.modelPath);

  return <VRMModel {...props} url={url} />;
}
