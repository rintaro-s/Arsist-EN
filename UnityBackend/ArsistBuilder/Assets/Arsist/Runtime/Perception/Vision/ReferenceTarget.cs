// ==============================================
// Arsist Engine - Perception / Vision
// 参照ターゲット（1枚の写真から作る平面ターゲット）
// ==============================================

using System;

namespace Arsist.Runtime.Perception.Vision
{
    public sealed class ReferenceTarget
    {
        public string Id { get; private set; }
        public FeatureSet Features { get; private set; }

        /// <summary>実物の寸法（メートル）。</summary>
        public float PhysicalWidth { get; private set; }
        public float PhysicalHeight { get; private set; }

        /// <summary>参照画像のピクセル座標 → 平面メートル座標の変換係数。</summary>
        private float _metersPerPixelX;
        private float _metersPerPixelY;
        private float _halfWidth;
        private float _halfHeight;

        /// <summary>
        /// 特徴数が少ない参照画像は検出できない。目安として 80 点を下回ると実用にならない。
        /// </summary>
        public bool IsUsable => Features != null && Features.Count >= 80;

        public static ReferenceTarget Build(
            string id, GrayImage image, float physicalWidth, float physicalHeight,
            FeatureExtractorSettings settings)
        {
            if (image == null) throw new ArgumentNullException(nameof(image));
            if (physicalWidth <= 0) throw new ArgumentException("physicalWidth must be > 0");
            if (physicalHeight <= 0)
                physicalHeight = physicalWidth * image.Height / image.Width;

            var target = new ReferenceTarget
            {
                Id = id,
                PhysicalWidth = physicalWidth,
                PhysicalHeight = physicalHeight,
                _metersPerPixelX = physicalWidth / image.Width,
                _metersPerPixelY = physicalHeight / image.Height,
                _halfWidth = physicalWidth * 0.5f,
                _halfHeight = physicalHeight * 0.5f,
            };
            target.Features = FeatureExtractor.Extract(image, settings);
            return target;
        }

        /// <summary>
        /// 参照画像の Level 0 ピクセル座標を、ターゲット平面のメートル座標に変換する。
        /// 原点はターゲット中心、+x = 印刷面の右、+y = 印刷面の上（画像の行順が下から上なのでそのまま）。
        /// </summary>
        public void PixelToPlane(float px, float py, out double x, out double y)
        {
            x = px * _metersPerPixelX - _halfWidth;
            y = py * _metersPerPixelY - _halfHeight;
        }
    }
}
