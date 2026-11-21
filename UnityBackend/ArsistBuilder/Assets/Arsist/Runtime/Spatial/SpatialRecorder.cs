// ==============================================
// Arsist Engine - Layster.Spatial: 記録 (layster.episode/1)
// Assets/Arsist/Runtime/Spatial/SpatialRecorder.cs
//
// World Model の学習・実機無しの試験のために、体験を端末に書き残す (doc/19-layster.md §3.9、形式は Core/EpisodeFormat)。
//   どこへ   Application.persistentDataPath/layster/episodes/<開始時刻>/ (meta.json・episode.jsonl・camera/*.jpg)
//   いつ     recording.enabled なら起動したとき、そうでなければ world.record.start()。
//            どちらも先に同意の文を出し、承諾されるまで何も書かない (起動ごとに聞く)
//   何を     streams に書いたものだけ: pose / hands (hz で) ・ world (変わったとき、最大 2 秒に 1 回) ・
//            events / actions / minds (起きたとき) ・ camera (everyMs ごと、JPEG)
//   終わり   world.record.stop()・maxMinutes・アプリが終わるとき。send.url があれば、そこへ multipart で送る
// ==============================================

using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Spatial.Core;
using UnityEngine;
using UnityEngine.Networking;

namespace Arsist.Runtime.Spatial
{
    public sealed class SpatialRecorder
    {
        private readonly ArsistSpatialRuntime _rt;
        private readonly RecordingDef _def;
        private StreamWriter _writer;
        private string _dir;
        private double _started;
        private double _nextPose;
        private double _nextWorld;
        private int _worldVersion = -1;
        private double _nextCamera;
        private bool _capturing;
        private bool _asking;
        private double _lastFlush;
        private int _lines;

        public bool Active => _writer != null;
        public string Directory => _dir;

        public SpatialRecorder(ArsistSpatialRuntime runtime)
        {
            _rt = runtime;
            _def = runtime.Model.Recording;
            SetStore();
        }

        private void SetStore()
        {
            ArsistDataStore.Instance.SetValue("layster.recording.active", Active);
            ArsistDataStore.Instance.SetValue("layster.recording.dir", _dir ?? "");
        }

        /// <summary>同意を聞いてから始める。done(true) = 始まった。</summary>
        public void Start(Action<bool> done = null)
        {
            if (Active) { done?.Invoke(true); return; }
            if (_asking) { done?.Invoke(false); return; }
            if (_def.Streams.Count == 0) { Debug.LogWarning("[Layster] record: no streams to record"); done?.Invoke(false); return; }
            var text = string.IsNullOrWhiteSpace(_def.ConsentText) ? "Record this session (head and hand positions, the room, actions)?" : _def.ConsentText;
            _asking = true;
            _rt.Ui.Confirm(text, ok =>
            {
                _asking = false;
                if (ok) Begin();
                else Debug.Log("[Layster] record: the user declined; nothing is recorded");
                done?.Invoke(ok);
            });
        }

        private void Begin()
        {
            var stamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
            _dir = Path.Combine(Application.persistentDataPath, "layster", "episodes", stamp);
            System.IO.Directory.CreateDirectory(_dir);
            File.WriteAllText(Path.Combine(_dir, "meta.json"),
                EpisodeFormat.Meta(_rt.Model.Name, _rt.Model.LaysterVersion, SystemInfo.deviceModel, DateTime.UtcNow.ToString("o"), _def.Streams, _def.Hz));
            _writer = new StreamWriter(Path.Combine(_dir, "episode.jsonl"), false, new UTF8Encoding(false));
            _started = _rt.Now;
            _lines = 0;
            Write("start", new Dictionary<string, object> { ["streams"] = new List<object>(_def.Streams) });
            Debug.Log($"[Layster] record: started {_dir}");
            SetStore();
        }

        public void Stop()
        {
            if (!Active) return;
            Write("stop", new Dictionary<string, object> { ["lines"] = (double)_lines, ["seconds"] = Math.Round(_rt.Now - _started, 1) });
            try { _writer.Flush(); _writer.Dispose(); } catch (Exception) { }
            _writer = null;
            Debug.Log($"[Layster] record: stopped ({_lines} lines) {_dir}");
            SetStore();
            if (!string.IsNullOrEmpty(_def.SendUrl)) _rt.StartCoroutine(Upload(_dir));
        }

        public void Mark(string label) => Write("mark", new Dictionary<string, object> { ["label"] = label ?? "" });

