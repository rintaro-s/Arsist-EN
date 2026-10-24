/**
 * 新規作成 (Spatial): 名前・置き場所・ビルドに使う端末だけを訊く。中身 (机の上の札 1 枚・試す空間 5 つ) は
 * main が defaults.ts の createSpatialProject で作る。
 */
import { useEffect, useState } from 'react';
import { FolderOpen, Glasses } from 'lucide-react';
import { useT } from '../i18n';
import { useDeviceOptions, type DeviceOption } from '../extensions/useDeviceOptions';
import { spatialApi } from './api';
import { useSpatialStore } from './store';
import { useProjectStore } from '../stores/projectStore';

const BASE_DEVICES: DeviceOption[] = [
  { id: 'Meta_Quest', name: 'Meta Quest', available: true },
  { id: 'XREAL_One', name: 'XREAL One', available: true },
  { id: 'Android_Phone', name: 'Android Phone', available: true },
];

export function NewSpatialForm({ onCreated, onBack }: { onCreated: () => void; onBack: () => void }) {
  const t = useT();
  const devices = useDeviceOptions(BASE_DEVICES).filter((d) => d.available);
  const [name, setName] = useState('MySpatialApp');
  const [parentDir, setParentDir] = useState('');
  const [device, setDevice] = useState('Meta_Quest');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.electronAPI?.store.get('defaultProjectPath').then((p: unknown) => { if (typeof p === 'string') setParentDir(p); });
  }, []);

  const pick = async () => {
    const dir = await window.electronAPI?.fs.selectDirectory();
    if (dir) {
      setParentDir(dir);
      void window.electronAPI.store.set('defaultProjectPath', dir);
    }
  };

  const create = async () => {
    const api = spatialApi();
    if (!api) { setError(t('spatial.status.noBridge')); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api.create({ parentDir, name, targetDevice: device });
      if (!r.success || !r.project) { setError(r.error ?? 'unknown error'); return; }
      if (useProjectStore.getState().project) useProjectStore.getState().closeProject();
      useSpatialStore.getState().open(r.project, r.path ?? null);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="modal-body min-h-80 space-y-5">
        <div>
          <label className="input-label">{t('spatial.new.name')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="input-label">{t('spatial.new.location')}</label>
          <div className="flex gap-2">
            <input className="input flex-1" value={parentDir} onChange={(e) => setParentDir(e.target.value)} placeholder={t('spatial.new.locationPlaceholder')} />
            <button className="btn btn-secondary" onClick={() => void pick()}><FolderOpen size={18} /></button>
          </div>
        </div>
        <div>
          <label className="input-label">{t('spatial.new.device')}</label>
          <div className="grid grid-cols-3 gap-2">
            {devices.map((d) => (
              <button key={d.id} onClick={() => setDevice(d.id)}
                className={`p-3 rounded-lg text-left text-sm flex items-center gap-2 transition-colors ${device === d.id ? 'bg-arsist-accent/15 text-arsist-accent' : 'bg-arsist-hover hover:bg-arsist-active text-arsist-text'}`}>
                <Glasses size={16} /> {d.name}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-arsist-muted mt-1.5">{t('spatial.new.deviceHint')}</p>
        </div>
        <div className="p-3 bg-arsist-bg rounded-lg">
          <pre className="text-xs text-arsist-muted font-mono">{`${name}/
├── project.spatial.json   (Layster.Spatial)
├── Assets/
├── spaces/                ${t('spatial.new.spacesNote')}
└── Scripts/`}</pre>
        </div>
        {error && <div className="text-xs text-arsist-error">{error}</div>}
      </div>
      <div className="modal-footer">
        <button onClick={onBack} className="btn btn-ghost">{t('common.back')}</button>
        <div className="flex-1" />
        <button onClick={() => void create()} className="btn btn-primary" disabled={busy || !name.trim() || !parentDir.trim()}>
          {busy ? <div className="spinner" /> : null}
          {t('spatial.new.create')}
        </button>
      </div>
    </>
  );
}
