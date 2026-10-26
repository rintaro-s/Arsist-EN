// ==============================================
// Arsist Extension: quest-input — recorder (video + photo)
// samples/extensions/quest-input/Runtime/Recorder.cs
//
// シーンに置いた仮想カメラ (doc/23 の camera) の画を、H.264 + AAC の MP4 にして
// Movies/<フォルダ>/ に保存する。静止画 (JPEG) は Pictures/<フォルダ>/。スクリプトの recorder。
//
//   画   context.Cameras.Require → Rendered ごとに (fps に間引いて)
//        Blit (自前の ARGB32 / sRGB の RT へ。大きさを合わせ、HDR のカメラも 8 bit にする)
//        → AsyncGPUReadback.RequestIntoNativeArray で Java と共有の slot に直接読み出す
//        → Java の作業スレッドで YUV に変換して H.264 (Runtime/Android/ArsistRecorder.java)
//        slot が空いていなければそのフレームは捨てる (dropped)。メインスレッドは待たない。
//   音   MicCapture.RawSamples (モノラル、マイクのサンプルレート) → PCM16 → Java で AAC
//   時刻 画は録り始めからの経過 (一時停止の分を引く)、音はサンプル数から (RecorderMath)
//
// 行の向き: GPU の読み出しが上から下か下から上かは API で違うので、最初に 2x2 の絵で測る
// (エンジンの GpuFrameReader と同じ方法)。MP4 は上から下、JPEG のエンコード (Unity) は下から上を受け取る。
//
// Java を呼ぶのはすべてメインスレッドから (RecorderJava)。Android 以外では録画できず、
// recorder.start は { ok: false, error: "recorder needs Android" } を返す。静止画は
// Application.persistentDataPath/Pictures/<フォルダ>/ に保存する (シミュレーターで試せるように)。
// ==============================================

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using Arsist.Runtime.Extensions;
using Arsist.Runtime.Inference;
using Unity.Collections;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;

namespace Arsist.Extensions.QuestInput
{
    internal sealed class RecorderOptions
    {
        public string Camera;
        public bool Audio = true;
        public int Fps = 30;
        public int Bitrate;
        public int Width;
        public int Height;

        public static RecorderOptions From(Dictionary<string, object> d, int defaultBitrate) => new RecorderOptions
        {
            Camera = MiniJson.Text(d, "camera", null),
            Audio = MiniJson.Bool(d, "audio", true),
            Fps = Mathf.Clamp(MiniJson.Int(d, "fps", 30), 1, 60),
            Bitrate = Mathf.Clamp(MiniJson.Int(d, "bitrate", defaultBitrate), 500_000, 50_000_000),
            Width = Mathf.Max(0, MiniJson.Int(d, "width", 0)),
            Height = Mathf.Max(0, MiniJson.Int(d, "height", 0)),
        };
    }

    internal sealed class Recorder
    {
        private const int SlotCount = 3;
        private const int AudioBufferBytes = 64 * 1024;
        private const double StartTimeout = 10;
        private const double MicWaitTimeout = 30;
        private const double StopTimeout = 15;
        private const double PhotoTimeout = 5;

        private readonly ArsistExtensionContext _ctx;
        private readonly MicCapture _mic;
        private readonly Action<string, object> _publish;
        private readonly RecorderJava _java = new RecorderJava();
        private readonly ConcurrentQueue<Action> _mainThread = new ConcurrentQueue<Action>();
        private readonly string _persistentPath;
        private readonly int _defaultBitrate;
        private readonly double _maxSeconds;

        /// <summary>Movies/〈これ〉/ と Pictures/〈これ〉/ (設定 recorderFolder)。</summary>
        public string Folder { get; }

        /// <summary>idle / starting / recording / paused / stopping</summary>
        public string State { get; private set; } = "idle";

        public double Seconds => _clock.Seconds(Now);

        // ---- 1 回の録画 ----
        private RecorderOptions _opt;
        private Action<Dictionary<string, object>> _startDone;
        private readonly List<Action<Dictionary<string, object>>> _stopDone = new List<Action<Dictionary<string, object>>>();
        private double _phaseSince;
        private bool _openedMic;
        private bool _micHooked;
        private bool _javaBegun;
        private int _width, _height, _audioRate;
        private int _dropped, _inflight, _generation;
        private int _publishedSeconds = -1;
        private string _stopReason = "";
        private readonly RecorderClock _clock = new RecorderClock();
        private FramePacer _pacer;
        private AudioClock _audioClock;

