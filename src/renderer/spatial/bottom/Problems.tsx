/** 下の「問題」: validateSpatialProject の一覧。押すと、その物・Mind・規則を開く。 */
import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { validateSpatialProject, type SpatialProblem } from '../../../shared/layster/spatial/validate';
import { useT, useI18n } from '../../i18n';
import { useSpatialStore, type SpatialSelection } from '../store';

export function selectionForPath(path: string): SpatialSelection {
  const m = /^(things|minds|bodies|rules|scripts)\[([^\]]+)\]/.exec(path);
  if (m) {
    const kind = ({ things: 'thing', minds: 'mind', bodies: 'body', rules: 'rule', scripts: 'script' } as const)[m[1] as 'things'];
    return { kind, id: m[2] };
  }
  if (path.startsWith('recording')) return { kind: 'recording' };
  return { kind: 'settings' };
}

export function useProblems(): SpatialProblem[] {
  const project = useSpatialStore((s) => s.project);
  return useMemo(() => (project ? validateSpatialProject(project) : []), [project]);
}

export function Problems() {
  const t = useT();
  const { lang } = useI18n();
  const problems = useProblems();
  const setSelection = useSpatialStore((s) => s.setSelection);
  if (problems.length === 0) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-arsist-muted">
        <CheckCircle2 size={14} className="text-arsist-success" /> {t('spatial.problems.none')}
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto py-1">
      {problems.map((p, i) => (
        <button key={i} onClick={() => setSelection(selectionForPath(p.path))}
          className="w-full flex items-start gap-2 px-3 py-1 text-left text-xs hover:bg-arsist-hover">
          {p.level === 'error'
            ? <XCircle size={13} className="text-arsist-error shrink-0 mt-0.5" />
            : <AlertTriangle size={13} className="text-arsist-warning shrink-0 mt-0.5" />}
          <span className="text-arsist-text">{p.message[lang]}</span>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-arsist-muted">{p.path}</span>
        </button>
      ))}
    </div>
  );
}
