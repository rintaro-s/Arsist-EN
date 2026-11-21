// ==============================================
// Arsist Engine - Media: MJPEG の配信を読む
// Assets/Arsist/Runtime/Media/MjpegStream.cs
//
// multipart/x-mixed-replace の配信 (products/ScreenCast、IP カメラ) を UnityWebRequest で読み続け、
// 届いた JPEG を 1 枚の Texture2D に入れる。doc/23-cameras-media.md。
//
//   - 受け取り: DownloadHandlerScript.ReceiveData (Unity がメインスレッドで呼ぶ) → MjpegParser に渡すだけ
//     (区切りを探すだけなので軽い)。
//   - 絵にする: Tick (メインスレッド、1 フレームに 1 回) で最新の 1 枚だけを ImageConversion.LoadImage。
//     古い枚は捨てる (遅れて追いかけない)。Texture2D は使い回す (大きさが変われば LoadImage が合わせる)。
//   - 切れたら 1, 2, 4, 8 秒… (最大 10 秒) 待ってつなぎ直す。10 秒何も届かなければ切ってつなぎ直す。
//   - Status: waiting (URL がまだ無い) / connecting / live / error: …
//
// HTTP (暗号化なし) で LAN の PC から読む。Android の cleartext は各端末の AndroidManifest
// (usesCleartextTraffic)、Unity 側は PlayerSettings.insecureHttpOption = AlwaysAllowed (ビルドが設定済み)。
// ==============================================

using System;
using UnityEngine;
using UnityEngine.Networking;

namespace Arsist.Runtime.Media
{
    public sealed class MjpegStream : IDisposable
    {
        private const float StallSeconds = 10f;
        private const float MaxBackoff = 10f;

        public string Url { get; private set; }
        public string Status { get; private set; } = "waiting";
        /// <summary>直近 1 秒の、絵にした枚数。</summary>
        public float Fps { get; private set; }
        public Texture2D Texture => _texture;
        /// <summary>絵が新しくなるたびに増える。</summary>
        public int Version { get; private set; }
        public int Width => _texture != null ? _texture.width : 0;
        public int Height => _texture != null ? _texture.height : 0;
        public bool HasFrame => Version > 0;

        private UnityWebRequest _request;
        private Handler _handler;
        private readonly MjpegParser _parser = new MjpegParser();
        private Texture2D _texture;
        private float _retryAt = -1f;
        private float _backoff = 1f;
        private float _lastDataAt;
        private int _framesThisSecond;
        private float _secondStart;
        private bool _gotHeaders;
        private string _lastError;

        /// <summary>つなぐ先を変える。null / 空ならつながない (waiting)。同じ URL なら何もしない。</summary>
        public void SetUrl(string url)
        {
            url = string.IsNullOrWhiteSpace(url) ? null : url.Trim();
            if (url == Url) return;
            Url = url;
            Disconnect();
            _backoff = 1f;
            _retryAt = url == null ? -1f : 0f;
            Status = url == null ? "waiting" : "connecting";
        }

        /// <summary>毎フレーム (メインスレッド)。絵が新しくなったら true。</summary>
        public bool Tick()
        {
            float now = Time.unscaledTime;
            if (now - _secondStart >= 1f)
            {
                Fps = _framesThisSecond / Mathf.Max(0.001f, now - _secondStart);
                _framesThisSecond = 0;
                _secondStart = now;
            }

            if (Url == null) return false;

            if (_request == null)
            {
                if (_retryAt >= 0f && now >= _retryAt) Connect();
                return false;
            }

            if (!_gotHeaders && _request.responseCode > 0)
            {
                _gotHeaders = true;
                var type = _request.GetResponseHeader("Content-Type");
                var boundary = MjpegParser.ExtractBoundary(type);
                if (!string.IsNullOrEmpty(boundary)) _parser.SetBoundary(boundary);
            }

            bool updated = false;
            var jpeg = _parser.TakeLatest();
            if (jpeg != null) updated = Decode(jpeg);

            if (_request.isDone)
            {
                var reason = _request.result == UnityWebRequest.Result.Success
                    ? (_request.responseCode >= 400 ? $"HTTP {_request.responseCode}" : "the stream ended")
                    : (_request.responseCode >= 400 ? $"HTTP {_request.responseCode}" : _request.error);
                Fail(reason);
            }
            else if (now - _lastDataAt > StallSeconds)
            {
                Fail($"nothing received for {StallSeconds:0} s");
            }
            return updated;
        }

