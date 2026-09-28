/**
 * ONNX ファイルを読んで、入出力の名前と形、opset、使われている演算子を取り出す。
 *
 * 目的はふたつ:
 *   1. モデル定義 (ModelDefinition) の下書きを自動で埋め、ユーザーが「入力は 224x224 の
 *      NCHW で…」を手で調べなくて済むようにする
 *   2. Unity の Inference Engine で動かないもの (独自ドメインの演算子、対応外の opset) を
 *      実機に持っていく前に指摘する
 *
 * 読むのはヘッダ相当の部分だけで、重みの中身には触れない。
 */
import * as fs from 'fs-extra';
import type { ModelInputSpec, ModelInspection, ModelOutputSpec, ModelTask, ModelUse, TextModelTask } from '../../shared/types';
import { fieldBytes, fieldNumber, fieldString, readFields, type ProtoField } from './protobuf';
import { unsupportedOnDevice } from '../../shared/unityOps';

// onnx.proto3 のフィールド番号
const MODEL = { irVersion: 1, producerName: 2, graph: 7, opsetImport: 8 } as const;
const OPSET = { domain: 1, version: 2 } as const;
const GRAPH = { node: 1, initializer: 5, input: 11, output: 12 } as const;
const NODE = { opType: 4, domain: 7 } as const;
const VALUE_INFO = { name: 1, type: 2 } as const;
const TYPE = { tensorType: 1 } as const;
const TENSOR_TYPE = { elemType: 1, shape: 2 } as const;
const SHAPE = { dim: 1 } as const;
const DIM = { dimValue: 1, dimParam: 2 } as const;
const TENSOR = { name: 8, externalData: 13 } as const;
const STRING_ENTRY = { key: 1, value: 2 } as const;

const ELEM_TYPES: Record<number, string> = {
  1: 'float32', 2: 'uint8', 3: 'int8', 4: 'uint16', 5: 'int16', 6: 'int32', 7: 'int64',
  8: 'string', 9: 'bool', 10: 'float16', 11: 'float64', 12: 'uint32', 13: 'uint64', 16: 'bfloat16',
};

/**
 * Unity Inference Engine が読める opset の範囲。
 * 2.6 以降は 25 まで公式対応 (それ以前は 7〜15)。範囲外は import できても結果が怪しい。
 */
export const SUPPORTED_OPSET = { min: 7, max: 25 };

export interface InspectedModel extends ModelInspection {
  /** 重みを別ファイルに持つモデルが参照しているファイル名 (モデルと同じフォルダに要る) */
  externalDataFiles: string[];
  /** 人が読む注意点 (i18n: model.warning.<key>)。空なら問題なし */
  warnings: string[];
}

function parseValueInfo(bytes: Uint8Array): { name: string; dims: Array<number | string>; elemType?: string } {
  let name = '';
  let dims: Array<number | string> = [];
  let elemType: string | undefined;

  for (const field of readFields(bytes)) {
    if (field.num === VALUE_INFO.name) name = fieldString(field);
    if (field.num !== VALUE_INFO.type) continue;

    for (const typeField of readFields(fieldBytes(field))) {
      if (typeField.num !== TYPE.tensorType) continue; // sequence / map は画像モデルでは出てこない
      for (const tensorField of readFields(fieldBytes(typeField))) {
        if (tensorField.num === TENSOR_TYPE.elemType) {
          elemType = ELEM_TYPES[fieldNumber(tensorField)] ?? `type${fieldNumber(tensorField)}`;
        } else if (tensorField.num === TENSOR_TYPE.shape) {
          dims = readFields(fieldBytes(tensorField))
            .filter((d) => d.num === SHAPE.dim)
            .map((d) => {
              let value: number | string = -1;
              for (const dimField of readFields(fieldBytes(d))) {
                if (dimField.num === DIM.dimValue) value = fieldNumber(dimField);
                else if (dimField.num === DIM.dimParam) value = fieldString(dimField);
              }
              return value;
            });
        }
      }
    }
  }
  return { name, dims, elemType };
}

