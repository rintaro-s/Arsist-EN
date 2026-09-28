// ==============================================
// Arsist Engine - Perception / Models
// 画をモデルの入力テンソルにする
//
// ここで決まること:
//   - 大きさ (引き伸ばすか、比率を保って余白を足すか = letterbox)
//   - 行順 (ColorImage は下から上、テンソルは上から下)
//   - 並び (NCHW / NHWC)、チャンネル順 (RGB / BGR)、輝度 1ch
//   - 正規化 ((画素 * scale - mean) / std)
//
// 行順の反転を忘れると、上下逆の画を推論することになる。分類なら気付きにくく、
// 検出なら箱が上下逆に出る。tools/perception-check の ModelChecks がここを見ている。
//
// UnityEngine に依存しない。
// ==============================================

using System;
using Arsist.Runtime.Perception.Vision.Classic;

namespace Arsist.Runtime.Perception.Models
{
    /// <summary>入力テンソルと、後で箱やマスクを元の画に戻すための変形の記録。</summary>
    public sealed class PreparedInput
    {
        public TensorData Tensor;
        /// <summary>元の画 → 入力への拡大率。letterbox では縦横同じ。stretch では横 (ScaleY が縦)。</summary>
        public double ScaleX;
        public double ScaleY;
        /// <summary>letterbox の余白 (入力の画素)。stretch では 0。</summary>
        public int PadX;
        public int PadY;
        /// <summary>入力の大きさ。</summary>
        public int InputWidth;
        public int InputHeight;
        /// <summary>元の画の大きさ。</summary>
        public int ImageWidth;
        public int ImageHeight;

        /// <summary>入力の画素座標 (上から下) → 元の画の画素座標 (上から下)。</summary>
        public void ToImage(double inputX, double inputY, out double imageX, out double imageY)
        {
            imageX = (inputX - PadX) / ScaleX;
            imageY = (inputY - PadY) / ScaleY;
        }
    }

    public static class ModelPreprocess
    {
        public static PreparedInput Prepare(ColorImage image, ModelSpec spec)
        {
            if (image == null) throw new ArgumentNullException(nameof(image));
            var input = spec.Input;
            int w = Math.Max(1, input.Width);
            int h = Math.Max(1, input.Height);
            int channels = input.Channels == 1 ? 1 : 3;

            var prepared = new PreparedInput
            {
                InputWidth = w, InputHeight = h,
                ImageWidth = image.Width, ImageHeight = image.Height,
            };

            ColorImage resized;
            if (input.Letterbox)
            {
                double scale = Math.Min((double)w / image.Width, (double)h / image.Height);
                int contentW = Math.Max(1, (int)Math.Round(image.Width * scale));
                int contentH = Math.Max(1, (int)Math.Round(image.Height * scale));
                var content = image.ScaledTo(contentW, contentH);

                prepared.ScaleX = (double)contentW / image.Width;
                prepared.ScaleY = (double)contentH / image.Height;
                prepared.PadX = (w - contentW) / 2;
                prepared.PadY = (h - contentH) / 2;

                resized = new ColorImage(w, h);
                byte pad = (byte)Math.Max(0, Math.Min(255, input.PadValue));
                for (int i = 0; i < resized.Data.Length; i++) resized.Data[i] = pad;

                // ColorImage は下から上。余白も下から数えて置く (上から PadY の余白は、下から h-PadY-contentH)。
                int bottomPad = h - prepared.PadY - contentH;
                for (int y = 0; y < contentH; y++)
                {
                    Array.Copy(content.Data, y * contentW * 3,
                               resized.Data, ((bottomPad + y) * w + prepared.PadX) * 3, contentW * 3);
                }
            }
            else
            {
                resized = image.ScaledTo(w, h);
                prepared.ScaleX = (double)w / image.Width;
                prepared.ScaleY = (double)h / image.Height;
            }

            var shape = input.ChannelsFirst ? new[] { 1, channels, h, w } : new[] { 1, h, w, channels };
            var data = new float[channels * h * w];
            var src = resized.Data;

            for (int ty = 0; ty < h; ty++)
            {
                // テンソルの行 0 は画の一番上。ColorImage の行 0 は一番下。
                int sy = h - 1 - ty;
                for (int x = 0; x < w; x++)
                {
                    int p = (sy * w + x) * 3;
                    byte r = src[p], g = src[p + 1], b = src[p + 2];

                    if (channels == 1)
                    {
                        double gray = (r * 19595 + g * 38470 + b * 7471) >> 16;
                        data[ty * w + x] = (float)((gray * input.Scale - input.MeanOf(0)) / input.StdOf(0));
                        continue;
                    }

                    byte c0 = input.Bgr ? b : r;
                    byte c2 = input.Bgr ? r : b;
                    float v0 = (float)((c0 * input.Scale - input.MeanOf(0)) / input.StdOf(0));
                    float v1 = (float)((g * input.Scale - input.MeanOf(1)) / input.StdOf(1));
                    float v2 = (float)((c2 * input.Scale - input.MeanOf(2)) / input.StdOf(2));

                    if (input.ChannelsFirst)
                    {
                        int plane = h * w;
                        int at = ty * w + x;
                        data[at] = v0;
                        data[plane + at] = v1;
                        data[2 * plane + at] = v2;
                    }
                    else
                    {
                        int at = (ty * w + x) * 3;
                        data[at] = v0;
                        data[at + 1] = v1;
                        data[at + 2] = v2;
                    }
                }
            }

            prepared.Tensor = new TensorData(shape, data);
            return prepared;
        }
    }
}
