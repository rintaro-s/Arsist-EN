// ==============================================
// Arsist Engine - Tracking
// スマホのカメラ映像と、Unity のカメラを揃える
//
// スマホ AR が成立するには、次の 2 つが揃っていないといけない:
//   1. 画像処理に渡す画の向き = 画面に映っている向き
//      WebCamTexture の画素はセンサーの向きのまま来る (多くの端末で 90° 回っている)。
//      回さずに渡すと、現実に重ねた絵が 90° 回った場所に出る。
//   2. Unity カメラの画角 = 画面に映っている映像の画角
//      背景は画面いっぱいに拡大して上下か左右が切れる。その「見えている部分」の画角に
//      Unity カメラを合わせないと、置いた物体が映像の上を滑る。
//
// どちらも符号や縦横を取り違えても動いてしまうので、UnityEngine から切り離して
// tools/perception-check で数値検証している。
// ==============================================

using System;

namespace Arsist.Runtime.Tracking
{
    public static class PhoneCameraMath
    {
        /// <summary>
        /// 時計回りの角度 (WebCamTexture.videoRotationAngle) を 90° 単位の回数にする。
        /// 端末は 0/90/180/270 しか返さないが、念のため最寄りに丸める。
        /// </summary>
        public static int QuarterTurns(int clockwiseDegrees)
        {
            int normalised = ((clockwiseDegrees % 360) + 360) % 360;
            return (int)Math.Round(normalised / 90.0) % 4;
        }

        /// <summary>回したあとの画の大きさ。90° / 270° では縦横が入れ替わる。</summary>
        public static void RotatedSize(int width, int height, int quarterTurns, out int rotatedWidth, out int rotatedHeight)
        {
            bool swap = (quarterTurns & 1) == 1;
            rotatedWidth = swap ? height : width;
            rotatedHeight = swap ? width : height;
        }

        /// <summary>
        /// 回したあとの画素 (x, y) が、元の画のどこから来たかを返す。
        /// 行は下から上 (Arsist の規約)。回転は画面に映る向きで時計回り。
        /// </summary>
        public static void SourceOf(
            int x, int y, int width, int height, int quarterTurns,
            out int sourceX, out int sourceY)
        {
            // 下から上の座標で「時計回りに回す」= 元の画を反時計回りに読み出す。
            switch (quarterTurns & 3)
            {
                case 1:
                    // 回した画は幅 = height。右上 → 元の右下…と読む。
                    sourceX = width - 1 - y;
                    sourceY = x;
                    break;
                case 2:
                    sourceX = width - 1 - x;
                    sourceY = height - 1 - y;
                    break;
                case 3:
                    sourceX = y;
                    sourceY = height - 1 - x;
                    break;
                default:
                    sourceX = x;
                    sourceY = y;
                    break;
            }
        }

        /// <summary>
        /// 画面いっぱいに拡大して映したとき (はみ出た分は切る)、
        /// 画面に見えている範囲の縦の画角を返す。これを Unity カメラの fieldOfView にする。
        /// </summary>
        /// <param name="imageWidth">回したあとの映像の幅。</param>
        /// <param name="imageHeight">回したあとの映像の高さ。</param>
        /// <param name="horizontalFovDegrees">映像全体の横の画角。</param>
        /// <param name="screenWidth">画面の幅 (px)。</param>
        /// <param name="screenHeight">画面の高さ (px)。</param>
        public static double VisibleVerticalFov(
            int imageWidth, int imageHeight, double horizontalFovDegrees,
            int screenWidth, int screenHeight)
        {
            // 映像の画素で測った焦点距離。
            double focal = (imageWidth * 0.5) / Math.Tan(horizontalFovDegrees * Math.PI / 360.0);

            // はみ出して切れる方に合わせて拡大する (隙間を作らない)。
            double scale = Math.Max((double)screenWidth / imageWidth, (double)screenHeight / imageHeight);

            // 画面の縦に収まっている映像の高さ (映像の画素)。
            double visibleHeight = screenHeight / scale;
            return 2.0 * Math.Atan(visibleHeight * 0.5 / focal) * 180.0 / Math.PI;
        }

        /// <summary>
        /// 映像全体の横の画角から、その映像の画素で測った焦点距離を返す。
        /// 画像処理の内部パラメータ (fx, fy) に使う。
        /// </summary>
        public static double FocalFromHorizontalFov(int imageWidth, double horizontalFovDegrees) =>
            (imageWidth * 0.5) / Math.Tan(horizontalFovDegrees * Math.PI / 360.0);
    }
}
