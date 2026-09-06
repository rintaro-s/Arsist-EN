/**
 * Arsist Engine — ライブ配置モードの状態
 *
 * 通常のエディタ状態 (uiStore / projectStore) とは意図的に分けている。
 * ここに入るのは「実機に繋いでいる間だけ意味がある揮発的な状態」だけで、
 * プロジェクト(IR)には触らない。IRへ反映したいときだけ、明示的な操作で
 * projectStore.updateObject を呼ぶ（LiveInspector 側）。
 */
import { create } from 'zustand';
import type { DeviceObjectState, DeviceViewerPose, LiveConnectionState } from './LiveClient';
import { LiveClient } from './LiveClient';

/** 実機に繋がずPC上だけで見え方を確かめるときの仮想視点。 */
export interface SimulatedPose {
  position: { x: number; y: number; z: number };
  /** 度。yaw=左右, pitch=上下 */
  yaw: number;
  pitch: number;
}

export const DEFAULT_SIMULATED_POSE: SimulatedPose = {
  position: { x: 0, y: 0, z: 0 },
  yaw: 0,
  pitch: 0,
};

interface LiveState {
  // ── 接続 ──
  client: LiveClient | null;
  connection: LiveConnectionState;
  connectionDetail: string;
  host: string;
  port: number;
  password: string;
  setHost: (host: string) => void;
  setPort: (port: number) => void;
  setPassword: (password: string) => void;
  connect: () => Promise<void>;
  disconnect: () => void;

  // ── 実機から取得した状態 ──
  objects: DeviceObjectState[];
  viewer: DeviceViewerPose | null;
  lastSyncAt: number | null;
  syncError: string | null;
  setDeviceState: (objects: DeviceObjectState[], viewer: DeviceViewerPose | null) => void;
  setSyncError: (error: string | null) => void;

  // ── 選択 ──
  selectedId: string | null;
  select: (id: string | null) => void;

  // ── 表示設定 ──
  /** 実機に繋がず、プロジェクトIRの内容だけでシミュレーションする */
  simulationOnly: boolean;
  setSimulationOnly: (v: boolean) => void;
  simulatedPose: SimulatedPose;
  setSimulatedPose: (pose: SimulatedPose) => void;
  resetSimulatedPose: () => void;
  /** ポーリング間隔[ms]。実機の負荷と滑らかさのトレードオフ */
  pollIntervalMs: number;
  setPollIntervalMs: (ms: number) => void;
}

export const useLiveStore = create<LiveState>((set, get) => ({
  client: null,
  connection: 'disconnected',
  connectionDetail: '',
  host: '192.168.0.1',
  port: 8765,
  password: '',
  setHost: (host) => set({ host }),
  setPort: (port) => set({ port }),
  setPassword: (password) => set({ password }),

  connect: async () => {
    const { host, port, password, client: existing } = get();
    existing?.disconnect();

    const client = new LiveClient({
      host,
      port,
      password: password || undefined,
      onStateChange: (connection, detail) =>
        set({ connection, connectionDetail: detail ?? '' }),
    });
    set({ client, objects: [], viewer: null, syncError: null });

    try {
      await client.connect();
    } catch (e) {
      set({ client: null });
      throw e;
    }
  },

  disconnect: () => {
    get().client?.disconnect();
    set({ client: null, objects: [], viewer: null, connection: 'disconnected' });
  },

  objects: [],
  viewer: null,
  lastSyncAt: null,
  syncError: null,
  setDeviceState: (objects, viewer) =>
    set({ objects, viewer, lastSyncAt: Date.now(), syncError: null }),
  setSyncError: (syncError) => set({ syncError }),

  selectedId: null,
  select: (selectedId) => set({ selectedId }),

  simulationOnly: true,
  setSimulationOnly: (simulationOnly) => set({ simulationOnly }),
  simulatedPose: DEFAULT_SIMULATED_POSE,
  setSimulatedPose: (simulatedPose) => set({ simulatedPose }),
  resetSimulatedPose: () => set({ simulatedPose: DEFAULT_SIMULATED_POSE }),
  pollIntervalMs: 100,
  setPollIntervalMs: (pollIntervalMs) => set({ pollIntervalMs }),
}));
