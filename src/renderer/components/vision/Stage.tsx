/**
 * ステージ: 選んだ一手の結果を大きく見せる。
 *
 * 画像処理は「その一手で何が起きたか」が見えなければ調整できない。ここは
 * 元の画に重ねて見せる (マスクは色、塊は枠、境界線は折れ線) のを基本にし、
 * 左が前・右が後の比較スライダーをどの一手でも使える。結果そのものは raw で。
 *
 * 画をクリックして設定もできる: 色で拾う手は画の色を拾い、しきい値は画の明るさを拾い、
 * カメラのカードでは見る枠をドラッグで描く。数字を打つより、画を指す方が早い。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, Layers, Maximize2, Pipette, BoxSelect, ZoomIn, ZoomOut } from 'lucide-react';
import { useT } from '../../i18n';
import { KIND_COLORS, type VisionValueKind } from '../../vision/opCatalog';
import type { PreviewState, PreviewStep } from '../../vision/usePreview';
import { drawStage, pixelAt } from '../../vision/stageDraw';
import { useVisionStore } from '../../vision/visionStore';
import { RecordTable, ValueChip } from './shared';

type Zoom = 'fit' | 1 | 2;

export interface StagePick {
  /** 画の座標 (上から下)。 */
  x: number;
  y: number;
  /** 元の画の画素 */
  rgb: { r: number; g: number; b: number } | null;
  /** 最初の入力 (輝度) の値 */
  input: number | null;
}

export interface StageRect { x: number; y: number; width: number; height: number }

