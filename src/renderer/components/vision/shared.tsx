/**
 * 画像処理エディタの部品: 値の種類のチップ、数値の表、結線エラーの文。
 *
 * 値の種類 (色の画 / 輝度 / マスク / …) は色で見分けられるようにしてある。
 * 「この一手はマスクを出す。次の一手はマスクを受け取る」が、色が同じなら繋がる。
 */
import { useT } from '../../i18n';
import { KIND_COLORS, type VisionValueKind } from '../../vision/opCatalog';
import type { PreviewStep } from '../../vision/usePreview';

export function kindColor(kind: string): string {
  return KIND_COLORS[kind as VisionValueKind] ?? '#666';
}

export function ValueChip({ name, kind, className = '' }: { name?: string; kind: string; className?: string }) {
  const t = useT();
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${className}`}
      style={{ backgroundColor: `${kindColor(kind)}22`, color: kindColor(kind) }}
      title={t(`vision.kind.${kind}`)}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: kindColor(kind) }} />
      {name ? <span className="font-mono">{name}</span> : t(`vision.kind.${kind}`)}
    </span>
  );
}

export function formatValue(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).length}}`;
  return String(value);
}

/** 数値や一覧を人が読める表にする。 */
export function RecordTable({ step, compact = false }: { step: PreviewStep; compact?: boolean }) {
  const t = useT();
  if (step.record) {
    const entries = Object.entries(step.record);
    return (
      <div className={`rounded-lg bg-arsist-bg p-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        {entries.map(([k, v]) => <RecordRow key={k} name={k} value={v} />)}
        {entries.length === 0 && <span className="text-arsist-muted">{t('vision.emptyRecord')}</span>}
      </div>
    );
  }
  if (step.items) {
    const items = step.items as Record<string, unknown>[];
    const hidden = new Set(['px', 'corners']);
    const columns = [...new Set(items.flatMap((i) => Object.keys(i)))].filter((c) => !hidden.has(c)).slice(0, 9);
    return (
      <div className={`rounded-lg bg-arsist-bg p-3 overflow-x-auto ${compact ? 'text-[11px]' : 'text-xs'}`}>
        <p className="text-arsist-muted mb-2">{t('vision.itemsCount', { count: items.length })}</p>
        {items.length > 0 && (
          <table className="w-full">
            <thead>
              <tr>{columns.map((c) => <th key={c} className="text-left font-normal text-arsist-muted pr-3 pb-1">{c}</th>)}</tr>
            </thead>
            <tbody>
              {items.slice(0, 12).map((item, i) => (
                <tr key={i}>{columns.map((c) => <td key={c} className="pr-3 font-mono whitespace-nowrap">{formatValue(item[c])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }
  if (step.boundary) {
    return (
      <div className="rounded-lg bg-arsist-bg p-3 text-xs text-arsist-muted">
        {t('vision.boundaryPoints', { count: step.boundary.length })}
      </div>
    );
  }
  return null;
}

function RecordRow({ name, value }: { name: string; value: unknown }) {
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
    return (
      <>
        <span className="text-arsist-muted">{name}</span>
        <span className="font-mono space-x-2">
          {(value as Record<string, unknown>[]).slice(0, 5).map((v, i) => (
            <span key={i}>{Object.values(v).map(formatValue).join(' ')}</span>
          ))}
        </span>
      </>
    );
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return (
      <>
        <span className="text-arsist-muted">{name}</span>
        <span className="font-mono">{Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${formatValue(v)}`).join(', ') || '{}'}</span>
      </>
    );
  }
  return (
    <>
      <span className="text-arsist-muted">{name}</span>
      <span className="font-mono break-all">{Array.isArray(value) ? value.map(formatValue).join(', ') : formatValue(value)}</span>
    </>
  );
}

/** 一手の結線チェックの短いメッセージを、人が読める文にする。 */
export function describeProblem(t: (key: string, params?: Record<string, string | number>) => string, message: string): string {
  const [code, ...rest] = message.split(':');
  const detail = rest.join(':');
  if (code === 'wrongType') {
    const [name, actual, wanted] = detail.split(':');
    return t('vision.problem.wrongTypeDetail', { name, actual: t(`vision.kind.${actual}`), wanted: t(`vision.kind.${wanted}`) });
  }
  if (code === 'outputNotAnchorable' || code === 'outputNotDrawable' || code === 'outputAlphaNotMask') {
    const [name, actual] = detail.split(':');
    return t(`vision.problem.${code}`, { detail: `${name} (${t(`vision.kind.${actual}`)})` });
  }
  return t(`vision.problem.${code}`, { detail });
}
