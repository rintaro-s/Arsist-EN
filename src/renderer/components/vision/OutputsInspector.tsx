/**
 * 「結果をどこへ出すか」。
 *
 * 出力が無いパイプラインは、走っても誰にも届かない。ここは文として読めるようにする:
 *   「[塗った画] を現実に重ねる。描くのは [空] のところだけ」
 *   「見つけた [物] のそれぞれに札を置く。距離 2 m、札には [ラベル]」
 *   「[判定] を sky という名前で保存する」
 */
import { AlertTriangle, Globe, Image as ImageIcon, MapPin, Plus, Save, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import type { VisionOutput, VisionPipeline } from '../../../shared/types';
import type { PipelineProblem } from '../../vision/validate';
import type { ValueOption } from './StepInspector';
import { ValueChip, describeProblem } from './shared';

export function OutputsInspector({
  pipeline, values, problems, isViewport, sceneObjects, onChange,
}: {
  pipeline: VisionPipeline;
  values: ValueOption[];
  problems: PipelineProblem[];
  /** タスクの見る範囲が「画面上の枠」か。現実に重ねる・置く出力はそのときだけ使える */
  isViewport: boolean;
  /** assetId を持つシーンオブジェクト (anchor の移動先) */
  sceneObjects: Array<{ id: string; name: string }>;
  onChange: (next: VisionPipeline) => void;
}) {
  const t = useT();
  const setOutput = (index: number, next: VisionOutput) =>
    onChange({ ...pipeline, outputs: pipeline.outputs.map((o, i) => (i === index ? next : o)) });
  const removeOutput = (index: number) => onChange({ ...pipeline, outputs: pipeline.outputs.filter((_, i) => i !== index) });

  const last = (kinds: string[]) => values.filter((v) => kinds.includes(v.kind)).slice(-1)[0]?.name ?? '';
  const addOutput = (kind: VisionOutput['kind']) => {
    const next: VisionOutput = kind === 'store'
      ? { kind: 'store', value: last(['record', 'blobs', 'contours', 'quads']), storeAs: 'result' }
      : kind === 'world'
        ? { kind: 'world', value: last(['color']), alpha: last(['mask']) || undefined }
        : kind === 'anchor'
          ? { kind: 'anchor', value: last(['blobs', 'quads']), distance: 2, label: 'label', maxItems: 8 }
          : { kind: 'image', value: last(['color']), alpha: last(['mask']) || undefined, bindingId: '' };
    onChange({ ...pipeline, outputs: [...pipeline.outputs, next] });
  };

  const drawable = values.filter((v) => v.kind === 'color');
  const masks = values.filter((v) => v.kind === 'mask');
  const anchorable = values.filter((v) => v.kind === 'blobs' || v.kind === 'quads');
  const chosen = new Set(pipeline.outputs.filter((o) => o.kind === 'store').map((o) => o.value));
  const storable = values.filter((v) => ['record', 'blobs', 'contours', 'quads'].includes(v.kind) || chosen.has(v.name));

  const AlphaSelect = ({ value, onPick }: { value?: string; onPick: (v?: string) => void }) => (
    <select className="input text-xs py-1 inline-block w-auto" value={value ?? ''} onChange={(e) => onPick(e.target.value || undefined)}>
      <option value="">{t('vision.noAlpha')}</option>
      {masks.map((v) => <option key={v.name} value={v.name}>{v.label}</option>)}
    </select>
  );

  return (
    <div className="p-4 space-y-5">
      <div>
        <h3 className="text-sm font-medium">{t('vision.outputs')}</h3>
        <p className="text-[11px] text-arsist-muted leading-relaxed mt-1">{t('vision.outputsHint')}</p>
      </div>

      {problems.map((problem, i) => (
        <p key={i} className="flex items-start gap-1.5 text-[11px] text-arsist-error rounded bg-arsist-error/10 px-3 py-2">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{describeProblem(t, problem.message)}</span>
        </p>
      ))}

      <div className="space-y-2">
        {pipeline.outputs.map((output, index) => (
          <div key={index} className="rounded-lg bg-arsist-surface p-3 flex items-start gap-2.5">
            <span className="shrink-0 mt-0.5 text-arsist-muted">
              {output.kind === 'world' ? <Globe size={14} /> : output.kind === 'store' ? <Save size={14} /> : output.kind === 'anchor' ? <MapPin size={14} /> : <ImageIcon size={14} />}
            </span>
            <div className="flex-1 min-w-0 space-y-2 text-[11px] leading-relaxed">
              {output.kind === 'world' && (
                <>
                  <Sentence before={t('vision.out.worldBefore')} select={<ValueSelect value={output.value} options={drawable} kind="color" onChange={(v) => setOutput(index, { ...output, value: v })} />} after={t('vision.out.worldAfter')} />
                  <Sentence before={t('vision.out.alphaBefore')} select={<AlphaSelect value={output.alpha} onPick={(v) => setOutput(index, { ...output, alpha: v })} />} after="" />
                  {!isViewport && <p className="text-amber-400">{t('vision.out.worldNeedsViewport')}</p>}
                </>
              )}
              {output.kind === 'anchor' && (
                <>
                  <Sentence
                    before={t('vision.out.anchorBefore')}
                    select={<ValueSelect value={output.value} options={anchorable} kind="blobs" onChange={(v) => setOutput(index, { ...output, value: v })} />}
                    after={t('vision.out.anchorAfter')}
                  />
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span>{t('vision.out.anchorDistance')}</span>
                    <input type="range" min={0.3} max={10} step={0.1} value={output.distance ?? 2} className="w-24" onChange={(e) => setOutput(index, { ...output, distance: parseFloat(e.target.value) })} />
                    <span className="font-mono">{(output.distance ?? 2).toFixed(1)} m</span>
                    <span className="ml-2">{t('vision.out.anchorLabel')}</span>
                    <select className="input text-xs py-1 inline-block w-auto" value={output.label ?? 'label'} onChange={(e) => setOutput(index, { ...output, label: e.target.value })}>
                      <option value="label">{t('vision.out.anchorLabelName')}</option>
                      <option value="labelScore">{t('vision.out.anchorLabelScore')}</option>
                      <option value="score">{t('vision.out.anchorScore')}</option>
                      <option value="id">{t('vision.out.anchorId')}</option>
                      <option value="none">{t('vision.out.anchorNone')}</option>
                    </select>
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span>{t('vision.out.anchorObject')}</span>
                    <select className="input text-xs py-1 inline-block w-auto" value={output.objectId ?? ''} onChange={(e) => setOutput(index, { ...output, objectId: e.target.value || undefined })}>
                      <option value="">{t('vision.out.anchorNoObject')}</option>
                      {sceneObjects.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.id})</option>)}
                    </select>
                    <span className="ml-2">{t('vision.out.anchorMax')}</span>
                    <input type="number" min={1} max={64} className="input text-xs py-1 w-16" value={output.maxItems ?? 8} onChange={(e) => setOutput(index, { ...output, maxItems: Math.max(1, parseInt(e.target.value, 10) || 8) })} />
                  </p>
                  <p className="text-arsist-muted">{t('vision.out.anchorHint')}</p>
                  {!isViewport && <p className="text-amber-400">{t('vision.out.worldNeedsViewport')}</p>}
                </>
              )}
              {output.kind === 'store' && (
                <>
                  <Sentence
                    before={t('vision.out.storeBefore')}
                    select={<ValueSelect value={output.value} options={storable} onChange={(v) => setOutput(index, { ...output, value: v })} />}
                    after={t('vision.out.storeAfter')}
                    tail={<input className="input text-xs py-1 w-28 font-mono inline-block" value={output.storeAs} placeholder="result" onChange={(e) => setOutput(index, { ...output, storeAs: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} />}
                  />
                  {output.storeAs && <p className="text-arsist-muted">{t('vision.out.bindHint', { key: output.storeAs })}</p>}
                </>
              )}
              {output.kind === 'image' && (
                <>
                  <Sentence
                    before={t('vision.out.imageBefore')}
                    select={<ValueSelect value={output.value} options={drawable} kind="color" onChange={(v) => setOutput(index, { ...output, value: v })} />}
                    after={t('vision.out.imageAfter')}
                    tail={<input className="input text-xs py-1 w-28 font-mono inline-block" value={output.bindingId} placeholder="bindingId" onChange={(e) => setOutput(index, { ...output, bindingId: e.target.value })} />}
                  />
                  <Sentence before={t('vision.out.alphaBefore')} select={<AlphaSelect value={output.alpha} onPick={(v) => setOutput(index, { ...output, alpha: v })} />} after="" />
                </>
              )}
            </div>
            <button className="btn-icon shrink-0" onClick={() => removeOutput(index)}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-arsist-muted">{t('vision.out.add')}</p>
        <div className="grid grid-cols-2 gap-1.5">
          <AddButton icon={<MapPin size={13} />} title={t('vision.outputAnchor')} hint={t('vision.out.anchorAddHint')} onClick={() => addOutput('anchor')} />
          <AddButton icon={<Globe size={13} />} title={t('vision.outputWorld')} hint={t('vision.out.worldHint')} onClick={() => addOutput('world')} />
          <AddButton icon={<Save size={13} />} title={t('vision.outputStore')} hint={t('vision.out.storeHint')} onClick={() => addOutput('store')} />
          <AddButton icon={<ImageIcon size={13} />} title={t('vision.outputImage')} hint={t('vision.out.imageHint')} onClick={() => addOutput('image')} />
        </div>
      </div>
    </div>
  );
}

function Sentence({ before, select, after, tail }: { before: string; select: JSX.Element; after: string; tail?: JSX.Element }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5">
      {before && <span>{before}</span>}
      {select}
      {after && <span>{after}</span>}
      {tail}
    </p>
  );
}

function ValueSelect({ value, options, kind, onChange }: { value: string; options: ValueOption[]; kind?: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1">
      {kind && <ValueChip kind={kind} />}
      <select className="input text-xs py-1 inline-block w-auto max-w-[200px]" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('vision.pickValue')}</option>
        {options.map((v) => <option key={v.name} value={v.name}>{v.label}</option>)}
      </select>
    </span>
  );
}

function AddButton({ icon, title, hint, onClick }: { icon: JSX.Element; title: string; hint: string; onClick: () => void }) {
  return (
    <button className="text-left rounded-lg bg-arsist-surface hover:bg-arsist-hover p-2.5 space-y-0.5 transition-colors" onClick={onClick}>
      <span className="flex items-center gap-1.5 text-[11px] font-medium">{icon}{title}<Plus size={10} className="ml-auto opacity-50" /></span>
      <span className="block text-[10px] text-arsist-muted leading-snug">{hint}</span>
    </button>
  );
}
