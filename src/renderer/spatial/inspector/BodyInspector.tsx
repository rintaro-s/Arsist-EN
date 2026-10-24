/** 体 (ロボット・家電) のインスペクタ: つなぎ方・根元・動ける範囲・命令・安全。 */
import { Bot, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { Body, BodyArgType, BodyKind, SpatialProject } from '../../../shared/layster/spatial/types';
import { useT } from '../../i18n';
import { useSpatialStore } from '../store';
import { renameRefs } from '../refs';
import { Field, NumberInput, Section, Select, TextInput, Toggle, Vec3Input } from './fields';
import { ItemHeader } from './ItemHeader';

const ARG_TYPES: BodyArgType[] = ['number', 'string', 'boolean', 'pose', 'target'];

export function BodyInspector({ project, body }: { project: SpatialProject; body: Body }) {
  const t = useT();
  const update = useSpatialStore((s) => s.update);
  const setSelection = useSpatialStore((s) => s.setSelection);
  const edit = (fn: (b: Body) => void, coalesce?: string) => update((p) => {
    const b = p.bodies.find((x) => x.id === body.id);
    if (b) fn(b);
  }, coalesce);
  const markers = project.things.filter((x) => x.visual.kind === 'marker');

  return (
    <div>
      <ItemHeader
        icon={<Bot size={12} />}
        kindLabel={t(`spatial.body.kind.${body.kind}`)}
        id={body.id}
        name={body.name}
        taken={project.bodies.map((b) => b.id)}
        onRename={(id) => { update((p) => { renameRefs(p, 'body', body.id, id); const b = p.bodies.find((x) => x.id === body.id); if (b) b.id = id; }); setSelection({ kind: 'body', id }); }}
        onName={(name) => edit((b) => { b.name = name || undefined; }, `name:${body.id}`)}
        onDelete={() => { update((p) => { p.bodies = p.bodies.filter((b) => b.id !== body.id); }); setSelection(null); }}
      />

      <Section title={t('spatial.body.link')}>
        <div className="grid grid-cols-2 gap-1.5">
          <Field label={t('spatial.body.kind')}>
            <Select<BodyKind> value={body.kind} options={(['arm', 'mobile', 'humanoid', 'device', 'other'] as const).map((k) => ({ value: k, label: t(`spatial.body.kind.${k}`) }))}
              onChange={(kind) => edit((b) => { b.kind = kind; })} />
          </Field>
          <Field label={t('spatial.body.protocol')}>
            <Select value={body.link.protocol} options={[{ value: 'layster-body', label: 'layster-body' }, { value: 'rosbridge', label: 'rosbridge (ROS)' }]}
              onChange={(protocol) => edit((b) => { b.link = { ...b.link, protocol }; })} />
          </Field>
        </div>
        <Field label={t('spatial.body.url')} hint={t('spatial.body.urlHint')}>
          <TextInput mono value={body.link.url} onChange={(url) => edit((b) => { b.link = { ...b.link, url }; }, `url:${body.id}`)} />
        </Field>
        <Field label={t('spatial.body.base')} hint={t('spatial.body.baseHint')}>
          <Select value={body.base.thing} options={(markers.length ? markers : project.things).map((x) => ({ value: x.id, label: x.name || x.id }))}
            onChange={(thing) => edit((b) => { b.base = { thing }; })} />
        </Field>
      </Section>

      <Section title={t('spatial.body.workspace')}>
        <Field label={t('spatial.body.workspaceCenter')}><Vec3Input value={body.workspace.center} onChange={(center) => edit((b) => { b.workspace = { ...b.workspace, center }; }, `wc:${body.id}`)} /></Field>
        <Field label={t('spatial.body.workspaceSize')}><Vec3Input value={body.workspace.size} onChange={(size) => edit((b) => { b.workspace = { ...b.workspace, size }; }, `ws:${body.id}`)} /></Field>
        <Toggle checked={body.twin?.showWorkspace !== false} label={t('spatial.body.showWorkspace')}
          onChange={(showWorkspace) => edit((b) => { b.twin = { ...b.twin, showWorkspace }; })} />
      </Section>

      <Section title={t('spatial.body.commands')}>
        {body.commands.map((c, i) => (
          <div key={i} className="rounded-md bg-arsist-bg/60 p-2 space-y-1.5">
            <div className="flex gap-1 items-center">
              <TextInput mono value={c.name} onChange={(name) => edit((b) => { b.commands[i] = { ...b.commands[i], name }; }, `cmd:${body.id}:${i}`)} />
              <Select value={c.confirm ?? 'never'} className="!w-28"
                options={[{ value: 'never', label: t('spatial.body.confirm.never') }, { value: 'always', label: t('spatial.body.confirm.always') }]}
                onChange={(confirm) => edit((b) => { b.commands[i] = { ...b.commands[i], confirm }; })} />
              <button className="btn-icon !p-1" onClick={() => edit((b) => { b.commands.splice(i, 1); })}><Trash2 size={12} /></button>
            </div>
            <TextInput value={c.description} placeholder={t('spatial.body.commandDescription')}
              onChange={(description) => edit((b) => { b.commands[i] = { ...b.commands[i], description: description || undefined }; }, `cmdd:${body.id}:${i}`)} />
            <ArgsEditor args={c.args ?? {}} onChange={(args) => edit((b) => { b.commands[i] = { ...b.commands[i], args: Object.keys(args).length ? args : undefined }; })} />
            {body.link.protocol === 'rosbridge' && (
              <div className="flex gap-1">
                <TextInput mono value={c.ros?.topic} placeholder="/arm/goal" onChange={(topic) => edit((b) => { b.commands[i] = { ...b.commands[i], ros: { topic, type: b.commands[i].ros?.type ?? '' } }; }, `rt:${body.id}:${i}`)} />
                <TextInput mono value={c.ros?.type} placeholder="geometry_msgs/msg/PoseStamped" onChange={(type) => edit((b) => { b.commands[i] = { ...b.commands[i], ros: { topic: b.commands[i].ros?.topic ?? '', type } }; }, `rty:${body.id}:${i}`)} />
              </div>
            )}
          </div>
        ))}
        <button className="w-full flex items-center justify-center gap-1 py-1 rounded-md text-[11px] text-arsist-muted hover:text-arsist-text hover:bg-arsist-hover"
          onClick={() => edit((b) => { b.commands.push({ name: `command${b.commands.length + 1}`, confirm: 'always' }); })}>
          <Plus size={12} /> {t('spatial.body.addCommand')}
        </button>
      </Section>

      <Section title={t('spatial.body.safety')}>
        <div className="flex items-start gap-1.5 text-[11px] text-arsist-muted"><ShieldCheck size={13} className="text-arsist-accent shrink-0 mt-0.5" />{t('spatial.body.safetyHint')}</div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-arsist-muted">{t('spatial.body.stopIfHandWithin')}</span>
          <NumberInput value={body.safety?.stopIfHandWithin ?? 0.25} step={0.05} onChange={(v) => edit((b) => { b.safety = { ...b.safety, stopIfHandWithin: v }; })} />
          <span className="text-arsist-muted">m</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-arsist-muted">{t('spatial.body.maxPerSecond')}</span>
          <NumberInput value={body.safety?.maxPerSecond ?? 2} step={1} onChange={(v) => edit((b) => { b.safety = { ...b.safety, maxPerSecond: v }; })} />
        </div>
        <Field label={t('spatial.body.store')}>
          <TextInput mono value={body.store} placeholder={`body.${body.id}`} onChange={(store) => edit((b) => { b.store = store || undefined; }, `bs:${body.id}`)} />
        </Field>
      </Section>
    </div>
  );
}

function ArgsEditor({ args, onChange }: { args: Record<string, BodyArgType>; onChange: (a: Record<string, BodyArgType>) => void }) {
  const t = useT();
  const entries = Object.entries(args);
  return (
    <div className="space-y-1">
      {entries.map(([name, type], i) => (
        <div key={i} className="flex gap-1 items-center">
          <TextInput mono value={name} onChange={(n) => {
            const next: Record<string, BodyArgType> = {};
            entries.forEach(([k, v], j) => { next[j === i ? n : k] = v; });
            onChange(next);
          }} />
          <Select<BodyArgType> value={type} className="!w-24" options={ARG_TYPES.map((a) => ({ value: a, label: a }))} onChange={(v) => onChange({ ...args, [name]: v })} />
          <button className="btn-icon !p-1" onClick={() => { const next = { ...args }; delete next[name]; onChange(next); }}><Trash2 size={11} /></button>
        </div>
      ))}
      <button className="text-[10px] text-arsist-muted hover:text-arsist-text flex items-center gap-0.5" onClick={() => onChange({ ...args, [`arg${entries.length + 1}`]: 'number' })}>
        <Plus size={10} /> {t('spatial.body.addArg')}
      </button>
    </div>
  );
}
