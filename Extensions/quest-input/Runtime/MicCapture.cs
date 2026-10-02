// ==============================================
// Arsist Extension: quest-input — microphone
// Extensions/quest-input/Runtime/MicCapture.cs
//
// Unity の Microphone で Quest のマイクを読む。
//   - 初回に録音の許可 (android.permission.RECORD_AUDIO) を求める
//   - 10 秒の輪っかの AudioClip に録り続け、毎フレーム増えた分だけを取り出す
//   - 音量 (0..1) と、話し始め / 話し終わり (VoiceActivity) を出す
//   - 話し終わったら、その発話 (少し前から) を WAV (既定 16 kHz) で渡す
//     → スクリプトから音声認識 API に送ったり、モデルに渡したりできる
//
// 端末上の音声認識は入れていない (Quest には Android 標準の音声認識サービスが無い)。
// 計算は MicMath (UnityEngine 非依存、検証済み)。
// ==============================================

using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Android;

namespace Arsist.Extensions.QuestInput
{
    internal sealed class MicCapture
    {
        private const int ClipSeconds = 10;
        private const int RingSeconds = 30;
        private const float PreRollSeconds = 0.3f;

        private readonly Action<string> _log;
        private AudioClip _clip;
        private string _device;
        private int _rate;
        private int _lastPosition;
        private float[] _chunk = new float[4096];
        private SampleRing _ring;
        private long _utteranceStart = -1;
        private bool _wanted;
        private bool _asking;
        private sealed class Recording
        {
            public float Seconds;
            public long From = -1;   // 録り始めの位置 (SampleRing.Written)。マイクが開くまでは -1
            public long Until;
            public int OutputRate;
            public Action<Dictionary<string, object>> Done;
        }

        private readonly List<Recording> _recordings = new List<Recording>();

        public readonly VoiceActivity Voice = new VoiceActivity();
        public float Level { get; private set; }
        public float Peak { get; private set; }
        public bool Active => _clip != null && Microphone.IsRecording(_device);
        public string Status { get; private set; } = "off";
        public int SampleRate => _rate;

        /// <summary>話し始め (+1) / 話し終わり (-1、発話の WAV 付き)。</summary>
        public event Action<int, Dictionary<string, object>> VoiceChanged;

        public int OutputRate = 16000;

        public MicCapture(Action<string> log) { _log = log; }

        public void Start()
        {
            _wanted = true;
            if (Active || _asking) return;

            if (!Permission.HasUserAuthorizedPermission(Permission.Microphone))
            {
                _asking = true;
                Status = "permission";
                var callbacks = new PermissionCallbacks();
                callbacks.PermissionGranted += _ => { _asking = false; if (_wanted) Open(); };
                callbacks.PermissionDenied += _ =>
                {
                    _asking = false;
                    Status = "denied";
                    _log("microphone permission denied (Settings > Apps > Permissions > Microphone)");
                };
                Permission.RequestUserPermission(Permission.Microphone, callbacks);
                return;
            }
            Open();
        }

        private void Open()
        {
            if (Microphone.devices == null || Microphone.devices.Length == 0)
            {
                Status = "noDevice";
                _log("no microphone found");
                return;
            }
            _device = Microphone.devices[0];
            Microphone.GetDeviceCaps(_device, out int min, out int max);
            // 16 kHz で録れるならそれで (音声認識の標準)。録れなければ端末の上限で録って後で落とす。
            _rate = (min == 0 && max == 0) ? 16000 : Mathf.Clamp(16000, Mathf.Max(1, min), max);
            _clip = Microphone.Start(_device, true, ClipSeconds, _rate);
            if (_clip == null)
            {
                Status = "failed";
                _log($"Microphone.Start('{_device}') failed");
                return;
            }
            _rate = _clip.frequency;
            _ring = new SampleRing(_rate * RingSeconds);
            _lastPosition = 0;
            Status = "on";
            _log($"microphone on: '{_device}' at {_rate} Hz ({_clip.channels} ch, caps {min}-{max} Hz)");
        }

        public void Stop()
        {
            _wanted = false;
            if (_clip != null) Microphone.End(_device);
            _clip = null;
            Level = 0f;
            Voice.Reset();
            _utteranceStart = -1;
            Status = "off";
            foreach (var r in _recordings) r.Done?.Invoke(Failure("stopped"));
            _recordings.Clear();
        }

