/**
 * 組み方のひな型。
 *
 * これは**エンジンの機能ではない**。ただの op の並びで、置いたあとは
 * 一手ずつ自由に足したり消したりできる。白紙から始めるのが一番つらいので、
 * 実際に使う形を出発点として置いてあるだけ。
 */
import type { ImageModelDefinition, VisionOp, VisionOpType, VisionPipeline } from '../../shared/types';
import { defaultParams } from './opCatalog';

export interface PipelinePreset {
  id: string;
  /** i18n キーの末尾。`vision.preset.<id>` / `vision.presetHint.<id>` */
  build: () => VisionPipeline;
  /** 一覧に出す絵: 何が起きるか */
  picture: 'count' | 'motion' | 'sign' | 'paint' | 'shapes' | 'colour';
  /** 動画か連続した写真でしか確かめられない (track / motion / event を含む) */
  needsFrames?: boolean;
}

const op = (
  id: string,
  opType: VisionOpType,
  out: string,
  input: string[] | undefined,
  params: Record<string, unknown> = {},
): VisionOp => ({
  id,
  op: opType,
  out,
  in: input,
  params: { ...defaultParams(opType), ...params },
});

export const PIPELINE_PRESETS: PipelinePreset[] = [
  {
    // 棚の物を色で拾い、追跡して数え、それぞれに札を置く。
    // 「見つける → 追う → 数える → 現実に置く」の基本形。色で拾う部分をモデルに替えれば何でも数えられる。
    id: 'countAndLabel',
    picture: 'count',
    needsFrames: true,
    build: () => ({
      id: 'count',
      name: 'Count and label',
      maxWidth: 480,
      ops: [
        op('pick', 'hsvRange', 'picked', ['source'], { hueMin: 340, hueMax: 20, satMin: 90, valMin: 70 }),
        op('clean', 'morphology', 'clean', ['picked'], { mode: 'open', radius: 1 }),
        op('fill', 'morphology', 'solid', ['clean'], { mode: 'close', radius: 2 }),
        op('find', 'blobs', 'found', ['solid'], { minArea: 80, maxItems: 16 }),
        op('follow', 'track', 'tracked', ['found'], { maxDistance: 0.15, maxAge: 4, smooth: 0.5, minHits: 2 }),
        op('keep', 'select', 'items', ['tracked'], { stableOnly: true, sortBy: 'x' }),
        op('count', 'countItems', 'count', ['items']),
        op('changed', 'event', 'verdict', ['count'], { name: 'count.changed', value: 'count', op: 'gte', compare: 1, mode: 'onChange' }),
        op('boxes', 'boxMask', 'boxes', ['items'], { thickness: 3 }),
        op('draw', 'annotate', 'drawn', ['source', 'items'], { color: '#4A9BD1', thickness: 3 }),
      ],
      outputs: [
        { kind: 'anchor', value: 'items', distance: 1.5, label: 'id', maxItems: 16 },
        { kind: 'world', value: 'drawn', alpha: 'boxes' },
        { kind: 'store', value: 'verdict', storeAs: 'count' },
      ],
    }),
  },
  {
    // 動いた所を拾い、追い、動きが始まったらイベントを鳴らす。見張り・来客・スポーツ。
    id: 'motionAlarm',
    picture: 'motion',
    needsFrames: true,
    build: () => ({
      id: 'motion',
      name: 'Motion alarm',
      maxWidth: 320,
      ops: [
        op('gray', 'grayscale', 'gray', ['source']),
        op('soft', 'blur', 'soft', ['gray'], { passes: 2 }),
        op('moved', 'motion', 'moved', ['soft'], { threshold: 30 }),
        op('fill', 'morphology', 'solid', ['moved'], { mode: 'close', radius: 3 }),
        op('find', 'blobs', 'found', ['solid'], { minArea: 120, maxItems: 8 }),
        op('follow', 'track', 'tracked', ['found'], { maxDistance: 0.2, maxAge: 3, smooth: 0.6, minHits: 2, matchLabel: false }),
        op('count', 'countItems', 'count', ['tracked']),
        op('alarm', 'event', 'verdict', ['count'], { name: 'motion.started', value: 'count', op: 'gte', compare: 1, mode: 'onChange', cooldown: 2 }),
        op('boxes', 'boxMask', 'boxes', ['tracked'], { thickness: 3 }),
        op('draw', 'annotate', 'drawn', ['source', 'tracked'], { color: '#E2A33C', thickness: 3 }),
      ],
      outputs: [
        { kind: 'world', value: 'drawn', alpha: 'boxes' },
        { kind: 'store', value: 'verdict', storeAs: 'motion' },
      ],
    }),
  },
  {
    // 明るい四角 (看板・画面・紙) を見つけ、正対した画に起こす。文字読みや模様判定の前段。
    id: 'readSign',
    picture: 'sign',
    build: () => ({
      id: 'sign',
      name: 'Find and flatten a sign',
      maxWidth: 640,
      ops: [
        op('gray', 'grayscale', 'gray', ['source']),
        op('soft', 'blur', 'soft', ['gray'], { passes: 1 }),
        op('bright', 'threshold', 'bright', ['soft'], { mode: 'relativeMedian', ratio: 1.25, floor: 120, ceiling: 240 }),
        op('fill', 'morphology', 'solid', ['bright'], { mode: 'close', radius: 3 }),
        op('clean', 'morphology', 'clean', ['solid'], { mode: 'open', radius: 2 }),
        op('corners', 'quads', 'quads', ['clean'], { epsilonRatio: 0.04, minArea: 2000, maxItems: 2 }),
        op('flat', 'rectify', 'flat', ['source', 'quads'], { width: 400 }),
      ],
      outputs: [
        { kind: 'anchor', value: 'quads', distance: 2, label: 'none', maxItems: 1 },
        { kind: 'store', value: 'quads', storeAs: 'sign' },
      ],
    }),
  },
  {
    // products/BlueSky と同じ組み方。エンジンに「空」という概念は無く、汎用の op を 15 個並べただけ。
    id: 'blueSky',
    picture: 'paint',
    build: () => ({
      id: 'sky',
      name: 'Blue sky',
      maxWidth: 640,
      ops: [
        op('gray', 'grayscale', 'gray', undefined),
        op('soft', 'blur', 'soft', ['gray'], { passes: 1 }),
        op('edges', 'sobel', 'edges', ['soft']),
        op('horizon', 'edgeScan', 'horizon', ['edges'], { from: 'top', threshold: 22, smooth: 12 }),
        op('above', 'maskSide', 'above', ['horizon'], { from: 'top', keep: 'before' }),
        op('bright', 'threshold', 'bright', ['gray'],
          { mode: 'relativeMedian', within: 'above', ratio: 0.5, floor: 20, ceiling: 90 }),
        op('pale', 'hsvRange', 'pale', ['source'], { satMax: 140, valMin: 20 }),
        op('and1', 'maskCombine', 'candidate', ['above', 'bright'], { mode: 'and' }),
        op('and2', 'maskCombine', 'rough', ['candidate', 'pale'], { mode: 'and' }),
        op('fill', 'morphology', 'filled', ['rough'], { mode: 'close', radius: 2 }),
        op('clean', 'morphology', 'sky', ['filled'], { mode: 'open', radius: 1 }),
        op('stats', 'stats', 'skyStats', ['sky'], { against: 'edges' }),
        op('enough', 'gate', 'checked', ['skyStats'],
          { value: 'coverage', op: 'gte', compare: 0.02, reason: 'noSky' }),
        op('flat', 'gate', 'verdict', ['checked'],
          { value: 'mean', op: 'lte', compare: 8, orRelativeTo: 'meanOutside', orFactor: 0.6, reason: 'notFlat' }),
        op('paint', 'recolor', 'painted', ['source', 'sky'],
          { topColor: '#2060D2', bottomColor: '#9EC8F2', strength: 1, preserveLuminance: true }),
      ],
      outputs: [
        { kind: 'world', value: 'painted', alpha: 'sky' },
        { kind: 'store', value: 'verdict', storeAs: 'sky' },
      ],
    }),
  },
  {
    id: 'findShapes',
    picture: 'shapes',
    build: () => ({
      id: 'shapes',
      name: 'Find shapes',
      maxWidth: 480,
      ops: [
        op('gray', 'grayscale', 'gray', undefined),
        op('soft', 'blur', 'soft', ['gray']),
        op('bin', 'threshold', 'bin', ['soft'], { mode: 'otsu' }),
        op('clean', 'morphology', 'clean', ['bin'], { mode: 'open', radius: 1 }),
        op('shapes', 'contours', 'shapes', ['clean'], { minArea: 200 }),
      ],
      outputs: [{ kind: 'store', value: 'shapes', storeAs: 'shapes' }],
    }),
  },
  {
    id: 'measureColour',
    picture: 'colour',
    build: () => ({
      id: 'colour',
      name: 'Measure the colour',
      maxWidth: 320,
      ops: [op('c', 'dominantColor', 'colour', ['source'])],
      outputs: [{ kind: 'store', value: 'colour', storeAs: 'colour' }],
    }),
  },
];

