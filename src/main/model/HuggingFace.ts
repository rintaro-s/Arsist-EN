/**
 * Hugging Face からモデルを取り込む。
 *
 * ONNX を配っているリポジトリ (onnx-community/… など) は、同じモデルを精度違いで何本も置いている
 * (fp32 / fp16 / q4 / q4f16 / int8 …)。ここではリポジトリのファイル一覧を読んで
 *   1. どれが同じモデルの別精度か をまとめ (`variants`)
 *   2. 重みが別ファイル (*.onnx_data) の分も足した本当の大きさを出し
 *   3. 選ばれた 1 本と、その分割器・設定ファイルだけを落とす
 * 落とした後は、手元の ONNX を取り込むのと同じ道 (ModelImport) を通る。
 *
 * トークンは設定 (electron-store の huggingFaceToken) から。非公開や同意が要るリポジトリだけに要る。
 * 送り先は huggingface.co だけ。
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

const API = 'https://huggingface.co/api/models';
const RESOLVE = 'https://huggingface.co';

export interface HfFile {
  path: string;
  size: number;
}

/** 同じモデルの精度違い 1 本。 */
export interface HfVariant {
  /** リポジトリ内のパス (onnx/model_q4.onnx) */
  path: string;
  /** 'fp32' | 'fp16' | 'q4' | 'q4f16' | 'int8' | 'uint8' | 'bnb4' | 'q8f16' … */
  precision: string;
  /** 重みの別ファイルも含めた大きさ (バイト) */
  totalSize: number;
  /** 一緒に落とす重みのファイル */
  externalData: string[];
  /** 量子化された書き出しか (実機の Unity では動かないことが多い) */
  quantized: boolean;
}

/** 同じ役割のモデル (decoder_model_merged など) をまとめたもの。 */
export interface HfModelGroup {
  /** 変種を除いた名前 (onnx/model, onnx/decoder_model_merged) */
  base: string;
  variants: HfVariant[];
}

export interface HfRepoInfo {
  repo: string;
  /** モデルの本体の候補 (精度ごとにまとめてある) */
  groups: HfModelGroup[];
  /** tokenizer.json があるか */
  hasTokenizer: boolean;
  /** 一緒に落とす設定ファイル */
  sideFiles: string[];
  /** 人が読む注意 (i18n: models.hf.note.<code>) */
  notes: string[];
  /** 参考情報 */
  pipelineTag?: string;
  gated?: boolean;
  private?: boolean;
}

const PRECISIONS: Array<{ suffix: string; precision: string; quantized: boolean }> = [
  { suffix: '_q4f16', precision: 'q4f16', quantized: true },
  { suffix: '_q4', precision: 'q4', quantized: true },
  { suffix: '_bnb4', precision: 'bnb4', quantized: true },
  { suffix: '_int8', precision: 'int8', quantized: true },
  { suffix: '_uint8', precision: 'uint8', quantized: true },
  { suffix: '_quantized', precision: 'int8', quantized: true },
  { suffix: '_q8f16', precision: 'q8f16', quantized: true },
  { suffix: '_fp16', precision: 'fp16', quantized: false },
];

/** 一緒に落とす設定ファイル (あるものだけ)。 */
const SIDE_FILES = ['tokenizer.json', 'tokenizer_config.json', 'generation_config.json', 'config.json', 'chat_template.jinja', 'vocab.json', 'merges.txt'];

/** ONNX 以外の重み (安全のため落とさない)。 */
const SKIP = ['.safetensors', '.bin', '.gguf', '.pt', '.pth', '.msgpack', '.h5'];

