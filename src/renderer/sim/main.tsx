/**
 * プレビュー シミュレータのページ (sim.html)。エディタの画面は持たない。
 * scripts/sim/electron-main.cjs が window.__arsistSim.render(job) を呼び、描き終わったら撮る (protocol.ts)。
 */
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/globals.css';
import { I18nProvider, useI18n } from '../i18n';
import { SpatialSim } from './SpatialSim';
import { VirtualSim } from './VirtualSim';
import type { SimFrameInfo, SimJob } from './protocol';

// エディタの Html 札 (drei) を、--overlays でないときは隠す。シミュレータ自身の札は .sim-keep で残す
const style = document.createElement('style');
style.textContent = `.sim-hide-html div:has(> canvas) ~ div:not(.sim-keep) { display: none !important; }`;
document.head.appendChild(style);

interface Current {
  job: SimJob;
  seq: number;
  resolve: (info: SimFrameInfo) => void;
}

let setCurrent: ((c: Current) => void) | null = null;
let seq = 0;

/** 名前 (家具の札など) の言語を job に合わせる */
function LangSync({ lang }: { lang: 'en' | 'ja' }) {
  const { lang: current, setLang } = useI18n();
  useEffect(() => { if (current !== lang) setLang(lang); }, [current, lang, setLang]);
  return null;
}

function SimApp() {
  const [current, set] = useState<Current | null>(null);
  setCurrent = set;
  if (!current) return null;
  const onReady = (info: SimFrameInfo) => {
    // DOM の札・フォントが落ち着くまで 2 フレーム待ってから「撮ってよい」と返す
    void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => current.resolve(info))));
  };
  return (
    <>
      <LangSync lang={current.job.lang} />
      {current.job.kind === 'spatial'
        ? <SpatialSim key={current.seq} job={current.job} onReady={onReady} />
        : <VirtualSim key={current.seq} job={current.job} onReady={onReady} />}
    </>
  );
}

window.__arsistSim = {
  render(job: SimJob) {
    document.documentElement.lang = job.lang;
    return new Promise<SimFrameInfo>((resolve) => {
      const go = () => (setCurrent ? setCurrent({ job, seq: ++seq, resolve }) : setTimeout(go, 20));
      go();
    });
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(<I18nProvider><SimApp /></I18nProvider>);
window.__arsistSimBoot = true;
