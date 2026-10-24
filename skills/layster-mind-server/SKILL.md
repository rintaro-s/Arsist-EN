---
name: layster-mind-server
description: Wrap a model (LLM, VLM, world model, VLA/robot policy, decision model) as a Layster Mind Protocol (layster.mind/1) HTTP server, or a robot as a Layster Body Protocol (layster.body/1) WebSocket bridge, so a Layster.Spatial app can use it; and test it with curl and the editor's Mind I/O → Try. Use when the user wants to connect their own AI model or robot to an Arsist/Layster Spatial app, edit python/layster/mind_server.py or body_bridge.py, or debug why a mind or body does not answer.
---

# Layster mind servers and body bridges

A Layster.Spatial app talks to AI through **minds** and to robots through **bodies** (see the `layster-spatial`
skill for the project side). This skill is the other end of the wire.

Reference files:
- [reference/protocol.md](reference/protocol.md) — every request/reply field, action shapes, body messages, episodes (validated examples)
- [reference/python-patterns.md](reference/python-patterns.md) — `decide()` patterns: VLM with memory, world model with beliefs, VLA policy, real-robot bridge

Templates (standard library only, Python ≥ 3.8, no pip): `python/layster/mind_server.py` (HTTP, `layster.mind/1`)
and `python/layster/body_bridge.py` (WebSocket, `layster.body/1`, simulated arm). Contracts:
`src/shared/layster/spatial/{types,observe,mindProtocol}.ts`; runtime behaviour: `doc/20-spatial-runtime.md`.

## First decide: do you need a server at all?

| The model is… | Use |
|---|---|
| A chat/vision LLM behind an OpenAI-compatible `/v1/chat/completions` (Ollama, LM Studio, vLLM, llama.cpp, Groq, OpenRouter) | No server. Mind with `protocol: "openai-chat"`, `model`, `extra: { "reasoning_effort": "none" }` for thinking models, `auth.secret` for keys |
| Anything that needs memory between calls, a custom prompt, non-chat output, tensors, a world model, a robot policy | A `layster.mind/1` server (this skill) with `protocol: "layster"` |
| A physical robot or device | A `layster.body/1` bridge (or `rosbridge` for ROS 2) + a body in the project |

## Mind server: steps

1. Copy the template next to your model code (keep the original as the reference):
   `cp python/layster/mind_server.py my_mind/mind_server.py`. Replace `decide(req, args)`; keep the HTTP handler.
2. Implement `decide` (patterns in `reference/python-patterns.md`). The contract:
   - Input `req`: `mind`, `tick`, `time`, `frame`, `actions` (allowed kinds), and — depending on the mind's `observe` —
     `world` (entities, nearest first), `things`, `user`, `camera` (base64 JPEG), `events`, `store`, `goal`, `extra`.
   - Output: `{ "actions": [...], "beliefs": [...], "text": "...", "nextInMs": 1000 }`, all optional; `{}` = do nothing.
   - **Positions in and out are in `req["frame"]`** (`user` by default; `world` for world models; `body:<id>` for
     policies). Metres, x right / y up / z forward.
   - Return only allowed action kinds; beliefs need `id`, `is`, `at`, `size`, `confidence`, and stable ids across ticks.
   - Answer within the mind's `run.timeoutMs`; run slow models in the background and return the latest result.
3. Run it on the PC on the same LAN as the headset: `python3 my_mind/mind_server.py --port 8765`
   (`--host` default `0.0.0.0`, `--path` default `/mind`, `--log` default `mind_requests.jsonl`).
4. The project's mind: `"protocol": "layster"`, `"endpoint": "http://{edge}/mind"`, `app.edge` = `"<PC LAN IP>:8765"`,
   `observe` = only what the model needs, `output.actions` = only what it may do, `output.beliefs: true` for world
   models. (Recipes 11 and 12 in `layster-spatial/reference/recipes.md`.)

## Test it

**curl** (with the template server running locally):

