/** 規則: きっかけ (when) → 条件 (if) → すること (do)。コードを書かずに済む振る舞い。 */
import { Plus, Trash2, Workflow } from 'lucide-react';
import type { Condition, EntityQuery, PanelItem, Rule, SpatialProject, When } from '../../../shared/layster/spatial/types';
import { useT } from '../../i18n';
import { useSpatialStore } from '../store';
import { whenKind } from '../describe';
import { Field, JsonInput, NumberInput, Section, Select, TextInput, Toggle } from './fields';
import { ItemHeader } from './ItemHeader';
import { QueryEditor, TargetEditor } from './targets';
import { ActionList } from './ActionEditor';

const WHEN_KINDS = ['start', 'every', 'select', 'gaze', 'near', 'seen', 'lost', 'event', 'mind', 'placed', 'fallback'] as const;
type WhenKind = typeof WHEN_KINDS[number];

function newWhen(kind: WhenKind, project: SpatialProject): When {
  const thing = project.things[0]?.id ?? '';
  switch (kind) {
    case 'start': return { start: true };
    case 'every': return { every: 5000 };
    case 'select': {
      const panel = project.things.find((x) => x.visual.kind === 'panel');
      const button = panel?.visual.kind === 'panel' ? panel.visual.items.find((i) => i.type === 'button') : undefined;
      return { select: panel && button && 'id' in button ? `${panel.id}.${button.id}` : thing };
    }
    case 'gaze': return { gaze: thing, seconds: 1 };
    case 'near': return { near: 'user', to: { thing }, within: 0.8 };
    case 'seen': return { seen: { is: ['cup'] } };
    case 'lost': return { lost: { is: ['cup'] } };
    case 'event': return { event: '' };
    case 'mind': return { mind: project.minds[0]?.id ?? '' };
    case 'placed': return { placed: thing };
    case 'fallback': return { fallback: thing };
  }
}

export function RuleInspector({ project, rule }: { project: SpatialProject; rule: Rule }) {
  const t = useT();
  const update = useSpatialStore((s) => s.update);
  const setSelection = useSpatialStore((s) => s.setSelection);
  const edit = (fn: (r: Rule) => void, coalesce?: string) => update((p) => {
    const r = p.rules.find((x) => x.id === rule.id);
    if (r) fn(r);
  }, coalesce);
  const kind = whenKind(rule.when) as WhenKind;

  return (
    <div>
      <ItemHeader
        icon={<Workflow size={12} />}
        kindLabel={t('spatial.outline.rules')}
        id={rule.id}
        name={rule.name}
        taken={project.rules.map((r) => r.id)}
        onRename={(id) => { edit((r) => { r.id = id; }); setSelection({ kind: 'rule', id }); }}
        onName={(name) => edit((r) => { r.name = name || undefined; }, `name:${rule.id}`)}
        onDelete={() => { update((p) => { p.rules = p.rules.filter((r) => r.id !== rule.id); }); setSelection(null); }}
      />
      <Toggle checked={rule.enabled !== false} label={t('spatial.rule.enabled')} onChange={(on) => edit((r) => { if (on) delete r.enabled; else r.enabled = false; })} />

      <Section title={t('spatial.rule.when')}>
        <Select<WhenKind> value={kind} options={WHEN_KINDS.map((k) => ({ value: k, label: t(`spatial.when.${k}`) }))}
          onChange={(k) => edit((r) => { r.when = newWhen(k, project); })} />
        <WhenFields when={rule.when} project={project} onChange={(when) => edit((r) => { r.when = when; }, `when:${rule.id}`)} />
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-arsist-muted">{t('spatial.rule.cooldown')}</span>
          <NumberInput value={rule.cooldownMs} step={500} width="w-20" onChange={(cooldownMs) => edit((r) => { if (cooldownMs) r.cooldownMs = cooldownMs; else delete r.cooldownMs; })} />
          <span className="text-arsist-muted">ms</span>
        </div>
      </Section>

      <Section title={t('spatial.rule.if')}>
        {(rule.if ?? []).map((c, i) => (
          <div key={i} className="rounded-md bg-arsist-bg/60 p-2 flex gap-1 items-start">
            <div className="flex-1 min-w-0"><ConditionEditor value={c} onChange={(x) => edit((r) => { r.if![i] = x; })} /></div>
            <button className="btn-icon !p-1" onClick={() => edit((r) => { r.if!.splice(i, 1); if (!r.if!.length) delete r.if; })}><Trash2 size={12} /></button>
          </div>
        ))}
        <button className="w-full flex items-center justify-center gap-1 py-1 rounded-md text-[11px] text-arsist-muted hover:text-arsist-text hover:bg-arsist-hover"
          onClick={() => edit((r) => { r.if = [...(r.if ?? []), { store: '', eq: true }]; })}>
          <Plus size={12} /> {t('spatial.rule.addCondition')}
        </button>
      </Section>

      <Section title={t('spatial.rule.do')}>
        <ActionList project={project} actions={rule.do} onChange={(actions) => edit((r) => { r.do = actions; }, `do:${rule.id}`)} />
      </Section>
    </div>
  );
}