        private bool Decode(byte[] jpeg)
        {
            if (_texture == null)
            {
                _texture = new Texture2D(2, 2, TextureFormat.RGB24, false)
                {
                    name = "ArsistMjpeg",
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = FilterMode.Bilinear,
                };
            }
            bool ok;
            try { ok = ImageConversion.LoadImage(_texture, jpeg, false); }
            catch (Exception e) { ok = false; _lastError = e.Message; }
            if (!ok)
            {
                // 1 枚壊れていても切らない (次の枚で直る)
                if (_lastError == null) Debug.LogWarning($"[Arsist] MJPEG: a frame from {Url} could not be decoded ({jpeg.Length} bytes)");
                _lastError = "decode";
                return false;
            }
            _lastError = null;
            _framesThisSecond++;
            Version++;
            _backoff = 1f;
            if (Status != "live")
            {
                Status = "live";
                Debug.Log($"[Arsist] MJPEG live: {Url} ({_texture.width}x{_texture.height})");
            }
            return true;
        }

        private void Connect()
        {
            _retryAt = -1f;
            _parser.Reset();
            _gotHeaders = false;
            _lastDataAt = Time.unscaledTime;
            try
            {
                _handler = new Handler(this);
                _request = new UnityWebRequest(Url, UnityWebRequest.kHttpVerbGET, _handler, null)
                {
                    timeout = 0, // 配信は終わらないので、全体の時間切れは使わない (届かない時間は自分で見る)
                    disposeDownloadHandlerOnDispose = true,
                };
                _request.SetRequestHeader("Accept", "multipart/x-mixed-replace, image/jpeg");
                _request.SendWebRequest();
                if (Status != "live") Status = "connecting";
            }
            catch (Exception e)
            {
                _request = null;
                Fail(e.Message);
            }
        }

        private void Fail(string reason)
        {
            Disconnect();
            if (string.IsNullOrEmpty(reason)) reason = "unknown";
            var status = "error: " + reason;
            if (Status != status) Debug.LogWarning($"[Arsist] MJPEG {Url}: {reason} (retrying in {_backoff:0} s)");
            Status = status;
            _retryAt = Time.unscaledTime + _backoff;
            _backoff = Mathf.Min(MaxBackoff, _backoff * 2f);
        }

        private void Disconnect()
        {
            if (_handler != null) _handler.Owner = null;
            if (_request != null)
            {
                try { if (!_request.isDone) _request.Abort(); } catch { }
                _request.Dispose();
                _request = null;
            }
            _handler = null;
            Fps = 0f;
        }

        private void OnData(byte[] data, int length)
        {
            _lastDataAt = Time.unscaledTime;
            _parser.Feed(data, 0, length);
        }

        public void Dispose()
        {
            Disconnect();
            Url = null;
            Status = "waiting";
            if (_texture != null) { UnityEngine.Object.Destroy(_texture); _texture = null; }
        }

        private sealed class Handler : DownloadHandlerScript
        {
            public MjpegStream Owner;

            public Handler(MjpegStream owner) : base(new byte[64 * 1024]) { Owner = owner; }

            protected override bool ReceiveData(byte[] data, int dataLength)
            {
                var owner = Owner;
                if (owner == null) return false;
                if (data != null && dataLength > 0) owner.OnData(data, dataLength);
                return true;
            }
        }
    }
}
