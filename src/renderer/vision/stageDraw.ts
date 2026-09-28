/**
 * ステージ (大きな表示) と絵コンテの描き方。
 *
 * 一手の結果は「元の画に重ねる」と一番分かる: マスクは色を被せ、塊や四角形は枠を、
 * 境界線は折れ線を描く。結果そのものを見たいときは raw に切り替える。
 * どの一手でも「左が前・右が後」の比較ができる (compare = 境目の位置)。
 * ここは絵にするだけで、値は一切変えない。
 */
import type { PreviewStep } from './usePreview';
import { KIND_COLORS, type VisionValueKind } from './opCatalog';

export interface StageDrawOptions {
  mode: 'overlay' | 'raw';
  /** 前後の比較: 0 = 元の画だけ, 1 = 結果だけ, 間はその位置で切り替わる */
  compare: number;
}

function putBottomUp(context: CanvasRenderingContext2D, step: PreviewStep): void {
  if (!step.rgba || !step.width || !step.height) return;
  const image = context.createImageData(step.width, step.height);
  for (let y = 0; y < step.height; y++) {
    const source = (step.height - 1 - y) * step.width * 4;
    image.data.set(step.rgba.subarray(source, source + step.width * 4), y * step.width * 4);
  }
  context.putImageData(image, 0, 0);
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 結果を元の画に重ねた画を canvas に描く (比較なし)。 */
function drawResult(context: CanvasRenderingContext2D, step: PreviewStep | undefined, base: PreviewStep, kind: VisionValueKind, width: number, height: number): void {
  putBottomUp(context, base);
  if (!step) return;

  if (kind === 'color' && step.rgba && step.width === width && step.height === height) {
    putBottomUp(context, step);
    return;
  }

  if (kind === 'mask' && step.rgba && step.width === width && step.height === height) {
    const frame = context.getImageData(0, 0, width, height);
    const [r, g, b] = hexToRgb(KIND_COLORS.mask);
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width * 4;
      const dst = y * width * 4;
      for (let x = 0; x < width; x++) {
        const d = dst + x * 4;
        if (step.rgba[src + x * 4] < 128) {
          frame.data[d] *= 0.45; frame.data[d + 1] *= 0.45; frame.data[d + 2] *= 0.45;
        } else {
          frame.data[d] = frame.data[d] * 0.5 + r * 0.5;
          frame.data[d + 1] = frame.data[d + 1] * 0.5 + g * 0.5;
          frame.data[d + 2] = frame.data[d + 2] * 0.5 + b * 0.5;
        }
      }
    }
    context.putImageData(frame, 0, 0);
    return;
  }

  if ((kind === 'gray' || kind === 'edges') && step.rgba && step.width === width && step.height === height) {
    putBottomUp(context, step);
    return;
  }

  if ((kind === 'blobs' || kind === 'quads' || kind === 'contours') && step.items) {
    drawItems(context, step.items as Record<string, unknown>[], width, height, kind);
    return;
  }

  if (kind === 'boundary' && step.boundary) {
    drawBoundary(context, step.boundary, width, height);
  }
}

/**
 * 選んだ一手の結果をステージに描く。戻り値は描いた画の大きさ (無ければ null)。
 * 比較 (compare < 1) では、境目より左に元の画、右に結果。
 */
