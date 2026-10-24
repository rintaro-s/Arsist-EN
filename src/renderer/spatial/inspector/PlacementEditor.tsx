/**
 * 置き方を「文」のように組む。
 *   [机・デスク] の上に (ただし [ベッド] は除く) / ユーザーから [0.3]–[1.6] m / [ユーザーの方を向く] / 空けておく広さ …
 *   → 置けなかったら: fallback 1, 2, … → 最後はユーザーの前 (いつでも置ける)
 * 解いた結果は Space Lab にすぐ出る (計算は solver.ts)。
 */
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { Facing, Keep, Placement, PlaceMode, Prefer, SpatialProject, Vec2 } from '../../../shared/layster/spatial/types';
import { useT } from '../../i18n';
import { CheckRow, NumberInput, RangeInput, Select, WordsInput } from './fields';
import { OffsetEditor, QueryEditor, TargetEditor } from './targets';

type Where = 'on' | 'near' | 'at';

function whereOf(p: Placement): Where {
  if (p.on) return 'on';
  if (p.near) return 'near';
  return 'at';
}

function clean(p: Placement): Placement {
  const next = { ...p } as Record<string, unknown>;
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  return next as Placement;
}

export function PlacementEditor({ value, onChange, project, thingId, depth = 0 }: {
  value: Placement; onChange: (p: Placement) => void; project: SpatialProject; thingId: string; depth?: number;
}) {
  const t = useT();
  const set = (patch: Partial<Placement>) => onChange(clean({ ...value, ...patch }));
  const mode: PlaceMode = value.mode ?? 'world';
  const attached = mode === 'head' || mode === 'hand';
  const where = whereOf(value);

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="text-arsist-muted whitespace-nowrap">{t('spatial.place.mode')}</span>
        <Select<PlaceMode>
          value={mode}
          options={(['world', 'body', 'head', 'hand'] as const).map((m) => ({ value: m, label: t(`spatial.place.mode.${m}`) }))}
          onChange={(m) => {
            if (m === 'head') set({ mode: m, on: undefined, near: undefined, at: { frame: 'head', at: [0, -0.2, 1.2] } });
            else if (m === 'hand') set({ mode: m, on: undefined, near: undefined, at: { frame: 'hand.left', at: [0, 0.08, 0] } });
            else set({ mode: m === 'world' ? undefined : m });
          }}
        />
      </div>

      {attached ? (
        <OffsetEditor
          project={project}
          exclude={thingId}
          frames={mode === 'head' ? ['head'] : ['hand.left', 'hand.right']}
          value={value.at ?? { frame: mode === 'head' ? 'head' : 'hand.left', at: [0, 0, 1] }}
          onChange={(at) => set({ at })}
        />
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-arsist-muted whitespace-nowrap">{t('spatial.place.where')}</span>
            <Select<Where>
              value={where}
              options={[
                { value: 'on', label: t('spatial.place.where.on') },
                { value: 'near', label: t('spatial.place.where.near') },
                { value: 'at', label: t('spatial.place.where.at') },
              ]}
              onChange={(w) => {
                if (w === where) return;
                if (w === 'on') set({ on: { has: ['support'] }, near: undefined, at: undefined });
                else if (w === 'near') set({ near: { user: 'feet' }, on: undefined, at: undefined });
                else set({ at: { frame: 'user', at: [0, 1.1, 1.0] }, on: undefined, near: undefined });
              }}
            />
          </div>
          {value.on && <QueryEditor value={value.on} onChange={(on) => set({ on })} />}
          {value.near && (
            <div className="pl-2 border-l-2 border-arsist-accent/30 space-y-1.5">
              <TargetEditor value={value.near} onChange={(near) => set({ near })} project={project} exclude={thingId} />
              <RangeInput label={t('spatial.place.around')} value={value.around} defaults={[0.3, 1.0]} onChange={(around) => set({ around })} />
            </div>
          )}
          {where === 'at' && value.at && (
            <div className="pl-2 border-l-2 border-arsist-accent/30">
              <OffsetEditor value={value.at} onChange={(at) => set({ at })} project={project} exclude={thingId} />
            </div>
          )}

          <div className="text-[11px] text-arsist-muted pt-1">{t('spatial.place.conditions')}</div>
          <RangeInput label={t('spatial.place.distance')} value={value.distance} defaults={[0.4, 1.6]} onChange={(distance) => set({ distance })} />
          <RangeInput label={t('spatial.place.height')} value={value.height} defaults={[0.4, 1.3]} onChange={(height) => set({ height })} />
          <ClearanceInput value={value.clearance} onChange={(clearance) => set({ clearance })} />
          <CheckRow on={!!value.visible} onToggle={(on) => set({ visible: on ? true : undefined })} label={t('spatial.place.visible')}>
            <span className="text-arsist-muted">±</span>
            <NumberInput value={value.visible === true ? 35 : (value.visible || undefined)} step={5} width="w-16"
              onChange={(n) => set({ visible: n === undefined || n === 35 ? true : n })} />
            <span className="text-arsist-muted">°</span>
          </CheckRow>
          <div className="space-y-1">
            <span className="block text-arsist-muted">{t('spatial.place.avoid')}</span>
            <WordsInput value={value.avoid} onChange={(avoid) => set({ avoid })} placeholder={t('spatial.place.avoidHint')} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Select<Facing>
              value={value.facing ?? 'user'}
              options={(['user', 'away', 'surface', 'keep'] as const).map((f) => ({ value: f, label: t(`spatial.place.facing.${f}`) }))}
              onChange={(facing) => set({ facing: facing === 'user' ? undefined : facing })}
            />
            <Select<Prefer>
              value={value.prefer ?? 'closest'}
              options={(['closest', 'farthest', 'largest', 'center', 'inView'] as const).map((p) => ({ value: p, label: t(`spatial.place.prefer.${p}`) }))}
              onChange={(prefer) => set({ prefer: prefer === 'closest' ? undefined : prefer })}
            />
          </div>
        </>
      )}

      {depth === 0 && (
        <>
          {!attached && (
            <div className="flex items-center gap-1.5">
              <span className="text-arsist-muted whitespace-nowrap">{t('spatial.place.keep')}</span>
              <Select<Keep>
                value={value.keep ?? 'session'}
                options={(['none', 'session', 'forever'] as const).map((k) => ({ value: k, label: t(`spatial.place.keep.${k}`) }))}
                onChange={(keep) => set({ keep: keep === 'session' ? undefined : keep })}
              />
            </div>
          )}
          <FallbackList value={value} onChange={onChange} project={project} thingId={thingId} />
        </>
      )}
    </div>
  );
}

