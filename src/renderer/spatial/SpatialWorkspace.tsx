/**
 * Layster.Spatial のエディタ (doc/19-layster.md §4)。Virtual の MainLayout とは別の画面。
 *
 *   上   プロジェクト名・Layster の版・保存・取り消し・ビルド
 *   左   物 / Mind / 体 / 規則 / スクリプト / 記録・試す空間・設定
 *   中   Space Lab (試す空間の 3D と、空間ごとの置け方)。スクリプトを選んだときはコード
 *   右   インスペクタ
 *   下   世界 (entity の表) / Mind の入出力 / 問題
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Hammer, LogOut, Redo2, RefreshCw, Save, Undo2 } from 'lucide-react';
import { formatLayster } from '../../shared/layster/version';
import { useT } from '../i18n';
import { spatialApi } from './api';
import { useSpatialStore } from './store';
import { Outline } from './Outline';
import { SpaceLab } from './lab/SpaceLab';
import { Inspector } from './inspector/Inspector';
import { ScriptPane } from './inspector/ScriptInspector';
import { BottomPanel } from './bottom/BottomPanel';
import { SpatialBuildDialog } from './SpatialBuildDialog';

interface Layout { left: number; right: number; bottom: number }
const DEFAULT_LAYOUT: Layout = { left: 240, right: 360, bottom: 230 };

export function SpatialWorkspace() {
  const project = useSpatialStore((s) => s.project);
  const selection = useSpatialStore((s) => s.selection);
  const showBuild = useSpatialStore((s) => s.showBuild);
  const setShowBuild = useSpatialStore((s) => s.setShowBuild);
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const drag = useRef<keyof Layout | null>(null);

  useWorkspaceEffects();

  useEffect(() => {
    void window.electronAPI?.store.get('spatialLayout').then((v: unknown) => {
      if (v && typeof v === 'object') setLayout({ ...DEFAULT_LAYOUT, ...(v as Partial<Layout>) });
    });
  }, []);
  const persist = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persist.current) clearTimeout(persist.current);
    persist.current = setTimeout(() => { void window.electronAPI?.store.set('spatialLayout', layout); }, 400);
  }, [layout]);

  const onMove = useCallback((e: React.MouseEvent) => {
    const which = drag.current;
    if (!which) return;
    setLayout((l) => {
      if (which === 'left') return { ...l, left: Math.min(480, Math.max(180, e.clientX)) };
      if (which === 'right') return { ...l, right: Math.min(640, Math.max(260, window.innerWidth - e.clientX)) };
      return { ...l, bottom: Math.min(window.innerHeight - 260, Math.max(120, window.innerHeight - e.clientY)) };
    });
  }, []);
  const stop = () => { drag.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
  const start = (which: keyof Layout) => () => {
    drag.current = which;
    document.body.style.cursor = which === 'bottom' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  };

  if (!project) return null;
  const script = selection?.kind === 'script' ? project.scripts.find((x) => x.id === selection.id) : undefined;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" onMouseMove={onMove} onMouseUp={stop} onMouseLeave={stop}>
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        <div style={{ width: layout.left }} className="shrink-0 bg-arsist-surface"><Outline /></div>
        <Handle vertical onMouseDown={start('left')} />
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0">{script ? <ScriptPane script={script} /> : <SpaceLab />}</div>
          <Handle onMouseDown={start('bottom')} />
          <div style={{ height: layout.bottom }} className="shrink-0 bg-arsist-surface"><BottomPanel /></div>
        </div>
        <Handle vertical onMouseDown={start('right')} />
        <div style={{ width: layout.right }} className="shrink-0 bg-arsist-surface"><Inspector /></div>
      </div>
      {showBuild && <SpatialBuildDialog onClose={() => setShowBuild(false)} />}
    </div>
  );
}

function Handle({ vertical, onMouseDown }: { vertical?: boolean; onMouseDown: () => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={`${vertical ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'} shrink-0 hover:bg-arsist-accent/40 transition-colors`}
      style={{ backgroundColor: 'rgb(var(--arsist-divider) / var(--arsist-divider-alpha))', padding: vertical ? '0 1px' : '1px 0' }}
    />
  );
}

/** 外での書き換え・キー操作・知らせを消す時計。 */
function useWorkspaceEffects() {
  const save = useSpatialStore((s) => s.save);
  const undo = useSpatialStore((s) => s.undo);
  const redo = useSpatialStore((s) => s.redo);
  const status = useSpatialStore((s) => s.status);
  const setStatus = useSpatialStore((s) => s.setStatus);

  useEffect(() => {
    const api = spatialApi();
    if (!api?.onChanged) return;
    return api.onChanged(() => {
      const s = useSpatialStore.getState();
      if (!s.project) return;
      if (s.dirty) useSpatialStore.setState({ externalChange: true });
      else void s.reloadFromDisk();
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); void save(); return; }
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (typing) return;
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, undo, redo]);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), status.type === 'error' ? 8000 : 2500);
    return () => clearTimeout(timer);
  }, [status, setStatus]);
}

function TopBar() {
  const t = useT();
  const project = useSpatialStore((s) => s.project)!;
  const dirty = useSpatialStore((s) => s.dirty);
  const canUndo = useSpatialStore((s) => s.undoStack.length > 0);
  const canRedo = useSpatialStore((s) => s.redoStack.length > 0);
  const externalChange = useSpatialStore((s) => s.externalChange);
  const status = useSpatialStore((s) => s.status);
  const { save, undo, redo, close, reloadFromDisk, setShowBuild } = useSpatialStore.getState();

  return (
    <div className="h-11 shrink-0 flex items-center gap-2 px-3 bg-arsist-surface hairline-b">
      <button className="btn-icon !p-1.5" title={t('spatial.top.close')} onClick={() => {
        if (dirty && !window.confirm(t('spatial.top.closeUnsaved'))) return;
        close();
      }}><LogOut size={15} /></button>
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-sm font-semibold text-arsist-text truncate">{project.name}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-arsist-accent/15 text-arsist-accent whitespace-nowrap">{formatLayster(project.layster)}</span>
        <span className="text-[11px] text-arsist-muted whitespace-nowrap">{dirty ? t('spatial.top.unsaved') : t('spatial.top.saved')}</span>
      </div>

      {externalChange && (
        <div className="flex items-center gap-1.5 ml-3 px-2 py-1 rounded-md bg-arsist-warning/15 text-arsist-warning text-[11px]">
          <AlertCircle size={12} /> {t('spatial.top.externalChange')}
          <button className="underline" onClick={() => void reloadFromDisk()}><RefreshCw size={11} className="inline mr-0.5" />{t('spatial.top.reload')}</button>
        </div>
      )}

      <div className="flex-1" />
      {status && (
        <div className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md ${status.type === 'error' ? 'bg-arsist-error/15 text-arsist-error' : 'text-arsist-success'}`}>
          {status.type === 'error' ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
          {t(status.key, status.params)}
        </div>
      )}
      <button className="btn-icon !p-1.5" disabled={!canUndo} title={t('spatial.top.undo')} onClick={undo}><Undo2 size={15} /></button>
      <button className="btn-icon !p-1.5" disabled={!canRedo} title={t('spatial.top.redo')} onClick={redo}><Redo2 size={15} /></button>
      <button className="btn btn-secondary !px-3 !py-1 text-xs" disabled={!dirty} onClick={() => void save()}><Save size={13} />{t('spatial.top.save')}</button>
      <button className="btn btn-primary !px-3 !py-1 text-xs" onClick={() => setShowBuild(true)}><Hammer size={13} />{t('spatial.top.build')}</button>
    </div>
  );
}
