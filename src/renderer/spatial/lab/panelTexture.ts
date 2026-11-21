/**
 * パネル・札の見た目を 2D の canvas に描いて、3D の板に貼る。
 * (3D の文字 (troika) は日本語のフォントを持たないので、ブラウザのフォントで描く)
 * 実機の UI とまったく同じではない。大きさ・並び・文字の量の確認用。
 */
import * as THREE from 'three';
import type { PanelItem, ThingVisual } from '../../../shared/layster/spatial/types';

const MAX_TEXTURE = 1024;
const FONT = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", Meiryo, system-ui, sans-serif';

/** '#RRGGBB' / '#RRGGBBAA' → CSS の色。読めなければ fallback。 */
export function cssColor(hex: string | undefined, fallback: string): string {
  if (!hex) return fallback;
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(3)})`;
}

interface Ctx {
  g: CanvasRenderingContext2D;
  scale: number;
  x: number;
  width: number;
}

function itemHeight(item: PanelItem): number {
  switch (item.type) {
    case 'text': return (item.size ?? 32) * 1.35;
    case 'button': return (item.size ?? 32) * 1.9;
    case 'input': return (item.size ?? 30) * 1.9;
    case 'image': return item.height;
    case 'space': return item.height;
    case 'row': return Math.max(0, ...item.items.map(itemHeight));
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawItem(c: Ctx, item: PanelItem, x: number, y: number, w: number) {
  const { g, scale } = c;
  const h = itemHeight(item);
  switch (item.type) {
    case 'text': {
      const size = item.size ?? 32;
      g.fillStyle = cssColor(item.color, '#ffffff');
      g.font = `${size * scale}px ${FONT}`;
      g.textBaseline = 'middle';
      g.textAlign = item.align ?? 'left';
      const tx = item.align === 'center' ? x + w / 2 : item.align === 'right' ? x + w : x;
      const text = item.bind && !item.text ? `{${item.bind}}` : item.text;
      g.fillText(text, tx * scale, (y + h / 2) * scale, w * scale);
      break;
    }
    case 'button': {
      const size = item.size ?? 32;
      g.fillStyle = cssColor(item.background, 'rgba(78, 201, 176, 0.9)');
      roundRect(g, x * scale, (y + h * 0.08) * scale, w * scale, h * 0.84 * scale, 12 * scale);
      g.fill();
      g.fillStyle = cssColor(item.color, '#10221e');
      g.font = `600 ${size * scale}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(item.text, (x + w / 2) * scale, (y + h / 2) * scale, w * scale);
      break;
    }
    case 'input': {
      const size = item.size ?? 30;
      g.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(g, x * scale, (y + h * 0.08) * scale, w * scale, h * 0.84 * scale, 8 * scale);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.font = `${size * scale}px ${FONT}`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(item.placeholder ?? item.bind, (x + size * 0.5) * scale, (y + h / 2) * scale, (w - size) * scale);
      break;
    }
    case 'image': {
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(x * scale, y * scale, w * scale, h * scale);
      g.strokeStyle = 'rgba(255,255,255,0.3)';
      g.strokeRect(x * scale, y * scale, w * scale, h * scale);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.font = `${22 * scale}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(item.file.split('/').pop() || 'image', (x + w / 2) * scale, (y + h / 2) * scale, w * scale);
      break;
    }
    case 'row': {
      const gap = item.gap ?? 16;
      const n = item.items.length || 1;
      const each = (w - gap * (n - 1)) / n;
      item.items.forEach((child, i) => drawItem(c, child, x + i * (each + gap), y, each));
      break;
    }
    case 'space':
      break;
  }
}

/** 見た目 → canvas。大きさは画素 (= 1 mm、ppm が既定のとき) で、長い辺が MAX_TEXTURE を超えないよう縮める。 */
export function drawVisual(visual: ThingVisual): HTMLCanvasElement | null {
  if (visual.kind !== 'panel' && visual.kind !== 'label') return null;
  const ppm = visual.kind === 'panel' ? (visual.ppm ?? 1000) : 1000;
  const label = visual.kind === 'label';
  const heightM = label ? (visual.height ?? 0.04) * 1.6 : visual.size[1];
  const widthM = label ? Math.max(visual.height ?? 0.04, visual.text.length * (visual.height ?? 0.04) * 0.6) + (visual.height ?? 0.04) : visual.size[0];
  const wPx = Math.max(8, widthM * ppm);
  const hPx = Math.max(8, heightM * ppm);
  const scale = Math.min(1, MAX_TEXTURE / Math.max(wPx, hPx));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(wPx * scale);
  canvas.height = Math.round(hPx * scale);
  const g = canvas.getContext('2d');
  if (!g) return canvas;

  if (label) {
    const px = (visual.height ?? 0.04) * ppm;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(g, 0, 0, canvas.width, canvas.height, canvas.height / 4);
    g.fill();
    g.fillStyle = cssColor(visual.color, '#ffffff');
    g.font = `600 ${px * scale}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(visual.text, canvas.width / 2, canvas.height / 2, canvas.width);
    return canvas;
  }

  g.fillStyle = cssColor(visual.background, 'rgba(30, 30, 40, 0.9)');
  roundRect(g, 0, 0, canvas.width, canvas.height, Math.min(canvas.width, canvas.height) * 0.04);
  g.fill();
  const pad = visual.padding ?? 24;
  const ctx: Ctx = { g, scale, x: pad, width: wPx - pad * 2 };
  let y = pad;
  for (const item of visual.items) {
    const h = itemHeight(item);
    if (y + h > hPx - pad + 1) {
      // はみ出す: 実機でも切れるので、赤い線で知らせる
      g.fillStyle = 'rgba(241, 76, 76, 0.9)';
      g.fillRect(0, (hPx - 4) * scale, canvas.width, 4 * scale);
      break;
    }
    drawItem(ctx, item, ctx.x, y, ctx.width);
    y += h + 8;
  }
  return canvas;
}

export function textureFor(visual: ThingVisual): THREE.CanvasTexture | null {
  const canvas = drawVisual(visual);
  if (!canvas) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