function headers(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function parseRepoId(input: string): string {
  const trimmed = (input ?? '').trim();
  // URL で貼られても受け取る
  const match = trimmed.match(/huggingface\.co\/([^/\s?#]+\/[^/\s?#]+)/i);
  const id = match ? match[1] : trimmed.replace(/^\/+|\/+$/g, '');
  return id.replace(/\.git$/, '');
}

function splitVariant(onnxPath: string): { base: string; precision: string; quantized: boolean } {
  const withoutExt = onnxPath.replace(/\.onnx$/i, '');
  for (const p of PRECISIONS) {
    if (withoutExt.endsWith(p.suffix)) {
      return { base: withoutExt.slice(0, -p.suffix.length), precision: p.precision, quantized: p.quantized };
    }
  }
  return { base: withoutExt, precision: 'fp32', quantized: false };
}

/** リポジトリのファイル一覧を読み、ONNX の候補にまとめる。 */
export async function inspectRepo(repoInput: string, token?: string): Promise<{ success: true; info: HfRepoInfo } | { success: false; error: string }> {
  const repo = parseRepoId(repoInput);
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return { success: false, error: 'badRepo' };

  let meta: any = null;
  try {
    const response = await fetch(`${API}/${repo}`, { headers: headers(token) });
    // 非公開でも、存在しないリポジトリでも 401 が返る。トークンを付けて試したかどうかで文を変える。
    if (response.status === 401 || response.status === 403) return { success: false, error: token ? 'needsToken' : 'notFoundOrToken' };
    if (response.status === 404) return { success: false, error: 'notFound' };
    if (!response.ok) return { success: false, error: `http${response.status}` };
    meta = await response.json();
  } catch (error) {
    return { success: false, error: `network:${(error as Error).message}` };
  }

  let files: HfFile[];
  try {
    const response = await fetch(`${API}/${repo}/tree/main?recursive=true`, { headers: headers(token) });
    if (!response.ok) return { success: false, error: `http${response.status}` };
    const raw = (await response.json()) as Array<{ type: string; path: string; size?: number; lfs?: { size?: number } }>;
    files = raw.filter((f) => f.type === 'file').map((f) => ({ path: f.path, size: f.lfs?.size ?? f.size ?? 0 }));
  } catch (error) {
    return { success: false, error: `network:${(error as Error).message}` };
  }

  const analysed = analyseFiles(files);
  return {
    success: true,
    info: {
      repo,
      ...analysed,
      pipelineTag: meta?.pipeline_tag,
      gated: Boolean(meta?.gated),
      private: Boolean(meta?.private),
    },
  };
}

/**
 * ファイル一覧を、同じモデルの精度違いにまとめる (ネットワークに触らないので、そのまま試験できる)。
 */
export function analyseFiles(files: HfFile[]): Pick<HfRepoInfo, 'groups' | 'hasTokenizer' | 'sideFiles' | 'notes'> {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const groups = new Map<string, HfModelGroup>();
  for (const file of files) {
    if (!file.path.toLowerCase().endsWith('.onnx')) continue;
    const { base, precision, quantized } = splitVariant(file.path);
    // 重みの別ファイル: <model>.onnx_data, <model>.onnx_data_1 …
    const externalData = files.filter((f) => f.path.startsWith(`${file.path}_data`)).map((f) => f.path);
    const totalSize = file.size + externalData.reduce((sum, name) => sum + (byPath.get(name)?.size ?? 0), 0);
    const variant: HfVariant = { path: file.path, precision, totalSize, externalData, quantized };
    const group = groups.get(base) ?? { base, variants: [] };
    group.variants.push(variant);
    groups.set(base, group);
  }

  const order = ['fp32', 'fp16', 'q8f16', 'int8', 'uint8', 'bnb4', 'q4', 'q4f16'];
  for (const group of groups.values()) {
    group.variants.sort((a, b) => order.indexOf(a.precision) - order.indexOf(b.precision));
  }

  const notes: string[] = [];
  const list = [...groups.values()];
  if (list.length === 0) notes.push('noOnnx');
  // 画像も読むモデル (VLM) は、埋め込み・視覚・本体が別ファイルに分かれていて 1 本では動かない
  if (list.some((g) => /embed_tokens$/.test(g.base) || /vision_encoder$/.test(g.base))) notes.push('multiPart');
  const hasTokenizer = byPath.has('tokenizer.json') || (byPath.has('vocab.json') && byPath.has('merges.txt'));
  if (!hasTokenizer) notes.push('noTokenizer');

  return { groups: list, hasTokenizer, sideFiles: SIDE_FILES.filter((name) => byPath.has(name)), notes };
}

export interface HfDownloadProgress {
  /** いま落としているファイル */
  file: string;
  receivedBytes: number;
  totalBytes: number;
  /** 全体 */
  doneBytes: number;
  allBytes: number;
}

async function downloadFile(
  repo: string, filePath: string, destination: string, token: string | undefined,
  onChunk: (received: number, total: number) => void,
): Promise<void> {
  const url = `${RESOLVE}/${repo}/resolve/main/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url, { headers: headers(token), redirect: 'follow' });
  if (response.status === 401 || response.status === 403) throw new Error('needsToken');
  if (!response.ok) throw new Error(`http${response.status}`);
  if (!response.body) throw new Error('noBody');

  const total = Number(response.headers.get('content-length') ?? 0);
  await fs.ensureDir(path.dirname(destination));
  const temporary = `${destination}.part`;
  const out = fs.createWriteStream(temporary);
  let received = 0;
  const source = Readable.fromWeb(response.body as any);
  source.on('data', (chunk: Buffer) => {
    received += chunk.length;
    onChunk(received, total);
  });
  source.pipe(out);
  await finished(out);
  await fs.move(temporary, destination, { overwrite: true });
}

/**
 * 選んだ 1 本と、その重み・分割器・設定ファイルを落とす。
 * 置き場は `<project>/Assets/Models/<repo の名前>/`。重みの別ファイルは ONNX の中に
 * ファイル名で書かれているので、同じ名前で隣に置く (フォルダを分けるのは名前のぶつかりを避けるため)。
 */
export async function downloadVariant(
  projectPath: string,
  repoInput: string,
  variantPath: string,
  token: string | undefined,
  onProgress: (progress: HfDownloadProgress) => void,
  shouldCancel: () => boolean = () => false,
): Promise<{ success: true; modelFile: string; folder: string } | { success: false; error: string }> {
  const repo = parseRepoId(repoInput);
  const inspected = await inspectRepo(repo, token);
  if (!inspected.success) return inspected;

  const variant = inspected.info.groups.flatMap((g) => g.variants).find((v) => v.path === variantPath);
  if (!variant) return { success: false, error: 'variantMissing' };

  const folderName = `${repo.split('/').pop()!.replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 48)}_${variant.precision}`;
  const folder = path.join(projectPath, 'Assets', 'Models', folderName);
  await fs.ensureDir(folder);

  const wanted: string[] = [variant.path, ...variant.externalData, ...inspected.info.sideFiles.filter((f) => !SKIP.some((s) => f.endsWith(s)))];
  const allBytes = variant.totalSize;

  let doneBytes = 0;
  for (const file of wanted) {
    if (shouldCancel()) return { success: false, error: 'cancelled' };
    // 大きいファイルはフォルダの構造を捨てて、名前だけで置く (ONNX の中の参照と合わせる)
    const destination = path.join(folder, path.basename(file));
    try {
      await downloadFile(repo, file, destination, token, (received, total) => {
        onProgress({ file: path.basename(file), receivedBytes: received, totalBytes: total, doneBytes: doneBytes + received, allBytes });
      });
    } catch (error) {
      const message = (error as Error).message;
      // 設定ファイルは無くても進む
      if (file === variant.path || variant.externalData.includes(file)) return { success: false, error: message };
      continue;
    }
    const stat = await fs.stat(destination).catch(() => null);
    doneBytes += stat?.size ?? 0;
  }

  return { success: true, modelFile: path.join(folder, path.basename(variant.path)), folder };
}
