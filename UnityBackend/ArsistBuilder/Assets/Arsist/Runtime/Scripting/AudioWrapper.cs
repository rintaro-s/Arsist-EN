// ==============================================
// Arsist Engine - スクリプトの audio (音・声を鳴らす)
//
//   var h = audio.play(source[, { at, volume, loop, lipSync, type }][, fn(ok, error)])
//   audio.stop([h]) / audio.isPlaying([h]) / audio.setVolume(h, v) / audio.level(h)
//
// source:
//   - http(s):// の URL
//   - プロジェクトのファイル ("Assets/Audio/x.wav")。ビルドで StreamingAssets/ArsistAssets/ に入っているもの
//   - base64 / data: URL (読み上げ API の応答を api.request の responseType "base64" で受けたもの、マイクの WAV)
//   - 端末のファイル (file:// か絶対パス)
// 形式は中身の先頭で見分ける (WAV は自前で読む。MP3 / OGG は一時ファイルにして Unity に読ませる)。
//
// at に物の id を渡すと、その物から 3D で鳴る。VRM なら頭のボーンから鳴り、声に合わせて口が動く
// (lipSync: false で切れる)。
// ==============================================

using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using Arsist.Runtime.Audio;
using Jint.Native;
using UnityEngine;
using UnityEngine.Networking;

namespace Arsist.Runtime.Scripting
{
    [UnityEngine.Scripting.Preserve]
    public sealed class AudioWrapper
    {
        private readonly JsBridge _js;
        private readonly Dictionary<string, ArsistSoundPlayback> _sounds = new Dictionary<string, ArsistSoundPlayback>();
        private int _next = 1;

        public AudioWrapper(JsBridge js)
        {
            _js = js;
        }

        [UnityEngine.Scripting.Preserve]
        public string play(JsValue source, JsValue optionsOrCallback = null, JsValue callback = null)
        {
            JsValue options = optionsOrCallback;
            if (_js.IsFunction(optionsOrCallback))
            {
                callback = optionsOrCallback;
                options = null;
            }
            var opts = _js.FromJs(options) as Dictionary<string, object>;
            var handle = "s" + _next++;

            var go = new GameObject("[ArsistSound] " + handle);
            var audioSource = go.AddComponent<AudioSource>();
            audioSource.playOnAwake = false;
            var playback = go.AddComponent<ArsistSoundPlayback>();
            playback.Handle = handle;
            playback.Source = audioSource;
            _sounds[handle] = playback;

            var cb = callback;
            playback.Finished = (ok, error) =>
            {
                _sounds.Remove(handle);
                if (!ok && error != "stopped") Debug.LogWarning($"[ArsistJS] audio.play {handle}: {error}");
                _js.Call(cb, "audio.play callback", ok, error);
            };

            // 鳴らす場所
            var at = JsBridge.Text(opts, "at");
            bool spatial = false;
            if (!string.IsNullOrEmpty(at))
            {
                var scene = ScriptEngineManager.Instance?.SceneWrapper;
                if (scene != null && scene.TryGetObject(at, out var target))
                {
                    spatial = true;
                    var follow = target.transform;
                    var animator = target.GetComponentInChildren<Animator>();
                    if (animator != null && animator.isHuman)
                    {
                        var head = animator.GetBoneTransform(HumanBodyBones.Head);
                        if (head != null) follow = head;
                    }
                    playback.Follow = follow;
                    go.transform.position = follow.position;

                    bool isVrm = ScriptEngineManager.Instance.VRMWrapper != null && ScriptEngineManager.Instance.VRMWrapper.exists(at);
                    if (isVrm && JsBridge.Flag(opts, "lipSync", true))
                    {
                        playback.LipSyncTarget = target.GetComponentInChildren<Arsist.Runtime.VRM.VRMExpressionController>();
                        if (playback.LipSyncTarget == null)
                            Debug.LogWarning($"[ArsistJS] audio.play: VRM '{at}' has no expression controller; the mouth will not move");
                    }
                }
                else
                {
                    Debug.LogWarning($"[ArsistJS] audio.play: object '{at}' not found; playing without a position");
                }
            }
            audioSource.spatialBlend = spatial ? 1f : 0f;
            audioSource.rolloffMode = AudioRolloffMode.Logarithmic;
            audioSource.minDistance = 1f;
            audioSource.maxDistance = 25f;

            float volume = (float)JsBridge.Number(opts, "volume", 1);
            bool loop = JsBridge.Flag(opts, "loop", false);
            var typeHint = JsBridge.Text(opts, "type");

            var runner = CoroutineRunner.Instance;
            if (runner == null)
            {
                playback.Fail("notReady");
                return handle;
            }
            var src = _js.FromJs(source) as string;
            runner.StartCoroutine(Load(src, typeHint, playback, volume, loop));
            return handle;
        }

        [UnityEngine.Scripting.Preserve]
        public void stop(string handle = null)
        {
            if (string.IsNullOrEmpty(handle))
            {
                foreach (var sound in new List<ArsistSoundPlayback>(_sounds.Values)) if (sound != null) sound.Stop();
                _sounds.Clear();
                return;
            }
            if (_sounds.TryGetValue(handle, out var one) && one != null) one.Stop();
        }

        [UnityEngine.Scripting.Preserve]
        public bool isPlaying(string handle = null)
        {
            if (string.IsNullOrEmpty(handle))
            {
                foreach (var sound in _sounds.Values) if (sound != null && sound.IsPlaying) return true;
                return false;
            }
            return _sounds.TryGetValue(handle, out var one) && one != null && one.IsPlaying;
        }

