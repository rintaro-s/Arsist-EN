// ==============================================
// Arsist Engine - Perception / Models
// テンソルの素の形
//
// 推論エンジン (Unity の Inference Engine、エディタの ONNX Runtime) と前処理・後処理の間を
// 渡る唯一の形。float の一次元配列と形だけ。どのエンジンの型にも寄せない。
//
// UnityEngine に依存しない。tools/perception-check で検証する。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Models
{
    public sealed class TensorData
    {
        public readonly float[] Data;
        public readonly int[] Shape;

        public TensorData(int[] shape, float[] data)
        {
            if (shape == null || shape.Length == 0) throw new ArgumentException("tensor needs a shape");
            long expected = 1;
            foreach (var d in shape)
            {
                if (d <= 0) throw new ArgumentException("tensor dimensions must be positive");
                expected *= d;
            }
            if (data == null || data.Length != expected)
                throw new ArgumentException($"tensor data has {data?.Length ?? 0} values but the shape needs {expected}");
            Shape = shape;
            Data = data;
        }

        public int Rank => Shape.Length;
        public int Length => Data.Length;

        /// <summary>添字 i の大きさ。範囲外なら 1 (無い軸は長さ 1 として扱う)。</summary>
        public int Dim(int i) => i >= 0 && i < Shape.Length ? Shape[i] : 1;

        public string ShapeText() => "[" + string.Join(",", Shape) + "]";
    }
}
