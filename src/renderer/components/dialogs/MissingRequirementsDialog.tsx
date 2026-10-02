/**
 * 開こうとしたプロジェクトが使う拡張機能・端末が、このエディタに無いとき。
 *
 * IR は「どの拡張機能を有効にしたか」「どの端末向けか」を持っているので、開く前に分かる
 * (src/shared/extensions.ts の checkProjectRequirements)。足りないまま開くと、その設定が画面に出ないまま
 * 保存され、ビルドからも黙って外れるので、開かずに理由を見せる。ここから拡張機能を読み込めば、そのまま開き直す。
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, FolderOpen, Package, RefreshCw } from 'lucide-react';
import { useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';

export function MissingRequirementsDialog() {
  const t = useT();
  const { missingRequirements, clearMissingRequirements, loadProject } = useProjectStore();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!missingRequirements) return null;

  const retry = async () => {
    setBusy(true);
    await loadProject(missingRequirements.path);
    setBusy(false);
  };

  const importExtension = async (kind: 'package' | 'folder') => {
    const api = window.electronAPI?.extensions;
    if (!api) return;
    setBusy(true);
    let result = await api.import(kind);
    // 同じ id が入っているときは、ここでは入れ替える (このプロジェクトを開くために選んだものなので)
    if (!result.ok && result.needsConfirm && result.source) result = await api.install(result.source, true);
    setBusy(false);
    if (result.canceled) return;
    if (!result.ok) {
      setMessage(t('ext.installFailed', { error: [result.error, ...(result.problems ?? [])].filter(Boolean).join(' / ') }));
      return;
    }
    setMessage(t('ext.installed', { id: result.id ?? '', version: result.version ?? '' }));
    await retry();
  };

  const dialog = (
    <div className="modal-overlay" style={{ zIndex: 1000 }}>
      <div className="modal max-w-lg">
        <div className="modal-header flex items-center gap-2">
          <AlertTriangle size={18} className="text-arsist-warning" />
          <span>{t('req.title')}</span>
        </div>
        <div className="modal-body space-y-4">
          <p className="text-sm leading-relaxed">{t('req.body')}</p>
          <ul className="rounded-lg bg-arsist-bg/50 p-3 space-y-2">
            {missingRequirements.missing.map((m) => (
              <li key={`${m.kind}:${m.id}`} className="text-sm">
                <span>{t(`req.kind.${m.kind}`, { id: m.id })}</span>
                <span className="block text-[11px] text-arsist-muted font-mono break-all">{m.detail}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-arsist-muted font-mono break-all">{missingRequirements.path}</p>
          {message && <p className="text-xs text-arsist-warning">{message}</p>}
        </div>
        <div className="modal-footer flex flex-wrap justify-end gap-2">
          <button className="btn btn-secondary" disabled={busy} onClick={clearMissingRequirements}>{t('common.close')}</button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => { void retry(); }}>
            <RefreshCw size={14} />{t('req.retry')}
          </button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => { void importExtension('folder'); }}>
            <FolderOpen size={14} />{t('ext.importFolder')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => { void importExtension('package'); }}>
            <Package size={14} />{t('ext.importPackage')}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
