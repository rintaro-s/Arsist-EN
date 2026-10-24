#!/usr/bin/env python3
"""Layster Mind Protocol (layster.mind/1) の見本のサーバー。標準ライブラリだけで動く。

    python3 python/layster/mind_server.py --port 8765          # POST http://<この PC>:8765/mind

Layster.Spatial の Mind (protocol: "layster") の接続先にすると、端末から観測 (MindRequest) が届き、
ここが返事 (MindReply) を返す。中身は「動くことを確かめる」ための素朴な決まりだけ:

  - 体の frame (frame が "body:<id>") で、"command" を返してよいなら:
      物 "target" (無ければ一番近い、手で持てる entity) を pick する command を 1 つ返す
      (samples/spatial/robot-helper と python/layster/body_bridge.py で端から端まで動く)
  - それ以外: 一番近い (床・壁・天井以外の) entity を highlight し、その少し奥に「隠れていそうな物」の
      belief を 1 つ返す (World Model の口の確かめ)。"say" を返してよければ、見えている物の数を言う

自分のモデル (World Model・VLA・判断モデル) を包むときは、decide() を書き換える。
届いた観測は --log のファイル (既定 mind_requests.jsonl) に 1 行ずつ残る (camera の画は除く)。
形式は doc/19-layster.md §3.5、ランタイムの扱いは doc/20-spatial-runtime.md。
"""

import argparse
import json
import math
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STRUCTURAL = {"floor", "wall", "ceiling"}


def horizontal(at):
    return math.hypot(at[0], at[2])


def decide(req, args):
    """観測 (dict) → 返事 (dict)。ここを書き換えて自分のモデルにつなぐ。"""
    allowed = set(req.get("actions") or [])
    frame = req.get("frame") or "user"
    world = req.get("world") or []
    things = req.get("things") or []
    reply = {"actions": [], "beliefs": [], "nextInMs": args.every}

    # ---- 体の frame: command を 1 つ ----
    if frame.startswith("body:") and "command" in allowed:
        body = frame[len("body:"):]
        target = next((t for t in things if t.get("id") == args.target and t.get("placed")), None)
        if target is not None:
            reply["actions"].append({"do": "command", "body": body, "name": args.command, "args": {"target": {"thing": target["id"]}}})
            reply["text"] = f"{args.command} at {target['id']} ({fmt(target['at'])} in the body frame)"
            return reply
        graspable = [e for e in world if "grasp" in (e.get("has") or [])]
        if graspable:
            nearest = min(graspable, key=lambda e: horizontal(e["at"]))
            reply["actions"].append({"do": "command", "body": body, "name": args.command, "args": {"target": {"entity": {"id": nearest["id"]}}}})
            reply["text"] = f"{args.command} the {nearest['is'][0] if nearest.get('is') else 'thing'}"
            return reply
        reply["text"] = "nothing to pick"
        return reply

    # ---- それ以外: 一番近い物を強調し、奥に何かありそうと推測する ----
    objects = [e for e in world if not (set(e.get("is") or []) & STRUCTURAL)]
    if objects:
        nearest = min(objects, key=lambda e: horizontal(e["at"]))
        name = (nearest.get("is") or ["thing"])[0]
        if "highlight" in allowed:
            reply["actions"].append({"do": "highlight", "target": {"entity": {"id": nearest["id"]}}, "label": name, "seconds": 3})
        at = nearest["at"]
        d = max(horizontal(at), 1e-6)
        behind = [round(at[0] + at[0] / d * 0.25, 3), at[1], round(at[2] + at[2] / d * 0.25, 3)]
        reply["beliefs"].append({
            "id": f"hidden-behind-{nearest['id']}",
            "is": ["box"],
            "at": behind,
            "size": [0.15, 0.1, 0.15],
            "confidence": 0.4,
            "data": {"why": f"often something is behind the {name}"},
        })
    if "say" in allowed and req.get("tick", 0) % 5 == 1:
        reply["actions"].append({"do": "say", "text": f"I can see {len(objects)} things around you."})
    if "set" in allowed:
        reply["actions"].append({"do": "set", "key": "mind.demo.seen", "value": len(objects)})
    reply["text"] = f"{len(world)} entities, {len(objects)} objects"
    return reply


def fmt(v):
    return "[" + ", ".join(f"{x:.2f}" for x in v) + "]" if isinstance(v, list) else str(v)


class Handler(BaseHTTPRequestHandler):
    server_version = "LaysterMindDemo/1.0"

    def _send(self, code, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()

    def do_GET(self):
        self._send(200, {"ok": True, "protocol": "layster.mind/1", "post": self.server.args.path})

    def do_POST(self):
        if self.path.rstrip("/") != self.server.args.path.rstrip("/"):
            self._send(404, {"error": f"POST {self.server.args.path}"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - 見本なので、壊れた要求はそのまま返す
            self._send(400, {"error": f"bad JSON: {e}"})
            return
        started = time.time()
        reply = decide(req, self.server.args)
        logged = {k: v for k, v in req.items() if k != "camera"}
        if "camera" in req:
            logged["camera"] = {k: v for k, v in req["camera"].items() if k != "data"}
        with open(self.server.args.log, "a", encoding="utf-8") as f:
            f.write(json.dumps({"t": time.time(), "request": logged, "reply": reply}, ensure_ascii=False) + "\n")
        print(f"[mind] {req.get('mind')} tick {req.get('tick')} frame {req.get('frame')}: "
              f"{len(req.get('world') or [])} entities, {len(req.get('things') or [])} things, camera {'yes' if 'camera' in req else 'no'} "
              f"→ {[a['do'] for a in reply['actions']]} {len(reply['beliefs'])} belief(s) ({(time.time() - started) * 1000:.0f} ms)")
        self._send(200, reply)

    def log_message(self, fmt_, *args):  # 1 行ずつの自前のログだけ出す
        pass


def main():
    # 画面でもファイルへの書き出しでも、1 行ずつすぐ出す
    sys.stdout.reconfigure(line_buffering=True)
    p = argparse.ArgumentParser(description="Layster Mind Protocol demo server (layster.mind/1)")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--path", default="/mind", help="POST path (default /mind)")
    p.add_argument("--command", default="pick", help="the body command to return in a body frame (default pick)")
    p.add_argument("--target", default="target", help="the thing to aim the command at (default 'target')")
    p.add_argument("--every", type=int, default=2000, help="nextInMs to suggest (default 2000)")
    p.add_argument("--log", default="mind_requests.jsonl", help="where to append requests (default mind_requests.jsonl)")
    args = p.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.args = args
    print(f"[mind] layster.mind/1 demo on http://{args.host}:{args.port}{args.path} (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
