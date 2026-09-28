/**
 * Unity Inference Engine (com.unity.ai.inference 2.6.1) の ONNX 取り込みが扱える演算子。
 * パッケージの Editor/ONNX/ONNXModelConverter.cs の s_OperatorTypeMap をそのまま写したもの。
 * パッケージの版を上げたら、ここも見直す (UnityBuilder の INFERENCE_PACKAGE_VERSION と揃える)。
 *
 * ここに無い演算子を使う ONNX は、エディタの「試す」(ONNX Runtime) では動くのに、
 * ビルドで Unity への取り込みが失敗する。取り込み時に名指しで知らせるために使う。
 * よくある例:
 *   If / Loop                          Optimum の「merged」な LLM の書き出し (decoder_model_merged.onnx)
 *   GroupQueryAttention / RotaryEmbedding / SimplifiedLayerNormalization …
 *                                      ONNX Runtime 向けに最適化した書き出し (com.microsoft)
 */
export const UNITY_ONNX_OPS: ReadonlySet<string> = new Set([
  'Constant', 'Celu', 'Elu', 'Erf', 'Gelu', 'Hardmax', 'HardSigmoid', 'HardSwish', 'LeakyRelu', 'Mish', 'PRelu', 'Relu',
  'Selu', 'Sigmoid', 'Softplus', 'Softsign', 'Tanh', 'ThresholdedRelu', 'LogSoftmax', 'Softmax', 'Conv', 'ConvTranspose',
  'Shape', 'Size', 'ConstantOfShape', 'Range', 'OneHot', 'ArgMax', 'ArgMin', 'Gather', 'GatherElements', 'GatherND',
  'NonZero', 'Scatter', 'ScatterElements', 'ScatterND', 'TopK', 'And', 'Compress', 'Equal', 'Greater', 'GreaterOrEqual',
  'IsInf', 'IsNaN', 'Less', 'LessOrEqual', 'Not', 'Or', 'Xor', 'Where', 'Abs', 'Add', 'BitwiseAnd', 'BitwiseNot',
  'BitwiseOr', 'BitwiseXor', 'Ceil', 'Clip', 'CumSum', 'Div', 'Einsum', 'Exp', 'Floor', 'Gemm', 'Log', 'MatMul', 'Max',
  'Mean', 'Min', 'Mod', 'Mul', 'Neg', 'Pow', 'Reciprocal', 'Round', 'Shrink', 'Sign', 'Sqrt', 'Sub', 'Sum',
  'BatchNormalization', 'InstanceNormalization', 'LayerNormalization', 'RMSNormalization', 'LRN', 'NonMaxSuppression',
  'RoiAlign', 'AveragePool', 'GlobalAveragePool', 'GlobalMaxPool', 'MaxPool', 'Bernoulli', 'Multinomial', 'RandomNormal',
  'RandomNormalLike', 'RandomUniform', 'RandomUniformLike', 'LSTM', 'ReduceLogSum', 'ReduceLogSumExp', 'ReduceMax',
  'ReduceMean', 'ReduceMin', 'ReduceProd', 'ReduceSum', 'ReduceSumSquare', 'BlackmanWindow', 'DFT', 'HammingWindow',
  'HannWindow', 'MelWeightMatrix', 'STFT', 'Cast', 'CastLike', 'Concat', 'DepthToSpace', 'Expand', 'Flatten', 'GridSample',
  'Dropout', 'Identity', 'Pad', 'Reshape', 'Resize', 'Slice', 'SpaceToDepth', 'Split', 'Squeeze', 'Tile', 'Transpose',
  'Trilu', 'Upsample', 'Unsqueeze', 'Acos', 'Acosh', 'Asin', 'Asinh', 'Atan', 'Atanh', 'Cos', 'Cosh', 'Sin', 'Sinh',
  'Tan', 'Swish', 'ImageScaler',
]);

/** 実機 (Unity) で動かない演算子。無ければ空。 */
export function unsupportedOnDevice(opTypes: readonly string[] | undefined): string[] {
  return (opTypes ?? []).filter((op) => !UNITY_ONNX_OPS.has(op));
}

/**
 * 実機でどちらの推論器を使うか (IR の runtime が 'auto' のときの判断)。
 * Unity の Inference Engine が読めない演算子が 1 つでもあれば、同梱の ONNX Runtime に回す。
 */
export function resolveRuntime(
  runtime: 'auto' | 'unity' | 'onnxruntime' | undefined,
  opTypes: readonly string[] | undefined,
): 'unity' | 'onnxruntime' {
  if (runtime === 'unity' || runtime === 'onnxruntime') return runtime;
  return unsupportedOnDevice(opTypes).length > 0 ? 'onnxruntime' : 'unity';
}