function ClearanceInput({ value, onChange }: { value: Vec2 | undefined; onChange: (v: Vec2 | undefined) => void }) {
  const t = useT();
  return (
    <CheckRow on={!!value} onToggle={(on) => onChange(on ? [0.4, 0.3] : undefined)} label={t('spatial.place.clearance')}>
      {value && (
        <>
          <NumberInput value={value[0]} width="w-16" onChange={(w) => onChange([w ?? 0, value[1]])} />
          <span className="text-arsist-muted">×</span>
          <NumberInput value={value[1]} width="w-16" onChange={(d) => onChange([value[0], d ?? 0])} />
          <span className="text-arsist-muted">m</span>
        </>
      )}
    </CheckRow>
  );
}

function FallbackList({ value, onChange, project, thingId }: { value: Placement; onChange: (p: Placement) => void; project: SpatialProject; thingId: string }) {
  const t = useT();
  const list = value.fallback ?? [];
  const setList = (next: Placement[]) => onChange(clean({ ...value, fallback: next.length ? next : undefined }));
  return (
    <div className="pt-2 space-y-2">
      <div className="text-[11px] font-semibold text-arsist-muted">{t('spatial.place.fallbacks')}</div>
      {list.map((f, i) => (
        <div key={i} className="rounded-md bg-arsist-bg/60 p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-arsist-warning">{t('spatial.rule.fallback', { n: i + 1 })}</span>
            <div className="flex items-center">
              <button className="btn-icon !p-1" disabled={i === 0} title={t('spatial.common.moveUp')}
                onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setList(n); }}><ArrowUp size={12} /></button>
              <button className="btn-icon !p-1" disabled={i === list.length - 1} title={t('spatial.common.moveDown')}
                onClick={() => { const n = [...list]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setList(n); }}><ArrowDown size={12} /></button>
              <button className="btn-icon !p-1" title={t('spatial.common.remove')} onClick={() => setList(list.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
            </div>
          </div>
          <PlacementEditor value={f} depth={1} project={project} thingId={thingId}
            onChange={(p) => setList(list.map((x, j) => (j === i ? p : x)))} />
        </div>
      ))}
      <button
        className="w-full flex items-center justify-center gap-1 py-1 rounded-md text-[11px] text-arsist-muted hover:text-arsist-text hover:bg-arsist-hover"
        onClick={() => setList([...list, { at: { frame: 'user', at: [0, 1.1, 0.9] } }])}
      >
        <Plus size={12} /> {t('spatial.place.addFallback')}
      </button>
      <div className="text-[11px] text-arsist-muted px-1">{t('spatial.place.lastResort')}</div>
    </div>
  );
}
