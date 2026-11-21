#!/usr/bin/env python3
"""Layster Body Protocol (layster.body/1) の見本の橋渡し。標準ライブラリだけで動く。

    python3 python/layster/body_bridge.py --port 8766            # ws://<この PC>:8766

Layster.Spatial の体 (body, link.protocol: "layster-body") の接続先にすると、端末からの命令を受けて、
**動きを真似るだけの腕** (シミュレーション) が動いたことにする。本物のロボット (LeRobot / SO-101 など) を
動かすときは SimArm.run を書き換える (命令は体の根元の frame のメートルで届く)。

やりとり (JSON のテキストフレーム、doc/20-spatial-runtime.md §4):
  端末 → 橋  {"type":"hello","protocol":"layster.body/1","body":"arm","commands":[...],"workspace":{...}}
              {"type":"command","id":"c1","name":"pick","args":{"target":{"at":[x,y,z],"yaw":0,"frame":"body"}},"frame":"body"}
              {"type":"stop","id":"s2","reason":"handTooClose"}
  橋 → 端末  {"type":"hello","name":"sim-arm","protocol":"layster.body/1"}
              {"type":"state","status":"picking","busy":true,"joints":{...},"tool":[x,y,z]}
              {"type":"result","id":"c1","ok":true}  /  {"type":"result","id":"c1","ok":false,"error":"stopped"}
"""

import argparse
import base64
import hashlib
import json
import math
import socket
import struct
import sys
import threading
import time

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


# ---------------------------------------------------------------- WebSocket (RFC 6455、テキストだけ)

class Conn:
    def __init__(self, sock, addr):
        self.sock = sock
        self.addr = addr
        self.lock = threading.Lock()
        self.open = True

    def handshake(self):
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = self.sock.recv(4096)
            if not chunk:
                return False
            data += chunk
        headers = {}
        for line in data.decode("latin-1").split("\r\n")[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        key = headers.get("sec-websocket-key")
        if not key:
            self.sock.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\nWebSocket only\r\n")
            return False
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        self.sock.sendall((
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
        return True

    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("closed")
            buf += chunk
        return buf

    def recv_text(self):
        message = b""
        while True:
            b1, b2 = self._recv_exact(2)
            fin, opcode = b1 & 0x80, b1 & 0x0F
            length = b2 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._recv_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._recv_exact(8))[0]
            mask = self._recv_exact(4) if b2 & 0x80 else b"\0\0\0\0"
            payload = bytearray(self._recv_exact(length))
            for i in range(length):
                payload[i] ^= mask[i % 4]
            if opcode == 0x8:
                self.open = False
                return None
            if opcode == 0x9:
                self._send_frame(0xA, bytes(payload))
                continue
            if opcode in (0x1, 0x0):
                message += bytes(payload)
                if fin:
                    return message.decode("utf-8")

    def _send_frame(self, opcode, payload):
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([n])
        elif n < 65536:
            header += bytes([126]) + struct.pack(">H", n)
        else:
            header += bytes([127]) + struct.pack(">Q", n)
        with self.lock:
            self.sock.sendall(header + payload)

    def send(self, obj):
        if not self.open:
            return
        try:
            self._send_frame(0x1, json.dumps(obj, ensure_ascii=False).encode("utf-8"))
        except OSError:
            self.open = False


# ---------------------------------------------------------------- 真似る腕

class SimArm:
    """動きを真似るだけの腕。命令ごとに 'busy' を出し、少しずつ道具の先を目標へ動かし、結果を返す。"""

    REST = [0.0, 0.25, 0.15]

    def __init__(self, conn, args):
        self.conn = conn
        self.args = args
        self.tool = list(self.REST)
        self.current = None  # (id, stop_event)
        self.lock = threading.Lock()

    def state(self, status, busy):
        self.conn.send({
            "type": "state", "status": status, "busy": busy,
            "tool": [round(v, 3) for v in self.tool],
            "joints": self.joints(),
            "time": round(time.time(), 3),
        })

    def joints(self):
        x, y, z = self.tool
        return {
            "base": round(math.degrees(math.atan2(x, max(z, 1e-6))), 1),
            "shoulder": round(math.degrees(math.atan2(y, math.hypot(x, z))), 1),
            "elbow": round(90 - math.hypot(x, y, z) * 120, 1),
            "gripper": 0.0,
        }

    def handle(self, msg):
        kind = msg.get("type")
        if kind == "hello":
            print(f"[body] {self.conn.addr[0]}: hello from body '{msg.get('body')}' commands {msg.get('commands')}")
            self.conn.send({"type": "hello", "name": "sim-arm", "protocol": "layster.body/1"})
            self.state("idle", False)
        elif kind == "command":
            with self.lock:
                if self.current is not None:
                    self.conn.send({"type": "result", "id": msg.get("id"), "ok": False, "error": "busy"})
                    return
                stop = threading.Event()
                self.current = (msg.get("id"), stop)
            threading.Thread(target=self.run, args=(msg, stop), daemon=True).start()
        elif kind == "stop":
            with self.lock:
                current = self.current
            if current:
                current[1].set()
            print(f"[body] stop ({msg.get('reason')})")
        else:
            print(f"[body] ignored message type {kind}")

    def run(self, msg, stop):
        cid, name, args = msg.get("id"), msg.get("name"), msg.get("args") or {}
        target = None
        for value in args.values():
            if isinstance(value, dict) and isinstance(value.get("at"), list):
                target = value["at"]
                break
        if name in ("home", "rest"):
            target = self.REST
        print(f"[body] {cid}: {name} → {target}")
        ok, error = True, None
        if name == "stop":
            target = None
        if target is not None:
            start = list(self.tool)
            steps = max(1, int(self.args.seconds * 10))
            for i in range(1, steps + 1):
                if stop.is_set():
                    ok, error = False, "stopped"
                    break
                k = i / steps
                self.tool = [s + (t - s) * k for s, t in zip(start, target)]
                self.state(f"{name}ing" if not name.endswith("e") else f"{name[:-1]}ing", True)
                time.sleep(0.1)
        self.conn.send({"type": "result", "id": cid, "ok": ok, "error": error})
        with self.lock:
            self.current = None
        self.state("stopped" if not ok else "idle", False)
        print(f"[body] {cid}: {'done' if ok else error}")


def serve(conn, args):
    try:
        if not conn.handshake():
            return
        print(f"[body] connected: {conn.addr[0]}")
        arm = SimArm(conn, args)
        while conn.open:
            text = conn.recv_text()
            if text is None:
                break
            try:
                arm.handle(json.loads(text))
            except json.JSONDecodeError:
                print("[body] unreadable message")
    except (ConnectionError, OSError):
        pass
    finally:
        conn.open = False
        try:
            conn.sock.close()
        except OSError:
            pass
        print(f"[body] disconnected: {conn.addr[0]}")


def main():
    # 画面でもファイルへの書き出しでも、1 行ずつすぐ出す
    sys.stdout.reconfigure(line_buffering=True)
    p = argparse.ArgumentParser(description="Layster Body Protocol demo bridge with a simulated arm (layster.body/1)")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8766)
    p.add_argument("--seconds", type=float, default=1.5, help="how long a simulated motion takes (default 1.5)")
    args = p.parse_args()
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((args.host, args.port))
    server.listen(4)
    print(f"[body] layster.body/1 simulated arm on ws://{args.host}:{args.port} (Ctrl+C to stop)")
    try:
        while True:
            sock, addr = server.accept()
            threading.Thread(target=serve, args=(Conn(sock, addr), args), daemon=True).start()
    except KeyboardInterrupt:
        pass
    finally:
        server.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
