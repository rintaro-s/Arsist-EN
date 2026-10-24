/**
 * インスペクタの小さな部品 (平らな見た目: 枠ではなく面の濃さと余白で分ける)。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function Section({ title, children, action, defaultOpen = true }: { title: string; children: ReactNode; action?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="hairline-b pb-3 mb-3 last:border-b-0">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-arsist-muted hover:text-arsist-text">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
        </button>
        {action}
      </div>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="block">
      <span className="block text-[11px] text-arsist-muted mb-0.5">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-arsist-muted/80 mt-0.5 leading-snug">{hint}</span>}
    </div>
  );
}

const BASE = 'px-2 py-1 bg-arsist-hover rounded text-xs text-arsist-text focus:outline-none focus:ring-1 focus:ring-arsist-accent/60';
const INPUT = `w-full ${BASE}`;

export function TextInput({ value, onChange, placeholder, mono, type = 'text' }: {
  value: string | undefined; onChange: (v: string) => void; placeholder?: string; mono?: boolean; type?: 'text' | 'password';
}) {
  return <input type={type} className={`${INPUT} ${mono ? 'font-mono' : ''}`} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function TextArea({ value, onChange, rows = 3, placeholder, mono }: { value: string | undefined; onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean }) {
  return <textarea className={`${INPUT} resize-y ${mono ? 'font-mono' : ''}`} rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** 数。打っている途中 ("0." や "-") は手元の文字のまま持ち、数として読めたときだけ返す。 */
export function NumberInput({ value, onChange, step = 0.1, min, max, width = 'w-16', placeholder }: {
  value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; max?: number; width?: string; placeholder?: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    if (value === undefined) { if (text !== '') setText(''); return; }
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number"
      className={`${BASE} ${width} shrink-0 font-mono`}
      value={text}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim() === '') { onChange(undefined); return; }
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

export function Vec3Input({ value, onChange, step = 0.05 }: { value: [number, number, number]; onChange: (v: [number, number, number]) => void; step?: number }) {
  return (
    <div className="flex gap-1">
      {(['x', 'y', 'z'] as const).map((axis, i) => (
        <div key={axis} className="flex items-center gap-0.5 flex-1">
          <span className="text-[10px] text-arsist-muted w-2">{axis}</span>
          <NumberInput width="w-full" step={step} value={value[i]} onChange={(n) => {
            const next = [...value] as [number, number, number];
            next[i] = n ?? 0;
            onChange(next);
          }} />
        </div>
      ))}
    </div>
  );
}

export function Select<T extends string>({ value, options, onChange, className }: {
  value: T | undefined; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; className?: string;
}) {
  return (
    <select className={`${INPUT} ${className ?? ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
      {value === undefined && <option value="" disabled>—</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-arsist-text cursor-pointer select-none">
      <input type="checkbox" className="accent-[rgb(var(--arsist-accent))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** いくつでも選べるチップ。 */
export function Chips<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string }>; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={`px-2 py-0.5 rounded text-[11px] transition-colors ${on ? 'bg-arsist-accent/25 text-arsist-accent' : 'bg-arsist-hover text-arsist-muted hover:text-arsist-text'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** カンマ区切りの言葉 → 配列。 */
export function WordsInput({ value, onChange, placeholder }: { value: string[] | undefined; onChange: (v: string[] | undefined) => void; placeholder?: string }) {
  const [text, setText] = useState((value ?? []).join(', '));
  useEffect(() => {
    const joined = (value ?? []).join(', ');
    if (splitWords(text).join(', ') !== joined) setText(joined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.join(',')]);
  return (
    <input className={INPUT} value={text} placeholder={placeholder} onChange={(e) => {
      setText(e.target.value);
      const words = splitWords(e.target.value);
      onChange(words.length ? words : undefined);
    }} />
  );
}

function splitWords(text: string): string[] {
  return text.split(/[,、\s]+/).map((w) => w.trim()).filter(Boolean);
}

/** チェックつきの条件の行: 上に見出し (語の切れ目で折り返す)、下に入力と単位を 1 行で。 */
export function CheckRow({ on, onToggle, label, children }: { on: boolean; onToggle: (on: boolean) => void; label: string; children?: ReactNode }) {
  return (
    <div className="text-xs">
      <label className="flex items-start gap-1.5 cursor-pointer">
        <input type="checkbox" className="mt-0.5 shrink-0 accent-[rgb(var(--arsist-accent))]" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <span className={`min-w-0 break-words ${on ? 'text-arsist-text' : 'text-arsist-muted'}`}>{label}</span>
      </label>
      {on && children && <div className="flex items-center gap-1 pl-5 mt-1 whitespace-nowrap">{children}</div>}
    </div>
  );
}

/** [最小, 最大]。チェックを外すと条件なし (undefined)。 */
export function RangeInput({ value, onChange, label, unit = 'm', defaults, step = 0.1 }: {
  value: [number, number] | undefined; onChange: (v: [number, number] | undefined) => void; label: string; unit?: string; defaults: [number, number]; step?: number;
}) {
  const v = value ?? defaults;
  return (
    <CheckRow on={!!value} onToggle={(on) => onChange(on ? defaults : undefined)} label={label}>
      <NumberInput step={step} value={v[0]} onChange={(n) => onChange([n ?? 0, v[1]])} width="w-16" />
      <span className="text-arsist-muted">–</span>
      <NumberInput step={step} value={v[1]} onChange={(n) => onChange([v[0], n ?? 0])} width="w-16" />
      <span className="text-arsist-muted">{unit}</span>
    </CheckRow>
  );
}

/** JSON を書く欄。読めないときは赤くして、値は変えない。 */
export function JsonInput({ value, onChange, rows = 4 }: { value: unknown; onChange: (v: unknown) => void; rows?: number }) {
  const [text, setText] = useState(value === undefined ? '' : JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    try {
      if (JSON.stringify(text.trim() ? JSON.parse(text) : undefined) === JSON.stringify(value)) return;
    } catch { /* 書きかけ */ }
    setText(value === undefined ? '' : JSON.stringify(value, null, 2));
    setBad(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value)]);
  return (
    <textarea
      className={`${INPUT} font-mono resize-y ${bad ? 'ring-1 ring-arsist-error' : ''}`}
      rows={rows}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (!e.target.value.trim()) { setBad(false); onChange(undefined); return; }
        try { onChange(JSON.parse(e.target.value)); setBad(false); } catch { setBad(true); }
      }}
    />
  );
}
