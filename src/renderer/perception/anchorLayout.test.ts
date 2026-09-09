import { describe, it, expect } from 'vitest';
import { anchorPlacement, resolvePhysicalHeight } from './anchorLayout';

describe('anchorPlacement', () => {
  it('puts a single anchor straight ahead of the user', () => {
    const placement = anchorPlacement(0, 1);
    expect(placement.position[0]).toBe(0);
    expect(placement.position[2]).toBeGreaterThan(0); // +Z = ユーザーの前方
    expect(placement.rotationY).toBeCloseTo(Math.PI);
  });

  it('spreads multiple anchors symmetrically', () => {
    const [a, b] = [anchorPlacement(0, 2), anchorPlacement(1, 2)];
    expect(a.position[0]).toBeCloseTo(-b.position[0]);
    expect(a.position[0]).not.toBe(b.position[0]);
  });

  it('keeps every anchor at the same depth and facing the user', () => {
    for (let i = 0; i < 4; i++) {
      const placement = anchorPlacement(i, 4);
      expect(placement.position[1]).toBe(0);
      expect(placement.position[2]).toBe(anchorPlacement(0, 4).position[2]);
      expect(placement.rotationY).toBeCloseTo(Math.PI);
    }
  });
});

describe('resolvePhysicalHeight', () => {
  it('uses the explicit height when given', () => {
    expect(resolvePhysicalHeight(0.3, 0.2, 2)).toBe(0.2);
  });

  it('derives height from the photo aspect ratio', () => {
    // 幅30cm・アスペクト比 3:2 の写真 → 高さ 20cm
    expect(resolvePhysicalHeight(0.3, undefined, 1.5)).toBeCloseTo(0.2);
  });

  it('falls back to a square while the photo has not loaded', () => {
    expect(resolvePhysicalHeight(0.3, undefined, null)).toBe(0.3);
  });

  it('ignores a zero or negative explicit height', () => {
    expect(resolvePhysicalHeight(0.4, 0, 2)).toBeCloseTo(0.2);
  });
});
