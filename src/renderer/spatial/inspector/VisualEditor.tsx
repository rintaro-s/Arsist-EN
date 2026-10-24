/**
 * 物の見た目 (visual) の編集。種類ごとに必要な項目だけを出す。
 * パネルの中身は縦に並ぶ項目の一覧 (PanelItemsEditor)。
 */
import { ArrowDown, ArrowUp, FolderOpen, Plus, Trash2 } from 'lucide-react';
import type { PanelItem, ShapeKind, ThingVisual, Vec2 } from '../../../shared/layster/spatial/types';
import type { ImportAssetRequest } from '../../../shared/layster/spatial/ipc';
import { useT } from '../../i18n';
import { spatialApi } from '../api';
import { useSpatialStore } from '../store';
import { Field, NumberInput, Select, TextInput, Toggle, Vec3Input } from './fields';

export function VisualEditor({ value, onChange }: { value: ThingVisual; onChange: (v: ThingVisual) => void }) {
  const t = useT();
  switch (value.kind) {
    case 'shape':
      return (
        <div className="space-y-2">
          <Field label={t('spatial.visual.shape')}>
            <Select<ShapeKind>
              value={value.shape}
              options={(['cube', 'sphere', 'cylinder', 'capsule', 'quad'] as const).map((s) => ({ value: s, label: t(`spatial.visual.shape.${s}`) }))}
              onChange={(shape) => onChange({ ...value, shape })}
            />
          </Field>
          <Field label={t('spatial.visual.size')}><Vec3Input value={value.size} onChange={(size) => onChange({ ...value, size })} step={0.01} /></Field>
          <div className="flex gap-2">
            <Field label={t('spatial.visual.color')}><ColorInput value={value.color} onChange={(color) => onChange({ ...value, color })} /></Field>
            <Field label={t('spatial.visual.opacity')}><NumberInput value={value.opacity ?? 1} step={0.1} min={0} max={1} onChange={(o) => onChange({ ...value, opacity: o })} /></Field>
          </div>
        </div>
      );
    case 'model':
      return (
        <div className="space-y-2">
          <FileField label={t('spatial.visual.modelFile')} kind="model" value={value.file} onChange={(file) => onChange({ ...value, file })} />
          <Field label={t('spatial.visual.height')} hint={t('spatial.visual.heightHint')}>
            <NumberInput value={value.height} step={0.05} onChange={(height) => onChange({ ...value, height })} />
          </Field>
        </div>
      );
    case 'character':
      return (
        <div className="space-y-2">
          <FileField label={t('spatial.visual.vrmFile')} kind="character" value={value.file} onChange={(file) => onChange({ ...value, file })} />
          <div className="flex gap-2">
            <Field label={t('spatial.visual.height')}><NumberInput value={value.height ?? 1.5} step={0.05} onChange={(height) => onChange({ ...value, height })} /></Field>
            <Field label={t('spatial.visual.animation')}><TextInput value={value.animation} placeholder="Idle" onChange={(animation) => onChange({ ...value, animation: animation || undefined })} /></Field>
          </div>
          <Toggle checked={value.blink !== false} onChange={(blink) => onChange({ ...value, blink })} label={t('spatial.visual.blink')} />
          <Toggle checked={value.breathe !== false} onChange={(breathe) => onChange({ ...value, breathe })} label={t('spatial.visual.breathe')} />
          <Field label={t('spatial.visual.lookAtUser')}>
            <Select
              value={value.lookAtUser ?? 'nearby'}
              options={(['off', 'nearby', 'always'] as const).map((l) => ({ value: l, label: t(`spatial.visual.lookAtUser.${l}`) }))}
              onChange={(lookAtUser) => onChange({ ...value, lookAtUser })}
            />
          </Field>
        </div>
      );
    case 'panel':
      return (
        <div className="space-y-2">
          <Field label={t('spatial.visual.panelSize')} hint={t('spatial.visual.panelSizeHint', { w: Math.round(value.size[0] * (value.ppm ?? 1000)), h: Math.round(value.size[1] * (value.ppm ?? 1000)) })}>
            <SizeInput value={value.size} onChange={(size) => onChange({ ...value, size })} />
          </Field>
          <div className="flex gap-2">
            <Field label={t('spatial.visual.background')}><ColorInput value={value.background ?? '#1E1E28E6'} onChange={(background) => onChange({ ...value, background })} /></Field>
            <Field label={t('spatial.visual.padding')}><NumberInput value={value.padding ?? 24} step={4} onChange={(padding) => onChange({ ...value, padding })} /></Field>
          </div>
          <PanelItemsEditor items={value.items} onChange={(items) => onChange({ ...value, items })} />
        </div>
      );
    case 'label':
      return (
        <div className="space-y-2">
          <Field label={t('spatial.visual.text')}><TextInput value={value.text} onChange={(text) => onChange({ ...value, text })} /></Field>
          <div className="flex gap-2">
            <Field label={t('spatial.visual.textHeight')}><NumberInput value={value.height ?? 0.04} step={0.005} onChange={(height) => onChange({ ...value, height })} /></Field>
            <Field label={t('spatial.visual.color')}><ColorInput value={value.color ?? '#FFFFFF'} onChange={(color) => onChange({ ...value, color })} /></Field>
          </div>
        </div>
      );
    case 'marker':
      return <div className="text-[11px] text-arsist-muted">{t('spatial.visual.markerHint')}</div>;
  }
}

