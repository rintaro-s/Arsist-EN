/**
 * 「端末に保存する値」(project.storage.persist、IR v5)。
 *
 * store の値はふつうアプリを閉じると消える。ここに書いたキーだけは実機が端末に書き出し、次の起動でスクリプトより
 * 先に読み戻す (ArsistPersistentStore)。'memory.' のように末尾が '.' なら前方一致、それ以外はキーそのもの。
 * スクリプトが store.set している名前を拾って、どれが残るかを見せる。
 */
import { useMemo, useState } from 'react';
import { HardDrive, Plus, X, Check } from 'lucide-react';
import { isPersistedKey } from '../../../shared/types';
import { useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';

const STORE_SET = /\bstore\s*\.\s*set\s*\(\s*(['"`])([^'"`\n]+)\1/g;

/** 有効なスクリプトが store.set している名前 (文字で書いてあるものだけ) */
function keysWrittenByScripts(scripts: Array<{ code: string; enabled: boolean }>): string[] {
  const keys = new Set<string>();
  for (const s of scripts) {
    if (!s.enabled) continue;
    for (const m of (s.code ?? '').matchAll(STORE_SET)) {
      if (!m[2].includes('${')) keys.add(m[2]);
    }
  }
  return [...keys].sort();
}

export function StorageSection() {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const readOnly = useProjectStore((s) => s.readOnly);
  const setPersistedKeys = useProjectStore((s) => s.setPersistedKeys);
  const [draft, setDraft] = useState('');
  const persist = project?.storage?.persist ?? [];
  const written = useMemo(() => keysWrittenByScripts(project?.scripts ?? []), [project?.scripts]);

  // まとめて保存できる頭 ("memory.short" と "memory.episodes" → "memory.")
  const prefixes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const k of written) {
      const dot = k.indexOf('.');
      if (dot > 0) counts.set(k.slice(0, dot + 1), (counts.get(k.slice(0, dot + 1)) ?? 0) + 1);
    }
    // 2 つ以上あるものだけ (1 つならそのキーを残せばよい)
    return [...counts.entries()].filter(([p, n]) => n >= 2 && !persist.includes(p)).map(([p, n]) => ({ prefix: p, count: n }));
  }, [written, persist]);

  if (!project) return null;

  const add = (entry: string) => {
    const v = entry.trim();
    if (!v || persist.includes(v)) return;
    setPersistedKeys([...persist, v]);
  };
  const remove = (entry: string) => setPersistedKeys(persist.filter((p) => p !== entry));

  return (
    <div className="rounded-lg bg-arsist-hover p-3 space-y-2.5">
      <div className="flex items-center gap-1.5">
        <HardDrive size={14} className="text-arsist-accent" />
        <span className="text-xs font-semibold text-arsist-text">{t('storage.title')}</span>
      </div>
      <p className="text-[10px] text-arsist-muted leading-snug">{t('storage.help')}</p>

      {/* いま保存するもの */}
      <div className="flex flex-wrap gap-1">
        {persist.length === 0 && <span className="text-[10px] text-arsist-muted">{t('storage.none')}</span>}
        {persist.map((p) => (
          <span key={p} className="inline-flex items-center gap-1 text-[11px] font-mono pl-2 pr-1 py-0.5 rounded bg-arsist-accent/15 text-arsist-accent">
            {p}
            <span className="text-[9px] font-sans text-arsist-muted">{p.endsWith('.') ? t('storage.prefixTag') : t('storage.exactTag')}</span>
            {!readOnly && (
              <button className="hover:text-arsist-error" title={t('storage.remove')} onClick={() => remove(p)}><X size={11} /></button>
            )}
          </span>
        ))}
      </div>

      {!readOnly && (
        <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); add(draft); setDraft(''); }}>
          <input className="input text-xs font-mono flex-1" value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder={t('storage.placeholder')} />
          <button type="submit" className="btn btn-secondary text-xs py-1" disabled={!draft.trim()}><Plus size={12} />{t('storage.add')}</button>
        </form>
      )}

      {/* スクリプトが書いている名前 */}
      {written.length > 0 && (
        <div className="space-y-1 pt-1">
          <div className="text-[10px] text-arsist-muted">{t('storage.fromScripts')}</div>
          {prefixes.length > 0 && !readOnly && (
            <div className="flex flex-wrap gap-1">
              {prefixes.map(({ prefix, count }) => (
                <button key={prefix} onClick={() => add(prefix)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-arsist-bg/60 text-arsist-text hover:text-arsist-accent">
                  + {t('storage.addPrefix', { prefix, count })}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {written.map((k) => {
              const saved = isPersistedKey(k, persist);
              return (
                <div key={k} className="flex items-center gap-1.5 text-[11px]">
                  <span className={`w-3.5 shrink-0 ${saved ? 'text-arsist-success' : 'text-arsist-muted/40'}`}>{saved ? <Check size={11} /> : '·'}</span>
                  <span className="font-mono text-arsist-text flex-1 truncate">{k}</span>
                  {saved ? (
                    <span className="text-[9px] text-arsist-success">{t('storage.saved')}</span>
                  ) : !readOnly ? (
                    <button className="text-[9px] text-arsist-muted hover:text-arsist-accent" onClick={() => add(k)}>{t('storage.keep')}</button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="text-[10px] text-arsist-muted leading-snug">{t('storage.scriptHint')}</p>
    </div>
  );
}
