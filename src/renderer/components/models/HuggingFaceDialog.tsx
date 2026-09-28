/**
 * Hugging Face からモデルを取り込む。
 *
 * ONNX を配っているリポジトリは、同じモデルを精度違いで何本も置いている
 * (fp32 / fp16 / q4 / q4f16 / int8 …)。ここでは一覧を読んで、同じモデルの別精度としてまとめ、
 * **大きさと、実機で動くかの見込み**を添えて選ばせる。選んだ 1 本と、その重み・分割器・設定だけを落とす。
 *
 * 量子化された書き出し (q4 / int8 …) は ONNX Runtime 専用の演算子を使うので、エディタの「試す」では
 * 動いても実機 (Unity) には取り込めない。選ぶ前にそれを言う。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Download, Loader2, Search, X } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { ModelDefinition } from '../../../shared/types';

type RepoInfo = Awaited<ReturnType<NonNullable<typeof window.electronAPI>['model']['hfInspect']>> extends infer R
  ? R extends { success: true; info: infer I } ? I : never
  : never;

function megabytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
  return `${Math.max(1, Math.round(bytes / 1048576))} MB`;
}

/** 量子化されていない一番小さいもの → 無ければ一番小さいもの。 */
function recommend(info: RepoInfo): string | null {
  const variants = info.groups.flatMap((g: RepoInfo['groups'][number]) => g.variants);
  if (variants.length === 0) return null;
  const sorted = [...variants].sort((a, b) => a.totalSize - b.totalSize);
  return (sorted.find((v) => v.precision === 'q4') ?? sorted[0]).path;
}

