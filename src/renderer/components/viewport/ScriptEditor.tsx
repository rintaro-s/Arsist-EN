/**
 * ScriptEditor — JavaScript script editor
 * Jint-based editor for the dynamic scripting system
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Play, Download, Plus, Trash2, CheckCircle,
  Clock, Zap, MousePointer, RefreshCw, Info,
} from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { useT } from '../../i18n';
import type { ScriptTriggerType, ScriptData } from '../../../shared/types';

// ========================================
// ScriptEditor (main view)
// ========================================

export function ScriptEditor() {
  const t = useT();
  const { project, currentScriptId, updateScript, exportScriptBundle } = useProjectStore();
  const { addConsoleLog } = useUIStore();
  const scripts = project?.scripts ?? [];
  const script = scripts.find((s) => s.id === currentScriptId) ?? null;

  const [code, setCode] = useState('');
  const [dirty, setDirty] = useState(false);
  const [exportCopied, setExportCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (script) {
      setCode(script.code);
      setDirty(false);
    }
  }, [script?.id]);

  const handleCodeChange = (val: string) => {
    setCode(val);
    setDirty(true);
  };

  const handleSave = useCallback(() => {
    if (!script || !dirty) return;
    updateScript(script.id, { code });
    setDirty(false);
    addConsoleLog({ type: 'info', message: `Saved script "${script.name}"` });
  }, [script, code, dirty]);

  const handleExportBundle = () => {
    const bundle = exportScriptBundle();
    const json = JSON.stringify(bundle, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    });
    addConsoleLog({ type: 'info', message: `Copied script bundle (${bundle.scripts.length} items) to clipboard` });
  };

  const handleTabKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = code.substring(0, start) + '  ' + code.substring(end);
      setCode(newVal);
      setDirty(true);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  if (scripts.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-arsist-muted gap-3">
        <Zap size={40} className="opacity-20" />
        <p className="text-sm">{t('script.noScripts')}</p>
        <p className="text-xs opacity-60">{t('script.createHint')}</p>
      </div>
    );
  }

  if (!script) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-arsist-muted gap-3">
        <Zap size={40} className="opacity-20" />
        <p className="text-sm">{t('script.selectScript')}</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-arsist-bg text-arsist-text overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-arsist-border bg-arsist-surface shrink-0">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-arsist-accent" />
          <span className="text-sm font-medium truncate max-w-[240px]">{script.name}</span>
          {dirty && <span className="text-[10px] text-arsist-warning bg-arsist-warning/10 px-1.5 py-0.5 rounded">{t('script.unsaved')}</span>}
          {!script.enabled && (
            <span className="text-[10px] text-arsist-muted bg-arsist-hover px-1.5 py-0.5 rounded">{t('script.disabled')}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <TriggerBadge trigger={script.trigger} />
          <div className="w-px h-4 bg-arsist-border mx-1" />
          <button
            onClick={handleSave}
            disabled={!dirty}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${
              dirty ? 'bg-arsist-accent/20 text-arsist-accent hover:bg-arsist-accent/30' : 'text-arsist-muted opacity-40 cursor-not-allowed'
            }`}
          >
            <Play size={12} />
            <span>{t('script.save')}</span>
          </button>
          <button
            onClick={handleExportBundle}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-arsist-hover hover:bg-arsist-active text-arsist-text transition-colors"
          >
            {exportCopied ? <CheckCircle size={12} className="text-green-400" /> : <Download size={12} />}
            <span>{exportCopied ? t('script.copied') : t('script.exportBundle')}</span>
          </button>
        </div>
      </div>

      {/* API Reference (collapsible) */}
      <ApiQuickRef />

      {/* Code area */}
      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0 flex">
          {/* Line numbers */}
          <LineNumbers code={code} />
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            className="flex-1 bg-transparent resize-none outline-none font-mono text-sm leading-6 text-arsist-text p-3 pl-0 overflow-auto"
            style={{ tabSize: 2, caretColor: '#569cd6' }}
            value={code}
            onChange={(e) => handleCodeChange(e.target.value)}
            onKeyDown={handleTabKey}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-arsist-border bg-arsist-surface shrink-0 text-[10px] text-arsist-muted">
        <span>{t('script.footerCompat')}</span>
        <span>{t('script.linesChars', { lines: code.split('\n').length, chars: code.length })}</span>
      </div>
    </div>
  );
}

