/**
 * カメラの物 (type 'camera') のインスペクタ。camera (CameraSettings、β1.1.0、doc/23) を編集する。
 * 写る画は 3D ビューの左下の小窓 (CameraPreview) に出る。
 */
import { Video } from 'lucide-react';
import type { CameraSettings, SceneObject, UIElement } from '../../../shared/types';
import {
  CAMERA_RESOLUTION_MAX,
  CAMERA_RESOLUTION_MIN,
  CAMERA_RESOLUTION_PRESETS,
  cameraRefOf,
  cameraSettingsOf,
} from '../../../shared/media';
import { useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { Toggle } from '../character/CharacterSection';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function countUsers(root: UIElement | undefined, obj: SceneObject): number {
  if (!root) return 0;
  const self = root.source?.kind === 'camera' && (root.source.camera === obj.id || root.source.camera === obj.assetId) ? 1 : 0;
  return self + (root.children ?? []).reduce((n, c) => n + countUsers(c, obj), 0);
}

export function CameraSection({ object }: { object: SceneObject }) {
  const t = useT();
  const readOnly = useProjectStore((s) => s.readOnly);
  const updateObject = useProjectStore((s) => s.updateObject);
  const layouts = useProjectStore((s) => s.project?.uiLayouts);
  const s = cameraSettingsOf(object.camera);
  const set = (updates: Partial<CameraSettings>) => updateObject(object.id, { camera: { ...s, ...updates } });
  const [w, h] = s.resolution;
  const presetIndex = CAMERA_RESOLUTION_PRESETS.findIndex(([pw, ph]) => pw === w && ph === h);
  const users = (layouts ?? []).reduce((n, l) => n + countUsers(l.root, object), 0);
  const id = cameraRefOf(object);

  return (
    <div className="p-3 rounded-lg bg-arsist-hover space-y-2.5">
      <div className="flex items-center gap-1.5">
        <Video size={14} className="text-arsist-accent" />
        <span className="text-xs font-semibold text-arsist-text flex-1">{t('camera.title')}</span>
      </div>
      <p className="text-[10px] text-arsist-muted leading-snug">{t('camera.help')}</p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="input-label">{t('camera.fov')}</label>
          <input type="number" min={1} max={179} step={1} className="input text-xs py-1" value={s.fov} disabled={readOnly}
            onChange={(e) => set({ fov: clamp(Number(e.target.value) || 50, 1, 179) })} />
        </div>
        <div>
          <label className="input-label">{t('camera.fps')}</label>
          <input type="number" min={0} max={120} step={1} className="input text-xs py-1" value={s.fps} disabled={readOnly}
            onChange={(e) => set({ fps: clamp(Math.round(Number(e.target.value) || 0), 0, 120) })} />
        </div>
      </div>
      <p className="text-[10px] text-arsist-muted leading-snug -mt-1">{t('camera.fpsHelp')}</p>

      <div>
        <label className="input-label">{t('camera.resolution')}</label>
        <select className="input text-xs" value={presetIndex >= 0 ? String(presetIndex) : 'custom'} disabled={readOnly}
          onChange={(e) => {
            if (e.target.value === 'custom') return;
            const [pw, ph] = CAMERA_RESOLUTION_PRESETS[Number(e.target.value)];
            set({ resolution: [pw, ph] });
          }}>
          {CAMERA_RESOLUTION_PRESETS.map(([pw, ph], i) => (
            <option key={i} value={String(i)}>{pw} × {ph} ({t(pw >= ph ? 'camera.landscape' : 'camera.portrait')})</option>
          ))}
          <option value="custom">{t('camera.custom')}</option>
        </select>
        {presetIndex < 0 && (
          <div className="grid grid-cols-2 gap-2 mt-1.5">
            {[0, 1].map((i) => (
              <input key={i} type="number" min={CAMERA_RESOLUTION_MIN} max={CAMERA_RESOLUTION_MAX} step={2} className="input text-xs py-1"
                value={s.resolution[i]} disabled={readOnly}
                onChange={(e) => {
                  const next: [number, number] = [w, h];
                  next[i] = clamp(Math.round(Number(e.target.value) || 0), CAMERA_RESOLUTION_MIN, CAMERA_RESOLUTION_MAX);
                  set({ resolution: next });
                }} />
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="input-label">{t('camera.background')}</label>
        <div className="flex items-center gap-1.5">
          <input type="color" value={s.backgroundColor} disabled={readOnly} className="w-7 h-7 rounded cursor-pointer bg-transparent"
            onChange={(e) => set({ backgroundColor: e.target.value })} />
          <input className="input text-xs py-1 flex-1 font-mono" value={s.backgroundColor} disabled={readOnly}
            onChange={(e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) set({ backgroundColor: e.target.value }); }} />
        </div>
        <p className="text-[10px] text-arsist-muted leading-snug mt-1">{t('camera.backgroundHelp')}</p>
      </div>

      <Toggle label={t('camera.showSelf')} help={t('camera.showSelfHelp')} value={s.showSelf} disabled={readOnly}
        onChange={(v) => set({ showSelf: v })} />
      <Toggle label={t('camera.showGizmo')} help={t('camera.showGizmoHelp')} value={s.showGizmo} disabled={readOnly}
        onChange={(v) => set({ showGizmo: v })} />

      <p className="text-[10px] text-arsist-muted leading-snug">{t('camera.previewHint')}</p>
      {users > 0 && <p className="text-[10px] text-arsist-accent">{t('camera.usedBy', { count: users })}</p>}
      <p className="text-[10px] text-arsist-muted font-mono break-all">{t('camera.scriptHint', { id })}</p>
    </div>
  );
}
