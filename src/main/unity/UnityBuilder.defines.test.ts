import { describe, it, expect } from 'vitest';
import { UnityBuilder } from './UnityBuilder';

const asset = (defines: string) => `  webWasm2023: 0
  scriptingDefineSymbols:
    Android: ${defines}
  additionalCompilerArguments: {}
`;

describe('UnityBuilder.syncInferenceDefine', () => {
  it('adds the define when the project has models', () => {
    expect(UnityBuilder.syncInferenceDefine(asset('GLTFAST'), true)).toContain('    Android: GLTFAST;ARSIST_INFERENCE');
  });

  it('removes a stale define when the project has no models', () => {
    const out = UnityBuilder.syncInferenceDefine(asset('ARSIST_INFERENCE;GLTFAST;SENTIS_ANALYTICS_ENABLED'), false);
    expect(out).toContain('    Android: GLTFAST;SENTIS_ANALYTICS_ENABLED');
    expect(out).not.toContain('ARSIST_INFERENCE');
  });

  it('leaves the file alone when nothing changes', () => {
    const text = asset('GLTFAST;ARSIST_INFERENCE');
    expect(UnityBuilder.syncInferenceDefine(text, true)).toBe(text);
    expect(UnityBuilder.syncInferenceDefine(asset('GLTFAST'), false)).toBe(asset('GLTFAST'));
  });

  it('expands an empty map when the define is wanted', () => {
    const text = `  webWasm2023: 0\n  scriptingDefineSymbols: {}\n  additionalCompilerArguments: {}\n`;
    const out = UnityBuilder.syncInferenceDefine(text, true);
    expect(out).toContain('  scriptingDefineSymbols:\n    Android: ARSIST_INFERENCE\n');
    expect(UnityBuilder.syncInferenceDefine(text, false)).toBe(text);
  });
});

describe('UnityBuilder.simulationDefines', () => {
  it('copies the Android defines to Standalone without the device SDK ones', () => {
    const out = UnityBuilder.simulationDefines(asset('ARSIST_INFERENCE;ARSIST_META_QUEST;GLTFAST;XR_HANDS'));
    expect(out).toContain('    Android: ARSIST_INFERENCE;ARSIST_META_QUEST;GLTFAST;XR_HANDS');
    expect(out).toContain('    Standalone: ARSIST_INFERENCE;GLTFAST');
    // 2 回目は変わらない
    expect(UnityBuilder.simulationDefines(out)).toBe(out);
  });
});