// ========================================
// Line Numbers
// ========================================

function LineNumbers({ code }: { code: string }) {
  const lines = code.split('\n');
  return (
    <div className="select-none text-right font-mono text-[12px] leading-6 text-arsist-muted/40 py-3 pr-2 pl-3 bg-arsist-bg border-r border-arsist-border/30 min-w-[2.5rem] overflow-hidden">
      {lines.map((_, i) => (
        <div key={i}>{i + 1}</div>
      ))}
    </div>
  );
}

// ========================================
// Trigger Badge
// ========================================

function TriggerBadge({ trigger }: { trigger: ScriptData['trigger'] }) {
  const t = useT();
  const icons: Record<ScriptTriggerType, React.ReactNode> = {
    onStart: <Play size={10} />,
    onUpdate: <RefreshCw size={10} />,
    interval: <Clock size={10} />,
    event: <MousePointer size={10} />,
  };
  const labels: Record<ScriptTriggerType, string> = {
    onStart: t('script.onStartLabel'),
    onUpdate: t('script.everyFrame'),
    interval: t('script.intervalLabel', { sec: trigger.type === 'interval' ? (Number(trigger.value ?? 1000) / 1000).toFixed(1) : '?' }),
    event: t('script.eventLabel', { name: String(trigger.value ?? t('script.unset')) }),
  };
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-arsist-accent/10 text-arsist-accent border border-arsist-accent/20">
      {icons[trigger.type]}
      {labels[trigger.type]}
    </span>
  );
}

// ========================================
// API quick reference
// ========================================

const API_SECTIONS = [
  {
    label: 'api',
    color: '#4ec9b0',
    items: [
      { sig: "api.get(url, callback)", desc: "script.apiGetDesc" },
      { sig: "api.post(url, body, callback)", desc: "script.apiPostDesc" },
    ],
  },
  {
    label: 'ui',
    color: '#569cd6',
    items: [
      { sig: "ui.setText(id, text)", desc: "script.uiSetTextDesc" },
      { sig: "ui.setVisibility(id, bool)", desc: "script.uiSetVisibilityDesc" },
      { sig: "ui.setColor(id, '#RRGGBB')", desc: "script.uiSetColorDesc" },
      { sig: "ui.setAlpha(id, 0.0~1.0)", desc: "script.uiSetAlphaDesc" },
    ],
  },
  {
    label: 'event',
    color: '#e9c46a',
    items: [
      { sig: "event.emit(name, payload)", desc: "script.eventEmitDesc" },
      { sig: "event.on(name, callback)", desc: "script.eventOnDesc" },
    ],
  },
  {
    label: 'store',
    color: '#f4a261',
    items: [
      { sig: "store.get(key)", desc: "script.storeGetDesc" },
      { sig: "store.set(key, value)", desc: "script.storeSetDesc" },
    ],
  },
  {
    label: 'log / error',
    color: '#9e9e9e',
    items: [
      { sig: "log(message)", desc: "script.logDesc" },
      { sig: "error(message)", desc: "script.errorDesc" },
    ],
  },
];

