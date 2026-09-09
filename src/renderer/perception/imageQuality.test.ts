import { describe, it, expect } from 'vitest';
import { scoreReferenceImage } from './imageQuality';

const W = 128;
const H = 128;

function blank(value: number): Uint8Array {
  return new Uint8Array(W * H).fill(value);
}

/** 明るい背景に暗い正方形を散らした、凸コーナーの多い画像。 */
function busy(): Uint8Array {
  const gray = new Uint8Array(W * H).fill(230);
  for (let by = 3; by + 6 < H; by += 12) {
    for (let bx = 3; bx + 6 < W; bx += 12) {
      for (let y = by; y < by + 6; y++) {
        for (let x = bx; x < bx + 6; x++) gray[y * W + x] = 20;
      }
    }
  }
  return gray;
}

/** 上下で色が変わるだけの画像。エッジはあるがコーナーが無い。 */
function gradientEdge(): Uint8Array {
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) gray[y * W + x] = y < H / 2 ? 20 : 230;
  }
  return gray;
}

describe('scoreReferenceImage', () => {
  it('gives a flat image a score of zero', () => {
    const result = scoreReferenceImage(blank(128), W, H, 600, 600);
    expect(result.cornerCount).toBe(0);
    expect(result.score).toBe(0);
    expect(result.contrast).toBe(0);
  });

  it('scores a corner-rich image highly', () => {
    const result = scoreReferenceImage(busy(), W, H, 600, 600);
    expect(result.cornerCount).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(60);
    expect(result.reason).toBe('ok');
  });

  it('rejects an image that only has a straight edge', () => {
    // 直線エッジは FAST の 9 連続条件を満たさない → 追跡できない写真として低評価
    const result = scoreReferenceImage(gradientEdge(), W, H, 600, 600);
    expect(result.score).toBeLessThan(20);
  });

  it('penalises low contrast even when corners exist', () => {
    const source = busy();
    // 平均のまわりに圧縮してコントラストだけ落とす
    const lowContrast = new Uint8Array(source.length);
    for (let i = 0; i < source.length; i++) lowContrast[i] = 118 + Math.round((source[i] - 118) * 0.15);

    const strong = scoreReferenceImage(source, W, H, 600, 600);
    const weak = scoreReferenceImage(lowContrast, W, H, 600, 600);
    expect(weak.contrast).toBeLessThan(strong.contrast);
    expect(weak.score).toBeLessThan(strong.score);
  });

  it('handles images smaller than the sampling border', () => {
    expect(scoreReferenceImage(new Uint8Array(4), 2, 2)).toEqual({
      score: 0, cornerCount: 0, contrast: 0, width: 2, height: 2, reason: 'tooSmall',
    });
  });

  it('rejects a small photo however rich its pattern is', () => {
    // 48x48 のロゴを参照写真に指定して実機で 0 features になった件の回帰。
    // 縮小後の画素は同じ（＝コーナー密度は高い）でも、元が小さければ使えない。
    const result = scoreReferenceImage(busy(), W, H, 48, 48);
    expect(result.score).toBe(0);
    expect(result.reason).toBe('tooSmall');
    expect(result.width).toBe(48);
  });

  it('penalises a merely smallish photo without zeroing it', () => {
    const result = scoreReferenceImage(busy(), W, H, 320, 320);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(scoreReferenceImage(busy(), W, H, 600, 600).score);
  });

  it('reports the source resolution it judged', () => {
    const result = scoreReferenceImage(busy(), W, H, 1024, 768);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
  });
});
