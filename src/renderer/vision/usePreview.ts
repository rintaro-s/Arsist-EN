/**
 * パイプラインを試し画像に流して、各ステップの結果を持ち帰る。
 *
 * 実行するのは実機と同じ C#。エディタで見えるものと端末で起きることが
 * 食い違わないようにするためで、ここで op を書き直してはいけない。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VisionPipeline } from '../../shared/types';

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

export interface PreviewState {
  running: boolean;
  ok: boolean;
  error?: string;
  gated?: boolean;
  gateReason?: string;
  steps: PreviewStep[];
  unavailable?: string;
}

export interface TestImage {
  width: number;
  height: number;
  rgba: Uint8Array;
  name: string;
}

/** 画像ファイルを、パイプラインが期待する下から上の RGBA にする。 */
export async function decodeTestImage(file: File): Promise<TestImage> {
  const bitmap = await createImageBitmap(file);

  // 大きすぎる写真をそのまま流すと、プレビューが目に見えて遅くなる。
  const maxWidth = 640;
  const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas is unavailable');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const topDown = context.getImageData(0, 0, width, height).data;

  // canvas は上から下、ColorImage は下から上。ここを揃えないと上下が逆になる。
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const source = (height - 1 - y) * width * 4;
    rgba.set(topDown.subarray(source, source + width * 4), y * width * 4);
  }

  return { width, height, rgba, name: file.name };
}

/** 下から上の RGBA を canvas に描く。 */
export function paintStep(canvas: HTMLCanvasElement, step: PreviewStep): void {
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

export function usePreview(pipeline: VisionPipeline | null, image: TestImage | null): PreviewState {
  const [state, setState] = useState<PreviewState>({ running: false, ok: false, steps: [] });
  const requestRef = useRef(0);

  const run = useCallback(async () => {
    if (!pipeline || !image || (pipeline.ops ?? []).length === 0) {
      setState({ running: false, ok: false, steps: [] });
      return;
    }

    const request = ++requestRef.current;
    setState((previous) => ({ ...previous, running: true }));

    try {
      const result = await window.electronAPI.vision.preview(pipeline, image);
      // 打ち込んでいる最中は要求が重なる。古い結果で上書きしない。
      if (request !== requestRef.current) return;
      setState({ running: false, ...result });
    } catch (e) {
      if (request !== requestRef.current) return;
      setState({ running: false, ok: false, steps: [], error: String(e) });
    }
  }, [pipeline, image]);

  useEffect(() => {
    // パラメータをいじるたびに走らせると重いので、少し待ってからまとめて流す。
    const timer = window.setTimeout(run, 250);
    return () => window.clearTimeout(timer);
  }, [run]);

  return state;
}
