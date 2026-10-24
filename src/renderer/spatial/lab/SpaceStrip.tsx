/**
 * プロジェクトが使う試す空間の一覧。空間ごとに、物が本来の置き方で置けたかを数で出す。
 * 「どんな空間でも、どこかには置かれる」を一目で確かめるための帯。
 */
import { Plus } from 'lucide-react';
import { useT, useI18n } from '../../i18n';
import { useSpatialStore } from '../store';
import { useAllSolves } from '../useSolve';

export function SpaceStrip() {
  const t = useT();
  const { lang } = useI18n();
  const activeSpace = useSpatialStore((s) => s.activeSpace);
  const setActiveSpace = useSpatialStore((s) => s.setActiveSpace);
  const setSelection = useSpatialStore((s) => s.setSelection);
  const solves = useAllSolves();

  return (
    <div className="flex items-stretch gap-1.5 px-2 py-1.5 overflow-x-auto bg-arsist-surface hairline-b shrink-0">
      {solves.map(({ space, summary }) => {
        const tone = summary.atDefault > 0 ? 'bg-arsist-error' : summary.fallback > 0 ? 'bg-arsist-warning' : 'bg-arsist-success';
        const active = space.id === activeSpace;
        return (
          <button
            key={space.id}
            onClick={() => setActiveSpace(space.id)}
            className={`shrink-0 text-left px-2.5 py-1.5 rounded-md transition-colors min-w-[140px] ${active ? 'bg-arsist-active' : 'hover:bg-arsist-hover'}`}
            title={space.description?.[lang]}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-arsist-text">
              <span className={`w-2 h-2 rounded-full ${tone}`} />
              <span className="truncate">{space.name[lang]}</span>
            </div>
            <div className="text-[10px] text-arsist-muted mt-0.5 whitespace-nowrap">
              {summary.total === 0
                ? t('spatial.strip.empty')
                : [
                    t('spatial.strip.intended', { n: summary.intended, total: summary.total }),
                    summary.fallback > 0 ? t('spatial.strip.fallback', { n: summary.fallback }) : '',
                    summary.atDefault > 0 ? t('spatial.strip.default', { n: summary.atDefault }) : '',
                  ].filter(Boolean).join(' · ')}
            </div>
          </button>
        );
      })}
      <button
        onClick={() => setSelection({ kind: 'spaces' })}
        className="shrink-0 px-2 rounded-md text-arsist-muted hover:text-arsist-text hover:bg-arsist-hover flex items-center gap-1 text-xs"
        title={t('spatial.strip.editSpaces')}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
