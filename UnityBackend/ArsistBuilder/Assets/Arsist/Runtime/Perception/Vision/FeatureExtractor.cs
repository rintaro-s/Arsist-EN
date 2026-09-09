// ==============================================
// Arsist Engine - Perception / Vision
// ピラミッド全体からの ORB 特徴抽出
// ==============================================

using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision
{
    public sealed class FeatureExtractorSettings
    {
        /// <summary>ピラミッドの段数。多いほど遠近の変化に強いが線形に重くなる。</summary>
        public int PyramidLevels = 6;
        /// <summary>段ごとの縮小率。</summary>
        public float ScaleFactor = 1.2f;
        /// <summary>FAST の輝度差しきい値。</summary>
        public int FastThreshold = 18;
        /// <summary>セル分割の一辺（Level 0 換算 px）。</summary>
        public int CellSize = 32;
        /// <summary>セルあたりの最大特徴数。</summary>
        public int MaxPerCell = 4;
        /// <summary>全体の上限。超えたら Harris 応答の上位のみ残す。</summary>
        public int MaxFeatures = 900;
    }

    internal static class FeatureExtractor
    {
        public static FeatureSet Extract(GrayImage image, FeatureExtractorSettings s)
        {
            var pyramid = new ImagePyramid(image, s.PyramidLevels, s.ScaleFactor);
            var result = new FeatureSet();
            var raw = new List<Keypoint>(1024);

            for (int level = 0; level < pyramid.Count; level++)
            {
                var levelImage = pyramid.Levels[level];
                if (levelImage.Width <= 2 * FastDetector.Border || levelImage.Height <= 2 * FastDetector.Border)
                    break;

                // セルサイズはレベル座標系に合わせて縮める（どの段でも同じ密度で散らす）
                int cell = (int)(s.CellSize / pyramid.LevelToBase[level]);
                if (cell < 8) cell = 8;

                int before = raw.Count;
                FastDetector.Detect(levelImage, s.FastThreshold, cell, s.MaxPerCell,
                    level, pyramid.LevelToBase[level], raw);

                // 向きと記述子は「ぼかした」画像から取る（BRIEF はノイズに弱い）
                var blurred = levelImage.Blur();
                for (int i = before; i < raw.Count; i++)
                {
                    var kp = raw[i];
                    int cx = (int)(kp.X + 0.5f);
                    int cy = (int)(kp.Y + 0.5f);
                    kp.Angle = OrbDescriptor.ComputeAngle(blurred, cx, cy);
                    raw[i] = kp;
                    result.Descriptors.Add(OrbDescriptor.Compute(blurred, cx, cy, kp.Angle));
                }
                result.Keypoints.AddRange(raw.GetRange(before, raw.Count - before));
            }

            if (result.Count > s.MaxFeatures)
            {
                TrimToBest(result, s.MaxFeatures);
            }
            return result;
        }

        private static void TrimToBest(FeatureSet set, int limit)
        {
            var order = new int[set.Count];
            for (int i = 0; i < order.Length; i++) order[i] = i;
            var scores = new float[set.Count];
            for (int i = 0; i < scores.Length; i++) scores[i] = -set.Keypoints[i].Score;
            System.Array.Sort(scores, order);

            var kps = new List<Keypoint>(limit);
            var descs = new List<Descriptor>(limit);
            for (int i = 0; i < limit; i++)
            {
                kps.Add(set.Keypoints[order[i]]);
                descs.Add(set.Descriptors[order[i]]);
            }
            set.Keypoints.Clear(); set.Keypoints.AddRange(kps);
            set.Descriptors.Clear(); set.Descriptors.AddRange(descs);
        }
    }
}
