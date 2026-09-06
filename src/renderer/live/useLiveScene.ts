/**
 * Arsist Engine — ライブ配置モードのシーンモデル
 *
 * 「今画面に描くべきオブジェクト一覧」と「ユーザー視点」を、2つの供給源から
 * 同じ形にそろえて返す:
 *   - 実機接続中     : 実機の ArsistWebSocketServer から取得した実際の Transform
 *   - シミュレーション: プロジェクトIRを実機と同じ座標系に変換したもの
 *
 * どちらも Unity ワールド座標に統一する（IR座標のままだと左右が反転して、
 * 実機で見えるものと鏡像になってしまう。doc/01-ir-types.md 参照）。
 */
import { useEffect, useMemo, useRef } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useLiveStore } from './liveStore';
import { parseObjectState, parseViewerPose } from './LiveClient';
import { irToRuntime, type Vec3 } from './coords';
import type { SceneObject, SceneObjectType } from '../../shared/types';

export interface PlacedObject {
  /** 実機コマンドの宛先になるID (= IR の assetId、無ければ name) */
  runtimeId: string;
  /** 対応するIRオブジェクトのID。IRへ書き戻すときに使う */
  irId?: string;
  name: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  type?: SceneObjectType;
  primitiveType?: string;
  color?: string;
  canvasSize?: { width: number; height: number };
  /** 実機の実測値か、IRから合成した予測値か */
  source: 'device' | 'project';
  /** 実機に居るが対応するIRオブジェクトが見つからない（VRMの実体など） */
  orphan?: boolean;
}

export interface ViewerPose {
  position: Vec3;
  /** 正面ベクトル（正規化済み） */
  forward: Vec3;
  up: Vec3;
  /** 実機から取れた値か、シミュレーションの仮想視点か */
  source: 'device' | 'simulated';
  tracking: boolean;
}

/** IR上のオブジェクトが実機で持つID。ArsistBuildPipeline.CreateGameObject と同じ規則。 */
export function runtimeIdOf(obj: SceneObject): string {
  return obj.assetId || obj.name;
}

function toVec3(t: [number, number, number]): Vec3 {
  return { x: t[0], y: t[1], z: t[2] };
}

/** yaw/pitch(度) から正面ベクトルを作る。Unity と同じ左手系Y-up・Z+前方。 */
export function forwardFromYawPitch(yawDeg: number, pitchDeg: number): Vec3 {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const cosPitch = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * cosPitch,
    y: -Math.sin(pitch),
    z: Math.cos(yaw) * cosPitch,
  };
}

/**
 * 実機をポーリングして live ストアを更新する。
 * 接続していない / シミュレーションのみのときは何もしない。
 */
export function useDevicePolling(): void {
  const client = useLiveStore((s) => s.client);
  const connection = useLiveStore((s) => s.connection);
  const simulationOnly = useLiveStore((s) => s.simulationOnly);
  const pollIntervalMs = useLiveStore((s) => s.pollIntervalMs);
  const setDeviceState = useLiveStore((s) => s.setDeviceState);
  const setSyncError = useLiveStore((s) => s.setSyncError);

  // ポーリング中に前回の応答が返っていない場合は次を投げない（実機を詰まらせない）
  const inFlight = useRef(false);

  useEffect(() => {
    if (!client || connection !== 'connected' || simulationOnly) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled || inFlight.current || !client.isConnected) return;
      inFlight.current = true;
      try {
        const [sceneRaw, poseRaw] = await Promise.all([
          client.request<any>('query', 'getScene'),
          client.request<any>('query', 'getHeadPose'),
        ]);
        if (cancelled) return;

        const objects = (sceneRaw?.objects ?? [])
          .map(parseObjectState)
          .filter((o: any): o is NonNullable<typeof o> => o !== null);
        setDeviceState(objects, parseViewerPose(poseRaw));
      } catch (e) {
        if (!cancelled) setSyncError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlight.current = false;
      }
    };

    void tick();
    const handle = setInterval(tick, Math.max(50, pollIntervalMs));
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [client, connection, simulationOnly, pollIntervalMs, setDeviceState, setSyncError]);
}

/** 描画用に統一されたオブジェクト一覧と視点を返す。 */
export function useLiveScene(): { objects: PlacedObject[]; viewer: ViewerPose } {
  const project = useProjectStore((s) => s.project);
  const currentSceneId = useProjectStore((s) => s.currentSceneId);
  const deviceObjects = useLiveStore((s) => s.objects);
  const deviceViewer = useLiveStore((s) => s.viewer);
  const simulationOnly = useLiveStore((s) => s.simulationOnly);
  const connection = useLiveStore((s) => s.connection);
  const simulatedPose = useLiveStore((s) => s.simulatedPose);

  const useDevice = !simulationOnly && connection === 'connected';

  const irObjects = useMemo(() => {
    const scene = project?.scenes.find((s) => s.id === currentSceneId) ?? project?.scenes[0];
    return scene?.objects ?? [];
  }, [project, currentSceneId]);

  const objects = useMemo<PlacedObject[]>(() => {
    const byRuntimeId = new Map<string, SceneObject>();
    for (const obj of irObjects) byRuntimeId.set(runtimeIdOf(obj), obj);

    if (!useDevice) {
      // シミュレーション: IR を実機の座標系に変換して描く
      return irObjects.map((obj) => {
        const converted = irToRuntime(obj.transform);
        return {
          runtimeId: runtimeIdOf(obj),
          irId: obj.id,
          name: obj.name,
          position: converted.position,
          rotation: converted.rotation,
          scale: obj.transform.scale,
          type: obj.type,
          primitiveType: obj.primitiveType,
          color: obj.material?.color,
          canvasSize: obj.canvasSettings
            ? { width: obj.canvasSettings.widthMeters, height: obj.canvasSettings.heightMeters }
            : undefined,
          source: 'project' as const,
        };
      });
    }

    // 実機接続中: 実機の実測 Transform を正とし、見た目の情報だけIRから補う
    return deviceObjects
      .filter((o) => !o.error)
      .map((o) => {
        const ir = byRuntimeId.get(o.id);
        return {
          runtimeId: o.id,
          irId: ir?.id,
          name: ir?.name ?? o.name ?? o.id,
          position: toVec3(o.position),
          rotation: toVec3(o.rotation),
          scale: toVec3(o.scale),
          type: ir?.type,
          primitiveType: ir?.primitiveType,
          color: ir?.material?.color,
          canvasSize: ir?.canvasSettings
            ? { width: ir.canvasSettings.widthMeters, height: ir.canvasSettings.heightMeters }
            : undefined,
          source: 'device' as const,
          orphan: !ir,
        };
      });
  }, [useDevice, irObjects, deviceObjects]);

  const viewer = useMemo<ViewerPose>(() => {
    if (useDevice && deviceViewer?.available) {
      return {
        position: toVec3(deviceViewer.position),
        forward: toVec3(deviceViewer.forward),
        up: toVec3(deviceViewer.up),
        source: 'device',
        tracking: deviceViewer.tracking,
      };
    }
    return {
      position: simulatedPose.position,
      forward: forwardFromYawPitch(simulatedPose.yaw, simulatedPose.pitch),
      up: { x: 0, y: 1, z: 0 },
      source: 'simulated',
      tracking: false,
    };
  }, [useDevice, deviceViewer, simulatedPose]);

  return { objects, viewer };
}