        // ---- 使い回す入れ物 ----
        private RenderTexture _frameRt;
        private NativeArray<byte>[] _slots;
        private int _slotBytes;
        private NativeArray<byte> _audioNative;
        private byte[] _audioScratch;

        // ---- 行の向きの測定 ----
        private bool? _topDown;
        private bool _probing;
        private Texture2D _probeTexture;
        private RenderTexture _probeTarget;

        // ---- 静止画 ----
        private sealed class PhotoJob
        {
            public string Camera;
            public int Width, Height;
            public double Since;
            public bool Requested;
            public Action<Dictionary<string, object>> Done;
        }

        private readonly List<PhotoJob> _photos = new List<PhotoJob>();

        private static double Now => Time.realtimeSinceStartupAsDouble;

        public Recorder(ArsistExtensionContext context, MicCapture mic, Action<string, object> publish)
        {
            _ctx = context;
            _mic = mic;
            _publish = publish;
            _persistentPath = Application.persistentDataPath;
            Folder = RecorderMath.SafeName(context.GetString("recorderFolder", "Arsist"), "Arsist");
            _defaultBitrate = Mathf.Clamp(context.GetInt("recorderBitrate", 8_000_000), 500_000, 50_000_000);
            _maxSeconds = Mathf.Clamp(context.GetFloat("recorderMaxMinutes", 60f), 0f, 600f) * 60.0;
            _ctx.Cameras.Rendered += OnRendered;
            _publish("input.recorder.state", State);
        }

        public int DefaultBitrate => _defaultBitrate;

        // ================= 録画 =================

        public void Start(RecorderOptions opt, Action<Dictionary<string, object>> done)
        {
            if (State != "idle") { done?.Invoke(Fail($"already {State}")); return; }
            if (!RecorderJava.Supported) { done?.Invoke(Fail("recorder needs Android")); return; }
            if (!SystemInfo.supportsAsyncGPUReadback) { done?.Invoke(Fail("this device cannot read frames back from the GPU")); return; }
            if (!_java.Load()) { done?.Invoke(Fail(_java.LoadError)); return; }

            var camera = string.IsNullOrEmpty(opt.Camera) ? FirstCamera() : opt.Camera;
            if (string.IsNullOrEmpty(camera))
            {
                done?.Invoke(Fail("no camera in this scene (add a camera object, or pass { camera: '<id>' })"));
                return;
            }
            if (!_ctx.Cameras.Require(camera, this))
            {
                done?.Invoke(Fail($"no camera '{camera}' (cameras: {string.Join(", ", _ctx.Cameras.Ids)})"));
                return;
            }

            opt.Camera = camera;
            _opt = opt;
            _startDone = done;
            _stopDone.Clear();
            _width = _height = _audioRate = 0;
            _javaBegun = false;
            _dropped = 0;
            _stopReason = "";
            _generation++;
            _clock.Reset();
            _publishedSeconds = -1;
            PublishSeconds(0);
            _phaseSince = Now;
            SetState("starting");
            EnsureProbe();

            _openedMic = false;
            if (opt.Audio && !_mic.Active)
            {
                _openedMic = true;
                _mic.Start();
            }
            _ctx.Log($"recorder: starting (camera '{camera}', {opt.Fps} fps, {opt.Bitrate / 1000} kbps, audio {opt.Audio})");
        }

        public void Stop(string reason, Action<Dictionary<string, object>> done)
        {
            switch (State)
            {
                case "idle":
                    done?.Invoke(Fail("not recording"));
                    return;
                case "stopping":
                    if (done != null) _stopDone.Add(done);
                    return;
                case "starting":
                    if (_javaBegun) _java.End();
                    FailStart("stopped before recording started");
                    done?.Invoke(Fail("stopped before recording started"));
                    return;
            }
            if (done != null) _stopDone.Add(done);
            BeginStopping(reason);
        }

        public bool Pause()
        {
            if (State != "recording") return false;
            _clock.Pause(Now);
            SetState("paused");
            InputEvents.Emit("recorder:paused");
            return true;
        }

