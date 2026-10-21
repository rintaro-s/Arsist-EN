/**
 * プロジェクトの書き出し (.arsist) と、.arsist の読み込み (ツールバー・最初の画面から共通で使う)。
 *
 * 読み込みはファイルの中身で分かれる (main の project:import-package):
 *   - プロジェクト → 置き場所を訊いて展開し、そのまま開く。同梱の拡張機能は無ければ入れ、
 *     今のより新しいものは勝手に入れずに、この画面で訊く (PackageResultDialog)
 *   - 拡張機能 → 入れる (同じ版・古い版なら、入れ直すかを訊く)
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { Package, X, Loader2 } from 'lucide-react';
import { useT } from '../i18n';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import type { PackageImportReply } from './types';

type T = ReturnType<typeof useT>;

interface PendingInstall {
  id: string;
  version: string;
  installed?: string;
  /** 入れる元 (展開した一時フォルダ、または .arsist そのもの) */
  source: string;
}

interface PackageResultState {
  /** 書き出し / 読み込みの最中 (main の project:package-busy) */
  busy: { action: 'export' | 'import'; file: string } | null;
  title: string | null;
  lines: Array<{ text: string; warn?: boolean }>;
  pending: PendingInstall[];
  show(title: string, lines: Array<{ text: string; warn?: boolean }>, pending: PendingInstall[]): void;
  resolve(id: string): void;
  close(): void;
}

const usePackageResult = create<PackageResultState>((set) => ({
  busy: null,
  title: null,
  lines: [],
  pending: [],
  show: (title, lines, pending) => set({ title, lines, pending }),
  resolve: (id) => set((s) => ({ pending: s.pending.filter((p) => p.id !== id) })),
  close: () => set({ title: null, lines: [], pending: [] }),
}));

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export async function exportCurrentProject(t: T): Promise<void> {
  const { projectPath, isDirty, saveProject } = useProjectStore.getState();
  const api = window.electronAPI?.projectPackage;
  const notify = useUIStore.getState().addNotification;
  if (!projectPath || !api) return;
  // 書き出すのはファイルなので、画面の未保存の変更を先に
  if (isDirty) await saveProject();
  const r = await api.export(projectPath, true);
  if (r.canceled) return;
  if (!r.ok) {
    const message = t('pkg.exportFailed', { error: r.error ?? '' });
    notify({ type: 'error', message });
    usePackageResult.getState().show(t('pkg.export'), [{ text: message, warn: true }], []);
    return;
  }
  const bundled = (r.extensions ?? []).filter((e) => e.bundled).map((e) => `${e.id} ${e.version}`);
  const message = t('pkg.exported', { files: r.files ?? 0, size: formatSize(r.bytes ?? 0), file: r.file ?? '' })
    + (bundled.length ? t('pkg.withExtensions', { ids: bundled.join(', ') }) : '');
  notify({ type: 'success', message });
  usePackageResult.getState().show(t('pkg.export'), [{ text: message }], []);
}

