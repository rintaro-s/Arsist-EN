/**
 * パイプラインのライブプレビュー。
 *
 * op をレンダラ側で書き直すと、エディタで見えるものと実機で起きることが
 * いずれ食い違う。そうならないよう、実機と同じ C# (tools/vision-preview) を
 * そのまま呼んで、各ステップが出した画を持ち帰る。
 *
 * 画像は生の RGBA でやり取りする。PNG の符号化・復号をどちらの側でも
 * 書かずに済み、レンダラは canvas にそのまま描ける。
 *
 * ツールは一度だけビルドして、あとは出来上がった DLL を直接動かす。
 * 以前は毎回 `dotnet run` していて、パラメータを一つ動かすたびに 1〜2 秒待たされた。
 *
 * `infer` op (ONNX) は ONNX Runtime の NuGet パッケージが要る。取れない環境 (オフライン) では
 * パッケージ無しでビルドし直し、モデルを使うパイプラインだけ「プレビューできない」と返す。
 * 古典的な op のプレビューまで巻き添えにしない。
 */
import { spawn } from 'child_process';
import { trackChild, longRunningOptions } from '../platform/childProcesses';
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

/** フレームごとの軽い要約 (時間軸用)。画は含めない。 */
export interface VisionPreviewFrame {
  index: number;
  ok: boolean;
  error?: string;
  gated?: boolean;
  gateReason?: string;
  events?: string[];
  values?: Record<string, unknown>;
  /** 一覧の件数、マスクの被覆率 (値名 → 数) */
  counts?: Record<string, number>;
}

/** 候補の一手を今の画で試した結果 (「一手を足す」画面用)。 */
export interface VisionPreviewProbe {
  id: string;
  op: string;
  kind?: string;
  width?: number;
  height?: number;
  rgba?: Uint8Array;
  record?: Record<string, unknown>;
  items?: unknown[];
  count?: number;
  boundary?: number[];
  coverage?: number;
  stopped?: string;
  error?: string;
}

export interface VisionPreviewResult {
  ok: boolean;
  error?: string;
  gated?: boolean;
  gateReason?: string;
  events?: string[];
  probes?: VisionPreviewProbe[];
  /** steps がどのフレームのものか */
  focus?: number;
  frames?: VisionPreviewFrame[];
  steps: VisionPreviewStep[];
  values?: Record<string, unknown>;
  /**
   * プレビュー自体が動かせなかった理由:
   *   'dotnet'      .NET SDK が無い
   *   'toolMissing' tools/vision-preview が無い (パッケージ版で消えている等)
   *   'buildFailed' C# のビルドに失敗した
   *   'onnx'        ONNX Runtime が取れず、モデルを使う一手だけ流せない
   */
  unavailable?: string;
  /** ツールのビルドやモデルの読み込みで出た注意 */
  notes?: string[];
}

export interface VisionPreviewOptions {
  /** パイプラインが参照するモデル定義 (file はプロジェクト相対)。 */
  models?: unknown[];
  /** model.file を絶対パスにするための基準 */
  projectPath?: string;
  /**
   * 連続したフレーム (動画から抜いた画など)。渡すと状態を引き継いで順に流し、
   * steps は focus のフレームのものになる。image は無視される。
   */
  frames?: Array<{ width: number; height: number; rgba: Uint8Array }>;
  focus?: number;
  /** フレームの間隔 (1 秒あたりの枚数)。track の速度計算に使う */
  fps?: number;
  /** 候補の一手を、パイプラインの index の位置で試す */
  probe?: { index: number; ops: unknown[] };
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

function toolDir(): string {
  return path.join(projectRoot(), 'tools', 'vision-preview');
}

function runProcess(command: string, args: string[], cwd: string): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    // ウィンドウを閉じたときに一緒に止められるよう、起こしたものは登録しておく。
    const child = trackChild(spawn(command, args, longRunningOptions({ cwd })), `vision-preview ${args[0] ?? ''}`.trim(), true);
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (e) => resolve({ code: -1, stderr: String(e), stdout }));
    child.on('close', (value) => resolve({ code: value ?? -1, stderr, stdout }));
  });
}

// ---- ツールのビルド (プロセスごとに一度) ----------------------------------

interface ToolBuild {
  dll: string;
  /** ONNX Runtime 入りでビルドできたか */
  onnx: boolean;
  notes: string[];
}

let toolBuild: Promise<ToolBuild | null> | null = null;