function SizeInput({ value, onChange }: { value: Vec2; onChange: (v: Vec2) => void }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <NumberInput value={value[0]} step={0.05} onChange={(w) => onChange([w ?? 0.1, value[1]])} />
      <span className="text-arsist-muted">×</span>
      <NumberInput value={value[1]} step={0.05} onChange={(h) => onChange([value[0], h ?? 0.1])} />
      <span className="text-arsist-muted">m</span>
    </div>
  );
}

/** '#RRGGBB' か '#RRGGBBAA'。色の選択は RRGGBB だけ (透明度は文字で)。 */
function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const rgb = /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : '#ffffff';
  return (
    <div className="flex items-center gap-1">
      <input type="color" className="w-7 h-6 rounded bg-transparent cursor-pointer" value={rgb}
        onChange={(e) => onChange(e.target.value.toUpperCase() + (value.length === 9 ? value.slice(7) : ''))} />
      <TextInput value={value} mono onChange={onChange} />
    </div>
  );
}

function FileField({ label, kind, value, onChange }: { label: string; kind: ImportAssetRequest['kind']; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const setStatus = useSpatialStore((s) => s.setStatus);
  const pick = async () => {
    const api = spatialApi();
    if (!api) { setStatus({ type: 'error', key: 'spatial.status.noBridge' }); return; }
    const r = await api.importAsset({ kind });
    if (r.success && r.file) onChange(r.file);
    else if (!r.cancelled) setStatus({ type: 'error', key: 'spatial.status.importFailed', params: { error: r.error ?? '' } });
  };
  return (
    <Field label={label}>
      <div className="flex gap-1">
        <TextInput value={value} mono placeholder={t('spatial.visual.filePlaceholder')} onChange={onChange} />
        <button className="btn-icon !p-1.5" title={t('spatial.visual.importFile')} onClick={() => void pick()}><FolderOpen size={14} /></button>
      </div>
    </Field>
  );
}

const ITEM_TYPES: PanelItem['type'][] = ['text', 'button', 'input', 'image', 'row', 'space'];

function newItem(type: PanelItem['type'], n: number): PanelItem {
  switch (type) {
    case 'text': return { type, id: `text${n}`, text: 'Text', size: 32 };
    case 'button': return { type, id: `button${n}`, text: 'OK', size: 32 };
    case 'input': return { type, id: `input${n}`, bind: `input${n}`, placeholder: '' };
    case 'image': return { type, file: '', height: 120 };
    case 'row': return { type, items: [{ type: 'button', id: `a${n}`, text: 'A' }, { type: 'button', id: `b${n}`, text: 'B' }], gap: 16 };
    case 'space': return { type, height: 16 };
  }
}

export function PanelItemsEditor({ items, onChange, nested }: { items: PanelItem[]; onChange: (items: PanelItem[]) => void; nested?: boolean }) {
  const t = useT();
  const replace = (i: number, item: PanelItem) => onChange(items.map((x, j) => (j === i ? item : x)));
  return (
    <div className="space-y-1.5">
      {!nested && <div className="text-[11px] text-arsist-muted">{t('spatial.panel.items')}</div>}
      {items.map((item, i) => (
        <div key={i} className="rounded bg-arsist-bg/60 p-1.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-arsist-accent">{t(`spatial.panel.type.${item.type}`)}</span>
            <div className="flex">
              <button className="btn-icon !p-0.5" disabled={i === 0} onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }}><ArrowUp size={11} /></button>
              <button className="btn-icon !p-0.5" disabled={i === items.length - 1} onClick={() => { const n = [...items]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; onChange(n); }}><ArrowDown size={11} /></button>
              <button className="btn-icon !p-0.5" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={11} /></button>
            </div>
          </div>
          <ItemFields item={item} onChange={(x) => replace(i, x)} />
        </div>
      ))}
      <div className="flex flex-wrap gap-1">
        {ITEM_TYPES.filter((ty) => !nested || ty !== 'row').map((ty) => (
          <button key={ty} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-arsist-hover text-arsist-muted hover:text-arsist-text"
            onClick={() => onChange([...items, newItem(ty, items.length + 1)])}>
            <Plus size={10} />{t(`spatial.panel.type.${ty}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ItemFields({ item, onChange }: { item: PanelItem; onChange: (item: PanelItem) => void }) {
  const t = useT();
  switch (item.type) {
    case 'text':
      return (
        <div className="space-y-1">
          <TextInput value={item.text} onChange={(text) => onChange({ ...item, text })} placeholder={t('spatial.panel.text')} />
          <div className="flex gap-1 items-center text-[10px] text-arsist-muted">
            id <TextInput value={item.id} mono onChange={(id) => onChange({ ...item, id: id || undefined })} />
            px <NumberInput value={item.size ?? 32} step={2} onChange={(size) => onChange({ ...item, size })} width="w-14" />
            <Select value={item.align ?? 'left'} className="!w-20"
              options={(['left', 'center', 'right'] as const).map((a) => ({ value: a, label: t(`spatial.panel.align.${a}`) }))}
              onChange={(align) => onChange({ ...item, align })} />
          </div>
          <div className="flex gap-1 items-center text-[10px] text-arsist-muted">
            {t('spatial.panel.bind')} <TextInput value={item.bind} mono placeholder="store key" onChange={(bind) => onChange({ ...item, bind: bind || undefined })} />
            {t('spatial.panel.reveal')} <NumberInput value={item.reveal} step={5} width="w-14" onChange={(reveal) => onChange({ ...item, reveal })} />
          </div>
        </div>
      );
    case 'button':
      return (
        <div className="space-y-1">
          <TextInput value={item.text} onChange={(text) => onChange({ ...item, text })} placeholder={t('spatial.panel.label')} />
          <div className="flex gap-1 items-center text-[10px] text-arsist-muted">
            id <TextInput value={item.id} mono onChange={(id) => onChange({ ...item, id })} />
            {t('spatial.panel.event')} <TextInput value={item.event} mono placeholder={t('spatial.panel.eventDefault')} onChange={(event) => onChange({ ...item, event: event || undefined })} />
          </div>
        </div>
      );
    case 'input':
      return (
        <div className="flex gap-1 items-center text-[10px] text-arsist-muted">
          id <TextInput value={item.id} mono onChange={(id) => onChange({ ...item, id })} />
          {t('spatial.panel.bind')} <TextInput value={item.bind} mono onChange={(bind) => onChange({ ...item, bind })} />
        </div>
      );
    case 'image':
      return (
        <div className="flex gap-1 items-center text-[10px] text-arsist-muted">
          <TextInput value={item.file} mono placeholder="Assets/Images/x.png" onChange={(file) => onChange({ ...item, file })} />
          px <NumberInput value={item.height} step={10} width="w-14" onChange={(height) => onChange({ ...item, height: height ?? 100 })} />
        </div>
      );
    case 'row':
      return <PanelItemsEditor nested items={item.items} onChange={(items) => onChange({ ...item, items })} />;
    case 'space':
      return (
        <div className="flex gap-1 items-center text-[10px] text-arsist-muted">
          px <NumberInput value={item.height} step={4} onChange={(height) => onChange({ ...item, height: height ?? 0 })} />
        </div>
      );
  }
}
