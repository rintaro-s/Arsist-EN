/**
 * エディタ側の結線チェック。
 *
 * これは C# の VisionPipelineRunner.Validate と同じ判定を二重に持っている。
 * 同じ間違いを同じように弾くことを、tools/perception-check の PipelineChecks と
 * 対になるケースで確かめる。片方だけ直すと、ここかあちらのどちらかが落ちる。
 */
import { describe, expect, it } from 'vitest';
import type { VisionPipeline } from '../../shared/types';
import { inferTypes, validatePipeline } from './validate';
import { PIPELINE_PRESETS } from './presets';

const base = (ops: VisionPipeline['ops'], outputs: VisionPipeline['outputs'] = []): VisionPipeline => ({
  id: 'p', name: 'p', ops, outputs,
});

describe('validatePipeline', () => {
  it('accepts every built-in template as-is', () => {
    for (const preset of PIPELINE_PRESETS) {
      expect(validatePipeline(preset.build()), preset.id).toEqual([]);
    }
  });

  it('catches a type mismatch (a colour image into a mask step)', () => {
    const problems = validatePipeline(base(
      [{ id: 'm', op: 'morphology', out: 'm', in: ['source'] }],
      [{ kind: 'store', value: 'm', storeAs: 'x' }],
    ));
    expect(problems.some((p) => p.message.startsWith('wrongType'))).toBe(true);
  });

  it('catches reading a name nothing produces', () => {
    const problems = validatePipeline(base(
      [{ id: 'g', op: 'grayscale', out: 'g', in: ['nope'] }],
      [{ kind: 'store', value: 'g', storeAs: 'x' }],
    ));
    expect(problems.some((p) => p.message === 'unknownInput:nope')).toBe(true);
  });

  it('catches an unknown step', () => {
    const problems = validatePipeline(base(
      [{ id: 'x', op: 'teleport' as never, out: 'x' }],
      [{ kind: 'store', value: 'x', storeAs: 'x' }],
    ));
    expect(problems.some((p) => p.message.startsWith('unknownOp'))).toBe(true);
  });

  it('catches a non-mask alpha on a drawn output', () => {
    const problems = validatePipeline(base(
      [{ id: 'g', op: 'grayscale', out: 'g' }],
      [{ kind: 'world', value: 'source', alpha: 'g' }],
    ));
    expect(problems.some((p) => p.message.startsWith('outputAlphaNotMask'))).toBe(true);
  });

  it('refuses to draw something that is not a colour image', () => {
    const problems = validatePipeline(base(
      [{ id: 'g', op: 'grayscale', out: 'g' }],
      [{ kind: 'world', value: 'g' }],
    ));
    expect(problems.some((p) => p.message.startsWith('outputNotDrawable'))).toBe(true);
  });

  it('catches a store output without a key', () => {
    const problems = validatePipeline(base(
      [{ id: 'g', op: 'grayscale', out: 'g' }],
      [{ kind: 'store', value: 'g', storeAs: '' }],
    ));
    expect(problems.some((p) => p.message.startsWith('outputNoKey'))).toBe(true);
  });

  it('warns when a pipeline has no outputs, since nobody would hear the result', () => {
    const problems = validatePipeline(base([{ id: 'g', op: 'grayscale', out: 'g' }]));
    expect(problems.some((p) => p.message === 'noOutputs')).toBe(true);
  });

  it('catches the same output name used twice', () => {
    const problems = validatePipeline(base(
      [
        { id: 'a', op: 'grayscale', out: 'g' },
        { id: 'b', op: 'blur', out: 'g', in: ['g'] },
      ],
      [{ kind: 'store', value: 'g', storeAs: 'x' }],
    ));
    expect(problems.some((p) => p.message === 'duplicateName:g')).toBe(true);
  });

  it('defaults a missing input to the previous step', () => {
    const problems = validatePipeline(base(
      [
        { id: 'a', op: 'grayscale', out: 'g' },
        { id: 'b', op: 'blur', out: 'b' },
      ],
      [{ kind: 'store', value: 'b', storeAs: 'x' }],
    ));
    expect(problems).toEqual([]);
  });
});