        public bool Resume()
        {
            if (State != "paused") return false;
            _clock.Resume(Now);
            _pacer?.Reset();
            SetState("recording");
            InputEvents.Emit("recorder:resumed");
            return true;
        }

        /// <summary>アプリが裏に回った (ヘッドセットを外した・ホームを押した) ら止めて保存する。</summary>
        public void OnApplicationPause(bool paused)
        {
            if (!paused) return;
            if (State == "starting" || State == "recording" || State == "paused")
            {
                _ctx.Log("recorder: the app was paused; stopping and saving");
                Stop("appPaused", null);
            }
        }

        public void Update()
        {
            while (_mainThread.TryDequeue(out var action))
            {
                try { action(); }
                catch (Exception e) { _ctx.Warn("recorder: " + e.Message); }
            }
            UpdatePhotos();

            switch (State)
            {
                case "starting": UpdateStarting(); break;
                case "recording":
                case "paused": UpdateRecording(); break;
                case "stopping": UpdateStopping(); break;
            }
        }

        private void UpdateStarting()
        {
            var now = Now;
            if (!_javaBegun)
            {
                if (_width == 0 || !_topDown.HasValue)
                {
                    if (now - _phaseSince > StartTimeout)
                    {
                        FailStart(_width == 0
                            ? $"camera '{_opt.Camera}' did not render in {StartTimeout} s (is it in the scene and active?)"
                            : "could not measure the GPU readback row order");
                    }
                    return;
                }

                _audioRate = 0;
                if (_opt.Audio)
                {
                    if (_mic.Active) _audioRate = _mic.SampleRate;
                    else if (_mic.Status == "permission" && now - _phaseSince < MicWaitTimeout) return; // 許可の返事を待つ
                    else _ctx.Warn($"recorder: microphone is '{_mic.Status}'; recording without sound");
                }

                Allocate();
                var name = RecorderMath.FileName(DateTime.Now, Folder, "mp4");
                // MP4 は上から下。読み出しが下から上 (topDown == false) なら Java で上下を返す
                if (!_java.Begin(Folder, name, _width, _height, _opt.Fps, _opt.Bitrate, _audioRate, !_topDown.Value,
                                 _slots, _audioNative, out var error))
                {
                    FailStart(error);
                    return;
                }
                _javaBegun = true;
                _phaseSince = now;
                return;
            }

            var js = _java.State();
            if (js == RecorderJava.Recording)
            {
                _clock.Begin(now);
                _pacer = new FramePacer(_opt.Fps);
                _audioClock = _audioRate > 0 ? new AudioClock(_audioRate) : null;
                if (_audioClock != null && !_micHooked)
                {
                    _mic.RawSamples += OnMicSamples;
                    _micHooked = true;
                }
                SetState("recording");
                var info = Info();
                _ctx.Log($"recorder: recording {_width}x{_height} @ {_opt.Fps} fps" + (_audioRate > 0 ? $", sound {_audioRate} Hz" : ", no sound"));
                InputEvents.Emit("recorder:started", info);
                var done = _startDone;
                _startDone = null;
                info["ok"] = true;
                done?.Invoke(info);
            }
            else if (js == RecorderJava.Error || js == RecorderJava.Done)
            {
                FailStart(_java.LastError());
            }
            else if (now - _phaseSince > StartTimeout)
            {
                _java.End();
                FailStart($"the encoder did not start in {StartTimeout} s");
            }
        }

        private void UpdateRecording()
        {
            var seconds = _clock.Seconds(Now);
            PublishSeconds((int)seconds);
            if (_maxSeconds > 0 && seconds >= _maxSeconds)
            {
                _ctx.Log($"recorder: reached the longest length ({_maxSeconds / 60:0.#} min); stopping");
                BeginStopping("maxDuration");
                return;
            }
            var js = _java.State();
            if (js == RecorderJava.Error || js == RecorderJava.Done)
            {
                // エンコーダが途中で止まった。結果 (理由) を受け取りに行く
                BeginStopping("encoderError");
            }
        }

        private void BeginStopping(string reason)
        {
            _stopReason = reason ?? "";
            PublishSeconds((int)_clock.Seconds(Now));
            _clock.Pause(Now); // 以後の Seconds は止まったまま
            _generation++;
            Unhook();
            _java.End();
            _ctx.Cameras.Release(_opt.Camera, this);
            _phaseSince = Now;
            SetState("stopping");
        }

