// ==============================================
// Arsist Engine - Diagnostics
// アプリのログを LAN 越しに開発マシンへ流す
//
// なぜ要るか: 実機のログを見るのに毎回 adb を繋いで logcat を漁るのは重い。
// ビルドしたマシンの LAN アドレスをビルド時に APK へ焼き込んでおき、
// 起動したら黙ってそこへ UDP で投げる。受け側は npm run logs。
//
// 設計方針:
//  - アプリ側は「投げっぱなし」。相手がいなくても、届かなくても一切気にしない。
//    ログ送信がアプリの挙動に影響してはいけないので、TCP の再接続待ちもしない。
//  - Unity のログコールバックは別スレッドから来るので、そこでは詰めるだけ。
//    送信は専用スレッドに任せる。
//  - 溢れたら古いものから捨てる。ログのためにメモリを食い潰さない。
// ==============================================

using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using UnityEngine;

namespace Arsist.Runtime.Diagnostics
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistLogRelay : MonoBehaviour
    {
        /// <summary>送信先。ビルドしたマシンの LAN アドレス（複数NICがあるので配列）。</summary>
        public string[] Hosts = Array.Empty<string>();
        public int Port = 9770;
        /// <summary>受け側が「自分宛か」を見分けるための印。秘密ではない。</summary>
        public string Token = string.Empty;
        public string AppName = string.Empty;

        /// <summary>詰められる上限。超えたら古いものから捨てる。</summary>
        private const int MaxQueued = 512;
        /// <summary>1メッセージの上限。長いスタックトレースで UDP を溢れさせない。</summary>
        private const int MaxMessageLength = 3500;

        private readonly Queue<string> _queue = new Queue<string>();
        private readonly object _gate = new object();
        private UdpClient _client;
        private IPEndPoint[] _endpoints = Array.Empty<IPEndPoint>();
        private Thread _sender;
        private volatile bool _running;
        private int _dropped;

        private void Awake()
        {
            if (Hosts == null || Hosts.Length == 0)
            {
                enabled = false;
                return;
            }

            var endpoints = new List<IPEndPoint>();
            foreach (var host in Hosts)
            {
                if (string.IsNullOrWhiteSpace(host)) continue;
                if (!IPAddress.TryParse(host.Trim(), out var address)) continue;
                endpoints.Add(new IPEndPoint(address, Port));
            }

            if (endpoints.Count == 0)
            {
                enabled = false;
                return;
            }

            _endpoints = endpoints.ToArray();

            try
            {
                _client = new UdpClient { EnableBroadcast = true };
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] Log relay could not open a socket: {e.Message}");
                enabled = false;
                return;
            }

            _running = true;
            _sender = new Thread(SendLoop) { IsBackground = true, Name = "ArsistLogRelay" };
            _sender.Start();

            Application.logMessageReceivedThreaded += OnLog;

            Enqueue("hello", $"{AppName} started on {SystemInfo.deviceModel}", string.Empty);
            Debug.Log($"[Arsist] Log relay -> {string.Join(", ", Hosts)}:{Port}");
        }

        private void OnLog(string message, string stackTrace, LogType type)
        {
            // ここは Unity のログスレッド。Unity API に触らず、詰めるだけ。
            Enqueue(LevelOf(type), message, type == LogType.Log ? string.Empty : stackTrace);
        }

        private static string LevelOf(LogType type)
        {
            switch (type)
            {
                case LogType.Error:
                case LogType.Exception:
                case LogType.Assert:
                    return "error";
                case LogType.Warning:
                    return "warn";
                default:
                    return "info";
            }
        }

        private void Enqueue(string level, string message, string stackTrace)
        {
            var payload = Serialize(level, message, stackTrace);

            lock (_gate)
            {
                while (_queue.Count >= MaxQueued)
                {
                    _queue.Dequeue();
                    _dropped++;
                }
                _queue.Enqueue(payload);
                Monitor.Pulse(_gate);
            }
        }

        /// <summary>
        /// 1行1メッセージの JSON。受け側が行単位で扱えるよう、改行はエスケープする。
        /// </summary>
        private string Serialize(string level, string message, string stackTrace)
        {
            var text = message ?? string.Empty;
            if (text.Length > MaxMessageLength) text = text.Substring(0, MaxMessageLength) + "…";

            var trace = stackTrace ?? string.Empty;
            if (trace.Length > MaxMessageLength) trace = trace.Substring(0, MaxMessageLength) + "…";

            var sb = new StringBuilder(text.Length + trace.Length + 128);
            sb.Append('{');
            AppendField(sb, "token", Token); sb.Append(',');
            AppendField(sb, "app", AppName); sb.Append(',');
            AppendField(sb, "level", level); sb.Append(',');
            sb.Append("\"t\":").Append(DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond).Append(',');
            AppendField(sb, "msg", text);
            if (trace.Length > 0)
            {
                sb.Append(',');
                AppendField(sb, "stack", trace);
            }
            if (_dropped > 0)
            {
                sb.Append(",\"dropped\":").Append(_dropped);
            }
            sb.Append('}');
            return sb.ToString();
        }

        private static void AppendField(StringBuilder sb, string name, string value)
        {
            sb.Append('"').Append(name).Append("\":\"");
            foreach (var c in value ?? string.Empty)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        private void SendLoop()
        {
            while (_running)
            {
                string payload = null;
                lock (_gate)
                {
                    if (_queue.Count == 0)
                    {
                        Monitor.Wait(_gate, 200);
                    }
                    if (_queue.Count > 0)
                    {
                        payload = _queue.Dequeue();
                        _dropped = 0;
                    }
                }
                if (payload == null) continue;

                var bytes = Encoding.UTF8.GetBytes(payload);
                foreach (var endpoint in _endpoints)
                {
                    try { _client.Send(bytes, bytes.Length, endpoint); }
                    catch { /* 相手が居ないのは普通のこと。黙って捨てる */ }
                }
            }
        }

        private void OnDestroy()
        {
            Application.logMessageReceivedThreaded -= OnLog;
            _running = false;
            lock (_gate) Monitor.PulseAll(_gate);
            try { _client?.Close(); } catch { }
        }
    }
}