        private void Write(string kind, object data)
        {
            if (_writer == null) return;
            try
            {
                _writer.WriteLine(EpisodeFormat.Line(_rt.Now, kind, data));
                _lines++;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Layster] record: write failed ({e.Message}); stopping");
                _writer = null;
                SetStore();
            }
        }

        // ---- 出来事から ----

        public void Event(string name, object data)
        {
            if (Active && _def.Has("events")) Write("event", new Dictionary<string, object> { ["name"] = name, ["data"] = data });
        }

        public void Action(string source, object action)
        {
            if (Active && _def.Has("actions")) Write("action", new Dictionary<string, object> { ["source"] = source, ["action"] = action });
        }

        public void Mind(string mind, string phase, object data)
        {
            if (Active && _def.Has("minds")) Write("mind", new Dictionary<string, object> { ["mind"] = mind, ["phase"] = phase, ["data"] = data });
        }

        // ---- 毎フレーム ----

        public void Tick()
        {
            if (!Active) return;
            double now = _rt.Now;
            if (_def.MaxMinutes > 0 && now - _started > _def.MaxMinutes * 60) { Stop(); return; }
            var user = _rt.User;
            if (now >= _nextPose)
            {
                _nextPose = now + 1.0 / Math.Max(1, _def.Hz);
                if (_def.Has("pose") && user.HasHead) Write("pose", EpisodeFormat.Pose(user.HeadAt, user.Forward, user.Feet, user.Yaw));
                if (_def.Has("hands"))
                {
                    Write("hands", new Dictionary<string, object>
                    {
                        ["left"] = user.LeftHand.HasValue ? user.LeftHand.Value.ToPlainRounded() : null,
                        ["right"] = user.RightHand.HasValue ? user.RightHand.Value.ToPlainRounded() : null,
                    });
                }
            }
            if (_def.Has("world") && now >= _nextWorld && _rt.World.Version != _worldVersion)
            {
                _nextWorld = now + 2;
                _worldVersion = _rt.World.Version;
                var list = new List<object>();
                foreach (var e in _rt.World.Entities()) list.Add(WorldState.ToPlain(e, _rt.Model.Vocabulary));
                var things = new List<object>();
                foreach (var b in _rt.Placer.Bindings)
                    if (b.Placed) things.Add(new Dictionary<string, object> { ["id"] = b.Def.Id, ["at"] = b.Pose.At.ToPlainRounded(), ["yaw"] = SpatialMath.Round3(b.Pose.Yaw), ["visible"] = b.AppliedVisible });
                Write("world", new Dictionary<string, object> { ["entities"] = list, ["things"] = things });
            }
            if (_def.Has("camera") && !_capturing && now >= _nextCamera && SpatialCamera.Available)
            {
                _nextCamera = now + Math.Max(0.2, _def.CameraEveryMs / 1000.0);
                _capturing = true;
                double at = now;
                SpatialCamera.Capture(_def.CameraWidth, 70, image =>
                {
                    _capturing = false;
                    if (image == null || !Active) return;
                    var name = $"camera/{at:0000.000}.jpg".Replace(',', '.');
                    try
                    {
                        System.IO.Directory.CreateDirectory(Path.Combine(_dir, "camera"));
                        File.WriteAllBytes(Path.Combine(_dir, name), Convert.FromBase64String(J.Str(image, "data", "")));
                        image.Remove("data");
                        image["file"] = name;
                        Write("camera", image);
                    }
                    catch (Exception e) { Debug.LogWarning($"[Layster] record: camera frame not saved ({e.Message})"); }
                });
            }
            if (now - _lastFlush > 1)
            {
                _lastFlush = now;
                try { _writer?.Flush(); } catch (Exception) { }
            }
        }

        private IEnumerator Upload(string dir)
        {
            var url = Core.MindProtocol.ResolveEdge(_def.SendUrl, _rt.Minds.Edge());
            var form = new List<IMultipartFormSection>
            {
                new MultipartFormFileSection("meta", File.ReadAllBytes(Path.Combine(dir, "meta.json")), "meta.json", "application/json"),
                new MultipartFormFileSection("episode", File.ReadAllBytes(Path.Combine(dir, "episode.jsonl")), "episode.jsonl", "application/x-ndjson"),
            };
            using (var req = UnityWebRequest.Post(url, form))
            {
                req.timeout = 60;
                yield return req.SendWebRequest();
                if (req.result == UnityWebRequest.Result.Success) Debug.Log($"[Layster] record: sent to {url}");
                else Debug.LogWarning($"[Layster] record: sending to {url} failed: {req.error}");
            }
        }
    }
}
