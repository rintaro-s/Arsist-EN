// ==============================================
// Arsist Engine - Perception / Sources
// GPU 上のカメラ映像を、要る大きさに縮めてから CPU に読み出す
//
// どのデバイスでもカメラ映像はまず GPU のテクスチャとして来る (WebCamTexture、Quest の
// パススルー、AR Foundation の背景)。以前は WebCamTexture.GetPixels32 でフル解像度を
// 同期的に読んでいて、これは呼ぶたびに GPU の描画完了を待つ (数 ms〜十数 ms の引っかかり)。
//
// ここでは:
//   1. Graphics.Blit で、要る大きさの RenderTexture に縮める (GPU、ほぼタダ)
//   2. AsyncGPUReadback で非同期に読み出す (メインスレッドは止まらない)
//   3. 読み出したバッファは使い回す (毎フレーム 3.6 MB を確保しない)
//
// 行順: RenderTexture を読み出したときの行順はグラフィックス API で違う
// (OpenGL は下から上、Vulkan / D3D / Metal は上から下のことが多い)。決め打ちすると
// 「検出はできるのに上下逆に貼り付く」を実機でしか気付けない。なので最初に 2x2 の
// 既知の絵を同じ経路で読み出し、どちらの行順で来るかを測る (RowsTopDown)。
//
// 非同期読み出しに対応しない端末 (SystemInfo.supportsAsyncGPUReadback == false) では
// ReadPixels で同期的に読む。遅いが動く。
// ==============================================

