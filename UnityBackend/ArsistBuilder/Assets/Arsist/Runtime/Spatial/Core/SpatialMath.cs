// ==============================================
// Arsist Engine - Layster.Spatial core: 数と幾何
// Assets/Arsist/Runtime/Spatial/Core/SpatialMath.cs
//
// src/shared/layster/spatial/solver.ts の幾何の写し。UnityEngine に依存しない
// (tools/perception-check の SpatialChecks が素の .NET で同じ表を解いて確かめる)。
// 約束: メートル・度。軸は右・上・前 (RUF)。yaw は +Z から +X へ回る向きが正。atan2 は (x, z) の順。
// ==============================================

using System;
using System.Collections.Generic;

namespace Arsist.Runtime.Spatial.Core
{
    public struct Vec3
    {
        public double X, Y, Z;

        public Vec3(double x, double y, double z) { X = x; Y = y; Z = z; }

        public static readonly Vec3 Zero = new Vec3(0, 0, 0);

        public static Vec3 operator +(Vec3 a, Vec3 b) => new Vec3(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
        public static Vec3 operator -(Vec3 a, Vec3 b) => new Vec3(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
        public static Vec3 operator *(Vec3 a, double k) => new Vec3(a.X * k, a.Y * k, a.Z * k);

        public double Length => Math.Sqrt(X * X + Y * Y + Z * Z);

        public List<object> ToPlain() => new List<object> { X, Y, Z };

        public List<object> ToPlainRounded() => new List<object> { SpatialMath.Round3(X), SpatialMath.Round3(Y), SpatialMath.Round3(Z) };

        public override string ToString() => $"[{X:0.###}, {Y:0.###}, {Z:0.###}]";
    }

    /// <summary>world での姿勢 (重力に沿う物はこれで足りる)。</summary>
    public struct SpatialPose
    {
        public Vec3 At;
        public double Yaw;

        public SpatialPose(Vec3 at, double yaw) { At = at; Yaw = yaw; }
    }

    public struct Aabb
    {
        public double MinX, MaxX, MinY, MaxY, MinZ, MaxZ;
    }

    public static class SpatialMath
    {
        public const double Eps = 1e-9;
        public const double Deg = Math.PI / 180;

        /// <summary>floor(v * 1000 + 0.5) / 1000。TS と同じ丸め (C# の Math.Round は偶数丸めなので使わない)。</summary>
        public static double Round3(double v) => Math.Floor(v * 1000 + 0.5) / 1000;

        /// <summary>yaw (度) でローカルの (x, z) を回す。ローカル +Z → (sin, cos)、+X → (cos, -sin)。</summary>
        public static void Rotate(double x, double z, double yaw, out double rx, out double rz)
        {
            double c = Math.Cos(yaw * Deg);
            double s = Math.Sin(yaw * Deg);
            rx = x * c + z * s;
            rz = -x * s + z * c;
        }

        /// <summary>world の (x, z) を箱 (中心 at・向き yaw) のローカルに戻す。</summary>
        public static void ToLocal(Vec3 at, double yaw, double x, double z, out double lx, out double lz)
        {
            Rotate(x - at.X, z - at.Z, -yaw, out lx, out lz);
        }

        public static double YawToward(double dx, double dz) => Math.Atan2(dx, dz) / Deg;

        public static double NormYaw(double yaw)
        {
            double y = yaw % 360;
            if (y > 180) y -= 360;
            if (y <= -180) y += 360;
            return y;
        }

        public static double Hypot(double a, double b) => Math.Sqrt(a * a + b * b);

        public static double HorizontalDistance(Vec3 a, Vec3 b) => Hypot(a.X - b.X, a.Z - b.Z);

        public static Aabb AabbOf(Vec3 center, Vec3 size, double yaw)
        {
            double c = Math.Abs(Math.Cos(yaw * Deg));
            double s = Math.Abs(Math.Sin(yaw * Deg));
            double hx = (size.X * c + size.Z * s) / 2;
            double hz = (size.X * s + size.Z * c) / 2;
            return new Aabb
            {
                MinX = center.X - hx, MaxX = center.X + hx,
                MinY = center.Y - size.Y / 2, MaxY = center.Y + size.Y / 2,
                MinZ = center.Z - hz, MaxZ = center.Z + hz,
            };
        }

        /// <summary>重なり。tolerance だけ食い込むのは許す。</summary>
        public static bool Overlaps(Aabb a, Aabb b, double tolerance = 0.01)
        {
            return a.MinX < b.MaxX - tolerance && a.MaxX > b.MinX + tolerance
                && a.MinY < b.MaxY - tolerance && a.MaxY > b.MinY + tolerance
                && a.MinZ < b.MaxZ - tolerance && a.MaxZ > b.MinZ + tolerance;
        }

        public static double HorizontalGap(Aabb a, Aabb b)
        {
            double dx = Math.Max(0, Math.Max(a.MinX - b.MaxX, b.MinX - a.MaxX));
            double dz = Math.Max(0, Math.Max(a.MinZ - b.MaxZ, b.MinZ - a.MaxZ));
            return Hypot(dx, dz);
        }

        /// <summary>world の点を frame (原点と yaw だけ) のローカルに。observe.ts の pointToFrame と同じ。</summary>
        public static Vec3 PointToFrame(Vec3 p, Vec3 origin, double yaw)
        {
            double dx = p.X - origin.X;
            double dz = p.Z - origin.Z;
            double c = Math.Cos(-yaw * Deg);
            double s = Math.Sin(-yaw * Deg);
            return new Vec3(dx * c + dz * s, p.Y - origin.Y, -dx * s + dz * c);
        }

        public static Vec3 DirectionToFrame(Vec3 d, double yaw)
        {
            double c = Math.Cos(-yaw * Deg);
            double s = Math.Sin(-yaw * Deg);
            return new Vec3(d.X * c + d.Z * s, d.Y, -d.X * s + d.Z * c);
        }

        /// <summary>frame のローカルの点を world に (PointToFrame の逆)。</summary>
        public static Vec3 FrameToWorld(Vec3 local, Vec3 origin, double yaw)
        {
            Rotate(local.X, local.Z, yaw, out var x, out var z);
            return new Vec3(origin.X + x, origin.Y + local.Y, origin.Z + z);
        }
    }
}
