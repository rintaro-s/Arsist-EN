/**
 * Spatial のビルド。端末・出力先・開発ビルドを選び、main の spatial.build を呼ぶ。
 * 進み具合とログは Virtual のビルドと同じイベント (unity:build-progress / unity:build-log) で届く
 * (ビルドの機械は共有)。問題 (error) があるあいだはビルドしない。
 */
import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Hammer, X } from 'lucide-react';
import type { SpatialBuildResult } from '../../shared/layster/spatial/ipc';
import { useT, useI18n } from '../i18n';
import { useDeviceOptions, type DeviceOption } from '../extensions/useDeviceOptions';
import { spatialApi } from './api';
import { useSpatialStore } from './store';
import { useProblems } from './bottom/Problems';

const BASE_DEVICES: DeviceOption[] = [
  { id: 'Meta_Quest', name: 'Meta Quest', available: true },
  { id: 'XREAL_One', name: 'XREAL One', available: true },
  { id: 'Android_Phone', name: 'Android Phone', available: true },
];

export function SpatialBuildDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { lang } = useI18n();
  const project = useSpatialStore((s) => s.project);
  const dirty = useSpatialStore((s) => s.dirty);
  const save = useSpatialStore((s) => s.save);
  const update = useSpatialStore((s) => s.update);
  const devices = useDeviceOptions(BASE_DEVICES);
  const problems = useProblems();
  const errors = problems.filter((p) => p.level === 'error');
  const [outputPath, setOutputPath] = useState('');
  const [device, setDevice] = useState(project?.targetDevice ?? 'Meta_Quest');
  const [developmentBuild, setDevelopmentBuild] = useState(true);
  const [cleanBuild, setCleanBuild] = useState(false);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<{ value: number; message: string }>({ value: 0, message: '' });
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<SpatialBuildResult | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    void api.store.get('spatialBuildOutputPath').then((p: unknown) => { if (typeof p === 'string') setOutputPath(p); });
    const offProgress = api.unity.onBuildProgress((p: { progress: number; message: string }) => setProgress({ value: p.progress, message: p.message }));
    const offLog = api.unity.onBuildLog((line: string) => setLogs((l) => [...l.slice(-800), line]));
    return () => { try { offProgress?.(); } catch { /* */ } try { offLog?.(); } catch { /* */ } };
  }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [logs.length]);

  if (!project) return null;
  const api = spatialApi();

  const pickOutput = async () => {
    const dir = await window.electronAPI?.fs.selectDirectory();
    if (dir) {
      setOutputPath(dir);
      void window.electronAPI.store.set('spatialBuildOutputPath', dir);
    }
  };

  const build = async () => {
    if (!api || !outputPath) return;
    const deviceChanged = device !== project.targetDevice;
    if (deviceChanged) update((p) => { p.targetDevice = device; });
    // 保存してから (ビルドは main がディスクの中身を読む)
    if ((dirty || deviceChanged) && !(await save())) return;
    setBuilding(true);
    setResult(null);
    setLogs([]);
    try {
      setResult(await api.build({ outputPath, targetDevice: device, developmentBuild, cleanBuild }));
    } catch (e) {
      setResult({ success: false, error: (e as Error).message });
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={building ? undefined : onClose}>
      <div className="modal max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header flex items-center justify-between">
          <span className="flex items-center gap-2"><Hammer size={16} className="text-arsist-accent" />{t('spatial.build.title')}</span>
          <button onClick={onClose} className="btn-icon" disabled={building}><X size={18} /></button>
        </div>
        <div className="modal-body space-y-4 text-sm">
          <div>
            <label className="input-label">{t('spatial.build.device')}</label>
            <div className="flex flex-wrap gap-2">
              {devices.filter((d) => d.available).map((d) => (
                <button key={d.id} onClick={() => setDevice(d.id)}
                  className={`px-3 py-1.5 rounded-md text-xs ${device === d.id ? 'bg-arsist-accent/20 text-arsist-accent' : 'bg-arsist-hover text-arsist-text hover:bg-arsist-active'}`}>
                  {d.name}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-arsist-muted mt-1">{t('spatial.build.deviceHint')}</p>
          </div>
          <div>
            <label className="input-label">{t('spatial.build.output')}</label>
            <div className="flex gap-2">
              <input className="input flex-1 text-xs font-mono" value={outputPath} onChange={(e) => setOutputPath(e.target.value)} />
              <button className="btn btn-secondary" onClick={() => void pickOutput()}><FolderOpen size={16} /></button>
            </div>
          </div>
          <div className="flex gap-4 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" checked={developmentBuild} onChange={(e) => setDevelopmentBuild(e.target.checked)} />{t('spatial.build.development')}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={cleanBuild} onChange={(e) => setCleanBuild(e.target.checked)} />{t('spatial.build.clean')}</label>
          </div>
          {errors.length > 0 && (
            <div className="rounded-md bg-arsist-error/10 px-3 py-2 text-xs">
              <div className="text-arsist-error font-medium mb-1">{t('spatial.build.blocked', { n: errors.length })}</div>
              {errors.slice(0, 5).map((p, i) => <div key={i} className="text-arsist-text">• {p.message[lang]} <span className="text-arsist-muted font-mono">{p.path}</span></div>)}
            </div>
          )}
          {(building || logs.length > 0) && (
            <div className="space-y-1.5">
              <div className="progress-bar"><div className="progress-bar-fill" style={{ width: `${Math.round(progress.value)}%` }} /></div>
              <div className="text-[11px] text-arsist-muted">{progress.message}</div>
              <pre ref={logRef} className="h-40 overflow-auto rounded-md bg-arsist-bg p-2 font-mono text-[10px] text-arsist-muted whitespace-pre-wrap">{logs.join('\n')}</pre>
            </div>
          )}
          {result && (
            <div className={`rounded-md px-3 py-2 text-xs ${result.success ? 'bg-arsist-success/10 text-arsist-success' : 'bg-arsist-error/10 text-arsist-error'}`}>
              {result.success ? t('spatial.build.done', { path: result.outputPath ?? outputPath }) : t('spatial.build.failed', { error: result.error ?? '' })}
              {(result.problems ?? []).map((p, i) => <div key={i} className="text-arsist-text">• {p.message[lang]}</div>)}
              {(result.warnings ?? []).map((w, i) => <div key={`w${i}`} className="text-arsist-warning">• {w}</div>)}
            </div>
          )}
          {!api && <div className="text-xs text-arsist-error">{t('spatial.status.noBridge')}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={building}>{t('common.close')}</button>
          <button className="btn btn-primary" disabled={building || !outputPath || errors.length > 0 || !api} onClick={() => void build()}>
            {building ? <div className="spinner" /> : <Hammer size={14} />}
            {building ? t('spatial.build.building') : t('spatial.build.start')}
          </button>
        </div>
      </div>
    </div>
  );
}