/** 重みテンソルから、名前と (あれば) 外部ファイルの場所だけを拾う。中身には触れない。 */
function parseInitializer(bytes: Uint8Array): { name: string; location?: string } {
  let name = '';
  let location: string | undefined;
  for (const field of readFields(bytes)) {
    if (field.num === TENSOR.name) name = fieldString(field);
    else if (field.num === TENSOR.externalData) {
      let key = '';
      let value = '';
      for (const entry of readFields(fieldBytes(field))) {
        if (entry.num === STRING_ENTRY.key) key = fieldString(entry);
        else if (entry.num === STRING_ENTRY.value) value = fieldString(entry);
      }
      if (key === 'location') location = value;
    }
  }
  return { name, location };
}

export function inspectOnnxBuffer(buffer: Uint8Array): InspectedModel {
  let irVersion: number | undefined;
  let producer: string | undefined;
  let opset: number | undefined;
  const customDomains = new Set<string>();
  const opTypes = new Set<string>();
  const inputs: InspectedModel['inputs'] = [];
  const outputs: InspectedModel['outputs'] = [];
  const initializerNames = new Set<string>();
  const externalDataFiles = new Set<string>();

  let fields: ProtoField[];
  try {
    fields = readFields(buffer);
  } catch (e) {
    throw new Error(`not an ONNX file: ${(e as Error).message}`);
  }

  let sawGraph = false;
  for (const field of fields) {
    switch (field.num) {
      case MODEL.irVersion: irVersion = fieldNumber(field); break;
      case MODEL.producerName: producer = fieldString(field); break;
      case MODEL.opsetImport: {
        let domain = '';
        let version = 0;
        for (const f of readFields(fieldBytes(field))) {
          if (f.num === OPSET.domain) domain = fieldString(f);
          else if (f.num === OPSET.version) version = fieldNumber(f);
        }
        if (domain === '' || domain === 'ai.onnx') opset = version;
        else customDomains.add(domain);
        break;
      }
      case MODEL.graph: {
        sawGraph = true;
        for (const g of readFields(fieldBytes(field))) {
          switch (g.num) {
            case GRAPH.node: {
              let opType = '';
              let domain = '';
              for (const n of readFields(fieldBytes(g))) {
                if (n.num === NODE.opType) opType = fieldString(n);
                else if (n.num === NODE.domain) domain = fieldString(n);
              }
              if (opType) opTypes.add(opType);
              if (domain && domain !== 'ai.onnx') customDomains.add(domain);
              break;
            }
            case GRAPH.initializer: {
              const init = parseInitializer(fieldBytes(g));
              if (init.name) initializerNames.add(init.name);
              if (init.location) externalDataFiles.add(init.location);
              break;
            }
            case GRAPH.input: inputs.push(parseValueInfo(fieldBytes(g))); break;
            case GRAPH.output: outputs.push(parseValueInfo(fieldBytes(g))); break;
          }
        }
        break;
      }
    }
  }

  if (!sawGraph) throw new Error('not an ONNX file: no graph');

  // 古い書き出しは重みも graph.input に並べる。本当の入力だけ残す。
  const realInputs = inputs.filter((i) => !initializerNames.has(i.name));

  const warnings: string[] = [];
  if (opset !== undefined && (opset < SUPPORTED_OPSET.min || opset > SUPPORTED_OPSET.max)) {
    warnings.push(`opset:${opset}`);
  }
  // 実機 (Unity) の取り込みが扱えない演算子。「試す」では動くのにビルドで止まる、を取り込み時に知らせる。
  const unsupported = unsupportedOnDevice([...opTypes]);
  if (unsupported.length > 0) warnings.push(`unsupportedOps:${unsupported.join(',')}`);
  else if (customDomains.size > 0) warnings.push(`customDomains:${[...customDomains].join(',')}`);
  if (realInputs.length === 0) warnings.push('noInputs');
  if (externalDataFiles.size > 0) warnings.push(`externalData:${[...externalDataFiles].join(',')}`);

  return {
    irVersion,
    opset,
    producer,
    inputs: realInputs,
    outputs,
    opTypes: [...opTypes].sort(),
    customDomains: [...customDomains],
    fileSize: buffer.length,
    externalDataFiles: [...externalDataFiles],
    warnings,
  };
}

