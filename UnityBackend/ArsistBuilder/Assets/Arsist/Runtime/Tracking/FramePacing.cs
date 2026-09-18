// ==============================================
// Arsist Engine - Tracking
// スマホで何 fps で描くか
//
// Unity は Android では、明示しない限り画面のリフレッシュレートに関係なく 30fps に固定する
// (Application.targetFrameRate = -1 のとき。公式リファレンスに明記)。
// ジャイロで見回すアプリで 30fps だと、首を振るたびにカクつく。
//
// ただしリフレッシュレートを割り切れない値にすると、フレームの表示間隔が不揃いになって
// かえってガタつく (120Hz の画面で 50fps など)。なので「60 以上で、リフレッシュレートを
// 割り切る値」を選ぶ: 120Hz → 60, 90Hz → 90, 60Hz → 60, 144Hz → 72。
//
// UnityEngine に依存しないので tools/perception-check で検証している。
// ==============================================

using System;

namespace Arsist.Runtime.Tracking
{
    public static class FramePacing
    {
        /// <summary>これ未満にはしない。ジャイロで見回すなら 60 は要る。</summary>
        public const int MinimumFps = 60;

        /// <param name="refreshHz">画面のリフレッシュレート。取れなければ 0 以下。</param>
        public static int TargetFor(double refreshHz)
        {
            if (refreshHz <= 1 || double.IsNaN(refreshHz)) return MinimumFps;

            // 60fps 以下の画面なら、その画面の上限で描く。
            if (refreshHz <= MinimumFps + 0.5) return (int)Math.Round(refreshHz);

            // リフレッシュレートを整数で割って、60 以上を保てる一番大きな割り方を選ぶ。
            int divisor = Math.Max(1, (int)Math.Floor(refreshHz / MinimumFps + 1e-9));
            return (int)Math.Round(refreshHz / divisor);
        }
    }
}
