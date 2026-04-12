# Python Remote Control — `python/Control.py`

A WebSocket client for controlling a running Arsist AR application on a device at runtime.

---

## Prerequisites

The AR project must have `arSettings.enableRemoteControl = true` (default port 8765). The built APK will then start a WebSocket server on the device that accepts commands from this client.

```bash
pip install websocket-client
```

---

## `ArsistControl` Class

```python
ctrl = ArsistControl(
    device_ip="192.168.0.24",
    port=8765,
    password="0000",   # empty string = no auth
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

Response shape:
```json
{
  "requestId": "<uuid>",
  "success": true,
  "data": <result>
}
```

---

## High-Level API Methods

### Query API (request-response)

| Method | Returns | Description |
|--------|---------|-------------|
| `get_ids()` | `List[str]` | Get all registered VRM avatar IDs |
| `get_capabilities(avatar_id)` | `Dict` | Get expressions, bones, and other capabilities of a VRM |
| `get_state(object_id)` | `Dict` | Get current state of an object |
| `ping()` | `Dict` | Ping the device; confirms connectivity |

### VRM Control (fire-and-forget)

| Method | Parameters | Description |
|--------|-----------|-------------|
| `set_expression(avatar_id, expression, value=100.0)` | `value`: 0–100 | Set a facial expression blend shape |
| `set_bone_rotation(avatar_id, bone_name, pitch, yaw, roll)` | degrees | Set humanoid bone rotation |
| `reset_expressions(avatar_id)` | — | Reset all expressions to 0 |
| `reset_pose(avatar_id)` | — | Reset 10 key bones to zero rotation (T-pose) |

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

```json
{
  "type": "vrm",
  "method": "setExpression",
  "requestId": "<uuid>",     // optional for fire-and-forget
  "authToken": "0000",       // optional if password is set
  "parameters": {
    "id": "avatar",
    "expressionName": "Happy",
    "value": 100
  }
}
```

**Command types:**
- `"vrm"` — VRM avatar control
- `"scene"` — scene object transform control
- `"query"` — read-only queries (ping, getIds, getCapabilities, getState)

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
python Control.py --device 192.168.0.24 --password mysecret --verbose
```

| Flag | Default | Description |
|------|---------|-------------|
| `--device` | `192.168.0.24` | Device IP address |
| `--demo` | — | Run adaptive demo |
| `--list-ids` | — | Print registered VRM IDs |
| `--avatar-id` | `avatar` | Target avatar for demo/sample |
| `--generate-sample` | — | Print auto-generated sample script |
| `--password` | `0000` | Auth password |
| `--verbose / -v` | — | Enable debug output |

If none of `--demo`, `--list-ids`, or `--generate-sample` is specified, `--demo` runs by default.
