# Python Remote Control — `python/Control.py`

A WebSocket client for controlling a running Arsist AR application on a device at runtime.

`python/` holds three different things — don't mix them up:

| Path | What | Talks to |
|------|------|----------|
| `python/Control.py` (`ArsistControl`) | This doc. Remote control of a **Layster.Virtual** app | the device's `ArsistWebSocketServer` (`Runtime/Network/`), port 8765 |
| `python/arsist_controller.py` (`ArsistRemoteController`) | Older, simpler client for the same server (fire-and-forget only; adds `look_at`, `play_animation`, `execute_script`, `set_emotion`, …) | same |
| `python/layster/` | **Layster.Spatial** sample servers that run on the PC — the device connects to them (see the end of this doc) | `mind_server.py` (Mind Protocol over HTTP), `body_bridge.py` (Body Protocol over WebSocket) |

---

## Prerequisites

The AR project must have `arSettings.enableRemoteControl = true` (Inspector → project settings → "Python remote control"; port `remoteControlPort`, default 8765; password `remoteControlPassword`, empty = no auth). Only then does the build add the WebSocket server to the scene. Layster.Spatial builds always have it off (`lower.ts`).

```bash
pip install websocket-client
```

---

## `ArsistControl` Class

```python
ctrl = ArsistControl(
    device_ip="192.168.0.24",
    port=8765,
    password=None,     # None / "" = no authToken sent
    verbose=False
)
```

### Connection

```python
ctrl.connect(timeout=5.0)  # Returns True on success
ctrl.disconnect()
```

Connection spawns a background thread (`_listen_responses`) that continuously reads incoming WebSocket messages and stores them in `pending_responses` keyed by `requestId`.

---

## Command Types

### Fire-and-Forget — `send_command(cmd_type, method, **params)`

Sends a command without waiting for a response. Used for real-time control where latency matters.

### Query (Request-Response) — `query(cmd_type, method, timeout=10.0, **params)`

Sends a command with a unique `requestId` UUID and blocks until the matching response arrives or `timeout` expires.
Returns `data`; raises `RuntimeError` when `success` is false and `TimeoutError` on timeout.

Response shape:
```json
{
  "requestId": "<uuid>",
  "success": true,
  "data": <result>,
  "error": "<message>"   // only when success is false
}
```

---

## High-Level API Methods

### Query API (request-response)

| Method | Returns | Description |
|--------|---------|-------------|
| `get_ids()` | `Dict` (annotated `List[str]`) | `query/getIds` → `{ vrmIds: [...], sceneIds: [...] }` |
| `get_capabilities(avatar_id)` | `Dict` | `query/getCapabilities` → the device's `VRMCapabilities` (`Id`, `Expressions`, `HumanoidBones`, `HasHumanoid`, `Position`, `Rotation`, `Scale`) |
| `get_state(object_id)` | `Dict` | `query/getState` — current state of an object |
| `ping()` | `Dict` | `query/ping` → `{ pong: true, timestamp }` |

### VRM Control (fire-and-forget)

| Method | Parameters | Description |
|--------|-----------|-------------|
| `set_expression(avatar_id, expression, value=100.0)` | `value`: 0–100 | Set a facial expression blend shape |
| `set_bone_rotation(avatar_id, bone_name, pitch, yaw, roll)` | degrees | Set humanoid bone rotation |
| `reset_expressions(avatar_id)` | — | Reset all expressions to 0 |
| `reset_pose(avatar_id)` | — | Sets 10 key bones (Head, Neck, arms, hands, Spine, Hips) to rotation 0 |

### Scene Control (fire-and-forget)

| Method | Description |
|--------|-------------|
| `set_position(object_id, x, y, z)` | Move object in world space |
| `set_rotation(object_id, pitch, yaw, roll)` | Rotate object |
| `set_scale(object_id, x, y, z)` | Scale object |
| `set_visible(object_id, visible)` | Show/hide object |

---

## WebSocket Message Format

### Outgoing (client → device)

```jsonc
{
  "type": "vrm",
  "method": "setExpression",
  "requestId": "<uuid>",     // only on queries; without it the device sends no response
  "authToken": "0000",       // required when the app has a password
  "parameters": {
    "id": "avatar",
    "expressionName": "Happy",
    "value": 100
  }
}
```

