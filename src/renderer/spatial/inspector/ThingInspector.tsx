/** 物 (thing) のインスペクタ: 見た目・置き方・この空間での結果。 */
import { Box } from 'lucide-react';
import type { SpatialProject, Thing } from '../../../shared/layster/spatial/types';
import { useT, useI18n } from '../../i18n';
import { uniqueId, useSpatialStore } from '../store';
import { renameRefs } from '../refs';
import { useActiveSolve } from '../useSolve';
import { describeRule } from '../describe';
import { ruleColor } from '../lab/ThingMeshes';
import { Section, Select, Toggle } from './fields';
import { ItemHeader } from './ItemHeader';
import { VisualEditor } from './VisualEditor';
import { PlacementEditor } from './PlacementEditor';

export function ThingInspector({ project, thing }: { project: SpatialProject; thing: Thing }) {
  const t = useT();
  const { lang } = useI18n();
  const update = useSpatialStore((s) => s.update);
  const setSelection = useSpatialStore((s) => s.setSelection);
  const solve = useActiveSolve();
  const result = solve?.results.find((r) => r.thing === thing.id);
  const edit = (fn: (x: Thing) => void, coalesce?: string) => update((p) => {
    const x = p.things.find((y) => y.id === thing.id);
    if (x) fn(x);
  }, coalesce);

  return (
    <div>
      <ItemHeader
        icon={<Box size={12} />}
        kindLabel={t(`spatial.thing.kind.${thing.visual.kind}`)}
        id={thing.id}
        name={thing.name}
        taken={project.things.map((x) => x.id)}
        onRename={(id) => {
          update((p) => {
            const x = p.things.find((y) => y.id === thing.id);
            if (!x) return;
            renameRefs(p, 'thing', thing.id, id);
            x.id = id;
          });
          setSelection({ kind: 'thing', id });
        }}
        onName={(name) => edit((x) => { x.name = name || undefined; }, `name:${thing.id}`)}
        onDuplicate={() => {
          const id = uniqueId(thing.id, project.things.map((x) => x.id));
          update((p) => { p.things.push({ ...structuredClone(thing), id, name: id }); });
          setSelection({ kind: 'thing', id });
        }}
        onDelete={() => {
          update((p) => { p.things = p.things.filter((x) => x.id !== thing.id); });
          setSelection(null);
        }}
      />

      {result && (
        <div className="mb-3 px-2 py-1.5 rounded-md bg-arsist-bg/60 text-[11px] flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: ruleColor(result.rule) }} />
          <span className="text-arsist-text">{describeRule(t, result.rule)}</span>
          <span className="text-arsist-muted">· {solve?.space.name[lang]}</span>
        </div>
      )}

      <Section title={t('spatial.thing.place')}>
        <PlacementEditor
          project={project}
          thingId={thing.id}
          value={thing.place}
          onChange={(place) => edit((x) => { x.place = place; }, `place:${thing.id}`)}
        />
      </Section>

      <Section title={t('spatial.thing.visual')}>
        <VisualEditor value={thing.visual} onChange={(visual) => edit((x) => { x.visual = visual; }, `visual:${thing.id}`)} />
      </Section>

      <Section title={t('spatial.thing.options')} defaultOpen={false}>
        <Toggle checked={thing.visibleAtStart !== false} label={t('spatial.thing.visibleAtStart')}
          onChange={(v) => edit((x) => { if (v) delete x.visibleAtStart; else x.visibleAtStart = false; })} />
        <Toggle checked={!!thing.grabbable} label={t('spatial.thing.grabbable')}
          onChange={(v) => edit((x) => { if (v) x.grabbable = true; else delete x.grabbable; })} />
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-arsist-muted">{t('spatial.thing.occlusion')}</span>
          <Select value={thing.occlusion ?? 'auto'}
            options={[{ value: 'auto', label: t('spatial.thing.occlusion.auto') }, { value: 'off', label: t('spatial.thing.occlusion.off') }]}
            onChange={(o) => edit((x) => { if (o === 'auto') delete x.occlusion; else x.occlusion = o; })} />
        </div>
      </Section>
    </div>
  );
}
