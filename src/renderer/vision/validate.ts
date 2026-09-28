/**
 * パイプラインの結線チェック。
 *
 * これは `VisionPipelineRunner.Validate` (C#) と同じ判定を、エディタ側でも
 * 使えるようにしたもの。**二重実装なので、片方を直したら必ず両方直すこと。**
 * 対になる数値検証が tools/perception-check にあり、そこが両者の答え合わせをしている。
 *
 * 実機に持っていく前に落とせる間違いは、ここで落としたい。ビルドは通るのに
 * 何も起きないアプリが出来上がるのが、一番デバッグしにくい。
 */
import type { ModelDefinition, VisionPipeline } from '../../shared/types';
import { OP_BY_NAME, SOURCE_NAME, canBypass, outputKindOf, type VisionValueKind } from './opCatalog';

export interface PipelineProblem {
  /** 問題のある op / output の id。全体の問題なら undefined */
  opId?: string;
  message: string;
}

/** 各値名がその時点で何型かを返す。UI の結線候補にも使う。 */
export function inferTypes(pipeline: VisionPipeline, models: ModelDefinition[] = []): Map<string, VisionValueKind> {
  const types = new Map<string, VisionValueKind>([[SOURCE_NAME, 'color']]);
  let previous = SOURCE_NAME;

  for (const op of pipeline.ops ?? []) {
    const definition = OP_BY_NAME.get(op.op);
    if (!definition || !op.out) continue;

    const inputs = op.in && op.in.length > 0 ? op.in : [previous];
    let wired = true;
    for (let i = 0; i < definition.inputs.length; i++) {
      if (types.get(inputs[i]) !== definition.inputs[i]) { wired = false; break; }
    }
    if (!wired) continue;

    // 外した op は素通し: 出力は最初の入力そのもの
    types.set(op.out, op.disabled && canBypass(op, models) ? types.get(inputs[0])! : outputKindOf(op, models));
    previous = op.out;
  }
  return types;
}

export function validatePipeline(pipeline: VisionPipeline, models: ModelDefinition[] = []): PipelineProblem[] {
  const problems: PipelineProblem[] = [];
  if (!pipeline.ops || pipeline.ops.length === 0) {
    return [{ message: 'empty' }];
  }

  const types = new Map<string, VisionValueKind>([[SOURCE_NAME, 'color']]);
  const seen = new Set<string>([SOURCE_NAME]);
  let previous = SOURCE_NAME;

  for (const op of pipeline.ops) {
    const definition = OP_BY_NAME.get(op.op);
    if (!definition) {
      problems.push({ opId: op.id, message: `unknownOp:${op.op}` });
      continue;
    }
    if (!op.out) {
      problems.push({ opId: op.id, message: 'noOutputName' });
      continue;
    }
    if (seen.has(op.out)) {
      // 同じ名前を二度作ると、後ろの op がどちらを読むのか読み手に分からなくなる。
      problems.push({ opId: op.id, message: `duplicateName:${op.out}` });
    }

    const inputs = op.in && op.in.length > 0 ? op.in : [previous];
    let wired = true;
    for (let i = 0; i < definition.inputs.length; i++) {
      const name = inputs[i];
      if (name === undefined) {
        problems.push({ opId: op.id, message: `missingInput:${i + 1}` });
        wired = false;
        break;
      }
      const actual = types.get(name);
      if (actual === undefined) {
        problems.push({ opId: op.id, message: `unknownInput:${name}` });
        wired = false;
        break;
      }
      if (actual !== definition.inputs[i]) {
        problems.push({
          opId: op.id,
          message: `wrongType:${name}:${actual}:${definition.inputs[i]}`,
        });
        wired = false;
        break;
      }
    }
    if (!wired) continue;

    if (op.op === 'infer') {
      // モデルの参照は結線と同じくらい壊れやすい (消したモデルを指したまま残る)。
      // 型だけは登録して、後ろの op まで連鎖して赤くならないようにする。
      const id = op.params?.model;
      if (typeof id !== 'string' || !id) {
        problems.push({ opId: op.id, message: 'modelNotSet' });
      } else if (!models.some((m) => m.id === id)) {
        problems.push({ opId: op.id, message: `modelMissing:${id}` });
      } else if ((models.find((m) => m.id === id)?.use ?? 'image') !== 'image') {
        // 文章・テンソルのモデルはスクリプト (model.*) で使うもの。画は流せない。
        problems.push({ opId: op.id, message: `modelNotImage:${models.find((m) => m.id === id)?.name ?? id}` });
      }
    }

    if (op.disabled && !canBypass(op, models)) {
      // 型が変わる op は外せない (後ろの一手が受け取るものが無くなる)
      problems.push({ opId: op.id, message: 'cannotBypass' });
    }

    types.set(op.out, op.disabled && canBypass(op, models) ? types.get(inputs[0])! : outputKindOf(op, models));
    seen.add(op.out);
    previous = op.out;
  }

  for (const output of pipeline.outputs ?? []) {
    if (!output.value) {
      problems.push({ message: 'outputNoValue' });
      continue;
    }
    const kind = types.get(output.value);
    if (kind === undefined) {
      problems.push({ message: `outputUnknownValue:${output.value}` });
      continue;
    }

    if (output.kind === 'anchor') {
      if (kind !== 'blobs' && kind !== 'quads') {
        problems.push({ message: `outputNotAnchorable:${output.value}:${kind}` });
      }
    } else if (output.kind === 'world' || output.kind === 'image') {
      if (kind !== 'color') {
        problems.push({ message: `outputNotDrawable:${output.value}:${kind}` });
      }
      if (output.alpha) {
        const alphaKind = types.get(output.alpha);
        if (alphaKind === undefined) {
          problems.push({ message: `outputUnknownAlpha:${output.alpha}` });
        } else if (alphaKind !== 'mask') {
          problems.push({ message: `outputAlphaNotMask:${output.alpha}:${alphaKind}` });
        }
      }
      if (output.kind === 'image' && !output.bindingId) {
        problems.push({ message: 'outputNoBinding' });
      }
    } else if (!output.storeAs) {
      problems.push({ message: `outputNoKey:${output.value}` });
    }
  }

  if ((pipeline.outputs ?? []).length === 0) {
    // 出力の無いパイプラインは、走っても誰にも結果が届かない。
    problems.push({ message: 'noOutputs' });
  }

  return problems;
}
