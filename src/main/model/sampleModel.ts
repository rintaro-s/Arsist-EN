/**
 * 依存無しで作れる、動作確認用の小さな ONNX モデル。
 *
 *   channel-mean: 入力 [1,3,H,W] float → ReduceMean(axes=[2,3]) → 出力 [1,3]
 *
 * 「画の中で一番強い色チャンネルはどれか」を答える分類モデルとして使える
 * (labels = red / green / blue)。学習は要らないので、ONNX の取り込み・プレビュー・
 * 実機の Inference Engine までの道が通っているかを、ネットからモデルを落とさずに確かめられる。
 *
 *   npm run make:sample-onnx   → tools/model-samples/channel-mean.onnx
 */
import { ProtoWriter } from './protobuf';

/** onnx.proto3 のフィールド番号は OnnxInspector と同じ。 */
export function buildChannelMeanModel(options: { height?: number; width?: number; opset?: number } = {}): Uint8Array {
  const height = options.height ?? 32;
  const width = options.width ?? 32;
  const opset = options.opset ?? 13;

  const tensorType = (w: ProtoWriter, dims: number[]) => {
    w.message(1, (tensor) => {          // TypeProto.tensor_type
      tensor.int(1, 1);                 // elem_type = FLOAT
      tensor.message(2, (shape) => {    // shape
        for (const d of dims) shape.message(1, (dim) => dim.int(1, d));
      });
    });
  };

  const model = new ProtoWriter();
  model.int(1, 8);                       // ir_version
  model.string(2, 'arsist');             // producer_name
  model.message(8, (op) => op.string(1, '').int(2, opset)); // opset_import
  model.message(7, (graph) => {          // graph
    graph.string(2, 'channel_mean');
    graph.message(1, (node) => {         // node
      node.string(1, 'image');           // input
      node.string(2, 'channelMean');     // output
      node.string(3, 'mean');            // name
      node.string(4, 'ReduceMean');      // op_type
      node.message(5, (attr) => {        // attribute axes = [2, 3]
        attr.string(1, 'axes');
        attr.int(20, 7);                 // type = INTS
        attr.packedInts(8, [2, 3]);      // ints
      });
      node.message(5, (attr) => {        // attribute keepdims = 0
        attr.string(1, 'keepdims');
        attr.int(20, 2);                 // type = INT
        attr.int(3, 0);                  // i
      });
    });
    graph.message(11, (input) => {       // input
      input.string(1, 'image');
      input.message(2, (t) => tensorType(t, [1, 3, height, width]));
    });
    graph.message(12, (output) => {      // output
      output.string(1, 'channelMean');
      output.message(2, (t) => tensorType(t, [1, 3]));
    });
  });
  return model.finish();
}

export const CHANNEL_MEAN_LABELS = ['red', 'green', 'blue'];
