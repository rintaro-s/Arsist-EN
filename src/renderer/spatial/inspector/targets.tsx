/**
 * 「何を指すか」の部品: entity の条件 (QueryEditor)、相手 (TargetEditor)、frame からのずれ (OffsetEditor)。
 * 置き方・行動・規則のどこでも同じ部品を使う。
 */
import type { Affordance, EntityQuery, FrameRef, Offset, SpatialProject, Target, Vec3 } from '../../../shared/layster/spatial/types';
import { AFFORDANCES } from '../../../shared/layster/spatial/types';
import { VOCABULARY } from '../../../shared/layster/spatial/vocabulary';
import { useT, useI18n } from '../../i18n';
import { Chips, NumberInput, Select, Vec3Input, WordsInput } from './fields';

/** 選びやすい言葉 (語彙の先頭から。人と体は外す)。 */
const COMMON_WORDS = VOCABULARY.filter((w) => !['ceiling', 'person', 'robot'].includes(w.word));

export function WordPicker({ value, onChange }: { value: string[] | undefined; onChange: (v: string[] | undefined) => void }) {
  const { lang } = useI18n();
  const t = useT();
  const known = new Set(COMMON_WORDS.map((w) => w.word));
  const extra = (value ?? []).filter((w) => !known.has(w));
  return (
    <div className="space-y-1">
      <Chips
        options={COMMON_WORDS.map((w) => ({ value: w.word, label: w.label[lang] }))}
        value={(value ?? []).filter((w) => known.has(w))}
        onChange={(picked) => {
          const next = [...picked, ...extra];
          onChange(next.length ? next : undefined);
        }}
      />
      <WordsInput
        value={extra.length ? extra : undefined}
        placeholder={t('spatial.query.otherWords')}
        onChange={(words) => {
          const picked = (value ?? []).filter((w) => known.has(w));
          const next = [...picked, ...(words ?? [])];
          onChange(next.length ? next : undefined);
        }}
      />
    </div>
  );
}

