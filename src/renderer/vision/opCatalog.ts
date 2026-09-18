/**
 * 画像処理 op のカタログ。
 *
 * ここがエディタと Unity ランタイムの契約。型と既定値をひとつ所に置いてあるので、
 * 新しい op を足すときは、ここと `VisionOps.Signatures` の両方を直せばよい。
 * 片方だけ直すと、エディタでは繋げるのにビルドで落ちる（あるいはその逆）になる。
 */
import type { VisionOpType } from '../../shared/types';

/** op を流れる値の型。噛み合わない結線を弾くためにある。 */
export type VisionValueKind =
  | 'color'
  | 'gray'
  | 'mask'
  | 'edges'
  | 'boundary'
  | 'blobs'
  | 'contours'
  | 'record';

export interface OpParam {
  key: string;
  /** UI の種類 */
  kind: 'number' | 'text' | 'bool' | 'choice' | 'color' | 'valueRef';
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  choices?: string[];
  /** i18n キーの末尾。`vision.param.<i18n>` を引く */
  i18n: string;
}

export interface OpDefinition {
  op: VisionOpType;
  inputs: VisionValueKind[];
  output: VisionValueKind;
  /** 道具箱でのまとまり */
  group: 'convert' | 'find' | 'shape' | 'measure' | 'draw';
  params: OpParam[];
}

/** 値の型ごとの色。結線が合っているかを一目で分かるようにする。 */
export const KIND_COLORS: Record<VisionValueKind, string> = {
  color: '#E2A33C',
  gray: '#9AA4B2',
  mask: '#4CAF88',
  edges: '#8E7CC3',
  boundary: '#D07C9E',
  blobs: '#4A9BD1',
  contours: '#5FB3B3',
  record: '#C77D4A',
};