        private void UpdateStopping()
        {
            var js = _java.State();
            var finished = js == RecorderJava.Done || js == RecorderJava.Error || js == RecorderJava.Idle;
            if ((!finished || _inflight > 0) && Now - _phaseSince < StopTimeout) return;

            Dictionary<string, object> result;
            if (!finished)
            {
                result = Fail($"saving did not finish in {StopTimeout} s; the file may be incomplete");
            }
            else
            {
                try { result = MiniJson.ParseObject(_java.Result()); }
                catch (Exception) { result = Fail(_java.LastError()); }
            }
            result["dropped"] = _dropped;
            result["reason"] = _stopReason;
            result["camera"] = _opt.Camera;
            Finish(result);
        }

        private void Finish(Dictionary<string, object> result)
        {
            if (_openedMic)
            {
                _mic.Stop();
                _openedMic = false;
            }
            _clock.Reset();
            SetState("idle");
            var ok = MiniJson.Bool(result, "ok", false);
            if (ok)
            {
                var file = MiniJson.Text(result, "file", "");
                _publish("input.recorder.last", file);
                _ctx.Log($"recorder: saved {file} ({MiniJson.Number(result, "seconds", 0)} s, " +
                         $"{MiniJson.Number(result, "bytes", 0) / 1e6:0.0} MB, dropped {_dropped} frame(s))");
                InputEvents.Emit("recorder:stopped", result);
            }
            else
            {
                _ctx.Warn("recorder: " + MiniJson.Text(result, "error", "failed"));
                InputEvents.Emit("recorder:error", result);
            }
            var callbacks = _stopDone.ToArray();
            _stopDone.Clear();
            foreach (var cb in callbacks) cb(result);
        }

        private void FailStart(string error)
        {
            _ctx.Warn("recorder: could not start: " + error);
            Unhook();
            if (_opt != null) _ctx.Cameras.Release(_opt.Camera, this);
            if (_openedMic)
            {
                _mic.Stop();
                _openedMic = false;
            }
            _generation++;
            _clock.Reset();
            SetState("idle");
            var result = Fail(error);
            InputEvents.Emit("recorder:error", result);
            var done = _startDone;
            _startDone = null;
            done?.Invoke(result);
        }

        private void Unhook()
        {
            if (!_micHooked) return;
            _mic.RawSamples -= OnMicSamples;
            _micHooked = false;
        }

        // ---- 画 ----

        private void OnRendered(string id, RenderTexture rt)
        {
            if (rt == null) return;
            if (_photos.Count > 0) ServePhotos(id, rt);
            if (_opt == null || (State != "starting" && State != "recording")) return;
            if (!Matches(id, rt, _opt.Camera)) return;

            if (State == "starting")
            {
                if (_width == 0) RecorderMath.FitSize(rt.width, rt.height, _opt.Width, _opt.Height, out _width, out _height);
                return;
            }

            var now = Now;
            if (!_pacer.Due(now)) return;
            int slot = _java.Acquire();
            if (slot < 0)
            {
                _dropped++; // エンコードが追いついていない
                return;
            }
            var pts = _clock.Micros(now);
            var generation = _generation;
            try
            {
                Graphics.Blit(rt, _frameRt);
                _inflight++;
                AsyncGPUReadback.RequestIntoNativeArray(ref _slots[slot], _frameRt, 0, TextureFormat.RGBA32,
                    request => OnFrameRead(request, slot, pts, generation));
            }
            catch (Exception e)
            {
                _inflight = Math.Max(0, _inflight - 1);
                _java.Cancel(slot);
                _dropped++;
                _ctx.Warn("recorder: frame readback failed: " + e.Message);
            }
        }

        private void OnFrameRead(AsyncGPUReadbackRequest request, int slot, long pts, int generation)
        {
            _inflight = Math.Max(0, _inflight - 1);
            if (generation != _generation || request.hasError || State == "idle")
            {
                _java.Cancel(slot);
                if (request.hasError) _dropped++;
                return;
            }
            _java.Submit(slot, pts);
        }

