/**
 * Layster — 第2層 (IR) の名前と版 (doc/19-layster.md §1)。
 *
 * Layster には形 (profile) が 2 つある。互いに互換性は持たない。
 *   virtual  今までの IR (画面と座標)。ファイルは project.json
 *   spatial  空間を書く IR。ファイルは project.spatial.json
 *
 * 版の呼び方:
 *   α1〜α5   今までの irVersion 1〜5 (Virtual の前身)
 *   β x.y.z  ここから先。semver
 *
 * 画面・ログ・エージェント向けの文で版を書くときは、必ず formatLayster / describeVirtualIrVersion を通す。
 */

export type LaysterProfile = 'virtual' | 'spatial';
export type LaysterStage = 'alpha' | 'beta';

/** project.json / project.spatial.json の先頭に置く見出し。 */
export interface LaysterHeader {
  profile: LaysterProfile;
  stage: LaysterStage;
  /** semver (β)。α のときは '1'〜'5' */
  version: string;
}

export const VIRTUAL_PROJECT_FILE = 'project.json';
export const SPATIAL_PROJECT_FILE = 'project.spatial.json';

/** 今のエディタが書く版。 */
export const LAYSTER_CURRENT: Record<LaysterProfile, LaysterHeader> = {
  virtual: { profile: 'virtual', stage: 'beta', version: '1.0.0' },
  spatial: { profile: 'spatial', stage: 'beta', version: '1.0.0' },
};

/**
 * Virtual の中の数 (irVersion) と名前の対応。
 * Virtual は今までの移行の仕組み (migrations.ts) をそのまま使うので、中では整数を数え続ける。
 * 版を上げるとき (npm run ir:new) は、ここにも 1 行足す。
 */
export const VIRTUAL_FORMATS: Record<number, { stage: LaysterStage; version: string }> = {
  1: { stage: 'alpha', version: '1' },
  2: { stage: 'alpha', version: '2' },
  3: { stage: 'alpha', version: '3' },
  4: { stage: 'alpha', version: '4' },
  5: { stage: 'alpha', version: '5' },
  6: { stage: 'beta', version: '1.0.0' },
  7: { stage: 'beta', version: '1.1.0' },
  // @virtual-formats-end (npm run ir:new はこの行の上に足す)
};

const STAGE_MARK: Record<LaysterStage, string> = { alpha: 'α', beta: 'β' };

/** 'β 1.0.0' / 'α5' */
export function formatStageVersion(stage: LaysterStage, version: string): string {
  return stage === 'alpha' ? `α${version}` : `${STAGE_MARK[stage]} ${version}`;
}

/** 'Layster.Virtual β 1.0.0' / 'Layster.Spatial β 1.0.0' / 'Layster.Virtual α5' */
export function formatLayster(header: Pick<LaysterHeader, 'profile' | 'stage' | 'version'>): string {
  const name = header.profile === 'spatial' ? 'Spatial' : 'Virtual';
  return `Layster.${name} ${formatStageVersion(header.stage, header.version)}`;
}

/** Virtual の irVersion を名前にする。表に無い数 (未来の版) は 'v<n>' のまま返す。 */
export function describeVirtualIrVersion(irVersion: number): string {
  const f = VIRTUAL_FORMATS[irVersion];
  return f ? formatStageVersion(f.stage, f.version) : `v${irVersion}`;
}

/** Virtual の irVersion に対応する見出し。表に無ければ undefined。 */
export function virtualHeaderFor(irVersion: number): LaysterHeader | undefined {
  const f = VIRTUAL_FORMATS[irVersion];
  return f ? { profile: 'virtual', stage: f.stage, version: f.version } : undefined;
}

// ---- semver ------------------------------------------------------------------

export interface SemVer { major: number; minor: number; patch: number }

export function parseSemVer(text: unknown): SemVer | undefined {
  if (typeof text !== 'string') return undefined;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** a < b なら負、同じなら 0、a > b なら正。 */
export function compareSemVer(a: SemVer, b: SemVer): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** α は常に β より古い。 */
export function compareLayster(a: Pick<LaysterHeader, 'stage' | 'version'>, b: Pick<LaysterHeader, 'stage' | 'version'>): number {
  if (a.stage !== b.stage) return a.stage === 'alpha' ? -1 : 1;
  if (a.stage === 'alpha') return Number(a.version) - Number(b.version);
  const sa = parseSemVer(a.version);
  const sb = parseSemVer(b.version);
  if (!sa || !sb) return 0;
  return compareSemVer(sa, sb);
}

/** ファイルの中身から見出しを読む。無い・壊れているなら undefined。 */
export function readLaysterHeader(raw: unknown): LaysterHeader | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const h = (raw as { layster?: unknown }).layster;
  if (!h || typeof h !== 'object') return undefined;
  const { profile, stage, version } = h as Record<string, unknown>;
  if (profile !== 'virtual' && profile !== 'spatial') return undefined;
  if (stage !== 'alpha' && stage !== 'beta') return undefined;
  if (typeof version !== 'string' || version.trim() === '') return undefined;
  return { profile, stage, version };
}
