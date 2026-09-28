/**
 * パイプラインを試す素材に流して、各ステップの結果を持ち帰る。
 *
 * 実行するのは実機と同じ C#。エディタで見えるものと端末で起きることが
 * 食い違わないようにするためで、ここで op を書き直してはいけない。
 *
 * 素材が複数フレームなら、状態 (track / stabilize / motion / event) を引き継いで順に流し、
 * 選んでいるフレーム (focus) のステップの絵と、全フレームの要約 (時間軸用) を受け取る。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelDefinition, PerceptionTask, VisionOp, VisionPipeline } from '../../shared/types';
import { cropToTask, type TestImage, type TestMedia } from './testMedia';

export type { TestImage, TestMedia } from './testMedia';
export { decodeTestImage } from './testMedia';

export interface PreviewStep {
  name: string;
  kind: string;
  width?: number;
  height?: number;
  rgba?: Uint8Array;
  record?: Record<string, unknown>;
  items?: unknown[];
  count?: number;
  boundary?: number[];
}

export interface PreviewFrame {
  index: number;
  ok: boolean;
  error?: string;
  gated?: boolean;
  gateReason?: string;
  events?: string[];
  values?: Record<string, unknown>;
  counts?: Record<string, number>;
}

/** 候補の一手を今の画で試した結果。 */
export interface ProbeResult extends PreviewStep {
  op: string;
  coverage?: number;
  stopped?: string;
  error?: string;
}

export interface PreviewState {
  running: boolean;
  ok: boolean;
  error?: string;
  gated?: boolean;
  gateReason?: string;
  events?: string[];
  steps: PreviewStep[];
  /** どのフレームの steps か */
  focus?: number;
  frames?: PreviewFrame[];
  /** 'dotnet' / 'toolMissing' / 'buildFailed' / 'onnx' (i18n: vision.unavailable.<key>) */
  unavailable?: string;
  values?: Record<string, unknown>;
  /** ツールのビルドやモデルの読み込みで出た注意 (そのまま表示する) */
  notes?: string[];
  /** 直近の実行に掛かった時間 (ms、往復込み) */
  elapsedMs?: number;
}

/** 下から上の RGBA を canvas に描く。 */
export function paintStep(canvas: HTMLCanvasElement, step: { rgba?: Uint8Array; width?: number; height?: number }): void {
  if (!step.rgba || !step.width || !step.height) return;

  canvas.width = step.width;
  canvas.height = step.height;
  const context = canvas.getContext('2d');
  if (!context) return;

  const image = context.createImageData(step.width, step.height);
  for (let y = 0; y < step.height; y++) {
    const source = (step.height - 1 - y) * step.width * 4;
    image.data.set(step.rgba.subarray(source, source + step.width * 4), y * step.width * 4);
  }
  context.putImageData(image, 0, 0);
}

export function usePreview(
  pipeline: VisionPipeline | null,
  media: TestMedia | null,
  focus: number,
  task: PerceptionTask | null,
  models: ModelDefinition[] = [],
  projectPath: string | null = null,
): PreviewState {
  const [state, setState] = useState<PreviewState>({ running: false, ok: false, steps: [] });
  const requestRef = useRef(0);

  // モデル定義は参照が変わるたびに走らせたくないので、中身で比べる
  const modelsKey = JSON.stringify(models);
  // 見る枠が変わったら切り出し直す
  const rectKey = task?.source.kind === 'viewport' ? JSON.stringify(task.source.rect) : 'region';

  const run = useCallback(async () => {
    if (!pipeline || !media || media.frames.length === 0 || (pipeline.ops ?? []).length === 0) {
      setState({ running: false, ok: false, steps: [] });
      return;
    }

    const request = ++requestRef.current;
    setState((previous) => ({ ...previous, running: true }));
    const started = performance.now();

    try {
      const frames: TestImage[] = media.precropped ? media.frames : media.frames.map((f) => cropToTask(f, task));
      const focusIndex = Math.min(frames.length - 1, Math.max(0, focus));
      const result = await window.electronAPI.vision.preview(pipeline, frames[focusIndex], {
        models: JSON.parse(modelsKey),
        projectPath: projectPath ?? undefined,
        frames: frames.length > 1 ? frames : undefined,
        focus: focusIndex,
        fps: media.fps,
      });
      // 打ち込んでいる最中は要求が重なる。古い結果で上書きしない。
      if (request !== requestRef.current) return;
      setState({ running: false, ...result, elapsedMs: Math.round(performance.now() - started) });
    } catch (e) {
      if (request !== requestRef.current) return;
      setState({ running: false, ok: false, steps: [], error: String(e) });
    }
    // task は rectKey で見ている (参照が変わるたびに走らせない)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline, media, focus, modelsKey, projectPath, rectKey]);

  useEffect(() => {
    // パラメータをいじるたびに走らせると重いので、少し待ってからまとめて流す。
    const timer = window.setTimeout(run, 220);
    return () => window.clearTimeout(timer);
  }, [run]);

  return state;
}

/**
 * 「一手を足す」画面用: 候補の一手を、挿入位置の画に対して全部試す。
 * 主のプレビューとは別の呼び出しにして、候補が多くても主の絵を待たせない。
 */
export function useProbe(
  pipeline: VisionPipeline | null,
  index: number | null,
  candidates: VisionOp[],
  media: TestMedia | null,
  focus: number,
  task: PerceptionTask | null,
  models: ModelDefinition[] = [],
  projectPath: string | null = null,
): { probes: Map<string, ProbeResult>; running: boolean } {
  const [probes, setProbes] = useState<Map<string, ProbeResult>>(new Map());
  const [running, setRunning] = useState(false);
  const requestRef = useRef(0);
  const candidatesKey = JSON.stringify(candidates.map((c) => ({ op: c.op, in: c.in, params: c.params })));
  const modelsKey = JSON.stringify(models);

  useEffect(() => {
    if (!pipeline || index === null || candidates.length === 0 || !media || media.frames.length === 0) {
      setProbes(new Map());
      return;
    }
    const request = ++requestRef.current;
    setRunning(true);
    const frames = media.precropped ? media.frames : media.frames.map((f) => cropToTask(f, task));
    const focusIndex = Math.min(frames.length - 1, Math.max(0, focus));
    // 状態は要らないので、見ているフレームだけを流す (速い)
    void window.electronAPI.vision.preview(pipeline, frames[focusIndex], {
      models: JSON.parse(modelsKey),
      projectPath: projectPath ?? undefined,
      probe: { index, ops: candidates },
    }).then((result) => {
      if (request !== requestRef.current) return;
      const next = new Map<string, ProbeResult>();
      for (const probe of result.probes ?? []) {
        next.set(probe.id, { name: probe.id, kind: probe.kind ?? 'record', ...probe });
      }
      setProbes(next);
      setRunning(false);
    }).catch(() => {
      if (request !== requestRef.current) return;
      setProbes(new Map());
      setRunning(false);
    });
    // candidates は candidatesKey で、task は切り出し枠で見ている
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline, index, candidatesKey, media, focus, modelsKey, projectPath]);

  return { probes, running };
}
