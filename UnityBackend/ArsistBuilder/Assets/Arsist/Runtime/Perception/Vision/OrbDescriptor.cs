// ==============================================
// Arsist Engine - Perception / Vision
// ORB 記述子 (強度重心による向き + steered BRIEF-256)
//
// サンプルパターンは ORB 論文の学習済みテーブルではなく、固定シードの
// ガウス分布から決定的に生成する。参照側と観測側で同一パターンを使う限り
// 一貫性は保たれる（識別力は学習済みパターンにわずかに劣るが、平面ターゲットの
// 照合には十分で、テーブルを持ち込まずに済む）。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision
{
    /// <summary>256bit の記述子。ulong 4 本。</summary>
    public struct Descriptor
    {
        public ulong A, B, C, D;
    }

    internal static class OrbDescriptor
    {
        public const int PatchRadius = 15;
        private const int PairCount = 256;

        // pattern[i] = (x1, y1, x2, y2)
        private static readonly sbyte[] Pattern = BuildPattern();

        private static sbyte[] BuildPattern()
        {
            var pattern = new sbyte[PairCount * 4];
            // 固定シードの線形合同法。プラットフォーム間で同一結果になることが重要なので
            // System.Random ではなく自前で持つ。
            ulong state = 0x9E3779B97F4A7C15UL;

            double NextGaussian()
            {
                // Box-Muller
                double u1, u2;
                do
                {
                    state = state * 6364136223846793005UL + 1442695040888963407UL;
                    u1 = ((state >> 11) & 0x1FFFFFFFFFFFFFUL) / (double)0x20000000000000UL;
                } while (u1 <= 1e-12);
                state = state * 6364136223846793005UL + 1442695040888963407UL;
                u2 = ((state >> 11) & 0x1FFFFFFFFFFFFFUL) / (double)0x20000000000000UL;
                return Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2);
            }

            // σ = パッチ幅/5 (BRIEF 論文の GII 分布)
            const double sigma = (2 * PatchRadius + 1) / 5.0;
            for (int i = 0; i < PairCount * 4; i++)
            {
                double v = NextGaussian() * sigma;
                int iv = (int)Math.Round(v);
                if (iv > PatchRadius) iv = PatchRadius;
                if (iv < -PatchRadius) iv = -PatchRadius;
                pattern[i] = (sbyte)iv;
            }
            return pattern;
        }

        /// <summary>
        /// 強度重心 (intensity centroid) による向き。半径 PatchRadius の円内で計算する。
        /// </summary>
        public static float ComputeAngle(GrayImage img, int cx, int cy)
        {
            var data = img.Data;
            int w = img.Width;
            long m01 = 0, m10 = 0;

            for (int dy = -PatchRadius; dy <= PatchRadius; dy++)
            {
                int span = (int)Math.Sqrt(PatchRadius * PatchRadius - dy * dy);
                int row = (cy + dy) * w + cx;
                for (int dx = -span; dx <= span; dx++)
                {
                    int v = data[row + dx];
                    m10 += dx * v;
                    m01 += dy * v;
                }
            }
            return (float)Math.Atan2(m01, m10);
        }

        /// <summary>steered BRIEF-256。img は事前にぼかしてあること。</summary>
        public static Descriptor Compute(GrayImage img, int cx, int cy, float angle)
        {
            var data = img.Data;
            int w = img.Width;
            float cos = (float)Math.Cos(angle);
            float sin = (float)Math.Sin(angle);

            var d = new Descriptor();
            for (int i = 0; i < PairCount; i++)
            {
                int o = i * 4;
                int ax = Rot(Pattern[o], Pattern[o + 1], cos, sin, true);
                int ay = Rot(Pattern[o], Pattern[o + 1], cos, sin, false);
                int bx = Rot(Pattern[o + 2], Pattern[o + 3], cos, sin, true);
                int by = Rot(Pattern[o + 2], Pattern[o + 3], cos, sin, false);

                bool bit = data[(cy + ay) * w + cx + ax] < data[(cy + by) * w + cx + bx];
                if (!bit) continue;

                int word = i >> 6;
                ulong mask = 1UL << (i & 63);
                switch (word)
                {
                    case 0: d.A |= mask; break;
                    case 1: d.B |= mask; break;
                    case 2: d.C |= mask; break;
                    default: d.D |= mask; break;
                }
            }
            return d;
        }

        private static int Rot(int x, int y, float cos, float sin, bool wantX)
        {
            float v = wantX ? (cos * x - sin * y) : (sin * x + cos * y);
            int r = (int)Math.Round(v);
            if (r > PatchRadius + 7) r = PatchRadius + 7;
            if (r < -(PatchRadius + 7)) r = -(PatchRadius + 7);
            return r;
        }

        /// <summary>ハミング距離 (0-256)。</summary>
        public static int Distance(in Descriptor a, in Descriptor b)
        {
            return PopCount(a.A ^ b.A) + PopCount(a.B ^ b.B)
                 + PopCount(a.C ^ b.C) + PopCount(a.D ^ b.D);
        }

        /// <summary>
        /// 64bit popcount。IL2CPP には System.Numerics.BitOperations が無い環境があるため
        /// SWAR で持つ（分岐もテーブル参照も無いので十分速い）。
        /// </summary>
        public static int PopCount(ulong v)
        {
            v -= (v >> 1) & 0x5555555555555555UL;
            v = (v & 0x3333333333333333UL) + ((v >> 2) & 0x3333333333333333UL);
            v = (v + (v >> 4)) & 0x0F0F0F0F0F0F0F0FUL;
            return (int)((v * 0x0101010101010101UL) >> 56);
        }
    }

    /// <summary>特徴点と記述子の組。</summary>
    public sealed class FeatureSet
    {
        public readonly List<Keypoint> Keypoints = new List<Keypoint>();
        public readonly List<Descriptor> Descriptors = new List<Descriptor>();
        public int Count => Keypoints.Count;
    }
}