        private void Allocate()
        {
            int bytes = _width * _height * 4;
            if (_slots == null || _slotBytes != bytes)
            {
                // 前の slot は、読み出しが残っていなければ返す (残っていれば手放すだけ。まれ)
                if (_slots != null && _inflight == 0)
                {
                    foreach (var s in _slots) if (s.IsCreated) s.Dispose();
                }
                _slots = new NativeArray<byte>[SlotCount];
                for (int i = 0; i < SlotCount; i++)
                {
                    _slots[i] = new NativeArray<byte>(bytes, Allocator.Persistent, NativeArrayOptions.UninitializedMemory);
                }
                _slotBytes = bytes;
            }
            if (_frameRt == null || _frameRt.width != _width || _frameRt.height != _height)
            {
                ReleaseTexture(ref _frameRt);
                _frameRt = new RenderTexture(_width, _height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB)
                {
                    name = "ArsistRecorderFrame",
                    useMipMap = false,
                    filterMode = FilterMode.Bilinear,
                };
                _frameRt.Create();
            }
            if (!_audioNative.IsCreated)
            {
                _audioNative = new NativeArray<byte>(AudioBufferBytes, Allocator.Persistent, NativeArrayOptions.ClearMemory);
                _audioScratch = new byte[AudioBufferBytes];
            }
        }

        // ---- 音 ----

        private void OnMicSamples(float[] samples, int count)
        {
            if (State != "recording" || _audioClock == null || count <= 0) return;
            var pts = _audioClock.Next(count, _clock.Micros(Now));
            if (pts < 0) return; // 音が実時間より進みすぎた: この塊は捨てる
            int offset = 0;
            while (offset < count)
            {
                int n = Math.Min(count - offset, _audioScratch.Length / 2);
                int bytes = RecorderMath.ToPcm16(samples, offset, n, _audioScratch);
                if (bytes <= 0) break;
                NativeArray<byte>.Copy(_audioScratch, _audioNative, bytes);
                _java.PushAudio(bytes, pts + offset * 1_000_000L / _audioRate);
                offset += n;
            }
        }

        // ================= 静止画 =================

        public void Photo(string camera, int width, int height, Action<Dictionary<string, object>> done)
        {
            camera = string.IsNullOrEmpty(camera) ? FirstCamera() : camera;
            if (string.IsNullOrEmpty(camera)) { done?.Invoke(Fail("no camera in this scene")); return; }
            if (!SystemInfo.supportsAsyncGPUReadback) { done?.Invoke(Fail("this device cannot read frames back from the GPU")); return; }
            var job = new PhotoJob { Camera = camera, Width = width, Height = height, Since = Now, Done = done };
            if (!_ctx.Cameras.Require(camera, job))
            {
                done?.Invoke(Fail($"no camera '{camera}'"));
                return;
            }
            EnsureProbe();
            _photos.Add(job);
        }

