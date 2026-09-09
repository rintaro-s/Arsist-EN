// ==============================================
// Arsist Engine - Perception / Vision
// 特徴点
// ==============================================

namespace Arsist.Runtime.Perception.Vision
{
    public struct Keypoint
    {
        /// <summary>検出したピラミッドレベル内での座標（サブピクセル、下から上）。</summary>
        public float X;
        public float Y;
        /// <summary>ピラミッドのレベル番号。</summary>
        public int Level;
        /// <summary>Level 0 換算の座標。マッチング後の幾何計算はすべてこちらを使う。</summary>
        public float BaseX;
        public float BaseY;
        /// <summary>強度重心から求めた向き（ラジアン）。</summary>
        public float Angle;
        /// <summary>Harris コーナー応答。上位選択に使う。</summary>
        public float Score;
    }
}
