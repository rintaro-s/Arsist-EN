/**
 * モデルタブ: プロジェクトに取り込んだ学習済みモデル (ONNX) の一覧・定義・試す・スクリプトからの使い方。
 *
 * モデルは画像認識の部品ではなく、プロジェクトの独立した資産。用途で分ける:
 *   画像      画像認識の一手 (`infer`) と、スクリプトの model.runImage
 *   文章      LLM (model.generate)・文の埋め込み (model.embed)・文章の分類 (model.classifyText)
 *   テンソル  何でも。スクリプトの model.run に名前つきのテンソルを渡す
 *
 * 左に一覧、中央に定義、右に「試す」(実機と同じ C# をその場で動かす)。
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, Check, Copy, Cpu, Download, FileUp, Image as ImageIcon, MessageSquareText, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { ModelDefinition, ModelUse } from '../../../shared/types';
import { switchModelUse } from '../../../shared/modelDefaults';
import { resolveRuntime, unsupportedOnDevice } from '../../../shared/unityOps';
import { useModelsStore } from '../../models/modelsStore';
import { HuggingFaceDialog } from './HuggingFaceDialog';
import { ImageModelForm, Row } from './ImageModelForm';
import { TextModelForm } from './TextModelForm';
import { ModelTryPanel } from './ModelTryPanel';

const USES: ModelUse[] = ['image', 'text', 'tensor'];

export function UseIcon({ use, size = 14 }: { use: ModelUse; size?: number }) {
  if (use === 'text') return <MessageSquareText size={size} />;
  if (use === 'tensor') return <Boxes size={size} />;
  return <ImageIcon size={size} />;
}

function subtitle(model: ModelDefinition, t: (key: string, params?: Record<string, string | number>) => string): string {
  const size = model.inspection?.fileSize ? ` · ${(model.inspection.fileSize / 1048576).toFixed(model.inspection.fileSize > 104857600 ? 0 : 1)} MB` : '';
  if (model.use === 'text') return `${t(`models.text.task.${model.text?.task ?? 'generate'}`)}${size}`;
  if (model.use === 'image') return `${t(`vision.model.task.${model.task ?? 'raw'}`)}${model.input ? ` · ${model.input.width}×${model.input.height}` : ''}${size}`;
  return `${t('models.use.tensor')}${size}`;
}

export function ModelsWorkspace() {
  const t = useT();
  const { project, projectPath, readOnly, addModel, updateModel, removeModel } = useProjectStore();
  const { addNotification } = useUIStore();
  const { selectedId, select, warnings, setWarnings } = useModelsStore();
  const [importing, setImporting] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const models = useMemo(() => project?.models ?? [], [project]);

  const afterImport = (model: ModelDefinition, warnings: string[]) => {
    addModel(model);
    select(model.id);
    setWarnings(model.id, warnings);
  };

  useEffect(() => {
    if (!selectedId || !models.some((m) => m.id === selectedId)) select(models[0]?.id ?? null);
  }, [models, selectedId, select]);

  const selected = models.find((m) => m.id === selectedId) ?? null;

  const importModel = async () => {
    if (!projectPath) return;
    setImporting(true);
    try {
      const result = await window.electronAPI.model.import(projectPath);
      if (!result.success) {
        if (result.error !== 'cancelled') {
          addNotification({ type: 'error', message: t(`vision.model.importError.${result.error === 'notOnnx' ? 'notOnnx' : 'generic'}`, { detail: result.error ?? '' }) });
        }
        return;
      }
      if (result.model) {
        addModel(result.model);
        select(result.model.id);
        setWarnings(result.model.id, result.warnings ?? []);
        addNotification({ type: 'success', message: t('models.imported', { name: result.model.name, use: t(`models.use.${result.model.use}`) }) });
      }
    } finally {
      setImporting(false);
    }
  };

  if (!project) return null;

  return (
    <div className="w-full h-full flex overflow-hidden">
      {/* 一覧 */}
      <div className="w-60 shrink-0 hairline-r flex flex-col min-h-0 bg-arsist-panel/40">
        <div className="px-3 py-2.5 flex items-center gap-2 hairline-b">
          <Cpu size={14} className="text-purple-300" />
          <span className="text-[12px] font-medium">{t('models.title')}</span>
          <button className="btn btn-primary text-[11px] ml-auto px-2 py-1 flex items-center gap-1" disabled={readOnly} onClick={() => setHubOpen(true)}>
            <Download size={12} /> {t('models.hf.short')}
          </button>
          <button className="btn-ghost text-[11px] px-2 py-1 flex items-center gap-1" disabled={importing || readOnly} title={t('models.importFile')} onClick={() => { void importModel(); }}>
            <FileUp size={12} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {models.map((model) => (
            <button
              key={model.id}
              className={`w-full text-left rounded-lg px-2 py-2 flex items-start gap-2 ${selectedId === model.id ? 'bg-arsist-hover' : 'hover:bg-arsist-hover/60'}`}
              onClick={() => select(model.id)}
            >
              <span className="mt-0.5 text-arsist-muted"><UseIcon use={model.use} /></span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[12px]">
                  <span className="truncate">{model.name}</span>
                  {resolveRuntime(model.runtime, model.inspection?.opTypes) === 'onnxruntime' && (
                    <span className="text-[9px] px-1 rounded bg-amber-400/20 text-amber-300 shrink-0" title={t('models.runtime.hint.onnxruntime')}>ORT</span>
                  )}
                </span>
                <span className="block text-[10px] text-arsist-muted truncate">{subtitle(model, t)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {selected ? (
        <>
          <div className="flex-1 min-w-0 overflow-y-auto p-5">
            <ModelDetail
              key={selected.id}
              model={selected}
              warnings={warnings[selected.id] ?? []}
              readOnly={readOnly}
              onChange={(updates) => updateModel(selected.id, updates)}
              onRemove={() => { removeModel(selected.id); select(null); }}
            />
          </div>
          <div className="w-[400px] shrink-0 hairline-l bg-arsist-panel/40 min-h-0">
            <ModelTryPanel key={selected.id} model={selected} />
          </div>
        </>
      ) : (
        <EmptyState onImport={() => { void importModel(); }} onHub={() => setHubOpen(true)} importing={importing || readOnly} />
      )}

      {hubOpen && <HuggingFaceDialog onClose={() => setHubOpen(false)} onImported={afterImport} />}
    </div>
  );
}

function EmptyState({ onImport, onHub, importing }: { onImport: () => void; onHub: () => void; importing: boolean }) {
  const t = useT();
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl space-y-5">
        <div className="space-y-1.5">
          <h2 className="text-lg font-medium">{t('models.empty.title')}</h2>
          <p className="text-[12px] text-arsist-muted leading-relaxed">{t('models.empty.body')}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {USES.map((use) => (
            <div key={use} className="rounded-lg bg-arsist-surface p-3 space-y-1.5">
              <span className="flex items-center gap-1.5 text-[12px] font-medium"><UseIcon use={use} /> {t(`models.use.${use}`)}</span>
              <p className="text-[11px] text-arsist-muted leading-snug">{t(`models.empty.${use}`)}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5" disabled={importing} onClick={onHub}>
            <Download size={13} /> {t('models.hf.short')}
          </button>
          <button className="btn btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5" disabled={importing} onClick={onImport}>
            <FileUp size={13} /> {t('models.importOnnx')}
          </button>
        </div>
        <p className="text-[11px] text-arsist-muted leading-snug">{t('models.empty.where')}</p>
      </div>
    </div>
  );
}

function ModelDetail({
  model, warnings, readOnly, onChange, onRemove,
}: { model: ModelDefinition; warnings: string[]; readOnly: boolean; onChange: (u: Partial<ModelDefinition>) => void; onRemove: () => void }) {
  const t = useT();
  const inspection = model.inspection;
  // 実機で動かない演算子は、取り込んだ時だけでなく毎回見せる (「試す」では動くので気付きにくい)
  const unsupported = unsupportedOnDevice(inspection?.opTypes);
  const runtime = resolveRuntime(model.runtime, inspection?.opTypes);
  // 使えない演算子があるのに Unity を選んでいる → ビルドで落ちる
  const willFail = unsupported.length > 0 && model.runtime === 'unity';
  const shownWarnings = warnings.filter((w) => !w.startsWith('unsupportedOps:') && !(unsupported.length > 0 && w.startsWith('customDomains:')));

  return (
    <div className={`space-y-6 max-w-2xl ${readOnly ? 'pointer-events-none opacity-70' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <input className="input text-sm w-full" value={model.name} onChange={(e) => onChange({ name: e.target.value })} />
          <p className="text-[10px] text-arsist-muted font-mono truncate">{model.file}</p>
        </div>
        <button className="btn-icon text-arsist-error shrink-0" title={t('vision.model.remove')} onClick={onRemove}><Trash2 size={14} /></button>
      </div>

      {unsupported.length > 0 && (
        <p className={`flex items-start gap-1.5 text-[11px] rounded px-3 py-2 ${willFail ? 'text-arsist-error bg-arsist-error/10' : 'text-amber-400 bg-amber-400/10'}`}>
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{t(willFail ? 'vision.model.warning.unsupportedOps' : 'models.runtime.viaOrt', { detail: unsupported.join(', ') })}</span>
        </p>
      )}

      {shownWarnings.length > 0 && (
        <div className="space-y-1">
          {shownWarnings.map((w) => {
            const [code, detail] = w.split(':');
            return (
              <p key={w} className="flex items-start gap-1.5 text-[11px] text-amber-400 rounded bg-amber-400/10 px-3 py-2">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span>{t(`vision.model.warning.${code}`, { detail: detail ?? '' })}</span>
              </p>
            );
          })}
        </div>
      )}

      {/* 用途 */}
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-arsist-muted">{t('models.section.use')}</p>
        <div className="grid grid-cols-3 gap-1.5">
          {USES.map((use) => (
            <button
              key={use}
              className={`text-left rounded-lg p-2.5 ${model.use === use ? 'bg-arsist-accent/15 ring-1 ring-arsist-accent' : 'bg-arsist-surface hover:bg-arsist-hover'}`}
              onClick={() => { if (model.use !== use) onChange(switchModelUse(model, use)); }}
            >
              <span className="flex items-center gap-1.5 text-[12px] font-medium"><UseIcon use={use} size={13} /> {t(`models.use.${use}`)}</span>
              <span className="block text-[10px] text-arsist-muted leading-snug mt-0.5">{t(`models.useHint.${use}`)}</span>
            </button>
          ))}
        </div>
      </section>

      {model.use === 'image' && <ImageModelForm model={model} onChange={onChange} />}
      {model.use === 'text' && <TextModelForm model={model} onChange={onChange} />}
      {model.use === 'tensor' && <p className="text-[11px] text-arsist-muted leading-relaxed">{t('models.tensorExplain')}</p>}

      {/* 実行 */}
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-arsist-muted">{t('vision.model.section.run')}</p>
        <Row label={t('models.runtime.label')} hint={t(`models.runtime.hint.${runtime}`)}>
          <select className="input text-xs py-1" value={model.runtime ?? 'auto'} onChange={(e) => onChange({ runtime: e.target.value as ModelDefinition['runtime'] })}>
            <option value="auto">{t('models.runtime.auto', { chosen: t(`models.runtime.${runtime}`) })}</option>
            <option value="unity">{t('models.runtime.unity')}</option>
            <option value="onnxruntime">{t('models.runtime.onnxruntime')}</option>
          </select>
        </Row>
        <label className="flex items-start gap-2 text-[11px] cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={model.includeInBuild !== false}
            onChange={(e) => onChange({ includeInBuild: e.target.checked })}
          />
          <span>
            {t('models.includeInBuild')}
            <span className="block text-[10px] text-arsist-muted leading-snug">{t('models.includeInBuildHint')}</span>
          </span>
        </label>
        <Row label={t('vision.model.backend')} hint={t('vision.model.backendHint')}>
          <select className="input text-xs py-1" value={model.backend ?? 'auto'} onChange={(e) => onChange({ backend: e.target.value as ModelDefinition['backend'] })}>
            <option value="auto">{t('vision.model.backend.auto')}</option>
            <option value="gpu">{t('vision.model.backend.gpu')}</option>
            <option value="cpu">{t('vision.model.backend.cpu')}</option>
          </select>
        </Row>
      </section>

      <ScriptSnippet model={model} />

      {/* ファイルから分かったこと */}
      {inspection && (
        <section className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-arsist-muted">{t('vision.model.section.inspection')}</p>
          <p className="text-[11px] text-arsist-muted font-mono">
            opset {inspection.opset ?? '?'} · {inspection.producer ?? '?'}{inspection.fileSize ? ` · ${(inspection.fileSize / 1048576).toFixed(1)} MB` : ''}
          </p>
          <IoTable title={t('models.io.inputs')} rows={inspection.inputs} />
          <IoTable title={t('models.io.outputs')} rows={inspection.outputs} />
          {inspection.customDomains && inspection.customDomains.length > 0 && (
            <p className="text-[11px] text-amber-400">{t('vision.model.warning.customDomains', { detail: inspection.customDomains.join(', ') })}</p>
          )}
        </section>
      )}
    </div>
  );
}

function IoTable({ title, rows }: { title: string; rows: Array<{ name: string; dims: Array<number | string>; elemType?: string }> }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 6);
  return (
    <div className="rounded-lg bg-arsist-surface p-2">
      <p className="text-[10px] text-arsist-muted mb-1">{title} ({rows.length})</p>
      <table className="w-full text-[11px]">
        <tbody>
          {shown.map((row) => (
            <tr key={row.name}>
              <td className="font-mono pr-3 truncate max-w-[16rem]">{row.name}</td>
              <td className="font-mono text-arsist-muted pr-3">{row.elemType ?? ''}</td>
              <td className="font-mono text-arsist-muted">[{row.dims.map((d) => (typeof d === 'number' && d >= 0 ? d : '?')).join(', ')}]</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 6 && (
        <button className="text-[10px] text-arsist-accent mt-1" onClick={() => setAll(!all)}>
          {all ? t('models.io.fewer') : t('models.io.more', { count: rows.length - 6 })}
        </button>
      )}
    </div>
  );
}

/** そのモデルをスクリプトから使う書き方。名前で呼べるので、そのまま貼って動く。 */
function ScriptSnippet({ model }: { model: ModelDefinition }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const name = JSON.stringify(model.name);
  const code = useMemo(() => {
    if (model.use === 'text') {
      switch (model.text?.task) {
        case 'embed':
          return `model.embed(${name}, ${JSON.stringify(t('models.script.textA'))}, function (a) {\n  model.embed(${name}, ${JSON.stringify(t('models.script.textB'))}, function (b) {\n    log(model.similarity(a.vector, b.vector));\n  });\n});`;
        case 'classify':
          return `model.classifyText(${name}, ${JSON.stringify(t('models.script.textA'))}, function (r) {\n  if (!r.ok) { error(r.error); return; }\n  log(r.label + " " + r.score);\n});`;
        default:
          return `model.generate(${name}, ${JSON.stringify(t('models.script.question'))}, {\n  onToken: function (piece, text) { ui.setText("answer", text); }\n}, function (r) {\n  if (!r.ok) { error(r.error); return; }\n  store.set("answer", r.text);\n});`;
      }
    }
    if (model.use === 'image') {
      const read = model.task === 'detect' ? 'log(r.count)' : model.task === 'segment' ? 'log(r.coverage)' : 'log(r.label + " " + r.score)';
      return `model.runImage(${name}, function (r) {\n  if (!r.ok) { error(r.error); return; }\n  ${read};\n});`;
    }
    const inputs = (model.inspection?.inputs ?? []).map((i) => `  ${JSON.stringify(i.name)}: { shape: [${i.dims.map((d) => (typeof d === 'number' && d > 0 ? d : 1)).join(', ')}], data: [/* … */] }`);
    return `model.run(${name}, {\n${inputs.join(',\n')}\n}, function (r) {\n  if (!r.ok) { error(r.error); return; }\n  log(JSON.stringify(r.outputs));\n});`;
  }, [model, name, t]);

  return (
    <section className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-arsist-muted flex items-center gap-2">
        {t('models.section.script')}
        <button
          className="btn-ghost text-[10px] normal-case tracking-normal flex items-center gap-1 ml-auto"
          onClick={() => { void navigator.clipboard.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? t('models.script.copied') : t('models.script.copy')}
        </button>
      </p>
      <pre className="text-[11px] font-mono bg-arsist-bg rounded-lg p-3 overflow-x-auto leading-relaxed">{code}</pre>
      <p className="text-[10px] text-arsist-muted leading-snug">{t('models.script.hint')}</p>
    </section>
  );
}
