/**
 * 左の一覧: 物・Mind・体・規則・スクリプト・記録・設定・試す空間。
 * 物の点の色は、今の空間でどの置き方で置けたか (Space Lab と同じ色)。赤い数は問題の数。
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  BrainCircuit, Bot, ChevronDown, ChevronRight, CircleDot, Disc3, FileCode, Gauge, Image as ImageIcon, LayoutPanelTop,
  Map as MapIcon, PersonStanding, Plus, Settings2, Shapes, Tag, Workflow,
} from 'lucide-react';
import type { SpatialProject, Thing } from '../../shared/layster/spatial/types';
import { newBody, newMind, newRule, newScript, newThing, type ThingTemplate } from '../../shared/layster/spatial/defaults';
import { validateSpatialProject } from '../../shared/layster/spatial/validate';
import { useT } from '../i18n';
import { uniqueId, useSpatialStore, type SpatialSelection } from './store';
import { useActiveSolve } from './useSolve';
import { ruleColor } from './lab/ThingMeshes';
import { describeWhen } from './describe';

const THING_TEMPLATES: Array<{ template: ThingTemplate; icon: ReactNode }> = [
  { template: 'panel', icon: <LayoutPanelTop size={13} /> },
  { template: 'hud', icon: <Gauge size={13} /> },
  { template: 'label', icon: <Tag size={13} /> },
  { template: 'character', icon: <PersonStanding size={13} /> },
  { template: 'model', icon: <ImageIcon size={13} /> },
  { template: 'shape', icon: <Shapes size={13} /> },
  { template: 'marker', icon: <CircleDot size={13} /> },
];

export function thingIcon(thing: Thing): ReactNode {
  switch (thing.visual.kind) {
    case 'panel': return thing.place.mode === 'head' ? <Gauge size={13} /> : <LayoutPanelTop size={13} />;
    case 'label': return <Tag size={13} />;
    case 'character': return <PersonStanding size={13} />;
    case 'model': return <ImageIcon size={13} />;
    case 'shape': return <Shapes size={13} />;
    case 'marker': return <CircleDot size={13} />;
  }
}

/** 問題の場所 'things[quiz].place' → 'things:quiz' ごとの error の数。 */
function useErrorCounts(project: SpatialProject | null): Map<string, number> {
  return useMemo(() => {
    const counts = new Map<string, number>();
    if (!project) return counts;
    for (const p of validateSpatialProject(project)) {
      if (p.level !== 'error') continue;
      const m = /^(things|minds|bodies|rules|scripts)\[([^\]]+)\]/.exec(p.path);
      const key = m ? `${m[1]}:${m[2]}` : p.path.split('.')[0];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [project]);
}

export function Outline() {
  const t = useT();
  const project = useSpatialStore((s) => s.project);
  const selection = useSpatialStore((s) => s.selection);
  const setSelection = useSpatialStore((s) => s.setSelection);
  const update = useSpatialStore((s) => s.update);
  const solve = useActiveSolve();
  const errors = useErrorCounts(project);
  const [menu, setMenu] = useState<'thing' | 'mind' | null>(null);
  if (!project) return null;

  const isSel = (s: SpatialSelection) => JSON.stringify(s) === JSON.stringify(selection);
  const ruleOf = (id: string) => solve?.results.find((r) => r.thing === id)?.rule;

  const addThing = (template: ThingTemplate) => {
    const id = uniqueId(template, project.things.map((x) => x.id));
    update((p) => { p.things.push(newThing(template, id)); });
    setSelection({ kind: 'thing', id });
    setMenu(null);
  };
  const addMind = (protocol: 'openai-chat' | 'layster') => {
    const id = uniqueId(protocol === 'layster' ? 'world-model' : 'helper', project.minds.map((x) => x.id));
    update((p) => { p.minds.push(newMind(id, protocol, protocol === 'layster' ? 'predict' : 'decide')); });
    setSelection({ kind: 'mind', id });
    setMenu(null);
  };
  const addBody = () => {
    const id = uniqueId('arm', project.bodies.map((x) => x.id));
    const baseId = uniqueId(`${id}-base`, project.things.map((x) => x.id));
    update((p) => {
      const marker = newThing('marker', baseId);
      // 根元の目印は、机の上 (無ければ目の前の床から 0.75 m)
      marker.place = { on: { has: ['support'], not: ['bed', 'floor'] }, distance: [0.3, 1.5], facing: 'user', fallback: [{ at: { frame: 'user', at: [0.3, 0.75, 0.6] } }] };
      p.things.push(marker);
      p.bodies.push(newBody(id, baseId));
    });
    setSelection({ kind: 'body', id });
  };
  const addRule = () => {
    const id = uniqueId('rule', project.rules.map((x) => x.id));
    update((p) => { p.rules.push(newRule(id)); });
    setSelection({ kind: 'rule', id });
  };
  const addScript = () => {
    const id = uniqueId('script', project.scripts.map((x) => x.id));
    update((p) => { p.scripts.push(newScript(id, id)); });
    setSelection({ kind: 'script', id });
  };

  return (
    <div className="h-full overflow-y-auto py-2 text-xs select-none">
      <Group title={t('spatial.outline.things')} count={project.things.length} onAdd={() => setMenu(menu === 'thing' ? null : 'thing')}>
        {menu === 'thing' && (
          <AddMenu>
            {THING_TEMPLATES.map(({ template, icon }) => (
              <AddMenuItem key={template} icon={icon} label={t(`spatial.template.${template}`)} hint={t(`spatial.template.${template}.hint`)} onClick={() => addThing(template)} />
            ))}
          </AddMenu>
        )}
        {project.things.map((x) => {
          const rule = ruleOf(x.id);
          return (
            <Item key={x.id} icon={thingIcon(x)} label={x.name || x.id} sub={x.name && x.name !== x.id ? x.id : undefined}
              selected={isSel({ kind: 'thing', id: x.id })} errors={errors.get(`things:${x.id}`)}
              dot={rule !== undefined ? ruleColor(rule) : undefined}
              onClick={() => setSelection({ kind: 'thing', id: x.id })} />
          );
        })}
      </Group>

      <Group title={t('spatial.outline.minds')} count={project.minds.length} onAdd={() => setMenu(menu === 'mind' ? null : 'mind')}>
        {menu === 'mind' && (
          <AddMenu>
            <AddMenuItem icon={<BrainCircuit size={13} />} label={t('spatial.template.mindChat')} hint={t('spatial.template.mindChat.hint')} onClick={() => addMind('openai-chat')} />
            <AddMenuItem icon={<Disc3 size={13} />} label={t('spatial.template.mindLayster')} hint={t('spatial.template.mindLayster.hint')} onClick={() => addMind('layster')} />
          </AddMenu>
        )}
        {project.minds.map((m) => (
          <Item key={m.id} icon={<BrainCircuit size={13} />} label={m.name || m.id} sub={`${t(`spatial.mind.where.${m.where}`)} · ${m.protocol}`}
            selected={isSel({ kind: 'mind', id: m.id })} errors={errors.get(`minds:${m.id}`)}
            onClick={() => setSelection({ kind: 'mind', id: m.id })} />
        ))}
      </Group>

      <Group title={t('spatial.outline.bodies')} count={project.bodies.length} onAdd={addBody}>
        {project.bodies.map((b) => (
          <Item key={b.id} icon={<Bot size={13} />} label={b.name || b.id} sub={b.link.protocol}
            selected={isSel({ kind: 'body', id: b.id })} errors={errors.get(`bodies:${b.id}`)}
            onClick={() => setSelection({ kind: 'body', id: b.id })} />
        ))}
      </Group>

      <Group title={t('spatial.outline.rules')} count={project.rules.length} onAdd={addRule}>
        {project.rules.map((r) => (
          <Item key={r.id} icon={<Workflow size={13} />} label={r.name || r.id} sub={describeWhen(t, r.when)}
            selected={isSel({ kind: 'rule', id: r.id })} errors={errors.get(`rules:${r.id}`)} muted={r.enabled === false}
            onClick={() => setSelection({ kind: 'rule', id: r.id })} />
        ))}
      </Group>

      <Group title={t('spatial.outline.scripts')} count={project.scripts.length} onAdd={addScript}>
        {project.scripts.map((s) => (
          <Item key={s.id} icon={<FileCode size={13} />} label={s.name || s.id} sub={t(`spatial.script.trigger.${s.trigger.type}`)}
            selected={isSel({ kind: 'script', id: s.id })} muted={!s.enabled}
            onClick={() => setSelection({ kind: 'script', id: s.id })} />
        ))}
      </Group>

      <Group title={t('spatial.outline.project')}>
        <Item icon={<Disc3 size={13} />} label={t('spatial.outline.recording')} sub={project.recording.enabled ? t('spatial.common.on') : t('spatial.common.off')}
          selected={isSel({ kind: 'recording' })} errors={errors.get('recording')} onClick={() => setSelection({ kind: 'recording' })} />
        <Item icon={<MapIcon size={13} />} label={t('spatial.outline.spaces')} sub={t('spatial.outline.spacesCount', { n: project.spaces.use.length })}
          selected={isSel({ kind: 'spaces' })} onClick={() => setSelection({ kind: 'spaces' })} />
        <Item icon={<Settings2 size={13} />} label={t('spatial.outline.settings')} selected={isSel({ kind: 'settings' })}
          errors={errors.get('app') ?? errors.get('layster')} onClick={() => setSelection({ kind: 'settings' })} />
      </Group>
    </div>
  );
}

function Group({ title, count, onAdd, children }: { title: string; count?: number; onAdd?: () => void; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between px-2 py-1 group">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-arsist-muted hover:text-arsist-text">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
          {count !== undefined && <span className="font-normal normal-case opacity-70">{count}</span>}
        </button>
        {onAdd && (
          <button onClick={onAdd} className="btn-icon !p-1" title={t('spatial.common.add')}><Plus size={13} /></button>
        )}
      </div>
      {open && <div className="px-1.5 space-y-px">{children}</div>}
    </div>
  );
}

function Item({ icon, label, sub, selected, onClick, dot, errors, muted }: {
  icon: ReactNode; label: string; sub?: string; selected: boolean; onClick: () => void; dot?: string; errors?: number; muted?: boolean;
}) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-left transition-colors ${selected ? 'bg-arsist-active text-arsist-accent' : 'hover:bg-arsist-hover text-arsist-text'} ${muted ? 'opacity-50' : ''}`}>
      <span className="shrink-0 opacity-80">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate">{label}</span>
        {sub && <span className="block truncate text-[10px] text-arsist-muted">{sub}</span>}
      </span>
      {errors ? <span className="shrink-0 text-[10px] px-1 rounded bg-arsist-error/20 text-arsist-error">{errors}</span> : null}
      {dot && <span className="shrink-0 w-2 h-2 rounded-full" style={{ background: dot }} />}
    </button>
  );
}

function AddMenu({ children }: { children: ReactNode }) {
  return <div className="mx-1.5 mb-1 p-1 rounded-md bg-arsist-bg/70 space-y-px">{children}</div>;
}

function AddMenuItem({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-start gap-2 px-2 py-1 rounded hover:bg-arsist-hover text-left">
      <span className="text-arsist-accent mt-0.5">{icon}</span>
      <span>
        <span className="block text-arsist-text">{label}</span>
        <span className="block text-[10px] text-arsist-muted leading-snug">{hint}</span>
      </span>
    </button>
  );
}

