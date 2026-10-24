/**
 * 行動 (Action) の編集。規則の「すること」で使う。Mind が返す行動・スクリプトの world.act と同じ語彙
 * (doc/19 §3.6)。
 */
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { Action, ActionKind, SpatialProject, Target } from '../../../shared/layster/spatial/types';
import { ACTION_KINDS } from '../../../shared/layster/spatial/types';
import { useT } from '../../i18n';
import { JsonInput, NumberInput, Select, TextInput, Toggle } from './fields';
import { OffsetEditor, TargetEditor } from './targets';

export function newAction(kind: ActionKind, project: SpatialProject): Action {
  const thing = project.things[0]?.id ?? '';
  const target: Target = { user: 'head' };
  switch (kind) {
    case 'place': return { do: 'place', thing };
    case 'move': return { do: 'move', thing, to: { user: 'feet' } };
    case 'look': return { do: 'look', thing, at: target };
    case 'say': return { do: 'say', text: '' };
    case 'animate': return { do: 'animate', thing, clip: '' };
    case 'show': return { do: 'show', thing };
    case 'hide': return { do: 'hide', thing };
    case 'highlight': return { do: 'highlight', target: { entity: { is: ['table'] } }, label: '', seconds: 5 };
    case 'set': return { do: 'set', key: '', value: true };
    case 'emit': return { do: 'emit', event: '' };
    case 'believe': return { do: 'believe', entity: { id: 'thing-1', is: ['cup'], at: [0, 0.8, 0.8], size: [0.08, 0.1, 0.08], confidence: 0.6 } };
    case 'forget': return { do: 'forget', entity: '' };
    case 'ask': return { do: 'ask', mind: project.minds[0]?.id ?? '' };
    case 'command': {
      const body = project.bodies[0];
      return { do: 'command', body: body?.id ?? '', name: body?.commands[0]?.name ?? '' };
    }
  }
}

export function ActionList({ actions, onChange, project }: { actions: Action[]; onChange: (a: Action[]) => void; project: SpatialProject }) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      {actions.map((a, i) => (
        <div key={i} className="rounded-md bg-arsist-bg/60 p-2 space-y-1.5">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-arsist-muted w-4">{i + 1}</span>
            <Select<ActionKind>
              value={a.do}
              options={ACTION_KINDS.map((k) => ({ value: k, label: t(`spatial.action.${k}`) }))}
              onChange={(k) => onChange(actions.map((x, j) => (j === i ? newAction(k, project) : x)))}
            />
            <button className="btn-icon !p-1" disabled={i === 0} onClick={() => { const n = [...actions]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }}><ArrowUp size={12} /></button>
            <button className="btn-icon !p-1" disabled={i === actions.length - 1} onClick={() => { const n = [...actions]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; onChange(n); }}><ArrowDown size={12} /></button>
            <button className="btn-icon !p-1" onClick={() => onChange(actions.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
          </div>
          <ActionFields action={a} project={project} onChange={(x) => onChange(actions.map((y, j) => (j === i ? x : y)))} />
        </div>
      ))}
      <button
        className="w-full flex items-center justify-center gap-1 py-1 rounded-md text-[11px] text-arsist-muted hover:text-arsist-text hover:bg-arsist-hover"
        onClick={() => onChange([...actions, newAction('say', project)])}
      >
        <Plus size={12} /> {t('spatial.action.add')}
      </button>
    </div>
  );
}

