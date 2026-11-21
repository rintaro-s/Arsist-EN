/**
 * Layster.Spatial — エディタ (renderer) と main の間の約束。
 *
 * main 側: src/main/layster/ (ipcMain.handle) と src/main/preload.ts (window.electronAPI.spatial)
 * renderer 側: src/renderer/spatial/api.ts (型付きの呼び口)
 * どちらもこの型だけを見る。
 */

import type { MindReply, MindRequest, Mind, SpaceFixture, SpatialProject } from './types';
import type { SpatialProblem } from './validate';
import type { MissingRequirement } from '../../extensions';

export const SPATIAL_IPC = {
  /** フォルダが Virtual / Spatial / どちらでもないか */
  detect: 'spatial:detect',
  create: 'spatial:create',
  load: 'spatial:load',
  save: 'spatial:save',
  /** 組み込み + プロジェクトの spaces/*.json */
  spaces: 'spatial:spaces',
  saveSpace: 'spatial:save-space',
  /** エディタから Mind を試す (main から HTTP。CORS を避け、鍵を renderer に渡さない) */
  tryMind: 'spatial:try-mind',
  /** 鍵の名前の一覧 / 値を入れる (値は main から外に出さない) */
  secrets: 'spatial:secrets',
  /** 素材をプロジェクトの Assets/ に写す */
  importAsset: 'spatial:import-asset',
  build: 'spatial:build',
  /** main → renderer: project.spatial.json が外 (エージェント) で書き換えられた */
  changed: 'spatial:changed',
} as const;

export interface ProjectKindInfo {
  kind: 'virtual' | 'spatial' | 'none';
  /** 'Layster.Virtual α5' / 'Layster.Spatial β 1.0.0' */
  label?: string;
  name?: string;
  /** 読んだファイル */
  file?: string;
}

export interface SpatialCreateRequest {
  /** 親フォルダ。ここに name のフォルダを作る */
  parentDir: string;
  name: string;
  targetDevice: string;
}

export interface SpatialLoadResult {
  success: boolean;
  project?: SpatialProject;
  /** プロジェクトのフォルダ */
  path?: string;
  /** 補った項目など */
  notices?: string[];
  /** 新しい Arsist で作られている */
  tooNew?: boolean;
  /**
   * error === 'requirementsMissing' のとき: 使う拡張機能・端末のうち、このエディタに無いもの (Virtual と同じ形)。
   * エディタは開かずに MissingRequirementsDialog を出す
   */
  missing?: MissingRequirement[];
  error?: string;
}

export interface SpatialSpacesResult {
  builtin: SpaceFixture[];
  project: SpaceFixture[];
}

export interface TryMindRequest {
  mind: Mind;
  request: MindRequest;
  /** {edge} を置き換えるアドレス (エディタで試すときの PC) */
  edge?: string;
}

export interface TryMindResult {
  ok: boolean;
  /** 往復の時間 */
  ms: number;
  status?: number;
  /** 行動として読めた返事 */
  reply?: MindReply;
  /** 送った本文 (鍵は含まない) と、返ってきた生の本文 (確認用) */
  sent?: unknown;
  raw?: string;
  error?: string;
}

export type SecretsRequest = { op: 'list' } | { op: 'set'; name: string; value: string } | { op: 'remove'; name: string };
export interface SecretsResult { success: boolean; names: string[]; error?: string }

export interface ImportAssetRequest {
  kind: 'model' | 'character' | 'image' | 'audio' | 'animation';
  /** 省略時はファイル選択の画面を出す */
  sourcePath?: string;
}
export interface ImportAssetResult { success: boolean; /** プロジェクト相対 ('Assets/Characters/x.vrm') */ file?: string; error?: string; cancelled?: boolean }

export interface SpatialBuildRequest {
  outputPath: string;
  targetDevice: string;
  developmentBuild: boolean;
  cleanBuild?: boolean;
}

export interface SpatialBuildResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  warnings?: string[];
  /** ビルドを止めた問題 */
  problems?: SpatialProblem[];
}
