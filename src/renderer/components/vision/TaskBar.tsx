/**
 * エディタの上の帯: どのタスクを組んでいるか、試す素材、実機、モデル、状態。
 *
 * タスクの細かい設定 (いつ走るか、どこを見るか、保存先) は「設定」の吹き出しにまとめる。
 * 帯に全部並べると、肝心の「素材を読み込む」が埋もれる。
 */
import { useEffect, useRef, useState } from 'react';
import { Cpu, Film, Plug, Plus, Settings2 } from 'lucide-react';
import { useT } from '../../i18n';
import type { PerceptionTask } from '../../../shared/types';
import type { PreviewState } from '../../vision/usePreview';
import { mediaFromFiles, type TestMedia } from '../../vision/testMedia';

type LookAt = 'whole' | 'centre' | 'custom';

function lookAtOf(task: PerceptionTask): LookAt {
  if (task.source.kind !== 'viewport') return 'custom';
  const r = task.source.rect;
  if (r.x === 0 && r.y === 0 && r.width === 1 && r.height === 1) return 'whole';
  if (r.x === 0.25 && r.y === 0.25 && r.width === 0.5 && r.height === 0.5) return 'centre';
  return 'custom';
}

export function TaskBar({
  tasks, task, media, preview, readOnly, onSelectTask, onNewTask, onUpdateTask, onMedia, onOpenModels, onOpenDevice,
}: {
  tasks: PerceptionTask[];
  task: PerceptionTask | null;
  media: TestMedia | null;
  preview: PreviewState;
  readOnly: boolean;
  onSelectTask: (id: string) => void;
  onNewTask: () => void;
  onUpdateTask: (updates: Partial<PerceptionTask>) => void;
  onMedia: (media: TestMedia) => void;
  onOpenModels: () => void;
  onOpenDevice: () => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const close = (e: MouseEvent) => { if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [settingsOpen]);

  const trigger = task?.trigger as { type: string; value?: number | string } | undefined;
  const lookAt = task ? lookAtOf(task) : 'whole';

  return (
    <div className="hairline-b px-3 py-1.5 flex items-center gap-2 bg-arsist-panel">
      {/* タスク */}
      <select className="input text-xs py-1 w-44" value={task?.id ?? ''} onChange={(e) => onSelectTask(e.target.value)}>
        {tasks.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        {tasks.length === 0 && <option value="">{t('vision.task.none')}</option>}
      </select>
      <button className="btn-icon" title={t('vision.task.new')} onClick={onNewTask}><Plus size={14} /></button>

      {task && (
        <div className="relative" ref={settingsRef}>
          <button className={`btn-ghost text-[11px] flex items-center gap-1 px-2 py-1 ${settingsOpen ? 'bg-arsist-hover' : ''}`} onClick={() => setSettingsOpen((v) => !v)}>
            <Settings2 size={12} />
            {t('vision.task.settings')}
            <span className="text-arsist-muted">
              · {trigger?.type === 'interval' ? t('vision.task.summaryInterval', { ms: Number(trigger.value ?? 500) })
                : trigger?.type === 'onStart' ? t('vision.task.whenStart')
                : trigger?.type === 'event' ? t('vision.task.summaryEvent', { id: String(trigger.value ?? '') })
                : t('vision.task.whenScript')}
              · {t(`vision.task.look${lookAt === 'whole' ? 'Whole' : lookAt === 'centre' ? 'Centre' : 'Custom'}`)}
            </span>
          </button>
          {settingsOpen && (
            <div className="absolute left-0 top-full mt-1 z-40 w-80 rounded-lg bg-arsist-surface shadow-xl p-3 space-y-3 text-[11px]">
              <label className="grid grid-cols-[6rem_1fr] items-center gap-2">
                <span className="text-arsist-muted">{t('vision.task.name')}</span>
                <input className="input text-xs py-1" value={task.name} onChange={(e) => onUpdateTask({ name: e.target.value })} />
              </label>
              <label className="grid grid-cols-[6rem_1fr] items-center gap-2">
                <span className="text-arsist-muted">{t('vision.task.when')}</span>
                <span className="flex items-center gap-1.5">
                  <select
                    className="input text-xs py-1"
                    value={trigger?.type ?? 'interval'}
                    onChange={(e) => {
                      const type = e.target.value;
                      onUpdateTask({
                        trigger: type === 'interval' ? { type: 'interval', value: Number(trigger?.value) || 500 }
                          : type === 'onStart' ? { type: 'onStart' }
                          : type === 'event' ? { type: 'event', value: String(trigger?.value ?? '') }
                          : { type: 'manual' },
                      } as Partial<PerceptionTask>);
                    }}
                  >
                    <option value="interval">{t('vision.task.whenInterval')}</option>
                    <option value="onStart">{t('vision.task.whenStart')}</option>
                    <option value="event">{t('vision.task.whenEvent')}</option>
                    <option value="manual">{t('vision.task.whenScript')}</option>
                  </select>
                  {trigger?.type === 'interval' && (
                    <input type="number" min={100} step={100} className="input text-xs py-1 w-20" value={Number(trigger.value ?? 500)}
                      onChange={(e) => onUpdateTask({ trigger: { type: 'interval', value: Math.max(100, parseInt(e.target.value, 10) || 500) } } as Partial<PerceptionTask>)} />
                  )}
                  {trigger?.type === 'event' && (
                    <input className="input text-xs py-1 w-24 font-mono" placeholder={t('vision.task.eventId')} value={String(trigger.value ?? '')}
                      onChange={(e) => onUpdateTask({ trigger: { type: 'event', value: e.target.value } } as Partial<PerceptionTask>)} />
                  )}
                </span>
              </label>
              {trigger?.type === 'interval' && <p className="text-[10px] text-arsist-muted leading-snug -mt-1 pl-[6.5rem]">{t('vision.task.intervalHint')}</p>}
              <label className="grid grid-cols-[6rem_1fr] items-center gap-2">
                <span className="text-arsist-muted">{t('vision.task.lookAt')}</span>
                <select
                  className="input text-xs py-1"
                  value={lookAt}
                  onChange={(e) => {
                    const v = e.target.value as LookAt;
                    if (v === 'whole') onUpdateTask({ source: { kind: 'viewport', rect: { x: 0, y: 0, width: 1, height: 1 } } });
                    else if (v === 'centre') onUpdateTask({ source: { kind: 'viewport', rect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } } });
                    else if (task.source.kind !== 'viewport') onUpdateTask({ source: { kind: 'viewport', rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } } });
                  }}
                >
                  <option value="whole">{t('vision.task.lookWhole')}</option>
                  <option value="centre">{t('vision.task.lookCentre')}</option>
                  <option value="custom">{t('vision.task.lookCustom')}</option>
                </select>
              </label>
              {lookAt === 'custom' && task.source.kind === 'viewport' && (
                <div className="grid grid-cols-4 gap-1 pl-[6.5rem]">
                  {(['x', 'y', 'width', 'height'] as const).map((k) => (
                    <label key={k} className="text-[10px] text-arsist-muted">
                      {k}
                      <input type="number" min={0} max={1} step={0.05} className="input text-xs py-1 w-full"
                        value={(task.source as { rect: Record<string, number> }).rect[k]}
                        onChange={(e) => onUpdateTask({
                          source: { kind: 'viewport', rect: { ...(task.source as { rect: { x: number; y: number; width: number; height: number } }).rect, [k]: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)) } },
                        })} />
                    </label>
                  ))}
                </div>
              )}
              <label className="grid grid-cols-[6rem_1fr] items-center gap-2">
                <span className="text-arsist-muted">{t('vision.task.storeAs')}</span>
                <input className="input text-xs py-1 font-mono" value={task.storeAs} onChange={(e) => onUpdateTask({ storeAs: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} />
              </label>
              <p className="text-[10px] text-arsist-muted leading-snug">{t('vision.task.storeHint', { key: task.storeAs || 'result' })}</p>
            </div>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        {readOnly && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">{t('ir.readOnlyBadge')}</span>}
        {preview.running && <span className="text-[10px] text-arsist-muted">{t('vision.running')}</span>}
        {preview.unavailable && (
          <span className="text-[10px] text-amber-400 max-w-[220px] leading-tight truncate" title={t(`vision.unavailable.${preview.unavailable}`)}>
            {t(`vision.unavailable.${preview.unavailable}`)}
          </span>
        )}
        <button className="btn-ghost text-[11px] flex items-center gap-1 px-2 py-1" onClick={onOpenDevice} title={t('vision.device.title')}>
          <Plug size={12} /> {t('vision.task.device')}
        </button>
        <button className="btn-ghost text-[11px] flex items-center gap-1 px-2 py-1" onClick={onOpenModels} title={t('vision.model.title')}>
          <Cpu size={12} /> {t('vision.task.models')}
        </button>
        <button
          className={`text-[11px] flex items-center gap-1 px-2.5 py-1 rounded-md ${media ? 'btn-ghost' : 'btn btn-primary !py-1'}`}
          onClick={() => inputRef.current?.click()}
          title={t('vision.media.pickHint')}
        >
          <Film size={12} />
          <span className="max-w-[180px] truncate">{media ? media.name : t('vision.media.pick')}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            const next = await mediaFromFiles(files);
            if (next) onMedia(next);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
