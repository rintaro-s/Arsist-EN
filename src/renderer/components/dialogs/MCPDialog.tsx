/**
 * 外部の AI エージェントに Arsist の MCP サーバーを登録する画面。
 *
 * 旧版はエディタの中で MCP サーバーを起動していたが、stdio の MCP サーバーはエージェントの側が起動するもの
 * (そのうえ Electron を Node として起こせていなかった)。今は:
 *   - エージェントごとに、その設定ファイルへワンクリックで登録 / 更新 / 削除 (src/main/mcp/agentTargets.ts)
 *   - どのクライアントにも貼れる JSON と、起動コマンドをコピー
 *   - エージェントと同じ起動の仕方で、サーバーが動くかを試す
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Server, Copy, Check, Play, CheckCircle2, AlertCircle, Circle } from 'lucide-react';
import { useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import type { McpAgentsInfo } from '../../ai/types';

export function MCPDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { project, projectPath } = useProjectStore();
  const [includeProject, setIncludeProject] = useState(Boolean(projectPath));
  const [info, setInfo] = useState<McpAgentsInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; warn?: boolean } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const api = window.electronAPI?.mcp;

  const refresh = async () => setInfo((await api?.agents(includeProject)) ?? null);
  useEffect(() => { void refresh(); }, [includeProject]);

  const act = async (id: string, action: 'register' | 'unregister') => {
    if (!api) return;
    setBusy(id);
    const r = action === 'register' ? await api.register(id, includeProject) : await api.unregister(id);
    setMessage({ text: r.message, warn: !r.ok });
    setBusy(null);
    await refresh();
  };

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const selfTest = async () => {
    if (!api) return;
    setBusy('self-test');
    const r = await api.selfTest(includeProject);
    setBusy(null);
    setMessage(r.ok
      ? { text: t('mcp2.selfTestOk', { tools: r.tools ?? 0, ms: r.ms ?? 0 }) }
      : { text: t('mcp2.selfTestFailed', { error: [r.error, r.stderr].filter(Boolean).join(' — ') }), warn: true });
  };

  const dialog = (
    <div className="modal-overlay" style={{ zIndex: 1000 }}>
      <div className="modal max-w-2xl w-full">
        <div className="modal-header flex items-center gap-2">
          <Server size={18} className="text-arsist-accent" />
          <span className="flex-1">{t('mcp2.title')}</span>
          <button className="btn btn-ghost p-1" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body space-y-4 max-h-[70vh] overflow-y-auto">
          <p className="text-xs text-arsist-muted leading-relaxed">{t('mcp2.intro')}</p>

          {projectPath ? (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" className="accent-arsist-accent" checked={includeProject} onChange={(e) => setIncludeProject(e.target.checked)} />
              {t('mcp2.includeProject', { name: project?.name ?? projectPath })}
            </label>
          ) : (
            <p className="text-xs text-arsist-muted">{t('mcp2.noProject')}</p>
          )}

          <div className="rounded-lg bg-arsist-bg/50 divide-y divide-arsist-border/30">
            {(info?.agents ?? []).map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2">
                {a.status === 'registered' ? <CheckCircle2 size={15} className="text-arsist-success shrink-0" />
                  : a.status === 'outdated' || a.status === 'unreadable' ? <AlertCircle size={15} className="text-arsist-warning shrink-0" />
                  : <Circle size={15} className="text-arsist-muted shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm">
                    {a.name}
                    <span className={`ml-2 text-[10px] ${a.detected ? 'text-arsist-success' : 'text-arsist-muted'}`}>{a.detected ? t('mcp2.detected') : t('mcp2.notDetected')}</span>
                  </div>
                  <div className="text-[10px] text-arsist-muted truncate" title={a.detail ?? a.configPath ?? ''}>
                    {t(`mcp2.status.${a.status}`)} · {a.via === 'cli' ? 'claude mcp' : a.configPath}
                  </div>
                </div>
                {a.status !== 'notRegistered' && a.status !== 'unreadable' && (
                  <button className="btn btn-ghost text-xs py-1" disabled={busy !== null} onClick={() => { void act(a.id, 'unregister'); }}>{t('mcp2.remove')}</button>
                )}
                <button className="btn btn-secondary text-xs py-1" disabled={busy !== null || a.status === 'unreadable'} onClick={() => { void act(a.id, 'register'); }}>
                  {a.status === 'registered' || a.status === 'outdated' ? t('mcp2.update') : t('mcp2.add')}
                </button>
              </div>
            ))}
          </div>

          {message && <p className={`text-xs break-all ${message.warn ? 'text-arsist-warning' : 'text-arsist-success'}`}>{message.text}</p>}

          <div className="space-y-2">
            <p className="text-xs text-arsist-muted">{t('mcp2.otherAgents')}</p>
            <pre className="text-[10px] font-mono bg-arsist-bg/60 rounded-lg p-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">{info?.json}</pre>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-secondary text-xs py-1" onClick={() => { if (info) void copy('json', info.json); }}>
                {copied === 'json' ? <Check size={12} /> : <Copy size={12} />}{copied === 'json' ? t('mcp2.copied') : t('mcp2.copyJson')}
              </button>
              <button className="btn btn-secondary text-xs py-1" onClick={() => { if (info) void copy('cmd', info.commandLine); }}>
                {copied === 'cmd' ? <Check size={12} /> : <Copy size={12} />}{copied === 'cmd' ? t('mcp2.copied') : t('mcp2.copyCommand')}
              </button>
              <button className="btn btn-secondary text-xs py-1" disabled={busy !== null} onClick={() => { void selfTest(); }}>
                <Play size={12} />{t('mcp2.selfTest')}
              </button>
            </div>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-arsist-muted">{t('mcp2.toolsTitle', { count: info?.tools.length ?? 0 })}</summary>
            <ul className="mt-2 space-y-1">
              {(info?.tools ?? []).map((tool) => (
                <li key={tool.name} className="text-[11px]">
                  <span className="font-mono text-arsist-text">{tool.name}</span>
                  {tool.readOnly && <span className="ml-1 text-[10px] text-arsist-muted">({t('mcp2.readOnlyTool')})</span>}
                  <span className="block text-arsist-muted">{tool.description}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