function WhenFields({ when, onChange, project }: { when: When; onChange: (w: When) => void; project: SpatialProject }) {
  const t = useT();
  const thingOptions = project.things.map((x) => ({ value: x.id, label: x.name || x.id }));
  if ('every' in when) return <div className="flex items-center gap-1.5 text-xs"><NumberInput value={when.every} step={500} width="w-24" onChange={(every) => onChange({ every: every ?? 1000 })} /><span className="text-arsist-muted">ms</span></div>;
  if ('select' in when) {
    const options = project.things.flatMap((x) => (x.visual.kind === 'panel'
      ? panelButtons(x.visual.items).map((b) => ({ value: b.event ?? `${x.id}.${b.id}`, label: `${x.name || x.id} › ${b.text || b.id}` }))
      : [{ value: x.id, label: x.name || x.id }]));
    return (
      <Field label={t('spatial.when.selectWhat')} hint={t('spatial.when.selectHint')}>
        <Select value={when.select} options={options.some((o) => o.value === when.select) ? options : [{ value: when.select, label: when.select }, ...options]} onChange={(select) => onChange({ select })} />
      </Field>
    );
  }
  if ('gaze' in when) return (
    <div className="flex items-center gap-1.5 text-xs">
      <Select value={when.gaze} options={thingOptions} onChange={(gaze) => onChange({ ...when, gaze })} />
      <NumberInput value={when.seconds ?? 1} step={0.5} onChange={(seconds) => onChange({ ...when, seconds })} />
      <span className="text-arsist-muted">s</span>
    </div>
  );
  if ('near' in when) return (
    <div className="space-y-1.5 text-xs">
      <Select value={when.near} options={[{ value: 'user', label: t('spatial.target.user.feet') }, ...thingOptions]} onChange={(near) => onChange({ ...when, near })} />
      <TargetEditor project={project} value={when.to} onChange={(to) => onChange({ ...when, to })} />
      <div className="flex items-center gap-1.5"><span className="text-arsist-muted">{t('spatial.when.within')}</span>
        <NumberInput value={when.within} onChange={(within) => onChange({ ...when, within: within ?? 0.5 })} /><span className="text-arsist-muted">m</span></div>
    </div>
  );
  if ('seen' in when) return <QueryEditor compact value={when.seen} onChange={(seen: EntityQuery) => onChange({ seen })} />;
  if ('lost' in when) return <QueryEditor compact value={when.lost} onChange={(lost: EntityQuery) => onChange({ lost })} />;
  if ('event' in when) return <TextInput mono value={when.event} placeholder="my-event" onChange={(event) => onChange({ event })} />;
  if ('mind' in when) return <Select value={when.mind} options={project.minds.map((m) => ({ value: m.id, label: m.name || m.id }))} onChange={(mind) => onChange({ mind })} />;
  if ('placed' in when) return <Select value={when.placed} options={thingOptions} onChange={(placed) => onChange({ placed })} />;
  if ('fallback' in when) return <Select value={when.fallback} options={thingOptions} onChange={(fallback) => onChange({ fallback })} />;
  return <div className="text-[11px] text-arsist-muted">{t('spatial.when.startHint')}</div>;
}

type CondOp = 'eq' | 'ne' | 'gt' | 'lt' | 'exists';

function ConditionEditor({ value, onChange }: { value: Condition; onChange: (c: Condition) => void }) {
  const t = useT();
  if ('not' in value) {
    return (
      <div className="space-y-1">
        <Toggle checked label={t('spatial.rule.not')} onChange={() => onChange(value.not)} />
        <ConditionEditor value={value.not} onChange={(c) => onChange({ not: c })} />
      </div>
    );
  }
  const isHas = 'has' in value;
  return (
    <div className="space-y-1">
      <div className="flex gap-1 items-center">
        <Select value={isHas ? 'has' : 'store'} className="!w-28"
          options={[{ value: 'store', label: t('spatial.rule.cond.store') }, { value: 'has', label: t('spatial.rule.cond.has') }]}
          onChange={(k) => onChange(k === 'has' ? { has: { is: ['cup'] } } : { store: '', eq: true })} />
        <Toggle checked={false} label={t('spatial.rule.not')} onChange={() => onChange({ not: value })} />
      </div>
      {isHas ? <QueryEditor compact value={value.has} onChange={(has) => onChange({ has })} /> : <StoreCondition value={value} onChange={onChange} />}
    </div>
  );
}

function StoreCondition({ value, onChange }: { value: Extract<Condition, { store: string }>; onChange: (c: Condition) => void }) {
  const t = useT();
  const op: CondOp = value.exists !== undefined ? 'exists' : value.gt !== undefined ? 'gt' : value.lt !== undefined ? 'lt' : value.ne !== undefined ? 'ne' : 'eq';
  const operand = op === 'exists' ? value.exists : (value as Record<string, unknown>)[op];
  return (
    <div className="flex gap-1 items-center">
      <TextInput mono value={value.store} placeholder="mode" onChange={(store) => onChange({ ...value, store })} />
      <Select<CondOp> value={op} className="!w-24" options={(['eq', 'ne', 'gt', 'lt', 'exists'] as const).map((o) => ({ value: o, label: t(`spatial.rule.op.${o}`) }))}
        onChange={(o) => onChange(o === 'exists' ? { store: value.store, exists: true } : o === 'gt' || o === 'lt' ? { store: value.store, [o]: 0 } : { store: value.store, [o]: '' })} />
      {op !== 'exists' && <div className="w-24"><JsonInput rows={1} value={operand} onChange={(v) => onChange({ store: value.store, [op]: v } as Condition)} /></div>}
    </div>
  );
}

/** パネルのボタン (行の中も)。 */
export function panelButtons(items: PanelItem[]): Array<Extract<PanelItem, { type: 'button' }>> {
  return items.flatMap((it) => (it.type === 'button' ? [it] : it.type === 'row' ? panelButtons(it.items) : []));
}
