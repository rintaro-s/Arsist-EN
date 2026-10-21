/**
 * 3D ビューの視点の状態 (シーンの中身ではなく、編集する人の見え方)。
 *
 * ビューはタブを切り替えても作り直さない (ViewportContainer) が、ライブ配置モードやプロジェクトを開き直すと
 * 作り直される。そのときに視点がいきなり既定に戻らないよう、プロジェクトごとの視点をここに覚えておく。
 * 右上のカメラ座標の表示もここを通す (OrbitControls の変化のたびにビュー全体を描き直さないため)。
 */
import { create } from 'zustand';

export type Vec3Tuple = [number, number, number];

export interface SceneViewpoint {
  position: Vec3Tuple;
  target: Vec3Tuple;
}

/**
 * 既定の視点: ユーザーの初期位置 (原点) の少し後ろ・上から、正面 (+Z) を見る。
 * 実機で見える向きと同じなので、画面の左右がそのままユーザーの左右になる (+X = 左)。
 */
export function defaultViewpoint(depth: number): SceneViewpoint {
  const d = depth > 0 ? depth : 2;
  return { position: [-1.2, 1.3, -2.6], target: [0, 0, d * 0.6] };
}

interface SceneViewState {
  /** プロジェクトのパスごとの視点 */
  viewpoints: Record<string, SceneViewpoint>;
  /** 右上の表示用 (間引いて更新) */
  readout: { x: number; y: number; z: number };
  /** ボタンやキーから CameraRig への指示 (nonce で同じ指示の繰り返しも届く) */
  command: { kind: 'reset' | 'focus'; nonce: number } | null;
  saveViewpoint(key: string, view: SceneViewpoint): void;
  setReadout(x: number, y: number, z: number): void;
  request(kind: 'reset' | 'focus'): void;
}

export const useSceneView = create<SceneViewState>((set) => ({
  viewpoints: {},
  readout: { x: 0, y: 0, z: 0 },
  command: null,
  saveViewpoint: (key, view) => set((s) => ({ viewpoints: { ...s.viewpoints, [key]: view } })),
  setReadout: (x, y, z) => set({ readout: { x, y, z } }),
  request: (kind) => set((s) => ({ command: { kind, nonce: (s.command?.nonce ?? 0) + 1 } })),
}));
