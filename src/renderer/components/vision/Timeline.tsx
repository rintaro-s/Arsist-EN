/**
 * 時間軸: 動画や連続した写真のフレームを並べ、どのフレームを見ているかを選ぶ。
 *
 * 追跡 (track) や平滑化 (stabilize)、動き (motion)、イベント (event) は
 * 1 枚の写真では確かめられない。フレームごとの合否・イベント・件数を帯と折れ線で見せる。
 */
import { useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useT } from '../../i18n';
import type { PreviewState } from '../../vision/usePreview';
import type { TestMedia } from '../../vision/testMedia';
import { useVisionStore } from '../../vision/visionStore';

function thumbUrl(frame: TestMedia['frames'][number]): string {
  const scale = Math.min(1, 96 / frame.width);
  const w = Math.max(1, Math.round(frame.width * scale));
  const h = Math.max(1, Math.round(frame.height * scale));
  const full = document.createElement('canvas');
  full.width = frame.width;
  full.height = frame.height;
  const fc = full.getContext('2d');
  if (!fc) return '';
  const image = fc.createImageData(frame.width, frame.height);
  for (let y = 0; y < frame.height; y++) {
    const src = (frame.height - 1 - y) * frame.width * 4;
    image.data.set(frame.rgba.subarray(src, src + frame.width * 4), y * frame.width * 4);
  }
  fc.putImageData(image, 0, 0);
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  small.getContext('2d')?.drawImage(full, 0, 0, w, h);
  return small.toDataURL('image/jpeg', 0.6);
}

export function Timeline({ media, preview }: { media: TestMedia; preview: PreviewState }) {
  const t = useT();
  const { focus, setFocus, stepFocus, playing, setPlaying } = useVisionStore();
  const stripRef = useRef<HTMLDivElement>(null);

  const thumbs = useMemo(() => media.frames.map(thumbUrl), [media]);

  // 自動再生: プレビュー 1 回ぶんの時間より速くは進めない
  useEffect(() => {
    if (!playing) return;
    const interval = Math.max(400, 1000 / media.fps, (preview.elapsedMs ?? 0) + 120);
    const timer = window.setInterval(() => stepFocus(1), interval);
    return () => window.clearInterval(timer);
  }, [playing, media.fps, preview.elapsedMs, stepFocus]);

  useEffect(() => {
    const el = stripRef.current?.children[focus] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focus]);

  // 折れ線: 一覧の件数かマスクの被覆率のうち、最初に見つかったもの
  const metric = useMemo(() => {
    const frames = preview.frames ?? [];
    const key = frames.flatMap((f) => Object.keys(f.counts ?? {}))[0];
    if (!key) return null;
    const values = frames.map((f) => Number(f.counts?.[key] ?? 0));
    const max = Math.max(1, ...values);
    return { key, values, max };
  }, [preview.frames]);

  return (
    <div className="hairline-t bg-arsist-panel/60 px-3 py-2 flex items-center gap-3">
      <div className="flex items-center gap-0.5 shrink-0">
        <button className="btn-icon" onClick={() => stepFocus(-1)} title={t('vision.timeline.prev')}><ChevronLeft size={14} /></button>
        <button className="btn-icon" onClick={() => setPlaying(!playing)} title={playing ? t('vision.timeline.pause') : t('vision.timeline.play')}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button className="btn-icon" onClick={() => stepFocus(1)} title={t('vision.timeline.next')}><ChevronRight size={14} /></button>
        <span className="text-[11px] font-mono text-arsist-muted ml-1 w-16">{focus + 1} / {media.frames.length}</span>
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        {metric && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-arsist-muted font-mono w-24 truncate">{metric.key}</span>
            <svg viewBox={`0 0 ${Math.max(1, metric.values.length - 1) * 10} 24`} preserveAspectRatio="none" className="h-6 flex-1">
              <polyline
                fill="none" stroke="currentColor" strokeWidth="1.5" className="text-arsist-accent"
                points={metric.values.map((v, i) => `${i * 10},${22 - (v / metric.max) * 20}`).join(' ')}
              />
              <circle cx={focus * 10} cy={22 - ((metric.values[focus] ?? 0) / metric.max) * 20} r="2.5" className="fill-arsist-accent" />
            </svg>
            <span className="text-[10px] font-mono text-arsist-muted w-10 text-right">{metric.values[focus] ?? 0}</span>
          </div>
        )}
        <div ref={stripRef} className="flex gap-1 overflow-x-auto pb-1">
          {media.frames.map((_, i) => {
            const frame = preview.frames?.[i];
            const stripe = !frame ? 'bg-arsist-hover' : !frame.ok ? 'bg-arsist-error' : frame.gated ? 'bg-amber-400' : 'bg-arsist-success';
            return (
              <button
                key={i}
                className={`relative shrink-0 rounded overflow-hidden ${i === focus ? 'ring-2 ring-arsist-accent' : 'opacity-80 hover:opacity-100'}`}
                onClick={() => { setPlaying(false); setFocus(i); }}
                title={frame?.gateReason || frame?.error || `${i + 1}`}
              >
                <img src={thumbs[i]} alt="" className="h-10 w-auto block" draggable={false} />
                <span className={`absolute left-0 right-0 bottom-0 h-1 ${stripe}`} />
                {(frame?.events?.length ?? 0) > 0 && <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-arsist-accent" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
