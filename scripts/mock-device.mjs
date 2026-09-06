#!/usr/bin/env node
/**
 * Arsist Engine — 実機の代わりになるモックデバイス
 *
 * Unity の ArsistWebSocketServer と同じプロトコルを喋る WebSocket サーバー。
 * ヘッドセットが無くても「ライブ配置モード」の接続・視点表示・オブジェクト移動を
 * 一通り試せるようにするための開発用ツール。
 *
 *   node scripts/mock-device.mjs [--port 8765] [--password xxx] [--static]
 *
 * 既定ではユーザーの頭がゆっくり周囲を見回す（視線表示が動いているか確認できる）。
 * --static を付けると静止する。
 *
 * 依存パッケージ無し（node:http と node:crypto だけで RFC6455 を最小限実装する）。
 */
import http from 'node:http';
import crypto from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ── 引数 ──
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = parseInt(getArg('--port', '8765'), 10);
const PASSWORD = getArg('--password', '');
const STATIC_HEAD = args.includes('--static');

// ── 疑似シーン（実機に registerObject 済みのオブジェクト相当） ──
// 座標は Unity ワールド座標（実機が返すのと同じ空間）
const objects = new Map([
  ['MainPanel', { name: 'MainPanel', active: true, position: [0, 0, 1.5], rotation: [0, 0, 0], scale: [1, 1, 1] }],
  ['SampleCube', { name: 'SampleCube', active: true, position: [0.8, -0.3, 2.2], rotation: [0, 25, 0], scale: [0.3, 0.3, 0.3] }],
  ['avatar', { name: 'avatar', active: true, position: [-1.0, -1.6, 2.5], rotation: [0, 180, 0], scale: [1, 1, 1] }],
]);

// ── 疑似ヘッドポーズ ──
const head = { position: [0, 0, 0], yaw: 0, pitch: 0 };
const startedAt = Date.now();

function updateHead() {
  if (STATIC_HEAD) return;
  const tSec = (Date.now() - startedAt) / 1000;
  head.yaw = Math.sin(tSec * 0.25) * 45;          // ゆっくり左右を見回す
  head.pitch = Math.sin(tSec * 0.17) * 12;        // 少し上下も
  head.position = [Math.sin(tSec * 0.11) * 0.25, Math.sin(tSec * 0.3) * 0.03, Math.cos(tSec * 0.11) * 0.25];
}

function headForward() {
  const yaw = (head.yaw * Math.PI) / 180;
  const pitch = (head.pitch * Math.PI) / 180;
  const cp = Math.cos(pitch);
  return [Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp];
}

// ── コマンド処理（ArsistWebSocketServer.DispatchCommand 相当） ──
function toState(id) {
  const o = objects.get(id);
  if (!o) return { Id: id, Error: `Object '${id}' not registered` };
  return {
    Id: id,
    Name: o.name,
    Active: o.active,
    Position: o.position,
    Rotation: o.rotation,
    Scale: o.scale,
  };
}

