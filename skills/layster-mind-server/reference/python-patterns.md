# Wrapping models — Python patterns for `decide(req, args)`

Start from a copy of `python/layster/mind_server.py` (standard library only, threaded HTTP server, logs every
request/reply to `mind_requests.jsonl`) and replace `decide(req, args)`. It receives the request dict and must return
a reply dict (`actions`, `beliefs`, `text`, `nextInMs` — all optional). Everything below uses only the standard
library except where a model library is obviously needed (`your_model`, `policy` are placeholders for your code).

Common rules:
- Return within the mind's `run.timeoutMs` (default 10 s; interval minds usually 4–5 s). If the model is slower,
  run it in a background thread and answer with the latest finished result (or `{}`), see pattern 3.
- Only return actions listed in `req["actions"]`; filter before returning (the device drops others anyway, but the log
  gets noisy).
- Write positions in `req["frame"]`. Do not mix frames.
- `ThreadingHTTPServer` handles requests in parallel; guard a single GPU model with a lock.

## 1. Helper: allowed actions, nearest entity

```python
import math

STRUCTURAL = {"floor", "wall", "ceiling"}


def allowed(req, *kinds):
    """True when the mind may return every kind given."""
    ok = set(req.get("actions") or [])
    return all(k in ok for k in kinds)


def nearest(entities, pred=lambda e: True):
    """Nearest entity (horizontal distance to the frame origin) that matches pred, or None."""
    best = None
    for e in entities:
        if not pred(e):
            continue
        d = math.hypot(e["at"][0], e["at"][2])
        if best is None or d < best[0]:
            best = (d, e)
    return best[1] if best else None


def objects(req):
    """Entities that are not room surfaces."""
    return [e for e in (req.get("world") or []) if not set(e.get("is") or []) & STRUCTURAL]
```

## 2. VLM / LLM with memory (a chat model you call yourself)

Use this instead of `protocol: "openai-chat"` when you want conversation memory, your own prompt, or post-processing.
`OPENAI_URL` is any OpenAI-compatible server (Ollama: `http://127.0.0.1:11434/v1/chat/completions`).

```python
import json
import os
import urllib.request

OPENAI_URL = os.environ.get("OPENAI_URL", "http://127.0.0.1:11434/v1/chat/completions")
MODEL = os.environ.get("MODEL", "qwen3.5:9b")
HISTORY = {}  # mind id -> list of {"role", "content"}


def chat(messages):
    body = json.dumps({"model": MODEL, "messages": messages, "temperature": 0.2, "max_tokens": 400,
                       "stream": False, "reasoning_effort": "none"}).encode("utf-8")
    request = urllib.request.Request(OPENAI_URL, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=8) as res:
        return json.loads(res.read().decode("utf-8"))["choices"][0]["message"]["content"] or ""


def decide(req, args):
    history = HISTORY.setdefault(req["mind"], [])
    seen = ", ".join(f'{e["is"][0]} ({e["id"]})' for e in objects(req)[:10]) or "nothing"
    user_text = f"I can see: {seen}."
    content = [{"type": "text", "text": user_text}]
    if "camera" in req:
        cam = req["camera"]
        content.append({"type": "image_url", "image_url": {"url": f'data:{cam["mime"]};base64,{cam["data"]}'}})
    system = (req.get("goal") or "You are a helper in the user's room.") + " Answer in one short sentence."
    answer = chat([{"role": "system", "content": system}] + history[-8:] + [{"role": "user", "content": content}])
    history += [{"role": "user", "content": user_text}, {"role": "assistant", "content": answer}]
    reply = {"actions": [], "text": answer}
    if allowed(req, "say"):
        reply["actions"].append({"do": "say", "text": answer[:200]})
    return reply
```

## 3. World model (state across ticks, beliefs, slow model in the background)

Keep per-entity history, predict where things are now or are hidden, return beliefs with stable ids and honest
confidence. Use `frame: "world"` in the mind's `observe` so positions do not move with the user's head.

