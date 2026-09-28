/**
 * ONNX をプロジェクトに取り込む。
 *
 *   1. Assets/Models/ にコピーする (UnityBuilder が Assets/ を丸ごと Unity 側へ鏡写しにするので、
 *      これだけで Inference Engine の取り込み対象になる)
 *   2. 重みを別ファイルに持つモデルなら、そのファイルも同じ名前で隣に置く
 *   3. ファイルを読んで入出力を調べ、定義の下書きを返す
 *   4. 隣に labels ファイル (<name>.txt / .names / .labels.txt / .json) があれば読む
 *   5. 文章のモデルなら、HuggingFace の配布の形 (onnx/model.onnx の一つ上に tokenizer.json) を見て
 *      tokenizer.json を一緒に取り込み、tokenizer_config.json / generation_config.json / config.json から
 *      会話の書式・止めるトークン・分類のラベルを埋める
 */
import * as path from 'path';
import { createHash } from 'crypto';
import * as fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import type { ChatFormatName, ModelDefinition, TextModelSpec } from '../../shared/types';
import { inspectOnnxFile, suggestDefinition, suggestTextTask, suggestUse, type InspectedModel } from './OnnxInspector';
import { defaultTextSpec } from '../../shared/modelDefaults';
import { resolveRuntime } from '../../shared/unityOps';

export interface ModelImportResult {
  success: boolean;
  error?: string;
  model?: ModelDefinition;
  warnings?: string[];
}

const LABEL_SUFFIXES = ['.labels.txt', '.names', '.txt', '.labels.json', '.json'];

/** クラス名の一覧を読む。1 行 1 名前のテキストか、文字列配列 / {index: name} の JSON。 */
export async function readLabelsFile(filePath: string): Promise<string[] | null> {
  if (!(await fs.pathExists(filePath))) return null;
  const text = await fs.readFile(filePath, 'utf8');
  if (filePath.toLowerCase().endsWith('.json')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
      if (parsed && typeof parsed === 'object') {
        return Object.entries(parsed as Record<string, unknown>)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([, v]) => String(v));
      }
    } catch {
      return null;
    }
    return null;
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.length > 0 ? lines : null;
}

async function findLabelsBeside(modelPath: string): Promise<string[] | null> {
  const dir = path.dirname(modelPath);
  const base = path.basename(modelPath, path.extname(modelPath));
  for (const suffix of LABEL_SUFFIXES) {
    const labels = await readLabelsFile(path.join(dir, base + suffix));
    if (labels) return labels;
  }
  return null;
}

export function draftDefinition(
  name: string,
  file: string,
  inspection: InspectedModel,
  labels: string[] | null,
  text?: TextModelSpec,
): ModelDefinition {
  const { externalDataFiles, warnings: _warnings, ...plain } = inspection;
  if (externalDataFiles.length > 0) plain.externalData = externalDataFiles;
  const use = text ? 'text' : suggestUse(inspection);
  // Unity のエンジンが読めない演算子を使うモデルは、同梱の ONNX Runtime に回す
  // (ここで決めておけば、ビルドはそのまま通り、実機でも動く)。
  const runtime = resolveRuntime('auto', plain.opTypes);
  const base = {
    id: uuidv4(), name, file, format: 'onnx' as const, backend: 'auto' as const,
    runtime, includeInBuild: true, inspection: plain,
  };

  if (use === 'image') {
    const draft = suggestDefinition(inspection, labels ?? undefined);
    return { ...base, use, task: draft.task, input: draft.input, output: draft.output, labels: labels ?? undefined };
  }
  if (use === 'text') {
    return { ...base, use, text: text ?? defaultTextSpec(suggestTextTask(inspection), '') };
  }
  return { ...base, use };
}

// ---- 分割器 (tokenizer.json) と、HuggingFace の設定ファイル ----

export interface TokenizerInfo {
  /** プロジェクト相対のパス */
  tokenizer: string;
  /** 分割器の種類 (BPE / WordPiece / Unigram …) */
  kind?: string;
  chatFormat?: ChatFormatName;
  eosTokens?: string[];
  labels?: string[];
  warnings: string[];
}

async function readJson(filePath: string): Promise<any | null> {
  try {
    return (await fs.pathExists(filePath)) ? JSON.parse(await fs.readFile(filePath, 'utf8')) : null;
  } catch {
    return null;
  }
}

/**
 * モデルの隣か一つ上 (HuggingFace の onnx/ フォルダの外) にある分割器を探す。
 * tokenizer.json が無ければ、GPT-2 系の vocab.json + merges.txt (Unity の配布の data/ など) も見る。
 */