function dispatch(cmd) {
  const type = (cmd.type || '').toLowerCase();
  const method = (cmd.method || '').toLowerCase();
  const p = cmd.parameters || {};

  if (type === 'batch') {
    const subs = p.commands || [];
    let applied = 0;
    for (const sub of subs) {
      const r = dispatch(sub);
      if (!r.error) applied++;
    }
    return { data: { applied, total: subs.length } };
  }

  if (type === 'query') {
    switch (method) {
      case 'getids':
        return { data: { vrmIds: ['avatar'], sceneIds: [...objects.keys()] } };
      case 'getstate':
        return { data: toState(p.id ?? p.object_id) };
      case 'getscene':
        return { data: { objects: [...objects.keys()].map(toState) } };
      case 'getheadpose':
      case 'getviewerpose':
        updateHead();
        return {
          data: {
            Available: true,
            Position: head.position,
            Rotation: [head.pitch, head.yaw, 0],
            Forward: headForward(),
            Up: [0, 1, 0],
            FieldOfView: 50,
            Tracking: true,
          },
        };
      case 'ping':
        return { data: { pong: true, timestamp: Date.now() } };
      default:
        return { error: `Unknown query method: ${method}` };
    }
  }

  if (type === 'scene' || type === 'transform') {
    const o = objects.get(p.id ?? p.object_id);
    if (!o) return { error: `Object '${p.id}' not registered` };
    switch (method) {
      case 'setposition':
        o.position = [p.x ?? o.position[0], p.y ?? o.position[1], p.z ?? o.position[2]];
        return { data: { ok: true } };
      case 'setrotation':
        o.rotation = [p.pitch ?? o.rotation[0], p.yaw ?? o.rotation[1], p.roll ?? o.rotation[2]];
        return { data: { ok: true } };
      case 'setscale':
        o.scale = [p.x ?? o.scale[0], p.y ?? o.scale[1], p.z ?? o.scale[2]];
        return { data: { ok: true } };
      case 'setuniformscale':
        o.scale = [p.scale ?? 1, p.scale ?? 1, p.scale ?? 1];
        return { data: { ok: true } };
      case 'setvisible':
        o.active = p.visible !== false;
        return { data: { ok: true } };
      default:
        return { error: `Unknown scene method: ${method}` };
    }
  }

  if (type === 'viewer') {
    switch (method) {
      case 'getpose':
        return dispatch({ type: 'query', method: 'getHeadPose' });
      case 'recenter':
      case 'resetposition':
        head.position = [0, head.position[1], 0];
        console.log('[mock-device] recentered');
        return { data: { ok: true } };
      case 'placeinfront': {
        const o = objects.get(p.id ?? p.object_id);
        if (!o) return { error: `Object '${p.id}' not registered` };
        const d = p.distance ?? p.value ?? 2;
        const f = headForward();
        o.position = [
          head.position[0] + f[0] * d,
          head.position[1] + f[1] * d,
          head.position[2] + f[2] * d,
        ];
        if (p.faceUser !== false) o.rotation = [head.pitch, head.yaw, 0];
        console.log(`[mock-device] placeInFront ${p.id} @ ${d}m`);
        return { data: { ok: true } };
      }
      default:
        return { error: `Unknown viewer method: ${method}` };
    }
  }

  if (type === 'script') {
    console.log('[mock-device] script:', (p.code || '').slice(0, 120));
    return { data: { ok: true } };
  }

  return { error: `Unknown command type: ${cmd.type}` };
}

// ── RFC6455 の最小実装 ──
function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let len = second & 0x7f;
    let cursor = offset + 2;

    if (len === 126) {
      if (cursor + 2 > buffer.length) break;
      len = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (len === 127) {
      if (cursor + 8 > buffer.length) break;
      len = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }

    let mask = null;
    if (masked) {
      if (cursor + 4 > buffer.length) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }

    if (cursor + len > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + len));
    if (mask) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    cursor += len;
    offset = cursor;

    messages.push({ opcode, payload });
  }

  return { messages, rest: buffer.subarray(offset) };
}

function encodeFrame(text, opcode = 0x1) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

export function startMockDevice({ port = PORT, password = PASSWORD, log = true } = {}) {
  const server = http.createServer((_req, res) => {
    res.writeHead(426).end('WebSocket only');
  });

  const sockets = new Set();

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    sockets.add(socket);
    if (log) console.log('[mock-device] client connected');

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const { messages, rest } = decodeFrames(buffer);
      buffer = rest;

      for (const msg of messages) {
        if (msg.opcode === 0x8) {
          socket.end();
          return;
        }
        if (msg.opcode === 0x9) {
          socket.write(encodeFrame('', 0xa));
          continue;
        }
        if (msg.opcode !== 0x1) continue;

        let cmd;
        try {
          cmd = JSON.parse(msg.payload.toString('utf8'));
        } catch {
          continue;
        }

        if (password && cmd.authToken !== password) {
          if (cmd.requestId) {
            socket.write(
              encodeFrame(
                JSON.stringify({ requestId: cmd.requestId, success: false, error: 'Authentication failed' }),
              ),
            );
          }
          continue;
        }

        const result = dispatch(cmd);
        if (cmd.requestId) {
          socket.write(
            encodeFrame(
              JSON.stringify({
                requestId: cmd.requestId,
                success: !result.error,
                data: result.data ?? null,
                ...(result.error ? { error: result.error } : {}),
              }),
            ),
          );
        }
      }
    });

    const cleanup = () => {
      sockets.delete(socket);
      if (log) console.log('[mock-device] client disconnected');
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      if (log) {
        console.log(`[mock-device] ws://localhost:${port} で待ち受け中` +
          (password ? '（パスワードあり）' : '（認証なし）'));
        console.log('[mock-device] Arsist のライブ配置モードから、ホスト "localhost" で接続してください。');
      }
      resolve({
        server,
        port: server.address().port,
        close: () =>
          new Promise((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

// 直接実行されたときだけ起動する（テストからは import して使う）
const isDirectRun = process.argv[1] && process.argv[1].endsWith('mock-device.mjs');
if (isDirectRun) {
  startMockDevice();
}
