// ==============================================
// Arsist Engine - WebSocket Server for Remote Control
// Assets/Arsist/Runtime/Network/ArsistWebSocketServer.cs
// ==============================================
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Arsist.Runtime.Network
{
    /// <summary>
    /// シンプルなWebSocketサーバー（リモートコントロール用）
    /// Python等の外部クライアントからVRM/3Dオブジェクトを制御可能
    /// </summary>
    public class ArsistWebSocketServer : MonoBehaviour
    {
        [SerializeField] private int port = 8765;
        [SerializeField] private bool autoStart = true;
        [SerializeField] private string password = "";
        [Tooltip("受理した全コマンドを Debug.Log する。毎フレーム送る用途では実機性能を落とすため既定は OFF。")]
        [SerializeField] private bool verboseLog = false;

        /// <summary>1 batch で受け付けるサブコマンド数の上限。</summary>
        private const int MaxBatchCommands = 256;

        private TcpListener _listener;
        private Thread _listenerThread;
        private readonly List<ClientState> _clients = new List<ClientState>();
        private Queue<PendingMessage> _messageQueue = new Queue<PendingMessage>();
        private bool _isRunning = false;

        /// <summary>1メッセージあたりの上限。超えたら接続を切る（メモリ枯渇の防止）。</summary>
        private const int MaxMessageBytes = 4 * 1024 * 1024;
        /// <summary>受信バッファの上限。未完成フレームがこれを超えたら接続を切る。</summary>
        private const int MaxReceiveBufferBytes = 8 * 1024 * 1024;

        /// <summary>受信メッセージとその送信元クライアントのペア</summary>
        private class PendingMessage
        {
            public string Json;
            public ClientState Client;
        }

        /// <summary>
        /// 1接続分の状態。
        ///
        /// TCP は「1回の Read = 1 WebSocket フレーム」を保証しない。複数フレームが
        /// まとめて届くことも、1フレームが分割して届くこともある。以前の実装は
        /// 読み取りバッファの先頭1フレームだけをデコードして残りを捨てていたため、
        /// 連続送信するとコマンドが黙って消えていた。ここで per-connection の
        /// 受信バッファを持ち、完成したフレームだけを順に取り出す。
        /// </summary>
        private class ClientState
        {
            public TcpClient Tcp;
            public NetworkStream Stream;
            /// <summary>同一ストリームへの書き込みは受信スレッドとメインスレッドの両方から起きる。</summary>
            public readonly object SendLock = new object();
            public bool HandshakeDone;
            public byte[] Buffer = new byte[8192];
            public int Length;
            /// <summary>継続フレーム（opcode 0）を跨いだメッセージの組み立て先。</summary>
            public readonly List<byte> Assembling = new List<byte>();
            public bool Assembled;
        }

        public static ArsistWebSocketServer Instance { get; private set; }
        public bool IsRunning => _isRunning;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        private void Start()
        {
            if (autoStart)
            {
                StartServer();
            }
        }

        public void StartServer()
        {
            if (_isRunning) return;

            _isRunning = true;
            _listenerThread = new Thread(ListenForClients);
            _listenerThread.IsBackground = true;
            _listenerThread.Start();

            // 外部クライアントは端末の IP を知らないと繋げない。adb logcat から拾えるように出しておく。
            Debug.Log($"[ArsistWebSocket] Server started on port {port} (auth: {(string.IsNullOrEmpty(password) ? "none" : "required")})");
            foreach (var address in GetLocalIPv4Addresses())
            {
                Debug.Log($"[ArsistWebSocket] Listening at ws://{address}:{port}");
            }
        }

        /// <summary>この端末の LAN IPv4 アドレスを列挙する（ループバックは除く）。</summary>
        private static List<string> GetLocalIPv4Addresses()
        {
            var result = new List<string>();
            try
            {
                foreach (var address in Dns.GetHostEntry(Dns.GetHostName()).AddressList)
                {
                    if (address.AddressFamily != AddressFamily.InterNetwork) continue;
                    if (IPAddress.IsLoopback(address)) continue;
                    result.Add(address.ToString());
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[ArsistWebSocket] Failed to enumerate local IP addresses: {ex.Message}");
            }
            return result;
        }

        public void Configure(int serverPort, string serverPassword, bool startAutomatically = true)
        {
            if (serverPort >= 1 && serverPort <= 65535)
            {
                port = serverPort;
            }
            password = serverPassword ?? string.Empty;
            autoStart = startAutomatically;
        }

        public void StopServer()
        {
            _isRunning = false;
            
            if (_listener != null)
            {
                _listener.Stop();
            }

            lock (_clients)
            {
                foreach (var client in _clients)
                {
                    try { client?.Tcp?.Close(); } catch { /* ignore */ }
                }
                _clients.Clear();
            }

            Debug.Log("[ArsistWebSocket] Server stopped");
        }

        private void ListenForClients()
        {
            try
            {
                _listener = new TcpListener(IPAddress.Any, port);
                _listener.Start();

                while (_isRunning)
                {
                    if (_listener.Pending())
                    {
                        TcpClient tcp = _listener.AcceptTcpClient();
                        var state = new ClientState { Tcp = tcp, Stream = tcp.GetStream() };
                        lock (_clients)
                        {
                            _clients.Add(state);
                        }

                        Thread clientThread = new Thread(() => HandleClient(state));
                        clientThread.IsBackground = true;
                        clientThread.Start();
                    }
                    Thread.Sleep(100);
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"[ArsistWebSocket] Listener error: {ex.Message}");
            }
        }

        private void HandleClient(ClientState state)
        {
            var readBuffer = new byte[8192];

            try
            {
                while (_isRunning && state.Tcp.Connected)
                {
                    if (!state.Stream.DataAvailable)
                    {
                        Thread.Sleep(5);
                        continue;
                    }

                    int bytesRead = state.Stream.Read(readBuffer, 0, readBuffer.Length);
                    if (bytesRead <= 0) break;          // 対向が閉じた

                    if (!AppendToBuffer(state, readBuffer, bytesRead)) break;

                    if (!state.HandshakeDone)
                    {
                        if (!TryPerformHandshake(state)) continue;   // ヘッダがまだ揃っていない
                    }

                    if (!DrainFrames(state)) break;                 // close / プロトコル違反
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[ArsistWebSocket] Client error: {ex.Message}");
            }
            finally
            {
                try { state.Tcp.Close(); } catch { /* ignore */ }
                lock (_clients)
                {
                    _clients.Remove(state);
                }
            }
        }

        /// <summary>受信バイトを接続バッファ末尾に追加する。上限超過なら false。</summary>
        private static bool AppendToBuffer(ClientState state, byte[] data, int count)
        {
            if (state.Length + count > MaxReceiveBufferBytes)
            {
                Debug.LogWarning("[ArsistWebSocket] Receive buffer overflow; dropping connection.");
                return false;
            }

            if (state.Length + count > state.Buffer.Length)
            {
                int capacity = state.Buffer.Length;
                while (capacity < state.Length + count) capacity *= 2;
                Array.Resize(ref state.Buffer, capacity);
            }

            Buffer.BlockCopy(data, 0, state.Buffer, state.Length, count);
            state.Length += count;
            return true;
        }

        /// <summary>バッファ先頭から count バイトを取り除く。</summary>
        private static void ConsumeBuffer(ClientState state, int count)
        {
            if (count <= 0) return;
            int remaining = state.Length - count;
            if (remaining > 0)
            {
                Buffer.BlockCopy(state.Buffer, count, state.Buffer, 0, remaining);
            }
            state.Length = Math.Max(0, remaining);
        }

        /// <summary>
        /// HTTP アップグレード要求が揃っていればハンドシェイクを返す。
        /// ヘッダ終端 (CRLFCRLF) が来るまでは false を返して待つ。
        /// </summary>
        private bool TryPerformHandshake(ClientState state)
        {
            var text = Encoding.UTF8.GetString(state.Buffer, 0, state.Length);
            int headerEnd = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (headerEnd < 0) return false;

            var header = text.Substring(0, headerEnd);
            var match = System.Text.RegularExpressions.Regex.Match(
                header, @"Sec-WebSocket-Key:\s*(\S+)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (!match.Success)
            {
                Debug.LogWarning("[ArsistWebSocket] Handshake without Sec-WebSocket-Key; dropping connection.");
                state.Length = 0;
                try { state.Tcp.Close(); } catch { /* ignore */ }
                return false;
            }

            string swk = match.Groups[1].Value.Trim();
            string swka = swk + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
            byte[] swkaSha1;
            using (var sha1 = System.Security.Cryptography.SHA1.Create())
            {
                swkaSha1 = sha1.ComputeHash(Encoding.UTF8.GetBytes(swka));
            }

            string response = "HTTP/1.1 101 Switching Protocols\r\n" +
                              "Connection: Upgrade\r\n" +
                              "Upgrade: websocket\r\n" +
                              "Sec-WebSocket-Accept: " + Convert.ToBase64String(swkaSha1) + "\r\n\r\n";

            byte[] responseBytes = Encoding.UTF8.GetBytes(response);
            lock (state.SendLock)
            {
                state.Stream.Write(responseBytes, 0, responseBytes.Length);
            }

            // ヘッダ部だけを消費する。直後に最初のフレームが続いていることがある。
            int consumed = Encoding.UTF8.GetByteCount(text.Substring(0, headerEnd + 4));
            ConsumeBuffer(state, consumed);
            state.HandshakeDone = true;
            return true;
        }

        /// <summary>
        /// バッファ内の「完成しているフレーム」をすべて処理する。
        /// 未完成のフレームはバッファに残して次の Read を待つ。
        /// 戻り値 false は接続終了。
        /// </summary>
        private bool DrainFrames(ClientState state)
        {
            while (true)
            {
                if (state.Length < 2) return true;

                var buf = state.Buffer;
                bool fin = (buf[0] & 0x80) != 0;
                int opcode = buf[0] & 0x0F;
                bool masked = (buf[1] & 0x80) != 0;
                long payloadLen = buf[1] & 0x7F;
                int offset = 2;

                if (payloadLen == 126)
                {
                    if (state.Length < 4) return true;
                    payloadLen = (buf[2] << 8) | buf[3];
                    offset = 4;
                }
                else if (payloadLen == 127)
                {
                    if (state.Length < 10) return true;
                    payloadLen = 0;
                    for (int i = 0; i < 8; i++) payloadLen = (payloadLen << 8) | buf[2 + i];
                    offset = 10;
                }

                if (payloadLen < 0 || payloadLen > MaxMessageBytes)
                {
                    Debug.LogWarning($"[ArsistWebSocket] Frame too large ({payloadLen} bytes); dropping connection.");
                    return false;
                }

                int maskLen = masked ? 4 : 0;
                long frameLen = offset + maskLen + payloadLen;
                if (state.Length < frameLen) return true;   // まだ届いていない

                var payload = new byte[payloadLen];
                Buffer.BlockCopy(buf, offset + maskLen, payload, 0, (int)payloadLen);
                if (masked)
                {
                    for (int i = 0; i < payloadLen; i++)
                        payload[i] = (byte)(payload[i] ^ buf[offset + (i % 4)]);
                }

                ConsumeBuffer(state, (int)frameLen);

                switch (opcode)
                {
                    case 0x8:   // close
                        SendFrame(state, 0x8, Array.Empty<byte>());
                        return false;

                    case 0x9:   // ping → pong を返さないと切断してくるクライアントがある
                        SendFrame(state, 0xA, payload);
                        continue;

                    case 0xA:   // pong
                        continue;

                    case 0x0:   // continuation
                        if (!state.Assembled)
                        {
                            Debug.LogWarning("[ArsistWebSocket] Continuation frame without a start frame; ignoring.");
                            continue;
                        }
                        break;

                    case 0x1:   // text
                    case 0x2:   // binary
                        state.Assembling.Clear();
                        state.Assembled = true;
                        break;

                    default:
                        Debug.LogWarning($"[ArsistWebSocket] Unsupported opcode {opcode}; ignoring frame.");
                        continue;
                }

                if (state.Assembling.Count + payload.Length > MaxMessageBytes)
                {
                    Debug.LogWarning("[ArsistWebSocket] Assembled message too large; dropping connection.");
                    return false;
                }
                state.Assembling.AddRange(payload);

                if (!fin) continue;   // 続きのフレームを待つ

                var json = Encoding.UTF8.GetString(state.Assembling.ToArray());
                state.Assembling.Clear();
                state.Assembled = false;

                if (!string.IsNullOrWhiteSpace(json))
                {
                    lock (_messageQueue)
                    {
                        _messageQueue.Enqueue(new PendingMessage { Json = json, Client = state });
                    }
                }
            }
        }

        private void Update()
        {
            // メインスレッドでメッセージを処理
            lock (_messageQueue)
            {
                while (_messageQueue.Count > 0)
                {
                    var pending = _messageQueue.Dequeue();
                    ProcessCommand(pending.Json, pending.Client);
                }
            }
        }

        private void ProcessCommand(string jsonCommand, ClientState responseClient)
        {
            // 空文字・非JSON を弾く
            if (string.IsNullOrWhiteSpace(jsonCommand)) return;
            if (!jsonCommand.TrimStart().StartsWith("{")) return;

            try
            {
                var cmd = JsonConvert.DeserializeObject<RemoteCommand>(jsonCommand);
                if (cmd == null) return;

                // 認証チェック
                if (!string.IsNullOrEmpty(password) && !string.Equals(cmd.authToken, password, StringComparison.Ordinal))
                {
                    Debug.LogWarning("[ArsistWebSocket] Command rejected: invalid auth token.");
                    if (!string.IsNullOrEmpty(cmd.requestId))
                        SendWebSocketFrame(responseClient, BuildResponse(cmd.requestId, false, null, "Authentication failed"));
                    return;
                }

                var scriptEngine = Scripting.ScriptEngineManager.Instance;
                if (scriptEngine == null)
                {
                    if (!string.IsNullOrEmpty(cmd.requestId))
                        SendWebSocketFrame(responseClient, BuildResponse(cmd.requestId, false, null, "ScriptEngineManager not ready"));
                    return;
                }

                object responseData;
                string errorMsg;

                if (string.Equals(cmd.type, "batch", StringComparison.OrdinalIgnoreCase))
                {
                    responseData = ExecuteBatch(scriptEngine, cmd, out errorMsg);
                }
                else
                {
                    responseData = DispatchCommand(scriptEngine, cmd, out errorMsg);
                }

                if (verboseLog && string.IsNullOrEmpty(errorMsg))
                {
                    Debug.Log($"[ArsistWebSocket] Command accepted: type={cmd.type}, method={cmd.method}, requestId={cmd.requestId}");
                }

                // requestId があればレスポンス送信
                if (!string.IsNullOrEmpty(cmd.requestId))
                {
                    bool success = errorMsg == null;
                    SendWebSocketFrame(responseClient, BuildResponse(cmd.requestId, success, responseData, errorMsg));
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"[ArsistWebSocket] Command processing error: {ex.Message}");
                try
                {
                    var cmd = JsonConvert.DeserializeObject<RemoteCommand>(jsonCommand);
                    if (cmd != null && !string.IsNullOrEmpty(cmd.requestId))
                    {
                        SendWebSocketFrame(responseClient, BuildResponse(cmd.requestId, false, null, ex.Message));
                    }
                }
                catch
                {
                    // ignore secondary parse error
                }
            }
        }

        /// <summary>
        /// 1コマンドを種別に応じて実行する。batch の各要素からも呼ばれるため、
        /// 認証・レスポンス送信は含めない（呼び出し側の責務）。
        /// </summary>
        private object DispatchCommand(Scripting.ScriptEngineManager scriptEngine, RemoteCommand cmd, out string errorMsg)
        {
            errorMsg = null;

            var commandType = cmd.type?.ToLowerInvariant();
            var methodName = cmd.method?.ToLowerInvariant();
            cmd.type = commandType;
            cmd.method = methodName;

            switch (commandType)
            {
                case "scene":
                case "transform":
                    ExecuteSceneCommand(scriptEngine.SceneWrapper, cmd);
                    return new { ok = true };

                case "vrm":
                    // 互換: vrm タイプでクエリ系メソッドが来た場合も応答を返す
                    if (methodName == "getcapabilities" || methodName == "getinfo" || methodName == "getids"
                        || methodName == "getbones" || methodName == "getexpressions" || methodName == "getstate"
                        || methodName == "ping")
                    {
                        return ExecuteQueryCommand(scriptEngine, cmd, out errorMsg);
                    }
                    ExecuteVRMCommand(scriptEngine.VRMWrapper, scriptEngine.SceneWrapper, cmd);
                    return new { ok = true };

                case "query":
                    return ExecuteQueryCommand(scriptEngine, cmd, out errorMsg);

                case "script":
                    ExecuteScript(scriptEngine, cmd);
                    return new { ok = true };

                case "batch":
                    // ネストした batch は許可しない（再帰的な増幅を避ける）
                    errorMsg = "Nested batch is not allowed";
                    return null;

                default:
                    errorMsg = $"Unknown command type: {cmd.type}";
                    Debug.LogWarning($"[ArsistWebSocket] {errorMsg}");
                    return null;
            }
        }

        /// <summary>
        /// 複数コマンドを1フレームでまとめて適用する。
        ///
        /// ポーズ同期のように「1ティックで十数個のボーンを更新する」用途では、
        /// 1コマンド1メッセージだと WebSocket フレームもキュー処理も無駄が大きい。
        /// batch なら1メッセージ・1フレーム内で全部が適用されるので、
        /// 「腕だけ次のフレームに反映される」といったティアリングも起きない。
        /// </summary>
        private object ExecuteBatch(Scripting.ScriptEngineManager scriptEngine, RemoteCommand cmd, out string errorMsg)
        {
            errorMsg = null;

            var commands = cmd.parameters?.commands;
            if (commands == null || commands.Count == 0)
            {
                errorMsg = "batch requires parameters.commands (non-empty array)";
                return null;
            }

            if (commands.Count > MaxBatchCommands)
            {
                errorMsg = $"batch too large: {commands.Count} commands (max {MaxBatchCommands})";
                return null;
            }

            int applied = 0;
            List<string> errors = null;

            foreach (var sub in commands)
            {
                if (sub == null) continue;

                string subError;
                try
                {
                    DispatchCommand(scriptEngine, sub, out subError);
                }
                catch (Exception ex)
                {
                    subError = ex.Message;
                }

                if (string.IsNullOrEmpty(subError))
                {
                    applied++;
                }
                else
                {
                    (errors ?? (errors = new List<string>())).Add(subError);
                }
            }

            return new
            {
                ok = errors == null,
                applied,
                failed = errors?.Count ?? 0,
                errors = (object)errors,
            };
        }

        /// <summary>クエリコマンドを実行してレスポンスデータを返す</summary>
        private object ExecuteQueryCommand(Scripting.ScriptEngineManager scriptEngine, RemoteCommand cmd, out string errorMsg)
        {
            errorMsg = null;
            var p = cmd.parameters ?? new CommandParameters();

            // NOTE: cmd.method は ProcessCommand で既に ToLowerInvariant() 済み
            switch (cmd.method)
            {
                case "getinfo":
                case "getcapabilities":
                    return scriptEngine.VRMWrapper.GetCapabilities(p.id ?? p.avatar_id);

                case "getexpressions":
                {
                    var capsId = p.id ?? p.avatar_id;
                    var caps = scriptEngine.VRMWrapper.GetCapabilities(capsId);
                    return new { id = capsId, expressions = caps.Expressions, count = caps.Expressions.Count };
                }

                case "getbones":
                {
                    var capsId = p.id ?? p.avatar_id;
                    var caps = scriptEngine.VRMWrapper.GetCapabilities(capsId);
                    return new { id = capsId, bones = caps.HumanoidBones, hasHumanoid = caps.HasHumanoid, count = caps.HumanoidBones.Count };
                }

                case "getids":
                    return new
                    {
                        vrmIds   = scriptEngine.VRMWrapper.GetRegisteredIds(),
                        sceneIds = scriptEngine.SceneWrapper.GetRegisteredIds()
                    };

                case "getstate":
                    return scriptEngine.SceneWrapper.GetState(p.id ?? p.object_id);

                case "ping":
                    return new { pong = true, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };

                default:
                    errorMsg = $"Unknown query method: {cmd.method}";
                    return null;
            }
        }

        /// <summary>WebSocket テキストフレームを送信する</summary>
        private void SendWebSocketFrame(ClientState client, string message)
        {
            SendFrame(client, 0x1, Encoding.UTF8.GetBytes(message));
        }

        /// <summary>任意 opcode の（マスクなし＝サーバ→クライアント）フレームを送る。</summary>
        private void SendFrame(ClientState client, int opcode, byte[] payload)
        {
            if (client?.Stream == null || !client.Stream.CanWrite) return;

            try
            {
                payload = payload ?? Array.Empty<byte>();
                int len = payload.Length;
                byte[] frame;

                if (len < 126)
                {
                    frame = new byte[2 + len];
                    frame[1] = (byte)len;
                    Buffer.BlockCopy(payload, 0, frame, 2, len);
                }
                else if (len < 65536)
                {
                    frame = new byte[4 + len];
                    frame[1] = 126;
                    frame[2] = (byte)(len >> 8);
                    frame[3] = (byte)(len & 0xFF);
                    Buffer.BlockCopy(payload, 0, frame, 4, len);
                }
                else
                {
                    // 64bit 長。int を 32bit 超シフトすると C# ではシフト量が 31 で
                    // マスクされて壊れるので、上位 4 バイトは 0 固定で書く。
                    frame = new byte[10 + len];
                    frame[1] = 127;
                    frame[2] = 0; frame[3] = 0; frame[4] = 0; frame[5] = 0;
                    frame[6] = (byte)((len >> 24) & 0xFF);
                    frame[7] = (byte)((len >> 16) & 0xFF);
                    frame[8] = (byte)((len >> 8) & 0xFF);
                    frame[9] = (byte)(len & 0xFF);
                    Buffer.BlockCopy(payload, 0, frame, 10, len);
                }

                frame[0] = (byte)(0x80 | (opcode & 0x0F));   // FIN + opcode

                lock (client.SendLock)
                {
                    client.Stream.Write(frame, 0, frame.Length);
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[ArsistWebSocket] Failed to send frame: {ex.Message}");
            }
        }

        /// <summary>レスポンス JSON を構築する</summary>
        private string BuildResponse(string requestId, bool success, object data, string error = null)
        {
            var jObj = new JObject();
            jObj["requestId"] = requestId;
            jObj["success"]   = success;
            if (data != null)
            {
                try { jObj["data"] = JToken.FromObject(data); }
                catch { jObj["data"] = data.ToString(); }
            }
            if (error != null)
                jObj["error"] = error;
            return jObj.ToString(Formatting.None);
        }

        private void ExecuteSceneCommand(Scripting.SceneWrapper scene, RemoteCommand cmd)
        {
            var p = cmd.parameters ?? new CommandParameters();

            switch (cmd.method)
            {
                case "setPosition":
                case "setposition":
                    scene.setPosition(p.id, p.x ?? 0, p.y ?? 0, p.z ?? 0);
                    break;
                case "move":
                    scene.move(p.id, p.x ?? 0, p.y ?? 0, p.z ?? 0);
                    break;
                case "setRotation":
                case "setrotation":
                    scene.setRotation(p.id, p.pitch ?? p.x ?? 0, p.yaw ?? p.y ?? 0, p.roll ?? p.z ?? 0);
                    break;
                case "rotate":
                    scene.rotate(p.id, p.pitch ?? p.x ?? 0, p.yaw ?? p.y ?? 0, p.roll ?? p.z ?? 0);
                    break;
                case "setScale":
                case "setscale":
                    scene.setScale(p.id, p.x ?? 1, p.y ?? 1, p.z ?? 1);
                    break;
                case "setUniformScale":
                case "setuniformscale":
                    scene.setUniformScale(p.id, p.scale ?? 1);
                    break;
                case "playAnimation":
                case "playanimation":
                    scene.playAnimation(p.id, p.animName);
                    break;
                case "stopAnimation":
                case "stopanimation":
                    scene.stopAnimation(p.id);
                    break;
                case "setAnimationSpeed":
                case "setanimationspeed":
                    scene.setAnimationSpeed(p.id, p.speed ?? 1);
                    break;
                case "setVisible":
                case "setvisible":
                    scene.setVisible(p.id, p.visible ?? true);
                    break;
                default:
                    Debug.LogWarning($"[ArsistWebSocket] Unknown scene method: {cmd.method}");
                    break;
            }
        }

        private void ExecuteVRMCommand(Scripting.VRMWrapper vrm, Scripting.SceneWrapper scene, RemoteCommand cmd)
        {
            var p = cmd.parameters ?? new CommandParameters();

            // VRMコマンドは VRMWrapper を第一経路として処理する。
            // （UniVRM runtime との互換性を維持するため SceneWrapper への迂回を避ける）
            switch (cmd.method)
            {
                case "setBoneRotation":
                case "setbonerotation":
                    vrm.setBoneRotation(p.id, p.boneName, p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0);
                    break;
                case "rotateBone":
                case "rotatebone":
                    vrm.rotateBone(p.id, p.boneName, p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0);
                    break;
                case "setExpression":
                case "setexpression":
                    vrm.setExpression(p.id, p.expressionName ?? p.name, p.value ?? 0);
                    break;
                case "resetExpressions":
                case "resetexpressions":
                    vrm.resetExpressions(p.id);
                    break;
                case "lookAt":
                case "lookat":
                    vrm.lookAt(p.id, p.x ?? 0, p.y ?? 0, p.z ?? 0);
                    break;
                case "clearLookAt":
                case "clearlookat":
                    vrm.clearLookAt(p.id);
                    break;
                case "setHeight":
                case "setheight":
                    vrm.setHeight(p.id, p.value ?? p.y ?? 0f);
                    break;
                case "setHandTarget":
                case "sethandtarget":
                    vrm.setHandTarget(p.id, p.side, p.x ?? 0, p.y ?? 0, p.z ?? 0);
                    break;
                case "clearHandTarget":
                case "clearhandtarget":
                    vrm.clearHandTarget(p.id, p.side);
                    break;
                case "playAnimation":
                case "playanimation":
                    vrm.playAnimation(p.id, p.animName);
                    break;
                case "setAnimationSpeed":
                case "setanimationspeed":
                    vrm.setAnimationSpeed(p.id, p.speed ?? 1);
                    break;
                default:
                    Debug.LogWarning($"[ArsistWebSocket] Unknown vrm method: {cmd.method}");
                    break;
            }
        }

        private void ExecuteScript(Scripting.ScriptEngineManager engine, RemoteCommand cmd)
        {
            if (!string.IsNullOrEmpty(cmd.parameters.code))
            {
                engine.ExecuteScript("remote", cmd.parameters.code);
            }
        }

        private void OnDestroy()
        {
            StopServer();
        }

        [Serializable]
        private class RemoteCommand
        {
            public string type;
            public string method;
            public string authToken;
            public string requestId;       // レスポンスが必要な場合にセット
            public CommandParameters parameters;
        }

        [Serializable]
        private class CommandParameters
        {
            public string id;
            public string avatar_id;       // Python互換: getCapabilities用
            public string object_id;       // Python互換: getState用
            public float? x;
            public float? y;
            public float? z;
            public float? pitch;
            public float? yaw;
            public float? roll;
            public float? scale;           // setUniformScale 用
            public float? speed;           // setAnimationSpeed 用
            public string animName;
            public bool? visible;
            public string boneName;
            public string expressionName;
            public string side;           // setHandTarget 用: "left" / "right"
            public string name;           // Python/legacy互換: setExpression 用
            public float? value;
            public string code;
            /// <summary>type="batch" のときに実行するサブコマンド列。</summary>
            public List<RemoteCommand> commands;
        }
    }
}