async function findTokenizerBeside(modelPath: string): Promise<string | null> {
  const dir = path.dirname(modelPath);
  const parent = path.dirname(dir);
  const base = path.basename(modelPath, path.extname(modelPath));
  for (const candidate of [
    path.join(dir, `${base}.tokenizer.json`),
    path.join(dir, 'tokenizer.json'),
    path.join(parent, 'tokenizer.json'),
  ]) {
    if (await fs.pathExists(candidate)) return candidate;
  }
  for (const folder of [dir, parent, path.join(parent, 'data')]) {
    const vocab = path.join(folder, 'vocab.json');
    if ((await fs.pathExists(vocab)) && (await fs.pathExists(path.join(folder, 'merges.txt')))) return vocab;
  }
  return null;
}

/**
 * GPT-2 系の vocab.json + merges.txt から tokenizer.json を組み立てる (byte-level BPE)。
 * HuggingFace が「slow tokenizer」の形で配っているもの (GPT-2 / GPT-Neo / TinyStories …) を、
 * ランタイムが読む一つの形に揃えるため。中身は変えない。
 */
export function tokenizerJsonFromVocabMerges(vocabText: string, mergesText: string): string {
  const vocab = JSON.parse(vocabText) as Record<string, number>;
  const merges = mergesText.split(/\r?\n/).filter((line) => line.length > 0 && !line.startsWith('#version'));
  const added = ['<|endoftext|>']
    .filter((token) => typeof vocab[token] === 'number')
    .map((token) => ({ id: vocab[token], content: token, single_word: false, lstrip: false, rstrip: false, normalized: false, special: true }));
  return JSON.stringify({
    version: '1.0',
    added_tokens: added,
    normalizer: null,
    pre_tokenizer: { type: 'ByteLevel', add_prefix_space: false, trim_offsets: true, use_regex: true },
    post_processor: { type: 'ByteLevel', add_prefix_space: true, trim_offsets: false, use_regex: true },
    decoder: { type: 'ByteLevel', add_prefix_space: true, trim_offsets: true, use_regex: true },
    model: { type: 'BPE', dropout: null, unk_token: null, continuing_subword_prefix: '', end_of_word_suffix: '', fuse_unk: false, vocab, merges },
  });
}

/** tokenizer.json の中身を読む。vocab.json が渡されたら隣の merges.txt と合わせて組み立てる。 */
async function readTokenizerSource(tokenizerPath: string): Promise<string> {
  if (path.basename(tokenizerPath).toLowerCase() === 'vocab.json') {
    const merges = path.join(path.dirname(tokenizerPath), 'merges.txt');
    if (!(await fs.pathExists(merges))) throw new Error('mergesMissing');
    return tokenizerJsonFromVocabMerges(await fs.readFile(tokenizerPath, 'utf8'), await fs.readFile(merges, 'utf8'));
  }
  return fs.readFile(tokenizerPath, 'utf8');
}

/** chat_template (Jinja) の中身から、よく使われる書式のどれかを当てる。 */
export function chatFormatFromTemplate(template: string | undefined, vocab: Set<string>): ChatFormatName {
  const t = template ?? '';
  const has = (s: string) => t.includes(s) || vocab.has(s);
  if (has('<|im_start|>')) return 'chatml';
  if (has('<|start_header_id|>')) return 'llama3';
  if (t.includes('<|user|>') || (vocab.has('<|user|>') && vocab.has('<|end|>'))) return 'phi3';
  if (has('<start_of_turn>')) return 'gemma';
  if (t.includes('[INST]')) return 'mistral';
  return 'none';
}

function tokenContent(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { content?: unknown }).content === 'string') return (raw as { content: string }).content;
  return undefined;
}

/**
 * tokenizer.json をプロジェクトに取り込み、隣の設定ファイルから分かることを返す。
 * Unigram (T5 / XLM-R) はランタイムが対応していないので、取り込むが警告を付ける。
 */
export async function importTokenizer(projectPath: string, tokenizerPath: string, baseName: string): Promise<TokenizerInfo> {
  return tokenizerInfo(tokenizerPath, { projectPath, baseName });
}

/**
 * 分割器を読んで分かることを返す。
 * `copy` を渡すとプロジェクトに写し (手元のファイルからの取り込み)、渡さなければその場のパスを指す
 * (Hugging Face から落としたものは既に Assets/Models の下にある)。
 */