export function HuggingFaceDialog({ onClose, onImported }: { onClose: () => void; onImported: (model: ModelDefinition, warnings: string[]) => void }) {
  const t = useT();
  const { projectPath } = useProjectStore();
  const { addNotification } = useUIStore();
  const [repo, setRepo] = useState('');
  const [info, setInfo] = useState<RepoInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ file: string; receivedBytes: number; totalBytes: number } | null>(null);
  const runId = useRef<string | null>(null);

  useEffect(() => window.electronAPI.model.onHfProgress(({ runId: id, progress: p }) => {
    if (id === runId.current) setProgress(p);
  }), []);

  const look = async () => {
    if (!repo.trim()) return;
    setLooking(true);
    setError(null);
    setInfo(null);
    try {
      const result = await window.electronAPI.model.hfInspect(repo.trim());
      if (!result.success) { setError(result.error); return; }
      setInfo(result.info);
      setSelected(recommend(result.info));
    } finally {
      setLooking(false);
    }
  };

  const pull = async () => {
    if (!info || !selected || !projectPath) return;
    const id = uuidv4();
    runId.current = id;
    setProgress({ file: '', receivedBytes: 0, totalBytes: 0 });
    setError(null);
    const name = `${info.repo.split('/').pop()}`;
    const result = await window.electronAPI.model.hfImport(id, info.repo, selected, projectPath, name);
    if (runId.current !== id) return;
    runId.current = null;
    setProgress(null);
    if (!result.success || !result.model) {
      if (result.error !== 'cancelled') setError(result.error ?? 'failed');
      return;
    }
    onImported(result.model, result.warnings ?? []);
    addNotification({ type: 'success', message: t('models.hf.imported', { name: result.model.name }) });
    onClose();
  };

  const cancel = () => {
    if (runId.current) void window.electronAPI.model.hfCancel(runId.current);
    runId.current = null;
    setProgress(null);
  };

  const variants = useMemo(() => (info ? info.groups.flatMap((g) => g.variants.map((v) => ({ ...v, base: g.base }))) : []), [info]);
  const downloading = progress !== null;

  const dialog = (
    <div className="modal-overlay" onClick={downloading ? undefined : onClose} style={{ zIndex: 960 }}>
      <div className="modal max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header flex items-center gap-2">
          <Download size={15} className="text-purple-300" />
          <span>{t('models.hf.title')}</span>
          <button className="btn-icon ml-auto" disabled={downloading} onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body overflow-y-auto space-y-4">
          <p className="text-[11px] text-arsist-muted leading-relaxed">{t('models.hf.hint')}</p>

          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-arsist-muted" />
              <input
                autoFocus
                className="input text-xs w-full pl-7 font-mono"
                placeholder="onnx-community/Qwen3.5-0.8B-Text-ONNX"
                value={repo}
                disabled={downloading}
                onChange={(e) => setRepo(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void look(); }}
              />
            </div>
            <button className="btn btn-secondary text-xs px-3" disabled={looking || downloading || !repo.trim()} onClick={() => { void look(); }}>
              {looking ? <Loader2 size={13} className="animate-spin" /> : t('models.hf.look')}
            </button>
          </div>

          {error && (
            <p className="flex items-start gap-1.5 text-[11px] text-arsist-error rounded bg-arsist-error/10 px-3 py-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>{t(`models.hf.error.${error}`, { detail: error }) || error}</span>
            </p>
          )}

          {info && (
            <>
              {info.notes.map((note) => (
                <p key={note} className="flex items-start gap-1.5 text-[11px] text-amber-400 rounded bg-amber-400/10 px-3 py-2">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  <span>{t(`models.hf.note.${note}`)}</span>
                </p>
              ))}

              {variants.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-arsist-muted">{t('models.hf.variants')}</p>
                  {variants.map((variant) => (
                    <button
                      key={variant.path}
                      disabled={downloading}
                      className={`w-full text-left rounded-lg px-3 py-2 flex items-center gap-3 ${
                        selected === variant.path ? 'bg-arsist-accent/15 ring-1 ring-arsist-accent' : 'bg-arsist-surface hover:bg-arsist-hover'
                      }`}
                      onClick={() => setSelected(variant.path)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-medium">
                          {t(`models.hf.precision.${variant.precision}`)}
                          <span className="text-arsist-muted font-normal"> · {megabytes(variant.totalSize)}</span>
                        </span>
                        <span className="block text-[10px] text-arsist-muted font-mono truncate">{variant.path}</span>
                      </span>
                      <span className={`text-[10px] shrink-0 ${variant.quantized ? 'text-amber-400' : 'text-arsist-muted'}`}>
                        {t(variant.quantized ? 'models.hf.editorOnly' : 'models.hf.maybeDevice')}
                      </span>
                    </button>
                  ))}
                  <p className="text-[10px] text-arsist-muted leading-snug">{t('models.hf.deviceNote')}</p>
                </div>
              )}
            </>
          )}

          {downloading && (
            <div className="space-y-1.5">
              <p className="text-[11px] flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" />
                <span className="font-mono truncate">{progress?.file}</span>
                <span className="ml-auto text-arsist-muted">
                  {megabytes(progress?.receivedBytes ?? 0)}{progress?.totalBytes ? ` / ${megabytes(progress.totalBytes)}` : ''}
                </span>
              </p>
              <div className="h-1.5 rounded bg-arsist-bg overflow-hidden">
                <div
                  className="h-full bg-arsist-accent transition-[width]"
                  style={{ width: progress?.totalBytes ? `${Math.min(100, (progress.receivedBytes / progress.totalBytes) * 100)}%` : '10%' }}
                />
              </div>
              <p className="text-[10px] text-arsist-muted">{t('models.hf.downloadingHint')}</p>
            </div>
          )}
        </div>

        <div className="modal-footer flex items-center gap-2">
          {!projectPath && <span className="text-[11px] text-amber-400">{t('models.hf.needProject')}</span>}
          <span className="ml-auto" />
          {downloading ? (
            <button className="btn btn-secondary text-xs px-3" onClick={cancel}>{t('models.hf.cancel')}</button>
          ) : (
            <>
              <button className="btn btn-secondary text-xs px-3" onClick={onClose}>{t('models.hf.close')}</button>
              <button className="btn btn-primary text-xs px-3 flex items-center gap-1" disabled={!selected || !projectPath} onClick={() => { void pull(); }}>
                <Download size={13} /> {t('models.hf.pull')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
