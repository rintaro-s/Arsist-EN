// ==============================================
// Arsist Extension: quest-input — recorder: the Java side
// samples/extensions/quest-input/Runtime/RecorderJava.cs
//
// com.arsist.recorder.ArsistRecorder (Runtime/Android/ArsistRecorder.java) への窓口。
//
// **呼ぶのはメインスレッドからだけ** (Unity のメインスレッドは JVM につながっている)。
// JNI は、つないでいないスレッドから呼ぶと例外も出さずに 0 / null を返すので (CLAUDE.md)、
// 録画では別スレッドから Java を呼ばない。重い仕事 (色変換・エンコード・書き出し) は Java の
// 自分のスレッドでする。
//
// 毎フレーム呼ぶもの (acquireSlot / submit / pushAudio / state) は、AndroidJavaClass.CallStatic の
// 引数の箱詰めとメソッド探しを避けて、メソッド ID を先に引いておき AndroidJNI で直接呼ぶ。
// 画素は渡さない: slot は C# の NativeArray を包んだ direct ByteBuffer で、Java はそれを直接読む。
// ==============================================

using System;
using Unity.Collections;
using UnityEngine;

namespace Arsist.Extensions.QuestInput
{
    internal sealed class RecorderJava
    {
        // ArsistRecorder.state() の値
        public const int Idle = 0;
        public const int Starting = 1;
        public const int Recording = 2;
        public const int Stopping = 3;
        public const int Done = 4;
        public const int Error = 5;

        private const string ClassName = "com.arsist.recorder.ArsistRecorder";

        /// <summary>この実行環境で録画できるか (Android の実機だけ。エディタ・シミュレーターでは false)。</summary>
        public static bool Supported => Application.platform == RuntimePlatform.Android;

        public string LoadError { get; private set; } = "";

#if UNITY_ANDROID && !UNITY_EDITOR
        private AndroidJavaClass _class;
        private AndroidJavaObject _activity;
        private IntPtr _raw;
        private IntPtr _acquire, _submit, _cancel, _pushAudio, _state, _setSlot, _setAudioBuffer;
        private readonly jvalue[] _none = new jvalue[0];
        private readonly jvalue[] _one = new jvalue[1];
        private readonly jvalue[] _two = new jvalue[2];

        public bool Load()
        {
            if (_class != null) return true;
            try
            {
                _class = new AndroidJavaClass(ClassName);
                _raw = _class.GetRawClass();
                _acquire = Method("acquireSlot", "()I");
                _submit = Method("submit", "(IJ)V");
                _cancel = Method("cancel", "(I)V");
                _pushAudio = Method("pushAudio", "(IJ)V");
                _state = Method("state", "()I");
                _setSlot = Method("setSlot", "(ILjava/nio/ByteBuffer;)V");
                _setAudioBuffer = Method("setAudioBuffer", "(Ljava/nio/ByteBuffer;)V");
                using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                {
                    _activity = player.GetStatic<AndroidJavaObject>("currentActivity");
                }
                if (_activity == null) throw new InvalidOperationException("UnityPlayer.currentActivity is null");
                return true;
            }
            catch (Exception e)
            {
                LoadError = $"the recorder's Java part is missing from this build ({ClassName}): {e.Message}";
                _class = null;
                return false;
            }
        }

        private IntPtr Method(string name, string signature)
        {
            var id = AndroidJNI.GetStaticMethodID(_raw, name, signature);
            ClearException();
            if (id == IntPtr.Zero) throw new MissingMethodException(ClassName, name + signature);
            return id;
        }

        /// <summary>Java の例外が残っていると次の JNI 呼び出しが壊れるので、必ず消す。</summary>
        private static bool ClearException()
        {
            var ex = AndroidJNI.ExceptionOccurred();
            if (ex == IntPtr.Zero) return false;
            AndroidJNI.ExceptionClear();
            AndroidJNI.DeleteLocalRef(ex);
            Debug.LogWarning("[Arsist:quest-input] recorder: a Java call threw (see logcat 'ArsistRecorder')");
            return true;
        }

