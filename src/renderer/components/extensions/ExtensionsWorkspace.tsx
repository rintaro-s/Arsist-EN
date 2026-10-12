/**
 * 拡張機能タブ: 入っている拡張機能の一覧・このプロジェクトで使うかの切り替え・説明・設定・どこで動くか・README。
 *
 * 以前は右パネル (何も選んでいない状態) の一角に全部を詰めていたが、拡張機能が増えると説明も設定も読めない。
 * 左に一覧 (オン/オフはここで切り替えられる)、右に選んだものの詳しいこと。物ごとの指定は、物を選んだときの
 * インスペクタに残す (物と一緒に見たいもの)。画面は extension.json から作る (拡張機能ごとに画面を書かない)。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, Check, Clock, Download, FileCode2, FolderInput, FolderOpen, Glasses, Link2, Package, Puzzle,
  RefreshCw, Replace, Search, Smartphone, Trash2, Unlink, Wrench,
} from 'lucide-react';
import type { ExtensionManifest } from '../../../shared/extensions';
import { enginePart, enginePartLabel, SCRIPT_PART_PREFIX } from '../../../shared/engineParts';
import type { TagQuery } from '../../../shared/tags';
import { useI18n, useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { extensionFit, localized, useExtensions, type ExtensionListItem, type InstallReply } from '../../extensions/useExtensions';
import { ExtensionFieldInput } from '../panels/ExtensionsSection';
import { MiniMarkdown } from '../common/MiniMarkdown';

type Filter = 'all' | 'enabled' | 'fits';

// タブを行き来しても、選んでいたものを覚えておく
let rememberedId: string | null = null;

export function ExtensionsWorkspace() {
  const t = useT();
  const { lang } = useI18n();
  const { project, setExtensionEnabled } = useProjectStore();
  const target = project?.targetDevice;
  const { data, reload } = useExtensions(target);
  const [selectedId, setSelectedId] = useState<string | null>(rememberedId);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [message, setMessage] = useState<{ text: string; warn?: boolean } | null>(null);
  const [confirm, setConfirm] = useState<InstallReply | null>(null);
  const api = window.electronAPI?.extensions;

  const states = project?.extensions ?? {};
  const all = data?.extensions ?? [];
  const fitOf = (m: ExtensionManifest) => extensionFit(m, data?.deviceTags ?? [], project);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter(({ manifest: m }) => {
        if (filter === 'enabled' && !states[m.id]?.enabled) return false;
        if (filter === 'fits' && !fitOf(m).ok) return false;
        if (!q) return true;
        return [m.id, localized(m.name, lang), localized(m.description, lang), ...(m.tags ?? [])].some((s) => s.toLowerCase().includes(q));
      })
      // 並びは名前で固定 (スイッチを切り替えた行が動くと、どこへ行ったか分からなくなる。使用中だけ見るなら絞り込み)
      .sort((a, b) => localized(a.manifest.name, lang).localeCompare(localized(b.manifest.name, lang), lang));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, filter, states, lang, data?.deviceTags]);

  useEffect(() => {
    if (!data?.success) return;
    if (!selectedId || !all.some((e) => e.manifest.id === selectedId)) setSelectedId(visible[0]?.manifest.id ?? null);
  }, [data, all, visible, selectedId]);
  useEffect(() => { rememberedId = selectedId; }, [selectedId]);

  if (!project) return null;
  const selected = all.find((e) => e.manifest.id === selectedId) ?? null;
  const installedIds = new Set(all.map((e) => e.manifest.id));
  const orphaned = Object.entries(states).filter(([id, st]) => st.enabled && data?.success && !installedIds.has(id));
  const enabledCount = all.filter((e) => states[e.manifest.id]?.enabled).length;

  const report = (result: InstallReply) => {
    if (result.canceled) return;
    if (!result.ok && result.needsConfirm) { setConfirm(result); return; }
    if (!result.ok) {
      setMessage({ text: t('ext.installFailed', { error: [result.error, ...(result.problems ?? [])].filter(Boolean).join(' / ') }), warn: true });
      return;
    }
    setMessage({ text: t('ext.installed', { id: result.id ?? '', version: result.version ?? '' }) + (result.replaced ? t('ext.replaced', { previous: result.replaced }) : '') });
    if (result.id) setSelectedId(result.id);
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
  const linkFolder = async () => {
    const result = await api?.linkFolder();
    if (!result || result.canceled) return;
    setMessage(result.ok
      ? { text: t('ext.linked', { dir: result.dir ?? '', ids: (result.ids ?? []).join(', ') }) }
      : { text: t('ext.installFailed', { error: result.error ?? '' }), warn: true });
    if (result.ok && result.ids?.[0]) setSelectedId(result.ids[0]);
    reload();
  };

  return (
    <div className="w-full h-full flex flex-col bg-arsist-bg">
      {/* 上: 説明と、入れる・探す */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-3 hairline-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Puzzle size={18} className="text-arsist-accent shrink-0" />
          <span className="text-sm font-semibold">{t('ext.title')}</span>
          <span className="text-xs text-arsist-muted whitespace-nowrap">{t('extTab.enabledCount', { enabled: enabledCount, total: all.length })}</span>
        </div>
        <div className="flex items-center gap-1 bg-arsist-surface rounded-md px-2 py-1 flex-1 min-w-[180px] max-w-sm">
          <Search size={13} className="text-arsist-muted shrink-0" />
          <input
            className="bg-transparent text-xs flex-1 outline-none"
            placeholder={t('extTab.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center bg-arsist-surface rounded-md p-0.5 gap-0.5">
          {(['all', 'enabled', 'fits'] as Filter[]).map((f) => (
            <button
              key={f}
              className={`text-xs px-2 py-1 rounded ${filter === f ? 'bg-arsist-active text-arsist-accent' : 'text-arsist-muted hover:text-arsist-text'}`}
              onClick={() => setFilter(f)}
              disabled={f === 'fits' && !target}
            >
              {t(`extTab.filter.${f}`, { device: target ?? '' })}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <button className="btn btn-secondary text-xs py-1" onClick={() => { void importFrom('package'); }}><Package size={13} />{t('ext.importPackage')}</button>
          <button className="btn btn-ghost text-xs py-1" onClick={() => { void importFrom('folder'); }}><FolderInput size={13} />{t('ext.importFolder')}</button>
          <button className="btn btn-ghost text-xs py-1" title={t('ext.linkFolder')} onClick={() => { void linkFolder(); }}><Link2 size={13} />{t('extTab.link')}</button>
          <button className="btn btn-ghost p-1.5" title={t('ext.reload')} onClick={reload}><RefreshCw size={13} /></button>
          <button className="btn btn-ghost p-1.5" title={t('ext.openFolder')} onClick={() => { void api?.openUserDir(); }}><FolderOpen size={13} /></button>
        </div>
      </div>

      {(message || confirm?.needsConfirm) && (
        <div className="px-4 py-2 hairline-b shrink-0 space-y-2">
          {message && <p className={`text-xs break-all ${message.warn ? 'text-arsist-warning' : 'text-arsist-success'}`}>{message.text}</p>}
          {confirm?.needsConfirm && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs">
                {t('ext.confirmReplace', { id: confirm.needsConfirm.id, installed: confirm.needsConfirm.installed, incoming: confirm.needsConfirm.incoming })}
                {confirm.needsConfirm.downgrade && <span className="text-arsist-warning"> {t('ext.confirmDowngrade')}</span>}
              </p>
              <button className="btn btn-secondary text-xs py-1" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
              <button className="btn btn-primary text-xs py-1" onClick={() => { void replaceConfirmed(); }}>{t('ext.replace')}</button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* 左: 一覧 */}
        <div className="w-80 shrink-0 overflow-y-auto bg-arsist-surface/40 p-2 space-y-1">
          <p className="text-[11px] text-arsist-muted leading-snug px-1 pb-1">{t('extTab.intro')}</p>
          {data && !data.success && <p className="text-xs text-arsist-warning px-1">{t('ext.unavailable', { error: data.error ?? '' })}</p>}
          {data?.success && all.length === 0 && <p className="text-xs text-arsist-muted px-1">{t('ext.none')}</p>}
          {data?.success && all.length > 0 && visible.length === 0 && <p className="text-xs text-arsist-muted px-1">{t('extTab.noMatch')}</p>}
          {visible.map((item) => (
            <ListRow
              key={item.manifest.id}
              item={item}
              selected={item.manifest.id === selectedId}
              enabled={Boolean(states[item.manifest.id]?.enabled)}
              fit={target ? fitOf(item.manifest) : null}
              onSelect={() => setSelectedId(item.manifest.id)}
              onToggle={(on) => setExtensionEnabled(item.manifest, on)}
            />
          ))}

          {orphaned.map(([id]) => (
            <div key={id} className="rounded-md bg-arsist-warning/10 px-2.5 py-2 text-[11px] text-arsist-warning leading-snug flex gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />{t('ext.notInstalled', { id })}
            </div>
          ))}
          {(data?.problems.length ?? 0) > 0 && (
            <div className="rounded-md bg-arsist-warning/10 px-2.5 py-2 text-[11px] text-arsist-warning space-y-1">
              <p>{t('ext.broken')}</p>
              {data!.problems.map((p) => <p key={p} className="font-mono break-all opacity-80">{p}</p>)}
            </div>
          )}
          <p className="text-[10px] text-arsist-muted font-mono px-1 pt-2">{t('ext.howToMake')}</p>
        </div>

        {/* 右: 選んだものの詳しいこと */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {selected ? (
            <ExtensionDetail
              key={selected.manifest.id}
              item={selected}
              enabled={Boolean(states[selected.manifest.id]?.enabled)}
              settings={states[selected.manifest.id]?.settings}
              onToggle={(on) => setExtensionEnabled(selected.manifest, on)}
              onMessage={setMessage}
              onChanged={reload}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-arsist-muted">{t('extTab.nothingSelected')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** オン/オフ (このプロジェクトで使うか) */
function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      title={label}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      className={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors ${on ? 'bg-arsist-accent' : 'bg-arsist-hover'}`}
    >
      <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all ${on ? 'left-[16px]' : 'left-[2px]'}`} />
    </button>
  );
}

function SourceBadge({ item }: { item: ExtensionListItem }) {
  const t = useT();
  // エンジンに同梱 (Extensions/) = 公式
  if (item.source === 'repo' || item.source === 'bundled') {
    return (
      <span className="text-[10px] text-arsist-success whitespace-nowrap" title={t('ext.sourceOfficialHint')}>
        {t('ext.sourceOfficial')}
      </span>
    );
  }
  if (item.source !== 'user' && item.source !== 'linked') return null;
  return (
    <span className="text-[10px] text-arsist-accent whitespace-nowrap" title={item.root ?? item.dir}>
      {t(item.source === 'linked' ? 'ext.sourceLinked' : 'ext.sourceUser')}{item.overrides ? ` · ${t('ext.overrides')}` : ''}
    </span>
  );
}

function ListRow({ item, selected, enabled, fit, onSelect, onToggle }: {
  item: ExtensionListItem;
  selected: boolean;
  enabled: boolean;
  fit: ReturnType<typeof extensionFit> | null;
  onSelect: () => void;
  onToggle: (on: boolean) => void;
}) {
  const t = useT();
  const { lang } = useI18n();
  const m = item.manifest;
  return (
    <div
      onClick={onSelect}
      className={`rounded-md px-2.5 py-2 cursor-pointer transition-colors ${selected ? 'bg-arsist-active' : 'hover:bg-arsist-hover'}`}
    >
      <div className="flex items-center gap-2">
        <Switch on={enabled} onChange={onToggle} label={t('ext.enable')} />
        <span className={`text-xs font-medium truncate flex-1 ${selected ? 'text-arsist-accent' : 'text-arsist-text'}`}>{localized(m.name, lang)}</span>
        {fit && (fit.ok
          ? (fit.deferred.length > 0 ? <Clock size={12} className="text-arsist-muted shrink-0" /> : <Check size={12} className="text-arsist-success shrink-0" />)
          : <AlertTriangle size={12} className="text-arsist-warning shrink-0" />)}
      </div>
      <div className="flex items-center gap-1.5 mt-0.5 pl-10">
        <span className="text-[10px] text-arsist-muted">{m.version}</span>
        <SourceBadge item={item} />
        {(m.replaces?.length ?? 0) > 0 && (
          <span className="text-[10px] text-arsist-warning whitespace-nowrap flex items-center gap-0.5" title={m.replaces!.map((p) => enginePartLabel(p, lang)).join(', ')}>
            <Replace size={10} />{t('extTab.replacesBadge')}
          </span>
        )}
      </div>
      <p className="text-[11px] text-arsist-muted leading-snug mt-1 pl-10 line-clamp-2">{localized(m.description, lang)}</p>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-arsist-surface p-4 space-y-2.5">
      <h3 className="text-xs font-semibold text-arsist-text flex items-center gap-1.5">{icon}{title}</h3>
      {children}
    </section>
  );
}

function TagList({ label, tags }: { label: string; tags?: string[] }) {
  if (!tags?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-arsist-muted mr-1">{label}</span>
      {tags.map((tag) => <code key={tag} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-arsist-bg/70">{tag}</code>)}
    </div>
  );
}

function ExtensionDetail({ item, enabled, settings, onToggle, onMessage, onChanged }: {
  item: ExtensionListItem;
  enabled: boolean;
  settings?: Record<string, unknown>;
  onToggle: (on: boolean) => void;
  onMessage: (m: { text: string; warn?: boolean } | null) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const { lang } = useI18n();
  const { project, updateExtensionSettings, selectObjects, setCurrentScene } = useProjectStore();
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const { data } = useExtensions(project?.targetDevice);
  const [readme, setReadme] = useState<string | null | undefined>(undefined);
  const m = item.manifest;
  const api = window.electronAPI?.extensions;
  const target = project?.targetDevice;
  const fit = extensionFit(m, data?.deviceTags ?? [], project);
  const missing = [...fit.missing, ...fit.missingAny, ...fit.blocked];

  useEffect(() => {
    let alive = true;
    setReadme(undefined);
    void api?.readme(m.id).then((r) => { if (alive) setReadme(r.ok ? r.text ?? null : null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id, m.version]);

  // この拡張機能の「物ごとの指定」をしている物
  const usingObjects = (project?.scenes ?? []).flatMap((scene) =>
    (scene.objects ?? []).filter((o) => o.ext?.[m.id]).map((o) => ({ sceneId: scene.id, sceneName: scene.name, id: o.id, name: o.name })));

  const exportOne = async () => {
    const r = await api?.export(m.id);
    if (!r || r.canceled) return;
    onMessage(r.ok ? { text: t('ext.exported', { file: r.file ?? '' }) } : { text: r.error ?? '', warn: true });
  };
  const removeOne = async () => {
    const r = await api?.uninstall(m.id);
    if (!r) return;
    onMessage(r.ok ? { text: t('ext.uninstalled', { id: m.id }) } : { text: r.error ?? '', warn: true });
    onChanged();
  };
  const unlink = async () => {
    if (!item.root) return;
    const r = await api?.unlinkFolder(item.root);
    if (!r) return;
    onMessage(r.ok ? { text: t('ext.unlinked', { dir: item.root }) } : { text: r.error ?? '', warn: true });
    onChanged();
  };
  const requires: TagQuery = m.requires ?? {};
  // 同じ部品を置き換える、このプロジェクトで有効な別の拡張機能 (両方有効だとビルドが止まる)
  const rivals = (m.replaces ?? []).map((part) => ({
    part,
    ids: (data?.extensions ?? [])
      .filter((e) => e.manifest.id !== m.id && project?.extensions?.[e.manifest.id]?.enabled && (e.manifest.replaces ?? []).includes(part))
      .map((e) => localized(e.manifest.name, lang)),
  })).filter((r) => r.ids.length > 0);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      {/* 見出し */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-arsist-text">{localized(m.name, lang)}</h2>
          <span className="text-xs text-arsist-muted">{m.version}</span>
          <SourceBadge item={item} />
          <label className="ml-auto flex items-center gap-2 text-xs cursor-pointer">
            <Switch on={enabled} onChange={onToggle} label={t('ext.enable')} />
            <span className={enabled ? 'text-arsist-accent' : 'text-arsist-muted'}>{t('ext.enable')}</span>
          </label>
        </div>
        <p className="text-sm text-arsist-text/90 leading-relaxed">{localized(m.description, lang)}</p>
        <div className="flex flex-wrap gap-1">
          <button className="btn btn-ghost text-xs py-1" onClick={() => { void exportOne(); }}><Download size={13} />{t('ext.export')}</button>
          <button className="btn btn-ghost text-xs py-1" onClick={() => { void api?.openDir(m.id); }}><FolderOpen size={13} />{t('extTab.openDir')}</button>
          {item.source === 'user' && (
            <button className="btn btn-ghost text-xs py-1 text-arsist-error" onClick={() => { void removeOne(); }}><Trash2 size={13} />{t('ext.uninstall')}</button>
          )}
          {item.source === 'linked' && item.root && (
            <button className="btn btn-ghost text-xs py-1" title={t('ext.unlinkHint', { dir: item.root })} onClick={() => { void unlink(); }}><Unlink size={13} />{t('ext.unlink')}</button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* どこで動くか */}
        <Section icon={<Smartphone size={13} />} title={t('extTab.where')}>
          {!target ? (
            <p className="text-xs text-arsist-muted">{t('extTab.noTarget')}</p>
          ) : fit.ok ? (
            <p className="text-xs text-arsist-success flex items-center gap-1.5"><Check size={13} />{t('ext.fits', { device: target })}</p>
          ) : (
            <p className="text-xs text-arsist-warning flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{t('ext.notOnDevice', { device: target, tags: missing.join(', ') })}</p>
          )}
          {target && fit.ok && fit.deferred.length > 0 && (
            <p className="text-xs text-arsist-muted flex items-center gap-1.5"><Clock size={13} />{t('ext.checkedAtBuild', { tags: fit.deferred.join(', ') })}</p>
          )}
          {!requires.all?.length && !requires.any?.length && !requires.none?.length
            ? <p className="text-xs text-arsist-muted">{t('extTab.requiresNothing')}</p>
            : (
              <div className="space-y-1">
                <TagList label={t('extTab.requiresAll')} tags={requires.all} />
                <TagList label={t('extTab.requiresAny')} tags={requires.any} />
                <TagList label={t('extTab.requiresNone')} tags={requires.none} />
              </div>
            )}
          <p className="text-[11px] text-arsist-muted leading-snug">{t('extTab.whereHint')}</p>
        </Section>

        {/* 足すもの */}
        <Section icon={<Wrench size={13} />} title={t('extTab.adds')}>
          <ul className="text-xs space-y-1.5">
            {(m.script?.globals?.length ?? 0) > 0 && <li><FileCode2 size={12} className="inline mr-1.5 text-arsist-muted" />{t('ext.scriptGlobals', { names: m.script!.globals!.join(', ') })}</li>}
            {(m.provides?.adapters?.length ?? 0) > 0 && <li><Glasses size={12} className="inline mr-1.5 text-arsist-muted" />{t('ext.providesDevices', { names: m.provides!.adapters!.join(', ') })}</li>}
            {Object.keys(m.unity?.packages ?? {}).length > 0 && <li className="break-all">{t('ext.sdkPackages', { names: Object.entries(m.unity!.packages!).map(([k, v]) => `${k} (${v})`).join(', ') })}</li>}
            {(m.unity?.unitypackages?.length ?? 0) > 0 && <li className="break-all"><Package size={12} className="inline mr-1.5 text-arsist-muted" />{t('extTab.unitypackages', { names: m.unity!.unitypackages!.map((p) => p.split('/').pop()).join(', ') })}</li>}
            {(m.unity?.overrides?.length ?? 0) > 0 && (
              <li className="text-arsist-warning">
                {t('ext.overridesEngine', { count: m.unity!.overrides!.length })}
                <span className="block font-mono text-[10px] opacity-80 break-all">{m.unity!.overrides!.map((o) => o.path).join(', ')}</span>
              </li>
            )}
            {(m.android?.permissions?.length ?? 0) > 0 && <li className="break-all">{t('extTab.androidPermissions', { names: m.android!.permissions!.join(', ') })}</li>}
            {(m.android?.features?.length ?? 0) > 0 && <li className="break-all">{t('extTab.androidFeatures', { names: m.android!.features!.map((f) => f.name).join(', ') })}</li>}
            {!m.script?.globals?.length && !m.provides?.adapters?.length && !Object.keys(m.unity?.packages ?? {}).length
              && !m.unity?.unitypackages?.length && !m.unity?.overrides?.length && !m.android?.permissions?.length && !m.android?.features?.length
              && <li className="text-arsist-muted">{t('extTab.addsNothing')}</li>}
          </ul>
        </Section>
      </div>

      {/* エンジンの部品の置き換え */}
      {(m.replaces?.length ?? 0) > 0 && (
        <Section icon={<Replace size={13} />} title={t('extTab.replaces')}>
          <ul className="text-xs space-y-2">
            {m.replaces!.map((part) => {
              const info = enginePart(part);
              return (
                <li key={part}>
                  <span className="font-medium text-arsist-text">{enginePartLabel(part, lang)}</span>
                  <code className="ml-2 text-[10px] font-mono text-arsist-muted">{part}</code>
                  <span className="block text-arsist-muted leading-snug mt-0.5">
                    {info ? localized(info.description, lang) : part.startsWith(SCRIPT_PART_PREFIX) ? t('extTab.replacesScript', { name: part.slice(SCRIPT_PART_PREFIX.length) }) : ''}
                  </span>
                  {info?.dropsFromBuild && <span className="block text-arsist-muted leading-snug">{t('extTab.replacesDrops', { what: localized(info.dropsFromBuild, lang) })}</span>}
                </li>
              );
            })}
          </ul>
          {rivals.map((r) => (
            <p key={r.part} className="text-xs text-arsist-warning flex items-start gap-1.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />{t('extTab.replacesConflict', { part: enginePartLabel(r.part, lang), names: r.ids.join(', ') })}
            </p>
          ))}
          <p className="text-[11px] text-arsist-muted leading-snug">{t(enabled ? 'extTab.replacesOn' : 'extTab.replacesOff')}</p>
        </Section>
      )}

      {/* 設定 */}
      <Section icon={<Wrench size={13} />} title={t('extTab.settings')}>
        {(m.data?.settings?.length ?? 0) === 0 ? (
          <p className="text-xs text-arsist-muted">{t('extTab.noSettings')}</p>
        ) : (
          <>
            {!enabled && <p className="text-xs text-arsist-muted">{t('extTab.settingsDisabled')}</p>}
            <div className={`grid gap-3 md:grid-cols-2 ${enabled ? '' : 'opacity-50 pointer-events-none'}`} aria-disabled={!enabled}>
              {m.data!.settings!.map((field) => (
                <ExtensionFieldInput
                  key={field.key}
                  field={field}
                  value={settings?.[field.key] ?? field.default}
                  onChange={(value) => updateExtensionSettings(m.id, { [field.key]: value })}
                />
              ))}
            </div>
          </>
        )}
      </Section>

      {/* 物ごとの指定 */}
      {(m.data?.object?.length ?? 0) > 0 && (
        <Section icon={<Puzzle size={13} />} title={t('extTab.objectOptions')}>
          <p className="text-xs text-arsist-muted">{t('extTab.objectOptionsHint')}</p>
          <ul className="text-xs space-y-1">
            {m.data!.object!.map((f) => (
              <li key={f.key}>
                <span className="text-arsist-text">{localized(f.label, lang)}</span>
                {f.help && <span className="text-arsist-muted"> — {localized(f.help, lang)}</span>}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-arsist-muted pt-1">{usingObjects.length > 0 ? t('extTab.objectsUsing', { count: usingObjects.length }) : t('extTab.objectsNone')}</p>
          {usingObjects.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {usingObjects.map((o) => (
                <button
                  key={o.id}
                  className="btn btn-ghost text-xs py-0.5"
                  title={t('extTab.goToObject')}
                  onClick={() => { setCurrentScene(o.sceneId); selectObjects([o.id]); setCurrentView('scene'); }}
                >
                  {o.name}{(project?.scenes.length ?? 0) > 1 ? ` (${o.sceneName})` : ''}
                </button>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* 情報 */}
      <Section icon={<Package size={13} />} title={t('extTab.info')}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-arsist-muted">ID</dt><dd className="font-mono">{m.id}</dd>
          <dt className="text-arsist-muted">{t('extTab.version')}</dt><dd>{m.version}</dd>
          {m.data && (<><dt className="text-arsist-muted">{t('extTab.dataVersion')}</dt><dd>{m.data.version}</dd></>)}
          {m.minIrVersion !== undefined && (<><dt className="text-arsist-muted">{t('extTab.minIr')}</dt><dd>IR v{m.minIrVersion}</dd></>)}
          <dt className="text-arsist-muted">{t('extTab.location')}</dt><dd className="font-mono break-all">{item.dir}</dd>
          {item.overrides && (<><dt className="text-arsist-muted">{t('extTab.overridesWhich')}</dt><dd className="font-mono break-all">{item.overrides}</dd></>)}
        </dl>
        <TagList label={t('extTab.tags')} tags={m.tags} />
      </Section>

      {/* README */}
      <Section icon={<BookOpen size={13} />} title={t('extTab.readme')}>
        {readme === undefined ? (
          <p className="text-xs text-arsist-muted">{t('extTab.loading')}</p>
        ) : readme === null ? (
          <p className="text-xs text-arsist-muted">{t('extTab.noReadme')}</p>
        ) : (
          <MiniMarkdown source={readme} />
        )}
      </Section>
    </div>
  );
}