/**
 * 学習済みモデルから、そのまま動くパイプラインを組む。
 *
 * モデルの task に合わせて出しどころまで決める:
 *   classify → 「何が写っているか」を落ち着かせて値として保存
 *   detect   → 追跡して数え、それぞれに札を置き、枠を現実に重ねる
 *   segment  → 見つけた領域を塗って現実に重ねる (+ 面積を保存)
 *   raw      → 生の値を保存
 * `infer` も普通の一手なので、置いたあとで前後に他の一手を足せる。
 */
export function buildModelPipeline(model: ImageModelDefinition): VisionPipeline {
  // モデルの入力より少し大きめに縮めておくと、切り出しの分の余裕が残る
  const maxWidth = Math.max(224, Math.min(960, Math.round(model.input.width * 1.5)));

  if (model.task === 'segment') {
    return {
      id: 'model',
      name: model.name,
      maxWidth,
      ops: [
        op('ai', 'infer', 'region', ['source'], { model: model.id }),
        op('clean', 'morphology', 'clean', ['region'], { mode: 'open', radius: 2 }),
        op('paint', 'recolor', 'painted', ['source', 'clean'], { topColor: '#20D060', bottomColor: '#20D060', strength: 0.8, preserveLuminance: true }),
        op('measure', 'stats', 'area', ['clean']),
      ],
      outputs: [
        { kind: 'world', value: 'painted', alpha: 'clean' },
        { kind: 'store', value: 'area', storeAs: 'area' },
      ],
    };
  }

  if (model.task === 'detect') {
    return {
      id: 'model',
      name: model.name,
      maxWidth,
      ops: [
        op('ai', 'infer', 'found', ['source'], { model: model.id }),
        op('follow', 'track', 'tracked', ['found'], { maxDistance: 0.15, maxAge: 4, smooth: 0.5, minHits: 2 }),
        op('keep', 'select', 'items', ['tracked'], { minScore: 0.4, stableOnly: true, sortBy: 'score' }),
        op('count', 'countItems', 'count', ['items']),
        op('boxes', 'boxMask', 'boxes', ['items'], { thickness: 3 }),
        op('draw', 'annotate', 'drawn', ['source', 'items'], { color: '#4A9BD1', thickness: 3 }),
      ],
      outputs: [
        { kind: 'anchor', value: 'items', distance: 2, label: 'labelScore', maxItems: 8 },
        { kind: 'world', value: 'drawn', alpha: 'boxes' },
        { kind: 'store', value: 'count', storeAs: 'found' },
      ],
    };
  }

  if (model.task === 'classify') {
    return {
      id: 'model',
      name: model.name,
      maxWidth,
      ops: [
        op('ai', 'infer', 'guess', ['source'], { model: model.id }),
        op('calm', 'stabilize', 'result', ['guess'], { alpha: 0.4, window: 5 }),
      ],
      outputs: [{ kind: 'store', value: 'result', storeAs: 'result' }],
    };
  }

  return {
    id: 'model',
    name: model.name,
    maxWidth,
    ops: [op('ai', 'infer', 'result', ['source'], { model: model.id })],
    outputs: [{ kind: 'store', value: 'result', storeAs: 'result' }],
  };
}