export const OP_CATALOG: OpDefinition[] = [
  {
    op: 'grayscale', inputs: ['color'], output: 'gray', group: 'convert', params: [],
  },
  {
    op: 'blur', inputs: ['gray'], output: 'gray', group: 'convert',
    params: [{ key: 'passes', kind: 'number', default: 1, min: 1, max: 8, step: 1, i18n: 'passes' }],
  },
  {
    op: 'sobel', inputs: ['gray'], output: 'edges', group: 'find', params: [],
  },
  {
    op: 'canny', inputs: ['gray'], output: 'mask', group: 'find',
    params: [
      { key: 'low', kind: 'number', default: 40, min: 0, max: 255, step: 1, i18n: 'low' },
      { key: 'high', kind: 'number', default: 90, min: 0, max: 255, step: 1, i18n: 'high' },
    ],
  },
  {
    op: 'edgeScan', inputs: ['edges'], output: 'boundary', group: 'find',
    params: [
      { key: 'from', kind: 'choice', default: 'top', choices: ['top', 'bottom', 'left', 'right'], i18n: 'from' },
      { key: 'threshold', kind: 'number', default: 22, min: 1, max: 255, step: 1, i18n: 'threshold' },
      { key: 'smooth', kind: 'number', default: 12, min: 0, max: 64, step: 1, i18n: 'smooth' },
      { key: 'limit', kind: 'number', default: 0.95, min: 0.05, max: 1, step: 0.05, i18n: 'limit' },
    ],
  },
  {
    op: 'maskSide', inputs: ['boundary'], output: 'mask', group: 'find',
    params: [
      { key: 'from', kind: 'choice', default: 'top', choices: ['top', 'bottom', 'left', 'right'], i18n: 'from' },
      { key: 'keep', kind: 'choice', default: 'before', choices: ['before', 'after'], i18n: 'keep' },
    ],
  },
  {
    op: 'hsvRange', inputs: ['color'], output: 'mask', group: 'find',
    params: [
      { key: 'hueMin', kind: 'number', default: 0, min: 0, max: 359, step: 1, i18n: 'hueMin' },
      { key: 'hueMax', kind: 'number', default: 359, min: 0, max: 359, step: 1, i18n: 'hueMax' },
      { key: 'satMin', kind: 'number', default: 0, min: 0, max: 255, step: 1, i18n: 'satMin' },
      { key: 'satMax', kind: 'number', default: 255, min: 0, max: 255, step: 1, i18n: 'satMax' },
      { key: 'valMin', kind: 'number', default: 0, min: 0, max: 255, step: 1, i18n: 'valMin' },
      { key: 'valMax', kind: 'number', default: 255, min: 0, max: 255, step: 1, i18n: 'valMax' },
    ],
  },
  {
    op: 'threshold', inputs: ['gray'], output: 'mask', group: 'find',
    params: [
      { key: 'mode', kind: 'choice', default: 'otsu', choices: ['otsu', 'fixed', 'relativeMedian'], i18n: 'mode' },
      { key: 'value', kind: 'number', default: 128, min: 0, max: 255, step: 1, i18n: 'value' },
      { key: 'within', kind: 'valueRef', default: '', i18n: 'within' },
      { key: 'ratio', kind: 'number', default: 0.5, min: 0.05, max: 2, step: 0.05, i18n: 'ratio' },
      { key: 'floor', kind: 'number', default: 0, min: 0, max: 255, step: 1, i18n: 'floor' },
      { key: 'ceiling', kind: 'number', default: 255, min: 0, max: 255, step: 1, i18n: 'ceiling' },
      { key: 'invert', kind: 'bool', default: false, i18n: 'invert' },
    ],
  },
  {
    op: 'morphology', inputs: ['mask'], output: 'mask', group: 'shape',
    params: [
      { key: 'mode', kind: 'choice', default: 'open', choices: ['open', 'close', 'erode', 'dilate'], i18n: 'mode' },
      { key: 'radius', kind: 'number', default: 1, min: 1, max: 32, step: 1, i18n: 'radius' },
    ],
  },
  {
    op: 'maskCombine', inputs: ['mask', 'mask'], output: 'mask', group: 'shape',
    params: [
      { key: 'mode', kind: 'choice', default: 'and', choices: ['and', 'or', 'xor', 'subtract', 'not'], i18n: 'mode' },
    ],
  },
  {
    op: 'largestBlob', inputs: ['mask'], output: 'mask', group: 'shape',
    params: [{ key: 'minArea', kind: 'number', default: 1, min: 1, max: 100000, step: 10, i18n: 'minArea' }],
  },
  {
    op: 'blobs', inputs: ['mask'], output: 'blobs', group: 'measure',
    params: [
      { key: 'minArea', kind: 'number', default: 60, min: 1, max: 100000, step: 10, i18n: 'minArea' },
      { key: 'maxItems', kind: 'number', default: 8, min: 1, max: 64, step: 1, i18n: 'maxItems' },
    ],
  },
  {
    op: 'contours', inputs: ['mask'], output: 'contours', group: 'measure',
    params: [
      { key: 'minArea', kind: 'number', default: 60, min: 1, max: 100000, step: 10, i18n: 'minArea' },
      { key: 'maxItems', kind: 'number', default: 8, min: 1, max: 64, step: 1, i18n: 'maxItems' },
      { key: 'epsilonRatio', kind: 'number', default: 0.02, min: 0.005, max: 0.2, step: 0.005, i18n: 'epsilonRatio' },
    ],
  },
  {
    op: 'stats', inputs: ['mask'], output: 'record', group: 'measure',
    params: [{ key: 'against', kind: 'valueRef', default: '', i18n: 'against' }],
  },
  {
    op: 'gate', inputs: ['record'], output: 'record', group: 'measure',
    params: [
      { key: 'value', kind: 'text', default: 'coverage', i18n: 'gateValue' },
      { key: 'op', kind: 'choice', default: 'gte', choices: ['gte', 'gt', 'lte', 'lt', 'eq'], i18n: 'gateOp' },
      { key: 'compare', kind: 'number', default: 0.02, min: -100000, max: 100000, step: 0.01, i18n: 'compare' },
      { key: 'relativeTo', kind: 'text', default: '', i18n: 'relativeTo' },
      { key: 'factor', kind: 'number', default: 1, min: 0, max: 100, step: 0.05, i18n: 'factor' },
      { key: 'orRelativeTo', kind: 'text', default: '', i18n: 'orRelativeTo' },
      { key: 'orFactor', kind: 'number', default: 0.6, min: 0, max: 100, step: 0.05, i18n: 'orFactor' },
      { key: 'reason', kind: 'text', default: 'notFound', i18n: 'reason' },
    ],
  },
  {
    op: 'recolor', inputs: ['color', 'mask'], output: 'color', group: 'draw',
    params: [
      { key: 'topColor', kind: 'color', default: '#2060D2', i18n: 'topColor' },
      { key: 'bottomColor', kind: 'color', default: '#9EC8F2', i18n: 'bottomColor' },
      { key: 'strength', kind: 'number', default: 1, min: 0, max: 1, step: 0.05, i18n: 'strength' },
      { key: 'preserveLuminance', kind: 'bool', default: true, i18n: 'preserveLuminance' },
    ],
  },
  {
    op: 'dominantColor', inputs: ['color'], output: 'record', group: 'measure',
    params: [
      { key: 'minSaturation', kind: 'number', default: 40, min: 0, max: 255, step: 1, i18n: 'minSaturation' },
      { key: 'minValue', kind: 'number', default: 30, min: 0, max: 255, step: 1, i18n: 'minValue' },
    ],
  },
  {
    op: 'templateMatch', inputs: ['gray'], output: 'record', group: 'find',
    params: [
      { key: 'template', kind: 'text', default: '', i18n: 'template' },
      { key: 'minScore', kind: 'number', default: 0.7, min: 0, max: 1, step: 0.05, i18n: 'minScore' },
      { key: 'step', kind: 'number', default: 1, min: 1, max: 8, step: 1, i18n: 'step' },
    ],
  },
];

export const OP_BY_NAME = new Map(OP_CATALOG.map((d) => [d.op, d]));

/** パイプラインの入口。常に色の画。 */
export const SOURCE_NAME = 'source';

export function defaultParams(op: VisionOpType): Record<string, unknown> {
  const definition = OP_BY_NAME.get(op);
  if (!definition) return {};
  const params: Record<string, unknown> = {};
  for (const param of definition.params) params[param.key] = param.default;
  return params;
}
