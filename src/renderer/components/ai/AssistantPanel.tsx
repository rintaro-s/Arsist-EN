/**
 * 内蔵 AI アシスタントの欄 (右側に重ねて出す)。
 *
 * OpenAI 互換の API に依頼を送り、AI が MCP と同じツールでプロジェクトを編集する (src/main/agent/assistant.ts)。
 * 編集はファイルに対して行われ、エディタは変化を見て読み直す。送る前に未保存の変更を保存し、
 * AI が書き換える前の状態は「この変更を元に戻す」で戻せる。
 */
import { useEffect, useRef, useState } from 'react';
import { Bot, X, Settings2, RotateCcw, Send, Square, Wrench, Check, AlertTriangle, Undo2, Info } from 'lucide-react';
import { useI18n, useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { useAssistantStore } from '../../ai/assistantStore';
import { ASSISTANT_PRESETS, type AssistantSettingsView } from '../../ai/types';

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { lang } = useI18n();
  const { project, projectPath, isDirty, saveProject, reloadProject, selectedObjectIds, currentSceneId } = useProjectStore();
  const { conversationId, items, running, step, add, apply, start, markUndone, newConversation } = useAssistantStore();
  const [text, setText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AssistantSettingsView | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const api = window.electronAPI?.assistant;

  useEffect(() => {
    void api?.getSettings().then((s) => {
      setSettings(s);
      if (!s.model || !s.baseUrl) setShowSettings(true);
    });
  }, []);

  useEffect(() => {
    const off = api?.onEvent(({ conversationId: id, event }) => {
      if (id !== useAssistantStore.getState().conversationId) return;
      const done = apply(event);
      // AI が書き換えたら、ファイルの変化の知らせを待たずに読み直す
      if (done?.changed) void reloadProject();
    });
    return () => off?.();
  }, [apply, reloadProject]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [items.length, running]);

  const send = async () => {
    const request = text.trim();
    if (!request || running || !api) return;
    if (!settings?.model || !settings?.baseUrl) {
      add({ kind: 'error', text: t('ai.needsSetup') });
      setShowSettings(true);
      return;
    }
    if (isDirty) {
      // AI が読むのはファイルなので、画面の未保存の変更を先にファイルへ
      await saveProject();
      add({ kind: 'info', text: t('ai.savedFirst') });
    }
    setText('');
    add({ kind: 'user', text: request });
    start();
    const scene = project?.scenes.find((s) => s.id === currentSceneId);
    const selected = scene?.objects.filter((o) => selectedObjectIds.includes(o.id)).map((o) => `${o.name} (id ${o.id}${o.assetId ? `, assetId ${o.assetId}` : ''})`);
    const r = await api.send(conversationId, request, {
      language: lang,
      targetDevice: project?.targetDevice,
      selection: selected?.length ? selected.join('; ') : undefined,
    });
    if (!r.ok) apply({ type: 'error', message: r.error ?? 'failed' });
  };

  const undo = async (snapshotId: string) => {
    const r = await api?.undo(snapshotId);
    if (r?.ok) {
      markUndone(snapshotId);
      add({ kind: 'info', text: t('ai.undone') });
      await reloadProject();
    } else if (r) {
      add({ kind: 'error', text: r.error ?? 'undo failed' });
    }
  };

  const reset = async () => {
    await api?.reset(conversationId);
    newConversation();
  };

  return (
    <div className="fixed right-0 top-10 bottom-0 w-[400px] max-w-full z-[900] bg-arsist-surface shadow-2xl flex flex-col">
      <div className="h-10 px-3 flex items-center gap-2 hairline-b shrink-0">
        <Bot size={16} className="text-arsist-accent" />
        <span className="text-sm font-semibold flex-1">{t('ai.title')}</span>
        <button className="btn btn-ghost p-1" title={t('ai.settings')} onClick={() => setShowSettings((v) => !v)}><Settings2 size={14} /></button>
        <button className="btn btn-ghost p-1" title={t('ai.newChat')} onClick={() => { void reset(); }}><RotateCcw size={14} /></button>
        <button className="btn btn-ghost p-1" title={t('common.close')} onClick={onClose}><X size={14} /></button>
      </div>

      {showSettings && settings && (
        <AssistantSettingsForm initial={settings} onSaved={(s) => { setSettings(s); setShowSettings(false); }} />
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {!projectPath && <p className="text-xs text-arsist-muted">{t('ai.noProject')}</p>}
        {items.map((it, i) => <ChatRow key={i} item={it} onUndo={undo} undoLabel={t('ai.undo')} />)}
        {running && <p className="text-[11px] text-arsist-muted animate-pulse">{t('ai.working', { step })}</p>}
      </div>

      <div className="p-2 hairline-t shrink-0 space-y-1.5">
        <textarea
          className="input w-full text-xs resize-none"
          rows={3}
          value={text}
          placeholder={t('ai.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); }
          }}
        />
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-arsist-muted flex-1 truncate">{settings?.model ? `${settings.model} · ${settings.baseUrl}` : t('ai.needsSetup')}</span>
          {running ? (
            <button className="btn btn-secondary text-xs py-1" onClick={() => { void api?.abort(conversationId); }}><Square size={12} />{t('ai.stop')}</button>
          ) : (
            <button className="btn btn-primary text-xs py-1" disabled={!text.trim()} onClick={() => { void send(); }}><Send size={12} />{t('ai.send')}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatRow({ item, onUndo, undoLabel }: { item: ReturnType<typeof useAssistantStore.getState>['items'][number]; onUndo: (id: string) => void; undoLabel: string }) {
  switch (item.kind) {
    case 'user':
      return <div className="ml-8 rounded-lg bg-arsist-accent/15 px-3 py-2 text-xs whitespace-pre-wrap">{item.text}</div>;
    case 'assistant':
      return <div className="mr-4 rounded-lg bg-arsist-hover px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed">{item.text}</div>;
    case 'tool':
      return (
        <div className="flex items-start gap-1.5 text-[11px] text-arsist-muted px-1">
          {item.ok === undefined ? <Wrench size={12} className="shrink-0 mt-0.5 animate-pulse" />
            : item.ok ? <Check size={12} className="shrink-0 mt-0.5 text-arsist-success" />
            : <AlertTriangle size={12} className="shrink-0 mt-0.5 text-arsist-warning" />}
          <span className="font-mono">{item.name}</span>
          {item.summary && <span className="truncate">— {item.summary}</span>}
        </div>
      );
    case 'error':
      return <div className="text-[11px] text-arsist-error flex gap-1.5 px-1"><AlertTriangle size={12} className="shrink-0 mt-0.5" /><span className="break-all">{item.text}</span></div>;
    case 'info':
      return <div className="text-[11px] text-arsist-muted flex gap-1.5 px-1"><Info size={12} className="shrink-0 mt-0.5" />{item.text}</div>;
    case 'undo':
      return item.done ? null : (
        <button className="btn btn-ghost text-[11px] py-0.5" onClick={() => onUndo(item.snapshotId)}><Undo2 size={12} />{undoLabel}</button>
      );
    default:
      return null;
  }
}

function AssistantSettingsForm({ initial, onSaved }: { initial: AssistantSettingsView; onSaved: (s: AssistantSettingsView) => void }) {
  const t = useT();
  const api = window.electronAPI?.assistant;
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState('');
  const [maxSteps, setMaxSteps] = useState(initial.maxSteps ?? 24);
  const [models, setModels] = useState<string[]>([]);
  const [note, setNote] = useState<{ text: string; warn?: boolean } | null>(null);
  const preset = ASSISTANT_PRESETS.find((p) => p.baseUrl && p.baseUrl === baseUrl)?.id ?? 'custom';

  const fetchModels = async () => {
    const r = await api?.models({ baseUrl, apiKey: apiKey || undefined });
    if (!r) return;
    if (r.ok) {
      setModels(r.models ?? []);
      setNote({ text: t('ai.modelsFound', { count: r.models?.length ?? 0 }) });
      if (!model && r.models?.[0]) setModel(r.models[0]);
    } else setNote({ text: r.error ?? 'failed', warn: true });
  };

  const save = async () => {
    await api?.setSettings({ baseUrl, model, maxSteps, ...(apiKey ? { apiKey } : {}) });
    const fresh = await api?.getSettings();
    if (fresh) onSaved(fresh);
  };

  return (
    <div className="p-3 space-y-2 bg-arsist-hover/60 shrink-0">
      <label className="text-[10px] text-arsist-muted">{t('ai.preset')}</label>
      <select className="input text-xs py-1 w-full" value={preset} onChange={(e) => {
        const p = ASSISTANT_PRESETS.find((x) => x.id === e.target.value);
        if (p && p.baseUrl) setBaseUrl(p.baseUrl);
      }}>
        {ASSISTANT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <label className="text-[10px] text-arsist-muted">{t('ai.baseUrl')}</label>
      <input className="input text-xs py-1 w-full font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      <label className="text-[10px] text-arsist-muted">{t('ai.apiKey')}</label>
      <input
        className="input text-xs py-1 w-full font-mono"
        type="password"
        value={apiKey}
        placeholder={initial.hasKey ? t('ai.apiKeySaved', { encrypted: initial.encrypted ? t('ai.apiKeyEncrypted') : '' }) : t('ai.apiKeyNone')}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <label className="text-[10px] text-arsist-muted">{t('ai.model')}</label>
      <div className="flex gap-1">
        <input className="input text-xs py-1 flex-1 font-mono" list="arsist-ai-models" value={model} onChange={(e) => setModel(e.target.value)} />
        <datalist id="arsist-ai-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        <button className="btn btn-secondary text-[11px] py-1" onClick={() => { void fetchModels(); }}>{t('ai.fetchModels')}</button>
      </div>
      <label className="text-[10px] text-arsist-muted">{t('ai.maxSteps')}</label>
      <input className="input text-xs py-1 w-24" type="number" min={1} max={100} value={maxSteps} onChange={(e) => setMaxSteps(Number(e.target.value) || 24)} />
      <p className="text-[10px] text-arsist-muted">{t('ai.toolsNote')}</p>
      {note && <p className={`text-[10px] break-all ${note.warn ? 'text-arsist-warning' : 'text-arsist-success'}`}>{note.text}</p>}
      <div className="flex justify-end">
        <button className="btn btn-primary text-xs py-1" disabled={!baseUrl || !model} onClick={() => { void save(); }}>{t('ai.save')}</button>
      </div>
    </div>
  );
}