export function QueryEditor({ value, onChange, compact }: { value: EntityQuery; onChange: (q: EntityQuery) => void; compact?: boolean }) {
  const t = useT();
  const set = (patch: Partial<EntityQuery>) => {
    const next: EntityQuery = { ...value, ...patch };
    for (const k of Object.keys(next) as Array<keyof EntityQuery>) if (next[k] === undefined) delete next[k];
    onChange(next);
  };
  return (
    <div className="space-y-1.5 pl-2 border-l-2 border-arsist-accent/30">
      <div className="text-[11px] text-arsist-muted">{t('spatial.query.is')}</div>
      <WordPicker value={value.is} onChange={(is) => set({ is })} />
      <div className="text-[11px] text-arsist-muted">{t('spatial.query.has')}</div>
      <Chips<Affordance>
        options={AFFORDANCES.map((a) => ({ value: a, label: t(`spatial.affordance.${a}`) }))}
        value={value.has ?? []}
        onChange={(has) => set({ has: has.length ? has : undefined })}
      />
      {!compact && (
        <>
          <div className="text-[11px] text-arsist-muted">{t('spatial.query.not')}</div>
          <WordPicker value={value.not} onChange={(not) => set({ not })} />
          <div className="text-xs">
            <span className="block text-[11px] text-arsist-muted">{t('spatial.query.minSize')}</span>
            <div className="flex items-center gap-1 mt-0.5 whitespace-nowrap">
              <NumberInput value={value.minSize?.[0]} placeholder="w" width="w-16"
                onChange={(w) => set({ minSize: w === undefined && value.minSize?.[1] === undefined ? undefined : [w ?? 0, value.minSize?.[1] ?? 0] })} />
              <span className="text-arsist-muted">×</span>
              <NumberInput value={value.minSize?.[1]} placeholder="d" width="w-16"
                onChange={(d) => set({ minSize: d === undefined && value.minSize?.[0] === undefined ? undefined : [value.minSize?.[0] ?? 0, d ?? 0] })} />
              <span className="text-arsist-muted">m</span>
            </div>
          </div>
          <div className="text-xs">
            <span className="block text-[11px] text-arsist-muted">{t('spatial.query.within')}</span>
            <div className="flex items-center gap-1 mt-0.5 whitespace-nowrap">
              <NumberInput value={value.within} width="w-16" onChange={(within) => set({ within })} />
              <span className="text-arsist-muted">m</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function frameOptions(t: (k: string, p?: Record<string, string | number>) => string, project: SpatialProject, exclude?: string): Array<{ value: FrameRef; label: string }> {
  return [
    { value: 'world', label: t('spatial.frame.world') },
    { value: 'user', label: t('spatial.frame.user') },
    { value: 'head', label: t('spatial.frame.head') },
    { value: 'hand.left', label: t('spatial.frame.handLeft') },
    { value: 'hand.right', label: t('spatial.frame.handRight') },
    ...project.things.filter((x) => x.id !== exclude).map((x) => ({ value: `thing:${x.id}` as FrameRef, label: t('spatial.frame.thing', { id: x.id }) })),
    ...project.bodies.map((b) => ({ value: `body:${b.id}` as FrameRef, label: t('spatial.frame.body', { id: b.id }) })),
  ];
}

export function OffsetEditor({ value, onChange, project, frames, exclude }: {
  value: Offset; onChange: (o: Offset) => void; project: SpatialProject; frames?: FrameRef[]; exclude?: string;
}) {
  const t = useT();
  const options = frameOptions(t, project, exclude).filter((o) => !frames || frames.includes(o.value));
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-arsist-muted whitespace-nowrap">{t('spatial.offset.from')}</span>
        <Select value={value.frame} options={options} onChange={(frame) => onChange({ ...value, frame })} />
      </div>
      <Vec3Input value={value.at} onChange={(at) => onChange({ ...value, at })} />
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-arsist-muted">{t('spatial.offset.yaw')}</span>
        <NumberInput value={value.yaw} step={15} onChange={(yaw) => {
          const next = { ...value, yaw };
          if (yaw === undefined) delete next.yaw;
          onChange(next);
        }} placeholder="—" />
        <span className="text-arsist-muted">°</span>
      </div>
      <div className="text-[10px] text-arsist-muted">{t('spatial.offset.axes')}</div>
    </div>
  );
}

type TargetKind = 'user' | 'thing' | 'entity' | 'frame';

function targetKind(target: Target): TargetKind {
  if ('thing' in target) return 'thing';
  if ('entity' in target) return 'entity';
  if ('frame' in target) return 'frame';
  return 'user';
}

export function TargetEditor({ value, onChange, project, exclude }: { value: Target; onChange: (t: Target) => void; project: SpatialProject; exclude?: string }) {
  const t = useT();
  const kind = targetKind(value);
  const things = project.things.filter((x) => x.id !== exclude);
  return (
    <div className="space-y-1.5">
      <Select<TargetKind>
        value={kind}
        options={[
          { value: 'user', label: t('spatial.target.kindUser') },
          { value: 'thing', label: t('spatial.target.kindThing') },
          { value: 'entity', label: t('spatial.target.kindEntity') },
          { value: 'frame', label: t('spatial.target.kindFrame') },
        ]}
        onChange={(k) => {
          if (k === kind) return;
          if (k === 'user') onChange({ user: 'feet' });
          else if (k === 'thing') onChange({ thing: things[0]?.id ?? '' });
          else if (k === 'entity') onChange({ entity: { is: ['table'] } });
          else onChange({ frame: 'user', at: [0, 1, 1] });
        }}
      />
      {'user' in value && (
        <Select
          value={value.user}
          options={(['feet', 'head', 'hand.left', 'hand.right'] as const).map((u) => ({ value: u, label: t(`spatial.target.user.${u}`) }))}
          onChange={(user) => onChange({ user })}
        />
      )}
      {'thing' in value && (
        <Select value={value.thing} options={things.map((x) => ({ value: x.id, label: x.name || x.id }))} onChange={(thing) => onChange({ thing })} />
      )}
      {'entity' in value && <QueryEditor compact value={value.entity} onChange={(entity) => onChange({ entity })} />}
      {'frame' in value && (
        <OffsetEditor
          project={project}
          exclude={exclude}
          value={{ frame: value.frame, at: (value.at ?? [0, 0, 0]) as Vec3 }}
          onChange={(o) => onChange({ frame: o.frame, at: o.at })}
        />
      )}
    </div>
  );
}
