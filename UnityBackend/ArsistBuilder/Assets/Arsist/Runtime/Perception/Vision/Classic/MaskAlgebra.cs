// ==============================================
// Arsist Engine - Perception / Vision / Classic
// マスクどうしの論理演算
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision.Classic
{
    public static class MaskAlgebra
    {
        /// <summary>
        /// 2枚のマスクを組み合わせる。
        /// mode: "and" / "or" / "xor" / "subtract" / "not" (b は無視)
        /// </summary>
        public static MaskImage Combine(MaskImage a, MaskImage b, string mode)
        {
            if (a == null) return null;

            var result = new MaskImage(a.Width, a.Height);
            bool unary = string.Equals(mode, "not", StringComparison.OrdinalIgnoreCase);

            if (!unary && (b == null || b.Width != a.Width || b.Height != a.Height))
            {
                // 大きさが違うマスクを黙って組み合わせると、ずれた結果が静かに出てくる。
                throw new ArgumentException("mask sizes do not match");
            }

            for (int i = 0; i < a.Data.Length; i++)
            {
                bool left = a.Data[i] != MaskImage.Off;
                bool right = unary ? false : b.Data[i] != MaskImage.Off;

                bool on;
                switch (mode.ToLowerInvariant())
                {
                    case "or": on = left || right; break;
                    case "xor": on = left ^ right; break;
                    case "subtract": on = left && !right; break;
                    case "not": on = !left; break;
                    default: on = left && right; break;   // and
                }
                result.Data[i] = on ? MaskImage.On : MaskImage.Off;
            }
            return result;
        }
    }
}
