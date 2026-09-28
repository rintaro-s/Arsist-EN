/**
 * モデルタブの「試す」を走らせる。実機と同じ C# (InferenceService) を ONNX Runtime で動かすので、
 * ここで見える答えがそのまま端末で出る (違うのは推論エンジンの浮動小数の丸めだけ)。
 *
 * LLM の生成は書けたそばから届く (streamed)。新しく走らせると前の結果は捨てる。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { ModelDefinition } from '../../shared/types';
import { useProjectStore } from '../stores/projectStore';

export interface TensorInfoView {
  name: string;
  type: string;
  shape: number[];
}

export interface SignatureView {
  inputs: TensorInfoView[];
  outputs: TensorInfoView[];
}

export interface TryState {
  running: boolean;
  /** 生成で書けたところまで */
  streamed: string;
  signature?: SignatureView;
  result?: Record<string, unknown>;
  error?: string;
  /** 'dotnet' | 'toolMissing' | 'buildFailed' | 'onnx' */
  unavailable?: string;
  cancelled?: boolean;
}

export type TryRequest = {
  action: 'describe' | 'generate' | 'embed' | 'classify' | 'run' | 'tokenize' | 'image';
  messages?: Array<{ role: string; content: string }>;
  options?: Record<string, unknown>;
  texts?: string[];
  text?: string;
  fill?: 'zeros' | 'ones' | 'random';
  dims?: Record<string, number[]>;
  image?: { width: number; height: number; rgba: Uint8Array };
};

export function useModelTry(model: ModelDefinition | null) {
  const projectPath = useProjectStore((s) => s.projectPath);
  const [state, setState] = useState<TryState>({ running: false, streamed: '' });
  const current = useRef<string | null>(null);

  useEffect(() => window.electronAPI.model.onTryLine(({ runId, line }) => {
    if (runId !== current.current) return;
    if (line.type === 'delta') {
      setState((s) => ({ ...s, streamed: s.streamed + String(line.delta ?? '') }));
    } else if (line.type === 'signature') {
      setState((s) => ({ ...s, signature: line as unknown as SignatureView }));
    }
  }), []);

  // モデルを替えたら結果は捨てる
  useEffect(() => {
    current.current = null;
    setState({ running: false, streamed: '' });
  }, [model?.id]);

  const run = useCallback(async (request: TryRequest) => {
    if (!model) return null;
    if (current.current) void window.electronAPI.model.cancelTry(current.current);
    const runId = uuidv4();
    current.current = runId;
    setState((s) => ({ running: true, streamed: '', signature: s.signature }));
    const outcome = await window.electronAPI.model.try(runId, projectPath ?? undefined, { model, ...request });
    if (current.current !== runId) return null;
    setState((s) => ({
      ...s,
      running: false,
      signature: (outcome.signature as unknown as SignatureView) ?? s.signature,
      result: outcome.result,
      error: outcome.ok ? undefined : outcome.error,
      unavailable: outcome.unavailable,
      cancelled: outcome.cancelled,
    }));
    return outcome;
  }, [model, projectPath]);

  const cancel = useCallback(() => {
    if (current.current) void window.electronAPI.model.cancelTry(current.current);
  }, []);

  return { state, run, cancel };
}
