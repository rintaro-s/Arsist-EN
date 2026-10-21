// ==============================================
// Arsist Engine - スクリプトが鳴らした 1 つの音 (audio.play)
//
//   - 物に付いて鳴る (at): 毎フレームその物 (VRM なら頭のボーン) の位置へ動く。3D の音
//   - 今の大きさ (Level 0..1): 鳴っている音のサンプルから。audio.level とリップシンクが使う
//   - リップシンク: VRM の 'aa' の表情を音の大きさで動かし、鳴り終わったら閉じる
//   - 鳴り終わり / 止められた / 失敗 を 1 回だけ知らせる (Finished)
// ==============================================

using System;
using UnityEngine;

namespace Arsist.Runtime.Audio
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistSoundPlayback : MonoBehaviour
    {
        public string Handle;
        public AudioSource Source;
        /// <summary>音の出どころ (無ければ 2D の音)</summary>
        public Transform Follow;
        /// <summary>口を動かす相手 (無ければリップシンクしない)</summary>
        public Arsist.Runtime.VRM.VRMExpressionController LipSyncTarget;
        /// <summary>鳴り終わった後に消すファイル (MP3 / OGG の一時ファイル)</summary>
        public string TempFile;

        /// <summary>(ok, error)。止められたときは (false, "stopped")。</summary>
        public Action<bool, string> Finished;

        public bool Loading { get; set; } = true;
        public bool Done { get; private set; }
        public double Level { get; private set; }

        private readonly float[] _buffer = new float[512];
        private double _mouth;
        private float _lastMouthSent = -1f;
        private bool _lipSyncBroken;
        private bool _started;

        public bool IsPlaying => !Done && (Loading || !_started || (Source != null && Source.isPlaying) || !Application.isFocused);

        /// <summary>読み込めたら呼ぶ。</summary>
        public void Begin(AudioClip clip, float volume, bool loop)
        {
            Loading = false;
            if (Done) return;     // 読み込み中に止められた
            Source.clip = clip;
            Source.volume = Mathf.Clamp01(volume);
            Source.loop = loop;
            Source.Play();
            _started = true;
        }

        public void Fail(string error)
        {
            Loading = false;
            Finish(false, error);
        }

        public void Stop()
        {
            if (Done) return;
            if (Source != null) Source.Stop();
            Finish(false, "stopped");
        }

        private void LateUpdate()
        {
            // 追う相手が消えたら、その場で鳴り続ける
            if (Follow != null) transform.position = Follow.position;

            if (Done || Loading || Source == null) return;

            // 今の大きさ
            if (Source.isPlaying)
            {
                Source.GetOutputData(_buffer, 0);
                Level = LipSyncMath.Level(LipSyncMath.Rms(_buffer, _buffer.Length));
            }
            else
            {
                Level = 0;
            }

            if (LipSyncTarget != null && !_lipSyncBroken)
            {
                _mouth = LipSyncMath.Smooth(_mouth, Level, Time.deltaTime);
                SendMouth((float)_mouth);
            }

            if (_started && !Source.isPlaying && !Source.loop && Application.isFocused)
            {
                // 最後まで鳴った (アプリが裏に回って止まっているだけのときは数えない)
                Finish(true, null);
            }
        }

        private void SendMouth(float open)
        {
            float value = Mathf.Round(open * 100f);
            if (Mathf.Abs(value - _lastMouthSent) < 1f) return;
            _lastMouthSent = value;
            if (LipSyncTarget == null) return;
            if (!LipSyncTarget.SetExpression("aa", value))
            {
                _lipSyncBroken = true;
                Debug.LogWarning($"[Arsist] audio: this VRM has no 'aa' expression; lip sync is off for sound {Handle}");
            }
        }

        private void Finish(bool ok, string error)
        {
            if (Done) return;
            Done = true;
            Level = 0;
            if (LipSyncTarget != null && !_lipSyncBroken && _lastMouthSent > 0) LipSyncTarget.SetExpression("aa", 0f);
            var finished = Finished;
            Finished = null;
            try { finished?.Invoke(ok, error); }
            catch (Exception e) { Debug.LogError($"[Arsist] audio: finish callback failed: {e}"); }
            Destroy(gameObject, 0.1f);
        }

        private void OnDestroy()
        {
            if (!Done)
            {
                Done = true;
                if (LipSyncTarget != null && !_lipSyncBroken && _lastMouthSent > 0) LipSyncTarget.SetExpression("aa", 0f);
            }
            var clip = Source != null ? Source.clip : null;
            if (clip != null) Destroy(clip);
            if (!string.IsNullOrEmpty(TempFile))
            {
                try { System.IO.File.Delete(TempFile); } catch (Exception) { }
            }
        }
    }
}
