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

        private TcpListener _listener;
        private Thread _listenerThread;
        private List<TcpClient> _clients = new List<TcpClient>();
        private Queue<PendingMessage> _messageQueue = new Queue<PendingMessage>();
        private bool _isRunning = false;

        /// <summary>受信メッセージとその送信元ストリームのペア</summary>
        private class PendingMessage
        {
            public string Json;
            public System.Net.Sockets.NetworkStream Stream;
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

            Debug.Log($"[ArsistWebSocket] Server started on port {port} (auth: {(string.IsNullOrEmpty(password) ? "none" : "required")})");
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

            foreach (var client in _clients)
            {
                client?.Close();
            }
            _clients.Clear();

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
                        TcpClient client = _listener.AcceptTcpClient();
                        _clients.Add(client);
                        
                        Thread clientThread = new Thread(() => HandleClient(client));
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

        private void HandleClient(TcpClient client)
        {
            NetworkStream stream = client.GetStream();
            byte[] buffer = new byte[65536];  // 64KB バッファ（大きなメッセージに対応）

            try
            {
                while (_isRunning && client.Connected)
                {
                    if (stream.DataAvailable)
                    {
                        int bytesRead = stream.Read(buffer, 0, buffer.Length);
                        if (bytesRead > 0)
                        {
                            string message = Encoding.UTF8.GetString(buffer, 0, bytesRead);
                            
                            // WebSocketハンドシェイク処理
                            if (message.Contains("Sec-WebSocket-Key"))
                            {
                                PerformHandshake(stream, message);
                            }
                            else
                            {
                                // WebSocketフレームをデコード
                                string decoded = DecodeWebSocketFrame(buffer, bytesRead);
                                if (!string.IsNullOrEmpty(decoded))
                                {
                                    lock (_messageQueue)
                                    {
                                        _messageQueue.Enqueue(new PendingMessage { Json = decoded, Stream = stream });
                                    }
                                }
                            }
                        }
                    }
                    Thread.Sleep(10);
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"[ArsistWebSocket] Client error: {ex.Message}");
            }
            finally
            {
                client.Close();
                _clients.Remove(client);
            }
        }

        private void PerformHandshake(NetworkStream stream, string request)
        {
            // WebSocketハンドシェイク
            string swk = System.Text.RegularExpressions.Regex.Match(request, "Sec-WebSocket-Key: (.*)").Groups[1].Value.Trim();
            string swka = swk + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
            byte[] swkaSha1 = System.Security.Cryptography.SHA1.Create().ComputeHash(Encoding.UTF8.GetBytes(swka));
            string swkaSha1Base64 = Convert.ToBase64String(swkaSha1);

            string response = "HTTP/1.1 101 Switching Protocols\r\n" +
                            "Connection: Upgrade\r\n" +
                            "Upgrade: websocket\r\n" +
                            "Sec-WebSocket-Accept: " + swkaSha1Base64 + "\r\n\r\n";

            byte[] responseBytes = Encoding.UTF8.GetBytes(response);
            stream.Write(responseBytes, 0, responseBytes.Length);
        }

        private string DecodeWebSocketFrame(byte[] buffer, int length)
        {
            if (length < 2) return null;

            bool fin    = (buffer[0] & 0b10000000) != 0;
            bool mask   = (buffer[1] & 0b10000000) != 0;
            int opcode  = buffer[0] & 0b00001111;
            int msglen  = buffer[1] & 0b01111111;
            int offset  = 2;

            // opcode 1=text, 2=binary のみ処理。
            // 0=continuation, 8=close, 9=ping, 10=pong は無視する。
            if (opcode != 1 && opcode != 2) return null;

            if (msglen == 126)
            {
                if (length < 4) return null;
                msglen = BitConverter.ToUInt16(new byte[] { buffer[3], buffer[2] }, 0);
                offset = 4;
            }
            else if (msglen == 127)
            {
                if (length < 10) return null;
                msglen = (int)BitConverter.ToUInt64(new byte[] { buffer[9], buffer[8], buffer[7], buffer[6], buffer[5], buffer[4], buffer[3], buffer[2] }, 0);
                offset = 10;
            }

            if (msglen <= 0 || !mask) return null;
            if (offset + 4 + msglen > length) return null;  // バッファ範囲外チェック

            byte[] decoded = new byte[msglen];
            byte[] masks   = new byte[4] { buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3] };
            offset += 4;

            for (int i = 0; i < msglen; ++i)
                decoded[i] = (byte)(buffer[offset + i] ^ masks[i % 4]);

            return Encoding.UTF8.GetString(decoded);
        }

        private void Update()
        {
            // メインスレッドでメッセージを処理
            lock (_messageQueue)
            {
                while (_messageQueue.Count > 0)
                {
                    var pending = _messageQueue.Dequeue();
                    ProcessCommand(pending.Json, pending.Stream);
                }
            }
        }

        private void ProcessCommand(string jsonCommand, System.Net.Sockets.NetworkStream responseStream)
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
                        SendWebSocketFrame(responseStream, BuildResponse(cmd.requestId, false, null, "Authentication failed"));
                    return;
                }

                var scriptEngine = Scripting.ScriptEngineManager.Instance;
                if (scriptEngine == null)
                {
                    if (!string.IsNullOrEmpty(cmd.requestId))
                        SendWebSocketFrame(responseStream, BuildResponse(cmd.requestId, false, null, "ScriptEngineManager not ready"));
                    return;
                }

                object responseData = null;
                string errorMsg = null;

                var commandType = cmd.type?.ToLowerInvariant();
                var methodName = cmd.method?.ToLowerInvariant();
                cmd.type = commandType;
                cmd.method = methodName;

                switch (commandType)
                {
                    case "scene":
                    case "transform":
                        ExecuteSceneCommand(scriptEngine.SceneWrapper, cmd);
                        responseData = new { ok = true };
                        break;
                    case "vrm":
                        // 互換: vrm タイプでクエリ系メソッドが来た場合も応答を返す
                        if (methodName == "getcapabilities" || methodName == "getinfo" || methodName == "getids" || methodName == "getbones" || methodName == "getexpressions" || methodName == "getstate" || methodName == "ping")
                        {
                            responseData = ExecuteQueryCommand(scriptEngine, cmd, out errorMsg);
                        }
                        else
                        {
                            ExecuteVRMCommand(scriptEngine.VRMWrapper, scriptEngine.SceneWrapper, cmd);
                            responseData = new { ok = true };
                        }
                        break;
                    case "query":
                        responseData = ExecuteQueryCommand(scriptEngine, cmd, out errorMsg);
                        break;
                    case "script":
                        ExecuteScript(scriptEngine, cmd);
                        responseData = new { ok = true };
                        break;
                    default:
                        errorMsg = $"Unknown command type: {cmd.type}";
                        Debug.LogWarning($"[ArsistWebSocket] {errorMsg}");
                        break;
                }

                if (string.IsNullOrEmpty(errorMsg))
                {
                    Debug.Log($"[ArsistWebSocket] Command accepted: type={cmd.type}, method={cmd.method}, requestId={cmd.requestId}");
                }

                // requestId があればレスポンス送信
                if (!string.IsNullOrEmpty(cmd.requestId))
                {
                    bool success = errorMsg == null;
                    SendWebSocketFrame(responseStream, BuildResponse(cmd.requestId, success, responseData, errorMsg));
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
                        SendWebSocketFrame(responseStream, BuildResponse(cmd.requestId, false, null, ex.Message));
                    }
                }
                catch
                {
                    // ignore secondary parse error
                }
            }
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
        private void SendWebSocketFrame(System.Net.Sockets.NetworkStream stream, string message)
        {
            if (stream == null || !stream.CanWrite) return;
            try
            {
                byte[] payload = Encoding.UTF8.GetBytes(message);
                int len = payload.Length;
                byte[] frame;

                if (len < 126)
                {
                    frame = new byte[2 + len];
                    frame[0] = 0x81;            // FIN + text opcode
                    frame[1] = (byte)len;       // no mask
                    Buffer.BlockCopy(payload, 0, frame, 2, len);
                }
                else if (len < 65536)
                {
                    frame = new byte[4 + len];
                    frame[0] = 0x81;
                    frame[1] = 126;
                    frame[2] = (byte)(len >> 8);
                    frame[3] = (byte)(len & 0xFF);
                    Buffer.BlockCopy(payload, 0, frame, 4, len);
                }
                else
                {
                    frame = new byte[10 + len];
                    frame[0] = 0x81;
                    frame[1] = 127;
                    for (int i = 7; i >= 0; i--)
                        frame[2 + (7 - i)] = (byte)((len >> (i * 8)) & 0xFF);
                    Buffer.BlockCopy(payload, 0, frame, 10, len);
                }

                stream.Write(frame, 0, frame.Length);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[ArsistWebSocket] Failed to send response: {ex.Message}");
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
            
            // VRMコマンド → 汎用SceneWrapper経由で処理
            // PropertyControllerが有効な場合は自動的にそちらを使用
            switch (cmd.method)
            {
                case "setBoneRotation":
                case "setbonerotation":
                    // scene経由でPropertyControllerを使用
                    scene.setBoneRotation(p.id, p.boneName, p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0);
                    break;
                case "rotateBone":
                case "rotatebone":
                    scene.rotateBone(p.id, p.boneName, p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0);
                    break;
                case "setExpression":
                case "setexpression":
                    scene.setBlendShapeWeight(p.id, p.expressionName ?? p.name, p.value ?? 0);
                    break;
                case "resetExpressions":
                case "resetexpressions":
                    scene.resetAllBlendShapes(p.id);
                    break;
                case "lookAt":
                case "lookat":
                    vrm.lookAt(p.id, p.x ?? 0, p.y ?? 0, p.z ?? 0);
                    break;
                case "playAnimation":
                case "playanimation":
                    scene.playAnimation(p.id, p.animName);
                    break;
                case "setAnimationSpeed":
                case "setanimationspeed":
                    scene.setAnimationSpeed(p.id, p.speed ?? 1);
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
            public string name;           // Python/legacy互換: setExpression 用
            public float? value;
            public string code;
        }
    }
}
