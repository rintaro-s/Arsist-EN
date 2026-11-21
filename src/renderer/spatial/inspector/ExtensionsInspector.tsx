/**
 * Layster.Spatial の拡張機能: プロジェクトで有効にする・設定を書く (ExtensionsInspector) と、物ごとの指定 (ThingExtensions)。
 *
 * 形は Virtual と同じ (project.extensions.<id> = { enabled, dataVersion, settings }、物の ext.<id>)。
 * 入力欄は extension.json の定義から作る (Virtual の ExtensionFieldInput をそのまま使う。拡張機能ごとに画面を書かない)。
 * Virtual の拡張機能タブは Virtual のプロジェクトの画面なので、ここでは右のインスペクタに収まる形にしている。
 */
import { AlertTriangle, FolderOpen, Package, Puzzle } from 'lucide-react';
import { useState } from 'react';
import type { ExtensionManifest } from '../../../shared/extensions';
import { defaultObjectData, newExtensionState } from '../../../shared/extensions';
import { matchTagQuery } from '../../../shared/tags';
import type { SpatialProject, Thing } from '../../../shared/layster/spatial/types';
import { useI18n, useT } from '../../i18n';
import { localized, useExtensions } from '../../extensions/useExtensions';
import { ExtensionFieldInput } from '../../components/panels/ExtensionsSection';
import { useSpatialStore } from '../store';
import { Section } from './fields';

/** 端末のタグで入るか (sdk:* はビルドの時、feature:* は Spatial ではビルドが決めるので、ここでは判断しない)。 */
function fitReason(manifest: ExtensionManifest, deviceTags: string[]): string | null {
  const r = matchTagQuery(manifest.requires, deviceTags, { deferred: ['sdk', 'feature'] });
  if (r.ok) return null;
  return [...r.missing, ...(r.missingAny.length ? [r.missingAny.join(' | ')] : []), ...r.blocked.map((b) => `!${b}`)].join(', ');
}

