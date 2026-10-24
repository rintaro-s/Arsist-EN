/**
 * スクリプト。インスペクタにはきっかけと有効/無効、真ん中 (ScriptPane) にコードと早見表 (world.* と共有の名前)。
 */
import { useRef } from 'react';
import { BookOpen, FileCode } from 'lucide-react';
import type { SpatialProject, SpatialScript } from '../../../shared/layster/spatial/types';
import { SPATIAL_SCRIPT_API, SPATIAL_SCRIPT_RULES_TEXT } from '../../../shared/layster/spatial/scriptApi';
import { useT, useI18n } from '../../i18n';
import { useSpatialStore } from '../store';
import { Field, NumberInput, Section, Select, TextInput, Toggle } from './fields';
import { ItemHeader } from './ItemHeader';

type TriggerType = SpatialScript['trigger']['type'];

export function ScriptInspector({ project, script }: { project: SpatialProject; script: SpatialScript }) {
  const t = useT();
  const update = useSpatialStore((s) => s.update);
  const setSelection = useSpatialStore((s) => s.setSelection);
  const edit = (fn: (x: SpatialScript) => void, coalesce?: string) => update((p) => {
    const x = p.scripts.find((y) => y.id === script.id);
    if (x) fn(x);
  }, coalesce);
  return (
    <div>
      <ItemHeader
        icon={<FileCode size={12} />}
        kindLabel={t('spatial.outline.scripts')}
        id={script.id}
        name={script.name}
        taken={project.scripts.map((x) => x.id)}
        onRename={(id) => { edit((x) => { x.id = id; }); setSelection({ kind: 'script', id }); }}
        onName={(name) => edit((x) => { x.name = name; }, `name:${script.id}`)}
        onDelete={() => { update((p) => { p.scripts = p.scripts.filter((x) => x.id !== script.id); }); setSelection(null); }}
      />
      <Toggle checked={script.enabled} label={t('spatial.script.enabled')} onChange={(enabled) => edit((x) => { x.enabled = enabled; })} />
      <Section title={t('spatial.script.trigger')}>
        <Select<TriggerType> value={script.trigger.type}
          options={(['onStart', 'onUpdate', 'interval', 'event'] as const).map((k) => ({ value: k, label: t(`spatial.script.trigger.${k}`) }))}
          onChange={(type) => edit((x) => { x.trigger = type === 'interval' ? { type, value: 1000 } : type === 'event' ? { type, value: '' } : { type }; })} />
        {script.trigger.type === 'interval' && (
          <div className="flex items-center gap-1.5 text-xs">
            <NumberInput value={Number(script.trigger.value ?? 1000)} step={100} width="w-24" onChange={(v) => edit((x) => { x.trigger = { type: 'interval', value: v ?? 1000 }; })} />
            <span className="text-arsist-muted">ms</span>
          </div>
        )}
        {script.trigger.type === 'event' && (
          <Field label={t('spatial.script.eventName')} hint={t('spatial.script.eventHint')}>
            <TextInput mono value={String(script.trigger.value ?? '')} onChange={(v) => edit((x) => { x.trigger = { type: 'event', value: v }; }, `trig:${script.id}`)} />
          </Field>
        )}
      </Section>
    </div>
  );
}

/** 真ん中: コード (タブで字下げ) と早見表。 */
export function ScriptPane({ script }: { script: SpatialScript }) {
  const t = useT();
  const { lang } = useI18n();
  const update = useSpatialStore((s) => s.update);
  const ref = useRef<HTMLTextAreaElement>(null);
  const setCode = (code: string) => update((p) => {
    const x = p.scripts.find((y) => y.id === script.id);
    if (x) x.code = code;
  }, `code:${script.id}`);
  return (
    <div className="w-full h-full flex min-h-0">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-3 py-1.5 text-xs text-arsist-muted hairline-b flex items-center gap-1.5 bg-arsist-surface">
          <FileCode size={12} className="text-arsist-accent" /> {script.name || script.id}
        </div>
        <textarea
          ref={ref}
          spellCheck={false}
          className="flex-1 w-full p-3 font-mono text-xs bg-arsist-bg text-arsist-text resize-none focus:outline-none leading-relaxed"
          value={script.code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Tab') return;
            e.preventDefault();
            const ta = e.currentTarget;
            const { selectionStart: s, selectionEnd: end } = ta;
            setCode(script.code.slice(0, s) + '  ' + script.code.slice(end));
            requestAnimationFrame(() => { if (ref.current) ref.current.selectionStart = ref.current.selectionEnd = s + 2; });
          }}
        />
      </div>
      <div className="w-80 shrink-0 overflow-y-auto bg-arsist-surface hairline-l p-3 text-xs">
        <div className="flex items-center gap-1.5 font-medium mb-2"><BookOpen size={12} className="text-arsist-accent" />{t('spatial.script.reference')}</div>
        <pre className="whitespace-pre-wrap text-[10px] text-arsist-muted mb-3 font-sans">{SPATIAL_SCRIPT_RULES_TEXT}</pre>
        {SPATIAL_SCRIPT_API.map((section) => (
          <div key={section.name} className="mb-3">
            <div className="font-mono text-[11px] mb-0.5" style={{ color: section.color }}>{section.name}</div>
            <div className="text-[10px] text-arsist-muted mb-1">{section[lang]}</div>
            {section.entries.map((e) => (
              <div key={e.sig} className="mb-1.5">
                <code className="block text-[10px] font-mono text-arsist-text break-all">{e.sig}</code>
                <div className="text-[10px] text-arsist-muted">{e[lang]}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
