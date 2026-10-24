/** 下の「世界」: 選んだ試す空間の entity の一覧 (Mind が見るのと同じもの)。 */
import { useEffect, useRef } from 'react';
import { affordancesOf } from '../../../shared/layster/spatial/vocabulary';
import { useT, useI18n } from '../../i18n';
import { useSpatialStore } from '../store';
import { useActiveSolve } from '../useSolve';
import { entityColor, entityName } from '../lab/EntityBoxes';

const fmt = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

export function WorldTable() {
  const t = useT();
  const { lang } = useI18n();
  const solve = useActiveSolve();
  const selected = useSpatialStore((s) => s.selectedEntity);
  const setSelected = useSpatialStore((s) => s.setSelectedEntity);
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => { rowRef.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  if (!solve) return null;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-arsist-surface text-arsist-muted">
          <tr className="text-left">
            {['id', 'is', 'at', 'size', 'yaw', 'confidence', 'source', 'has'].map((h) => (
              <th key={h} className="px-2 py-1 font-medium">{t(`spatial.world.col.${h}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {solve.world.entities.map((e) => (
            <tr key={e.id} ref={e.id === selected ? rowRef : undefined}
              onClick={() => setSelected(e.id)}
              className={`cursor-pointer ${e.id === selected ? 'bg-arsist-active' : 'hover:bg-arsist-hover'}`}>
              <td className="px-2 py-0.5 font-mono"><span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: entityColor(e) }} />{e.id}</td>
              <td className="px-2 py-0.5">{entityName(e, lang)}{e.is.length > 1 ? ` (${e.is.slice(1).join(', ')})` : ''}</td>
              <td className="px-2 py-0.5 font-mono text-arsist-muted">{e.at.map(fmt).join(', ')}</td>
              <td className="px-2 py-0.5 font-mono text-arsist-muted">{e.size.map(fmt).join(' × ')}</td>
              <td className="px-2 py-0.5 font-mono text-arsist-muted">{Math.round(e.yaw ?? 0)}°</td>
              <td className="px-2 py-0.5 font-mono">{Math.round(e.confidence * 100)}%</td>
              <td className="px-2 py-0.5 text-arsist-muted">{e.source}</td>
              <td className="px-2 py-0.5 text-arsist-muted">{affordancesOf(e).map((a) => t(`spatial.affordance.${a}`)).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
