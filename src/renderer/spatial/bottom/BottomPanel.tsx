/** 下の帯: 世界 / Mind の入出力 / 問題。 */
import { AlertTriangle, BrainCircuit, Table2 } from 'lucide-react';
import { useT } from '../../i18n';
import { useSpatialStore, type BottomTab } from '../store';
import { WorldTable } from './WorldTable';
import { MindIO } from './MindIO';
import { Problems, useProblems } from './Problems';

export function BottomPanel() {
  const t = useT();
  const tab = useSpatialStore((s) => s.bottomTab);
  const setTab = useSpatialStore((s) => s.setBottomTab);
  const problems = useProblems();
  const errors = problems.filter((p) => p.level === 'error').length;
  const tabs: Array<{ id: BottomTab; icon: JSX.Element; label: string; badge?: number; tone?: string }> = [
    { id: 'world', icon: <Table2 size={12} />, label: t('spatial.bottom.world') },
    { id: 'mind', icon: <BrainCircuit size={12} />, label: t('spatial.bottom.mind') },
    {
      id: 'problems', icon: <AlertTriangle size={12} />, label: t('spatial.bottom.problems'),
      badge: problems.length || undefined, tone: errors > 0 ? 'bg-arsist-error/20 text-arsist-error' : 'bg-arsist-warning/20 text-arsist-warning',
    },
  ];
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1 shrink-0 hairline-b">
        {tabs.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${tab === x.id ? 'bg-arsist-active text-arsist-accent' : 'text-arsist-muted hover:text-arsist-text hover:bg-arsist-hover'}`}>
            {x.icon}{x.label}
            {x.badge ? <span className={`text-[10px] px-1 rounded ${x.tone}`}>{x.badge}</span> : null}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {tab === 'world' && <WorldTable />}
        {tab === 'mind' && <MindIO />}
        {tab === 'problems' && <Problems />}
      </div>
    </div>
  );
}
