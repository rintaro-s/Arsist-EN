/**
 * 下の「Mind の入出力」: 選んだ空間で Mind が受け取る観測 (observe.ts、実機と同じ規則) と、
 * openai-chat なら指示文と HTTP の本文を見せる。「試す」で main から実際に送り、返事を行動として読む。
 * 返ってきた推測 (beliefs) は、Space Lab に足して見られる (保存はしない)。
 */
import { useMemo, useState } from 'react';
import { Eye, Loader2, Play, RotateCcw } from 'lucide-react';
import type { Entity, MindReply, Vec3 } from '../../../shared/layster/spatial/types';
import type { TryMindResult } from '../../../shared/layster/spatial/ipc';
import { buildMindRequest, resolveFrame } from '../../../shared/layster/spatial/observe';
import { openAiChatBody, systemPromptFor } from '../../../shared/layster/spatial/mindProtocol';
import { filterMindActions } from '../../../shared/layster/spatial/validate';
import { useT } from '../../i18n';
import { spatialApi } from '../api';
import { useSpatialStore } from '../store';
import { useActiveSolve } from '../useSolve';
import { describeAction } from '../describe';

type View = 'request' | 'prompt' | 'body';

export function MindIO() {
  const t = useT();
  const project = useSpatialStore((s) => s.project);
  const selection = useSpatialStore((s) => s.selection);
  const setPreviewBeliefs = useSpatialStore((s) => s.setPreviewBeliefs);
  const previewBeliefs = useSpatialStore((s) => s.previewBeliefs);
  const solve = useActiveSolve();
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<View>('request');
  const [edge, setEdge] = useState<string>(project?.app.edge ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TryMindResult | null>(null);

  const mindId = selection?.kind === 'mind' ? selection.id : picked ?? project?.minds[0]?.id;
  const mind = project?.minds.find((m) => m.id === mindId);

  const input = useMemo(() => (project && mind && solve
    ? { project, mind, world: solve.world, placed: solve.results, tick: 1, time: 12.5, events: [], store: {} }
    : undefined), [project, mind, solve]);
  const request = useMemo(() => (input ? buildMindRequest(input) : undefined), [input]);

  if (!project) return null;
  if (project.minds.length === 0) {
    return <div className="h-full flex items-center justify-center text-xs text-arsist-muted">{t('spatial.mindio.noMinds')}</div>;
  }
  if (!mind || !request || !input) return null;

  const shown = view === 'prompt' ? systemPromptFor(mind, request.frame)
    : view === 'body' ? JSON.stringify(openAiChatBody(mind, request), null, 2)
      : JSON.stringify(request, null, 2);
  const api = spatialApi();

  const run = async () => {
    if (!api) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await api.tryMind({ mind, request, edge: edge || undefined }));
    } catch (e) {
      setResult({ ok: false, ms: 0, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const reply: MindReply | undefined = result?.reply;
  const { kept, dropped } = filterMindActions(mind, reply?.actions ?? []);

  const applyBeliefs = () => {
    const f = resolveFrame(request.frame, input);
    const toWorld = (p: Vec3): Vec3 => {
      if (!f) return p;
      const a = (f.yaw * Math.PI) / 180;
      return [f.origin[0] + p[0] * Math.cos(a) + p[2] * Math.sin(a), f.origin[1] + p[1], f.origin[2] - p[0] * Math.sin(a) + p[2] * Math.cos(a)];
    };
    const beliefs: Entity[] = (reply?.beliefs ?? []).map((b) => ({
      id: b.id,
      is: b.is?.length ? b.is : ['thing'],
      at: toWorld((b.at ?? [0, 0, 0]) as Vec3),
      yaw: (b.yaw ?? 0) + (f?.yaw ?? 0),
      size: (b.size ?? [0.1, 0.1, 0.1]) as Vec3,
      confidence: b.confidence ?? 0.5,
      source: `mind:${mind.id}`,
    }));
    setPreviewBeliefs(beliefs);
  };

  return (
    <div className="h-full flex min-h-0 text-xs">
      <div className="flex-1 flex flex-col min-w-0 hairline-r">
        <div className="flex items-center gap-1.5 px-2 py-1 shrink-0">
          <select className="px-2 py-0.5 bg-arsist-hover rounded text-xs" value={mind.id} onChange={(e) => setPicked(e.target.value)}>
            {project.minds.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
          </select>
          {(['request', 'prompt', 'body'] as const).filter((v) => v === 'request' || mind.protocol === 'openai-chat').map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-2 py-0.5 rounded ${view === v ? 'bg-arsist-active text-arsist-accent' : 'text-arsist-muted hover:text-arsist-text'}`}>
              {t(`spatial.mindio.view.${v}`)}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-arsist-muted">{t('spatial.mindio.inSpace', { space: solve!.space.id })}</span>
        </div>
        <pre className="flex-1 overflow-auto px-3 py-1 font-mono text-[10px] text-arsist-text whitespace-pre-wrap break-all">{shown}</pre>
      </div>

      <div className="w-[45%] flex flex-col min-w-0">
        <div className="flex items-center gap-1.5 px-2 py-1 shrink-0">
          <span className="text-arsist-muted whitespace-nowrap">{t('spatial.mindio.edge')}</span>
          <input className="flex-1 min-w-0 px-2 py-0.5 bg-arsist-hover rounded font-mono text-xs" value={edge} placeholder="192.168.0.23:8000" onChange={(e) => setEdge(e.target.value)} />
          <button className="btn btn-primary !px-2.5 !py-0.5 text-xs" disabled={busy || !api} onClick={() => void run()} title={api ? undefined : t('spatial.status.noBridge')}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} {t('spatial.mindio.try')}
          </button>
        </div>
        <div className="flex-1 overflow-auto px-3 py-1 space-y-2">
          {!result && <div className="text-arsist-muted">{t('spatial.mindio.hint')}</div>}
          {result && (
            <>
              <div className={result.ok ? 'text-arsist-success' : 'text-arsist-error'}>
                {result.ok ? t('spatial.mindio.ok', { ms: result.ms }) : t('spatial.mindio.failed', { ms: result.ms, error: result.error ?? String(result.status ?? '') })}
              </div>
              {reply?.text && <div><div className="text-[10px] text-arsist-muted">{t('spatial.mindio.text')}</div><div className="text-arsist-text">{reply.text}</div></div>}
              {kept.length + dropped.length > 0 && (
                <div>
                  <div className="text-[10px] text-arsist-muted">{t('spatial.mindio.actions')}</div>
                  {kept.map((a, i) => <div key={i} className="text-arsist-text">• {describeAction(t, a)}</div>)}
                  {dropped.map((a, i) => <div key={`d${i}`} className="text-arsist-muted line-through" title={t('spatial.mindio.dropped')}>• {a?.do}</div>)}
                </div>
              )}
              {(reply?.beliefs?.length ?? 0) > 0 && (
                <div>
                  <div className="text-[10px] text-arsist-muted flex items-center gap-1">
                    {t('spatial.mindio.beliefs', { n: reply!.beliefs!.length })}
                    {mind.output.beliefs && (
                      <button className="ml-1 px-1.5 rounded bg-arsist-hover hover:bg-arsist-active text-arsist-text flex items-center gap-0.5" onClick={applyBeliefs}>
                        <Eye size={10} /> {t('spatial.mindio.showBeliefs')}
                      </button>
                    )}
                    {previewBeliefs.length > 0 && (
                      <button className="px-1.5 rounded bg-arsist-hover hover:bg-arsist-active text-arsist-text flex items-center gap-0.5" onClick={() => setPreviewBeliefs([])}>
                        <RotateCcw size={10} /> {t('spatial.mindio.clearBeliefs')}
                      </button>
                    )}
                  </div>
                  {reply!.beliefs!.map((b) => <div key={b.id} className="font-mono text-[10px] text-arsist-text">{b.id} {(b.is ?? []).join(',')} {JSON.stringify(b.at ?? [])} {b.confidence ?? ''}</div>)}
                </div>
              )}
              {result.raw && (
                <details>
                  <summary className="text-[10px] text-arsist-muted cursor-pointer">{t('spatial.mindio.raw')}</summary>
                  <pre className="font-mono text-[10px] whitespace-pre-wrap break-all text-arsist-muted">{result.raw}</pre>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
