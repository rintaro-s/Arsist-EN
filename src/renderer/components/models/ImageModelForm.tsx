/**
 * 画像のモデル (use: 'image') の定義: 何を解くか、入力の作り方、出力の読み方、ラベル。
 *
 * ONNX には「入力をどう正規化するか」「出力をどう読むか」が書かれていない。
 * 取り込み時にファイルを読んで下書きを作り、ここで直す。
 * よくある形 (torchvision の分類 / Ultralytics の検出 / [1,C,H,W] の分割) なら下書きのままで動く。
 */
import { useT } from '../../i18n';
import { useUIStore } from '../../stores/uiStore';
import type { ModelDefinition, ModelInputSpec, ModelOutputSpec, ModelTask } from '../../../shared/types';
import { defaultImageInput, defaultImageOutput } from '../../../shared/modelDefaults';

type NormPreset = 'unit' | 'imagenet' | 'raw' | 'custom';

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

function normPresetOf(input: ModelInputSpec): NormPreset {
  const near = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
  const zeros = new Array(input.channels).fill(0);
  const ones = new Array(input.channels).fill(1);
  if (Math.abs(input.scale - 1 / 255) < 1e-6 && near(input.mean, zeros) && near(input.std, ones)) return 'unit';
  if (Math.abs(input.scale - 1 / 255) < 1e-6 && near(input.mean, IMAGENET_MEAN) && near(input.std, IMAGENET_STD)) return 'imagenet';
  if (Math.abs(input.scale - 1) < 1e-6 && near(input.mean, zeros) && near(input.std, ones)) return 'raw';
  return 'custom';
}

function applyNormPreset(input: ModelInputSpec, preset: NormPreset): ModelInputSpec {
  const zeros = new Array(input.channels).fill(0);
  const ones = new Array(input.channels).fill(1);
  switch (preset) {
    case 'unit': return { ...input, scale: 1 / 255, mean: zeros, std: ones };
    case 'imagenet': return { ...input, scale: 1 / 255, mean: input.channels === 3 ? IMAGENET_MEAN : [0.5], std: input.channels === 3 ? IMAGENET_STD : [0.5] };
    case 'raw': return { ...input, scale: 1, mean: zeros, std: ones };
    default: return input;
  }
}

export function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="grid grid-cols-[10rem_1fr] items-center gap-2 text-[12px]">
      <span className="text-arsist-muted">{label}</span>
      {children}
      {hint && <span className="col-start-2 text-[10px] text-arsist-muted leading-snug -mt-1">{hint}</span>}
    </label>
  );
}

