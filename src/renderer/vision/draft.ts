/**
 * 一手の下書きを作る: 挿入位置までにある値から、型の合う一番新しいものを自動で繋ぎ、
 * 出力の名前を種類から付ける。「一手を足す」画面の試し絵と、実際の挿入で同じ下書きを使う。
 */
import type { ModelDefinition, VisionOp, VisionOpType, VisionPipeline } from '../../shared/types';
import { OP_BY_NAME, SOURCE_NAME, defaultParams, outputKindOf, type VisionValueKind } from './opCatalog';
import { inferTypes } from './validate';

/** 出力の名前の元: 種類そのもの。人は普段これを見ない。 */
const BASE_NAME: Record<VisionValueKind, string> = {
  color: 'image', gray: 'gray', mask: 'mask', edges: 'edges', boundary: 'boundary',
  blobs: 'items', contours: 'shapes', record: 'values', quads: 'quads',
};

/** 名前が衝突しないようにする。'mask' が既にあれば 'mask2'。 */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export function draftOp(pipeline: VisionPipeline, index: number, opType: VisionOpType, models: ModelDefinition[]): VisionOp | null {
  const definition = OP_BY_NAME.get(opType);
  if (!definition) return null;

  const before: VisionPipeline = { ...pipeline, ops: pipeline.ops.slice(0, index) };
  const known = inferTypes(before, models);
  const order = [SOURCE_NAME, ...before.ops.map((o) => o.out)].reverse(); // 新しいものから
  const used = new Set<string>();
  const inputs = definition.inputs.map((kind) => {
    const fresh = order.find((name) => known.get(name) === kind && !used.has(name));
    const any = fresh ?? order.find((name) => known.get(name) === kind);
    if (any) used.add(any);
    return any ?? '';
  });

  const taken = new Set<string>([SOURCE_NAME, ...pipeline.ops.map((o) => o.out)]);
  const draft: VisionOp = { id: `${opType}-${Date.now().toString(36)}`, op: opType, out: '', in: inputs, params: defaultParams(opType) };
  if (opType === 'infer' && models.length === 1) draft.params = { model: models[0].id };
  draft.out = uniqueName(BASE_NAME[outputKindOf(draft, models)], taken);
  return draft;
}
