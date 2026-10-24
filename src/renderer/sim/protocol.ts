/**
 * プレビュー シミュレータの約束 — scripts/sim/electron-main.cjs (Electron の main) と、このページの間。
 *
 * main は sim.html を開き、`window.__arsistSim.render(job)` を executeJavaScript で呼ぶ。返ってくる Promise は
 * 「描き終わった (フォント・VRM の読み込みと数フレーム)」ときに SimFrameInfo で解決するので、そこで capturePage する。
 */
import type { SpaceFixture, SpatialProject } from '../../shared/layster/spatial/types';
import type { SolveResult } from '../../shared/layster/spatial/solver';

export type SimView = 'first-person' | 'overview';

interface JobBase {
  width: number;
  height: number;
  view: SimView;
  overlays: boolean;
  lang: 'en' | 'ja';
  /** adapter.json (display.fieldOfView を読む)。無ければ null */
  adapter: unknown;
  deviceName: string;
  /** プロジェクトのフォルダの file:// URL (末尾 /)。VRM などを読む */
  projectUrl: string;
  /** 秒 */
  t: number;
}

export interface SpatialJob extends JobBase {
  kind: 'spatial';
  project: SpatialProject;
  /** 組み込み (spaces.ts) か projectSpaces の id */
  spaceId: string;
  /** プロジェクトの spaces/*.json */
  projectSpaces: SpaceFixture[];
}

export interface VirtualJob extends JobBase {
  kind: 'virtual';
  /** project.json の中身 (Layster.Virtual)。形は irRepair で直して読む */
  project: Record<string, unknown>;
  sceneId: string;
}

export type SimJob = SpatialJob | VirtualJob;

export interface SimPlacement {
  thing: string;
  name?: string;
  mode: SolveResult['mode'];
  frame: SolveResult['frame'];
  rule: SolveResult['rule'];
  at: [number, number, number];
  yaw: number;
  host?: string;
  notes: string[];
  visible: boolean;
}

export interface SimFrameInfo {
  fov: { horizontal: number; vertical: number } | null;
  placements?: SimPlacement[];
  /** その時刻までに流した規則 (Spatial、おおよそ) */
  timeline?: { log: Array<{ t: number; rule: string; action: string; status: string; detail?: string }>; skipped: string[]; store: Record<string, unknown> };
  warnings: string[];
  /** 描けなかった (空間が見つからないなど)。main は PNG を書かない */
  error?: string;
}

declare global {
  interface Window {
    __arsistSim?: { render(job: SimJob): Promise<SimFrameInfo> };
    __arsistSimBoot?: boolean;
  }
}
