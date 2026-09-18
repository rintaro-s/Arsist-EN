/**
 * パイプラインのライブプレビュー。
 *
 * op をレンダラ側で書き直すと、エディタで見えるものと実機で起きることが
 * いずれ食い違う。そうならないよう、実機と同じ C# (tools/vision-preview) を
 * そのまま呼んで、各ステップが出した画を持ち帰る。
 *
 * 画像は生の RGBA でやり取りする。PNG の符号化・復号をどちらの側でも
 * 書かずに済み、レンダラは canvas にそのまま描ける。
 */
import { spawn } from 'child_process';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

export interface VisionPreviewStep {
  name: string;
  kind: string;
  width?: number;
  height?: number;
  /** 生 RGBA (下から上の行順)。画にならない値では undefined */
  rgba?: Uint8Array;
  record?: Record<string, unknown>;
  items?: unknown[];
  count?: number;
  boundary?: number[];
}

export interface VisionPreviewResult {
  ok: boolean;
  error?: string;
  gated?: boolean;
  gateReason?: string;
  steps: VisionPreviewStep[];
  values?: Record<string, unknown>;
  /** dotnet が無い等、プレビュー自体が動かせなかった場合 */
  unavailable?: string;
}

/** dotnet が使えるか。無くてもエディタは動くべきなので、投げずに理由を返す。 */
async function findDotnet(): Promise<string | null> {
  return new Promise((resolve) => {
    const probe = spawn('dotnet', ['--version'], { stdio: 'ignore' });
    probe.on('error', () => resolve(null));
    probe.on('close', (code) => resolve(code === 0 ? 'dotnet' : null));
  });
}

function projectRoot(): string {
  // dist/main/main/vision/VisionPreview.js から見たリポジトリ直下
  return path.resolve(__dirname, '..', '..', '..', '..');
}

export async function runVisionPreview(
  pipeline: unknown,
  image: { width: number; height: number; rgba: Uint8Array },
): Promise<VisionPreviewResult> {
  const dotnet = await findDotnet();
  if (!dotnet) {
    return { ok: false, steps: [], unavailable: 'dotnet' };
  }

  const projectFile = path.join(projectRoot(), 'tools', 'vision-preview', 'VisionPreview.csproj');
  if (!(await fs.pathExists(projectFile))) {
    return { ok: false, steps: [], unavailable: 'toolMissing' };
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arsist-vision-'));
  try {
    const pipelinePath = path.join(workDir, 'pipeline.json');
    const imagePath = path.join(workDir, 'in.rgba');
    const outDir = path.join(workDir, 'out');

    await fs.writeJSON(pipelinePath, pipeline);

    // 先頭 8 バイトに幅と高さ、あとは下から上の行順で RGBA。
    const header = Buffer.alloc(8);
    header.writeInt32LE(image.width, 0);
    header.writeInt32LE(image.height, 4);
    await fs.writeFile(imagePath, Buffer.concat([header, Buffer.from(image.rgba)]));

    const code = await new Promise<number>((resolve) => {
      const child = spawn(dotnet, [
        'run', '--project', projectFile, '-v', 'q', '--',
        '--pipeline', pipelinePath, '--image', imagePath, '--out', outDir,
      ], { cwd: projectRoot() });

      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', () => resolve(-1));
      child.on('close', (value) => {
        if (value !== 0 && stderr) console.error('[Arsist] vision preview:', stderr.trim());
        resolve(value ?? -1);
      });
    });

    const reportPath = path.join(outDir, 'result.json');
    if (code !== 0 || !(await fs.pathExists(reportPath))) {
      return { ok: false, steps: [], error: 'previewFailed' };
    }

    const report = await fs.readJSON(reportPath);
    const steps: VisionPreviewStep[] = [];

    for (const entry of report.steps ?? []) {
      const step: VisionPreviewStep = {
        name: entry.name,
        kind: entry.kind,
        record: entry.record,
        items: entry.items,
        count: entry.count,
        boundary: entry.boundary,
      };

      if (entry.image) {
        const file = path.join(outDir, entry.image);
        if (await fs.pathExists(file)) {
          const raw = await fs.readFile(file);
          step.width = raw.readInt32LE(0);
          step.height = raw.readInt32LE(4);
          step.rgba = new Uint8Array(raw.subarray(8));
        }
      }
      steps.push(step);
    }

    return {
      ok: report.ok === true,
      error: report.error || undefined,
      gated: report.gated === true,
      gateReason: report.gateReason || undefined,
      values: report.values,
      steps,
    };
  } finally {
    await fs.remove(workDir).catch(() => { /* 後始末に失敗しても本筋には影響しない */ });
  }
}