/** 空なら項目ごと消す (IR に空文字を残さない)。 */
function withOptional<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | '' | undefined): T {
  const next = { ...obj };
  if (value === undefined || value === '') delete next[key];
  else next[key] = value as T[K];
  return next;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-arsist-muted whitespace-nowrap w-16 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function ThingSelect({ value, onChange, project, optional }: { value: string | undefined; onChange: (v: string | undefined) => void; project: SpatialProject; optional?: boolean }) {
  const t = useT();
  const options = [
    ...(optional ? [{ value: '', label: t('spatial.action.noThing') }] : []),
    ...project.things.map((x) => ({ value: x.id, label: x.name || x.id })),
  ];
  return <Select value={value ?? ''} options={options} onChange={(v) => onChange(v || undefined)} />;
}

export function ActionFields({ action, onChange, project }: { action: Action; onChange: (a: Action) => void; project: SpatialProject }) {
  const t = useT();
  const a = action;
  switch (a.do) {
    case 'place':
      return (
        <div className="space-y-1.5">
          <Row label={t('spatial.action.f.thing')}><ThingSelect value={a.thing} project={project} onChange={(thing) => onChange({ ...a, thing: thing ?? '' })} /></Row>
          <Toggle checked={!!a.at} label={t('spatial.action.f.placeAt')} onChange={(on) => {
            const next = { ...a };
            if (on) next.at = { frame: 'user', at: [0, 1.1, 1.0] }; else delete next.at;
            onChange(next);
          }} />
          {a.at ? <OffsetEditor project={project} exclude={a.thing} value={a.at} onChange={(at) => onChange({ ...a, at })} />
            : <div className="text-[10px] text-arsist-muted">{t('spatial.action.f.placeAgain')}</div>}
        </div>
      );
    case 'move':
    case 'look': {
      const target = a.do === 'move' ? a.to : a.at;
      return (
        <div className="space-y-1.5">
          <Row label={t('spatial.action.f.thing')}><ThingSelect value={a.thing} project={project} onChange={(thing) => onChange({ ...a, thing: thing ?? '' })} /></Row>
          <Row label={t('spatial.action.f.target')}>
            <TargetEditor project={project} exclude={a.thing} value={target}
              onChange={(x) => onChange(a.do === 'move' ? { ...a, to: x } : { ...a, at: x })} />
          </Row>
          {a.do === 'move' && (
            <Row label={t('spatial.action.f.speed')}><NumberInput value={a.speed} step={0.1} onChange={(speed) => onChange({ ...a, speed })} placeholder="1.0" /></Row>
          )}
        </div>
      );
    }
    case 'say':
      return (
        <div className="space-y-1.5">
          <Row label={t('spatial.action.f.text')}><TextInput value={a.text} onChange={(text) => onChange({ ...a, text })} /></Row>
          <Row label={t('spatial.action.f.speaker')}><ThingSelect optional value={a.thing} project={project} onChange={(thing) => onChange(withOptional(a, 'thing', thing))} /></Row>
          <Row label={t('spatial.action.f.audio')}><TextInput value={a.audio} mono placeholder="Assets/Audio/x.wav / URL" onChange={(audio) => onChange(withOptional(a, 'audio', audio))} /></Row>
        </div>
      );
    case 'animate':
      return (
        <div className="space-y-1.5">
          <Row label={t('spatial.action.f.thing')}><ThingSelect value={a.thing} project={project} onChange={(thing) => onChange({ ...a, thing: thing ?? '' })} /></Row>
          <Row label={t('spatial.action.f.clip')}><TextInput value={a.clip} placeholder="Wave" onChange={(clip) => onChange({ ...a, clip })} /></Row>
          <Row label={t('spatial.action.f.then')}><TextInput value={a.then} placeholder="stand" onChange={(then) => onChange(withOptional(a, 'then', then))} /></Row>
        </div>
      );
    case 'show':
    case 'hide':
      return <Row label={t('spatial.action.f.thing')}><ThingSelect value={a.thing} project={project} onChange={(thing) => onChange({ ...a, thing: thing ?? '' })} /></Row>;
    case 'highlight':
      return (
        <div className="space-y-1.5">
          <Row label={t('spatial.action.f.target')}><TargetEditor project={project} value={a.target} onChange={(target) => onChange({ ...a, target })} /></Row>
          <Row label={t('spatial.action.f.label')}><TextInput value={a.label} onChange={(label) => onChange({ ...a, label })} /></Row>
          <Row label={t('spatial.action.f.seconds')}><NumberInput value={a.seconds} step={1} onChange={(seconds) => onChange({ ...a, seconds })} /></Row>
        </div>
      );
    case 'set':
      return (
        <div className="space-y-1.5">
          <Row label={t('spatial.action.f.key')}><TextInput value={a.key} mono onChange={(key) => onChange({ ...a, key })} /></Row>
          <Row label={t('spatial.action.f.value')}><JsonInput rows={1} value={a.value} onChange={(value) => onChange({ ...a, value })} /></Row>
        </div>
      );
    case 'emit':
      return (
        <div className="space-y-1.5">
          <Row label={t('spatial.action.f.event')}><TextInput value={a.event} mono onChange={(event) => onChange({ ...a, event })} /></Row>
          <Row label={t('spatial.action.f.data')}><JsonInput rows={1} value={a.data} onChange={(data) => onChange({ ...a, data })} /></Row>
        </div>
      );
    case 'believe':
      return <JsonInput value={a.entity} onChange={(entity) => onChange({ ...a, entity: (entity ?? { id: '' }) as typeof a.entity })} />;
    case 'forget':
      return <Row label={t('spatial.action.f.entity')}><TextInput value={a.entity} mono onChange={(entity) => onChange({ ...a, entity })} /></Row>;
    case 'ask':
      return (
        <div className="space-y-1.5">
          <Row label={t('spatial.action.f.mind')}>
            <Select value={a.mind} options={project.minds.map((m) => ({ value: m.id, label: m.name || m.id }))} onChange={(mind) => onChange({ ...a, mind })} />
          </Row>
          <Row label={t('spatial.action.f.text')}><TextInput value={a.text} onChange={(text) => onChange(withOptional(a, 'text', text))} /></Row>
        </div>
      );
    case 'command': {
      const body = project.bodies.find((b) => b.id === a.body);
      return (
        <div className="space-y-1.5">
          <Row label={t('spatial.action.f.body')}>
            <Select value={a.body} options={project.bodies.map((b) => ({ value: b.id, label: b.name || b.id }))} onChange={(b) => onChange({ ...a, body: b })} />
          </Row>
          <Row label={t('spatial.action.f.command')}>
            <Select value={a.name} options={(body?.commands ?? []).map((c) => ({ value: c.name, label: c.name }))} onChange={(name) => onChange({ ...a, name })} />
          </Row>
          <Row label={t('spatial.action.f.args')}><JsonInput rows={2} value={a.args} onChange={(args) => onChange({ ...a, args: args as Record<string, unknown> | undefined })} /></Row>
        </div>
      );
    }
  }
}