export async function tokenizerInfo(
  tokenizerPath: string,
  copy?: { projectPath: string; baseName: string },
): Promise<TokenizerInfo> {
  const warnings: string[] = [];
  const text = await readTokenizerSource(tokenizerPath);
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('tokenizerUnreadable');
  }
  const kind: string | undefined = parsed?.model?.type ?? (Array.isArray(parsed?.model?.merges) ? 'BPE' : undefined);
  if (kind === 'Unigram') warnings.push('tokenizerUnigram');

  let relativeTokenizer: string;
  if (copy) {
    const destDir = path.join(copy.projectPath, 'Assets', 'Models');
    await fs.ensureDir(destDir);
    const hash = createHash('sha1').update(text).digest('hex').slice(0, 8);
    const safeBase = copy.baseName.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40) || 'model';
    const fileName = `${safeBase}_${hash}.tokenizer.json`;
    await fs.writeFile(path.join(destDir, fileName), text);
    relativeTokenizer = path.join('Assets', 'Models', fileName).replace(/\\/g, '/');
  } else {
    // 既にプロジェクトの中にあるので、そのまま指す (大きな tokenizer.json を二重に持たない)
    relativeTokenizer = tokenizerPath.replace(/\\/g, '/');
    const marker = '/Assets/Models/';
    const at = relativeTokenizer.indexOf(marker);
    if (at >= 0) relativeTokenizer = relativeTokenizer.slice(at + 1);
  }

  // 語彙 (特別なトークンの有無で書式を当てる / 番号 → 文字列)
  const vocab = new Set<string>();
  const idToToken = new Map<number, string>();
  for (const [token, id] of Object.entries((parsed?.model?.vocab ?? {}) as Record<string, number>)) {
    vocab.add(token);
    if (typeof id === 'number') idToToken.set(id, token);
  }
  for (const added of (parsed?.added_tokens ?? []) as Array<{ id: number; content: string }>) {
    vocab.add(added.content);
    idToToken.set(added.id, added.content);
  }

  const dir = path.dirname(tokenizerPath);
  const config = await readJson(path.join(dir, 'tokenizer_config.json'));
  const generation = await readJson(path.join(dir, 'generation_config.json'));
  const modelConfig = await readJson(path.join(dir, 'config.json'));

  const eos = new Set<string>();
  const eosFromConfig = tokenContent(config?.eos_token);
  if (eosFromConfig) eos.add(eosFromConfig);
  const eosIds = generation?.eos_token_id ?? modelConfig?.eos_token_id;
  for (const id of Array.isArray(eosIds) ? eosIds : eosIds !== undefined ? [eosIds] : []) {
    const token = idToToken.get(Number(id));
    if (token) eos.add(token);
  }

  // 設定ファイルが無い配布 (vocab.json + merges.txt だけ、など) は、よくある終わりのトークンを探す
  if (eos.size === 0) {
    const specials = new Set(((parsed?.added_tokens ?? []) as Array<{ content: string; special?: boolean }>).filter((a) => a.special).map((a) => a.content));
    for (const candidate of ['<|endoftext|>', '</s>', '<|end_of_text|>', '<eos>']) {
      if (specials.has(candidate)) { eos.add(candidate); break; }
    }
  }

  let labels: string[] | undefined;
  const id2label = modelConfig?.id2label;
  if (id2label && typeof id2label === 'object') {
    labels = Object.entries(id2label as Record<string, string>)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, v]) => String(v));
  }

  // 新しい配布は Jinja の型を別ファイルに置く
  let template = typeof config?.chat_template === 'string' ? config.chat_template : undefined;
  if (!template) {
    const jinja = path.join(dir, 'chat_template.jinja');
    if (await fs.pathExists(jinja)) template = await fs.readFile(jinja, 'utf8');
  }
  return {
    tokenizer: relativeTokenizer,
    kind,
    chatFormat: chatFormatFromTemplate(template, vocab),
    eosTokens: [...eos],
    labels,
    warnings,
  };
}

/** 取り込んだ分割器の情報を文章のモデルの設定に反映する。 */
export function applyTokenizerInfo(spec: TextModelSpec, info: TokenizerInfo): TextModelSpec {
  const next: TextModelSpec = { ...spec, tokenizer: info.tokenizer };
  if (spec.task === 'generate') {
    if (info.chatFormat) next.chatFormat = info.chatFormat;
    if (info.eosTokens && info.eosTokens.length > 0) next.eosTokens = info.eosTokens;
  }
  if (spec.task === 'classify' && info.labels && info.labels.length > 0) next.labels = info.labels;
  return next;
}

