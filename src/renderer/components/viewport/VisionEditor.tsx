/**
 * 画像処理エディタ。
 *
 * 「一手ずつ積み上げて、各手の結果をその場で見る」形にしてある。画像処理は
 * 途中経過が見えないと当てずっぽうになるので、ノードを線で繋ぐ形よりも、
 * 縦に並べて各段のサムネイルを出す方が、はるかに早く目的にたどり着ける。
 *
 * 走らせているのは実機と同じ C# なので、ここで見えているものがそのまま端末で起きる。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Plus, Trash2, ImageIcon, ChevronUp, ChevronDown, AlertTriangle } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useT } from '../../i18n';
import type { PerceptionTask, VisionOp, VisionOpType, VisionOutput, VisionPipeline } from '../../../shared/types';
import { KIND_COLORS, OP_BY_NAME, OP_CATALOG, SOURCE_NAME, defaultParams, type OpDefinition } from '../../vision/opCatalog';
import { inferTypes, validatePipeline } from '../../vision/validate';
import { PIPELINE_PRESETS } from '../../vision/presets';
import { decodeTestImage, paintStep, usePreview, type PreviewStep, type TestImage } from '../../vision/usePreview';

const GROUPS: OpDefinition['group'][] = ['convert', 'find', 'shape', 'measure', 'draw'];

/** 名前が衝突しないようにする。'mask' が既にあれば 'mask2'。 */
function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export function VisionEditor() {
  const t = useT();
  const { project, updatePerceptionTask } = useProjectStore();

  const tasks = useMemo(
    () => (project?.perception?.tasks ?? []).filter((x) => x.type === 'vision'),
    [project],
  );
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = tasks.find((x) => x.id === taskId) ?? tasks[0] ?? null;

  const [testImage, setTestImage] = useState<TestImage | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const pipeline = task?.pipeline ?? null;
  const preview = usePreview(pipeline, testImage);

  const problems = useMemo(() => (pipeline ? validatePipeline(pipeline) : []), [pipeline]);
  const types = useMemo(() => (pipeline ? inferTypes(pipeline) : new Map()), [pipeline]);

  const setPipeline = (next: VisionPipeline) => {
    if (!task) return;
    updatePerceptionTask(task.id, { pipeline: next } as Partial<PerceptionTask>);
  };

  if (!project) return null;

  if (tasks.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-3">
          <p className="text-sm text-arsist-muted">{t('vision.noTasks')}</p>
          <p className="text-[11px] text-arsist-muted leading-relaxed">{t('vision.noTasksHint')}</p>
        </div>
      </div>
    );
  }

  const takenNames = new Set<string>([SOURCE_NAME, ...(pipeline?.ops ?? []).map((o) => o.out)]);

  const addOp = (op: VisionOpType) => {
    if (!pipeline) return;
    const definition = OP_BY_NAME.get(op);
    if (!definition) return;

    const previous = pipeline.ops.length > 0 ? pipeline.ops[pipeline.ops.length - 1].out : SOURCE_NAME;
    // 直前の出力が型として合うなら、そのまま繋いでおく。合わなければ空にして選ばせる。
    const inputs = definition.inputs.map((kind, index) =>
      index === 0 && types.get(previous) === kind ? previous : '');

    const next: VisionOp = {
      id: `${op}-${Date.now().toString(36)}`,
      op,
      out: uniqueName(definition.output, takenNames),
      in: inputs,
      params: defaultParams(op),
    };
    setPipeline({ ...pipeline, ops: [...pipeline.ops, next] });
    setSelected(next.id);
  };

  return (
    <div className="w-full h-full flex overflow-hidden">
      {/* 道具箱 */}
      <div className="w-48 shrink-0 bg-arsist-panel overflow-y-auto p-2 space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-arsist-muted mb-1">{t('vision.presets')}</p>
          <div className="space-y-1">
            {PIPELINE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className="w-full text-left px-2 py-1.5 rounded text-[11px] bg-arsist-surface hover:bg-arsist-hover"
                title={t(`vision.presetHint.${preset.id}`)}
                onClick={() => setPipeline(preset.build())}
              >
                {t(`vision.preset.${preset.id}`)}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-arsist-muted leading-tight mt-1.5">{t('vision.presetsAreJustOps')}</p>
        </div>

        {GROUPS.map((group) => (
          <div key={group}>
            <p className="text-[10px] uppercase tracking-wide text-arsist-muted mb-1">
              {t(`vision.group.${group}`)}
            </p>
            <div className="space-y-0.5">
              {OP_CATALOG.filter((d) => d.group === group).map((definition) => (
                <button
                  key={definition.op}
                  className="w-full flex items-center gap-1.5 text-left px-2 py-1 rounded text-[11px] hover:bg-arsist-hover"
                  title={t(`vision.opHint.${definition.op}`)}
                  onClick={() => addOp(definition.op)}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: KIND_COLORS[definition.output] }}
                  />
                  <span className="truncate">{t(`vision.op.${definition.op}`)}</span>
                  <Plus size={10} className="ml-auto opacity-40 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 手順 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <select
            className="input text-xs py-1 max-w-[200px]"
            value={task?.id ?? ''}
            onChange={(e) => setTaskId(e.target.value)}
          >
            {tasks.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>

          <TestImagePicker image={testImage} onPick={setTestImage} />

          {preview.running && <span className="text-[10px] text-arsist-muted">{t('vision.running')}</span>}
          {preview.unavailable === 'dotnet' && (
            <span className="text-[10px] text-amber-400">{t('vision.needsDotnet')}</span>
          )}
          {preview.gated && (
            <span className="text-[10px] text-amber-400">
              {t('vision.gated', { reason: preview.gateReason ?? '' })}
            </span>
          )}
        </div>

        <StepCard
          name={SOURCE_NAME}
          title={t('vision.source')}
          kind="color"
          step={preview.steps.find((s) => s.name === SOURCE_NAME)}
        />

        {(pipeline?.ops ?? []).map((op, index) => (
          <OpCard
            key={op.id}
            op={op}
            index={index}
            total={pipeline!.ops.length}
            selected={selected === op.id}
            problems={problems.filter((p) => p.opId === op.id)}
            step={preview.steps.find((s) => s.name === op.out)}
            available={[...types.entries()]}
            onSelect={() => setSelected(op.id)}
            onChange={(next) => setPipeline({
              ...pipeline!,
              ops: pipeline!.ops.map((o) => (o.id === op.id ? next : o)),
            })}
            onMove={(delta) => {
              const ops = [...pipeline!.ops];
              const target = index + delta;
              if (target < 0 || target >= ops.length) return;
              [ops[index], ops[target]] = [ops[target], ops[index]];
              setPipeline({ ...pipeline!, ops });
            }}
            onRemove={() => setPipeline({
              ...pipeline!,
              ops: pipeline!.ops.filter((o) => o.id !== op.id),
            })}
          />
        ))}

        <OutputsCard
          pipeline={pipeline}
          types={types}
          problems={problems.filter((p) => !p.opId)}
          onChange={setPipeline}
        />
      </div>
    </div>
  );
}

function TestImagePicker({ image, onPick }: { image: TestImage | null; onPick: (i: TestImage) => void }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        className="btn-ghost text-[11px] flex items-center gap-1"
        onClick={() => inputRef.current?.click()}
      >
        <ImageIcon size={12} />
        {image ? image.name : t('vision.pickTestImage')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) onPick(await decodeTestImage(file));
        }}
      />
    </>
  );
}

function StepCard(
  { name, title, kind, step }: { name: string; title: string; kind: string; step?: PreviewStep },
) {
  return (
    <div className="flex items-center gap-3 bg-arsist-surface rounded p-2">
      <StepThumb step={step} />
      <div className="min-w-0">
        <p className="text-xs">{title}</p>
        <ValueChip name={name} kind={kind} />
      </div>
    </div>
  );
}

function StepThumb({ step }: { step?: PreviewStep }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && step) paintStep(canvasRef.current, step);
  }, [step]);

  if (!step) {
    return <div className="w-24 h-16 shrink-0 rounded bg-arsist-bg" />;
  }
  if (!step.rgba) {
    // 画にならない値。数や件数をそのまま出す方が役に立つ。
    return (
      <div className="w-24 h-16 shrink-0 rounded bg-arsist-bg p-1 overflow-hidden text-[8px] leading-tight font-mono">
        {step.record
          ? Object.entries(step.record).slice(0, 6).map(([k, v]) => (
              <div key={k} className="truncate">{k}={String(v)}</div>
            ))
          : step.count !== undefined
            ? <div>{step.count} items</div>
            : step.boundary
              ? <div>{step.boundary.length} pts</div>
              : null}
      </div>
    );
  }
  return <canvas ref={canvasRef} className="w-24 h-16 shrink-0 rounded object-contain bg-arsist-bg" />;
}

