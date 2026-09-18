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
