/**
 * 絵コンテ: カメラ → 一手 → 一手 → … → 結果の出しどころ を、結果の絵つきのカードで左から右へ。
 *
 * 文字を読まなくても「どこで何が変わったか」が分かることが目的。
 * カードの間の線は流れる値の種類の色。前の手の結果を受け取らない手 (別の値を読む手) には
 * 「受け取る: …」の札を出す。ドラッグで並べ替え、目のアイコンで一時的に外す。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Flag, Globe, Image as ImageIcon, MapPin, Plus, Save } from 'lucide-react';
import { useT } from '../../i18n';
import type { ModelDefinition, VisionPipeline } from '../../../shared/types';
import { SOURCE_NAME, canBypass, outputKindOf, type VisionValueKind } from '../../vision/opCatalog';
import type { PreviewState, PreviewStep } from '../../vision/usePreview';
import type { PipelineProblem } from '../../vision/validate';
import { drawThumb, summarizeStep } from '../../vision/stageDraw';
import { OpIcon, SourceIcon } from '../../vision/opIcons';
import { useVisionStore, type VisionSelection } from '../../vision/visionStore';
import { kindColor } from './shared';

const CARD_WIDTH = 168;

export function Storyboard({
  pipeline, models, types, problems, preview, onChange, onInsert,
}: {
  pipeline: VisionPipeline;
  models: ModelDefinition[];
  types: Map<string, VisionValueKind>;
  problems: PipelineProblem[];
  preview: PreviewState;
  onChange: (next: VisionPipeline) => void;
  onInsert: (index: number) => void;
}) {
  const t = useT();
  const { selection, select } = useVisionStore();
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const source = preview.steps.find((s) => s.name === SOURCE_NAME);

  const isActive = (s: VisionSelection) =>
    selection.kind === s.kind && (s.kind !== 'op' || (selection.kind === 'op' && selection.id === s.id));

  // 選んだカードが見えるように寄せる
  useEffect(() => {
    const index = selection.kind === 'source' ? 0 : selection.kind === 'outputs' ? pipeline.ops.length + 1
      : pipeline.ops.findIndex((o) => o.id === selection.id) + 1;
    const el = stripRef.current?.querySelectorAll('[data-card]')[index] as HTMLElement | undefined;
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    // 選択が変わったときだけ寄せる (設定をいじるたびに動かさない)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  const move = (from: number, to: number) => {
    if (from === to || from + 1 === to) return;
    const ops = [...pipeline.ops];
    const [moved] = ops.splice(from, 1);
    ops.splice(to > from ? to - 1 : to, 0, moved);
    onChange({ ...pipeline, ops });
  };

  return (
    <div className="hairline-b bg-arsist-panel/60">
      <div ref={stripRef} className="flex items-stretch overflow-x-auto px-3 py-2 gap-0">
        <Card
          data-card
          active={isActive({ kind: 'source' })}
          icon={<SourceIcon size={13} />}
          title={t('vision.source')}
          kind="color"
          step={source}
          source={source}
          summary={summarizeStep(source, 'color', t)}
          onClick={() => select({ kind: 'source' })}
        />
        <Wire kind="color" index={0} highlighted={over === 0 && dragging !== null} onInsert={() => onInsert(0)}
          onDrop={() => dragging !== null && move(dragging, 0)} onOver={() => setOver(0)} />

        {pipeline.ops.map((op, index) => {
          const kind = types.get(op.out) ?? outputKindOf(op, models);
          const opProblems = problems.filter((p) => p.opId === op.id);
          const step = preview.steps.find((s) => s.name === op.out);
          const previousOut = index === 0 ? SOURCE_NAME : pipeline.ops[index - 1].out;
          const firstInput = op.in?.[0] ?? previousOut;
          // 前の手の結果をそのまま受け取らないときは、どこから来たかを札で示す
          const takesFrom = firstInput !== previousOut ? describeValue(firstInput) : null;
          const extraInputs = (op.in ?? []).slice(1).filter(Boolean).map(describeValue);
          return (
            <div key={op.id} className="flex items-stretch">
              <Card
                data-card
                active={isActive({ kind: 'op', id: op.id })}
                error={opProblems.length > 0}
                dimmed={op.disabled === true}
                number={index + 1}
                icon={<OpIcon op={op.op} size={13} />}
                title={t(`vision.op.${op.op}`)}
                kind={kind}
                step={step}
                source={source}
                summary={summarizeStep(step, kind, t)}
                takesFrom={takesFrom}
                extraInputs={extraInputs}
                bypassable={canBypass(op, models)}
                disabled={op.disabled === true}
                draggable
                onDragStart={() => setDragging(index)}
                onDragEnd={() => { setDragging(null); setOver(null); }}
                onToggle={() => onChange({ ...pipeline, ops: pipeline.ops.map((o) => (o.id === op.id ? { ...o, disabled: !o.disabled } : o)) })}
                onClick={() => select({ kind: 'op', id: op.id })}
              />
              <Wire kind={kind} index={index + 1} highlighted={over === index + 1 && dragging !== null} onInsert={() => onInsert(index + 1)}
                onDrop={() => dragging !== null && move(dragging, index + 1)} onOver={() => setOver(index + 1)} />
            </div>
          );
        })}

        <OutputsCard
          data-card
          active={isActive({ kind: 'outputs' })}
          error={problems.some((p) => !p.opId)}
          pipeline={pipeline}
          onClick={() => select({ kind: 'outputs' })}
        />
      </div>
    </div>
  );

  function describeValue(name: string): string {
    if (name === SOURCE_NAME) return t('vision.source');
    const i = pipeline.ops.findIndex((o) => o.out === name);
    return i >= 0 ? `${i + 1}. ${t(`vision.op.${pipeline.ops[i].op}`)}` : name;
  }
}

function Card({
  active, error, dimmed, number, icon, title, kind, step, source, summary, takesFrom, extraInputs, bypassable, disabled,
  draggable, onDragStart, onDragEnd, onToggle, onClick,
}: {
  active: boolean;
  error?: boolean;
  dimmed?: boolean;
  number?: number;
  icon: JSX.Element;
  title: string;
  kind: VisionValueKind;
  step?: PreviewStep;
  source?: PreviewStep;
  summary: string;
  takesFrom?: string | null;
  extraInputs?: string[];
  bypassable?: boolean;
  disabled?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onToggle?: () => void;
  onClick: () => void;
  'data-card'?: boolean;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawable = Boolean(step && (step.rgba || step.items || step.boundary) && (source?.rgba || step.rgba));

  useEffect(() => {
    if (canvasRef.current && drawable) drawThumb(canvasRef.current, step, source, kind, CARD_WIDTH);
  }, [step, source, kind, drawable]);

  const stripe = kindColor(kind);
  const recordLines = useMemo(() => (step?.record ? Object.entries(step.record).slice(0, 4) : []), [step]);

  return (
    <div
      data-card
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ width: CARD_WIDTH }}
      className={`shrink-0 rounded-lg overflow-hidden cursor-pointer outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-arsist-accent/60 ${
        active ? 'ring-2 ring-arsist-accent bg-arsist-hover' : 'bg-arsist-surface hover:bg-arsist-hover/60'
      } ${error ? 'ring-2 ring-arsist-error' : ''} ${dimmed ? 'opacity-55' : ''}`}
    >
      <div className="flex items-center gap-1.5 px-2 pt-1.5 text-[11px]">
        {number !== undefined && <span className="text-[10px] text-arsist-muted w-3 shrink-0">{number}</span>}
        <span className="shrink-0" style={{ color: stripe }}>{icon}</span>
        <span className={`truncate ${disabled ? 'line-through text-arsist-muted' : ''}`}>{title}</span>
        {error && <AlertTriangle size={11} className="text-arsist-error shrink-0 ml-auto" />}
        {bypassable && !error && (
          <button
            className="btn-icon !p-0.5 ml-auto shrink-0"
            title={disabled ? t('vision.step.enable') : t('vision.step.bypass')}
            onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
          >
            {disabled ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
        )}
      </div>

      <div className="mx-2 mt-1.5 rounded bg-arsist-bg/80 overflow-hidden" style={{ height: 96 }}>
        {drawable ? (
          <canvas ref={canvasRef} className="w-full h-full object-contain" />
        ) : recordLines.length > 0 ? (
          <div className="p-1.5 text-[9px] leading-tight font-mono text-arsist-muted">
            {recordLines.map(([k, v]) => <div key={k} className="truncate">{k}={typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}</div>)}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[9px] text-arsist-muted">{step ? '' : t('vision.noPreviewYet')}</div>
        )}
      </div>

      <div className="px-2 py-1.5 space-y-0.5">
        <div className="flex items-center gap-1 text-[10px]">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stripe }} />
          <span className="text-arsist-muted truncate">{summary || t(`vision.kind.${kind}`)}</span>
        </div>
        {takesFrom && (
          <div className="text-[9px] text-amber-400 truncate" title={t('vision.storyboard.takesFrom', { name: takesFrom })}>
            {t('vision.storyboard.takesFrom', { name: takesFrom })}
          </div>
        )}
        {extraInputs && extraInputs.length > 0 && (
          <div className="text-[9px] text-arsist-muted truncate" title={t('vision.storyboard.alsoTakes', { names: extraInputs.join(', ') })}>
            {t('vision.storyboard.alsoTakes', { names: extraInputs.join(', ') })}
          </div>
        )}
      </div>
      <div className="h-1" style={{ backgroundColor: stripe }} />
    </div>
  );
}

/** カードの間の線 (流れる値の色) と、挿入の「+」。 */
function Wire({
  kind, index, highlighted, onInsert, onDrop, onOver,
}: { kind: VisionValueKind; index: number; highlighted: boolean; onInsert: () => void; onDrop: () => void; onOver: () => void }) {
  const t = useT();
  const colour = kindColor(kind);
  return (
    <div
      className={`shrink-0 w-10 flex flex-col items-center justify-center relative ${highlighted ? 'bg-arsist-accent/20 rounded' : ''}`}
      onDragOver={(e) => { e.preventDefault(); onOver(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      <div className="absolute left-0 right-0 top-1/2 h-0.5" style={{ backgroundColor: colour, opacity: 0.8 }} />
      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-y-[4px] border-y-transparent border-l-[6px]" style={{ borderLeftColor: colour }} />
      <button
        className="relative z-10 w-5 h-5 rounded-full bg-arsist-surface hover:bg-arsist-accent hover:text-arsist-bg text-arsist-muted flex items-center justify-center shadow-sm transition-colors"
        title={t('vision.addStep')}
        aria-label={`${t('vision.addStep')} ${index}`}
        onClick={onInsert}
      >
        <Plus size={11} />
      </button>
    </div>
  );
}

function OutputsCard({ active, error, pipeline, onClick }: { active: boolean; error: boolean; pipeline: VisionPipeline; onClick: () => void; 'data-card'?: boolean }) {
  const t = useT();
  const icon = (kind: string) => kind === 'world' ? <Globe size={12} /> : kind === 'store' ? <Save size={12} /> : kind === 'anchor' ? <MapPin size={12} /> : <ImageIcon size={12} />;
  return (
    <div
      data-card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ width: CARD_WIDTH }}
      className={`shrink-0 rounded-lg overflow-hidden cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-arsist-accent/60 ${
        active ? 'ring-2 ring-arsist-accent bg-arsist-hover' : 'bg-arsist-surface hover:bg-arsist-hover/60'
      } ${error ? 'ring-2 ring-arsist-error' : ''}`}
    >
      <div className="flex items-center gap-1.5 px-2 pt-1.5 text-[11px]">
        <Flag size={13} className="text-arsist-muted shrink-0" />
        <span className="truncate">{t('vision.outputs')}</span>
        {error && <AlertTriangle size={11} className="text-arsist-error shrink-0 ml-auto" />}
      </div>
      <div className="mx-2 mt-1.5 rounded bg-arsist-bg/80 p-2 space-y-1" style={{ height: 96 }}>
        {pipeline.outputs.length === 0 && <p className="text-[9px] text-arsist-muted">{t('vision.noOutputsYet')}</p>}
        {pipeline.outputs.slice(0, 4).map((o, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <span className="text-arsist-muted shrink-0">{icon(o.kind)}</span>
            <span className="truncate">{t(`vision.outputShort.${o.kind}`)}</span>
          </div>
        ))}
      </div>
      <div className="px-2 py-1.5 text-[10px] text-arsist-muted">{t('vision.storyboard.outputsHint')}</div>
      <div className="h-1 bg-arsist-accent" />
    </div>
  );
}
