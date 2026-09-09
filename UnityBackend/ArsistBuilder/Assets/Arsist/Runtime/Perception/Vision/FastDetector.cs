// ==============================================
// Arsist Engine - Perception / Vision
// FAST-9 コーナー検出 + Harris による選別
//
// ORB 論文と同じ構成:
//   FAST-9 で候補を出し、Harris 応答で上位を残す。
//   さらにセル分割で空間的に散らす（1箇所に固まると homography の条件数が悪化し、
//   姿勢推定の精度が落ちるため）。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision
{
    internal static class FastDetector
    {
        // Bresenham 半径3の円（16点）。dx, dy は「下から上」座標系。
        private static readonly int[] CircleDx = { 0, 1, 2, 3, 3, 3, 2, 1, 0, -1, -2, -3, -3, -3, -2, -1 };
        private static readonly int[] CircleDy = { 3, 3, 2, 1, 0, -1, -2, -3, -3, -3, -2, -1, 0, 1, 2, 3 };

        /// <summary>特徴点を持てない外周の幅。BRIEF の回転後サンプル半径 (15√2 ≒ 21.3) を確保する。</summary>
        public const int Border = 22;

        /// <summary>
        /// 1レベル分の検出。
        /// </summary>
        /// <param name="cellSize">セル分割の一辺（px）。各セルから最大 maxPerCell 個だけ残す。</param>
        public static void Detect(
            GrayImage img, int threshold, int cellSize, int maxPerCell, int level,
            float levelToBase, List<Keypoint> output)
        {
            int w = img.Width, h = img.Height;
            if (w <= 2 * Border || h <= 2 * Border) return;

            var data = img.Data;
            var offsets = new int[16];
            for (int i = 0; i < 16; i++) offsets[i] = CircleDy[i] * w + CircleDx[i];

            // 応答マップ（NMS 用）。候補以外は 0。
            var response = new float[w * h];
            var candidates = new List<int>(1024);

            for (int y = Border; y < h - Border; y++)
            {
                int row = y * w;
                for (int x = Border; x < w - Border; x++)
                {
                    int idx = row + x;
                    int p = data[idx];
                    int hi = p + threshold;
                    int lo = p - threshold;

                    // 高速棄却: 9連続の弧は等間隔4点(0,4,8,12)のうち必ず2点以上を含む。
                    // よく見る「3点以上」は FAST-12 の条件であって、FAST-9 に使うと
                    // 直角コーナー（4点中2点しか同じ側に来ない）を丸ごと取りこぼす。
                    int brighter = 0, darker = 0;
                    for (int k = 0; k < 16; k += 4)
                    {
                        int v = data[idx + offsets[k]];
                        if (v > hi) brighter++;
                        else if (v < lo) darker++;
                    }
                    if (brighter < 2 && darker < 2) continue;

                    if (!IsCorner(data, idx, offsets, hi, lo)) continue;

                    float harris = HarrisResponse(data, w, x, y);
                    if (harris <= 0) continue;

                    response[idx] = harris;
                    candidates.Add(idx);
                }
            }

            if (candidates.Count == 0) return;

            // 3x3 非極大抑制 + サブピクセル位置（応答の2次近似）
            int cellsX = Math.Max(1, (w + cellSize - 1) / cellSize);
            int cellsY = Math.Max(1, (h + cellSize - 1) / cellSize);
            var buckets = new List<Keypoint>[cellsX * cellsY];

            foreach (int idx in candidates)
            {
                float c = response[idx];
                bool isMax = true;
                for (int dy = -1; dy <= 1 && isMax; dy++)
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        if (dx == 0 && dy == 0) continue;
                        if (response[idx + dy * w + dx] >= c) { isMax = false; break; }
                    }
                if (!isMax) continue;

                int x = idx % w;
                int y = idx / w;

                // 応答の 2 次補間でサブピクセル位置を出す。
                // 特徴点位置の系統誤差はそのまま再投影誤差になるので、ここは効く。
                float sx = SubpixelOffset(response[idx - 1], c, response[idx + 1]);
                float sy = SubpixelOffset(response[idx - w], c, response[idx + w]);

                var kp = new Keypoint
                {
                    X = x + sx,
                    Y = y + sy,
                    Level = level,
                    BaseX = (x + sx) * levelToBase,
                    BaseY = (y + sy) * levelToBase,
                    Score = c,
                };

                int cell = Math.Min(cellsY - 1, y / cellSize) * cellsX + Math.Min(cellsX - 1, x / cellSize);
                (buckets[cell] ??= new List<Keypoint>(16)).Add(kp);
            }

            foreach (var bucket in buckets)
            {
                if (bucket == null) continue;
                if (bucket.Count > maxPerCell)
                {
                    bucket.Sort((a, b) => b.Score.CompareTo(a.Score));
                    bucket.RemoveRange(maxPerCell, bucket.Count - maxPerCell);
                }
                output.AddRange(bucket);
            }
        }

        private static float SubpixelOffset(float prev, float center, float next)
        {
            float denom = prev - 2f * center + next;
            if (Math.Abs(denom) < 1e-6f) return 0f;
            float offset = 0.5f * (prev - next) / denom;
            return offset < -0.5f ? -0.5f : (offset > 0.5f ? 0.5f : offset);
        }

        /// <summary>
        /// 円周16点のうち9点以上が連続して明るい／暗いか。
        /// 円環を 24 点ぶん (=16+8) 走査することで、始点をまたぐ連続も 1 パスで拾える
        /// （必要な連続長が 9 なので 8 点ぶん余分に見れば足りる）。
        /// </summary>
        private static bool IsCorner(byte[] data, int idx, int[] offsets, int hi, int lo)
        {
            int runBright = 0, runDark = 0;

            for (int i = 0; i < 24; i++)
            {
                int v = data[idx + offsets[i & 15]];

                if (v > hi) { runBright++; runDark = 0; }
                else if (v < lo) { runDark++; runBright = 0; }
                else { runBright = 0; runDark = 0; }

                if (runBright >= 9 || runDark >= 9) return true;
            }
            return false;
        }

        /// <summary>7x7 窓の Harris 応答 (k = 0.04)。</summary>
        private static float HarrisResponse(byte[] data, int w, int cx, int cy)
        {
            const int R = 3;
            float ixx = 0, iyy = 0, ixy = 0;

            for (int dy = -R; dy <= R; dy++)
            {
                int row = (cy + dy) * w + cx;
                for (int dx = -R; dx <= R; dx++)
                {
                    int i = row + dx;
                    float gx = (data[i + 1] - data[i - 1]) * 0.5f;
                    float gy = (data[i + w] - data[i - w]) * 0.5f;
                    ixx += gx * gx;
                    iyy += gy * gy;
                    ixy += gx * gy;
                }
            }

            float det = ixx * iyy - ixy * ixy;
            float trace = ixx + iyy;
            // 正規化して閾値をスケール非依存にする（画素数で割る）
            const float norm = 1f / (49f * 49f);
            return (det - 0.04f * trace * trace) * norm;
        }
    }
}
