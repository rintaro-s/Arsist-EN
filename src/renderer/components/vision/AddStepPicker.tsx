/**
 * 「一手を足す」の選択肢。
 *
 * 候補の一手を、**今の画で全部試した絵**で見せる。「ぼかすとこうなる」「マスクにするとこうなる」を
 * 名前と説明から想像しなくて済む。繋げない一手は薄く出し、「先にマスクが要る」と理由を書く。
 * 検索と ↑↓ Enter で選べる。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { useT } from '../../i18n';
import type { ModelDefinition, VisionOp, VisionOpType, VisionPipeline } from '../../../shared/types';
import { OP_CATALOG, SOURCE_NAME, type OpDefinition, type VisionValueKind } from '../../vision/opCatalog';
import type { PreviewStep, ProbeResult } from '../../vision/usePreview';
import { drawThumb } from '../../vision/stageDraw';
import { OpIcon } from '../../vision/opIcons';
import { ValueChip, kindColor } from './shared';

const GROUP_ORDER: OpDefinition['group'][] = ['find', 'items', 'time', 'geometry', 'shape', 'measure', 'draw', 'convert', 'ai'];

export function AddStepPicker({
  pipeline, index, availableKinds, models, candidates, probes, probing, previewSteps, onPick, onClose, onOpenModels,
}: {
  pipeline: VisionPipeline;
  index: number;
  availableKinds: Set<VisionValueKind>;
  models: ModelDefinition[];
  /** 試す用の下書き (op ごと)。id は op 名 */
  candidates: Map<VisionOpType, VisionOp>;
  probes: Map<string, ProbeResult>;
  probing: boolean;
  previewSteps: PreviewStep[];
  onPick: (op: VisionOpType) => void;
  onClose: () => void;
  onOpenModels: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const source = previewSteps.find((s) => s.name === SOURCE_NAME);

  const missingFor = (definition: OpDefinition): VisionValueKind | null => {
    for (const kind of definition.inputs) if (!availableKinds.has(kind)) return kind;
    return null;
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUP_ORDER.map((group) => ({
      group,
      ops: OP_CATALOG.filter((d) => d.group === group).filter((d) =>
        !q || t(`vision.op.${d.op}`).toLowerCase().includes(q) || t(`vision.opHint.${d.op}`).toLowerCase().includes(q) || d.op.toLowerCase().includes(q)),
    })).filter((g) => g.ops.length > 0);
  }, [query, t]);

  const enabled = useMemo(() => groups.flatMap((g) => g.ops).filter((d) => missingFor(d) === null), [groups, availableKinds]);
  useEffect(() => { setCursor(0); }, [query]);

  const choose = (definition: OpDefinition) => {
    if (definition.op === 'infer' && models.length === 0) { onOpenModels(); return; }
    onPick(definition.op);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setCursor((c) => Math.min(enabled.length - 1, c + 1)); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    if (e.key === 'Enter' && enabled[cursor]) { e.preventDefault(); choose(enabled[cursor]); }
  };

  const previousName = index === 0 ? SOURCE_NAME : pipeline.ops[index - 1]?.out;
  const previousStep = previewSteps.find((s) => s.name === previousName);

  const dialog = (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 900 }}>
      <div className="modal max-w-4xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="modal-header flex items-center gap-3">
          <span className="shrink-0">{t('vision.add.title')}</span>
          <div className="flex-1 relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-arsist-muted" />
            <input autoFocus className="input text-xs w-full pl-7" placeholder={t('vision.add.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {source && <span className="text-[11px] text-arsist-muted shrink-0">{probing ? t('vision.add.trying') : t('vision.add.tried')}</span>}
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body overflow-y-auto space-y-4">
          <p className="text-[11px] text-arsist-muted leading-relaxed">{source ? t('vision.add.hintWithPicture') : t('vision.add.hint')}</p>
          {groups.map(({ group, ops }) => (
            <section key={group} className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-arsist-muted">{t(`vision.group.${group}`)}</p>
              <div className="grid grid-cols-3 gap-1.5">
                {ops.map((definition) => {
                  const missing = missingFor(definition);
                  const needsModel = definition.op === 'infer' && models.length === 0;
                  const disabled = missing !== null;
                  const focused = enabled[cursor] === definition;
                  const probe = probes.get(definition.op);
                  const candidate = candidates.get(definition.op);
                  const inputName = candidate?.in?.[0] ?? previousName;
                  const inputStep = previewSteps.find((s) => s.name === inputName) ?? previousStep;
                  return (
                    <button
                      key={definition.op}
                      disabled={disabled}
                      className={`text-left rounded-lg p-2 transition-colors ${
                        disabled ? 'opacity-40 cursor-not-allowed bg-arsist-surface' : 'bg-arsist-surface hover:bg-arsist-hover'
                      } ${focused ? 'ring-2 ring-arsist-accent/60' : ''}`}
                      onMouseEnter={() => { const i = enabled.indexOf(definition); if (i >= 0) setCursor(i); }}
                      onClick={() => choose(definition)}
                    >
                      <span className="flex items-center gap-1.5">
                        <span style={{ color: kindColor(definition.op === 'infer' ? 'record' : definition.output) }}><OpIcon op={definition.op} size={13} /></span>
                        <span className="text-[12px] font-medium truncate">{t(`vision.op.${definition.op}`)}</span>
                        <span className="ml-auto flex items-center gap-0.5 shrink-0">
                          {definition.inputs.map((kind, i) => <span key={i} className="w-2 h-2 rounded-full" style={{ backgroundColor: kindColor(kind) }} />)}
                          <span className="text-[9px] text-arsist-muted">→</span>
                          <ValueChip kind={definition.op === 'infer' ? 'record' : definition.output} />
                        </span>
                      </span>

                      {/* 前 → 後 */}
                      {source && !disabled && (
                        <span className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                          <Thumb step={inputStep} source={source} kind={inputStep?.kind as VisionValueKind ?? 'color'} label={t('vision.stage.before')} />
                          <span className="text-arsist-muted text-[10px]">→</span>
                          <ProbeThumb probe={probe} source={source} probing={probing} label={t('vision.stage.after')} />
                        </span>
                      )}

                      <span className="block text-[10px] text-arsist-muted leading-snug mt-1.5">{t(`vision.opHint.${definition.op}`)}</span>
                      {missing && <span className="block text-[10px] text-amber-400 mt-1">{t('vision.add.needs', { kind: t(`vision.kind.${missing}`) })}</span>}
                      {!missing && needsModel && <span className="block text-[10px] text-purple-300 mt-1">{t('vision.add.needsModel')}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}

function Thumb({ step, source, kind, label }: { step?: PreviewStep; source?: PreviewStep; kind: VisionValueKind; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawable = Boolean(step && (step.rgba || step.items || step.boundary) && (source?.rgba || step.rgba));
  useEffect(() => { if (ref.current && drawable) drawThumb(ref.current, step, source, kind, 140); }, [step, source, kind, drawable]);
  return (
    <span className="relative block rounded bg-arsist-bg overflow-hidden" style={{ height: 56 }}>
      {drawable ? <canvas ref={ref} className="w-full h-full object-contain" /> : null}
      <span className="absolute bottom-0 left-0 text-[8px] px-1 bg-black/50 text-white rounded-tr">{label}</span>
    </span>
  );
}

function ProbeThumb({ probe, source, probing, label }: { probe?: ProbeResult; source?: PreviewStep; probing: boolean; label: string }) {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const kind = (probe?.kind ?? 'record') as VisionValueKind;
  const drawable = Boolean(probe && !probe.error && (probe.rgba || probe.items || probe.boundary) && (source?.rgba || probe.rgba));
  useEffect(() => { if (ref.current && drawable) drawThumb(ref.current, probe, source, kind, 140); }, [probe, source, kind, drawable]);

  let caption: string | null = null;
  if (probe?.error) caption = t('vision.add.failed');
  else if (probe?.stopped) caption = t('vision.add.stopped', { reason: probe.stopped });
  else if (probe && !drawable) {
    if (probe.record) caption = Object.entries(probe.record).slice(0, 2).map(([k, v]) => `${k}=${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}`).join(' ');
    else if (probe.count !== undefined) caption = t('vision.itemsCount', { count: probe.count });
  }
  const summary = probe?.coverage !== undefined ? t('vision.summary.coverage', { percent: (probe.coverage * 100).toFixed(0) })
    : probe?.items ? t('vision.summary.items', { count: probe.items.length }) : null;

  return (
    <span className="relative block rounded bg-arsist-bg overflow-hidden" style={{ height: 56 }}>
      {drawable ? <canvas ref={ref} className="w-full h-full object-contain" /> : (
        <span className="w-full h-full flex items-center justify-center text-[9px] text-arsist-muted px-1 text-center leading-tight">
          {caption ?? (probing ? '…' : '')}
        </span>
      )}
      {summary && drawable && <span className="absolute top-0 right-0 text-[8px] px-1 bg-black/50 text-white rounded-bl">{summary}</span>}
      <span className="absolute bottom-0 left-0 text-[8px] px-1 bg-black/50 text-white rounded-tr">{label}</span>
    </span>
  );
}
