/**
 * ScriptEditor — JavaScript script editor
 * Jint-based editor for the dynamic scripting system
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Play, Download, Plus, Trash2, CheckCircle,
  Clock, Zap, MousePointer, RefreshCw, BookOpen, Search, X, ChevronDown, ChevronRight, Puzzle,
} from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { useI18n, useT } from '../../i18n';
import type { ScriptTriggerType, ScriptData } from '../../../shared/types';
import { ENGINE_SCRIPT_API } from '../../../shared/scriptApi';
import { localized, useExtensions } from '../../extensions/useExtensions';
import { MiniMarkdown } from '../common/MiniMarkdown';
import { StorageSection } from '../panels/StorageSection';

// 早見表の開閉と幅 (この端末だけの好み。保存できなくても動く)
function readPref(key: string, fallback: string): string {
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* 保存できなくてもよい */ }
}

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
  const [showRef, setShowRef] = useState(() => readPref('arsist.scriptRef.open', '1') === '1');
  const [refWidth, setRefWidth] = useState(() => Number(readPref('arsist.scriptRef.width', '400')) || 400);
  const setRefOpen = (open: boolean) => { setShowRef(open); writePref('arsist.scriptRef.open', open ? '1' : '0'); };

  /** 早見表で押した呼び方を、カーソルの位置に入れる */
  const insertAtCursor = (text: string) => {
    const ta = textareaRef.current;
    const start = ta ? ta.selectionStart : code.length;
    const end = ta ? ta.selectionEnd : code.length;
    const next = code.slice(0, start) + text + code.slice(end);
    setCode(next);
    setDirty(true);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + text.length;
    });
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = refWidth;
    let latest = startW;
    const move = (ev: MouseEvent) => {
      latest = Math.min(720, Math.max(260, startW - (ev.clientX - startX)));
      setRefWidth(latest);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      writePref('arsist.scriptRef.width', String(latest));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

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
          <button
            onClick={() => setRefOpen(!showRef)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${showRef ? 'bg-arsist-accent/20 text-arsist-accent' : 'bg-arsist-hover hover:bg-arsist-active text-arsist-text'}`}
            title={t('script.ref.toggle')}
          >
            <BookOpen size={12} />
            <span>{t('script.ref.button')}</span>
          </button>
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

      {/* Code area + API reference */}
      <div className="flex-1 overflow-hidden flex">
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
      {showRef && (
        <>
          <div
            className="w-1 shrink-0 cursor-col-resize hover:bg-arsist-accent/40 bg-arsist-bg"
            onMouseDown={startResize}
          />
          <div style={{ width: refWidth }} className="shrink-0 overflow-hidden">
            <ApiDrawer onInsert={insertAtCursor} onClose={() => setRefOpen(false)} />
          </div>
        </>
      )}
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
// API reference (side drawer)
// ========================================
//
// 中身は src/shared/scriptApi.ts (エージェントの早見表と同じ元) と、有効な拡張機能の README の
// 「## スクリプト」節。ここに API を書き写さないこと (前に書き写した表は、無い event.emit を載せていた)。

/** "a(x) / b(y, [1, 2])" を括弧の外の " / " で分ける。 */
function splitSignature(sig: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < sig.length; i++) {
    const c = sig[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    if (depth === 0 && sig.startsWith(' / ', i)) {
      parts.push(cur.trim());
      cur = '';
      i += 2;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** README の「## スクリプト / ## Scripts」節 (次の ## まで)。無ければ null。src/main/mcp/scriptReference.ts と同じ規則。 */
function readmeScriptSection(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s*(スクリプト|Scripts?)(\s|$|\()/.test(l));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

interface ExtensionScriptRef {
  id: string;
  name: string;
  globals: string[];
  section: string | null;
}

function useExtensionScriptRefs(): ExtensionScriptRef[] {
  const { lang } = useI18n();
  const project = useProjectStore((s) => s.project);
  const { data } = useExtensions(project?.targetDevice);
  const [sections, setSections] = useState<Record<string, string | null>>({});
  const enabled = (data?.extensions ?? []).filter((e) =>
    project?.extensions?.[e.manifest.id]?.enabled && (e.manifest.script?.globals?.length ?? 0) > 0);
  const key = enabled.map((e) => `${e.manifest.id}@${e.manifest.version}`).join(',');

  useEffect(() => {
    let alive = true;
    const api = window.electronAPI?.extensions;
    if (!api) return;
    void Promise.all(enabled.map(async (e) => {
      const r = await api.readme(e.manifest.id).catch(() => null);
      return [e.manifest.id, r?.ok && r.text ? readmeScriptSection(r.text) : null] as const;
    })).then((pairs) => { if (alive) setSections(Object.fromEntries(pairs)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return enabled.map((e) => ({
    id: e.manifest.id,
    name: localized(e.manifest.name, lang),
    globals: e.manifest.script?.globals ?? [],
    section: sections[e.manifest.id] ?? null,
  }));
}

const TRIGGER_KEYS = ['onStart', 'onUpdate', 'interval', 'event', 'app', 'shared'] as const;

function ApiDrawer({ onInsert, onClose }: { onInsert: (text: string) => void; onClose: () => void }) {
  const t = useT();
  const { lang } = useI18n();
  const [query, setQuery] = useState('');
  const [showTriggers, setShowTriggers] = useState(false);
  const extensions = useExtensionScriptRefs();
  const q = query.trim().toLowerCase();

  const sections = ENGINE_SCRIPT_API.map((sec) => ({
    ...sec,
    entries: sec.entries.filter((e) => !q
      || sec.name.toLowerCase().includes(q)
      || e.sig.toLowerCase().includes(q)
      || (lang === 'ja' ? e.ja : e.en).toLowerCase().includes(q)),
  })).filter((sec) => sec.entries.length > 0);
  const extMatches = extensions.filter((e) => !q
    || e.name.toLowerCase().includes(q)
    || e.globals.some((g) => g.toLowerCase().includes(q))
    || (e.section ?? '').toLowerCase().includes(q));

  return (
    <div className="h-full flex flex-col bg-arsist-surface overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 shrink-0">
        <BookOpen size={13} className="text-arsist-accent" />
        <span className="text-xs font-semibold flex-1">{t('script.apiReference')}</span>
        <button className="btn-icon" onClick={onClose} title={t('script.ref.close')}><X size={13} /></button>
      </div>
      <div className="px-3 pb-2 shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-arsist-muted" />
          <input className="input text-xs" style={{ paddingLeft: 26 }} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={t('script.ref.search')} />
        </div>
        <p className="text-[10px] text-arsist-muted mt-1.5">{t('script.ref.clickToInsert')}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-3">
        {/* トリガー */}
        <div>
          <button className="w-full flex items-center gap-1 text-[11px] font-semibold text-arsist-text hover:text-arsist-accent"
            onClick={() => setShowTriggers((v) => !v)}>
            {showTriggers ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('script.ref.triggers')}
          </button>
          {showTriggers && (
            <ul className="mt-1.5 space-y-1.5">
              {TRIGGER_KEYS.map((k) => (
                <li key={k} className="text-[10px] text-arsist-muted leading-snug">{t(`script.ref.trigger.${k}`)}</li>
              ))}
            </ul>
          )}
        </div>

        {sections.map((sec) => (
          <div key={sec.name}>
            <div className="text-[11px] font-mono font-bold" style={{ color: sec.color }}>{sec.name}</div>
            <p className="text-[10px] text-arsist-muted leading-snug mb-1">{lang === 'ja' ? sec.ja : sec.en}</p>
            <div className="space-y-1.5">
              {sec.entries.map((entry) => (
                <div key={entry.sig} className="rounded-md bg-arsist-bg/60 px-2 py-1.5">
                  <div className="flex flex-wrap gap-x-1.5 gap-y-0.5">
                    {splitSignature(entry.sig).map((part) => (
                      <button key={part} onClick={() => onInsert(part)} title={t('script.ref.insert')}
                        className="text-left text-[10.5px] font-mono text-arsist-text hover:text-arsist-accent break-all">
                        {part}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-arsist-muted leading-snug mt-0.5">{lang === 'ja' ? entry.ja : entry.en}</p>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* 拡張機能 */}
        {extMatches.length > 0 && (
          <div className="pt-1 space-y-3">
            <div className="text-[11px] font-semibold text-arsist-text flex items-center gap-1"><Puzzle size={12} />{t('script.ref.extensions')}</div>
            {extMatches.map((ext) => (
              <div key={ext.id} className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-arsist-text">{ext.name}</span>
                  {ext.globals.map((g) => (
                    <button key={g} onClick={() => onInsert(g + '.')} className="text-[10px] font-mono px-1.5 rounded bg-arsist-accent/15 text-arsist-accent hover:bg-arsist-accent/25">{g}</button>
                  ))}
                </div>
                {ext.section ? (
                  <MiniMarkdown source={ext.section} className="text-[11px]" />
                ) : (
                  <p className="text-[10px] text-arsist-muted">{t('script.ref.noExtensionSection')}</p>
                )}
              </div>
            ))}
          </div>
        )}
        {extensions.length === 0 && !q && (
          <p className="text-[10px] text-arsist-muted">{t('script.ref.noExtensions')}</p>
        )}
        {sections.length === 0 && extMatches.length === 0 && (
          <p className="text-[11px] text-arsist-muted text-center py-6">{t('script.ref.noMatch')}</p>
        )}
      </div>
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
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div className="text-center text-arsist-muted text-[11px] py-6">
            <Zap size={24} className="mx-auto mb-2 opacity-20" />
            <p>{t('script.selectScript')}</p>
          </div>
          {/* 端末に保存する値 (project.storage.persist)。スクリプトが書く値なので、スクリプトタブに置く */}
          <StorageSection />
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

        {/* 端末に保存する値 (project.storage.persist) */}
        <StorageSection />

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