export function ImageModelForm({ model, onChange }: { model: ModelDefinition; onChange: (u: Partial<ModelDefinition>) => void }) {
  const t = useT();
  const { addNotification } = useUIStore();
  const input = model.input ?? defaultImageInput();
  const output = model.output ?? defaultImageOutput(model.task ?? 'raw');
  const setInput = (u: Partial<ModelInputSpec>) => onChange({ input: { ...input, ...u } });
  const setOutput = (u: Partial<ModelOutputSpec>) => onChange({ output: { ...output, ...u } });
  const preset = normPresetOf(input);
  const inspection = model.inspection;

  const loadLabels = async () => {
    const result = await window.electronAPI.model.readLabels();
    if (result.success && result.labels) onChange({ labels: result.labels });
    else if (result.error !== 'cancelled') addNotification({ type: 'error', message: t('vision.model.labelsUnreadable') });
  };

  return (
    <div className="space-y-5">
      {/* 何を解くか */}
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-arsist-muted">{t('vision.model.section.task')}</p>
        <div className="grid grid-cols-2 gap-1.5">
          {(['classify', 'detect', 'segment', 'raw'] as ModelTask[]).map((task) => (
            <button
              key={task}
              className={`text-left rounded-lg p-2.5 ${model.task === task ? 'bg-arsist-accent/15 ring-1 ring-arsist-accent' : 'bg-arsist-surface hover:bg-arsist-hover'}`}
              onClick={() => onChange({ task, output: model.task === task ? output : { ...defaultImageOutput(task), name: output.name } })}
            >
              <span className="block text-[12px] font-medium">{t(`vision.model.task.${task}`)}</span>
              <span className="block text-[10px] text-arsist-muted leading-snug mt-0.5">{t(`vision.model.taskHint.${task}`)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 入力 */}
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-arsist-muted">{t('vision.model.section.input')}</p>
        {inspection && inspection.inputs.length > 1 && (
          <Row label={t('vision.model.inputName')}>
            <select className="input text-xs py-1" value={input.name ?? ''} onChange={(e) => setInput({ name: e.target.value || undefined })}>
              {inspection.inputs.map((i) => <option key={i.name} value={i.name}>{i.name} [{i.dims.join(',')}]</option>)}
            </select>
          </Row>
        )}
        <Row label={t('vision.model.inputSize')}>
          <span className="flex items-center gap-1">
            <input type="number" className="input text-xs py-1 w-20" min={8} max={4096} value={input.width} onChange={(e) => setInput({ width: Math.max(8, parseInt(e.target.value, 10) || 8) })} />
            <span className="text-arsist-muted">×</span>
            <input type="number" className="input text-xs py-1 w-20" min={8} max={4096} value={input.height} onChange={(e) => setInput({ height: Math.max(8, parseInt(e.target.value, 10) || 8) })} />
          </span>
        </Row>
        <Row label={t('vision.model.layout')}>
          <span className="flex items-center gap-3">
            <select className="input text-xs py-1 w-28" value={input.layout} onChange={(e) => setInput({ layout: e.target.value as 'NCHW' | 'NHWC' })}>
              <option value="NCHW">NCHW (PyTorch)</option>
              <option value="NHWC">NHWC (TensorFlow)</option>
            </select>
            <select className="input text-xs py-1 w-28" value={input.channels} onChange={(e) => setInput({ channels: (parseInt(e.target.value, 10) === 1 ? 1 : 3) })}>
              <option value={3}>{t('vision.model.channels3')}</option>
              <option value={1}>{t('vision.model.channels1')}</option>
            </select>
            <select className="input text-xs py-1 w-20" value={input.colorOrder} onChange={(e) => setInput({ colorOrder: e.target.value as 'RGB' | 'BGR' })}>
              <option value="RGB">RGB</option>
              <option value="BGR">BGR</option>
            </select>
          </span>
        </Row>
        <Row label={t('vision.model.normalize')} hint={t('vision.model.normalizeHint')}>
          <select className="input text-xs py-1" value={preset} onChange={(e) => setInput(applyNormPreset(input, e.target.value as NormPreset))}>
            <option value="unit">{t('vision.model.norm.unit')}</option>
            <option value="imagenet">{t('vision.model.norm.imagenet')}</option>
            <option value="raw">{t('vision.model.norm.raw')}</option>
            <option value="custom">{t('vision.model.norm.custom')}</option>
          </select>
        </Row>
        {preset === 'custom' && (
          <>
            <Row label="scale"><input className="input text-xs py-1 font-mono" value={String(input.scale)} onChange={(e) => setInput({ scale: parseFloat(e.target.value) || 0 })} /></Row>
            <Row label="mean"><input className="input text-xs py-1 font-mono" value={input.mean.join(', ')} onChange={(e) => setInput({ mean: e.target.value.split(',').map((v) => parseFloat(v) || 0) })} /></Row>
            <Row label="std"><input className="input text-xs py-1 font-mono" value={input.std.join(', ')} onChange={(e) => setInput({ std: e.target.value.split(',').map((v) => parseFloat(v) || 1) })} /></Row>
          </>
        )}
        <Row label={t('vision.model.resize')} hint={t('vision.model.resizeHint')}>
          <select className="input text-xs py-1" value={input.resize} onChange={(e) => setInput({ resize: e.target.value as 'stretch' | 'letterbox' })}>
            <option value="stretch">{t('vision.model.resize.stretch')}</option>
            <option value="letterbox">{t('vision.model.resize.letterbox')}</option>
          </select>
        </Row>
      </section>

      {/* 出力 */}
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-arsist-muted">{t('vision.model.section.output')}</p>
        {inspection && inspection.outputs.length > 1 && output.boxLayout !== 'separate' && (
          <Row label={t('vision.model.outputName')}>
            <select className="input text-xs py-1" value={output.name ?? ''} onChange={(e) => setOutput({ name: e.target.value || undefined })}>
              {inspection.outputs.map((o) => <option key={o.name} value={o.name}>{o.name} [{o.dims.join(',')}]</option>)}
            </select>
          </Row>
        )}

        {model.task === 'classify' && (
          <>
            <Row label={t('vision.model.softmax')} hint={t('vision.model.softmaxHint')}>
              <input type="checkbox" className="justify-self-start" checked={output.softmax ?? true} onChange={(e) => setOutput({ softmax: e.target.checked })} />
            </Row>
            <Row label={t('vision.model.topK')}>
              <input type="number" className="input text-xs py-1 w-20" min={1} max={50} value={output.topK ?? 5} onChange={(e) => setOutput({ topK: Math.max(1, parseInt(e.target.value, 10) || 5) })} />
            </Row>
          </>
        )}

        {model.task === 'detect' && (
          <>
            <Row label={t('vision.model.boxLayout')} hint={t('vision.model.boxLayoutHint')}>
              <select className="input text-xs py-1" value={output.boxLayout ?? 'yolo'} onChange={(e) => setOutput({ boxLayout: e.target.value as ModelOutputSpec['boxLayout'] })}>
                <option value="yolo">YOLOv8 / v11 — [1, 4+C, N]</option>
                <option value="yolo5">YOLOv5 — [1, N, 5+C]</option>
                <option value="xyxyScoreClass">NMS済み — [N, 6] (x1,y1,x2,y2,score,class)</option>
                <option value="separate">{t('vision.model.boxLayout.separate')}</option>
              </select>
            </Row>
            {output.boxLayout === 'separate' && (
              <Row label={t('vision.model.separateNames')}>
                <span className="flex gap-1">
                  <input className="input text-xs py-1 w-24 font-mono" placeholder="boxes" value={output.boxesName ?? ''} onChange={(e) => setOutput({ boxesName: e.target.value || undefined })} />
                  <input className="input text-xs py-1 w-24 font-mono" placeholder="scores" value={output.scoresName ?? ''} onChange={(e) => setOutput({ scoresName: e.target.value || undefined })} />
                  <input className="input text-xs py-1 w-24 font-mono" placeholder="classes" value={output.classesName ?? ''} onChange={(e) => setOutput({ classesName: e.target.value || undefined })} />
                </span>
              </Row>
            )}
            <Row label={t('vision.model.boxFormat')}>
              <span className="flex items-center gap-3">
                <select className="input text-xs py-1 w-28" value={output.boxFormat ?? 'cxcywh'} onChange={(e) => setOutput({ boxFormat: e.target.value as ModelOutputSpec['boxFormat'] })}>
                  <option value="cxcywh">cx, cy, w, h</option>
                  <option value="xyxy">x1, y1, x2, y2</option>
                  <option value="xywh">x, y, w, h</option>
                </select>
                <label className="flex items-center gap-1 text-[11px]">
                  <input type="checkbox" checked={output.boxesNormalized ?? false} onChange={(e) => setOutput({ boxesNormalized: e.target.checked })} />
                  {t('vision.model.boxesNormalized')}
                </label>
              </span>
            </Row>
            <Row label={t('vision.model.scoreThreshold')}>
              <span className="flex items-center gap-2">
                <input type="range" className="flex-1" min={0.05} max={0.95} step={0.05} value={output.scoreThreshold ?? 0.35} onChange={(e) => setOutput({ scoreThreshold: parseFloat(e.target.value) })} />
                <span className="font-mono w-10">{(output.scoreThreshold ?? 0.35).toFixed(2)}</span>
              </span>
            </Row>
            <Row label={t('vision.model.iouThreshold')}>
              <span className="flex items-center gap-2">
                <input type="range" className="flex-1" min={0.1} max={0.9} step={0.05} value={output.iouThreshold ?? 0.5} onChange={(e) => setOutput({ iouThreshold: parseFloat(e.target.value) })} />
                <span className="font-mono w-10">{(output.iouThreshold ?? 0.5).toFixed(2)}</span>
              </span>
            </Row>
            <Row label={t('vision.model.maxItems')}>
              <input type="number" className="input text-xs py-1 w-20" min={1} max={200} value={output.maxItems ?? 20} onChange={(e) => setOutput({ maxItems: Math.max(1, parseInt(e.target.value, 10) || 20) })} />
            </Row>
          </>
        )}

        {model.task === 'segment' && (
          <>
            <Row label={t('vision.model.maskMode')} hint={t('vision.model.maskModeHint')}>
              <select className="input text-xs py-1" value={output.maskMode ?? 'argmax'} onChange={(e) => setOutput({ maskMode: e.target.value as 'argmax' | 'sigmoid' })}>
                <option value="argmax">{t('vision.model.maskMode.argmax')}</option>
                <option value="sigmoid">{t('vision.model.maskMode.sigmoid')}</option>
              </select>
            </Row>
            {(output.maskMode ?? 'argmax') === 'argmax' ? (
              <Row label={t('vision.model.classIndices')} hint={t('vision.model.classIndicesHint')}>
                <input className="input text-xs py-1 font-mono" value={(output.classIndices ?? [1]).join(', ')}
                  onChange={(e) => setOutput({ classIndices: e.target.value.split(',').map((v) => parseInt(v, 10)).filter((v) => Number.isFinite(v)) })} />
              </Row>
            ) : (
              <>
                <Row label={t('vision.model.maskThreshold')}>
                  <span className="flex items-center gap-2">
                    <input type="range" className="flex-1" min={0.05} max={0.95} step={0.05} value={output.maskThreshold ?? 0.5} onChange={(e) => setOutput({ maskThreshold: parseFloat(e.target.value) })} />
                    <span className="font-mono w-10">{(output.maskThreshold ?? 0.5).toFixed(2)}</span>
                  </span>
                </Row>
                <Row label={t('vision.model.applySigmoid')} hint={t('vision.model.applySigmoidHint')}>
                  <input type="checkbox" className="justify-self-start" checked={output.applySigmoid ?? false} onChange={(e) => setOutput({ applySigmoid: e.target.checked })} />
                </Row>
              </>
            )}
          </>
        )}

        {model.task === 'raw' && (
          <Row label={t('vision.model.rawLimit')}>
            <input type="number" className="input text-xs py-1 w-20" min={1} max={1024} value={output.rawLimit ?? 16} onChange={(e) => setOutput({ rawLimit: Math.max(1, parseInt(e.target.value, 10) || 16) })} />
          </Row>
        )}
      </section>

      {/* ラベル */}
      {model.task !== 'raw' && (
        <section className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-arsist-muted flex items-center gap-2">
            {t('vision.model.section.labels')}
            <button className="btn-ghost text-[10px]" onClick={() => { void loadLabels(); }}>{t('vision.model.loadLabels')}</button>
            <span className="ml-auto normal-case tracking-normal">{t('vision.model.labelCount', { count: model.labels?.length ?? 0 })}</span>
          </p>
          <textarea
            className="input text-xs font-mono w-full h-28"
            placeholder={t('vision.model.labelsPlaceholder')}
            value={(model.labels ?? []).join('\n')}
            onChange={(e) => onChange({ labels: e.target.value.split('\n').map((l) => l.trim()).filter((l) => l.length > 0) })}
          />
        </section>
      )}

    </div>
  );
}
