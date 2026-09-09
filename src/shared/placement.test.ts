import { describe, it, expect } from 'vitest';
import { resolvePlacement, regionToBase, sideDirection, defaultPlacement } from './placement';
import type { AnchorPlacement } from './types';

/** 30cm x 20cm のターゲット全体 */
const TARGET = regionToBase(0.3, 0.2);
/** 10cm x 6cm x 2cm のオブジェクト */
const OBJECT = { halfWidth: 0.05, halfHeight: 0.03, halfDepth: 0.01 };

function placement(overrides: Partial<AnchorPlacement> = {}): AnchorPlacement {
  return { side: 'right', gap: 0, align: 'center', cross: 'center', facing: 'target', ...overrides };
}

describe('sideDirection', () => {
  it('maps every side to a unit axis, with center as zero', () => {
    expect(sideDirection('right')).toEqual({ x: 1, y: 0, z: 0 });
    expect(sideDirection('left')).toEqual({ x: -1, y: 0, z: 0 });
    expect(sideDirection('above')).toEqual({ x: 0, y: 1, z: 0 });
    expect(sideDirection('below')).toEqual({ x: 0, y: -1, z: 0 });
    // +Z は面から手前（見る側）
    expect(sideDirection('front')).toEqual({ x: 0, y: 0, z: 1 });
    expect(sideDirection('behind')).toEqual({ x: 0, y: 0, z: -1 });
    expect(sideDirection('center')).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('regionToBase', () => {
  it('turns the whole target into a centred rectangle', () => {
    expect(TARGET).toEqual({ centerX: 0, centerY: 0, halfWidth: 0.15, halfHeight: 0.1 });
  });

  it('places a region using its normalised rect, origin at the photo bottom-left', () => {
    // 写真の右上 1/4
    const base = regionToBase(0.3, 0.2, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    expect(base.centerX).toBeCloseTo(0.075);   // (0.75 - 0.5) * 0.3
    expect(base.centerY).toBeCloseTo(0.05);    // (0.75 - 0.5) * 0.2
    expect(base.halfWidth).toBeCloseTo(0.075);
    expect(base.halfHeight).toBeCloseTo(0.05);
  });

  it('puts a centred region back at the origin', () => {
    const base = regionToBase(0.3, 0.2, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(base.centerX).toBeCloseTo(0);
    expect(base.centerY).toBeCloseTo(0);
  });
});

describe('resolvePlacement', () => {
  it('center ignores gap entirely', () => {
    const at = resolvePlacement(placement({ side: 'center', gap: 0.5 }), TARGET, OBJECT);
    expect(at).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('"to the right, 10cm" clears the target edge', () => {
    // 中心合わせ: 半幅 0.15 + 隙間 0.10 = 0.25
    const at = resolvePlacement(placement({ side: 'right', gap: 0.1 }), TARGET, OBJECT);
    expect(at.x).toBeCloseTo(0.25);
    expect(at.y).toBeCloseTo(0);
    expect(at.z).toBeCloseTo(0);
  });

  it("align 'near' also clears the object's own half size", () => {
    // 0.15 + 0.10 + 自分の半幅 0.05 = 0.30 → 縁と縁の間がちょうど 10cm 空く
    const at = resolvePlacement(placement({ side: 'right', gap: 0.1, align: 'near' }), TARGET, OBJECT);
    expect(at.x).toBeCloseTo(0.30);
  });

  it('is symmetric between left and right', () => {
    const right = resolvePlacement(placement({ side: 'right', gap: 0.07 }), TARGET, OBJECT);
    const left = resolvePlacement(placement({ side: 'left', gap: 0.07 }), TARGET, OBJECT);
    expect(left.x).toBeCloseTo(-right.x);
  });

  it('above / below use the target height, not its width', () => {
    const above = resolvePlacement(placement({ side: 'above', gap: 0.02 }), TARGET, OBJECT);
    expect(above.y).toBeCloseTo(0.12);   // 半高さ 0.1 + 0.02
    expect(above.x).toBeCloseTo(0);
  });

  it('front measures from the surface, which has no thickness', () => {
    const front = resolvePlacement(placement({ side: 'front', gap: 0.1 }), TARGET, OBJECT);
    expect(front.z).toBeCloseTo(0.1);
    // 'near' のときだけ自分の奥行きぶん足される
    const near = resolvePlacement(placement({ side: 'front', gap: 0.1, align: 'near' }), TARGET, OBJECT);
    expect(near.z).toBeCloseTo(0.11);
  });

  it('behind is front mirrored', () => {
    const behind = resolvePlacement(placement({ side: 'behind', gap: 0.1 }), TARGET, OBJECT);
    expect(behind.z).toBeCloseTo(-0.1);
  });

  it("cross 'start' bottom-aligns when placed to the side", () => {
    const at = resolvePlacement(placement({ side: 'right', cross: 'start' }), TARGET, OBJECT);
    // 自分の下端が基準の下端に揃う: -(0.1 - 0.03)
    expect(at.y).toBeCloseTo(-0.07);
  });

  it("cross 'end' top-aligns when placed to the side", () => {
    const at = resolvePlacement(placement({ side: 'right', cross: 'end' }), TARGET, OBJECT);
    expect(at.y).toBeCloseTo(0.07);
  });

  it("cross applies along X when placed above", () => {
    const at = resolvePlacement(placement({ side: 'above', cross: 'start' }), TARGET, OBJECT);
    expect(at.x).toBeCloseTo(-0.10);   // -(0.15 - 0.05)
    expect(at.y).toBeCloseTo(0.1);
  });

  it('cross does nothing for front / behind / center', () => {
    for (const side of ['front', 'behind', 'center'] as const) {
      const at = resolvePlacement(placement({ side, cross: 'start' }), TARGET, OBJECT);
      expect(at.x).toBeCloseTo(0);
      expect(at.y).toBeCloseTo(0);
    }
  });

  it('offsets from the region centre when a region is used', () => {
    const region = regionToBase(0.3, 0.2, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    const at = resolvePlacement(placement({ side: 'right', gap: 0.01 }), region, OBJECT);
    expect(at.x).toBeCloseTo(0.075 + 0.075 + 0.01);
    expect(at.y).toBeCloseTo(0.05);
  });

  it('works with an unknown object size (model not loaded yet)', () => {
    const at = resolvePlacement(placement({ side: 'right', gap: 0.1, align: 'near' }), TARGET);
    expect(at.x).toBeCloseTo(0.25);   // 自分の大きさが 0 として扱われる
  });

  it('treats a non-finite gap as zero rather than producing NaN', () => {
    const at = resolvePlacement(placement({ side: 'right', gap: NaN }), TARGET, OBJECT);
    expect(at.x).toBeCloseTo(0.15);
  });

  it('has a sensible default for a freshly pinned object', () => {
    const d = defaultPlacement();
    expect(d.side).toBe('right');
    expect(d.facing).toBe('user');
    expect(d.align).toBe('near');
  });
});
