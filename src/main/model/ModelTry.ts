/**
 * モデルタブの「試す」。実機と同じ C# (Runtime/Inference の InferenceService) を ONNX Runtime で動かす。
 *
 *   tools/vision-preview --model-try request.json
 *
 * ツールは標準出力に JSON を 1 行ずつ書く。LLM の生成は書けたそばから {"type":"delta"} が来るので、
 * ここで行ごとに読んでレンダラへ流す (onLine)。止めるときはプロセスを終わらせる。
 */
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { spawn, type ChildProcess } from 'child_process';
import { trackChild, longRunningOptions } from '../platform/childProcesses';
import type { ModelDefinition } from '../../shared/types';
import { modelTool } from '../vision/VisionPreview';

export type ModelTryAction = 'describe' | 'generate' | 'embed' | 'classify' | 'run' | 'tokenize' | 'image';

export interface ModelTryRequest {
  model: ModelDefinition;
  action: ModelTryAction;
  messages?: Array<{ role: string; content: string }>;
  options?: Record<string, unknown>;
  texts?: string[];
  text?: string;
  inputs?: Record<string, unknown>;
  fill?: 'zeros' | 'ones' | 'random';
  dims?: Record<string, number[]>;
  /** image のとき: 下から上の行順の RGBA */
  image?: { width: number; height: number; rgba: Uint8Array };
}

export interface ModelTryLine {
  type: 'signature' | 'delta' | 'result';
  [key: string]: unknown;
}

export interface ModelTryResult {
  ok: boolean;
  error?: string;
  /** 'dotnet' | 'toolMissing' | 'buildFailed' | 'onnx' */
  unavailable?: string;
  signature?: ModelTryLine;
  result?: ModelTryLine;
  cancelled?: boolean;
}

const running = new Map<string, ChildProcess>();

/** 走っている「試す」を止める。 */
export function cancelModelTry(runId: string): void {
  const child = running.get(runId);
  if (child) {
    child.kill();
    running.delete(runId);
  }
}

export async function runModelTry(
  runId: string,
  projectPath: string,
  request: ModelTryRequest,
  onLine: (line: ModelTryLine) => void,
): Promise<ModelTryResult> {
  const tool = await modelTool();
  if ('unavailable' in tool) return { ok: false, unavailable: tool.unavailable };

  const absolute = (file: string | undefined) =>
    !file ? file : path.isAbsolute(file) ? file : path.join(projectPath, file);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arsist-model-'));
  try {
    const model: ModelDefinition = {
      ...request.model,
      file: absolute(request.model.file) ?? '',
      text: request.model.text ? { ...request.model.text, tokenizer: absolute(request.model.text.tokenizer) ?? '' } : undefined,
    };
    const payload: Record<string, unknown> = { ...request, model, image: undefined };
    if (request.image) {
      const header = Buffer.alloc(8);
      header.writeInt32LE(request.image.width, 0);
      header.writeInt32LE(request.image.height, 4);
      const imagePath = path.join(workDir, 'image.rgba');
      await fs.writeFile(imagePath, Buffer.concat([header, Buffer.from(request.image.rgba)]));
      payload.image = imagePath;
    }
    const requestPath = path.join(workDir, 'request.json');
    await fs.writeJSON(requestPath, payload);

    return await new Promise<ModelTryResult>((resolve) => {
      const child = trackChild(
        spawn(tool.dotnet, [tool.dll, '--model-try', requestPath], longRunningOptions({ cwd: tool.cwd })),
        'model try',
        true,
      );
      running.set(runId, child);
      const outcome: ModelTryResult = { ok: false };
      let buffer = '';
      let stderr = '';

      const handle = (text: string) => {
        if (!text.trim()) return;
        let line: ModelTryLine;
        try {
          line = JSON.parse(text) as ModelTryLine;
        } catch {
          return;
        }
        if (line.type === 'signature') outcome.signature = line;
        if (line.type === 'result') {
          outcome.result = line;
          outcome.ok = line.ok === true;
          if (!outcome.ok) outcome.error = String(line.error ?? 'failed');
        }
        onLine(line);
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          handle(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
      });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', (e) => {
        running.delete(runId);
        resolve({ ok: false, error: String(e) });
      });
      child.on('close', (code, signal) => {
        const wasCancelled = !running.has(runId) && signal !== null;
        running.delete(runId);
        handle(buffer);
        if (wasCancelled) {
          resolve({ ...outcome, ok: false, cancelled: true, error: 'cancelled' });
          return;
        }
        if (!outcome.result) {
          outcome.error = (stderr.trim().split('\n').slice(-3).join('\n')) || `exit ${code}`;
        }
        resolve(outcome);
      });
    });
  } finally {
    await fs.remove(workDir).catch(() => {});
  }
}
