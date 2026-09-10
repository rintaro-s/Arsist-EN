// ==============================================
// Arsist Engine - Perception / Vision / Classic
// テンプレート照合 (正規化相互相関)
//
// ORB による特徴点照合は「模様のある平面」に強いが、模様の乏しい図形や
// アイコンには弱い。そういう相手にはこちらの方が素直に当たる。
//
// 正規化してあるので、全体の明るさが変わっても値が保たれる。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public struct TemplateMatch
    {
        public int X;
        public int Y;
        /// <summary>-1..1。1 が完全一致。</summary>
        public double Score;
        public bool Found;
    }

    public static class TemplateMatcher
    {
        /// <summary>
        /// 画像全体からテンプレートを探し、最も相関の高い位置を返す。
        ///
        /// 素朴な総当たりなので O(W·H·w·h)。呼ぶ前に画像を縮めること
        /// （320px 幅程度まで落とせば実用的な速度になる）。
        /// </summary>
        /// <param name="step">探索の刻み。2 にすると 4 倍速くなる代わりに位置が粗くなる。</param>
        public static TemplateMatch Match(GrayImage image, GrayImage template, double minScore = 0.7, int step = 1)
        {
            var result = new TemplateMatch { Score = -2 };
            if (template.Width > image.Width || template.Height > image.Height) return result;
            if (step < 1) step = 1;

            int tw = template.Width, th = template.Height;
            int count = tw * th;

            // テンプレート側は一度だけ計算しておく
            double templateMean = 0;
            foreach (var v in template.Data) templateMean += v;
            templateMean /= count;

            double templateVariance = 0;
            foreach (var v in template.Data)
            {
                double d = v - templateMean;
                templateVariance += d * d;
            }
            if (templateVariance < 1e-9) return result;   // 一様なテンプレートは相関が定義できない
            double templateNorm = Math.Sqrt(templateVariance);

            for (int y = 0; y + th <= image.Height; y += step)
            {
                for (int x = 0; x + tw <= image.Width; x += step)
                {
                    double windowSum = 0;
                    for (int ty = 0; ty < th; ty++)
                    {
                        int row = (y + ty) * image.Width + x;
                        for (int tx = 0; tx < tw; tx++) windowSum += image.Data[row + tx];
                    }
                    double windowMean = windowSum / count;

                    double covariance = 0, windowVariance = 0;
                    for (int ty = 0; ty < th; ty++)
                    {
                        int row = (y + ty) * image.Width + x;
                        int trow = ty * tw;
                        for (int tx = 0; tx < tw; tx++)
                        {
                            double a = image.Data[row + tx] - windowMean;
                            double b = template.Data[trow + tx] - templateMean;
                            covariance += a * b;
                            windowVariance += a * a;
                        }
                    }

                    if (windowVariance < 1e-9) continue;
                    double score = covariance / (Math.Sqrt(windowVariance) * templateNorm);

                    if (score > result.Score)
                    {
                        result.Score = score;
                        result.X = x;
                        result.Y = y;
                    }
                }
            }

            result.Found = result.Score >= minScore;
            return result;
        }
    }
}