        /// <summary>これから seconds 秒を録って渡す。</summary>
        public void Record(float seconds, Action<Dictionary<string, object>> done)
        {
            if (!_wanted) Start();
            if (_ring == null && Status != "permission")
            {
                done?.Invoke(Failure("microphone is " + Status));
                return;
            }
            // 許可を待っている間はまだ録れないので、録り始めの位置はマイクが開いてから決める
            _recordings.Add(new Recording
            {
                Seconds = Mathf.Clamp(seconds, 0.1f, RingSeconds - 1),
                OutputRate = OutputRate,
                Done = done,
            });
        }

        public void Update(float dt)
        {
            if (_clip == null || !Microphone.IsRecording(_device)) return;

            int position = Microphone.GetPosition(_device);
            int total = _clip.samples;
            int count = position >= _lastPosition ? position - _lastPosition : total - _lastPosition + position;
            if (count <= 0) return;
            int channels = Mathf.Max(1, _clip.channels);

            // 輪っかの終わりをまたぐときは 2 回に分けて読む
            Pull(_lastPosition, Mathf.Min(count, total - _lastPosition), channels);
            if (_lastPosition + count > total) Pull(0, count - (total - _lastPosition), channels);
            _lastPosition = position;

            // 録音の依頼を満たす
            for (int i = _recordings.Count - 1; i >= 0; i--)
            {
                var r = _recordings[i];
                if (r.From < 0)
                {
                    // この Update で読んだ分の手前から数え始める
                    r.From = _ring.Written - count;
                    r.Until = r.From + (long)(r.Seconds * _rate);
                }
                if (_ring.Written < r.Until) continue;
                _recordings.RemoveAt(i);
                r.Done?.Invoke(Result(_ring.Range(r.From, r.Until), r.OutputRate));
            }
        }

        private void Pull(int start, int frames, int channels)
        {
            if (frames <= 0) return;
            // GetData は配列の長さぶん読むので、ちょうどの長さで渡す
            int needed = frames * channels;
            if (_chunk.Length != needed) _chunk = new float[needed];
            var buffer = _chunk;
            if (!_clip.GetData(buffer, start)) return;

            // 複数チャンネルなら平均してモノラルに
            var mono = channels == 1 ? buffer : ToMono(buffer, frames, channels);
            _ring.Append(mono, 0, frames);

            var rms = MicMath.Rms(mono, 0, frames);
            Level = MicMath.Level(rms);
            Peak = Mathf.Max(Peak * 0.95f, Level);

            var change = Voice.Update(Level, frames / (float)_rate);
            if (change > 0)
            {
                // 判定に使った時間 + 少し前から (言葉の頭を切らない)
                _utteranceStart = _ring.Written - (long)((Voice.LeadSeconds + PreRollSeconds) * _rate);
                VoiceChanged?.Invoke(+1, null);
            }
            else if (change < 0)
            {
                var samples = _ring.Range(_utteranceStart < 0 ? 0 : _utteranceStart, _ring.Written);
                _utteranceStart = -1;
                VoiceChanged?.Invoke(-1, Result(samples, OutputRate));
            }
        }

        private static float[] ToMono(float[] interleaved, int frames, int channels)
        {
            var mono = new float[frames];
            for (int f = 0; f < frames; f++)
            {
                float sum = 0;
                for (int c = 0; c < channels; c++) sum += interleaved[f * channels + c];
                mono[f] = sum / channels;
            }
            return mono;
        }

        private Dictionary<string, object> Result(float[] samples, int outputRate)
        {
            var output = outputRate > 0 && outputRate != _rate ? MicMath.Resample(samples, _rate, outputRate) : samples;
            var rate = outputRate > 0 ? outputRate : _rate;
            float peak = 0;
            foreach (var s in samples) peak = Mathf.Max(peak, Mathf.Abs(s));
            return new Dictionary<string, object>
            {
                ["ok"] = samples.Length > 0,
                ["wav"] = Convert.ToBase64String(MicMath.EncodeWav16(output, rate)),
                ["sampleRate"] = rate,
                ["seconds"] = Math.Round(samples.Length / (double)Mathf.Max(1, _rate), 2),
                ["level"] = Math.Round(MicMath.Level(peak), 2),
            };
        }

        private static Dictionary<string, object> Failure(string error) =>
            new Dictionary<string, object> { ["ok"] = false, ["error"] = error };
    }
}
