// ==============================================
// Arsist Engine - Perception / Vision
// 相対配置の算術（「その物の右に10cm」）
//
// src/shared/placement.ts と同じ規則の実装。エディタのプレビューは TS 版を、
// ランタイムはこちらを使うので、片方だけ直すと「エディタで見た位置と実機の位置が違う」
// という一番たちの悪いずれ方をする。
//
// UnityEngine に依存させないのは、tools/perception-check から素の .NET で
// placement.test.ts と同じ数値表を突き合わせるため。
//
// 座標系は「印刷面基準」(+X = 印刷面の右 / +Y = 上 / +Z = 面から手前)。
// Unity のアンカーノードへ渡すときに X を反転するのは呼び出し側の仕事。
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision
{
    public enum PlacementSide
    {
        Center = 0,
        Left = 1,
        Right = 2,
        Above = 3,
        Below = 4,
        Front = 5,
        Behind = 6,
    }

    /// <summary>基準となる矩形（ターゲット全体か、その上の領域）。メートル。</summary>
    public struct PlacementBase
    {
        public double CenterX;
        public double CenterY;
        public double HalfWidth;
        public double HalfHeight;
    }

    /// <summary>置くオブジェクトの半サイズ。メートル。</summary>
    public struct PlacementExtents
    {
        public double HalfWidth;
        public double HalfHeight;
        public double HalfDepth;
    }

    public static class PlacementSolver
    {
        /// <summary>
        /// 正規化された写真上の矩形を、ターゲット座標系の基準矩形に直す。
        /// hasRegion=false ならターゲット全体。
        /// </summary>
        public static PlacementBase RegionToBase(
            double physicalWidth, double physicalHeight,
            bool hasRegion, double rectX, double rectY, double rectWidth, double rectHeight)
        {
            if (!hasRegion)
            {
                return new PlacementBase
                {
                    CenterX = 0,
                    CenterY = 0,
                    HalfWidth = physicalWidth * 0.5,
                    HalfHeight = physicalHeight * 0.5,
                };
            }

            // 正規化座標は原点が写真の左下。ターゲット座標系は中心が原点。
            return new PlacementBase
            {
                CenterX = (rectX + rectWidth * 0.5 - 0.5) * physicalWidth,
                CenterY = (rectY + rectHeight * 0.5 - 0.5) * physicalHeight,
                HalfWidth = rectWidth * physicalWidth * 0.5,
                HalfHeight = rectHeight * physicalHeight * 0.5,
            };
        }

        /// <summary>
        /// 配置をターゲット座標系のオフセットに解決する（印刷面基準）。
        /// </summary>
        /// <param name="cross">-1 = start, 0 = center, 1 = end</param>
        public static void Resolve(
            PlacementSide side, double gap, bool alignNear, int cross,
            in PlacementBase basis, in PlacementExtents extents,
            out double x, out double y, out double z)
        {
            SideDirection(side, out double dirX, out double dirY, out double dirZ);

            if (double.IsNaN(gap) || double.IsInfinity(gap)) gap = 0;

            // 基準の縁までの距離。面 (front/behind) には厚みが無いので 0。
            double baseExtent =
                side == PlacementSide.Left || side == PlacementSide.Right ? basis.HalfWidth :
                side == PlacementSide.Above || side == PlacementSide.Below ? basis.HalfHeight :
                0;

            // 'near' は自分の手前の縁を基準の縁に合わせる → 自分の半サイズぶん押し出す。
            double objectExtent = 0;
            if (alignNear)
            {
                objectExtent =
                    side == PlacementSide.Left || side == PlacementSide.Right ? extents.HalfWidth :
                    side == PlacementSide.Above || side == PlacementSide.Below ? extents.HalfHeight :
                    side == PlacementSide.Front || side == PlacementSide.Behind ? extents.HalfDepth :
                    0;
            }

            double distance = side == PlacementSide.Center ? 0 : baseExtent + gap + objectExtent;

            // 縁に沿った揃え。左右に置くときは上下、上下に置くときは左右に効く。
            double crossX = 0, crossY = 0;
            if (cross != 0)
            {
                double sign = cross < 0 ? -1 : 1;
                if (side == PlacementSide.Left || side == PlacementSide.Right)
                    crossY = sign * (basis.HalfHeight - extents.HalfHeight);
                else if (side == PlacementSide.Above || side == PlacementSide.Below)
                    crossX = sign * (basis.HalfWidth - extents.HalfWidth);
            }

            x = basis.CenterX + dirX * distance + crossX;
            y = basis.CenterY + dirY * distance + crossY;
            z = dirZ * distance;
        }

        public static void SideDirection(PlacementSide side, out double x, out double y, out double z)
        {
            x = y = z = 0;
            switch (side)
            {
                case PlacementSide.Left: x = -1; break;
                case PlacementSide.Right: x = 1; break;
                case PlacementSide.Above: y = 1; break;
                case PlacementSide.Below: y = -1; break;
                case PlacementSide.Front: z = 1; break;
                case PlacementSide.Behind: z = -1; break;
            }
        }
    }
}