export async function importArsistPackage(t: T): Promise<void> {
  const api = window.electronAPI?.projectPackage;
  const notify = useUIStore.getState().addNotification;
  if (!api) return;
  const r: PackageImportReply = await api.import();
  if (r.canceled) return;
  const result = usePackageResult.getState();

  if (r.kind === 'extension') {
    if (r.ok) {
      notify({ type: 'success', message: t('pkg.extInstalled', { id: r.id ?? '', version: r.version ?? '' }) });
      result.show(t('pkg.import'), [{ text: t('pkg.extInstalled', { id: r.id ?? '', version: r.version ?? '' }) }], []);
    } else if (r.needsConfirm && r.source) {
      const c = r.needsConfirm;
      result.show(t('pkg.import'), [{ text: t('pkg.extNewer', { id: c.id, version: c.incoming, installed: c.installed }), warn: c.downgrade }],
        [{ id: c.id, version: c.incoming, installed: c.installed, source: r.source }]);
    } else {
      result.show(t('pkg.import'), [{ text: t('pkg.failed', { error: [r.error, ...(r.problems ?? [])].filter(Boolean).join(' / ') }), warn: true }], []);
    }
    return;
  }

  if (!r.ok || !r.projectPath) {
    result.show(t('pkg.import'), [{ text: t('pkg.failed', { error: r.error ?? '' }), warn: true }], []);
    return;
  }

  const lines: Array<{ text: string; warn?: boolean }> = [{ text: t('pkg.imported', { name: r.name ?? '' }) }];
  const pending: PendingInstall[] = [];
  for (const e of r.extensions ?? []) {
    if (e.action === 'installed') lines.push({ text: t('pkg.extInstalled', { id: e.id, version: e.version }) });
    else if (e.action === 'failed') lines.push({ text: t('pkg.extFailed', { id: e.id, message: e.message ?? '' }), warn: true });
    else if (e.action === 'needsConfirm' && e.stagedDir) {
      lines.push({ text: t('pkg.extNewer', { id: e.id, version: e.version, installed: e.installedVersion ?? '?' }), warn: true });
      pending.push({ id: e.id, version: e.version, installed: e.installedVersion, source: e.stagedDir });
    }
  }
  notify({ type: 'success', message: `${lines[0].text} (${r.projectPath})` });
  await useProjectStore.getState().loadProject(r.projectPath);
  // 拡張機能について伝えることがあるときだけ、画面に出す
  if (lines.length > 1) result.show(t('pkg.import'), lines, pending);
}

/** 読み込みの結果 (伝えることがあるときだけ出る) */
export function PackageResultDialog() {
  const t = useT();
  const { busy, title, lines, pending, resolve, close } = usePackageResult();

  useEffect(() => window.electronAPI?.projectPackage?.onBusy((state) => usePackageResult.setState({ busy: state })), []);

  if (busy) {
    // 終わるまで閉じられない (途中で別の操作をさせない)
    return (
      <div className="modal-overlay" style={{ zIndex: 1000 }}>
        <div className="modal max-w-lg w-full">
          <div className="modal-body flex items-center gap-3">
            <Loader2 size={18} className="animate-spin text-arsist-accent shrink-0" />
            <span className="text-xs break-all">{t(busy.action === 'export' ? 'pkg.exporting' : 'pkg.importing', { file: busy.file })}</span>
          </div>
        </div>
      </div>
    );
  }
  if (!title) return null;

  const install = async (p: PendingInstall) => {
    const r = await window.electronAPI?.projectPackage?.installStagedExtension(p.source);
    if (!r) return;
    resolve(p.id);
    usePackageResult.setState((s) => ({
      lines: [...s.lines, r.ok
        ? { text: t('pkg.extInstalled', { id: r.id ?? p.id, version: r.version ?? p.version }) }
        : { text: t('pkg.extFailed', { id: p.id, message: r.error ?? '' }), warn: true }],
    }));
    // 開いているプロジェクトが使う拡張機能が変わったので読み直す
    if (r.ok && useProjectStore.getState().projectPath) await useProjectStore.getState().reloadProject();
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1000 }}>
      <div className="modal max-w-lg w-full">
        <div className="modal-header flex items-center gap-2">
          <Package size={18} className="text-arsist-accent" />
          <span className="flex-1">{title}</span>
          <button className="btn btn-ghost p-1" onClick={close}><X size={16} /></button>
        </div>
        <div className="modal-body space-y-2">
          {lines.map((l, i) => (
            <p key={i} className={`text-xs break-all ${l.warn ? 'text-arsist-warning' : ''}`}>{l.text}</p>
          ))}
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {pending.map((p) => (
                <button key={p.id} className="btn btn-secondary text-xs py-1" onClick={() => { void install(p); }}>
                  {p.id}: {t('pkg.extInstallNewer', { version: p.version })}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer flex justify-end">
          <button className="btn btn-primary text-xs" onClick={close}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
