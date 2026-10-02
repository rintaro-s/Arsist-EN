/**
 * 未保存の変更がある間に、プロジェクトのファイルが外 (AI エージェント・MCP) で変わったときの知らせ。
 * (未保存の変更が無ければ、エディタは訊かずに読み直す: projectStore.handleExternalChange)
 */
import { AlertTriangle } from 'lucide-react';
import { useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';

export function ExternalChangeBanner() {
  const t = useT();
  const { externalChange, reloadProject, dismissExternalChange } = useProjectStore();
  if (!externalChange) return null;
  return (
    <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[950] rounded-lg bg-arsist-surface shadow-xl px-4 py-3 flex items-center gap-3 max-w-[90vw]">
      <AlertTriangle size={16} className="text-arsist-warning shrink-0" />
      <span className="text-xs">{t('ext.changed.title', { files: externalChange.files.slice(0, 3).join(', ') + (externalChange.files.length > 3 ? ' …' : '') })}</span>
      <button className="btn btn-secondary text-xs py-1" onClick={dismissExternalChange}>{t('ext.changed.keep')}</button>
      <button className="btn btn-primary text-xs py-1" onClick={() => { void reloadProject(); }}>{t('ext.changed.reload')}</button>
    </div>
  );
}
