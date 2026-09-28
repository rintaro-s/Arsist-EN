/**
 * モデルタブの「試す」。取り込んだモデルを、その場で実際に動かして答えを見る。
 *
 * 動かしているのは実機と同じ C# (Runtime/Inference) で、推論だけが ONNX Runtime。
 * 用途ごとに試し方を変える:
 *   文章 (生成)   会話する。書けたそばから出る
 *   文章 (埋め込み) 何行かの文を比べ、1 行目にどれだけ近いかを棒で見せる
 *   文章 (分類)   ラベルと確からしさの棒
 *   文章 (共通)   分割を見る: 文がどんなトークンに切られるか
 *   画像          画を 1 枚選んで掛ける
 *   テンソル      入力の形を決めて、ゼロ / 1 / 乱数で流し、出力の形と先頭の値を見る
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Loader2, MessageSquarePlus, Play, Send, Square } from 'lucide-react';
import { useT } from '../../i18n';
import type { ModelDefinition } from '../../../shared/types';
import { decodeTestImage, type TestImage } from '../../vision/testMedia';
import { paintStep } from '../../vision/usePreview';
import { useModelTry, type TryState } from '../../models/useModelTry';

export function ModelTryPanel({ model }: { model: ModelDefinition }) {
  const t = useT();
  const tryer = useModelTry(model);
  const ready = model.use !== 'text' || !!model.text?.tokenizer;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-2.5 hairline-b flex items-center gap-2">
        <Play size={13} className="text-arsist-accent" />
        <span className="text-[12px] font-medium">{t('models.try.title')}</span>
        {tryer.state.running && <Loader2 size={12} className="animate-spin text-arsist-muted ml-auto" />}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        <p className="text-[10px] text-arsist-muted leading-snug">{t('models.try.hint')}</p>
        {!ready && <p className="text-[11px] text-amber-400 rounded bg-amber-400/10 px-3 py-2">{t('models.text.needTokenizer')}</p>}
        {ready && model.use === 'text' && model.text?.task === 'generate' && <ChatTry model={model} tryer={tryer} />}
        {ready && model.use === 'text' && model.text?.task === 'embed' && <EmbedTry tryer={tryer} />}
        {ready && model.use === 'text' && model.text?.task === 'classify' && <ClassifyTry tryer={tryer} />}
        {ready && model.use === 'text' && <TokenizeTry model={model} />}
        {model.use === 'image' && <ImageTry tryer={tryer} />}
        {model.use === 'tensor' && <TensorTry model={model} tryer={tryer} />}
        <Status state={tryer.state} />
      </div>
    </div>
  );
}

type Tryer = ReturnType<typeof useModelTry>;

function Status({ state }: { state: TryState }) {
  const t = useT();
  if (state.unavailable) return <p className="text-[11px] text-amber-400 rounded bg-amber-400/10 px-3 py-2">{t(`models.try.unavailable.${state.unavailable}`)}</p>;
  if (state.error && !state.cancelled) return <p className="text-[11px] text-arsist-error rounded bg-arsist-error/10 px-3 py-2 break-words">{t('models.try.error', { detail: state.error })}</p>;
  return null;
}

// ---- 会話 ----

interface Turn { role: 'user' | 'assistant'; content: string; stats?: string }

function ChatTry({ model, tryer }: { model: ModelDefinition; tryer: Tryer }) {
  const t = useT();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const { state } = tryer;

  useEffect(() => { setTurns([]); }, [model.id]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [turns, state.streamed]);

  const send = async () => {
    const text = draft.trim();
    if (!text || state.running) return;
    const history = [...turns, { role: 'user' as const, content: text }];
    setTurns(history);
    setDraft('');
    const outcome = await tryer.run({ action: 'generate', messages: history.map(({ role, content }) => ({ role, content })) });
    const result = outcome?.result;
    if (!result) return;
    const reason = String(result.reason ?? '');
    const stats = t('models.try.stats', {
      tokens: Number(result.tokens ?? 0),
      speed: Number(result.tokensPerSecond ?? 0).toFixed(1),
      reason: t(`models.try.reason.${reason || 'error'}`),
    });
    setTurns([...history, { role: 'assistant', content: String(result.text ?? ''), stats }]);
  };

  return (
    <div className="space-y-2">
      <div ref={logRef} className="rounded-lg bg-arsist-bg/70 p-2 space-y-2 max-h-[46vh] min-h-[8rem] overflow-y-auto">
        {turns.length === 0 && !state.running && <p className="text-[11px] text-arsist-muted p-2">{t('models.try.chatEmpty')}</p>}
        {turns.map((turn, i) => (
          <div key={i} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[12px] whitespace-pre-wrap break-words ${turn.role === 'user' ? 'bg-arsist-accent/20' : 'bg-arsist-surface'}`}>
              {turn.content || <span className="text-arsist-muted">{t('models.try.emptyAnswer')}</span>}
              {turn.stats && <span className="block text-[9px] text-arsist-muted mt-1">{turn.stats}</span>}
            </div>
          </div>
        ))}
        {state.running && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-3 py-2 text-[12px] whitespace-pre-wrap break-words bg-arsist-surface">
              {state.streamed || <Loader2 size={12} className="animate-spin text-arsist-muted" />}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-end gap-1.5">
        <textarea
          className="input text-xs flex-1 h-16 resize-none"
          placeholder={t('models.try.chatPlaceholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        <div className="flex flex-col gap-1">
          {state.running ? (
            <button className="btn-ghost text-[11px] px-2 py-1 flex items-center gap-1" onClick={tryer.cancel}><Square size={11} /> {t('models.try.stop')}</button>
          ) : (
            <button className="btn btn-primary text-[11px] px-2 py-1 flex items-center gap-1" disabled={!draft.trim()} onClick={() => { void send(); }}><Send size={11} /> {t('models.try.send')}</button>
          )}
          <button className="btn-ghost text-[11px] px-2 py-1 flex items-center gap-1" disabled={state.running || turns.length === 0} onClick={() => setTurns([])}>
            <MessageSquarePlus size={11} /> {t('models.try.clear')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- 埋め込み ----

function EmbedTry({ tryer }: { tryer: Tryer }) {
  const t = useT();
  const [text, setText] = useState(() => t('models.try.embedExample'));
  const items = (tryer.state.result?.items as Array<{ text: string; similarity: number; dims: number }> | undefined) ?? [];

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-arsist-muted leading-snug">{t('models.try.embedHint')}</p>
      <textarea className="input text-xs w-full h-24" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn btn-primary text-[11px] px-3 py-1" disabled={tryer.state.running}
        onClick={() => { void tryer.run({ action: 'embed', texts: text.split('\n').map((l) => l.trim()).filter(Boolean) }); }}>
        {t('models.try.embedRun')}
      </button>
      {items.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-arsist-muted">{t('models.try.dims', { dims: items[0].dims })}</p>
          {items.map((item, i) => (
            <Bar key={i} label={item.text} value={item.similarity} text={i === 0 ? t('models.try.reference') : item.similarity.toFixed(3)} highlight={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 分類 ----

function ClassifyTry({ tryer }: { tryer: Tryer }) {
  const t = useT();
  const [text, setText] = useState('');
  const top = (tryer.state.result?.top as Array<{ label: string; score: number }> | undefined) ?? [];
  return (
    <div className="space-y-2">
      <textarea className="input text-xs w-full h-16" placeholder={t('models.try.classifyPlaceholder')} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn btn-primary text-[11px] px-3 py-1" disabled={tryer.state.running || !text.trim()}
        onClick={() => { void tryer.run({ action: 'classify', text }); }}>
        {t('models.try.classifyRun')}
      </button>
      {top.map((entry) => <Bar key={entry.label} label={entry.label} value={entry.score} text={`${(entry.score * 100).toFixed(1)}%`} />)}
    </div>
  );
}

// ---- 分割を見る ----

function TokenizeTry({ model }: { model: ModelDefinition }) {
  const t = useT();
  const tryer = useModelTry(model);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => t('models.try.tokenizeExample'));
  const tokens = (tryer.state.result?.tokens as Array<{ id: number; token: string }> | undefined) ?? [];

  return (
    <div className="rounded-lg bg-arsist-surface/60">
      <button className="w-full text-left px-3 py-2 text-[11px] text-arsist-muted hover:text-arsist-text" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {t('models.try.tokenizeTitle')}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[10px] text-arsist-muted leading-snug">{t('models.try.tokenizeHint')}</p>
          <div className="flex gap-1.5">
            <input className="input text-xs flex-1" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn-ghost text-[11px] px-2" disabled={tryer.state.running} onClick={() => { void tryer.run({ action: 'tokenize', text }); }}>{t('models.try.tokenizeRun')}</button>
          </div>
          {tokens.length > 0 && (
            <>
              <p className="text-[10px] text-arsist-muted">{t('models.try.tokenCount', { count: tokens.length })}</p>
              <div className="flex flex-wrap gap-0.5">
                {tokens.map((token, i) => (
                  <span key={i} title={`#${token.id}`}
                    className={`text-[11px] font-mono px-1 py-0.5 rounded ${i % 2 === 0 ? 'bg-arsist-accent/20' : 'bg-purple-400/20'}`}>
                    {(token.token ?? '').replace(/Ġ/g, '␣').replace(/▁/g, '␣').replace(/Ċ/g, '↵') || '∅'}
                  </span>
                ))}
              </div>
            </>
          )}
          <Status state={tryer.state} />
        </div>
      )}
    </div>
  );
}

// ---- 画像 ----

function ImageTry({ tryer }: { tryer: Tryer }) {
  const t = useT();
  const [image, setImage] = useState<TestImage | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const result = tryer.state.result;

  useEffect(() => { if (canvasRef.current && image) paintStep(canvasRef.current, image); }, [image]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const decoded = await decodeTestImage(file, file.name);
    setImage(decoded);
    void tryer.run({ action: 'image', image: { width: decoded.width, height: decoded.height, rgba: decoded.rgba } });
  };

  const top = (result?.top as Array<{ label: string; score: number }> | undefined) ?? [];
  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      <button className="btn btn-primary text-[11px] px-3 py-1 flex items-center gap-1" onClick={() => inputRef.current?.click()}>
        <ImagePlus size={12} /> {t('models.try.pickImage')}
      </button>
      {image && <canvas ref={canvasRef} className="w-full rounded bg-arsist-bg" />}
      {result && result.ok === true && (
        <div className="space-y-1.5">
          {typeof result.label === 'string' && top.map((entry) => <Bar key={entry.label} label={entry.label} value={entry.score} text={`${(entry.score * 100).toFixed(1)}%`} />)}
          {Array.isArray(result.items) && <p className="text-[12px]">{t('models.try.items', { count: (result.items as unknown[]).length })}</p>}
          {typeof result.coverage === 'number' && <Bar label={t('models.try.coverageLabel')} value={result.coverage} text={`${(result.coverage * 100).toFixed(1)}%`} />}
          {result.kind === 'record' && typeof result.label !== 'string' && (
            <pre className="text-[10px] font-mono bg-arsist-bg rounded p-2 overflow-x-auto">{JSON.stringify(result, null, 1)}</pre>
          )}
          <p className="text-[10px] text-arsist-muted">{t('models.try.ms', { ms: Number(result.ms ?? 0) })}</p>
        </div>
      )}
    </div>
  );
}

// ---- テンソル ----

function TensorTry({ model, tryer }: { model: ModelDefinition; tryer: Tryer }) {
  const t = useT();
  const inputs = model.inspection?.inputs ?? [];
  const [fill, setFill] = useState<'zeros' | 'ones' | 'random'>('random');
  const [dims, setDims] = useState<Record<string, number[]>>({});
  const outputs = (tryer.state.result?.outputs as Record<string, { type: string; shape: number[]; data: number[]; truncated?: boolean }> | undefined) ?? {};

  const shapeOf = (name: string, declared: Array<number | string>) =>
    declared.map((d, i) => dims[name]?.[i] ?? (typeof d === 'number' && d > 0 ? d : 1));

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-arsist-muted leading-snug">{t('models.try.tensorHint')}</p>
      {inputs.map((input) => (
        <div key={input.name} className="rounded bg-arsist-surface px-2 py-1.5 space-y-1">
          <p className="text-[11px] font-mono">{input.name} <span className="text-arsist-muted">{input.elemType ?? ''}</span></p>
          <div className="flex flex-wrap items-center gap-1">
            {input.dims.map((d, i) => typeof d === 'number' && d > 0 ? (
              <span key={i} className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-arsist-bg">{d}</span>
            ) : (
              <input key={i} type="number" min={0} title={String(d)} className="input text-[11px] py-0.5 w-14 font-mono"
                value={shapeOf(input.name, input.dims)[i]}
                onChange={(e) => {
                  const next = shapeOf(input.name, input.dims);
                  next[i] = Math.max(0, parseInt(e.target.value, 10) || 0);
                  setDims({ ...dims, [input.name]: next });
                }} />
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <select className="input text-xs py-1" value={fill} onChange={(e) => setFill(e.target.value as typeof fill)}>
          <option value="random">{t('models.try.fill.random')}</option>
          <option value="zeros">{t('models.try.fill.zeros')}</option>
          <option value="ones">{t('models.try.fill.ones')}</option>
        </select>
        <button className="btn btn-primary text-[11px] px-3 py-1" disabled={tryer.state.running}
          onClick={() => {
            const shapes: Record<string, number[]> = {};
            for (const input of inputs) shapes[input.name] = shapeOf(input.name, input.dims);
            void tryer.run({ action: 'run', fill, dims: shapes });
          }}>
          {t('models.try.run')}
        </button>
      </div>
      {Object.keys(outputs).length > 0 && (
        <div className="space-y-1.5">
          {Object.entries(outputs).map(([name, output]) => (
            <div key={name} className="rounded bg-arsist-bg px-2 py-1.5">
              <p className="text-[11px] font-mono">{name} <span className="text-arsist-muted">{output.type} [{output.shape.join(',')}]</span></p>
              <p className="text-[10px] font-mono text-arsist-muted break-all">
                {output.data.slice(0, 16).map((v) => (Number.isInteger(v) ? v : v.toFixed(4))).join(', ')}{output.truncated || output.data.length > 16 ? ' …' : ''}
              </p>
            </div>
          ))}
          <p className="text-[10px] text-arsist-muted">{t('models.try.ms', { ms: Number(tryer.state.result?.ms ?? 0) })}</p>
        </div>
      )}
    </div>
  );
}

// ---- 部品 ----

function Bar({ label, value, text, highlight = false }: { label: string; value: number; text: string; highlight?: boolean }) {
  const width = useMemo(() => `${Math.max(0, Math.min(1, value)) * 100}%`, [value]);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2 text-[11px]">
        <span className={`truncate flex-1 ${highlight ? 'font-medium' : ''}`}>{label}</span>
        <span className="font-mono text-arsist-muted shrink-0">{text}</span>
      </div>
      <div className="h-1.5 rounded bg-arsist-bg overflow-hidden">
        <div className={`h-full ${highlight ? 'bg-arsist-muted' : 'bg-arsist-accent'}`} style={{ width }} />
      </div>
    </div>
  );
}