        private void ServePhotos(string id, RenderTexture rt)
        {
            if (!_topDown.HasValue) return;
            foreach (var job in _photos.ToArray())
            {
                if (job.Requested || !Matches(id, rt, job.Camera)) continue;
                job.Requested = true;
                _ctx.Cameras.Release(job.Camera, job);

                int w = job.Width > 0 ? job.Width : rt.width;
                int h = job.Height > 0 ? job.Height : rt.height;
                if (job.Width > 0 && job.Height <= 0) h = Mathf.Max(1, Mathf.RoundToInt(job.Width * rt.height / (float)rt.width));
                if (job.Height > 0 && job.Width <= 0) w = Mathf.Max(1, Mathf.RoundToInt(job.Height * rt.width / (float)rt.height));
                w = Mathf.Clamp(w, 1, 8192);
                h = Mathf.Clamp(h, 1, 8192);

                var temp = RenderTexture.GetTemporary(w, h, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
                Graphics.Blit(rt, temp);
                // JPEG のエンコード (Unity) は下から上の行を受け取る。読み出しが上から下なら返す
                var flip = _topDown.Value;
                AsyncGPUReadback.Request(temp, 0, TextureFormat.RGBA32, request => OnPhotoRead(request, job, temp, w, h, flip));
            }
        }

        private void OnPhotoRead(AsyncGPUReadbackRequest request, PhotoJob job, RenderTexture temp, int w, int h, bool flip)
        {
            RenderTexture.ReleaseTemporary(temp);
            _photos.Remove(job);
            if (request.hasError)
            {
                job.Done?.Invoke(Fail("GPU readback failed"));
                return;
            }
            var pixels = request.GetData<byte>().ToArray();
            var folder = Folder;
            var name = RecorderMath.FileName(DateTime.Now, Folder, "jpg");

            // エンコード (1080p で数十 ms) はメインスレッドの外で。駄目ならメインスレッドでやり直す
            ThreadPool.QueueUserWorkItem(_ =>
            {
                byte[] jpeg = null;
                try
                {
                    if (flip) RecorderMath.FlipRows(pixels, w * 4, h);
                    jpeg = ImageConversion.EncodeArrayToJPG(pixels, GraphicsFormat.R8G8B8A8_UNorm, (uint)w, (uint)h, 0, 90);
                }
                catch (Exception) { jpeg = null; }
                _mainThread.Enqueue(() =>
                {
                    if (jpeg == null)
                    {
                        try { jpeg = ImageConversion.EncodeArrayToJPG(pixels, GraphicsFormat.R8G8B8A8_UNorm, (uint)w, (uint)h, 0, 90); }
                        catch (Exception e)
                        {
                            job.Done?.Invoke(Fail("JPEG encoding failed: " + e.Message));
                            return;
                        }
                    }
                    var result = SavePhoto(folder, name, jpeg);
                    result["width"] = w;
                    result["height"] = h;
                    result["camera"] = job.Camera;
                    if (MiniJson.Bool(result, "ok", false))
                    {
                        _publish("input.recorder.last", MiniJson.Text(result, "file", ""));
                        _ctx.Log($"recorder: photo saved {MiniJson.Text(result, "file", "")}");
                        InputEvents.Emit("recorder:photo", result);
                    }
                    else
                    {
                        _ctx.Warn("recorder: photo: " + MiniJson.Text(result, "error", "failed"));
                    }
                    job.Done?.Invoke(result);
                });
            });
        }

        private Dictionary<string, object> SavePhoto(string folder, string name, byte[] jpeg)
        {
            if (RecorderJava.Supported)
            {
                var json = _java.SavePhoto(folder, name, jpeg);
                if (string.IsNullOrEmpty(json)) return Fail(_java.LoadError != "" ? _java.LoadError : "saving the photo failed");
                try { return MiniJson.ParseObject(json); }
                catch (Exception e) { return Fail("bad answer from Java: " + e.Message); }
            }
            try
            {
                var dir = Path.Combine(_persistentPath, "Pictures", folder);
                Directory.CreateDirectory(dir);
                var path = Path.Combine(dir, name);
                File.WriteAllBytes(path, jpeg);
                return new Dictionary<string, object>
                {
                    ["ok"] = true,
                    ["file"] = path,
                    ["uri"] = new Uri(path).AbsoluteUri,
                    ["bytes"] = jpeg.Length,
                };
            }
            catch (Exception e)
            {
                return Fail("saving the photo failed: " + e.Message);
            }
        }

        private void UpdatePhotos()
        {
            if (_photos.Count == 0) return;
            var now = Now;
            foreach (var job in _photos.ToArray())
            {
                if (job.Requested || now - job.Since < PhotoTimeout) continue;
                _photos.Remove(job);
                _ctx.Cameras.Release(job.Camera, job);
                job.Done?.Invoke(Fail($"camera '{job.Camera}' did not render in {PhotoTimeout} s"));
            }
        }

        // ================= 一覧 =================

        /// <summary>このアプリが保存した動画 [{ file, uri, bytes, date, seconds? }]。</summary>
        public List<object> List()
        {
            if (RecorderJava.Supported)
            {
                var json = _java.List(Folder);
                if (string.IsNullOrEmpty(json)) return new List<object>();
                try { return MiniJson.Parse(json) as List<object> ?? new List<object>(); }
                catch (Exception) { return new List<object>(); }
            }
            var list = new List<object>();
            try
            {
                var dir = Path.Combine(_persistentPath, "Movies", Folder);
                if (Directory.Exists(dir))
                {
                    foreach (var path in Directory.GetFiles(dir, "*.mp4"))
                    {
                        var info = new FileInfo(path);
                        list.Add(new Dictionary<string, object>
                        {
                            ["file"] = path,
                            ["uri"] = new Uri(path).AbsoluteUri,
                            ["bytes"] = info.Length,
                            ["date"] = info.LastWriteTimeUtc.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"),
                        });
                    }
                }
            }
            catch (Exception e)
            {
                _ctx.Warn("recorder: list: " + e.Message);
            }
            return list;
        }

        // ================= 後片付け =================

        /// <summary>アプリが終わるとき。録画中なら保存を最大 3 秒待つ。</summary>
        public void Dispose()
        {
            _ctx.Cameras.Rendered -= OnRendered;
            Unhook();
            bool javaDone = true;
            if (State != "idle")
            {
                if (State != "stopping") _java.End();
                javaDone = _java.AwaitFinish(3000);
                if (_opt != null) _ctx.Cameras.Release(_opt.Camera, this);
            }
            AsyncGPUReadback.WaitAllRequests();
            if (_slots != null && javaDone)
            {
                foreach (var s in _slots) if (s.IsCreated) s.Dispose();
                _slots = null;
            }
            if (_audioNative.IsCreated) _audioNative.Dispose();
            ReleaseTexture(ref _frameRt);
            ReleaseTexture(ref _probeTarget);
            if (_probeTexture != null) UnityEngine.Object.Destroy(_probeTexture);
            _probeTexture = null;
        }

        // ================= 小物 =================

        /// <summary>
        /// 読み出した行が上から下か (GpuFrameReader と同じ測り方)。2x2 の絵の上の行 (SetPixel の y = 1) を白にして、
        /// 自前の RT へ Blit して読み出し、先頭の画素が白なら「上から下」。録画と同じ経路 (Blit → 読み出し) で測る。
        /// </summary>
        private void EnsureProbe()
        {
            if (_topDown.HasValue || _probing) return;
            _probing = true;
            _probeTexture = new Texture2D(2, 2, TextureFormat.RGBA32, false) { filterMode = FilterMode.Point };
            _probeTexture.SetPixel(0, 0, Color.black);
            _probeTexture.SetPixel(1, 0, Color.black);
            _probeTexture.SetPixel(0, 1, Color.white);
            _probeTexture.SetPixel(1, 1, Color.white);
            _probeTexture.Apply(false);
            _probeTarget = new RenderTexture(2, 2, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB) { filterMode = FilterMode.Point };
            _probeTarget.Create();
            Graphics.Blit(_probeTexture, _probeTarget);
            AsyncGPUReadback.Request(_probeTarget, 0, TextureFormat.RGBA32, request =>
            {
                _probing = false;
                if (request.hasError)
                {
                    _topDown = false;
                    _ctx.Warn("recorder: GPU readback probe failed; assuming bottom-up rows");
                }
                else
                {
                    var data = request.GetData<byte>();
                    _topDown = data.Length >= 4 && data[0] > 127;
                    _ctx.Log($"recorder: GPU readback rows are {(_topDown.Value ? "top-down" : "bottom-up")} on {SystemInfo.graphicsDeviceType}");
                }
                ReleaseTexture(ref _probeTarget);
                if (_probeTexture != null) UnityEngine.Object.Destroy(_probeTexture);
                _probeTexture = null;
            });
        }

        private bool Matches(string id, RenderTexture rt, string camera) =>
            id == camera || (rt != null && rt == _ctx.Cameras.GetTexture(camera));

        private string FirstCamera()
        {
            foreach (var id in _ctx.Cameras.Ids) return id;
            return null;
        }

        private Dictionary<string, object> Info() => new Dictionary<string, object>
        {
            ["camera"] = _opt.Camera,
            ["width"] = _width,
            ["height"] = _height,
            ["fps"] = _opt.Fps,
            ["bitrate"] = _opt.Bitrate,
            ["audio"] = _audioRate > 0,
            ["sampleRate"] = _audioRate,
        };

        private void SetState(string state)
        {
            State = state;
            _publish("input.recorder.state", state);
        }

        private void PublishSeconds(int seconds)
        {
            if (seconds == _publishedSeconds) return;
            _publishedSeconds = seconds;
            _publish("input.recorder.seconds", seconds);
        }

        private static void ReleaseTexture(ref RenderTexture rt)
        {
            if (rt == null) return;
            rt.Release();
            UnityEngine.Object.Destroy(rt);
            rt = null;
        }

        private static Dictionary<string, object> Fail(string error) =>
            new Dictionary<string, object> { ["ok"] = false, ["error"] = error };
    }
}
