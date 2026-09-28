/**
 * 選んだ一手の設定。
 *
 * 上から「この一手は何をするか」「何を受け取るか」「設定」。結果はステージ (中央) にある。
 * 設定の欄は一手の中身に合わせる: 色で拾うなら色相の帯、しきい値なら明るさの分布、
 * 色なら色見本。生の数字だけを並べない。
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Cpu, Eye, EyeOff, Pipette, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import type { ImageModelDefinition, VisionOp } from '../../../shared/types';
import { OP_BY_NAME, canBypass, outputKindOf, type OpParam, type VisionValueKind } from '../../vision/opCatalog';
import type { PreviewStep } from '../../vision/usePreview';
import { histogramOf } from '../../vision/stageDraw';
import type { PipelineProblem } from '../../vision/validate';
import { useVisionStore } from '../../vision/visionStore';
import { OpIcon } from '../../vision/opIcons';
import { ValueChip, describeProblem } from './shared';

/** 結線の候補: 値の名前と、人が読むラベルと、種類。 */
export interface ValueOption {
  name: string;
  label: string;
  kind: VisionValueKind;
}

/** valueRef パラメータが受け付ける値の種類。 */
const REF_KINDS: Record<string, VisionValueKind[]> = {
  within: ['mask'],
  against: ['gray', 'edges', 'color'],
};