export function drawStage(
  canvas: HTMLCanvasElement,
  step: PreviewStep | undefined,
  source: PreviewStep | undefined,
  kind: VisionValueKind,
  options: StageDrawOptions,
): { width: number; height: number } | null {
  // raw: 結果そのもの (色・輝度・マスク・勾配は画になっている)
  if (options.mode === 'raw' && step?.rgba && step.width && step.height) {
    canvas.width = step.width;
    canvas.height = step.height;
    const raw = canvas.getContext('2d');
    if (!raw) return null;
    putBottomUp(raw, step);
    return { width: step.width, height: step.height };
  }

  const base = source?.rgba ? source : step?.rgba ? step : undefined;
  if (!base?.rgba || !base.width || !base.height) return null;
  const width = base.width, height = base.height;

  // 結果の大きさが元と違う (rectify など) ときは結果だけを出す
  if (kind === 'color' && step?.rgba && step.width && step.height && (step.width !== width || step.height !== height)) {
    canvas.width = step.width;
    canvas.height = step.height;
    const only = canvas.getContext('2d');
    if (!only) return null;
    putBottomUp(only, step);
    return { width: step.width, height: step.height };
  }

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;

  drawResult(context, step, base, kind, width, height);

  const split = Math.round(Math.max(0, Math.min(1, options.compare)) * width);
  if (split < width && step && step !== base) {
    // 境目より左は元の画に戻す
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const offContext = off.getContext('2d');
    if (offContext) {
      putBottomUp(offContext, base);
      context.drawImage(off, split, 0, width - split, height, split, 0, width - split, height);
      // 上の drawImage は右側を元の画で塗ってしまうので、左右を入れ替える: 左 = 元、右 = 結果
      context.clearRect(0, 0, width, height);
      drawResult(context, step, base, kind, width, height);
      context.drawImage(off, 0, 0, split, height, 0, 0, split, height);
    }
    if (split > 0) {
      context.fillStyle = 'rgba(255,255,255,0.85)';
      context.fillRect(split - 1, 0, 2, height);
    }
  }
  return { width, height };
}

