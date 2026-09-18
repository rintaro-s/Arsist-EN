// ==============================================
// Arsist Engine - Tracking
// スマホのカメラの画角
//
// WebCamTexture は画角を教えてくれない。背景の見え方と、画像処理の内部パラメータと、
// Unity カメラの画角が全部同じ値を使っていないと、描いたものが映像の上を滑る。
// なので値はここ一か所にしか置かない。
//
// 端末ごとの正確な値が要るなら ARCore (AR Foundation) を使うのが筋。
// こちらは ARCore の無い端末でも動かすための近似。
// ==============================================

namespace Arsist.Runtime.Tracking
{
    public static class PhoneCameraSettings
    {
        /// <summary>
        /// 背面メインカメラの横の画角 (度)。スマホの広角 (いわゆる 1x) はおおむね 60〜70°。
        /// 実機で合わないときは、ビルド設定の phoneCameraFov で上書きできる。
        /// </summary>
        public static float HorizontalFovDegrees = 63f;
    }
}