export async function inspectOnnxFile(filePath: string): Promise<InspectedModel> {
  const buffer = await fs.readFile(filePath);
  return inspectOnnxBuffer(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
}

// ---- 定義の下書き ---------------------------------------------------------

const isNum = (d: number | string): d is number => typeof d === 'number' && d > 0;

/**
 * 入出力の形から、モデル定義の下書きを作る。
 *
 * 当てずっぽうではあるが、よくある書き出し (torchvision / timm の分類、Ultralytics の検出、
 * セグメンテーションの [1,C,H,W]) はこれで合う。外れたらユーザーが直す前提で、
 * 何も埋まっていない画面を見せるよりはずっとよい。
 */
/**
 * 何に使うモデルか。
 *   input_ids (整数) を取る → 文章のモデル
 *   [1,3,H,W] / [1,H,W,3] の float を 1 本取る → 画像のモデル
 *   それ以外 → テンソルのモデル (スクリプトから名前つきで流す)
 */
export function suggestUse(inspection: ModelInspection): ModelUse {
  const inputs = inspection.inputs ?? [];
  if (inputs.some((i) => i.name === 'input_ids' || (i.dims.length === 2 && (i.elemType === 'int64' || i.elemType === 'int32') && /ids$/i.test(i.name)))) {
    return 'text';
  }
  // 名前が input_ids でなくても、整数の [batch, 長さ] を取り、語彙ぶんの幅 [.., .., V] を出すなら言語モデル
  // (Unity の inference-engine-tiny-stories など)
  if (inputs.length >= 1 && inputs[0].dims.length === 2 && (inputs[0].elemType === 'int64' || inputs[0].elemType === 'int32') && looksLikeLogits(inspection)) {
    return 'text';
  }
  const first = inputs[0];
  if (first && inputs.length === 1 && first.dims.length === 4 && (first.elemType === undefined || first.elemType === 'float32' || first.elemType === 'uint8' || first.elemType === 'float16')) {
    const c1 = first.dims[1];
    const c3 = first.dims[3];
    if (c1 === 1 || c1 === 3 || c3 === 1 || c3 === 3) return 'image';
  }
  return 'tensor';
}

/** 最初の出力が [batch, 長さ, 語彙] (語彙は 1000 以上) か。 */
function looksLikeLogits(inspection: ModelInspection): boolean {
  const first = inspection.outputs?.[0];
  if (!first || first.dims.length !== 3) return false;
  const vocab = first.dims[2];
  return typeof vocab === 'number' && vocab >= 1000;
}

/** 文章のモデルが何をするか (LLM / 埋め込み / 分類)。 */
export function suggestTextTask(inspection: ModelInspection): TextModelTask {
  const inputs = inspection.inputs ?? [];
  const outputs = inspection.outputs ?? [];
  if (inputs.some((i) => i.name.startsWith('past_key_values') || i.name.startsWith('past.'))) return 'generate';
  const logits = outputs.find((o) => o.name === 'logits');
  if (logits && logits.dims.length === 3) return 'generate';
  if (looksLikeLogits(inspection)) return 'generate';
  if (outputs.some((o) => ['sentence_embedding', 'last_hidden_state', 'embeddings', 'text_embeds'].includes(o.name))) return 'embed';
  if (logits && logits.dims.length === 2) return 'classify';
  const first = outputs[0];
  if (first && first.dims.length === 2) return 'classify';
  return 'embed';
}

export function suggestDefinition(
  inspection: ModelInspection,
  labels?: string[],
): { task: ModelTask; input: ModelInputSpec; output: ModelOutputSpec } {
  const input = inspection.inputs[0];
  const dims = input?.dims ?? [];

  // ---- 入力 ----
  let layout: 'NCHW' | 'NHWC' = 'NCHW';
  let channels: 1 | 3 = 3;
  let width = 0;
  let height = 0;
  if (dims.length === 4) {
    const c1 = dims[1];
    const c3 = dims[3];
    if (isNum(c3) && (c3 === 1 || c3 === 3) && !(isNum(c1) && (c1 === 1 || c1 === 3))) {
      layout = 'NHWC';
      channels = c3 as 1 | 3;
      if (isNum(dims[1])) height = dims[1];
      if (isNum(dims[2])) width = dims[2];
    } else {
      layout = 'NCHW';
      if (isNum(c1) && (c1 === 1 || c1 === 3)) channels = c1 as 1 | 3;
      if (isNum(dims[2])) height = dims[2];
      if (isNum(dims[3])) width = dims[3];
    }
  }

  // ---- 出力から task を推す ----
  const output = inspection.outputs[0];
  const outDims = (output?.dims ?? []).map((d) => (isNum(d) ? d : -1));
  const ops = new Set(inspection.opTypes ?? []);
  const labelCount = labels?.length ?? 0;

  let task: ModelTask = 'raw';
  const outputSpec: ModelOutputSpec = { name: output?.name };

  if (outDims.length === 2 && (outDims[1] > 1 || outDims[1] === -1)) {
    task = 'classify';
    outputSpec.softmax = !ops.has('Softmax');
    outputSpec.topK = 5;
  } else if (outDims.length === 3 && (outDims[2] === 6 || ops.has('NonMaxSuppression'))) {
    task = 'detect';
    outputSpec.boxLayout = 'xyxyScoreClass';
    outputSpec.boxFormat = 'xyxy';
    outputSpec.boxesNormalized = false;
    outputSpec.scoreThreshold = 0.35;
    outputSpec.iouThreshold = 0.5;
    outputSpec.maxItems = 20;
  } else if (outDims.length === 3 && Math.max(outDims[1], outDims[2]) >= 100) {
    // [1, 4+C, N] (YOLOv8/11) か [1, N, 5+C] (YOLOv5)。小さい方がチャンネル、大きい方が候補数。
    task = 'detect';
    const channelsDim = Math.min(outDims[1], outDims[2]);
    const yolo5 = labelCount > 0 ? channelsDim === labelCount + 5 : channelsDim === 85;
    outputSpec.boxLayout = yolo5 ? 'yolo5' : 'yolo';
    outputSpec.boxFormat = 'cxcywh';
    outputSpec.boxesNormalized = false;
    outputSpec.scoreThreshold = 0.35;
    outputSpec.iouThreshold = 0.5;
    outputSpec.maxItems = 20;
  } else if (outDims.length === 4 && (outDims[2] > 8 || outDims[2] === -1) && (outDims[3] > 8 || outDims[3] === -1)) {
    task = 'segment';
    const c = outDims[1];
    if (c === 1) {
      outputSpec.maskMode = 'sigmoid';
      outputSpec.maskThreshold = 0.5;
      outputSpec.applySigmoid = !ops.has('Sigmoid');
    } else {
      outputSpec.maskMode = 'argmax';
      outputSpec.classIndices = [1];
    }
  } else if (outDims.length === 3 && outDims[1] > 8 && outDims[2] > 8) {
    task = 'segment';
    outputSpec.maskMode = 'sigmoid';
    outputSpec.maskThreshold = 0.5;
  } else {
    outputSpec.rawLimit = 16;
  }

  const looksLikeYolo = task === 'detect';
  if (width === 0) width = looksLikeYolo ? 640 : 224;
  if (height === 0) height = looksLikeYolo ? 640 : 224;

  const isUint8 = input?.elemType === 'uint8';
  const plain = looksLikeYolo || channels === 1 || isUint8;
  return {
    task,
    input: {
      name: input?.name,
      width,
      height,
      layout,
      channels,
      colorOrder: 'RGB',
      scale: isUint8 ? 1 : 1 / 255,
      // torchvision 系は ImageNet 正規化、YOLO 系は 0..1 のまま
      mean: plain ? new Array(channels).fill(0) : [0.485, 0.456, 0.406],
      std: plain ? new Array(channels).fill(1) : [0.229, 0.224, 0.225],
      resize: looksLikeYolo ? 'letterbox' : 'stretch',
      padValue: 114,
    },
    output: outputSpec,
  };
}
