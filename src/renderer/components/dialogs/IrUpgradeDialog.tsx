/**
 * 古い版の IR を開いたときの「アップグレードするか」の確認。
 *
 * Unity が古いプロジェクトを新しいエディタで開くときと同じ考え方:
 *   - 何が変わるかを先に見せる
 *   - 承諾したら元のファイルを Backups/ に残してから書き戻す
 *   - 見送ったら読み取り専用のまま開く (編集はできるが保存できない)
 * 黙って新しい形で上書きはしない。
 */
import { createPortal } from 'react-dom';
import { ArrowUpCircle, ShieldCheck } from 'lucide-react';
import { useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';

export function IrUpgradeDialog() {
  const t = useT();
  const { irUpgrade, showIrUpgrade, upgradeProject, declineUpgrade } = useProjectStore();
  if (!showIrUpgrade || !irUpgrade) return null;

  const dialog = (
    <div className="modal-overlay" style={{ zIndex: 1000 }}>
      <div className="modal max-w-lg">
        <div className="modal-header flex items-center gap-2">
          <ArrowUpCircle size={18} className="text-arsist-accent" />
          <span>{t('ir.upgradeTitle', { from: irUpgrade.from, to: irUpgrade.to })}</span>
        </div>

        <div className="modal-body space-y-4">
          <p className="text-sm leading-relaxed">{t('ir.upgradeBody')}</p>

          <div className="rounded-lg bg-arsist-bg/50 p-3 space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-arsist-muted">{t('ir.whatChanges')}</p>
            <ul className="space-y-1.5">
              {irUpgrade.applied.map((id) => (
                <li key={id} className="text-sm flex gap-2">
                  <span className="text-arsist-muted shrink-0">v{id}</span>
                  <span>{t(`ir.migration.${id}`)}</span>
                </li>
              ))}
            </ul>
            {irUpgrade.changes.length > 0 && (
              <p className="text-[11px] text-arsist-muted leading-relaxed">
                {t('ir.changedFields', { fields: [...new Set(irUpgrade.changes)].join(', ') })}
              </p>
            )}
          </div>

          <p className="text-[11px] text-arsist-muted flex items-start gap-1.5 leading-relaxed">
            <ShieldCheck size={13} className="shrink-0 mt-0.5" />
            <span>{t('ir.backupNote')}</span>
          </p>
        </div>

        <div className="modal-footer flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={declineUpgrade}>{t('ir.openReadOnly')}</button>
          <button className="btn btn-primary" onClick={() => { void upgradeProject(); }}>{t('ir.upgradeNow')}</button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