        /// <summary>録画を用意して、Java の作業スレッドを起こす。slots は width * height * 4 バイト以上。</summary>
        public bool Begin(string folder, string name, int width, int height, int fps, int bitrate, int audioRate,
                          bool flipRows, NativeArray<byte>[] slots, NativeArray<byte> audio, out string error)
        {
            error = "";
            if (!Load()) { error = LoadError; return false; }
            if (!_class.CallStatic<bool>("begin", _activity, folder, name, width, height, fps, bitrate, audioRate, flipRows, slots.Length))
            {
                error = LastError();
                return false;
            }
            for (int i = 0; i < slots.Length; i++)
            {
                var buffer = AndroidJNI.NewDirectByteBuffer(slots[i]);
                _two[0] = new jvalue { i = i };
                _two[1] = new jvalue { l = buffer };
                AndroidJNI.CallStaticVoidMethod(_raw, _setSlot, _two);
                ClearException();
                AndroidJNI.DeleteLocalRef(buffer);
            }
            if (audio.IsCreated)
            {
                var buffer = AndroidJNI.NewDirectByteBuffer(audio);
                _one[0] = new jvalue { l = buffer };
                AndroidJNI.CallStaticVoidMethod(_raw, _setAudioBuffer, _one);
                ClearException();
                AndroidJNI.DeleteLocalRef(buffer);
            }
            if (!_class.CallStatic<bool>("go"))
            {
                error = LastError();
                return false;
            }
            return true;
        }

        public int State()
        {
            if (_class == null) return Idle;
            var s = AndroidJNI.CallStaticIntMethod(_raw, _state, _none);
            return ClearException() ? Error : s;
        }

        public int Acquire()
        {
            if (_class == null) return -1;
            var slot = AndroidJNI.CallStaticIntMethod(_raw, _acquire, _none);
            return ClearException() ? -1 : slot;
        }

        public void Submit(int slot, long ptsMicros)
        {
            if (_class == null) return;
            _two[0] = new jvalue { i = slot };
            _two[1] = new jvalue { j = ptsMicros };
            AndroidJNI.CallStaticVoidMethod(_raw, _submit, _two);
            ClearException();
        }

        public void Cancel(int slot)
        {
            if (_class == null) return;
            _one[0] = new jvalue { i = slot };
            AndroidJNI.CallStaticVoidMethod(_raw, _cancel, _one);
            ClearException();
        }

        /// <summary>Begin に渡した audio の先頭 bytes バイト (PCM16) を渡す。Java はその場で写す。</summary>
        public void PushAudio(int bytes, long ptsMicros)
        {
            if (_class == null) return;
            _two[0] = new jvalue { i = bytes };
            _two[1] = new jvalue { j = ptsMicros };
            AndroidJNI.CallStaticVoidMethod(_raw, _pushAudio, _two);
            ClearException();
        }

        public void End() => Safe(() => _class?.CallStatic("end"));

        public bool AwaitFinish(int milliseconds)
        {
            bool done = true;
            Safe(() => { if (_class != null) done = _class.CallStatic<bool>("awaitFinish", milliseconds); });
            return done;
        }

        public string Result()
        {
            string r = null;
            Safe(() => r = _class?.CallStatic<string>("result"));
            return r ?? "";
        }

        public string LastError()
        {
            string r = null;
            Safe(() => r = _class?.CallStatic<string>("lastError"));
            return string.IsNullOrEmpty(r) ? "unknown error (see logcat 'ArsistRecorder')" : r;
        }

        public string SavePhoto(string folder, string name, byte[] jpeg)
        {
            if (!Load()) return null;
            string r = null;
            Safe(() => r = _class.CallStatic<string>("savePhoto", _activity, folder, name, jpeg));
            return r;
        }

        public string List(string folder)
        {
            if (!Load()) return null;
            string r = null;
            Safe(() => r = _class.CallStatic<string>("list", _activity, folder));
            return r;
        }

        private static void Safe(Action call)
        {
            try { call(); }
            catch (Exception e) { Debug.LogWarning($"[Arsist:quest-input] recorder: Java call failed: {e.Message}"); }
        }
#else
        // エディタ・シミュレーター・Android 以外: 録画はできない (静止画は Recorder が自分で保存する)
        public bool Load()
        {
            LoadError = "recorder needs Android";
            return false;
        }

        public bool Begin(string folder, string name, int width, int height, int fps, int bitrate, int audioRate,
                          bool flipRows, NativeArray<byte>[] slots, NativeArray<byte> audio, out string error)
        {
            error = "recorder needs Android";
            return false;
        }

        public int State() => Idle;
        public int Acquire() => -1;
        public void Submit(int slot, long ptsMicros) { }
        public void Cancel(int slot) { }
        public void PushAudio(int bytes, long ptsMicros) { }
        public void End() { }
        public bool AwaitFinish(int milliseconds) => true;
        public string Result() => "";
        public string LastError() => "recorder needs Android";
        public string SavePhoto(string folder, string name, byte[] jpeg) => null;
        public string List(string folder) => null;
#endif
    }
}
