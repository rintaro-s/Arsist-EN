import { describe, it, expect } from 'vitest';
import { estimateObjectExtents } from './objectExtents';
import type { SceneObject } from '../../shared/types';

function object(overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    id: 'o1',
    name: 'Object',
    type: 'primitive',
    primitiveType: 'cube',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ...overrides,
  } as SceneObject;
}

describe('estimateObjectExtents', () => {
  it('treats a unit cube as half a metre in each direction', () => {
    expect(estimateObjectExtents(object())).toEqual({ halfWidth: 0.5, halfHeight: 0.5, halfDepth: 0.5 });
  });

  it('scales with the object', () => {
    const scaled = object({
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 0.1, y: 0.2, z: 0.4 },
      },
    });
    expect(estimateObjectExtents(scaled)).toEqual({ halfWidth: 0.05, halfHeight: 0.1, halfDepth: 0.2 });
  });

  it('uses the canvas size in metres rather than the primitive box', () => {
    const canvas = object({
      type: 'canvas',
      canvasSettings: { layoutId: 'l', widthMeters: 1.2, heightMeters: 0.6, pixelsPerUnit: 1000 },
    });
    expect(estimateObjectExtents(canvas)).toEqual({ halfWidth: 0.6, halfHeight: 0.3, halfDepth: 0 });
  });

  it('gives a plane no depth, so "in front of it" does not push by a thickness it lacks', () => {
    const plane = object({ primitiveType: 'plane' });
    expect(estimateObjectExtents(plane).halfDepth).toBe(0);
    expect(estimateObjectExtents(plane).halfWidth).toBe(0.5);
  });

  it('never returns a negative extent for a mirrored scale', () => {
    const mirrored = object({
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: -2, y: 1, z: 1 },
      },
    });
    expect(estimateObjectExtents(mirrored).halfWidth).toBe(1);
  });
});