export function StepInspector({
  op, index, models, values, problems, inputStep, onChange, onRemove, onOpenModels,
}: {
  op: VisionOp;
  index: number;
  models: ImageModelDefinition[];
  /** この一手より前に作られている値 */
  values: ValueOption[];
  problems: PipelineProblem[];
  /** 最初の入力の結果 (ヒストグラム用) */
  inputStep?: PreviewStep;
  onChange: (next: VisionOp) => void;
  onRemove: () => void;
  onOpenModels: (modelId?: string) => void;
}) {
  const t = useT();
  const [advanced, setAdvanced] = useState(false);
  const { pickMode, setPickMode } = useVisionStore();
  const definition = OP_BY_NAME.get(op.op);
  if (!definition) return null;

  const setParam = (key: string, value: unknown) => onChange({ ...op, params: { ...op.params, [key]: value } });
  const outputKind = outputKindOf(op, models);
  const model = op.op === 'infer' ? models.find((m) => m.id === op.params?.model) : undefined;
  const bypassable = canBypass(op, models);
  const params = definition.params.filter((p) => p.kind !== 'modelRef');
  const hueParams = op.op === 'hsvRange';

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wide text-arsist-muted">{t('vision.step.number', { n: index + 1 })}</p>
          <h3 className="text-sm font-medium flex items-center gap-2">
            <span className="text-arsist-muted"><OpIcon op={op.op} size={14} /></span>
            {t(`vision.op.${op.op}`)}
            <ValueChip kind={outputKind} />
          </h3>
          <p className="text-[11px] text-arsist-muted leading-relaxed mt-1">{t(`vision.opHint.${op.op}`)}</p>
        </div>
        <div className="flex items-center shrink-0">
          {bypassable && (
            <button className="btn-icon" title={op.disabled ? t('vision.step.enable') : t('vision.step.bypass')} onClick={() => onChange({ ...op, disabled: !op.disabled })}>
              {op.disabled ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
          <button className="btn-icon text-arsist-error" title={t('vision.step.remove')} onClick={onRemove}><Trash2 size={14} /></button>
        </div>
      </div>

      {op.disabled && <p className="text-[11px] text-amber-400 rounded bg-amber-400/10 px-3 py-2">{t('vision.step.bypassed')}</p>}

      {problems.map((problem, i) => (
        <p key={i} className="flex items-start gap-1.5 text-[11px] text-arsist-error rounded bg-arsist-error/10 px-3 py-2">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{describeProblem(t, problem.message)}</span>
        </p>
      ))}

      {/* 受け取るもの */}
      <section className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-arsist-muted">{t('vision.step.uses')}</p>
        {definition.inputs.map((kind, slot) => {
          const options = values.filter((v) => v.kind === kind);
          return (
            <label key={slot} className="flex items-center gap-2 text-[11px]">
              <ValueChip kind={kind} />
              <select
                className="input text-xs py-1 flex-1"
                value={op.in?.[slot] ?? ''}
                onChange={(e) => {
                  const inputs = [...(op.in ?? [])];
                  while (inputs.length < definition.inputs.length) inputs.push('');
                  inputs[slot] = e.target.value;
                  onChange({ ...op, in: inputs });
                }}
              >
                <option value="">{t('vision.pickInput', { kind: t(`vision.kind.${kind}`) })}</option>
                {options.map((v) => <option key={v.name} value={v.name}>{v.label}</option>)}
              </select>
            </label>
          );
        })}
      </section>

      {/* モデル */}
      {op.op === 'infer' && (
        <section className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-arsist-muted">{t('vision.step.model')}</p>
          <div className="flex items-center gap-2">
            <Cpu size={13} className="text-purple-300 shrink-0" />
            <select className="input text-xs py-1 flex-1" value={String(op.params?.model ?? '')} onChange={(e) => setParam('model', e.target.value)}>
              <option value="">{t('vision.step.pickModel')}</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name} — {t(`vision.model.task.${m.task}`)}</option>)}
            </select>
            <button className="btn-ghost text-[11px] shrink-0 px-2 py-1" onClick={() => onOpenModels(model?.id)}>
              {model ? t('vision.step.editModel') : t('vision.step.importModel')}
            </button>
          </div>
          {model && (
            <p className="text-[11px] text-arsist-muted leading-relaxed">
              {t('vision.step.modelSummary', { task: t(`vision.model.task.${model.task}`), size: `${model.input.width}×${model.input.height}`, labels: model.labels?.length ?? 0 })}
            </p>
          )}
        </section>
      )}

      {/* 設定 */}
      {params.length > 0 && (
        <section className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-arsist-muted">{t('vision.step.settings')}</p>

          {(hueParams || op.op === 'threshold') && (
            <button
              className={`w-full text-left rounded-lg px-3 py-2 flex items-center gap-2 text-[11px] transition-colors ${
                pickMode !== 'none' ? 'bg-arsist-accent/20 text-arsist-accent' : 'bg-arsist-surface hover:bg-arsist-hover'
              }`}
              onClick={() => setPickMode(pickMode !== 'none' ? 'none' : hueParams ? 'color' : 'brightness')}
            >
              <Pipette size={13} className="shrink-0" />
              <span>{hueParams ? t('vision.pick.buttonColor') : t('vision.pick.buttonBrightness')}</span>
            </button>
          )}
          {hueParams && (
            <HueRange
              min={Number(op.params?.hueMin ?? 0)}
              max={Number(op.params?.hueMax ?? 359)}
              onChange={(lo, hi) => onChange({ ...op, params: { ...op.params, hueMin: lo, hueMax: hi } })}
            />
          )}
          {(op.op === 'threshold' || op.op === 'canny' || op.op === 'motion') && (
            <Histogram step={inputStep} marker={op.op === 'threshold' && op.params?.mode === 'fixed' ? Number(op.params?.value ?? 128) : undefined} />
          )}

          <div className="grid grid-cols-1 gap-1.5">
            {params.filter((p) => !(hueParams && (p.key === 'hueMin' || p.key === 'hueMax'))).map((param) => (
              <ParamControl key={param.key} op={op} param={param} value={op.params?.[param.key]} values={values} onChange={(v) => setParam(param.key, v)} />
            ))}
          </div>
        </section>
      )}

      {/* 詳細 */}
      <section>
        <button className="flex items-center gap-1 text-[11px] text-arsist-muted" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t('vision.step.advanced')}
        </button>
        {advanced && (
          <div className="mt-2 space-y-1.5">
            <label className="grid grid-cols-[7rem_1fr] items-center gap-2 text-[11px]">
              <span className="text-arsist-muted">{t('vision.step.outputName')}</span>
              <input className="input text-xs py-1 font-mono" value={op.out} onChange={(e) => onChange({ ...op, out: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} />
            </label>
            <p className="text-[10px] text-arsist-muted leading-relaxed">{t('vision.step.outputNameHint')}</p>
          </div>
        )}
      </section>
    </div>
  );
}