        [UnityEngine.Scripting.Preserve]
        public void setVolume(string handle, double volume)
        {
            if (_sounds.TryGetValue(handle ?? "", out var one) && one != null && one.Source != null)
                one.Source.volume = Mathf.Clamp01((float)volume);
        }

        [UnityEngine.Scripting.Preserve]
        public double level(string handle)
        {
            return _sounds.TryGetValue(handle ?? "", out var one) && one != null ? one.Level : 0;
        }

        // ---- 読み込み ----

        private static IEnumerator Load(string source, string typeHint, ArsistSoundPlayback playback, float volume, bool loop)
        {
            if (string.IsNullOrWhiteSpace(source)) { playback.Fail("noSource"); yield break; }
            source = source.Trim();

            byte[] bytes = null;
            string nameHint = typeHint;
            string error = null;

            if (source.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || source.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                using var req = UnityWebRequest.Get(source);
                req.timeout = 60;
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success) error = "download: " + req.error;
                else
                {
                    bytes = req.downloadHandler.data;
                    nameHint = nameHint ?? req.GetResponseHeader("Content-Type") ?? source;
                }
            }
            else if (LooksLikeProjectAsset(source))
            {
                var relative = source.Replace('\\', '/');
                if (relative.StartsWith("Assets/", StringComparison.OrdinalIgnoreCase)) relative = relative.Substring("Assets/".Length);
                var path = Path.Combine(Application.streamingAssetsPath, "ArsistAssets", relative);
                var url = path.Contains("://") ? path : "file://" + path;
                using var req = UnityWebRequest.Get(url);
                req.timeout = 30;
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success) error = $"assetNotInBuild: {source}";
                else
                {
                    bytes = req.downloadHandler.data;
                    nameHint = nameHint ?? source;
                }
            }
            else if (source.StartsWith("file://", StringComparison.OrdinalIgnoreCase) || (Path.IsPathRooted(source) && File.Exists(source)))
            {
                var path = source.StartsWith("file://", StringComparison.OrdinalIgnoreCase) ? source.Substring(7) : source;
                try { bytes = File.ReadAllBytes(path); nameHint = nameHint ?? path; }
                catch (Exception e) { error = "file: " + e.Message; }
            }
            else
            {
                bytes = AudioDecoding.DecodeBase64(source, out var mime);
                nameHint = nameHint ?? mime;
                if (bytes == null) error = "badSource (not a URL, a project file or base64 audio)";
            }

            if (playback == null || playback.Done) yield break;   // 読み込み中に止められた
            if (error != null) { playback.Fail(error); yield break; }

            var kind = AudioDecoding.Sniff(bytes);
            if (kind == AudioFormatKind.Unknown) kind = AudioDecoding.FromName(nameHint);

            if (kind == AudioFormatKind.Wav)
            {
                var pcm = AudioDecoding.DecodeWav(bytes, out var wavError);
                if (pcm == null) { playback.Fail("wav: " + wavError); yield break; }
                if (pcm.Frames == 0) { playback.Fail("wav: empty"); yield break; }
                var clip = AudioClip.Create(playback.Handle, pcm.Frames, pcm.Channels, pcm.SampleRate, false);
                clip.SetData(pcm.Samples, 0);
                playback.Begin(clip, volume, loop);
                yield break;
            }

            if (kind == AudioFormatKind.Mp3 || kind == AudioFormatKind.Ogg)
            {
                var ext = kind == AudioFormatKind.Mp3 ? ".mp3" : ".ogg";
                var temp = Path.Combine(Application.temporaryCachePath, $"arsist-sound-{Guid.NewGuid():N}{ext}");
                try { File.WriteAllBytes(temp, bytes); }
                catch (Exception e) { playback.Fail("tempFile: " + e.Message); yield break; }
                playback.TempFile = temp;

                using var req = UnityWebRequestMultimedia.GetAudioClip("file://" + temp,
                    kind == AudioFormatKind.Mp3 ? AudioType.MPEG : AudioType.OGGVORBIS);
                if (req.downloadHandler is DownloadHandlerAudioClip handler)
                {
                    handler.streamAudio = false;
                    handler.compressed = false;
                }
                yield return req.SendWebRequest();
                if (playback.Done) yield break;
                if (req.result != UnityWebRequest.Result.Success) { playback.Fail("decode: " + req.error); yield break; }
                AudioClip clip = null;
                try { clip = DownloadHandlerAudioClip.GetContent(req); }
                catch (Exception e) { playback.Fail("decode: " + e.Message); yield break; }
                if (clip == null) { playback.Fail("decode: no clip"); yield break; }
                clip.name = playback.Handle;
                playback.Begin(clip, volume, loop);
                yield break;
            }

            playback.Fail("unknownFormat (WAV, MP3 or OGG; pass { type: 'mp3' } if it cannot be recognised)");
        }

        private static bool LooksLikeProjectAsset(string source)
        {
            if (source.Length > 512 || source.IndexOf('\n') >= 0) return false;
            var s = source.Replace('\\', '/');
            if (!s.StartsWith("Assets/", StringComparison.OrdinalIgnoreCase) && !s.StartsWith("Audio/", StringComparison.OrdinalIgnoreCase)) return false;
            var ext = Path.GetExtension(s).ToLowerInvariant();
            return ext == ".wav" || ext == ".mp3" || ext == ".ogg";
        }
    }
}