function ApiQuickRef() {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className="shrink-0 border-b border-arsist-border bg-arsist-surface">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-arsist-muted hover:text-arsist-text transition-colors"
      >
        <Info size={12} />
        <span>{t('script.apiReference')}</span>
        <span className="ml-auto text-[10px] opacity-50">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 grid grid-cols-1 gap-2 max-h-52 overflow-y-auto">
          {API_SECTIONS.map((sec) => (
            <div key={sec.label}>
              <div className="text-[10px] font-mono font-bold mb-1" style={{ color: sec.color }}>{sec.label}</div>
              <div className="space-y-0.5">
                {sec.items.map((item) => (
                  <div key={item.sig} className="flex items-start gap-2">
                    <code className="text-[10px] font-mono text-arsist-text/80 shrink-0">{item.sig}</code>
                    <span className="text-[10px] text-arsist-muted">— {t(item.desc)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ========================================
// ScriptInspector (right panel)
// ========================================

export function ScriptInspector() {
  const t = useT();
  const { project, currentScriptId, updateScript, removeScript } = useProjectStore();
  const { addConsoleLog } = useUIStore();
  const scripts = project?.scripts ?? [];
  const script = scripts.find((s) => s.id === currentScriptId) ?? null;

  if (!script) {
    return (
      <div className="h-full flex flex-col">
        <div className="panel-header"><span>{t('script.scriptInspector')}</span></div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-arsist-muted text-[11px]">
            <Zap size={24} className="mx-auto mb-2 opacity-20" />
            <p>{t('script.selectScript')}</p>
          </div>
        </div>
      </div>
    );
  }

  const handleRemove = () => {
    if (!window.confirm(t('script.confirmDelete', { name: script.name }))) return;
    removeScript(script.id);
    addConsoleLog({ type: 'warning', message: `Deleted script "${script.name}"` });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="panel-header">
        <span>{t('script.scriptInspector')}</span>
        <button onClick={handleRemove} className="btn-icon text-arsist-error hover:text-arsist-error">
          <Trash2 size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Name */}
        <Field label={t('script.scriptName')}>
          <input
            className="input text-sm"
            value={script.name}
            onChange={(e) => updateScript(script.id, { name: e.target.value })}
          />
        </Field>

        {/* Description */}
        <Field label={t('script.description')}>
          <textarea
            className="input text-xs resize-none"
            rows={2}
            value={script.description ?? ''}
            onChange={(e) => updateScript(script.id, { description: e.target.value })}
          />
        </Field>

        {/* Enabled toggle */}
        <div className="flex items-center justify-between">
          <span className="input-label mb-0">{t('script.enabled')}</span>
          <button
            onClick={() => updateScript(script.id, { enabled: !script.enabled })}
            className={`relative w-10 h-5 rounded-full transition-colors ${script.enabled ? 'bg-arsist-accent' : 'bg-arsist-border'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${script.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        <div className="h-px bg-arsist-border" />

        {/* Trigger settings */}
        <div>
          <label className="input-label">{t('script.trigger')}</label>
          <div className="space-y-2">
            {(['onStart', 'onUpdate', 'interval', 'event'] as ScriptTriggerType[]).map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="trigger"
                  checked={script.trigger.type === t}
                  onChange={() => updateScript(script.id, {
                    trigger: {
                      type: t,
                      value: t === 'interval' ? 1000 : t === 'event' ? '' : undefined,
                    },
                  })}
                  className="accent-arsist-accent"
                />
                <TriggerOption type={t} />
              </label>
            ))}
          </div>

          {/* interval value */}
          {script.trigger.type === 'interval' && (
            <div className="mt-2">
              <label className="input-label">{t('script.intervalMs')}</label>
              <input
                type="number"
                min={100}
                step={100}
                className="input text-xs"
                value={Number(script.trigger.value ?? 1000)}
                onChange={(e) =>
                  updateScript(script.id, { trigger: { type: 'interval', value: parseInt(e.target.value) || 1000 } })
                }
              />
            </div>
          )}

          {/* event value */}
          {script.trigger.type === 'event' && (
            <div className="mt-2">
              <label className="input-label">{t('script.eventName')}</label>
              <input
                type="text"
                className="input text-xs font-mono"
                placeholder={t('script.eventNamePlaceholder')}
                value={String(script.trigger.value ?? '')}
                onChange={(e) =>
                  updateScript(script.id, { trigger: { type: 'event', value: e.target.value } })
                }
              />
            </div>
          )}
        </div>

        <div className="h-px bg-arsist-border" />

        {/* Meta info */}
        <div className="space-y-1 text-[10px] text-arsist-muted">
          <p>{t('script.idLabel')}: <span className="font-mono text-arsist-text/60 break-all">{script.id}</span></p>
          <p>{t('script.createdLabel')}: {new Date(script.createdAt).toLocaleString()}</p>
          <p>{t('script.updatedLabel')}: {new Date(script.updatedAt).toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}

// ========================================
// ScriptFileList (for left panel)
// ========================================

export function ScriptFileList() {
  const t = useT();
  const { project, currentScriptId, setCurrentScript, addScript, removeScript } = useProjectStore();
  const { addConsoleLog } = useUIStore();
  const scripts = project?.scripts ?? [];
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = () => {
    const name = newName.trim() || `Script_${scripts.length + 1}`;
    addScript(name);
    setNewName('');
    setAdding(false);
    addConsoleLog({ type: 'info', message: `Script '${name}' created successfully` });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span>{t('script.scriptsCount', { count: scripts.length })}</span>
        <button className="btn-icon" onClick={() => setAdding((v) => !v)}>
          <Plus size={15} />
        </button>
      </div>

        {/* New script input */}
      {adding && (
        <div className="px-2 py-2 border-b border-arsist-border bg-arsist-hover flex gap-1">
          <input
            autoFocus
            className="input text-xs flex-1"
            placeholder={t('script.namePlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
          />
          <button onClick={handleAdd} className="btn-icon text-arsist-accent"><CheckCircle size={14} /></button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {scripts.map((sc) => (
          <div
            key={sc.id}
            onClick={() => setCurrentScript(sc.id)}
            className={`tree-item justify-between group ${sc.id === currentScriptId ? 'selected' : ''}`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <TriggerIcon type={sc.trigger.type} />
              <span className={`text-[12px] truncate ${!sc.enabled ? 'line-through opacity-50' : ''}`}>{sc.name}</span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); removeScript(sc.id); }}
              className="opacity-0 group-hover:opacity-100 text-arsist-muted hover:text-arsist-error shrink-0 transition-opacity"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
        {scripts.length === 0 && (
          <div className="text-center py-6 text-arsist-muted text-[11px]">
            <Zap size={20} className="mx-auto mb-1.5 opacity-30" />
            <p>{t('script.createHintShort')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ========================================
// Helpers
// ========================================

function TriggerIcon({ type }: { type: ScriptTriggerType }) {
  switch (type) {
    case 'onStart': return <Play size={11} className="text-green-400 shrink-0" />;
    case 'onUpdate': return <RefreshCw size={11} className="text-blue-400 shrink-0" />;
    case 'interval': return <Clock size={11} className="text-arsist-warning shrink-0" />;
    case 'event': return <MousePointer size={11} className="text-arsist-accent shrink-0" />;
  }
}

function TriggerOption({ type }: { type: ScriptTriggerType }) {
  const t = useT();
  const labels: Record<ScriptTriggerType, { name: string; desc: string }> = {
    onStart: { name: 'onStart', desc: t('script.triggerOnStartDesc') },
    onUpdate: { name: 'onUpdate', desc: t('script.triggerOnUpdateDesc') },
    interval: { name: 'interval', desc: t('script.triggerIntervalDesc') },
    event: { name: 'event', desc: t('script.triggerEventDesc') },
  };
  const info = labels[type];
  return (
    <span>
      <span className="text-[11px] font-mono text-arsist-text">{info.name}</span>
      <span className="text-[10px] text-arsist-muted ml-1">— {info.desc}</span>
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="input-label">{label}</label>
      {children}
    </div>
  );
}
