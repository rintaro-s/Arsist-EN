/**
 * モデル定義の既定値。取り込み (main) とモデルタブ (renderer) の両方が使うので shared に置く。
 * 用途を切り替えたときに、その用途の項目を埋めるのにも使う。
 */
import type { ModelDefinition, ModelInputSpec, ModelOutputSpec, ModelTask, TextModelSpec, TextModelTask } from './types';

export function defaultImageInput(): ModelInputSpec {
  return {
    width: 224, height: 224, layout: 'NCHW', channels: 3, colorOrder: 'RGB',
    scale: 1 / 255, mean: [0, 0, 0], std: [1, 1, 1], resize: 'stretch', padValue: 114,
  };
}

export function defaultImageOutput(task: ModelTask): ModelOutputSpec {
  switch (task) {
    case 'classify': return { softmax: true, topK: 5 };
    case 'detect': return { boxLayout: 'yolo', boxFormat: 'cxcywh', boxesNormalized: false, scoreThreshold: 0.35, iouThreshold: 0.5, maxItems: 20 };
    case 'segment': return { maskMode: 'argmax', classIndices: [1] };
    default: return { rawLimit: 16 };
  }
}

/** 文章のモデルの既定の設定。 */
export function defaultTextSpec(task: TextModelTask, tokenizer: string): TextModelSpec {
  if (task === 'generate') {
    return {
      task, tokenizer, chatFormat: 'chatml', maxNewTokens: 128, temperature: 0.7, topK: 40, topP: 0.95,
      repetitionPenalty: 1.1, stop: [], eosTokens: [], maxContext: 2048,
    };
  }
  return { task, tokenizer, pooling: 'mean', normalize: true, maxLength: 256 };
}

/**
 * 用途を変える。前の用途の項目は残す (戻したときに設定が消えないように)。
 * 新しい用途の項目が無ければ既定値で埋める。
 */
export function switchModelUse(model: ModelDefinition, use: ModelDefinition['use']): Partial<ModelDefinition> {
  if (use === 'image') {
    const task = model.task ?? 'raw';
    return { use, task, input: model.input ?? defaultImageInput(), output: model.output ?? defaultImageOutput(task) };
  }
  if (use === 'text') return { use, text: model.text ?? defaultTextSpec('generate', '') };
  return { use };
}