**Command types** (device side: `ArsistWebSocketServer.ProcessCommand`; method names are case-insensitive):
- `"scene"` / `"transform"` — `setPosition`, `move`, `setRotation`, `rotate`, `setScale`, `setUniformScale`, `playAnimation`, `stopAnimation`, `setAnimationSpeed`, `setVisible`
- `"vrm"` — `setBoneRotation`, `rotateBone`, `setExpression`, `resetExpressions`, `lookAt`, `clearLookAt`, `setHeight`, `setHandTarget`, `clearHandTarget`, `playAnimation`, `setAnimationSpeed` (query methods sent as `vrm` are answered too)
- `"query"` — `ping`, `getIds`, `getCapabilities` / `getInfo`, `getExpressions`, `getBones`, `getState`, `getScene`, `getHeadPose` / `getViewerPose`, `getPerceptionTasks`, `getPerceptionSnapshot`
- `"viewer"` — `getPose`, `recenter` / `resetPosition`, `placeInFront`
- `"script"` — run `parameters.code`
- `"batch"` — `parameters.commands` applied in one frame (no nesting)

`Control.py` wraps only part of this; use `send_command` / `query` for the rest.

### Incoming (device → client)

```json
{
  "requestId": "<uuid>",
  "success": true,
  "data": { ... }
}
```

---

## `generate_sample_script(avatar_id, capabilities?)` 

Generates an executable Python script based on the avatar's actual capabilities. If `capabilities` is not provided, it calls `get_capabilities()` first.

The generated script:
1. Cycles through up to 5 available expressions
2. Rotates up to 3 available humanoid bones
3. Resets expressions and pose

---

Note: the generated script imports `ArsistControl` from `python.arsist_controller`, which defines
`ArsistRemoteController` instead — fix the import line before running it.

---

## `run_demo(avatar_id)`

Six-step adaptive demo:
1. Ping the device
2. List registered VRM IDs
3. Query capabilities for `avatar_id`
4. Set first available expression
5. Rotate first available bone by 45°
6. Reset expressions and pose

---

## CLI Usage

```bash
python Control.py --device 192.168.0.24 --demo
python Control.py --device 192.168.0.24 --list-ids
python Control.py --device 192.168.0.24 --avatar-id avatar --generate-sample
python Control.py --device 192.168.0.24 --port 8765 --password mysecret --verbose
```

| Flag | Default | Description |
|------|---------|-------------|
| `--device` | `$ARSIST_DEVICE_IP` or `localhost` | Device IP address |
| `--port` | `$ARSIST_DEVICE_PORT` or `8765` | WebSocket port |
| `--demo` | — | Run adaptive demo |
| `--list-ids` | — | Print registered VRM IDs |
| `--avatar-id` | `avatar` | Target avatar for demo/sample |
| `--generate-sample` | — | Print auto-generated sample script |
| `--password` | `$ARSIST_DEVICE_PASSWORD` or empty (warns, connects without auth) | Auth password |
| `--verbose / -v` | — | Enable debug output |

If none of `--demo`, `--list-ids`, or `--generate-sample` is specified, `--demo` runs by default.

---

## `python/layster/` — Layster.Spatial sample servers

Unrelated to `Control.py`: here the **device is the client**. Both need only the Python 3.8+ standard library
(no `pip install`) and run on a PC on the same LAN. Details: `python/layster/README.md`, protocols in
doc/19-layster.md §3.5 and doc/20-spatial-runtime.md §4.

| File | Protocol | Run | Device side |
|------|----------|-----|-------------|
| `mind_server.py` | `layster.mind/1` (HTTP POST) | `python3 python/layster/mind_server.py --port 8765` | Mind `protocol: "layster"`, `endpoint: "http://{edge}/mind"` |
| `body_bridge.py` | `layster.body/1` (WebSocket) + a simulated arm | `python3 python/layster/body_bridge.py --port 8766` | body `link: { protocol: "layster-body", url: "ws://{edge-host}:8766" }` |

`{edge}` is the PC address stored on the device (`world.setEdge(...)`, else the project's `app.edge`). Both take
`--host` (default `0.0.0.0`) and `--port`. To plug in a real model / robot, rewrite `decide(req, args)` in
`mind_server.py` or `SimArm.run` in `body_bridge.py`. The editor's "try Mind" (`spatial:try-mind`) can call
`mind_server.py` too.
