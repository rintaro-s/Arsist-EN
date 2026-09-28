// ==============================================
// Arsist Engine - Perception
// カメラの画を「どの大きさで GPU から読み出すか」を決める
//
// 以前はカメラの生の解像度 (1280x720 や 1280x960) を毎回 CPU に写し、それから縮めていた。
// 読み出しも変換も画素数に比例するので、検出が 640 幅、画像処理が 480 幅しか使わないなら、
// GPU 側で先に縮めてから読み出す方が 4〜6 倍軽い。
//
// ただし OCR は「枠を切り出して拡大する」ので元が細かいほど良く、フル解像度を求める (0)。
// 誰か一人でもフル解像度を求めていれば、その回はフルで読む。
//
// UnityEngine に依存しない。tools/perception-check で検証する。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Perception
{
    public static class FrameBudget
    {
        /// <summary>これより小さくは縮めない。特徴点検出が成り立たなくなる。</summary>
        public const int MinWidth = 160;

        /// <summary>
        /// 読み出す幅を決める。wants は消費者ごとに要る幅 (px) で、0 は「フル解像度が要る」。
        /// 返り値 0 はフル解像度のまま。それ以外は一番大きな要求 (ただし native を超えず、MinWidth 未満にしない)。
        /// 誰も居なければフル (0)。
        /// </summary>
        public static int TargetWidth(int nativeWidth, IEnumerable<int> wants)
        {
            if (wants == null) return 0;
            int largest = -1;
            foreach (var want in wants)
            {
                if (want <= 0) return 0;         // フル解像度が要る消費者が居る
                if (want > largest) largest = want;
            }
            if (largest < 0) return 0;           // 誰も居ない
            if (largest >= nativeWidth) return 0; // 拡大はしない
            return Math.Max(MinWidth, largest);
        }

        /// <summary>
        /// ビューポートの一部 (幅の割合 rectWidth) を切り出してから pipelineMaxWidth に縮める
        /// タスクが、静止画に求める幅。切り出した結果がちょうど pipelineMaxWidth になる幅。
        /// pipelineMaxWidth が 0 以下 (縮めない) なら 0 (フル)。
        /// </summary>
        public static int WidthForViewport(int pipelineMaxWidth, double rectWidth)
        {
            if (pipelineMaxWidth <= 0) return 0;
            if (rectWidth <= 0 || rectWidth > 1) rectWidth = 1;
            return (int)Math.Ceiling(pipelineMaxWidth / rectWidth);
        }

        /// <summary>縦横比を保って targetWidth に縮めたときの大きさ。偶数に丸める (YUV や GPU の都合)。</summary>
        public static void ScaledSize(int nativeWidth, int nativeHeight, int targetWidth, out int width, out int height)
        {
            if (targetWidth <= 0 || targetWidth >= nativeWidth)
            {
                width = nativeWidth;
                height = nativeHeight;
                return;
            }
            width = Math.Max(2, targetWidth & ~1);
            height = Math.Max(2, (int)Math.Round((double)nativeHeight * width / nativeWidth) & ~1);
        }

        /// <summary>フル解像度の内部パラメータを、縮めた画の画素系に換算する (画素中心の規約は GrayImage.Scaled と同じ)。</summary>
        public static Vision.CameraIntrinsics ScaleIntrinsics(Vision.CameraIntrinsics k, int fromWidth, int fromHeight, int toWidth, int toHeight)
        {
            double sx = (double)toWidth / Math.Max(1, fromWidth);
            double sy = (double)toHeight / Math.Max(1, fromHeight);
            return new Vision.CameraIntrinsics
            {
                Fx = k.Fx * sx,
                Fy = k.Fy * sy,
                Cx = (k.Cx + 0.5) * sx - 0.5,
                Cy = (k.Cy + 0.5) * sy - 0.5,
            };
        }
    }

    /// <summary>
    /// カメラ供給の統計。読み出しと変換に何 ms 掛かり、どの大きさで動いているかを
    /// 5 秒ごとにログに出す (ArsistPerceptionManager)。「GPU を活かせているか」はここで分かる。
    /// UnityEngine に依存しない。
    /// </summary>
    public static class PerceptionStats
    {
        private static readonly object Gate = new object();
        private static int _readbacks, _converts, _stills, _detections;
        private static double _readbackMs, _convertMs, _readbackMaxMs, _convertMaxMs;
        private static int _nativeWidth, _nativeHeight, _readWidth, _readHeight;
        private static string _path = "";

        public static void SetPath(string path, int nativeWidth, int nativeHeight, int readWidth, int readHeight)
        {
            lock (Gate)
            {
                _path = path ?? "";
                _nativeWidth = nativeWidth; _nativeHeight = nativeHeight;
                _readWidth = readWidth; _readHeight = readHeight;
            }
        }

        public static void Readback(double ms)
        {
            lock (Gate) { _readbacks++; _readbackMs += ms; if (ms > _readbackMaxMs) _readbackMaxMs = ms; }
        }

        public static void Convert(double ms)
        {
            lock (Gate) { _converts++; _convertMs += ms; if (ms > _convertMaxMs) _convertMaxMs = ms; }
        }

        public static void Still() { lock (Gate) _stills++; }
        public static void Detection() { lock (Gate) _detections++; }

        /// <summary>ログ用の一行にして、計数を戻す。活動が無ければ null。</summary>
        public static string Flush(double seconds)
        {
            lock (Gate)
            {
                if (_readbacks == 0 && _converts == 0) return null;
                string line =
                    $"Perception frames: {_path} {_nativeWidth}x{_nativeHeight}->{_readWidth}x{_readHeight}, " +
                    $"{_readbacks} readback(s) avg {(_readbacks > 0 ? _readbackMs / _readbacks : 0):F1} ms (max {_readbackMaxMs:F1}), " +
                    $"{_converts} convert(s) avg {(_converts > 0 ? _convertMs / _converts : 0):F1} ms (max {_convertMaxMs:F1}) on worker, " +
                    $"{_stills} still(s), {_detections} detection(s) in {seconds:F0} s";
                _readbacks = _converts = _stills = _detections = 0;
                _readbackMs = _convertMs = _readbackMaxMs = _convertMaxMs = 0;
                return line;
            }
        }
    }
}
