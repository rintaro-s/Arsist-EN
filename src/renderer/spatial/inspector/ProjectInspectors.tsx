/** プロジェクト全体の設定: アプリ・現実の見せ方・操作・端末に残す値 / 記録 / 試す空間。 */
import { AlertTriangle, Copy, Plus } from 'lucide-react';
import type { RecordingStream, SpaceFixture, SpatialProject } from '../../../shared/layster/spatial/types';
import { BUILTIN_SPACES } from '../../../shared/layster/spatial/spaces';
import { formatLayster } from '../../../shared/layster/version';
import { useT, useI18n } from '../../i18n';
import { spatialApi } from '../api';
import { uniqueId, useSpatialStore } from '../store';
import { Chips, Field, NumberInput, Section, Select, TextArea, TextInput, Toggle } from './fields';

export function SettingsInspector({ project }: { project: SpatialProject }) {
  const t = useT();
  const update = useSpatialStore((s) => s.update);
  return (
    <div>
      <div className="text-[11px] text-arsist-muted mb-3">{formatLayster(project.layster)}</div>
      <Section title={t('spatial.settings.app')}>
        <Field label={t('spatial.settings.name')}><TextInput value={project.name} onChange={(name) => update((p) => { p.name = name; }, 'name')} /></Field>
        <Field label={t('spatial.settings.packageName')}><TextInput mono value={project.app.packageName} onChange={(v) => update((p) => { p.app.packageName = v; }, 'pkg')} /></Field>
        <div className="grid grid-cols-2 gap-1.5">
          <Field label={t('spatial.settings.version')}><TextInput mono value={project.version} onChange={(v) => update((p) => { p.version = v; }, 'ver')} /></Field>
          <Field label={t('spatial.settings.versionCode')}><NumberInput value={project.app.versionCode} step={1} onChange={(v) => update((p) => { p.app.versionCode = v ?? 1; })} /></Field>
          <Field label="minSdk"><NumberInput value={project.app.minSdkVersion} step={1} onChange={(v) => update((p) => { p.app.minSdkVersion = v ?? 29; })} /></Field>
          <Field label="targetSdk"><NumberInput value={project.app.targetSdkVersion} step={1} onChange={(v) => update((p) => { p.app.targetSdkVersion = v ?? 34; })} /></Field>
        </div>
        <Field label={t('spatial.settings.edge')} hint={t('spatial.settings.edgeHint')}>
          <TextInput mono value={project.app.edge} placeholder="192.168.0.23:8000" onChange={(edge) => update((p) => { p.app.edge = edge || undefined; }, 'edge')} />
        </Field>
      </Section>
      <Section title={t('spatial.settings.presentation')}>
        <Select value={project.presentation.reality}
          options={[{ value: 'passthrough', label: t('spatial.settings.reality.passthrough') }, { value: 'virtual-room', label: t('spatial.settings.reality.virtualRoom') }]}
          onChange={(reality) => update((p) => { p.presentation.reality = reality; })} />
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-arsist-muted">{t('spatial.settings.assumedEyeHeight')}</span>
          <NumberInput value={project.presentation.assumedEyeHeight ?? 1.5} step={0.05} onChange={(v) => update((p) => { p.presentation.assumedEyeHeight = v; })} />
          <span className="text-arsist-muted">m</span>
        </div>
      </Section>
      <Section title={t('spatial.settings.interaction')}>
        <Toggle checked={project.interaction.controllers} label={t('spatial.settings.controllers')} onChange={(v) => update((p) => { p.interaction.controllers = v; })} />
        <Toggle checked={project.interaction.hands} label={t('spatial.settings.hands')} onChange={(v) => update((p) => { p.interaction.hands = v; })} />
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-arsist-muted">{t('spatial.settings.gazeDwell')}</span>
          <NumberInput value={project.interaction.gazeDwellSeconds ?? 0} step={0.5} onChange={(v) => update((p) => { p.interaction.gazeDwellSeconds = v; })} />
          <span className="text-arsist-muted">s</span>
        </div>
      </Section>
      <Section title={t('spatial.settings.memory')}>
        <Field label={t('spatial.settings.persist')} hint={t('spatial.settings.persistHint')}>
          <TextInput mono value={project.memory.persist.join(', ')} placeholder="memory., settings.edge"
            onChange={(text) => update((p) => { p.memory.persist = text.split(',').map((k) => k.trim()).filter(Boolean); }, 'persist')} />
        </Field>
      </Section>
    </div>
  );
}

const STREAMS: RecordingStream[] = ['pose', 'hands', 'world', 'events', 'actions', 'minds', 'camera'];

