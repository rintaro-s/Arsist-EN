// ==============================================
// Arsist Engine - スクリプトの「後で呼ぶ」を回す場所
//
//   - setTimeout / setInterval (JS の globals。中身は TimersWrapper)
//   - 別スレッドで済ませた仕事の続きをメインスレッドで (Post)
//   - 毎フレーム進める小さな仕事 (scene.moveTo のなめらかな移動など。AddTicker)
//
// どれもメインスレッドの Update で、ScriptEngineManager と同じ Jint エンジンを使って呼ぶ。
// ==============================================

using System;
using System.Collections.Generic;
using Jint;
using Jint.Native;
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    [UnityEngine.Scripting.Preserve]
    [DefaultExecutionOrder(-50)]
    public sealed class ScriptRuntimeHost : MonoBehaviour
    {
        public static ScriptRuntimeHost Instance { get; private set; }

        private sealed class Timer
        {
            public int Id;
            public JsValue Callback;
            public JsValue[] Args;
            public double Due;
            public double Interval;
            public bool Repeat;
        }

        private readonly Dictionary<int, Timer> _timers = new Dictionary<int, Timer>();
        private readonly List<Timer> _due = new List<Timer>();
        private int _nextTimerId = 1;

        private readonly object _postGate = new object();
        private List<Action> _posted = new List<Action>();
        private List<Action> _running = new List<Action>();

        /// <summary>true を返す間、毎フレーム呼ばれる。</summary>
        private readonly List<Func<bool>> _tickers = new List<Func<bool>>();

        private JsBridge _js;

        public static ScriptRuntimeHost Ensure(GameObject owner, JsBridge js)
        {
            if (Instance == null) Instance = owner.AddComponent<ScriptRuntimeHost>();
            Instance._js = js;
            return Instance;
        }

        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(this); return; }
            Instance = this;
        }

        private static double Now => Time.realtimeSinceStartupAsDouble;

        // ---- タイマー ----

        public int AddTimer(JsValue callback, double milliseconds, bool repeat, JsValue[] args)
        {
            if (callback == null || _js == null || !_js.IsFunction(callback)) return 0;
            if (double.IsNaN(milliseconds) || milliseconds < 0) milliseconds = 0;
            var timer = new Timer
            {
                Id = _nextTimerId++,
                Callback = callback,
                Args = args ?? Array.Empty<JsValue>(),
                Interval = milliseconds / 1000.0,
                Repeat = repeat,
            };
            // 0 ms でも「次のフレーム」(今呼ぶとブラウザの setTimeout と違って同期になってしまう)
            timer.Due = Now + timer.Interval;
            _timers[timer.Id] = timer;
            return timer.Id;
        }

        public void ClearTimer(int id) => _timers.Remove(id);

        // ---- メインスレッドへ ----

        /// <summary>どのスレッドからでも呼べる。次の Update で実行する。</summary>
        public void Post(Action action)
        {
            if (action == null) return;
            lock (_postGate) _posted.Add(action);
        }

        public void AddTicker(Func<bool> tick)
        {
            if (tick != null) _tickers.Add(tick);
        }

        private void Update()
        {
            // 別スレッドから回ってきた続き
            lock (_postGate)
            {
                var swap = _running;
                _running = _posted;
                _posted = swap;
            }
            for (int i = 0; i < _running.Count; i++)
            {
                try { _running[i](); }
                catch (Exception e) { Debug.LogError($"[Arsist] posted action failed: {e}"); }
            }
            _running.Clear();

            // 毎フレームの小さな仕事
            for (int i = _tickers.Count - 1; i >= 0; i--)
            {
                bool keep;
                try { keep = _tickers[i](); }
                catch (Exception e) { Debug.LogError($"[Arsist] ticker failed: {e}"); keep = false; }
                if (!keep) _tickers.RemoveAt(i);
            }

            RunDueTimers();
        }

        private void RunDueTimers()
        {
            if (_timers.Count == 0 || _js == null) return;
            double now = Now;
            _due.Clear();
            foreach (var timer in _timers.Values) if (timer.Due <= now) _due.Add(timer);
            if (_due.Count == 0) return;
            // 登録順 (= 期限が同じなら先に積んだ方から)
            _due.Sort((a, b) => a.Due != b.Due ? a.Due.CompareTo(b.Due) : a.Id.CompareTo(b.Id));

            foreach (var timer in _due)
            {
                // 前のコールバックの中で clearTimeout されたもの
                if (!_timers.ContainsKey(timer.Id)) continue;
                if (timer.Repeat)
                {
                    // 遅れても溜めて連射しない (1 フレームに 1 回まで)
                    timer.Due = Math.Max(timer.Due + timer.Interval, now);
                    if (timer.Interval <= 0) timer.Due = now + 1e-6;
                }
                else
                {
                    _timers.Remove(timer.Id);
                }
                _js.Call(timer.Callback, timer.Repeat ? "setInterval" : "setTimeout", (object[])timer.Args);
            }
        }

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }
    }

    /// <summary>
    /// JS に __arsistTimers として渡す窓口。setTimeout などの本体は ScriptEngineManager が JS で定義する
    /// (引数の省略・余分な引数をブラウザと同じに扱うため)。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public sealed class TimersWrapper
    {
        [UnityEngine.Scripting.Preserve]
        public int add(JsValue callback, double milliseconds, bool repeat, JsValue args)
        {
            var host = ScriptRuntimeHost.Instance;
            if (host == null) { Debug.LogWarning("[ArsistJS] timers are not ready"); return 0; }
            JsValue[] list = Array.Empty<JsValue>();
            if (args != null && args.IsArray())
            {
                var array = args.AsArray();
                list = new JsValue[(int)array.Length];
                for (int i = 0; i < list.Length; i++) list[i] = array[(uint)i];
            }
            return host.AddTimer(callback, milliseconds, repeat, list);
        }

        [UnityEngine.Scripting.Preserve]
        public void clear(double id)
        {
            if (double.IsNaN(id)) return;
            ScriptRuntimeHost.Instance?.ClearTimer((int)id);
        }
    }
}
