/**
 * Mind (AI) のインスペクタ: どこで動くか・何を見せるか・何を返してよいか・いつ走るか。
 * 鍵は名前だけを IR に書き、値はここから main に渡すだけ (画面の状態にも IR にも残さない)。
 */
import { useEffect, useState } from 'react';
import { BrainCircuit, KeyRound, Play } from 'lucide-react';
import type { ActionKind, Mind, MindProtocol, MindRole, MindWhere, SpatialProject } from '../../../shared/layster/spatial/types';
import { ACTION_KINDS } from '../../../shared/layster/spatial/types';
import { useT } from '../../i18n';
import { spatialApi } from '../api';
import { useSpatialStore } from '../store';
import { renameRefs } from '../refs';
import { Chips, Field, JsonInput, NumberInput, Section, Select, TextArea, TextInput, Toggle } from './fields';
import { ItemHeader } from './ItemHeader';
import { WordPicker } from './targets';

export function MindInspector({ project, mind }: { project: SpatialProject; mind: Mind }) {
  const t = useT();
  const update = useSpatialStore((s) => s.update);
  const setSelection = useSpatialStore((s) => s.setSelection);
  const setBottomTab = useSpatialStore((s) => s.setBottomTab);
  const edit = (fn: (m: Mind) => void, coalesce?: string) => update((p) => {
    const m = p.minds.find((x) => x.id === mind.id);
    if (m) fn(m);
  }, coalesce);
  const o = mind.observe ?? {};

  return (
    <div>
      <ItemHeader
        icon={<BrainCircuit size={12} />}
        kindLabel={t(`spatial.mind.role.${mind.role}`)}
        id={mind.id}
        name={mind.name}
        taken={project.minds.map((m) => m.id)}
        onRename={(id) => { update((p) => { renameRefs(p, 'mind', mind.id, id); const m = p.minds.find((x) => x.id === mind.id); if (m) m.id = id; }); setSelection({ kind: 'mind', id }); }}
        onName={(name) => edit((m) => { m.name = name || undefined; }, `name:${mind.id}`)}
        onDelete={() => { update((p) => { p.minds = p.minds.filter((m) => m.id !== mind.id); }); setSelection(null); }}
      />

      <button className="btn btn-secondary w-full justify-center !py-1 text-xs mb-3" onClick={() => setBottomTab('mind')}>
        <Play size={12} /> {t('spatial.mind.openIO')}
      </button>

      <Section title={t('spatial.mind.connection')}>
        <div className="grid grid-cols-2 gap-1.5">
          <Field label={t('spatial.mind.role')}>
            <Select<MindRole> value={mind.role} options={(['decide', 'converse', 'perceive', 'predict', 'act'] as const).map((r) => ({ value: r, label: t(`spatial.mind.role.${r}`) }))}
              onChange={(role) => edit((m) => { m.role = role; })} />
          </Field>
          <Field label={t('spatial.mind.where')}>
            <Select<MindWhere> value={mind.where} options={(['device', 'edge', 'cloud'] as const).map((w) => ({ value: w, label: t(`spatial.mind.where.${w}`) }))}
              onChange={(where) => edit((m) => { m.where = where; })} />
          </Field>
        </div>
        <Field label={t('spatial.mind.protocol')} hint={t(`spatial.mind.protocol.${mind.protocol}.hint`)}>
          <Select<MindProtocol> value={mind.protocol} options={(['openai-chat', 'layster'] as const).map((p) => ({ value: p, label: t(`spatial.mind.protocol.${p}`) }))}
            onChange={(protocol) => edit((m) => { m.protocol = protocol; })} />
        </Field>
        <Field label={t('spatial.mind.endpoint')} hint={t('spatial.mind.endpointHint')}>
          <TextInput mono value={mind.endpoint} onChange={(endpoint) => edit((m) => { m.endpoint = endpoint; }, `endpoint:${mind.id}`)} />
        </Field>
        {mind.protocol === 'openai-chat' && (
          <Field label={t('spatial.mind.model')}>
            <TextInput mono value={mind.model} placeholder="qwen3.5:9b" onChange={(model) => edit((m) => { m.model = model || undefined; }, `model:${mind.id}`)} />
          </Field>
        )}
        <SecretField mind={mind} onSecret={(secret) => edit((m) => {
          if (!secret) delete m.auth;
          else m.auth = { ...(m.auth ?? {}), secret };
        }, `secret:${mind.id}`)} />
      </Section>

      <Section title={t('spatial.mind.instructions')}>
        <TextArea rows={4} value={mind.instructions} onChange={(instructions) => edit((m) => { m.instructions = instructions; }, `instr:${mind.id}`)} />
      </Section>

      <Section title={t('spatial.mind.observe')}>
        <Field label={t('spatial.mind.frame')}>
          <Select value={o.frame ?? 'user'}
            options={[
              { value: 'user', label: t('spatial.frame.user') }, { value: 'world', label: t('spatial.frame.world') }, { value: 'head', label: t('spatial.frame.head') },
              ...project.bodies.map((b) => ({ value: `body:${b.id}`, label: t('spatial.frame.body', { id: b.id }) })),
            ]}
            onChange={(frame) => edit((m) => { m.observe = { ...m.observe, frame: frame as Mind['observe']['frame'] }; })} />
        </Field>
        <Toggle checked={!!o.world} label={t('spatial.mind.observe.world')} onChange={(on) => edit((m) => {
          if (on) m.observe.world = { within: 3, max: 20 }; else delete m.observe.world;
        })} />
        {o.world && (
          <div className="pl-5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              <span className="text-arsist-muted">{t('spatial.mind.observe.within')}</span>
              <NumberInput value={o.world.within} onChange={(within) => edit((m) => { m.observe.world = { ...m.observe.world, within }; })} width="w-14" />
              <span className="text-arsist-muted">m · {t('spatial.mind.observe.max')}</span>
              <NumberInput value={o.world.max} step={1} onChange={(max) => edit((m) => { m.observe.world = { ...m.observe.world, max }; })} width="w-14" />
            </div>
            <div className="text-[11px] text-arsist-muted">{t('spatial.mind.observe.onlyWords')}</div>
            <WordPicker value={o.world.is} onChange={(is) => edit((m) => { m.observe.world = { ...m.observe.world, is }; })} />
          </div>
        )}
        <Toggle checked={!!o.things} label={t('spatial.mind.observe.things')} onChange={(on) => edit((m) => { if (on) m.observe.things = true; else delete m.observe.things; })} />
        <div className="text-[11px] text-arsist-muted">{t('spatial.mind.observe.user')}</div>
        <Chips<'head' | 'hands' | 'gaze'> options={(['head', 'hands', 'gaze'] as const).map((u) => ({ value: u, label: t(`spatial.mind.observe.user.${u}`) }))}
          value={o.user ?? []} onChange={(user) => edit((m) => { if (user.length) m.observe.user = user; else delete m.observe.user; })} />
        <Toggle checked={!!o.camera} label={t('spatial.mind.observe.camera')} onChange={(on) => edit((m) => { if (on) m.observe.camera = { width: 512 }; else delete m.observe.camera; })} />
        {o.camera && (
          <div className="pl-5 flex items-center gap-1.5 text-xs">
            <span className="text-arsist-muted">{t('spatial.mind.observe.cameraWidth')}</span>
            <NumberInput value={o.camera.width} step={64} onChange={(width) => edit((m) => { m.observe.camera = { ...m.observe.camera!, width: width ?? 512 }; })} />
            <span className="text-arsist-muted">px</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-arsist-muted">{t('spatial.mind.observe.events')}</span>
          <NumberInput value={o.events} step={1} onChange={(events) => edit((m) => { if (events) m.observe.events = events; else delete m.observe.events; })} />
        </div>
        <Field label={t('spatial.mind.observe.store')}>
          <TextInput mono value={(o.store ?? []).join(', ')} placeholder="study., mode" onChange={(text) => edit((m) => {
            const keys = text.split(',').map((k) => k.trim()).filter(Boolean);
            if (keys.length) m.observe.store = keys; else delete m.observe.store;
          }, `store:${mind.id}`)} />
        </Field>
      </Section>

      <Section title={t('spatial.mind.output')}>
        <div className="text-[11px] text-arsist-muted">{t('spatial.mind.output.actions')}</div>
        <Chips<ActionKind> options={ACTION_KINDS.map((k) => ({ value: k, label: t(`spatial.action.${k}`) }))}
          value={mind.output.actions ?? []} onChange={(actions) => edit((m) => { m.output = { ...m.output, actions }; })} />
        <Toggle checked={!!mind.output.beliefs} label={t('spatial.mind.output.beliefs')} onChange={(beliefs) => edit((m) => { m.output = { ...m.output, beliefs }; })} />
        <Field label={t('spatial.mind.output.text')}>
          <TextInput mono value={mind.output.text} placeholder="mind.helper.text" onChange={(text) => edit((m) => { m.output = { ...m.output, text: text || undefined }; }, `otext:${mind.id}`)} />
        </Field>
      </Section>

      <Section title={t('spatial.mind.run')}>
        <Select value={mind.run.on} options={(['manual', 'interval', 'change', 'event'] as const).map((r) => ({ value: r, label: t(`spatial.mind.run.${r}`) }))}
          onChange={(on) => edit((m) => { m.run = { ...m.run, on, ...(on === 'interval' && !m.run.everyMs ? { everyMs: 3000 } : {}) }; })} />
        {mind.run.on === 'interval' && (
          <div className="flex items-center gap-1.5 text-xs"><span className="text-arsist-muted">{t('spatial.mind.run.everyMs')}</span>
            <NumberInput value={mind.run.everyMs} step={500} onChange={(everyMs) => edit((m) => { m.run = { ...m.run, everyMs }; })} width="w-20" /><span className="text-arsist-muted">ms</span></div>
        )}
        {mind.run.on === 'event' && (
          <Field label={t('spatial.mind.run.event.label')}><TextInput mono value={mind.run.event} onChange={(event) => edit((m) => { m.run = { ...m.run, event }; }, `ev:${mind.id}`)} /></Field>
        )}
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          <span className="text-arsist-muted">{t('spatial.mind.run.minGap')}</span>
          <NumberInput value={mind.run.minGapMs} step={250} width="w-20" onChange={(minGapMs) => edit((m) => { m.run = { ...m.run, minGapMs }; })} />
          <span className="text-arsist-muted">{t('spatial.mind.run.timeout')}</span>
          <NumberInput value={mind.run.timeoutMs} step={1000} width="w-20" onChange={(timeoutMs) => edit((m) => { m.run = { ...m.run, timeoutMs }; })} />
          <span className="text-arsist-muted">ms</span>
        </div>
      </Section>

      <Section title={t('spatial.mind.advanced')} defaultOpen={false}>
        <Field label={t('spatial.mind.extra')} hint={t('spatial.mind.extraHint')}>
          <JsonInput value={mind.extra} onChange={(extra) => edit((m) => { if (extra && typeof extra === 'object') m.extra = extra as Record<string, unknown>; else delete m.extra; })} />
        </Field>
        <Field label={t('spatial.mind.onFailUse')}>
          <Select value={mind.onFail?.use ?? ''} options={[{ value: '', label: '—' }, ...project.minds.filter((m) => m.id !== mind.id).map((m) => ({ value: m.id, label: m.name || m.id }))]}
            onChange={(use) => edit((m) => { m.onFail = { ...m.onFail, use: use || undefined }; if (!m.onFail.use && !m.onFail.say) delete m.onFail; })} />
        </Field>
        <Field label={t('spatial.mind.onFailSay')}>
          <TextInput value={mind.onFail?.say} onChange={(say) => edit((m) => { m.onFail = { ...m.onFail, say: say || undefined }; if (!m.onFail.use && !m.onFail.say) delete m.onFail; }, `fail:${mind.id}`)} />
        </Field>
      </Section>
    </div>
  );
}

/** 鍵の名前 (IR) と値 (main にだけ渡す)。 */
function SecretField({ mind, onSecret }: { mind: Mind; onSecret: (name: string | undefined) => void }) {
  const t = useT();
  const [names, setNames] = useState<string[]>([]);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const api = spatialApi();
  useEffect(() => {
    if (!api) return;
    api.secrets({ op: 'list' }).then((r) => setNames(r.names ?? [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const name = mind.auth?.secret;
  const stored = !!name && names.includes(name);
  return (
    <Field label={t('spatial.mind.secret')} hint={t('spatial.mind.secretHint')}>
      <div className="flex gap-1">
        <TextInput mono value={name} placeholder="GROQ_KEY" onChange={(v) => onSecret(v || undefined)} />
        <span className={`shrink-0 self-center text-[10px] px-1.5 rounded ${stored ? 'bg-arsist-success/20 text-arsist-success' : 'bg-arsist-hover text-arsist-muted'}`}>
          {name ? (stored ? t('spatial.mind.secretStored') : t('spatial.mind.secretMissing')) : '—'}
        </span>
      </div>
      {name && api && (
        <div className="flex gap-1 mt-1">
          <TextInput type="password" value={value} placeholder={t('spatial.mind.secretValue')} onChange={setValue} />
          <button className="btn btn-secondary !px-2 !py-1 text-xs shrink-0" disabled={!value || busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.secrets({ op: 'set', name, value });
              setNames(r.names ?? []);
            } finally {
              setValue('');
              setBusy(false);
            }
          }}>
            <KeyRound size={12} /> {t('spatial.mind.secretSave')}
          </button>
        </div>
      )}
    </Field>
  );
}
