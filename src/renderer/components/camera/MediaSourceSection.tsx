/**
 * UI の Image のインスペクタの「映すもの」(UIElement.source、β1.1.0、doc/23)。
 *   画像 (source 無し = assetPath) / カメラ (シーンのカメラの物を選ぶ + 鏡) / 配信 (MJPEG の URL + 鏡)
 */
import { MonitorPlay } from 'lucide-react';
import type { MediaSource, UIElement } from '../../../shared/types';
import { cameraObjects, cameraRefOf, findCameraObject, streamUrlLooksValid } from '../../../shared/media';
import { useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { Toggle } from '../character/CharacterSection';

type Kind = 'none' | MediaSource['kind'];

export function MediaSourceSection({ element, onChange }: { element: UIElement; onChange: (source: MediaSource | undefined) => void }) {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const readOnly = useProjectStore((s) => s.readOnly);
  const src = element.source;
  const kind: Kind = src?.kind ?? 'none';
  const cams = project ? cameraObjects(project) : [];
  const missing = src?.kind === 'camera' && project && !findCameraObject(project, src.camera);

  const choose = (next: Kind) => {
    if (next === kind) return;
    if (next === 'none') onChange(undefined);
    else if (next === 'camera') onChange({ kind: 'camera', camera: cams[0] ? cameraRefOf(cams[0]) : '', ...(src?.mirror ? { mirror: true } : {}) });
    else onChange({ kind: 'stream', url: 'http://{store:pc.address}/stream/slides', ...(src?.mirror ? { mirror: true } : {}) });
  };
  const setMirror = (mirror: boolean) => src && onChange({ ...src, mirror: mirror || undefined } as MediaSource);

  return (
    <div className="p-3 rounded-lg bg-arsist-hover space-y-2">
      <div className="flex items-center gap-1.5">
        <MonitorPlay size={14} className="text-arsist-accent" />
        <span className="text-xs font-semibold text-arsist-text flex-1">{t('media.title')}</span>
      </div>
      <p className="text-[10px] text-arsist-muted leading-snug">{t('media.help')}</p>

      <div className="flex gap-1">
        {(['none', 'camera', 'stream'] as const).map((k) => (
          <button key={k} disabled={readOnly} onClick={() => choose(k)}
            className={`flex-1 px-2 py-1 rounded text-[11px] ${kind === k ? 'bg-arsist-active text-arsist-accent' : 'text-arsist-muted hover:bg-arsist-bg/50'}`}>
            {t(k === 'none' ? 'media.none' : k === 'camera' ? 'media.camera' : 'media.stream')}
          </button>
        ))}
      </div>

      {src?.kind === 'camera' && (
        <>
          {cams.length === 0 ? (
            <p className="text-[10px] text-arsist-warning leading-snug">{t('media.noCameras')}</p>
          ) : (
            <div>
              <label className="input-label">{t('media.pickCamera')}</label>
              <select className="input text-xs" value={missing ? '' : cameraRefOf(findCameraObject(project!, src.camera)!)} disabled={readOnly}
                onChange={(e) => onChange({ ...src, camera: e.target.value })}>
                {missing && <option value="">{t('media.missingCamera', { name: src.camera })}</option>}
                {cams.map((c) => <option key={c.id} value={cameraRefOf(c)}>{c.name}{c.assetId ? ` (${c.assetId})` : ''}</option>)}
              </select>
            </div>
          )}
          {missing && cams.length > 0 && <p className="text-[10px] text-arsist-error">{t('media.missingCamera', { name: src.camera })}</p>}
        </>
      )}

      {src?.kind === 'stream' && (
        <div>
          <label className="input-label">{t('media.url')}</label>
          <input className="input text-xs py-1 font-mono" value={src.url} disabled={readOnly} spellCheck={false}
            onChange={(e) => onChange({ ...src, url: e.target.value })} />
          {!streamUrlLooksValid(src.url) && <p className="text-[10px] text-arsist-warning mt-1">{t('media.urlBad')}</p>}
          <p className="text-[10px] text-arsist-muted leading-snug mt-1">{t('media.urlHint')}</p>
        </div>
      )}

      {src && (
        <Toggle label={t('media.mirror')} help="" value={src.mirror === true} disabled={readOnly} onChange={setMirror} />
      )}
      {src && element.bindingId && (
        <p className="text-[10px] text-arsist-muted font-mono break-all">{t('media.scriptHint', { id: element.bindingId })}</p>
      )}
    </div>
  );
}