function ValueChip({ name, kind }: { name: string; kind: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded"
      style={{ backgroundColor: `${KIND_COLORS[kind as keyof typeof KIND_COLORS] ?? '#666'}22` }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: KIND_COLORS[kind as keyof typeof KIND_COLORS] ?? '#666' }}
      />
      {name}
    </span>
  );
}

function OpCard({
  op, index, total, selected, problems, step, available, onSelect, onChange, onMove, onRemove,
}: {
  op: VisionOp;
  index: number;
  total: number;
  selected: boolean;
  problems: { message: string }[];
  step?: PreviewStep;
  available: [string, string][];
  onSelect: () => void;
  onChange: (next: VisionOp) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const definition = OP_BY_NAME.get(op.op);
  if (!definition) return null;

  const setParam = (key: string, value: unknown) =>
    onChange({ ...op, params: { ...op.params, [key]: value } });

  return (
    <div
      className={`rounded p-2 ${selected ? 'bg-arsist-hover' : 'bg-arsist-surface'} ${
        problems.length > 0 ? 'ring-1 ring-arsist-error' : ''
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        <StepThumb step={step} />

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-arsist-muted w-4 shrink-0">{index + 1}</span>
            <span className="text-xs">{t(`vision.op.${op.op}`)}</span>
            <div className="ml-auto flex items-center gap-0.5">
              <button className="btn-icon" disabled={index === 0} onClick={(e) => { e.stopPropagation(); onMove(-1); }}>
                <ChevronUp size={12} />
              </button>
              <button className="btn-icon" disabled={index === total - 1} onClick={(e) => { e.stopPropagation(); onMove(1); }}>
                <ChevronDown size={12} />
              </button>
              <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          {/* 入力の結線 */}
          <div className="flex flex-wrap items-center gap-1.5">
            {definition.inputs.map((kind, slot) => (
              <select
                key={slot}
                className="input text-[10px] py-0.5 px-1 max-w-[130px]"
                value={op.in?.[slot] ?? ''}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const inputs = [...(op.in ?? [])];
                  inputs[slot] = e.target.value;
                  onChange({ ...op, in: inputs });
                }}
              >
                <option value="">{t('vision.pickInput', { kind: t(`vision.kind.${kind}`) })}</option>
                {available
                  .filter(([, valueKind]) => valueKind === kind)
                  .map(([name]) => <option key={name} value={name}>{name}</option>)}
              </select>
            ))}
            <span className="text-[10px] text-arsist-muted">&rarr;</span>
            <input
              className="input text-[10px] py-0.5 px-1 w-24 font-mono"
              value={op.out}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onChange({ ...op, out: e.target.value })}
            />
            <ValueChip name="" kind={definition.output} />
          </div>

          {/* パラメータ */}
          {selected && definition.params.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {definition.params.map((param) => (
                <label key={param.key} className="flex items-center gap-1 text-[10px]">
                  <span className="text-arsist-muted truncate w-20 shrink-0" title={t(`vision.param.${param.i18n}`)}>
                    {t(`vision.param.${param.i18n}`)}
                  </span>
                  {param.kind === 'choice' ? (
                    <select
                      className="input text-[10px] py-0.5 px-1 flex-1 min-w-0"
                      value={String(op.params?.[param.key] ?? param.default)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setParam(param.key, e.target.value)}
                    >
                      {param.choices?.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : param.kind === 'bool' ? (
                    <input
                      type="checkbox"
                      checked={Boolean(op.params?.[param.key] ?? param.default)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setParam(param.key, e.target.checked)}
                    />
                  ) : param.kind === 'color' ? (
                    <input
                      type="color"
                      className="w-full h-5"
                      value={String(op.params?.[param.key] ?? param.default)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setParam(param.key, e.target.value)}
                    />
                  ) : param.kind === 'number' ? (
                    <input
                      type="number"
                      className="input text-[10px] py-0.5 px-1 flex-1 min-w-0"
                      min={param.min}
                      max={param.max}
                      step={param.step}
                      value={Number(op.params?.[param.key] ?? param.default)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setParam(param.key, parseFloat(e.target.value))}
                    />
                  ) : (
                    <input
                      className="input text-[10px] py-0.5 px-1 flex-1 min-w-0 font-mono"
                      value={String(op.params?.[param.key] ?? param.default)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setParam(param.key, e.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
          )}

          {problems.map((problem, i) => (
            <p key={i} className="flex items-center gap-1 text-[10px] text-arsist-error">
              <AlertTriangle size={10} className="shrink-0" />
              {t(`vision.problem.${problem.message.split(':')[0]}`, {
                detail: problem.message.split(':').slice(1).join(':'),
              })}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function OutputsCard({
  pipeline, types, problems, onChange,
}: {
  pipeline: VisionPipeline | null;
  types: Map<string, string>;
  problems: { message: string }[];
  onChange: (next: VisionPipeline) => void;
}) {
  const t = useT();
  if (!pipeline) return null;

  const setOutput = (index: number, next: VisionOutput) =>
    onChange({ ...pipeline, outputs: pipeline.outputs.map((o, i) => (i === index ? next : o)) });

  return (
    <div className="bg-arsist-surface rounded p-2 space-y-2">
      <div className="flex items-center gap-2">
        <Play size={12} className="text-arsist-muted" />
        <span className="text-xs">{t('vision.outputs')}</span>
        <button
          className="btn-ghost text-[10px] ml-auto"
          onClick={() => onChange({
            ...pipeline,
            outputs: [...pipeline.outputs, { kind: 'store', value: '', storeAs: 'result' }],
          })}
        >
          <Plus size={10} /> {t('vision.addOutput')}
        </button>
      </div>
      <p className="text-[9px] text-arsist-muted leading-tight">{t('vision.outputsHint')}</p>

      {pipeline.outputs.map((output, index) => (
        <div key={index} className="flex flex-wrap items-center gap-1.5">
          <select
            className="input text-[10px] py-0.5 px-1 w-24"
            value={output.kind}
            onChange={(e) => {
              const kind = e.target.value as VisionOutput['kind'];
              setOutput(index, kind === 'store'
                ? { kind: 'store', value: output.value, storeAs: 'result' }
                : kind === 'world'
                  ? { kind: 'world', value: output.value }
                  : { kind: 'image', value: output.value, bindingId: '' });
            }}
          >
            <option value="world">{t('vision.outputWorld')}</option>
            <option value="store">{t('vision.outputStore')}</option>
            <option value="image">{t('vision.outputImage')}</option>
          </select>

          <select
            className="input text-[10px] py-0.5 px-1 w-28"
            value={output.value}
            onChange={(e) => setOutput(index, { ...output, value: e.target.value })}
          >
            <option value="">{t('vision.pickValue')}</option>
            {[...types.keys()].map((name) => <option key={name} value={name}>{name}</option>)}
          </select>

          {(output.kind === 'world' || output.kind === 'image') && (
            <select
              className="input text-[10px] py-0.5 px-1 w-28"
              value={output.alpha ?? ''}
              onChange={(e) => setOutput(index, { ...output, alpha: e.target.value || undefined })}
              title={t('vision.alphaHint')}
            >
              <option value="">{t('vision.noAlpha')}</option>
              {[...types.entries()]
                .filter(([, kind]) => kind === 'mask')
                .map(([name]) => <option key={name} value={name}>{name}</option>)}
            </select>
          )}

          {output.kind === 'store' && (
            <input
              className="input text-[10px] py-0.5 px-1 w-28 font-mono"
              value={output.storeAs}
              placeholder="storeAs"
              onChange={(e) => setOutput(index, { ...output, storeAs: e.target.value })}
            />
          )}

          {output.kind === 'image' && (
            <input
              className="input text-[10px] py-0.5 px-1 w-28 font-mono"
              value={output.bindingId}
              placeholder="bindingId"
              onChange={(e) => setOutput(index, { ...output, bindingId: e.target.value })}
            />
          )}

          <button
            className="btn-icon"
            onClick={() => onChange({
              ...pipeline,
              outputs: pipeline.outputs.filter((_, i) => i !== index),
            })}
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}

      {problems.map((problem, i) => (
        <p key={i} className="flex items-center gap-1 text-[10px] text-arsist-error">
          <AlertTriangle size={10} className="shrink-0" />
          {t(`vision.problem.${problem.message.split(':')[0]}`, {
            detail: problem.message.split(':').slice(1).join(':'),
          })}
        </p>
      ))}
    </div>
  );
}
