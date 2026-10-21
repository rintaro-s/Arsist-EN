/**
 * 拡張機能の画面のうち、パネルに出る部分。どちらも extension.json の定義から作る (拡張機能ごとに画面を書かない)。
 *
 *   ProjectExtensionsSection  プロジェクトの設定 (何も選んでいないときの右パネル) の要約。使用中の数・注意と、
 *                             拡張機能タブへのボタンだけ。一覧・オン/オフ・説明・設定は拡張機能タブ
 *                             (components/extensions/ExtensionsWorkspace.tsx)。右パネルでは狭くて読めないため
 *   ObjectExtensionsSection   物のインスペクタ。有効な拡張機能の、物ごとの指定 (data.object)
 */
import { AlertTriangle, ArrowRight, Puzzle } from 'lucide-react';
import type { ExtensionField, ExtensionManifest } from '../../../shared/extensions';
import { defaultObjectData } from '../../../shared/extensions';
import type { SceneObject } from '../../../shared/types';
import { useI18n, useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { extensionFit, localized, useExtensions } from '../../extensions/useExtensions';

export function ProjectExtensionsSection() {
  const t = useT();
  const { lang } = useI18n();
  const project = useProjectStore((s) => s.project);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const { data } = useExtensions(project?.targetDevice);
  if (!project) return null;

  const states = project.extensions ?? {};
  const all = data?.extensions ?? [];
  const enabled = all.filter((e) => states[e.manifest.id]?.enabled);
  const installedIds = new Set(all.map((e) => e.manifest.id));
  const missing = Object.entries(states).filter(([id, st]) => st.enabled && data?.success && !installedIds.has(id)).map(([id]) => id);
  const leftOut = project.targetDevice
    ? enabled.filter((e) => !extensionFit(e.manifest, data?.deviceTags ?? [], project).ok).map((e) => localized(e.manifest.name, lang))
    : [];

  return (
    <div className="p-3 rounded-lg bg-arsist-hover space-y-2">
      <div className="flex items-center gap-1.5">
        <Puzzle size={14} className="text-arsist-accent" />
        <span className="text-xs font-semibold text-arsist-text flex-1">{t('ext.title')}</span>
      </div>
      <p className="text-[11px] text-arsist-muted">{t('extTab.summary', { enabled: enabled.length, total: all.length })}</p>
      {enabled.length > 0 && (
        <p className="text-[11px] text-arsist-text leading-snug">{t('extTab.summaryNames', { names: enabled.map((e) => localized(e.manifest.name, lang)).join('、') })}</p>
      )}
      {missing.map((id) => (
        <p key={id} className="text-[10px] text-arsist-warning leading-snug flex gap-1"><AlertTriangle size={11} className="shrink-0 mt-0.5" />{t('ext.notInstalled', { id })}</p>
      ))}
      {leftOut.length > 0 && (
        <p className="text-[10px] text-arsist-warning leading-snug flex gap-1">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />{t('extTab.summaryLeftOut', { device: project.targetDevice ?? '', names: leftOut.join('、') })}
        </p>
      )}
      <button className="btn btn-secondary text-xs py-1 w-full justify-center" onClick={() => setCurrentView('extensions')}>
        {t('extTab.openTab')}<ArrowRight size={12} />
      </button>
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