export function ExtensionsInspector({ project }: { project: SpatialProject }) {
  const t = useT();
  const { lang } = useI18n();
  const update = useSpatialStore((s) => s.update);
  const { data, reload } = useExtensions(project.targetDevice);
  const [message, setMessage] = useState<string | null>(null);
  const all = data?.extensions ?? [];
  const states = project.extensions ?? {};
  const installed = new Set(all.map((e) => e.manifest.id));
  const missing = Object.entries(states).filter(([id, st]) => st?.enabled && data?.success && !installed.has(id)).map(([id]) => id);

  const setEnabled = (manifest: ExtensionManifest, on: boolean) => update((p) => {
    const ext = p.extensions ?? (p.extensions = {});
    if (ext[manifest.id]) ext[manifest.id].enabled = on;
    else if (on) ext[manifest.id] = newExtensionState(manifest);
  });
  const setSetting = (id: string, key: string, value: unknown) => update((p) => {
    const st = p.extensions?.[id];
    if (st) st.settings = { ...st.settings, [key]: value };
  }, `ext:${id}:${key}`);

  const importExtension = async (kind: 'package' | 'folder') => {
    const api = window.electronAPI?.extensions;
    if (!api) return;
    let result = await api.import(kind);
    if (!result.ok && result.needsConfirm && result.source) result = await api.install(result.source, true);
    if (result.canceled) return;
    setMessage(result.ok
      ? t('ext.installed', { id: result.id ?? '', version: result.version ?? '' })
      : t('ext.installFailed', { error: [result.error, ...(result.problems ?? [])].filter(Boolean).join(' / ') }));
    reload();
  };

  return (
    <div>
      <div className="text-[11px] text-arsist-muted mb-3 leading-snug">{t('spatial.ext.about')}</div>
      {missing.map((id) => (
        <p key={id} className="mb-2 text-[11px] text-arsist-warning flex gap-1.5"><AlertTriangle size={12} className="shrink-0 mt-0.5" />{t('ext.notInstalled', { id })}</p>
      ))}
      {!data && <div className="text-xs text-arsist-muted">{t('spatial.ext.loading')}</div>}
      {data && all.length === 0 && <div className="text-xs text-arsist-muted mb-2">{t('spatial.ext.none')}</div>}
      <div className="space-y-1.5">
        {all.map(({ manifest }) => {
          const st = states[manifest.id];
          const on = st?.enabled === true;
          const reason = fitReason(manifest, data?.deviceTags ?? []);
          const fields = manifest.data?.settings ?? [];
          return (
            <div key={manifest.id} className={`rounded-md px-2 py-1.5 ${on ? 'bg-arsist-active' : 'bg-arsist-bg/50'}`}>
              <label className="flex items-start gap-1.5 cursor-pointer">
                <input type="checkbox" className="mt-0.5 accent-[rgb(var(--arsist-accent))]" checked={on} onChange={(e) => setEnabled(manifest, e.target.checked)} />
                <span className="flex-1 min-w-0">
                  <span className="block text-xs text-arsist-text">
                    {localized(manifest.name, lang)}
                    <span className="ml-1.5 text-[10px] text-arsist-muted font-mono">{manifest.id} {t('spatial.ext.version', { version: manifest.version })}</span>
                  </span>
                  <span className="block text-[10px] text-arsist-muted leading-snug">{localized(manifest.description, lang)}</span>
                </span>
              </label>
              {on && reason && (
                <p className="mt-1 pl-5 text-[10px] text-arsist-warning flex gap-1"><AlertTriangle size={11} className="shrink-0 mt-0.5" />{t('spatial.ext.leftOut', { device: project.targetDevice, reason })}</p>
              )}
              {on && fields.length > 0 && (
                <div className="mt-2 pl-5 space-y-2">
                  {fields.map((field) => (
                    <ExtensionFieldInput key={field.key} field={field} value={st?.settings?.[field.key] ?? field.default}
                      onChange={(value) => setSetting(manifest.id, field.key, value)} />
                  ))}
                </div>
              )}
              {on && (manifest.data?.object?.length ?? 0) > 0 && (
                <p className="mt-1 pl-5 text-[10px] text-arsist-muted">{t('spatial.ext.perThing')}</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button className="btn btn-secondary text-xs py-1" onClick={() => { void importExtension('package'); }}><Package size={12} />{t('ext.importPackage')}</button>
        <button className="btn btn-secondary text-xs py-1" onClick={() => { void importExtension('folder'); }}><FolderOpen size={12} />{t('ext.importFolder')}</button>
      </div>
      {message && <p className="mt-2 text-[11px] text-arsist-muted">{message}</p>}
    </div>
  );
}

/** 物のインスペクタの「拡張機能」。有効で、物ごとの指定 (data.object) を持つ拡張機能だけ。 */
export function ThingExtensions({ project, thing }: { project: SpatialProject; thing: Thing }) {
  const t = useT();
  const { lang } = useI18n();
  const update = useSpatialStore((s) => s.update);
  const { data } = useExtensions(project.targetDevice);
  const usable = (data?.extensions ?? []).map((e) => e.manifest)
    .filter((m) => project.extensions?.[m.id]?.enabled && (m.data?.object?.length ?? 0) > 0);
  if (usable.length === 0) return null;

  const setExt = (id: string, value: Record<string, unknown> | null) => update((p) => {
    const x = p.things.find((y) => y.id === thing.id);
    if (!x) return;
    const ext = { ...(x.ext ?? {}) };
    if (value === null) delete ext[id];
    else ext[id] = value;
    if (Object.keys(ext).length > 0) x.ext = ext;
    else delete x.ext;
  }, `ext:${thing.id}:${id}`);

  return (
    <Section title={t('ext.objectTitle')} defaultOpen={!!thing.ext}>
      {usable.map((manifest) => {
        const value = thing.ext?.[manifest.id];
        const current = { ...defaultObjectData(manifest), ...(value ?? {}) };
        return (
          <div key={manifest.id} className="rounded-md bg-arsist-bg/50 p-2 space-y-2">
            <div className="flex items-center gap-1.5">
              <Puzzle size={12} className="text-arsist-accent" />
              <span className="text-xs text-arsist-text flex-1">{localized(manifest.name, lang)}</span>
              {value ? (
                <button className="text-[10px] text-arsist-muted hover:text-arsist-text" onClick={() => setExt(manifest.id, null)}>{t('ext.objectClear')}</button>
              ) : (
                <span className="text-[10px] text-arsist-muted">{t('ext.objectOff')}</span>
              )}
            </div>
            {manifest.data!.object!.map((field) => (
              // 1 つ変えたら、残りの既定値も一緒に書く (実機では書いてある値だけが読まれる。Virtual と同じ)
              <ExtensionFieldInput key={field.key} field={field} value={current[field.key]}
                onChange={(v) => setExt(manifest.id, { ...current, [field.key]: v })} />
            ))}
          </div>
        );
      })}
    </Section>
  );
}
