import { describe, it, expect } from 'vitest';
import { ENGINE_FEATURES, projectFeatureTags, unsupportedFeatures } from './engineFeatures';
import { isValidTag, validateTagQuery } from './tags';
import type { ArsistProject } from './types';

function project(overrides: Partial<ArsistProject> = {}): ArsistProject {
  return {
    id: 'p', name: 'P', version: '1.0.0', createdAt: '', updatedAt: '',
    appType: '3d_ar_scene', targetDevice: 'Meta_Quest',
    arSettings: { trackingMode: '6dof', presentationMode: 'world_anchored', worldScale: 1, defaultDepth: 2 } as any,
    designSystem: {} as any,
    dataFlow: { dataSources: [], transforms: [] } as any,
    scenes: [{ id: 's', name: 'S', objects: [] } as any],
    uiLayouts: [],
    buildSettings: {} as any,
    ...overrides,
  };
}

describe('engine features', () => {
  it('every feature has a unique id and a well-formed requirement', () => {
    const ids = ENGINE_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of ENGINE_FEATURES) {
      expect(isValidTag(`feature:${f.id}`)).toBe(true);
      expect(validateTagQuery(f.requires, f.id)).toEqual([]);
    }
  });

  it('detects what a project uses', () => {
    const p = project({
      scripts: [{ id: 'a', enabled: true } as any],
      scenes: [{ id: 's', name: 'S', objects: [{ id: 'c', type: 'canvas' } as any] } as any],
      uiLayouts: [{ id: 'l', name: 'L', scope: 'canvas', resolution: { width: 1, height: 1 },
        root: { id: 'r', type: 'Panel', children: [{ id: 'i', type: 'Input', children: [] }] } } as any],
    });
    const tags = projectFeatureTags(p);
    expect(tags).toEqual(expect.arrayContaining(['feature:scripting', 'feature:ui-canvas', 'feature:text-input', 'feature:passthrough']));
    expect(tags).not.toContain('feature:vrm');
  });

  it('warns only for what a device really cannot do', () => {
    const p = project({ arSettings: { ...project().arSettings, interaction: { controllerRay: true, handTracking: true } } as any });
    const xreal = ['device:xreal-one', 'cap:optical-see-through', 'cap:camera-access'];
    expect(unsupportedFeatures(p, xreal).map((i) => i.feature)).toEqual(['feature:hand-tracking']);
    // 透過は光学シースルーでも満たす。ハンドトラッキングのある端末なら何も出ない
    const quest = ['device:meta-quest', 'cap:hand-tracking', 'cap:passthrough'];
    expect(unsupportedFeatures(p, quest)).toEqual([]);
  });

  it('does not throw on a half-written project', () => {
    expect(() => projectFeatureTags({ scenes: [null] } as any)).not.toThrow();
  });
});
