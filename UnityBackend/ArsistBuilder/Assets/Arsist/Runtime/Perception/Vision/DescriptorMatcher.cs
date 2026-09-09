// ==============================================
// Arsist Engine - Perception / Vision
// 記述子の総当たり照合
//
// 参照側は数百点なので総当たりで十分（k-d tree はハミング空間では効かない）。
// 誤対応を減らすため Lowe の比率テストと相互最近傍チェックの両方を掛ける。
// 幾何検証(RANSAC)の前段で外れ値を落としておくほど、最終的な姿勢精度が上がる。
// ==============================================

using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision
{
    public struct FeatureMatch
    {
        /// <summary>参照側インデックス。</summary>
        public int RefIndex;
        /// <summary>観測側インデックス。</summary>
        public int QueryIndex;
        public int Distance;
    }

    internal static class DescriptorMatcher
    {
        /// <summary>
        /// query → reference の最近傍を取り、比率テストと相互チェックを通ったものだけ返す。
        /// </summary>
        public static List<FeatureMatch> Match(
            FeatureSet reference, FeatureSet query,
            float ratio = 0.78f, int maxDistance = 72)
        {
            var matches = new List<FeatureMatch>();
            int nRef = reference.Count, nQuery = query.Count;
            if (nRef == 0 || nQuery == 0) return matches;

            var refDesc = reference.Descriptors;
            var queryDesc = query.Descriptors;

            // reference 各点にとっての最良 query（相互チェック用）
            var bestForRef = new int[nRef];
            var bestForRefDist = new int[nRef];
            for (int i = 0; i < nRef; i++) { bestForRef[i] = -1; bestForRefDist[i] = int.MaxValue; }

            var queryBest = new int[nQuery];
            var queryBestDist = new int[nQuery];
            var querySecondDist = new int[nQuery];

            for (int q = 0; q < nQuery; q++)
            {
                var dq = queryDesc[q];
                int best = int.MaxValue, second = int.MaxValue, bestIdx = -1;

                for (int r = 0; r < nRef; r++)
                {
                    int d = OrbDescriptor.Distance(dq, refDesc[r]);
                    if (d < best) { second = best; best = d; bestIdx = r; }
                    else if (d < second) { second = d; }

                    if (d < bestForRefDist[r]) { bestForRefDist[r] = d; bestForRef[r] = q; }
                }

                queryBest[q] = bestIdx;
                queryBestDist[q] = best;
                querySecondDist[q] = second;
            }

            for (int q = 0; q < nQuery; q++)
            {
                int r = queryBest[q];
                if (r < 0) continue;
                int best = queryBestDist[q];
                if (best > maxDistance) continue;
                // 比率テスト（2位が無い場合は通す）
                if (querySecondDist[q] != int.MaxValue && best > ratio * querySecondDist[q]) continue;
                // 相互最近傍
                if (bestForRef[r] != q) continue;

                matches.Add(new FeatureMatch { RefIndex = r, QueryIndex = q, Distance = best });
            }

            return matches;
        }
    }
}