```bash
python3 python/layster/mind_server.py --port 8765 &
curl -s http://127.0.0.1:8765/mind      # health: {"ok": true, "protocol": "layster.mind/1", "post": "/mind"}
curl -s -X POST http://127.0.0.1:8765/mind -H 'Content-Type: application/json' -d '{
  "protocol": "layster.mind/1", "mind": "helper", "tick": 1, "time": 3.2, "frame": "user",
  "world": [ { "id": "cup", "is": ["cup"], "at": [0.45, 0.77, 0.75], "yaw": 0, "size": [0.08, 0.1, 0.08],
               "has": ["grasp"], "confidence": 0.8, "source": "detector:demo" } ],
  "actions": ["say", "highlight", "set"] }'
```

The template answers with a `highlight` on the cup, a `say` (on ticks 1, 6, 11, …), a `set` and a `hidden-behind-cup`
belief. Save a real request from `mind_requests.jsonl` (or from the editor, below) and replay it with `-d @request.json`.

**Editor (Mind I/O → Try)** — the most faithful test short of a device:
1. Open the Spatial project, select the mind, open the bottom panel **Mind I/O** (or "See what it receives & try it"
   in the mind inspector).
2. Pick a test space (Space Lab). The panel shows the exact **Observation** the device would send in that room
   (built by the same `observe.ts`), and for openai-chat the **Instructions sent** and **HTTP body**.
3. Fill **PC ({edge})** with `127.0.0.1:8765` (or the server's `host:port`) and press **Try**. The editor's main
   process sends the request (no CORS, keys never reach the renderer) and shows the round-trip time, the text, the
   actions the device would run, actions dropped as not allowed, and the beliefs (**show in 3D** to see them in the room).
4. Failures are explicit: `the endpoint needs the PC address ({edge})`, `HTTP 500`, `the reply is not JSON`,
   `no reply within N ms`, `the key "X" is not set`.

**Device**: `app.edge` (or `world.setEdge("192.168.0.23:8765")` in a script, kept on the device). Open the PC
firewall for the port. `npm run logs` streams device logs over the LAN (look for `[Layster]` lines and the
`mind.<id>.status` / `mind.<id>.ms` store keys). The server's console prints one line per request.

## Body bridge: steps

1. `cp python/layster/body_bridge.py my_robot/body_bridge.py`; replace `SimArm.run(msg, stop)` with your robot SDK
   (pattern 5). Keep the WebSocket code.
2. Contract: on connect the device sends `hello` (body id, command names, workspace); answer `hello`. For each
   `command` (already through the device's safety gate; `target`/`pose` args are `{ at, yaw, frame: "body" }` in
   metres relative to the base thing) send `state` while moving (`busy: true`) and **exactly one** `result`
   (`ok` or `error`). On `stop`, halt now and answer the running command with `error: "stopped"`. Refuse commands while
   busy (`error: "busy"`).
3. Enforce the robot's own joint, reach, speed and force limits and keep a hardware emergency stop — the headset's
   gate (workspace box, hand distance, confirm, rate) is an extra layer, not the only one.
4. Run: `python3 my_robot/body_bridge.py --port 8766`; project body link `ws://{edge-host}:8766`.
5. Test without a headset: the simulated arm (`body_bridge.py` as shipped) plus `mind_server.py` drive
   `samples/spatial/robot-helper` end to end. Any WebSocket client works for manual checks (send the `hello` and
   `command` JSON from `reference/protocol.md`). ROS 2: use `link.protocol: "rosbridge"` with `ros: { topic, type }` on
   every command instead of a bridge.

## Rules

- Keep servers general and outside the engine (`python/layster/` are templates; do not add model-specific features to
  the Arsist engine or IR — the mind/body contract is the extension point).
- Never put API keys in the project or in requests you log; read them from the environment on the server side, or
  use the project's `auth.secret` (name only) for openai-chat minds.
- Camera frames are personal data: log metadata only (the template strips `camera.data`), and do not forward them to
  third parties without the user's consent.
- When something fails, test in this order: curl → Mind I/O Try → device logs.
