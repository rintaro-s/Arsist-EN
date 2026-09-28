// ==============================================
// Arsist Engine - Perception / Models
// 推論エンジンとの契約
//
// パイプラインの `infer` op から見える推論の入口はこれだけ。
//   実機:   ArsistModelExecutor (Unity Inference Engine、GPU compute か CPU)
//   エディタ: tools/vision-preview の OnnxModelRunner (ONNX Runtime)
//   検証:   tools/perception-check の偽物 (合成した出力を返す)
//
// 前処理も後処理もこの外 (ModelPreprocess / ModelPostprocess) にあり、エンジンが違っても
// 同じ画から同じ塊・マスクが出る。
//
// 呼ばれるのはワーカースレッド。実機の実装はメインスレッドで推論して待ち合わせる。
// ==============================================

using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Models
{
    public interface IVisionModelRunner
    {
        /// <summary>
        /// 入力テンソルを流し、名前つきの出力テンソルを返す。
        /// 失敗したら false と、人が読める短い理由 (modelMissing / backendFailed など)。
        /// </summary>
        bool TryRun(ModelSpec spec, TensorData input, out Dictionary<string, TensorData> outputs, out string error);
    }
}