export async function importModel(projectPath: string, sourcePath: string): Promise<ModelImportResult> {
  try {
    if (!projectPath || !sourcePath) return { success: false, error: 'projectPath/sourcePath is required' };
    if (!(await fs.pathExists(sourcePath))) return { success: false, error: `Source not found: ${sourcePath}` };

    const ext = path.extname(sourcePath).toLowerCase();
    if (ext !== '.onnx') {
      return { success: false, error: 'notOnnx' };
    }

    // 取り込む前に読む。壊れたファイルをコピーしてから気付くのは無駄。
    const inspection = await inspectOnnxFile(sourcePath);

    const destDir = path.join(projectPath, 'Assets', 'Models');
    await fs.ensureDir(destDir);

    const baseName = path.basename(sourcePath, ext);
    const safeBase = baseName.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40) || 'model';

    let fileName: string;
    if (inspection.externalDataFiles.length > 0) {
      // 外部の重みはモデルの中に「ファイル名」で書かれているので、モデル側の名前も変えない。
      fileName = `${safeBase}${ext}`;
      for (const external of inspection.externalDataFiles) {
        const from = path.join(path.dirname(sourcePath), external);
        if (!(await fs.pathExists(from))) return { success: false, error: `externalDataMissing:${external}` };
        await fs.copyFile(from, path.join(destDir, external));
      }
    } else {
      const hash = createHash('sha1').update(await fs.readFile(sourcePath)).digest('hex').slice(0, 8);
      fileName = `${safeBase}_${hash}${ext}`;
    }

    const destAbs = path.join(destDir, fileName);
    await fs.copyFile(sourcePath, destAbs);

    const labels = await findLabelsBeside(sourcePath);
    if (labels) {
      await fs.writeFile(path.join(destDir, `${path.basename(fileName, ext)}.labels.txt`), labels.join('\n'));
    }

    const rel = path.join('Assets', 'Models', fileName).replace(/\\/g, '/');
    const warnings = [...inspection.warnings];

    // 文章のモデルなら分割器も一緒に
    let text: TextModelSpec | undefined;
    if (suggestUse(inspection) === 'text') {
      text = defaultTextSpec(suggestTextTask(inspection), '');
      const tokenizerPath = await findTokenizerBeside(sourcePath);
      if (tokenizerPath) {
        const info = await importTokenizer(projectPath, tokenizerPath, baseName);
        text = applyTokenizerInfo(text, info);
        warnings.push(...info.warnings);
      } else {
        warnings.push('tokenizerMissing');
      }
    }

    // HuggingFace の onnx/model.onnx は名前が皆 "model" なので、一つ上のフォルダ名を使う
    const displayName = baseName === 'model' || baseName.startsWith('model_')
      ? path.basename(path.dirname(path.dirname(sourcePath))) || baseName
      : baseName;

    return {
      success: true,
      model: draftDefinition(displayName, rel, inspection, labels, text),
      warnings,
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * 既にプロジェクトの中にあるファイルを取り込む (Hugging Face から落としたもの)。
 * 大きな ONNX を二重に持たないよう、コピーはしない。
 */
export async function importDownloadedModel(projectPath: string, modelFile: string, displayName?: string): Promise<ModelImportResult> {
  try {
    const absolute = path.isAbsolute(modelFile) ? modelFile : path.join(projectPath, modelFile);
    if (!(await fs.pathExists(absolute))) return { success: false, error: 'fileMissing' };

    const inspection = await inspectOnnxFile(absolute);
    const warnings = [...inspection.warnings];
    const relative = path.relative(projectPath, absolute).replace(/\\/g, '/');
    const folder = path.dirname(absolute);
    const baseName = path.basename(absolute, path.extname(absolute));

    let text: TextModelSpec | undefined;
    if (suggestUse(inspection) === 'text') {
      text = defaultTextSpec(suggestTextTask(inspection), '');
      const tokenizerPath = (await fs.pathExists(path.join(folder, 'tokenizer.json')))
        ? path.join(folder, 'tokenizer.json')
        : (await fs.pathExists(path.join(folder, 'vocab.json'))) ? path.join(folder, 'vocab.json') : null;
      if (tokenizerPath) {
        const info = await tokenizerInfo(tokenizerPath, path.basename(tokenizerPath) === 'vocab.json' ? { projectPath, baseName } : undefined);
        text = applyTokenizerInfo(text, info);
        warnings.push(...info.warnings);
      } else {
        warnings.push('tokenizerMissing');
      }
    }

    const labels = await findLabelsBeside(absolute);
    return { success: true, model: draftDefinition(displayName || baseName, relative, inspection, labels, text), warnings };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/** 取り込み済みのモデルをもう一度調べる (ファイルを差し替えたときなど)。 */
export async function inspectProjectModel(projectPath: string, file: string): Promise<
  { success: true; inspection: InspectedModel } | { success: false; error: string }
> {
  try {
    const abs = path.isAbsolute(file) ? file : path.join(projectPath, file);
    if (!(await fs.pathExists(abs))) return { success: false, error: 'fileMissing' };
    return { success: true, inspection: await inspectOnnxFile(abs) };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
