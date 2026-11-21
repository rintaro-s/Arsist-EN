/** インスペクタの頭: id (変えると参照も直す)・名前・複製・削除。 */
import { useEffect, useState, type ReactNode } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';

const ID_RE = /^[A-Za-z0-9_-]+$/;

export function ItemHeader({ icon, kindLabel, id, name, taken, onRename, onName, onDuplicate, onDelete }: {
  icon: ReactNode;
  kindLabel: string;
  id: string;
  name?: string;
  taken: string[];
  onRename: (id: string) => void;
  onName?: (name: string) => void;
  onDuplicate?: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(id);
  useEffect(() => setDraft(id), [id]);
  const bad = !ID_RE.test(draft) || (draft !== id && taken.includes(draft));
  const commit = () => {
    if (!bad && draft !== id) onRename(draft);
    else setDraft(id);
  };
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-arsist-muted">
          {icon}
          {kindLabel}
        </div>
        <div className="flex">
          {onDuplicate && <button className="btn-icon !p-1" title={t('spatial.common.duplicate')} onClick={onDuplicate}><Copy size={13} /></button>}
          <button className="btn-icon !p-1 hover:!text-arsist-error" title={t('spatial.common.delete')} onClick={onDelete}><Trash2 size={13} /></button>
        </div>
      </div>
      <div className="flex gap-1.5">
        <input
          className={`w-1/2 px-2 py-1 bg-arsist-hover rounded text-xs font-mono text-arsist-text focus:outline-none focus:ring-1 ${bad ? 'ring-1 ring-arsist-error' : 'focus:ring-arsist-accent/60'}`}
          value={draft}
          title={t('spatial.common.idHint')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        {onName && (
          <input
            className="w-1/2 px-2 py-1 bg-arsist-hover rounded text-xs text-arsist-text focus:outline-none focus:ring-1 focus:ring-arsist-accent/60"
            value={name ?? ''}
            placeholder={t('spatial.common.name')}
            onChange={(e) => onName(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}
