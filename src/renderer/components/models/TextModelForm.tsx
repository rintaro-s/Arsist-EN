/**
 * 文章のモデル (use: 'text') の設定: 分割器、何をするか (生成 / 埋め込み / 分類)、その設定。
 *
 * 分割器 (tokenizer.json) は HuggingFace がモデルと一緒に配っているものをそのまま使う。
 * 取り込むと、隣の tokenizer_config.json などから会話の書式と止めるトークンを埋める。
 */
import { useState } from 'react';
import { AlertTriangle, FileUp } from 'lucide-react';
import { useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { ChatFormatName, ModelDefinition, TextModelSpec, TextModelTask } from '../../../shared/types';
import { defaultTextSpec } from '../../../shared/modelDefaults';
import { Row } from './ImageModelForm';

const CHAT_FORMATS: ChatFormatName[] = ['chatml', 'llama3', 'phi3', 'gemma', 'mistral', 'none', 'custom'];

function listText(values: string[] | undefined): string {
  return (values ?? []).join(', ');
}

function parseList(text: string): string[] {
  return text.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
}

export function TextModelForm({ model, onChange }: { model: ModelDefinition; onChange: (u: Partial<ModelDefinition>) => void }) {
  const t = useT();
  const { projectPath } = useProjectStore();
  const { addNotification } = useUIStore();
  const [importing, setImporting] = useState(false);
  const spec: TextModelSpec = model.text ?? defaultTextSpec('generate', '');
  const set = (u: Partial<TextModelSpec>) => onChange({ text: { ...spec, ...u } });
  const outputs = model.inspection?.outputs ?? [];

  const importTokenizer = async () => {
    if (!projectPath) return;
    setImporting(true);
    try {
      const result = await window.electronAPI.model.importTokenizer(projectPath, model.name);
      if (!result.success || !result.info) {
        if (result.error !== 'cancelled') addNotification({ type: 'error', message: t('models.text.tokenizerError', { detail: result.error ?? '' }) });
        return;
      }
      const info = result.info;
      const next: TextModelSpec = { ...spec, tokenizer: info.tokenizer };
      if (spec.task === 'generate') {
        if (info.chatFormat) next.chatFormat = info.chatFormat;
        if (info.eosTokens && info.eosTokens.length > 0) next.eosTokens = info.eosTokens;
      }
      if (spec.task === 'classify' && info.labels && info.labels.length > 0) next.labels = info.labels;
      onChange({ text: next });
      if (info.warnings.includes('tokenizerUnigram')) addNotification({ type: 'warning', message: t('vision.model.warning.tokenizerUnigram', { detail: '' }) });
      else addNotification({ type: 'success', message: t('models.text.tokenizerImported', { kind: info.kind ?? '?' }) });
    } finally {
      setImporting(false);
    }
  };

  const changeTask = (task: TextModelTask) => {
    if (task === spec.task) return;
    // 分割器は同じものを使い続ける。それ以外はその用途の既定に。
    onChange({ text: { ...defaultTextSpec(task, spec.tokenizer), labels: spec.labels } });
  };

  return (
    <div className="space-y-5">
      {/* 分割器 */}
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-arsist-muted">{t('models.section.tokenizer')}</p>
        <div className="flex items-center gap-2">
          <span className={`flex-1 min-w-0 text-[11px] font-mono truncate rounded px-2 py-1.5 ${spec.tokenizer ? 'bg-arsist-surface' : 'bg-amber-400/10 text-amber-400'}`}>
            {spec.tokenizer || t('models.text.tokenizerNone')}
          </span>
          <button className="btn-ghost text-[11px] px-2 py-1 flex items-center gap-1 shrink-0" disabled={importing} onClick={() => { void importTokenizer(); }}>
            <FileUp size={12} /> {spec.tokenizer ? t('models.text.replaceTokenizer') : t('models.text.importTokenizer')}
          </button>
        </div>
        <p className="text-[10px] text-arsist-muted leading-snug">{t('models.text.tokenizerHint')}</p>
      </section>

      {/* 何をするか */}
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-arsist-muted">{t('models.section.textTask')}</p>
        <div className="grid grid-cols-3 gap-1.5">
          {(['generate', 'embed', 'classify'] as TextModelTask[]).map((task) => (
            <button
              key={task}
              className={`text-left rounded-lg p-2.5 ${spec.task === task ? 'bg-arsist-accent/15 ring-1 ring-arsist-accent' : 'bg-arsist-surface hover:bg-arsist-hover'}`}
              onClick={() => changeTask(task)}
            >
              <span className="block text-[12px] font-medium">{t(`models.text.task.${task}`)}</span>
              <span className="block text-[10px] text-arsist-muted leading-snug mt-0.5">{t(`models.text.taskHint.${task}`)}</span>
            </button>
          ))}
        </div>
      </section>

      {spec.task === 'generate' && (
        <section className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-arsist-muted">{t('models.section.generation')}</p>
          <Row label={t('models.text.chatFormat')} hint={t('models.text.chatFormatHint')}>
            <select className="input text-xs py-1" value={spec.chatFormat ?? 'chatml'} onChange={(e) => set({ chatFormat: e.target.value as ChatFormatName })}>
              {CHAT_FORMATS.map((f) => <option key={f} value={f}>{t(`models.text.chatFormat.${f}`)}</option>)}
            </select>
          </Row>
          {spec.chatFormat === 'custom' && (
            <Row label={t('models.text.promptTemplate')} hint={t('models.text.promptTemplateHint')}>
              <textarea className="input text-xs font-mono h-20" value={spec.promptTemplate ?? '{prompt}'} onChange={(e) => set({ promptTemplate: e.target.value })} />
            </Row>
          )}
          <Row label={t('models.text.systemPrompt')} hint={t('models.text.systemPromptHint')}>
            <textarea className="input text-xs h-16" placeholder={t('models.text.systemPromptPlaceholder')} value={spec.systemPrompt ?? ''}
              onChange={(e) => set({ systemPrompt: e.target.value || undefined })} />
          </Row>
          <Row label={t('models.text.maxNewTokens')} hint={t('models.text.maxNewTokensHint')}>
            <input type="number" className="input text-xs py-1 w-24" min={1} max={4096} value={spec.maxNewTokens ?? 128}
              onChange={(e) => set({ maxNewTokens: Math.max(1, parseInt(e.target.value, 10) || 128) })} />
          </Row>
          <Row label={t('models.text.temperature')} hint={t('models.text.temperatureHint')}>
            <span className="flex items-center gap-2">
              <input type="range" className="flex-1" min={0} max={1.5} step={0.05} value={spec.temperature ?? 0.7} onChange={(e) => set({ temperature: parseFloat(e.target.value) })} />
              <span className="font-mono w-10">{(spec.temperature ?? 0.7).toFixed(2)}</span>
            </span>
          </Row>
          <Row label={t('models.text.topKTopP')}>
            <span className="flex items-center gap-2">
              <input type="number" className="input text-xs py-1 w-20" min={0} max={1000} value={spec.topK ?? 40} onChange={(e) => set({ topK: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
              <input type="number" className="input text-xs py-1 w-20" min={0.05} max={1} step={0.05} value={spec.topP ?? 0.95} onChange={(e) => set({ topP: Math.min(1, Math.max(0.05, parseFloat(e.target.value) || 1)) })} />
            </span>
          </Row>
          <Row label={t('models.text.repetitionPenalty')} hint={t('models.text.repetitionPenaltyHint')}>
            <span className="flex items-center gap-2">
              <input type="range" className="flex-1" min={1} max={2} step={0.05} value={spec.repetitionPenalty ?? 1.1} onChange={(e) => set({ repetitionPenalty: parseFloat(e.target.value) })} />
              <span className="font-mono w-10">{(spec.repetitionPenalty ?? 1.1).toFixed(2)}</span>
            </span>
          </Row>
          <Row label={t('models.text.stop')} hint={t('models.text.stopHint')}>
            <input className="input text-xs py-1 font-mono" value={listText(spec.stop)} onChange={(e) => set({ stop: parseList(e.target.value) })} />
          </Row>
          <Row label={t('models.text.eosTokens')} hint={t('models.text.eosHint')}>
            <input className="input text-xs py-1 font-mono" value={listText(spec.eosTokens)} onChange={(e) => set({ eosTokens: parseList(e.target.value) })} />
          </Row>
          <Row label={t('models.text.hideThinking')} hint={t('models.text.hideThinkingHint')}>
            <input type="checkbox" className="justify-self-start" checked={spec.hideThinking ?? true} onChange={(e) => set({ hideThinking: e.target.checked })} />
          </Row>
          <Row label={t('models.text.maxContext')}>
            <input type="number" className="input text-xs py-1 w-24" min={64} max={131072} value={spec.maxContext ?? 2048}
              onChange={(e) => set({ maxContext: Math.max(64, parseInt(e.target.value, 10) || 2048) })} />
          </Row>
        </section>
      )}

      {(spec.task === 'embed' || spec.task === 'classify') && (
        <section className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-arsist-muted">{t(spec.task === 'embed' ? 'models.section.embedding' : 'models.section.classification')}</p>
          {spec.task === 'embed' && (
            <>
              <Row label={t('models.text.pooling')} hint={t('models.text.poolingHint')}>
                <select className="input text-xs py-1" value={spec.pooling ?? 'mean'} onChange={(e) => set({ pooling: e.target.value as TextModelSpec['pooling'] })}>
                  <option value="mean">{t('models.text.pooling.mean')}</option>
                  <option value="cls">{t('models.text.pooling.cls')}</option>
                  <option value="last">{t('models.text.pooling.last')}</option>
                </select>
              </Row>
              <Row label={t('models.text.normalize')}>
                <input type="checkbox" className="justify-self-start" checked={spec.normalize ?? true} onChange={(e) => set({ normalize: e.target.checked })} />
              </Row>
            </>
          )}
          {outputs.length > 1 && (
            <Row label={t('models.text.outputName')}>
              <select className="input text-xs py-1" value={spec.outputName ?? ''} onChange={(e) => set({ outputName: e.target.value || undefined })}>
                <option value="">{t('models.text.outputAuto')}</option>
                {outputs.map((o) => <option key={o.name} value={o.name}>{o.name} [{o.dims.join(',')}]</option>)}
              </select>
            </Row>
          )}
          <Row label={t('models.text.maxLength')}>
            <input type="number" className="input text-xs py-1 w-24" min={8} max={8192} value={spec.maxLength ?? 256}
              onChange={(e) => set({ maxLength: Math.max(8, parseInt(e.target.value, 10) || 256) })} />
          </Row>
          {spec.task === 'classify' && (
            <Row label={t('models.text.labels')}>
              <textarea className="input text-xs font-mono h-24" placeholder={t('vision.model.labelsPlaceholder')} value={(spec.labels ?? []).join('\n')}
                onChange={(e) => set({ labels: e.target.value.split('\n').map((l) => l.trim()).filter((l) => l.length > 0) })} />
            </Row>
          )}
        </section>
      )}

      {!spec.tokenizer && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-400 rounded bg-amber-400/10 px-3 py-2">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{t('models.text.needTokenizer')}</span>
        </p>
      )}
    </div>
  );
}