/** 設定ひとつ分の入力欄。数は入力欄とスライダーの両方。 */
function ParamControl({
  op, param, value, values, onChange,
}: { op: VisionOp; param: OpParam; value: unknown; values: ValueOption[]; onChange: (v: unknown) => void }) {
  const t = useT();
  const label = t(`vision.param.${param.i18n}`);
  const helpKey = `vision.paramHint.${param.i18n}`;
  const help = t(helpKey);
  const current = value ?? param.default;

  // しきい値の方法で使わない欄は隠す (関係ない数字が並ぶと、どれを触ればいいか分からない)
  if (op.op === 'threshold') {
    const mode = String(op.params?.mode ?? 'otsu');
    if (param.key === 'value' && mode !== 'fixed') return null;
    if (['within', 'ratio', 'floor', 'ceiling'].includes(param.key) && mode !== 'relativeMedian') return null;
  }
  if (op.op === 'gate' && ['orRelativeTo', 'orFactor'].includes(param.key) && !op.params?.relativeTo && !op.params?.orRelativeTo) {
    // 「または」の条件は、基準が使われているときだけ
    if (param.key === 'orFactor') return null;
  }

  const choiceLabel = (choice: string) => {
    const key = `vision.choice.${choice}`;
    const text = t(key);
    return text === key ? choice : text;
  };

  return (
    <label className="grid grid-cols-[7rem_1fr] items-center gap-2 text-[11px]">
      <span className="text-arsist-muted leading-tight" title={help !== helpKey ? help : undefined}>{label}</span>
      {param.kind === 'choice' ? (
        <select className="input text-xs py-1" value={String(current)} onChange={(e) => onChange(e.target.value)}>
          {param.choices?.map((c) => <option key={c} value={c}>{choiceLabel(c)}</option>)}
        </select>
      ) : param.kind === 'bool' ? (
        <input type="checkbox" className="justify-self-start" checked={Boolean(current)} onChange={(e) => onChange(e.target.checked)} />
      ) : param.kind === 'color' ? (
        <span className="flex items-center gap-2">
          <input type="color" className="w-9 h-6 rounded cursor-pointer" value={String(current)} onChange={(e) => onChange(e.target.value)} />
          <input className="input text-xs py-1 w-24 font-mono" value={String(current)} onChange={(e) => onChange(e.target.value)} />
        </span>
      ) : param.kind === 'number' ? (
        <span className="flex items-center gap-2">
          {param.min !== undefined && param.max !== undefined && param.max - param.min <= 100000 && (
            <input type="range" className="flex-1 min-w-0" min={param.min} max={param.max} step={param.step} value={Number(current)} onChange={(e) => onChange(parseFloat(e.target.value))} />
          )}
          <input type="number" className="input text-xs py-1 w-20" min={param.min} max={param.max} step={param.step} value={Number(current)} onChange={(e) => onChange(parseFloat(e.target.value))} />
        </span>
      ) : param.kind === 'valueRef' ? (
        <select className="input text-xs py-1" value={String(current)} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('vision.step.noRef')}</option>
          {values.filter((v) => (REF_KINDS[param.key] ?? ['mask']).includes(v.kind)).map((v) => (
            <option key={v.name} value={v.name}>{v.label}</option>
          ))}
        </select>
      ) : (
        <input className="input text-xs py-1 font-mono" value={String(current)} onChange={(e) => onChange(e.target.value)} />
      )}
      {help !== helpKey && <span className="col-start-2 text-[10px] text-arsist-muted leading-snug -mt-0.5">{help}</span>}
    </label>
  );
}

/** 色相の帯と、拾う範囲。min > max は 0° またぎ (赤)。 */
function HueRange({ min, max, onChange }: { min: number; max: number; onChange: (lo: number, hi: number) => void }) {
  const t = useT();
  const wraps = min > max;
  const selected = wraps
    ? `linear-gradient(90deg, rgba(255,255,255,0.35) 0 ${(max / 359) * 100}%, transparent ${(max / 359) * 100}% ${(min / 359) * 100}%, rgba(255,255,255,0.35) ${(min / 359) * 100}% 100%)`
    : `linear-gradient(90deg, transparent 0 ${(min / 359) * 100}%, rgba(255,255,255,0.35) ${(min / 359) * 100}% ${(max / 359) * 100}%, transparent ${(max / 359) * 100}% 100%)`;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-arsist-muted">{t('vision.param.hueRange')}</span>
        <span className="font-mono">{min}° – {max}°{wraps ? ` (${t('vision.hueWraps')})` : ''}</span>
      </div>
      <div className="relative h-5 rounded" style={{ background: 'linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}>
        <div className="absolute inset-0 rounded" style={{ background: selected }} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="range" min={0} max={359} value={min} onChange={(e) => onChange(parseInt(e.target.value, 10), max)} />
        <input type="range" min={0} max={359} value={max} onChange={(e) => onChange(min, parseInt(e.target.value, 10))} />
      </div>
    </div>
  );
}

/** 入力の輝度の分布。しきい値をどこに置くかの目安。 */
function Histogram({ step, marker }: { step?: PreviewStep; marker?: number }) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bins = histogramOf(step);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bins) return;
    const w = canvas.width, h = canvas.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, w, h);
    const barWidth = w / bins.length;
    context.fillStyle = 'rgba(154,164,178,0.7)';
    bins.forEach((v, i) => context.fillRect(i * barWidth, h - v * (h - 2), Math.max(1, barWidth - 1), v * (h - 2)));
    if (marker !== undefined) {
      context.fillStyle = '#E2A33C';
      context.fillRect((marker / 256) * w - 1, 0, 2, h);
    }
  }, [bins, marker]);

  if (!bins) return null;
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-arsist-muted">{t('vision.histogram')}</span>
      <canvas ref={canvasRef} width={256} height={48} className="w-full h-12 rounded bg-arsist-bg" />
      <div className="flex justify-between text-[9px] text-arsist-muted font-mono"><span>0</span><span>128</span><span>255</span></div>
    </div>
  );
}
