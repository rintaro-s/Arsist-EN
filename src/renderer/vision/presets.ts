/**
 * 組み方のひな型。
 *
 * これは**エンジンの機能ではない**。ただの op の並びで、置いたあとは
 * 一手ずつ自由に足したり消したりできる。白紙から始めるのが一番つらいので、
 * よくある組み方を出発点として置いてあるだけ。
 */
import type { VisionPipeline } from '../../shared/types';
import { defaultParams } from './opCatalog';

export interface PipelinePreset {
  id: string;
  /** i18n キーの末尾。`vision.preset.<id>` / `vision.presetHint.<id>` */
  build: () => VisionPipeline;
}

const op = (
  id: string,
  opType: Parameters<typeof defaultParams>[0],
  out: string,
  input: string[] | undefined,
  params: Record<string, unknown> = {},
) => ({
  id,
  op: opType,
  out,
  in: input,
  params: { ...defaultParams(opType), ...params },
});

export const PIPELINE_PRESETS: PipelinePreset[] = [
  {
    // products/BlueSky と同じ組み方。エンジンに「空」という概念は無く、
    // 汎用の op を 13 個並べただけ。
    id: 'blueSky',
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
    id: 'countColour',
    build: () => ({
      id: 'count',
      name: 'Count coloured things',
      maxWidth: 480,
      ops: [
        op('pick', 'hsvRange', 'picked', ['source'],
          { hueMin: 340, hueMax: 20, satMin: 80, valMin: 80 }),
        op('clean', 'morphology', 'clean', ['picked'], { mode: 'open', radius: 1 }),
        op('fill', 'morphology', 'solid', ['clean'], { mode: 'close', radius: 2 }),
        op('count', 'blobs', 'items', ['solid'], { minArea: 60 }),
      ],
      outputs: [{ kind: 'store', value: 'items', storeAs: 'found' }],
    }),
  },
  {
    id: 'findShapes',
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
    build: () => ({
      id: 'colour',
      name: 'Measure the colour',
      maxWidth: 320,
      ops: [op('c', 'dominantColor', 'colour', ['source'])],
      outputs: [{ kind: 'store', value: 'colour', storeAs: 'colour' }],
    }),
  },
];
