// ==============================================
// Arsist Engine - Perception
// カメラフレーム供給の契約（唯一のデバイス依存点）
//
// 画像認識そのものはデバイスに依存しない。デバイスごとに違うのは
// 「画素・内部パラメータ・撮影時のカメラ姿勢をどう取るか」だけなので、
// そこだけをこのインターフェースに閉じ込める。
//
// 規約（守らないと姿勢がずれる）:
//  - Image の行順は下から上。Intrinsics も左下原点のピクセル座標で表す。
//  - Intrinsics は Image の解像度に合わせて換算済みであること（センサー解像度のままにしない）。
//  - CameraPose は「消費した時刻」ではなく「撮影した時刻」の姿勢。
//    頭を動かしながらだと、ここを間違えるだけでアンカーがずれる。
// ==============================================

using Arsist.Runtime.Perception.Vision;
using UnityEngine;

namespace Arsist.Runtime.Perception
{
    public struct ArsistCameraFrame
    {
        public GrayImage Image;
        public CameraIntrinsics Intrinsics;
        /// <summary>撮影時のカメラのワールド姿勢（Unity ワールド空間）。</summary>
        public Pose CameraPose;
        public double TimestampSeconds;
    }

    public interface IArsistCameraFrameSource
    {
        /// <summary>この端末でカメラ映像を取得できるか。</summary>
        bool IsSupported { get; }

        /// <summary>取得を開始する。成功したら true。</summary>
        bool Initialize();

        /// <summary>
        /// 新しいフレームがあれば取り出す。無ければ false。
        /// メインスレッドから毎フレーム呼ばれる想定。
        /// </summary>
        bool TryAcquire(out ArsistCameraFrame frame);

        void Shutdown();

        /// <summary>ログ表示用の名前。</summary>
        string Description { get; }
    }
}