```python
import threading
import time

TRACKS = {}       # entity id -> list of (time, [x, y, z])
LATEST = {"reply": {}}
BUSY = threading.Lock()


def predict(req):
    """Replace with your world model. Here: constant-velocity extrapolation of moving objects."""
    beliefs = []
    now = req["time"]
    for e in objects(req):
        track = TRACKS.setdefault(e["id"], [])
        track.append((now, e["at"]))
        del track[:-10]
        if len(track) >= 2:
            (t0, a), (t1, b) = track[0], track[-1]
            if t1 - t0 > 0.2:
                v = [(b[i] - a[i]) / (t1 - t0) for i in range(3)]
                if abs(v[0]) + abs(v[2]) > 0.02:
                    ahead = [round(b[i] + v[i] * 1.0, 3) for i in range(3)]
                    beliefs.append({"id": f'{e["id"]}-in-1s', "is": list(e["is"]), "at": ahead,
                                    "size": e["size"], "confidence": 0.5, "data": {"velocity": v}})
    return {"beliefs": beliefs, "text": f"{len(beliefs)} prediction(s)", "nextInMs": 1000}


def decide(req, args):
    # Answer immediately with the last finished prediction; run the model when it is free.
    if BUSY.acquire(blocking=False):
        def work():
            try:
                LATEST["reply"] = predict(req)
            finally:
                BUSY.release()
        threading.Thread(target=work, daemon=True).start()
    return LATEST["reply"]
```

## 4. Robot policy (VLA) in the body frame

Mind: `role: "act"`, `observe.frame: "body:<id>"`, `output.actions: ["command", "say"]`, usually `run.on: "event"`
(one step per event, see `samples/spatial/robot-helper`). The request's positions are relative to the robot base;
the reply's command goes through the safety gate on the device (workspace, hand distance, confirm, rate).

```python
import base64


def decide(req, args):
    if not allowed(req, "command") or not req["frame"].startswith("body:"):
        return {"text": "not configured as a policy"}
    body = req["frame"][len("body:"):]
    image = base64.b64decode(req["camera"]["data"]) if "camera" in req else None
    state = (req.get("store") or {}).get(f"body.{body}")
    target = next((t for t in req.get("things") or [] if t["id"] == args.target and t["placed"]), None)
    # step = policy.predict(image=image, state=state, goal=req.get("goal"))   # your VLA here
    if target is None:
        return {"text": "no target placed"}
    return {"actions": [{"do": "command", "body": body, "name": args.command,
                         "args": {"target": {"thing": target["id"]}}}],
            "text": f'{args.command} at {target["at"]}'}
```

## 5. Body bridge to a real robot

Copy `python/layster/body_bridge.py` and replace `SimArm.run(msg, stop)`. `msg["args"]` holds converted targets
`{ "at": [x, y, z], "yaw": deg, "frame": "body" }` (metres in the base frame — convert to your robot's base frame and
units). Send `state` while moving, exactly one `result` per command, and stop promptly when `stop` is set.

```python
def run(self, msg, stop):
    cid, name, args = msg.get("id"), msg.get("name"), msg.get("args") or {}
    target = next((v["at"] for v in args.values() if isinstance(v, dict) and isinstance(v.get("at"), list)), None)
    ok, error = True, None
    try:
        if name == "home":
            target = self.REST
        if target is not None:
            if not self.within_limits(target):          # your own joint / reach / speed limits — always
                raise ValueError("outside robot limits")
            handle = self.robot.move_tool_to(target)     # your robot SDK (non-blocking)
            while not handle.done():
                if stop.is_set():
                    self.robot.halt()
                    ok, error = False, "stopped"
                    break
                self.tool = self.robot.tool_position()
                self.state(f"{name}ing", True)
                time.sleep(0.1)
    except Exception as e:  # report, never crash the bridge
        ok, error = False, str(e)
    self.conn.send({"type": "result", "id": cid, "ok": ok, "error": error})
    with self.lock:
        self.current = None
    self.state("idle" if ok else "stopped", False)
```

The device's safety gate is not a substitute for the robot's own limits and an emergency stop.