export function RecordingInspector({ project }: { project: SpatialProject }) {
  const t = useT();
  const update = useSpatialStore((s) => s.update);
  const r = project.recording;
  return (
    <div>
      <div className="text-[11px] text-arsist-muted mb-3">{t('spatial.recording.about')}</div>
      <Toggle checked={r.enabled} label={t('spatial.recording.enabled')} onChange={(v) => update((p) => { p.recording.enabled = v; })} />
      <Section title={t('spatial.recording.streams')}>
        <Chips<RecordingStream> options={STREAMS.map((s) => ({ value: s, label: t(`spatial.recording.stream.${s}`) }))}
          value={r.streams} onChange={(streams) => update((p) => { p.recording.streams = streams; })} />
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-arsist-muted">{t('spatial.recording.hz')}</span>
          <NumberInput value={r.hz ?? 10} step={1} onChange={(hz) => update((p) => { p.recording.hz = hz; })} />
          <span className="text-arsist-muted">Hz · {t('spatial.recording.maxMinutes')}</span>
          <NumberInput value={r.maxMinutes} step={5} onChange={(maxMinutes) => update((p) => { p.recording.maxMinutes = maxMinutes; })} />
        </div>
        {r.streams.includes('camera') && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-arsist-muted">{t('spatial.recording.camera')}</span>
            <NumberInput value={r.camera?.width ?? 320} step={32} onChange={(width) => update((p) => { p.recording.camera = { width: width ?? 320, everyMs: p.recording.camera?.everyMs ?? 1000 }; })} />
            <span className="text-arsist-muted">px /</span>
            <NumberInput value={r.camera?.everyMs ?? 1000} step={250} width="w-20" onChange={(everyMs) => update((p) => { p.recording.camera = { width: p.recording.camera?.width ?? 320, everyMs: everyMs ?? 1000 }; })} />
            <span className="text-arsist-muted">ms</span>
          </div>
        )}
      </Section>
      <Section title={t('spatial.recording.consent')}>
        <TextArea rows={4} value={r.consent.text} onChange={(text) => update((p) => { p.recording.consent = { text }; }, 'consent')} />
      </Section>
      <Section title={t('spatial.recording.send')}>
        <Field label={t('spatial.recording.sendUrl')} hint={t('spatial.recording.sendHint')}>
          <TextInput mono value={r.send?.url} placeholder="http://{edge}/episodes" onChange={(url) => update((p) => { if (url) p.recording.send = { url }; else delete p.recording.send; }, 'send')} />
        </Field>
      </Section>
    </div>
  );
}

export function SpacesInspector({ project }: { project: SpatialProject }) {
  const t = useT();
  const { lang } = useI18n();
  const update = useSpatialStore((s) => s.update);
  const projectSpaces = useSpatialStore((s) => s.projectSpaces);
  const loadSpaces = useSpatialStore((s) => s.loadSpaces);
  const setStatus = useSpatialStore((s) => s.setStatus);
  const setActiveSpace = useSpatialStore((s) => s.setActiveSpace);
  const all: Array<SpaceFixture & { builtin: boolean }> = [
    ...BUILTIN_SPACES.map((s) => ({ ...s, builtin: true })),
    ...projectSpaces.map((s) => ({ ...s, builtin: false })),
  ];
  const copy = async (space: SpaceFixture) => {
    const api = spatialApi();
    if (!api) { setStatus({ type: 'error', key: 'spatial.status.noBridge' }); return; }
    const id = uniqueId(`${space.id}-copy`, all.map((s) => s.id));
    const r = await api.saveSpace({ ...structuredClone(space), id, name: { en: `${space.name.en} (copy)`, ja: `${space.name.ja} (コピー)` } });
    if (!r.success) { setStatus({ type: 'error', key: 'spatial.status.saveFailed', params: { error: r.error ?? '' } }); return; }
    await loadSpaces();
    update((p) => { p.spaces.use = [...p.spaces.use, id]; });
    setStatus({ type: 'info', key: 'spatial.spaces.copied', params: { file: `spaces/${id}.json` } });
  };
  return (
    <div>
      <div className="text-[11px] text-arsist-muted mb-3">{t('spatial.spaces.about')}</div>
      <div className="space-y-1">
        {all.map((s) => {
          const used = project.spaces.use.includes(s.id);
          return (
            <div key={s.id} className={`rounded-md px-2 py-1.5 ${used ? 'bg-arsist-active' : 'bg-arsist-bg/50'}`}>
              <div className="flex items-center gap-1.5">
                <input type="checkbox" className="accent-[rgb(var(--arsist-accent))]" checked={used}
                  onChange={(e) => update((p) => { p.spaces.use = e.target.checked ? [...p.spaces.use, s.id] : p.spaces.use.filter((x) => x !== s.id); })} />
                <button className="flex-1 text-left text-xs text-arsist-text truncate" onClick={() => used && setActiveSpace(s.id)}>{s.name[lang]}</button>
                <span className="text-[10px] text-arsist-muted">{s.builtin ? t('spatial.spaces.builtin') : `spaces/${s.id}.json`}</span>
                <button className="btn-icon !p-1" title={t('spatial.spaces.copy')} onClick={() => void copy(s)}><Copy size={12} /></button>
              </div>
              {s.description && <div className="text-[10px] text-arsist-muted pl-5">{s.description[lang]}</div>}
              <div className="text-[10px] text-arsist-muted pl-5">
                {t('spatial.spaces.counts', { n: s.entities.length })} · {s.knows.length ? s.knows.join(', ') : t('spatial.spaces.knowsNothing')}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-[11px] text-arsist-muted flex gap-1.5"><Plus size={12} className="shrink-0 mt-0.5" />{t('spatial.spaces.addHint')}</div>
      {project.spaces.use.length === 0 && (
        <div className="mt-2 text-[11px] text-arsist-warning flex gap-1.5"><AlertTriangle size={12} />{t('spatial.spaces.none')}</div>
      )}
    </div>
  );
}
