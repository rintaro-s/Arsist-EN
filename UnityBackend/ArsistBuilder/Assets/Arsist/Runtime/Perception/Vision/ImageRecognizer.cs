// ==============================================
// Arsist Engine - Perception / Vision
// 参照ターゲット群の検出（1フレーム分）
//
// 観測側の特徴抽出はフレームにつき1回だけ行い、全ターゲットで使い回す。
// ==============================================

using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision
{
    public struct Detection
    {
        public string TargetId;
        /// <summary>row-major 3x3。ターゲット座標 → カメラ座標。</summary>
        public double[] Rotation;
        /// <summary>カメラ座標でのターゲット原点（メートル）。</summary>
        public double Tx, Ty, Tz;
        public int InlierCount;
        public double Rmse;
    }

    public sealed class RecognizerSettings
    {
        public FeatureExtractorSettings Features = new FeatureExtractorSettings();
        /// <summary>RANSAC のインライア判定 (px)。</summary>
        public double RansacThreshold = 3.0;
        public int RansacIterations = 2000;
        /// <summary>採用に必要な最小インライア数。</summary>
        public int MinInliers = 20;
        /// <summary>採用に必要な最大再投影 RMSE (px)。</summary>
        public double MaxRmse = 2.5;
    }

    public sealed class ImageRecognizer
    {
        private readonly RecognizerSettings _settings;
        private int _seed = 12345;

        public ImageRecognizer(RecognizerSettings settings)
        {
            _settings = settings ?? new RecognizerSettings();
        }

        public List<Detection> Detect(
            GrayImage frame, CameraIntrinsics intrinsics, IReadOnlyList<ReferenceTarget> targets)
        {
            var results = new List<Detection>();
            if (frame == null || targets == null || targets.Count == 0) return results;

            var query = FeatureExtractor.Extract(frame, _settings.Features);
            if (query.Count < 4) return results;

            foreach (var target in targets)
            {
                if (target == null || !target.IsUsable) continue;

                var matches = DescriptorMatcher.Match(target.Features, query);
                if (matches.Count < _settings.MinInliers) continue;

                int n = matches.Count;
                var src = new double[n * 2];
                var dst = new double[n * 2];
                for (int i = 0; i < n; i++)
                {
                    var kpRef = target.Features.Keypoints[matches[i].RefIndex];
                    var kpQuery = query.Keypoints[matches[i].QueryIndex];
                    target.PixelToPlane(kpRef.BaseX, kpRef.BaseY, out double x, out double y);
                    src[i * 2] = x;
                    src[i * 2 + 1] = y;
                    dst[i * 2] = kpQuery.BaseX;
                    dst[i * 2 + 1] = kpQuery.BaseY;
                }

                var homography = Homography.Estimate(
                    src, dst, n, _settings.RansacThreshold, _settings.RansacIterations, _seed++);
                if (homography == null || homography.Inliers.Count < _settings.MinInliers) continue;

                int m = homography.Inliers.Count;
                var objXY = new double[m * 2];
                var imgUV = new double[m * 2];
                for (int i = 0; i < m; i++)
                {
                    int idx = homography.Inliers[i];
                    objXY[i * 2] = src[idx * 2];
                    objXY[i * 2 + 1] = src[idx * 2 + 1];
                    imgUV[i * 2] = dst[idx * 2];
                    imgUV[i * 2 + 1] = dst[idx * 2 + 1];
                }

                var pose = PlanarPoseSolver.Solve(homography.H, intrinsics, objXY, imgUV, m);
                if (pose == null || pose.Rmse > _settings.MaxRmse) continue;

                results.Add(new Detection
                {
                    TargetId = target.Id,
                    Rotation = pose.R,
                    Tx = pose.Tx,
                    Ty = pose.Ty,
                    Tz = pose.Tz,
                    InlierCount = m,
                    Rmse = pose.Rmse,
                });
            }

            return results;
        }
    }
}