function drawItems(
  context: CanvasRenderingContext2D, items: Record<string, unknown>[], width: number, height: number, kind: VisionValueKind,
): void {
  const colour = KIND_COLORS[kind];
  const line = Math.max(1.5, Math.round(width / 220));
  context.lineWidth = line;
  const fontPx = Math.max(10, Math.round(height / 22));
  context.font = `${fontPx}px ui-sans-serif, system-ui, sans-serif`;
  context.textBaseline = 'bottom';

  for (const item of items) {
    const missing = item.missing === true;
    context.strokeStyle = missing ? 'rgba(255,255,255,0.4)' : colour;
    context.setLineDash(missing ? [4, 4] : []);

    const corners = item.corners as number[] | undefined;
    if (kind === 'quads' && corners && corners.length >= 8) {
      context.beginPath();
      for (let i = 0; i < 4; i++) {
        const x = corners[i * 2] * width;
        const y = (1 - corners[i * 2 + 1]) * height;
        if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.closePath();
      context.stroke();
      context.fillStyle = colour;
      context.beginPath();
      context.arc(corners[0] * width, (1 - corners[1]) * height, line * 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }

    const x = Number(item.x), y = Number(item.y), w = Number(item.width), h = Number(item.height);
    if (![x, y, w, h].every(Number.isFinite)) continue;
    const left = (x - w / 2) * width;
    const top = (1 - (y + h / 2)) * height;
    context.strokeRect(left, top, w * width, h * height);

    const vx = Number(item.vx), vy = Number(item.vy);
    if (Number.isFinite(vx) && Number.isFinite(vy) && (Math.abs(vx) > 0.01 || Math.abs(vy) > 0.01)) {
      context.beginPath();
      context.moveTo(x * width, (1 - y) * height);
      context.lineTo((x + vx * 0.5) * width, (1 - (y + vy * 0.5)) * height);
      context.stroke();
    }

    const parts: string[] = [];
    if (item.id !== undefined) parts.push(`#${item.id}`);
    if (typeof item.label === 'string' && item.label) parts.push(item.label);
    else if (typeof item.shape === 'string') parts.push(item.shape);
    if (typeof item.score === 'number') parts.push(`${(item.score * 100).toFixed(0)}%`);
    if (parts.length > 0) {
      const text = parts.join(' ');
      const metrics = context.measureText(text);
      const pad = 3;
      const boxTop = Math.max(0, top - (fontPx + pad * 2));
      context.fillStyle = missing ? 'rgba(80,80,80,0.8)' : colour;
      context.fillRect(left, boxTop, metrics.width + pad * 2, fontPx + pad * 2);
      context.fillStyle = '#fff';
      context.fillText(text, left + pad, boxTop + fontPx + pad);
    }
  }
  context.setLineDash([]);
}

function drawBoundary(context: CanvasRenderingContext2D, boundary: number[], width: number, height: number): void {
  context.strokeStyle = KIND_COLORS.boundary;
  context.lineWidth = Math.max(1.5, Math.round(width / 250));
  context.beginPath();
  const perColumn = boundary.length === width;
  let started = false;
  for (let i = 0; i < boundary.length; i++) {
    const v = boundary[i];
    if (v < 0) { started = false; continue; }
    const x = perColumn ? i : v;
    const y = perColumn ? height - 1 - v : height - 1 - i;
    if (!started) { context.moveTo(x, y); started = true; } else context.lineTo(x, y);
  }
  context.stroke();
}

/** 小さなサムネイル用: 結果を重ねた画を小さな canvas に描く。 */
export function drawThumb(
  canvas: HTMLCanvasElement, step: PreviewStep | undefined, source: PreviewStep | undefined, kind: VisionValueKind, maxWidth = 200,
): boolean {
  const scratch = document.createElement('canvas');
  const size = drawStage(scratch, step, source, kind, { mode: 'overlay', compare: 1 });
  if (!size) return false;
  const scale = Math.min(1, maxWidth / size.width);
  canvas.width = Math.max(1, Math.round(size.width * scale));
  canvas.height = Math.max(1, Math.round(size.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.drawImage(scratch, 0, 0, canvas.width, canvas.height);
  return true;
}

/** 輝度のヒストグラム (64 段)。しきい値の一手の設定に添える。 */
export function histogramOf(step: PreviewStep | undefined, bins = 64): number[] | null {
  if (!step?.rgba || !step.width || !step.height) return null;
  const counts = new Array<number>(bins).fill(0);
  const total = step.width * step.height;
  for (let i = 0; i < total; i++) {
    const v = step.rgba[i * 4];
    counts[Math.min(bins - 1, Math.floor((v / 256) * bins))]++;
  }
  const max = Math.max(1, ...counts);
  return counts.map((c) => c / max);
}

/** マスクの被覆率 (0..1)。R チャンネルが 128 以上なら「拾った所」。 */
export function coverageOf(step: PreviewStep | undefined): number | null {
  if (!step?.rgba || !step.width || !step.height) return null;
  const total = step.width * step.height;
  let on = 0;
  for (let i = 0; i < total; i++) if (step.rgba[i * 4] >= 128) on++;
  return on / total;
}

/** 元の画の画素を読む (x, y は上から下の canvas 座標)。 */
export function pixelAt(step: PreviewStep | undefined, x: number, y: number): { r: number; g: number; b: number } | null {
  if (!step?.rgba || !step.width || !step.height) return null;
  if (x < 0 || y < 0 || x >= step.width || y >= step.height) return null;
  const row = step.height - 1 - y;
  const at = (row * step.width + x) * 4;
  return { r: step.rgba[at], g: step.rgba[at + 1], b: step.rgba[at + 2] };
}

/** RGB → HSV (h 0..359, s 0..255, v 0..255)。C# の ColorSpace.RgbToHsv と同じ規約。 */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : Math.round((delta / max) * 255);
  return { h: Math.round(h) % 360, s, v: max };
}

/** 一手の結果の一言 (絵コンテのカードに添える)。 */
export function summarizeStep(
  step: PreviewStep | undefined, kind: VisionValueKind,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!step) return '';
  if (kind === 'mask') {
    const c = coverageOf(step);
    return c === null ? '' : t('vision.summary.coverage', { percent: (c * 100).toFixed(0) });
  }
  if (kind === 'blobs' || kind === 'quads' || kind === 'contours') {
    return t('vision.summary.items', { count: step.items?.length ?? step.count ?? 0 });
  }
  if (kind === 'boundary') return t('vision.summary.boundary');
  if (kind === 'record' && step.record) {
    const entries = Object.entries(step.record)
      .filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
      .slice(0, 2)
      .map(([k, v]) => `${k}=${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}`);
    return entries.join('  ');
  }
  if (step.width && step.height) return `${step.width}×${step.height}`;
  return '';
}
