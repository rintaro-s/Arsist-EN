import { describe, it, expect } from 'vitest';
import { shippedModels } from './UnityBridge';
import type { ArsistProject, ModelDefinition } from '../shared/types';

function model(id: string, extra: Partial<ModelDefinition> = {}): ModelDefinition {
  return { id, name: id, file: `Assets/Models/${id}.onnx`, format: 'onnx', use: 'text', ...extra };
}

describe('which models go into a build', () => {
  const project = (models: ModelDefinition[]) => ({ models } as unknown as ArsistProject);

  it('ships every imported model, because scripts call them by name', () => {
    expect(shippedModels(project([model('a'), model('b')])).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('leaves out models switched off for the build (they still work in the editor)', () => {
    expect(shippedModels(project([model('a'), model('b', { includeInBuild: false })])).map((m) => m.id)).toEqual(['a']);
  });

  it('skips broken entries', () => {
    expect(shippedModels(project([model('a', { file: '' }), model('b')])).map((m) => m.id)).toEqual(['b']);
  });
});
