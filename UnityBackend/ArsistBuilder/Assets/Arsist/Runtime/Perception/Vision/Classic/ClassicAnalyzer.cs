// ==============================================
// Arsist Engine - Perception / Vision / Classic
// 古典的な画像処理をタスクとして呼べるようにする窓口
//
// ORB による画像アンカーが「その写真を探す」のに対し、こちらは
// 「今見えている画の性質を測る」ためのもの。学習モデルを持たないので
// 端末を選ばず、初回のダウンロードも要らない。
//
// 結果は DataStore に入れる辞書ひとつで返す。ArsistUIBinding が
// ドットパスを辿るので、<storeAs>.color.name のような bind がそのまま通る。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public enum ClassicAnalysisKind
    {
        /// <summary>領域の代表色を返す。</summary>
        Color,
        /// <summary>色で拾った塊の数・大きさ・位置を返す。</summary>
        Blobs,
        /// <summary>輪郭を追って形を言う（三角形・四角形・円…）。</summary>
        Shapes,
        /// <summary>空を抽出する。塗り替えにも使う。</summary>
        Sky,
    }

    public sealed class ClassicAnalysisConfig
    {
        public ClassicAnalysisKind Kind = ClassicAnalysisKind.Color;

        /// <summary>Blobs のとき、拾う色の HSV 範囲。hueMin &gt; hueMax は 0 度またぎ。</summary>
        public int HueMin = 0, HueMax = 359;
        public int SatMin = 60, SatMax = 255;
        public int ValMin = 40, ValMax = 255;

        /// <summary>Blobs / Shapes で無視する最小面積（画素数）。</summary>
        public int MinArea = 60;
        /// <summary>返す塊・形の最大数。DataStore を膨らませないための上限。</summary>
        public int MaxItems = 8;

        /// <summary>Shapes のとき、明暗で分けるしきい値。0 以下なら大津法で自動。</summary>
        public int ShapeThreshold = 0;
        /// <summary>Shapes のとき、明るい側を対象にするか。</summary>
        public bool ShapeBright = true;

        public SkySegmenterSettings Sky = new SkySegmenterSettings();

        /// <summary>
        /// 処理前に縮める幅。大きいままだと携帯端末では重いし、
        /// 細かいノイズを拾いすぎて結果も安定しない。
        /// </summary>
        public int MaxWidth = 480;
    }

    public sealed class ClassicAnalysisResult
    {
        public bool Ok;
        public string Error = string.Empty;
        public Dictionary<string, object> Values = new Dictionary<string, object>();
        /// <summary>Sky の結果。塗り替えに使う。</summary>
        public SkySegmentation Sky;
        /// <summary>実際に処理した（縮めた後の）画。</summary>
        public ColorImage Processed;

        public static ClassicAnalysisResult Failure(string error) =>
            new ClassicAnalysisResult { Ok = false, Error = error };
    }

    public static class ClassicAnalyzer
    {
        public static ClassicAnalysisResult Analyze(ColorImage image, ClassicAnalysisConfig config)
        {
            if (image == null || image.Width < 8 || image.Height < 8)
                return ClassicAnalysisResult.Failure("noImage");
            config ??= new ClassicAnalysisConfig();

            var work = config.MaxWidth > 0 ? image.ScaledToWidth(config.MaxWidth) : image;

            switch (config.Kind)
            {
                case ClassicAnalysisKind.Color: return AnalyzeColor(work, config);
                case ClassicAnalysisKind.Blobs: return AnalyzeBlobs(work, config);
                case ClassicAnalysisKind.Shapes: return AnalyzeShapes(work, config);
                case ClassicAnalysisKind.Sky: return AnalyzeSky(work, config);
                default: return ClassicAnalysisResult.Failure("unknownAnalysis");
            }
        }

        // --- 代表色 ---

        private static ClassicAnalysisResult AnalyzeColor(ColorImage image, ClassicAnalysisConfig config)
        {
            // 平均を取ると、赤と緑が混ざって灰色になるような嘘をつく。
            // 色相のヒストグラムで一番多い山を採り、その山の中だけで平均する。
            var histogram = new int[360];
            int colorful = 0;
            for (int i = 0, p = 0; i < image.PixelCount; i++, p += 3)
            {
                var hsv = ColorSpace.RgbToHsv(image.Data[p], image.Data[p + 1], image.Data[p + 2]);
                if (hsv.S < 40 || hsv.V < 30) continue;   // 無彩色・暗すぎる画素は色相が当てにならない
                histogram[hsv.H]++;
                colorful++;
            }

            long sumR = 0, sumG = 0, sumB = 0;
            int count = 0;
            int dominantHue = -1;

            if (colorful > image.PixelCount / 20)
            {
                // 色相は環状なので、幅 30 度の窓を回して一番多いところを採る。
                int best = -1, bestStart = 0;
                for (int start = 0; start < 360; start++)
                {
                    int total = 0;
                    for (int k = 0; k < 30; k++) total += histogram[(start + k) % 360];
                    if (total > best) { best = total; bestStart = start; }
                }
                // 窓の中心をそのまま採ると、一点に固まった色相 (真っ赤など) が
                // 窓の端に来たときに 15 度ずれる。窓の中で重み付き平均を取る。
                double offset = 0;
                int weight = 0;
                for (int k = 0; k < 30; k++)
                {
                    int n = histogram[(bestStart + k) % 360];
                    offset += (double)k * n;
                    weight += n;
                }
                dominantHue = weight > 0
                    ? (int)Math.Round(bestStart + offset / weight) % 360
                    : (bestStart + 15) % 360;

                for (int i = 0, p = 0; i < image.PixelCount; i++, p += 3)
                {
                    var hsv = ColorSpace.RgbToHsv(image.Data[p], image.Data[p + 1], image.Data[p + 2]);
                    if (hsv.S < 40 || hsv.V < 30) continue;
                    int delta = Math.Abs(hsv.H - dominantHue);
                    if (delta > 180) delta = 360 - delta;
                    if (delta > 15) continue;
                    sumR += image.Data[p]; sumG += image.Data[p + 1]; sumB += image.Data[p + 2];
                    count++;
                }
            }

            if (count == 0)
            {
                // 有彩色が乏しい。素直に全体の平均を返す（灰色や白黒の被写体）。
                for (int i = 0, p = 0; i < image.PixelCount; i++, p += 3)
                {
                    sumR += image.Data[p]; sumG += image.Data[p + 1]; sumB += image.Data[p + 2];
                }
                count = image.PixelCount;
            }

            byte r = (byte)(sumR / count), g = (byte)(sumG / count), b = (byte)(sumB / count);
            var mean = ColorSpace.RgbToHsv(r, g, b);

            var result = new ClassicAnalysisResult { Ok = true, Processed = image };
            result.Values["r"] = (int)r;
            result.Values["g"] = (int)g;
            result.Values["b"] = (int)b;
            result.Values["hex"] = $"#{r:X2}{g:X2}{b:X2}";
            result.Values["hue"] = dominantHue >= 0 ? dominantHue : (int)mean.H;
            result.Values["saturation"] = (int)mean.S;
            result.Values["value"] = (int)mean.V;
            result.Values["name"] = NameOfColor(mean, dominantHue);
            return result;
        }

        /// <summary>人が言う色の名前に落とす。UI にそのまま出せるようにするため。</summary>
        private static string NameOfColor(Hsv hsv, int dominantHue)
        {
            if (hsv.V < 45) return "black";
            if (hsv.S < 40) return hsv.V > 190 ? "white" : "gray";

            int hue = dominantHue >= 0 ? dominantHue : hsv.H;
            if (hue < 15 || hue >= 345) return "red";
            if (hue < 45) return "orange";
            if (hue < 70) return "yellow";
            if (hue < 160) return "green";
            if (hue < 200) return "cyan";
            if (hue < 260) return "blue";
            if (hue < 290) return "purple";
            if (hue < 345) return "magenta";
            return "red";
        }

        // --- 色で拾った塊 ---

        private static ClassicAnalysisResult AnalyzeBlobs(ColorImage image, ClassicAnalysisConfig config)
        {
            var mask = Threshold.HsvRange(
                image, config.HueMin, config.HueMax,
                config.SatMin, config.SatMax, config.ValMin, config.ValMax);

            // 拾いこぼしとノイズを整える。開いてから閉じる順にすると、
            // 先に点が消えるので、あとで穴を埋めてもノイズが太らない。
            mask = Morphology.Open(mask, 1);
            mask = Morphology.Close(mask, 2);

            var labelled = ConnectedComponents.Label(mask, config.MinArea);
            labelled.Blobs.Sort((a, b) => b.Area.CompareTo(a.Area));

            var items = new List<object>();
            int total = 0;
            for (int i = 0; i < labelled.Blobs.Count && i < config.MaxItems; i++)
            {
                var blob = labelled.Blobs[i];
                total += blob.Area;
                items.Add(new Dictionary<string, object>
                {
                    ["area"] = blob.Area,
                    // 位置は正規化して返す。解像度が変わっても bind 側を直さずに済む。
                    ["x"] = Round(blob.CentroidX / image.Width),
                    ["y"] = Round(blob.CentroidY / image.Height),
                    ["width"] = Round((double)blob.BoundsWidth / image.Width),
                    ["height"] = Round((double)blob.BoundsHeight / image.Height),
                    ["fill"] = Round(blob.Fill),
                    ["aspect"] = Round(blob.Aspect),
                });
            }

            var result = new ClassicAnalysisResult { Ok = true, Processed = image };
            result.Values["count"] = labelled.Blobs.Count;
            result.Values["items"] = items;
            result.Values["coverage"] = Round((double)total / image.PixelCount);
            var largest = labelled.Largest();
            result.Values["largestArea"] = largest?.Area ?? 0;
            result.Values["found"] = largest != null;
            return result;
        }

        // --- 形 ---

        private static ClassicAnalysisResult AnalyzeShapes(ColorImage image, ClassicAnalysisConfig config)
        {
            var gray = image.ToGray().Blur();
            var mask = config.ShapeThreshold > 0
                ? Threshold.Fixed(gray, config.ShapeThreshold, invert: !config.ShapeBright)
                : Threshold.Otsu(gray, invert: !config.ShapeBright);

            mask = Morphology.Open(mask, 1);
            mask = Morphology.Close(mask, 1);

            var contours = Contours.FindExternal(mask);
            var items = new List<object>();
            var counts = new Dictionary<string, int>();

            contours.Sort((a, b) => Math.Abs(b.Area()).CompareTo(Math.Abs(a.Area())));

            foreach (var contour in contours)
            {
                double area = Math.Abs(contour.Area());
                if (area < config.MinArea) continue;
                if (items.Count >= config.MaxItems) break;

                var shape = Contours.ClassifyShape(contour);
                counts.TryGetValue(shape, out int n);
                counts[shape] = n + 1;

                double cx = 0, cy = 0;
                foreach (var point in contour.Points) { cx += point.X; cy += point.Y; }
                cx /= contour.Points.Count;
                cy /= contour.Points.Count;

                items.Add(new Dictionary<string, object>
                {
                    ["shape"] = shape,
                    ["area"] = (int)area,
                    ["x"] = Round(cx / image.Width),
                    ["y"] = Round(cy / image.Height),
                    ["circularity"] = Round(contour.Circularity()),
                });
            }

            var result = new ClassicAnalysisResult { Ok = true, Processed = image };
            result.Values["count"] = items.Count;
            result.Values["items"] = items;
            result.Values["found"] = items.Count > 0;
            foreach (var pair in counts) result.Values[pair.Key] = pair.Value;
            return result;
        }

        // --- 空 ---

        private static ClassicAnalysisResult AnalyzeSky(ColorImage image, ClassicAnalysisConfig config)
        {
            var sky = SkySegmenter.Segment(image, config.Sky);

            var result = new ClassicAnalysisResult { Ok = true, Processed = image, Sky = sky };
            result.Values["found"] = sky.Found;
            result.Values["coverage"] = Round(sky.Coverage);
            result.Values["brightness"] = (int)sky.MeanLuminance;
            result.Values["flatness"] = Round(sky.MeanGradient);
            result.Values["saturation"] = (int)sky.MeanSaturation;
            // 曇りか晴れかを分けるのは明るさではなく彩度。曇り空は灰色なので彩度がほぼ無く、
            // 晴れた空は暗くても青いままなので彩度が残る。明るさで分けると、
            // 夕方の青空がまとめて曇り扱いになる。
            result.Values["condition"] = !sky.Found ? "none"
                : sky.MeanSaturation < 60 ? "overcast" : "clear";
            return result;
        }

        /// <summary>DataStore に載せる数値は桁を落とす。ログも UI も読みやすくなる。</summary>
        private static double Round(double value) => Math.Round(value, 4);
    }
}