/** ビルド対象のソースの最新更新時刻。DLL がこれより古ければ作り直す。 */
async function newestSourceMtime(): Promise<number> {
  const roots = [
    toolDir(),
    path.join(projectRoot(), 'UnityBackend', 'ArsistBuilder', 'Assets', 'Arsist', 'Runtime', 'Perception'),
    path.join(projectRoot(), 'UnityBackend', 'ArsistBuilder', 'Assets', 'Arsist', 'Runtime', 'Inference'),
  ];
  let newest = 0;
  const walk = async (dir: string) => {
    let entries: string[];
    try { entries = await fs.readdir(dir); } catch { return; }
    for (const entry of entries) {
      if (entry === 'bin' || entry === 'obj') continue;
      const full = path.join(dir, entry);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat) continue;
      if (stat.isDirectory()) await walk(full);
      else if (/\.(cs|csproj)$/.test(entry)) newest = Math.max(newest, stat.mtimeMs);
    }
  };
  for (const root of roots) await walk(root);
  return newest;
}

async function buildTool(dotnet: string): Promise<ToolBuild | null> {
  const projectFile = path.join(toolDir(), 'VisionPreview.csproj');
  if (!(await fs.pathExists(projectFile))) return null;

  const sourceMtime = await newestSourceMtime();
  const notes: string[] = [];

  // ONNX 入り → 無し の順で試す。成功した方の DLL を使う。
  for (const onnx of [true, false]) {
    const outDir = path.join(toolDir(), 'bin', onnx ? 'arsist-onnx' : 'arsist-plain');
    const dll = path.join(outDir, 'VisionPreview.dll');

    const existing = await fs.stat(dll).catch(() => null);
    if (existing && existing.mtimeMs >= sourceMtime) {
      return { dll, onnx, notes };
    }

    const result = await runProcess(dotnet, [
      'build', projectFile, '-c', 'Release', '-v', 'q', '--nologo',
      `-p:ArsistOnnx=${onnx ? 'true' : 'false'}`, '-o', outDir,
    ], projectRoot());

    if (result.code === 0 && (await fs.pathExists(dll))) {
      // 古い方の成果物が残っていると、次回の起動で誤って選ばれる
      if (!onnx) await fs.remove(path.join(toolDir(), 'bin', 'arsist-onnx')).catch(() => {});
      return { dll, onnx, notes };
    }

    const reason = (result.stderr || result.stdout).trim().split('\n').slice(-5).join('\n');
    console.error(`[Arsist] vision preview build (onnx=${onnx}) failed:\n${reason}`);
    notes.push(onnx ? 'onnxBuildFailed' : 'buildFailed');
  }
  return null;
}

async function ensureTool(dotnet: string): Promise<ToolBuild | null> {
  if (!toolBuild) {
    toolBuild = buildTool(dotnet).catch((e) => {
      console.error('[Arsist] vision preview build threw:', e);
      return null;
    });
  }
  const built = await toolBuild;
  if (!built) toolBuild = null; // 次の呼び出しでもう一度試せるようにする
  return built;
}

/**
 * モデルタブの「試す」が使うツール。画像処理のプレビューと同じ DLL (ONNX Runtime 入り) を使い回す。
 * 使えなければ理由 ('dotnet' | 'toolMissing' | 'buildFailed' | 'onnx') を返す。
 */
export async function modelTool(): Promise<{ dotnet: string; dll: string; cwd: string } | { unavailable: string; notes?: string[] }> {
  const dotnet = await findDotnet();
  if (!dotnet) return { unavailable: 'dotnet' };
  if (!(await fs.pathExists(path.join(toolDir(), 'VisionPreview.csproj')))) return { unavailable: 'toolMissing' };
  const tool = await ensureTool(dotnet);
  if (!tool) return { unavailable: 'buildFailed' };
  if (!tool.onnx) return { unavailable: 'onnx', notes: tool.notes };
  return { dotnet, dll: tool.dll, cwd: projectRoot() };
}

/** 失敗したビルドをやり直したいとき (テスト用)。 */
export function resetVisionPreviewTool(): void {
  toolBuild = null;
}

function pipelineUsesModels(pipeline: unknown): boolean {
  const ops = (pipeline as { ops?: Array<{ op?: string }> })?.ops ?? [];
  return ops.some((op) => op?.op === 'infer');
}

// ---- 実行 -----------------------------------------------------------------

