// ==============================================
// Arsist Engine - Perception / Pipeline
// パイプラインを流れる値
//
// op どうしは名前で値を受け渡す。型が噛み合わない繋ぎ方は実行前に弾きたいので、
// 生のオブジェクトではなく種別を持たせている。
//
// UnityEngine に依存しない。tools/perception-check で全部そのまま検証できる。
// ==============================================

using System.Collections.Generic;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Vision.Classic;

namespace Arsist.Runtime.Perception.Pipeline
{
    public enum VisionValueKind
    {
        Color,
        Gray,
        Mask,
        Edges,
        /// <summary>列 (または行) ごとの境界位置。</summary>
        Boundary,
        Blobs,
        Contours,
        /// <summary>数値の集まり。DataStore にそのまま入る。</summary>
        Record,
    }

    public sealed class VisionValue
    {
        public VisionValueKind Kind;

        public ColorImage Color;
        public GrayImage Gray;
        public MaskImage Mask;
        public GradientField Edges;
        public int[] Boundary;
        public List<object> Items;
        public Dictionary<string, object> Record;

        public static VisionValue OfColor(ColorImage v) =>
            new VisionValue { Kind = VisionValueKind.Color, Color = v };
        public static VisionValue OfGray(GrayImage v) =>
            new VisionValue { Kind = VisionValueKind.Gray, Gray = v };
        public static VisionValue OfMask(MaskImage v) =>
            new VisionValue { Kind = VisionValueKind.Mask, Mask = v };
        public static VisionValue OfEdges(GradientField v) =>
            new VisionValue { Kind = VisionValueKind.Edges, Edges = v };
        public static VisionValue OfBoundary(int[] v) =>
            new VisionValue { Kind = VisionValueKind.Boundary, Boundary = v };
        public static VisionValue OfBlobs(List<object> v) =>
            new VisionValue { Kind = VisionValueKind.Blobs, Items = v };
        public static VisionValue OfContours(List<object> v) =>
            new VisionValue { Kind = VisionValueKind.Contours, Items = v };
        public static VisionValue OfRecord(Dictionary<string, object> v) =>
            new VisionValue { Kind = VisionValueKind.Record, Record = v };

        public int Width =>
            Kind == VisionValueKind.Color ? Color.Width
            : Kind == VisionValueKind.Gray ? Gray.Width
            : Kind == VisionValueKind.Mask ? Mask.Width
            : Kind == VisionValueKind.Edges ? Edges.Width
            : 0;

        public int Height =>
            Kind == VisionValueKind.Color ? Color.Height
            : Kind == VisionValueKind.Gray ? Gray.Height
            : Kind == VisionValueKind.Mask ? Mask.Height
            : Kind == VisionValueKind.Edges ? Edges.Height
            : 0;
    }
}