export function Stage({
  title, kind, step, source, inputStep, preview, rect, onPick, onRect,
}: {
  title: string;
  kind: VisionValueKind;
  step?: PreviewStep;
  source?: PreviewStep;
  inputStep?: PreviewStep;
  preview: PreviewState;
  /** カメラのカードのとき: 今の見る枠 (正規化、原点左下。実機と切り出しと同じ) */
  rect?: StageRect | null;
  onPick?: (pick: StagePick) => void;
  onRect?: (rect: StageRect) => void;
}) {
  const t = useT();
  const { stageMode, setStageMode, compare, setCompare, pickMode, setPickMode } = useVisionStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string; rgb: string | null } | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const canOverlay = kind !== 'color' && kind !== 'record';
  const mode = canOverlay ? stageMode : 'raw';
  const canCompare = Boolean(step && source && step !== source && (step.rgba || step.items || step.boundary)) && mode === 'overlay' || (kind === 'color' && Boolean(step?.rgba) && step !== source);

  useEffect(() => {
    if (!canvasRef.current) return;
    const drawn = drawStage(canvasRef.current, step, source, kind, { mode: kind === 'color' ? 'overlay' : mode, compare: canCompare ? compare : 1 });
    setSize(drawn);
  }, [step, source, kind, mode, compare, canCompare]);

  const frame = preview.frames?.[preview.focus ?? 0];
  const events = frame?.events ?? preview.events ?? [];

  const canvasStyle = useMemo(() => {
    if (!size) return { display: 'none' };
    if (zoom === 'fit') return { maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' };
    return { width: size.width * zoom, height: size.height * zoom, maxWidth: 'none' };
  }, [zoom, size]);

  const toImage = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(size.width - 1, Math.floor(((event.clientX - bounds.left) / bounds.width) * size.width))),
      y: Math.max(0, Math.min(size.height - 1, Math.floor(((event.clientY - bounds.top) / bounds.height) * size.height))),
    };
  };

  const readAt = (x: number, y: number) => {
    const from = step?.rgba && size && step.width === size.width && step.height === size.height ? step : source;
    const rgb = pixelAt(source, x, y);
    let text = '';
    if (from?.rgba && size && from.width === size.width && from.height === size.height) {
      const p = pixelAt(from, x, y);
      if (p) text = kind === 'gray' || kind === 'mask' || kind === 'edges' ? `${p.r}` : `${p.r}, ${p.g}, ${p.b}`;
    }
    return { text, rgb };
  };

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const at = toImage(event);
    if (!at || !size) { setHover(null); return; }
    const { text, rgb } = readAt(at.x, at.y);
    setHover({ x: at.x, y: size.height - 1 - at.y, text, rgb: rgb ? `rgb(${rgb.r},${rgb.g},${rgb.b})` : null });
    if (drag) setDrag({ ...drag, x1: at.x, y1: at.y });
  };

  const onDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const at = toImage(event);
    if (!at || !size) return;
    if (pickMode === 'rect') { setDrag({ x0: at.x, y0: at.y, x1: at.x, y1: at.y }); return; }
    if (pickMode === 'color' || pickMode === 'brightness') {
      const rgb = pixelAt(source, at.x, at.y);
      const inputPixel = inputStep?.rgba && inputStep.width === size.width && inputStep.height === size.height ? pixelAt(inputStep, at.x, at.y) : null;
      onPick?.({ x: at.x, y: at.y, rgb, input: inputPixel ? inputPixel.r : rgb ? Math.round(rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114) : null });
    }
  };

  const onUp = () => {
    if (!drag || !size) { setDrag(null); return; }
    const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1);
    const y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
    setDrag(null);
    if (x1 - x0 < 4 || y1 - y0 < 4) return;
    // 上から下の canvas 座標 → 正規化、原点左下 (実機の viewport と、切り出し cropToTask と同じ)
    onRect?.({
      x: Math.round((x0 / size.width) * 100) / 100,
      y: Math.round(((size.height - 1 - y1) / size.height) * 100) / 100,
      width: Math.round(((x1 - x0 + 1) / size.width) * 100) / 100,
      height: Math.round(((y1 - y0 + 1) / size.height) * 100) / 100,
    });
    setPickMode('none');
  };

  const legend = legendFor(kind, t);
  const pickHint = pickMode === 'color' ? t('vision.pick.hintColor') : pickMode === 'brightness' ? t('vision.pick.hintBrightness') : pickMode === 'rect' ? t('vision.pick.hintRect') : null;
  const cursor = pickMode === 'rect' ? 'crosshair' : pickMode !== 'none' ? 'copy' : 'default';

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-arsist-bg/60">
      {/* 帯 */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] hairline-b bg-arsist-panel/60">
        <span className="font-medium truncate">{title}</span>
        <ValueChip kind={kind} />
        {frame?.gated && <span className="text-amber-400">{t('vision.gated', { reason: frame.gateReason ?? '' })}</span>}
        {events.length > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-arsist-accent/20 text-arsist-accent">{t('vision.stage.events', { names: events.join(', ') })}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {hover && size && (
            <span className="font-mono text-arsist-muted mr-2 flex items-center gap-1.5">
              {hover.rgb && <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: hover.rgb }} />}
              {hover.x}, {hover.y}{hover.text ? ` · ${hover.text}` : ''}
            </span>
          )}
          {preview.elapsedMs !== undefined && !preview.running && (
            <span className="text-arsist-muted mr-2">{t('vision.stage.elapsed', { ms: preview.elapsedMs })}</span>
          )}
          {onRect && (
            <button className={`btn-icon ${pickMode === 'rect' ? 'text-arsist-accent' : ''}`} title={t('vision.pick.rect')} onClick={() => setPickMode(pickMode === 'rect' ? 'none' : 'rect')}>
              <BoxSelect size={14} />
            </button>
          )}
          {onPick && (
            <button className={`btn-icon ${pickMode === 'color' || pickMode === 'brightness' ? 'text-arsist-accent' : ''}`} title={t('vision.pick.eyedropper')}
              onClick={() => setPickMode(pickMode === 'none' ? (kind === 'mask' && inputStep && inputStep.kind === 'gray' ? 'brightness' : 'color') : 'none')}>
              <Pipette size={14} />
            </button>
          )}
          {canOverlay && (
            <button className={`btn-icon ${mode === 'overlay' ? 'text-arsist-accent' : ''}`} title={mode === 'overlay' ? t('vision.stage.showRaw') : t('vision.stage.showOverlay')}
              onClick={() => setStageMode(mode === 'overlay' ? 'raw' : 'overlay')}>
              <Layers size={14} />
            </button>
          )}
          {canCompare && (
            <span className="flex items-center gap-1 mr-1" title={t('vision.stage.compare')}>
              <Columns2 size={13} className="text-arsist-muted" />
              <input type="range" min={0} max={1} step={0.01} value={compare} className="w-24" onChange={(e) => setCompare(parseFloat(e.target.value))} />
            </span>
          )}
          <button className={`btn-icon ${zoom === 'fit' ? 'text-arsist-accent' : ''}`} title={t('vision.stage.fit')} onClick={() => setZoom('fit')}><Maximize2 size={14} /></button>
          <button className={`btn-icon ${zoom === 1 ? 'text-arsist-accent' : ''}`} title="100%" onClick={() => setZoom(1)}><ZoomOut size={14} /></button>
          <button className={`btn-icon ${zoom === 2 ? 'text-arsist-accent' : ''}`} title="200%" onClick={() => setZoom(2)}><ZoomIn size={14} /></button>
        </div>
      </div>

      {pickHint && <p className="px-3 py-1 text-[11px] bg-arsist-accent/15 text-arsist-accent">{pickHint}</p>}

      {/* 絵 */}
      <div className={`flex-1 min-h-0 relative ${zoom === 'fit' ? 'flex items-center justify-center p-3' : 'overflow-auto p-3'}`}>
        {size ? (
          <div className="relative inline-block max-w-full max-h-full">
            <canvas
              ref={canvasRef}
              className="rounded bg-arsist-bg shadow-sm block"
              style={{ ...canvasStyle, imageRendering: zoom === 2 ? 'pixelated' : 'auto', cursor } as React.CSSProperties}
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
              onMouseDown={onDown}
              onMouseUp={onUp}
            />
            {/* 比較の目印 */}
            {canCompare && compare > 0.02 && compare < 0.98 && (
              <>
                <span className="absolute top-1 left-1 text-[10px] px-1 rounded bg-black/50 text-white">{t('vision.stage.before')}</span>
                <span className="absolute top-1 right-1 text-[10px] px-1 rounded bg-black/50 text-white">{t('vision.stage.after')}</span>
              </>
            )}
            {/* 見る枠 (カメラのカードで) */}
            {rect && size && !drag && !(rect.x <= 0 && rect.y <= 0 && rect.width >= 1 && rect.height >= 1) && (
              <div
                className="absolute border-2 border-arsist-accent/80 pointer-events-none"
                style={{ left: `${rect.x * 100}%`, top: `${(1 - rect.y - rect.height) * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
              >
                <span className="absolute -top-4 left-0 text-[10px] px-1 rounded bg-arsist-accent text-arsist-bg whitespace-nowrap">{t('vision.pick.rectLabel')}</span>
              </div>
            )}
            {drag && size && (
              <div
                className="absolute border-2 border-dashed border-arsist-accent bg-arsist-accent/10 pointer-events-none"
                style={{
                  left: `${(Math.min(drag.x0, drag.x1) / size.width) * 100}%`,
                  top: `${(Math.min(drag.y0, drag.y1) / size.height) * 100}%`,
                  width: `${((Math.abs(drag.x1 - drag.x0) + 1) / size.width) * 100}%`,
                  height: `${((Math.abs(drag.y1 - drag.y0) + 1) / size.height) * 100}%`,
                }}
              />
            )}
            {legend && (
              <div className="absolute bottom-1 left-1 flex items-center gap-2 text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white">
                {legend.map((entry) => (
                  <span key={entry.text} className="flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
                    {entry.text}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <canvas ref={canvasRef} className="hidden" />
            <div className="max-w-sm text-center space-y-2">
              <p className="text-sm text-arsist-muted">
                {preview.running ? t('vision.running') : step ? t('vision.stage.noPicture') : t('vision.stage.noMedia')}
              </p>
              {preview.unavailable && <p className="text-[11px] text-amber-400">{t(`vision.unavailable.${preview.unavailable}`)}</p>}
              {!preview.unavailable && preview.error && <p className="text-[11px] text-arsist-error">{t('vision.previewError', { detail: preview.error })}</p>}
            </div>
          </>
        )}
      </div>

      {/* 数値 */}
      {step && (step.record || step.items || step.boundary) && (
        <div className="px-3 pb-3 max-h-40 overflow-y-auto">
          <RecordTable step={step} compact />
        </div>
      )}
    </div>
  );
}

function legendFor(kind: VisionValueKind, t: (key: string) => string): Array<{ color: string; text: string }> | null {
  switch (kind) {
    case 'mask': return [{ color: KIND_COLORS.mask, text: t('vision.legend.mask') }];
    case 'blobs': return [{ color: KIND_COLORS.blobs, text: t('vision.legend.blobs') }];
    case 'contours': return [{ color: KIND_COLORS.contours, text: t('vision.legend.contours') }];
    case 'quads': return [{ color: KIND_COLORS.quads, text: t('vision.legend.quads') }];
    case 'boundary': return [{ color: KIND_COLORS.boundary, text: t('vision.legend.boundary') }];
    case 'edges': return [{ color: '#ffffff', text: t('vision.legend.edges') }];
    default: return null;
  }
}