using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Arsist.Runtime.Perception.Sources
{
    public sealed class GpuFrameReader : IDisposable
    {
        /// <summary>読み出した画素と大きさ、行順。callback はメインスレッドで呼ばれる。</summary>
        public delegate void FrameReady(Color32[] pixels, int width, int height, bool rowsTopDown);

        public bool AsyncSupported => SystemInfo.supportsAsyncGPUReadback;

        /// <summary>読み出した行が上から下か。Probe が終わるまでは未定 (null)。</summary>
        public bool? RowsTopDown { get; private set; }

        public bool Busy => _pending;

        /// <summary>直近の読み出しに掛かった時間 (要求から完了まで)。</summary>
        public double LastReadbackMs { get; private set; }

        private RenderTexture _target;
        private Texture2D _syncStaging;
        private Color32[] _bufferA, _bufferB;
        private bool _useA;
        private bool _pending;
        private FrameReady _callback;
        private int _pendingWidth, _pendingHeight;
        private double _requestedAt;

        private RenderTexture _probeTarget;
        private Texture2D _probeSource;
        private bool _probePending;

        // ---- 行順の測定 ----

        /// <summary>
        /// 行順を測る。終わるまで TryRequest は false を返す。
        /// 2x2 の絵: Unity のテクスチャは下から上なので SetPixel(x, 1) が上の行。
        /// 読み出した先頭画素が白なら「上から下」。
        /// </summary>
        public void EnsureProbe()
        {
            if (RowsTopDown.HasValue || _probePending) return;

            _probeSource = new Texture2D(2, 2, TextureFormat.RGBA32, false) { filterMode = FilterMode.Point };
            _probeSource.SetPixel(0, 0, Color.black); _probeSource.SetPixel(1, 0, Color.black);
            _probeSource.SetPixel(0, 1, Color.white); _probeSource.SetPixel(1, 1, Color.white);
            _probeSource.Apply(false);

            _probeTarget = new RenderTexture(2, 2, 0, RenderTextureFormat.ARGB32) { filterMode = FilterMode.Point };
            _probeTarget.Create();
            Graphics.Blit(_probeSource, _probeTarget);

            if (AsyncSupported)
            {
                _probePending = true;
                AsyncGPUReadback.Request(_probeTarget, 0, TextureFormat.RGBA32, OnProbe);
            }
            else
            {
                var pixels = ReadSync(_probeTarget, 2, 2);
                FinishProbe(pixels != null && pixels.Length >= 4 ? pixels[0].r > 127 : (bool?)null);
            }
        }

        private void OnProbe(AsyncGPUReadbackRequest request)
        {
            _probePending = false;
            if (request.hasError)
            {
                Debug.LogWarning("[Arsist] GPU readback probe failed; assuming bottom-up rows.");
                FinishProbe(false);
                return;
            }
            var data = request.GetData<Color32>();
            FinishProbe(data.Length >= 4 ? data[0].r > 127 : (bool?)null);
        }

        private void FinishProbe(bool? topDown)
        {
            RowsTopDown = topDown ?? false;
            Debug.Log($"[Arsist] GPU frame reader: async={AsyncSupported}, readback rows are " +
                      $"{(RowsTopDown.Value ? "top-down (will flip)" : "bottom-up")} on {SystemInfo.graphicsDeviceType}");
            if (_probeSource != null) { UnityEngine.Object.Destroy(_probeSource); _probeSource = null; }
            if (_probeTarget != null) { _probeTarget.Release(); UnityEngine.Object.Destroy(_probeTarget); _probeTarget = null; }
        }

        // ---- 読み出し ----

        /// <summary>
        /// source を width x height に縮めて読み出す。前の読み出しが終わっていなければ false。
        /// callback はメインスレッドで、読み出し完了の次のフレームあたりに呼ばれる。
        /// 渡す配列は使い回すので、callback の中で写すか、次の TryRequest までに使い切ること。
        /// </summary>
        public bool TryRequest(Texture source, int width, int height, FrameReady callback)
        {
            if (source == null || callback == null || width <= 0 || height <= 0) return false;
            EnsureProbe();
            if (!RowsTopDown.HasValue || _pending) return false;

            if (_target == null || _target.width != width || _target.height != height)
            {
                if (_target != null) { _target.Release(); UnityEngine.Object.Destroy(_target); }
                _target = new RenderTexture(width, height, 0, RenderTextureFormat.ARGB32)
                {
                    filterMode = FilterMode.Bilinear,
                    useMipMap = false,
                    autoGenerateMips = false,
                };
                _target.Create();
            }

            // 縮小は GPU で。bilinear なので 2 倍までの縮小はきれい、それ以上は間引きになるが
            // 画像処理の入力としては十分 (元の 1280 幅から 640 や 480 へ)。
            Graphics.Blit(source, _target);

            _callback = callback;
            _pendingWidth = width;
            _pendingHeight = height;
            _requestedAt = Time.realtimeSinceStartupAsDouble;

            if (AsyncSupported)
            {
                _pending = true;
                AsyncGPUReadback.Request(_target, 0, TextureFormat.RGBA32, OnReadback);
            }
            else
            {
                var pixels = ReadSync(_target, width, height);
                LastReadbackMs = (Time.realtimeSinceStartupAsDouble - _requestedAt) * 1000.0;
                PerceptionStats.Readback(LastReadbackMs);
                if (pixels != null) callback(pixels, width, height, RowsTopDown.Value);
            }
            return true;
        }

        private void OnReadback(AsyncGPUReadbackRequest request)
        {
            _pending = false;
            var callback = _callback;
            _callback = null;
            if (callback == null) return;
            if (request.hasError)
            {
                Debug.LogWarning("[Arsist] Async GPU readback reported an error; frame dropped.");
                return;
            }

            int needed = _pendingWidth * _pendingHeight;
            var data = request.GetData<Color32>();
            if (data.Length < needed) return;

            // ワーカーがまだ前の配列を読んでいるかもしれないので、二枚を交互に使う。
            var buffer = NextBuffer(needed);
            data.GetSubArray(0, needed).CopyTo(buffer);

            LastReadbackMs = (Time.realtimeSinceStartupAsDouble - _requestedAt) * 1000.0;
            PerceptionStats.Readback(LastReadbackMs);
            callback(buffer, _pendingWidth, _pendingHeight, RowsTopDown ?? false);
        }

        private Color32[] NextBuffer(int needed)
        {
            _useA = !_useA;
            if (_useA)
            {
                if (_bufferA == null || _bufferA.Length != needed) _bufferA = new Color32[needed];
                return _bufferA;
            }
            if (_bufferB == null || _bufferB.Length != needed) _bufferB = new Color32[needed];
            return _bufferB;
        }

        /// <summary>同期読み出し (非同期に対応しない端末用)。ReadPixels は下から上で返す。</summary>
        private Color32[] ReadSync(RenderTexture target, int width, int height)
        {
            try
            {
                if (_syncStaging == null || _syncStaging.width != width || _syncStaging.height != height)
                {
                    if (_syncStaging != null) UnityEngine.Object.Destroy(_syncStaging);
                    _syncStaging = new Texture2D(width, height, TextureFormat.RGBA32, false);
                }
                var previous = RenderTexture.active;
                RenderTexture.active = target;
                _syncStaging.ReadPixels(new Rect(0, 0, width, height), 0, 0, false);
                RenderTexture.active = previous;
                var buffer = NextBuffer(width * height);
                _syncStaging.GetPixels32(0).CopyTo(buffer, 0);
                return buffer;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Synchronous GPU readback failed: {e.Message}");
                return null;
            }
        }

        public void Dispose()
        {
            if (_target != null) { _target.Release(); UnityEngine.Object.Destroy(_target); _target = null; }
            if (_syncStaging != null) { UnityEngine.Object.Destroy(_syncStaging); _syncStaging = null; }
            if (_probeSource != null) { UnityEngine.Object.Destroy(_probeSource); _probeSource = null; }
            if (_probeTarget != null) { _probeTarget.Release(); UnityEngine.Object.Destroy(_probeTarget); _probeTarget = null; }
            _callback = null;
            _pending = false;
        }
    }
}
