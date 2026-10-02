/**
 * 拡張機能の画面。どちらも extension.json の定義から自動で作る (拡張機能ごとに画面を書かない)。
 *
 *   ProjectExtensionsSection  プロジェクトの設定 (何も選んでいないときの右パネル)。
 *                             入っている拡張機能・ターゲット端末で動くか・有効/無効・設定 (data.settings)
 *   ObjectExtensionsSection   物のインスペクタ。有効な拡張機能の、物ごとの指定 (data.object)
 */
import { useState } from 'react';
import { FolderOpen, Puzzle, RefreshCw, AlertTriangle, Check, Clock, Package, FolderInput, Download, Trash2, Wrench, Glasses } from 'lucide-react';
import type { ExtensionField, ExtensionManifest } from '../../../shared/extensions';
import { defaultObjectData } from '../../../shared/extensions';
import type { SceneObject } from '../../../shared/types';
import { useI18n, useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { extensionFit, localized, useExtensions, type InstallReply } from '../../extensions/useExtensions';

export function ProjectExtensionsSection() {
  const t = useT();
  const { lang } = useI18n();
  const { project, setExtensionEnabled, updateExtensionSettings } = useProjectStore();
  const target = project?.targetDevice;
  const { data, reload } = useExtensions(target);
  const [message, setMessage] = useState<{ text: string; warn?: boolean } | null>(null);
  const [confirm, setConfirm] = useState<InstallReply | null>(null);
  if (!project) return null;

  const api = window.electronAPI?.extensions;

  const report = (result: InstallReply) => {
    if (result.canceled) return;
    if (!result.ok && result.needsConfirm) { setConfirm(result); return; }
    if (!result.ok) {
      setMessage({ text: t('ext.installFailed', { error: [result.error, ...(result.problems ?? [])].filter(Boolean).join(' / ') }), warn: true });
      return;
    }
    setMessage({ text: t('ext.installed', { id: result.id ?? '', version: result.version ?? '' }) + (result.replaced ? t('ext.replaced', { previous: result.replaced }) : '') });
    reload();
  };

  const importFrom = async (kind: 'package' | 'folder') => {
    if (!api) return;
    setConfirm(null);
    report(await api.import(kind));
  };

  const replaceConfirmed = async () => {
    if (!api || !confirm?.source) return;
    const source = confirm.source;
    setConfirm(null);
    report(await api.install(source, true));
  };

  const exportOne = async (id: string) => {
    const result = await api?.export(id);
    if (!result || result.canceled) return;
    setMessage(result.ok ? { text: t('ext.exported', { file: result.file ?? '' }) } : { text: result.error ?? '', warn: true });
  };

  const removeOne = async (id: string) => {
    const result = await api?.uninstall(id);
    if (!result) return;
    setMessage(result.ok ? { text: t('ext.uninstalled', { id }) } : { text: result.error ?? '', warn: true });
    reload();
  };

  const states = project.extensions ?? {};
  const installedIds = new Set((data?.extensions ?? []).map((e) => e.manifest.id));
  const orphaned = Object.entries(states).filter(([id, st]) => st.enabled && data?.success && !installedIds.has(id));

  return (
    <div className="p-3 rounded-lg bg-arsist-hover space-y-3">
      <div className="flex items-center gap-1.5">
        <Puzzle size={14} className="text-arsist-accent" />
        <span className="text-xs font-semibold text-arsist-text flex-1 whitespace-nowrap">{t('ext.title')}</span>
        <button className="btn btn-ghost p-1" title={t('ext.importPackage')} onClick={() => { void importFrom('package'); }}><Package size={12} /></button>
        <button className="btn btn-ghost p-1" title={t('ext.importFolder')} onClick={() => { void importFrom('folder'); }}><FolderInput size={12} /></button>
        <button className="btn btn-ghost p-1" title={t('ext.reload')} onClick={reload}><RefreshCw size={12} /></button>
        <button
          className="btn btn-ghost p-1"
          title={t('ext.openFolder')}
          onClick={() => { void window.electronAPI?.extensions?.openUserDir(); }}
        >
          <FolderOpen size={12} />
        </button>
      </div>
      <p className="text-[10px] text-arsist-muted leading-snug">{t('ext.intro')}</p>

      {confirm?.needsConfirm && (
        <div className="rounded-md bg-arsist-surface/60 p-2.5 space-y-2">
          <p className="text-[11px] text-arsist-text leading-snug">
            {t('ext.confirmReplace', { id: confirm.needsConfirm.id, installed: confirm.needsConfirm.installed, incoming: confirm.needsConfirm.incoming })}
            {confirm.needsConfirm.downgrade && <span className="block text-arsist-warning">{t('ext.confirmDowngrade')}</span>}
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary text-xs py-1" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
            <button className="btn btn-primary text-xs py-1" onClick={() => { void replaceConfirmed(); }}>{t('ext.replace')}</button>
          </div>
        </div>
      )}
      {message && <p className={`text-[10px] leading-snug break-all ${message.warn ? 'text-arsist-warning' : 'text-arsist-success'}`}>{message.text}</p>}

      {data && !data.success && (
        <p className="text-[10px] text-arsist-warning">{t('ext.unavailable', { error: data.error ?? '' })}</p>
      )}
      {data?.success && data.extensions.length === 0 && (
        <p className="text-[10px] text-arsist-muted">{t('ext.none')}</p>
      )}

      {(data?.extensions ?? []).map(({ manifest, source, overrides }) => {
        const state = states[manifest.id];
        const enabled = state?.enabled === true;
        const fit = extensionFit(manifest, data?.deviceTags ?? [], project);
        const missing = [...fit.missing, ...fit.missingAny, ...fit.blocked];
        return (
          <div key={manifest.id} className="rounded-md bg-arsist-surface/60 p-2.5 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-3.5 h-3.5 mt-0.5 accent-arsist-accent"
                checked={enabled}
                onChange={(e) => setExtensionEnabled(manifest, e.target.checked)}
              />
              <span className="flex-1 min-w-0">
                <span className="text-xs text-arsist-text font-medium">{localized(manifest.name, lang)}</span>
                <span className="text-[10px] text-arsist-muted ml-1.5">{manifest.version}</span>
                {source === 'user' && (
                  <span className="text-[10px] text-arsist-accent ml-1.5">
                    {t('ext.sourceUser')}{overrides ? ` · ${t('ext.overrides')}` : ''}
                  </span>
                )}
              </span>
            </label>
            <p className="text-[10px] text-arsist-muted leading-snug">{localized(manifest.description, lang)}</p>

            {(manifest.provides?.adapters?.length ?? 0) > 0 && (
              <p className="text-[10px] text-arsist-text flex items-start gap-1"><Glasses size={11} className="shrink-0 mt-0.5" />{t('ext.providesDevices', { names: manifest.provides!.adapters!.join(', ') })}</p>
            )}
            {Object.keys(manifest.unity?.packages ?? {}).length > 0 && (
              <p className="text-[10px] text-arsist-muted break-all">{t('ext.sdkPackages', { names: Object.keys(manifest.unity!.packages!).join(', ') })}</p>
            )}
            {(manifest.unity?.overrides?.length ?? 0) > 0 && (
              <p className="text-[10px] text-arsist-warning flex items-start gap-1" title={manifest.unity!.overrides!.map((o) => o.path).join('\n')}>
                <Wrench size={11} className="shrink-0 mt-0.5" />{t('ext.overridesEngine', { count: manifest.unity!.overrides!.length })}
              </p>
            )}

            {target && (
              <div className="space-y-0.5">
                {fit.ok ? (
                  <p className="text-[10px] text-arsist-success flex items-center gap-1"><Check size={11} />{t('ext.fits', { device: target })}</p>
                ) : (
                  <p className="text-[10px] text-arsist-warning flex items-center gap-1">
                    <AlertTriangle size={11} className="shrink-0" />{t('ext.notOnDevice', { device: target, tags: missing.join(', ') })}
                  </p>
                )}
                {fit.ok && fit.deferred.length > 0 && (
                  <p className="text-[10px] text-arsist-muted flex items-center gap-1"><Clock size={11} />{t('ext.checkedAtBuild', { tags: fit.deferred.join(', ') })}</p>
                )}
              </div>
            )}

            <div className="flex gap-1">
              <button className="btn btn-ghost text-[10px] px-1.5 py-0.5" onClick={() => { void exportOne(manifest.id); }}>
                <Download size={11} />{t('ext.export')}
              </button>
              {source === 'user' && (
                <button className="btn btn-ghost text-[10px] px-1.5 py-0.5 text-arsist-error" onClick={() => { void removeOne(manifest.id); }}>
                  <Trash2 size={11} />{t('ext.uninstall')}
                </button>
              )}
            </div>

            {(manifest.script?.globals?.length ?? 0) > 0 && (
              <p className="text-[10px] text-arsist-muted">{t('ext.scriptGlobals', { names: manifest.script!.globals!.join(', ') })}</p>
            )}

            {enabled && (manifest.data?.settings?.length ?? 0) > 0 && (
              <div className="space-y-2 pt-1">
                {manifest.data!.settings!.map((field) => (
                  <ExtensionFieldInput
                    key={field.key}
                    field={field}
                    value={state?.settings?.[field.key] ?? field.default}
                    onChange={(value) => updateExtensionSettings(manifest.id, { [field.key]: value })}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {orphaned.map(([id]) => (
        <p key={id} className="text-[10px] text-arsist-warning leading-snug flex gap-1">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />{t('ext.notInstalled', { id })}
        </p>
      ))}

      {(data?.problems.length ?? 0) > 0 && (
        <div className="text-[10px] text-arsist-warning space-y-0.5">
          <p>{t('ext.broken')}</p>
          {data!.problems.map((p) => <p key={p} className="font-mono break-all opacity-80">{p}</p>)}
        </div>
      )}

      <p className="text-[10px] text-arsist-muted font-mono">{t('ext.howToMake')}</p>
    </div>
  );
}

/** 物のインスペクタ。有効で、物ごとの指定を持つ拡張機能だけを出す。 */
export function ObjectExtensionsSection({ object }: { object: SceneObject }) {
  const t = useT();
  const { lang } = useI18n();
  const { project, updateObjectExtension } = useProjectStore();
  const { data } = useExtensions(project?.targetDevice);
  if (!project) return null;

  const usable = (data?.extensions ?? [])
    .map((e) => e.manifest)
    .filter((m) => project.extensions?.[m.id]?.enabled && (m.data?.object?.length ?? 0) > 0);
  if (usable.length === 0) return null;

  return (
    <div className="space-y-2">
      <label className="input-label">
        <span className="inline-flex items-center gap-1.5"><Puzzle size={12} />{t('ext.objectTitle')}</span>
      </label>
      {usable.map((manifest) => (
        <ObjectExtensionCard
          key={manifest.id}
          manifest={manifest}
          value={object.ext?.[manifest.id]}
          title={localized(manifest.name, lang)}
          onChange={(updates) => updateObjectExtension(object.id, manifest.id, updates)}
          clearLabel={t('ext.objectClear')}
          offLabel={t('ext.objectOff')}
        />
      ))}
    </div>
  );
}

function ObjectExtensionCard({ manifest, value, title, onChange, clearLabel, offLabel }: {
  manifest: ExtensionManifest;
  value: Record<string, unknown> | undefined;
  title: string;
  onChange: (updates: Record<string, unknown> | null) => void;
  clearLabel: string;
  offLabel: string;
}) {
  const defaults = defaultObjectData(manifest);
  const current = { ...defaults, ...(value ?? {}) };
  return (
    <div className="rounded-md bg-arsist-hover p-2.5 space-y-2">
      <div className="flex items-center">
        <span className="text-xs text-arsist-text flex-1">{title}</span>
        {value ? (
          <button className="text-[10px] text-arsist-muted hover:text-arsist-text" onClick={() => onChange(null)}>{clearLabel}</button>
        ) : (
          <span className="text-[10px] text-arsist-muted">{offLabel}</span>
        )}
      </div>
      {manifest.data!.object!.map((field) => (
        <ExtensionFieldInput
          key={field.key}
          field={field}
          value={current[field.key]}
          // 1 つ変えたら、残りの既定値も一緒に書く (実機では書いてある値だけが読まれる)
          onChange={(v) => onChange({ ...current, [field.key]: v })}
        />
      ))}
    </div>
  );
}

/** extension.json の項目定義 1 つ分の入力欄。 */
export function ExtensionFieldInput({ field, value, onChange }: {
  field: ExtensionField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { lang } = useI18n();
  const label = localized(field.label, lang);
  const help = field.help ? localized(field.help, lang) : '';

  if (field.type === 'boolean') {
    return (
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="w-3.5 h-3.5 mt-0.5 accent-arsist-accent"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="min-w-0">
          <span className="text-xs text-arsist-text">{label}</span>
          {help && <span className="block text-[10px] text-arsist-muted leading-snug">{help}</span>}
        </span>
      </label>
    );
  }

  return (
    <div>
      <label className="text-[10px] text-arsist-muted">{label}</label>
      {field.type === 'select' ? (
        <select className="input text-xs py-1 w-full" value={String(value ?? field.default)} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{localized(o.label, lang)}</option>
          ))}
        </select>
      ) : field.type === 'number' ? (
        <input
          type="number"
          className="input text-xs py-1 w-full"
          value={typeof value === 'number' ? value : Number(field.default)}
          min={field.min}
          max={field.max}
          step={field.step ?? 'any'}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
      ) : (
        <input type="text" className="input text-xs py-1 w-full" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      )}
      {help && <p className="text-[10px] text-arsist-muted leading-snug mt-0.5">{help}</p>}
    </div>
  );
}