export async function runVisionPreview(
  pipeline: unknown,
  image: { width: number; height: number; rgba: Uint8Array },
  options: VisionPreviewOptions = {},
): Promise<VisionPreviewResult> {
  const dotnet = await findDotnet();
  if (!dotnet) {
    return { ok: false, steps: [], unavailable: 'dotnet' };
  }

  const projectFile = path.join(toolDir(), 'VisionPreview.csproj');
  if (!(await fs.pathExists(projectFile))) {
    return { ok: false, steps: [], unavailable: 'toolMissing' };
  }

  const tool = await ensureTool(dotnet);
  if (!tool) {
    return { ok: false, steps: [], unavailable: 'buildFailed' };
  }

  const usesModels = pipelineUsesModels(pipeline);
  if (usesModels && !tool.onnx) {
    return { ok: false, steps: [], unavailable: 'onnx', notes: tool.notes };
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arsist-vision-'));
  try {
    const pipelinePath = path.join(workDir, 'pipeline.json');
    const outDir = path.join(workDir, 'out');

    await fs.writeJSON(pipelinePath, pipeline);

    // 先頭 8 バイトに幅と高さ、あとは下から上の行順で RGBA。
    const frames = options.frames && options.frames.length > 0 ? options.frames : [image];
    const args = [tool.dll, '--pipeline', pipelinePath, '--out', outDir];
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const header = Buffer.alloc(8);
      header.writeInt32LE(frame.width, 0);
      header.writeInt32LE(frame.height, 4);
      const imagePath = path.join(workDir, `in${i}.rgba`);
      await fs.writeFile(imagePath, Buffer.concat([header, Buffer.from(frame.rgba)]));
      args.push('--image', imagePath);
    }
    const focus = Math.min(frames.length - 1, Math.max(0, options.focus ?? frames.length - 1));
    args.push('--focus', String(focus), '--fps', String(options.fps && options.fps > 0 ? options.fps : 2));

    if (options.probe && options.probe.ops.length > 0) {
      const probePath = path.join(workDir, 'probe.json');
      await fs.writeJSON(probePath, options.probe);
      args.push('--probe', probePath);
    }

    if (usesModels) {
      // モデルの file はプロジェクト相対。C# 側には絶対パスで渡す。
      const models = ((options.models ?? []) as Array<Record<string, unknown>>).map((model) => {
        const file = String(model.file ?? '');
        const absolute = path.isAbsolute(file) || !options.projectPath
          ? file
          : path.join(options.projectPath, file);
        return { ...model, file: absolute };
      });
      const modelsPath = path.join(workDir, 'models.json');
      await fs.writeJSON(modelsPath, models);
      args.push('--models', modelsPath);
    }

    const run = await runProcess(dotnet, args, projectRoot());
    if (run.code !== 0 && run.stderr) console.error('[Arsist] vision preview:', run.stderr.trim());

    const reportPath = path.join(outDir, 'result.json');
    if (run.code !== 0 || !(await fs.pathExists(reportPath))) {
      return { ok: false, steps: [], error: 'previewFailed', notes: run.stderr ? [run.stderr.trim()] : undefined };
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

    const probes: VisionPreviewProbe[] = [];
    for (const entry of report.probes ?? []) {
      const probe: VisionPreviewProbe = {
        id: entry.id, op: entry.op, kind: entry.kind, record: entry.record, items: entry.items, count: entry.count,
        boundary: entry.boundary, coverage: entry.coverage, stopped: entry.stopped, error: entry.error,
      };
      if (entry.image) {
        const file = path.join(outDir, entry.image);
        if (await fs.pathExists(file)) {
          const raw = await fs.readFile(file);
          probe.width = raw.readInt32LE(0);
          probe.height = raw.readInt32LE(4);
          probe.rgba = new Uint8Array(raw.subarray(8));
        }
      }
      probes.push(probe);
    }

    return {
      ok: report.ok === true,
      error: report.error || undefined,
      gated: report.gated === true,
      gateReason: report.gateReason || undefined,
      events: report.events ?? [],
      probes: probes.length > 0 ? probes : undefined,
      focus: report.focus,
      frames: report.frames,
      values: report.values,
      steps,
      notes: tool.notes.length > 0 ? tool.notes : undefined,
    };
  } finally {
    await fs.remove(workDir).catch(() => { /* 後始末に失敗しても本筋には影響しない */ });
  }
}