describe('inferTypes', () => {
  it('knows what each name is, so the editor only offers inputs that fit', () => {
    const types = inferTypes(PIPELINE_PRESETS.find((p) => p.id === 'blueSky')!.build());
    expect(types.get('source')).toBe('color');
    expect(types.get('edges')).toBe('edges');
    expect(types.get('horizon')).toBe('boundary');
    expect(types.get('sky')).toBe('mask');
    expect(types.get('verdict')).toBe('record');
    expect(types.get('painted')).toBe('color');
  });
});

describe('infer (model) steps', () => {
  const model = (task: 'classify' | 'detect' | 'segment'): import('../../shared/types').ModelDefinition => ({
    id: 'm1', name: 'm', file: 'Assets/Models/m.onnx', format: 'onnx', use: 'image', task,
    input: { width: 224, height: 224, layout: 'NCHW', channels: 3, colorOrder: 'RGB', scale: 1 / 255, mean: [0, 0, 0], std: [1, 1, 1], resize: 'stretch' },
    output: {},
  });
  const withInfer = (params: Record<string, unknown>, rest: import('../../shared/types').VisionOp[] = []): import('../../shared/types').VisionPipeline => ({
    id: 'p', name: 'p',
    ops: [{ id: 'ai', op: 'infer', out: 'found', in: ['source'], params }, ...rest],
    outputs: [{ kind: 'store', value: 'found', storeAs: 'found' }],
  });

  it('takes its output type from the model task', () => {
    expect(inferTypes(withInfer({ model: 'm1' }), [model('classify')]).get('found')).toBe('record');
    expect(inferTypes(withInfer({ model: 'm1' }), [model('detect')]).get('found')).toBe('blobs');
    expect(inferTypes(withInfer({ model: 'm1' }), [model('segment')]).get('found')).toBe('mask');
  });

  it('lets a segmentation mask feed recolor directly', () => {
    const pipeline = withInfer({ model: 'm1' }, [
      { id: 'paint', op: 'recolor', out: 'painted', in: ['source', 'found'], params: {} },
    ]);
    pipeline.outputs = [{ kind: 'world', value: 'painted', alpha: 'found' }];
    expect(validatePipeline(pipeline, [model('segment')])).toEqual([]);
    expect(validatePipeline(pipeline, [model('classify')]).some((p) => p.message.startsWith('wrongType'))).toBe(true);
  });

  it('reports a missing or unset model once, without a cascade', () => {
    expect(validatePipeline(withInfer({}), [model('classify')])).toEqual([{ opId: 'ai', message: 'modelNotSet' }]);
    expect(validatePipeline(withInfer({ model: 'gone' }), [model('classify')])).toEqual([{ opId: 'ai', message: 'modelMissing:gone' }]);
  });

  it('refuses a text model in an image step, by name', () => {
    const llm = { ...model('classify'), use: 'text' as const, name: 'Chat' };
    expect(validatePipeline(withInfer({ model: 'm1' }), [llm])).toEqual([{ opId: 'ai', message: 'modelNotImage:Chat' }]);
  });
});

describe('bypass and anchor outputs', () => {
  const base = (): import('../../shared/types').VisionPipeline => ({
    id: 'p', name: 'p',
    ops: [
      { id: 'g', op: 'grayscale', out: 'gray', in: ['source'], params: {} },
      { id: 'b', op: 'blur', out: 'soft', in: ['gray'], params: {}, disabled: true },
      { id: 't', op: 'threshold', out: 'bin', in: ['soft'], params: {} },
      { id: 'bl', op: 'blobs', out: 'found', in: ['bin'], params: {} },
      { id: 'tr', op: 'track', out: 'tracked', in: ['found'], params: {} },
    ],
    outputs: [{ kind: 'anchor', value: 'tracked', label: 'id', distance: 1.5 }],
  });

  it('a disabled same-type step passes its input through', () => {
    const p = base();
    expect(validatePipeline(p)).toEqual([]);
    expect(inferTypes(p).get('soft')).toBe('gray');
  });

  it('a disabled type-changing step is reported', () => {
    const p = base();
    p.ops[0].disabled = true; // grayscale: color → gray は外せない
    expect(validatePipeline(p).some((x) => x.opId === 'g' && x.message === 'cannotBypass')).toBe(true);
  });

  it('anchor outputs need a list of found things', () => {
    const p = base();
    p.outputs = [{ kind: 'anchor', value: 'bin' }];
    expect(validatePipeline(p).some((x) => x.message.startsWith('outputNotAnchorable'))).toBe(true);
  });
});
