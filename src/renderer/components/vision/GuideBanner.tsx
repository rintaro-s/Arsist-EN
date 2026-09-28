/**
 * 初めて開いたときの案内。4 行で「何をどの順にすればよいか」を言う。
 * 閉じたら覚えておく (localStorage)。
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { useT } from '../../i18n';

const KEY = 'arsist.vision.guideDismissed';

export function GuideBanner() {
  const t = useT();
  const [dismissed, setDismissed] = useState(() => {
    try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  if (dismissed) return null;

  const close = () => {
    try { window.localStorage.setItem(KEY, '1'); } catch { /* 覚えられなくても困らない */ }
    setDismissed(true);
  };

  return (
    <div className="mx-4 mt-3 rounded-lg bg-arsist-accent/10 px-4 py-3 flex items-start gap-3">
      <ol className="flex-1 grid grid-cols-4 gap-3 text-[12px] leading-snug">
        {[1, 2, 3, 4].map((n) => (
          <li key={n} className="flex gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-arsist-accent text-arsist-bg text-[11px] font-medium flex items-center justify-center">{n}</span>
            <span>{t(`vision.guide.step${n}`)}</span>
          </li>
        ))}
      </ol>
      <button className="btn-icon shrink-0" onClick={close} title={t('common.close')}><X size={14} /></button>
    </div>
  );
}
