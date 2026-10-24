# Layster Mind Protocol (`layster.mind/1`) and Layster Body Protocol (`layster.body/1`)

Sources: `src/shared/layster/spatial/types.ts` (`MindRequest`, `MindReply`, `Action`), `observe.ts` (how the request
is built), `mindProtocol.ts` (how replies are read), `src/main/layster/mindClient.ts` (editor "Try"),
`doc/19-layster.md` §3.5, `doc/20-spatial-runtime.md` §5–6. The device runtime (`Runtime/Spatial/Core/`) mirrors the
TypeScript exactly.

## Mind: transport

- `POST <endpoint>` with `Content-Type: application/json`, `User-Agent: Layster/1…`, plus the auth header when the
  mind has `auth` (`Authorization: Bearer <value>` by default; header/scheme configurable).
- `{edge}` / `{edge-host}` in the endpoint are replaced before sending (PC `host:port` / host).
- Reply: HTTP 2xx with a JSON object. Non-2xx, non-JSON or no reply within `run.timeoutMs` (default 10 s) = failure
  → `onFail` (`say` / `use` another mind) and a retry after 5 s (or `everyMs`).
- At most one request per mind in flight. `interval` minds are called every `everyMs` (or the reply's `nextInMs`),
  never closer than `minGapMs`.
- `GET` is not used by the device; answering it (as `mind_server.py` does) is handy for health checks.

## Mind: request

| Field | Type | Present when |
|---|---|---|
| `protocol` | `"layster.mind/1"` | always |
| `mind` | string | always — the mind id (one server can serve several minds) |
| `tick` | number | always — increments per call |
| `time` | number | always — seconds since app start |
| `frame` | FrameRef | always — **every position in the request is in this frame**, and positions in the reply must be too. `user` (default): origin at the user's feet, +z where the head faces horizontally. `world`: origin at the start position. `body:<id>`: the robot base. `thing:<id>`, `head`, … also possible |
| `world` | Entity[] | `observe.world` set — nearest first, `{ id, is, at, yaw, size, has, confidence, seenAt?, source, data? }`, `has` always filled |
| `things` | `{ id, at, yaw, placed, visible }[]` | `observe.things` set |
| `user` | `{ head?: { at, forward } \| null, hands?: { left: { at } \| null, right: { at } \| null }, gaze?: { thing?, entity?, point? } \| null }` | `observe.user` lists head / hands / gaze |
| `camera` | `{ mime: "image/jpeg", width, height, data: <base64>, fov?, pose?: { at, forward } }` | `observe.camera` set and a still was available (pose in `world`) |
| `events` | `{ t, name, data? }[]` | `observe.events` > 0 — most recent last (button presses arrive as `select` / `<thing>.<item>`) |
| `store` | object | `observe.store` lists keys (`"x."` = prefix) |
| `actions` | ActionKind[] | always — the actions this mind may return (anything else is dropped) |
| `goal` | string | the mind has `instructions` |
| `extra` | object | the mind has `extra` |

Units: metres, degrees, seconds. Axes x right, y up, z forward. `yaw` clockwise from above.

Example (what `samples/spatial/desk-buddy`-like projects send, trimmed):

```json
{
  "protocol": "layster.mind/1",
  "mind": "helper",
  "tick": 42,
  "time": 128.4,
  "frame": "user",
  "world": [
    { "id": "desk", "is": ["desk"], "at": [0, 0.36, 0.8], "yaw": 180, "size": [1.2, 0.72, 0.6], "has": ["support", "obstacle"], "confidence": 0.95, "source": "scan" },
    { "id": "cup", "is": ["cup"], "at": [0.45, 0.77, 0.75], "yaw": 0, "size": [0.08, 0.1, 0.08], "has": ["grasp"], "confidence": 0.8, "seenAt": 127.9, "source": "detector:yolo" }
  ],
  "things": [ { "id": "card", "at": [-0.4, 0.87, 0.7], "yaw": 180, "placed": true, "visible": true } ],
  "user": { "head": { "at": [0, 1.2, 0], "forward": [0, 0, 1] }, "hands": { "left": null, "right": { "at": [0.2, 0.9, 0.4] } } },
  "events": [ { "t": 126, "name": "select", "data": { "thing": "card", "item": "hint", "event": "card.hint" } } ],
  "store": { "study.state": "solving" },
  "actions": ["say", "highlight", "believe"],
  "goal": "Help the user tidy the desk."
}
```

## Mind: reply

| Field | Type | Meaning |
|---|---|---|
| `actions?` | Action[] | Executed in order if their `do` is in the request's `actions` |
| `beliefs?` | `(Partial<Entity> & { id })[]` | Upserted into the world as `source: "mind:<id>"` when the mind has `output.beliefs: true`. Give `is`, `at`, `size`, `confidence` (0.5 if missing). Positions in the request frame. They fade (1/e in 20 s) unless repeated; keep ids stable across ticks |
| `text?` | string | Stored in `mind.<id>.text` (and `output.text` key if set); shown in the editor |
| `nextInMs?` | number | Interval minds: when to call next |

Every field is optional; `{}` = "nothing to do" and is a perfectly good answer. Entries without `do` (actions) or
`id` (beliefs) are discarded.

Action shapes (from `ACTION_SHAPES`; the same list is put into the openai-chat system prompt):

| do | Shape |
|---|---|
| `place` | `{"do":"place","thing":"<thing id>","at":{"frame":"user","at":[x,y,z]}}` (or `"place": {Placement}`) |
| `move` | `{"do":"move","thing":"<thing id>","to":{"entity":{"id":"<entity id>"}}}` |
| `look` | `{"do":"look","thing":"<thing id>","at":{"user":"head"}}` |
| `say` | `{"do":"say","text":"<short sentence>"}` (+ `thing`, `audio`, `seconds`) |
| `animate` | `{"do":"animate","thing":"<thing id>","clip":"<animation name>"}` |
| `show` / `hide` | `{"do":"show","thing":"<thing id>"}` |
| `highlight` | `{"do":"highlight","target":{"entity":{"id":"<entity id>"}},"label":"<few words>","seconds":5}` |
| `set` | `{"do":"set","key":"<store key>","value":<any>}` |
| `emit` | `{"do":"emit","event":"<event name>"}` |
| `believe` | `{"do":"believe","entity":{"id":"<id>","is":["cup"],"at":[x,y,z],"size":[w,h,d],"confidence":0.6}}` |
| `forget` | `{"do":"forget","entity":"<entity id>"}` |
| `ask` | `{"do":"ask","mind":"<mind id>"}` |
| `command` | `{"do":"command","body":"<body id>","name":"<command>","args":{}}` |

Targets: `{ "thing": id }` · `{ "entity": { "id": … } }` (or any EntityQuery: `{ "is": ["cup"] }`) ·
`{ "frame": "user", "at": [x, y, z] }` · `{ "user": "head" | "feet" | "hand.left" | "hand.right" }`.

Example — a decision/world-model reply:

```json
{
  "actions": [
    { "do": "highlight", "target": { "entity": { "id": "cup" } }, "label": "this one?", "seconds": 4 },
    { "do": "say", "text": "The cup is close to the edge." }
  ],
  "beliefs": [
    { "id": "cup-predicted", "is": ["cup"], "at": [0.52, 0.77, 0.7], "size": [0.08, 0.1, 0.08], "confidence": 0.6, "data": { "why": "moving right at 5 cm/s" } }
  ],
  "text": "cup drifting toward the edge",
  "nextInMs": 1000
}
```

Example — a policy (VLA) reply in a `body:arm` frame:

```json
{
  "actions": [ { "do": "command", "body": "arm", "name": "pick", "args": { "target": { "thing": "target" } } } ],
  "text": "pick at target"
}
```

`target`-typed command args may be any Target; the device converts them to `{ at, yaw, frame: "body" }` before the
body sees them, then the safety gate decides.

## openai-chat minds (no server code needed)

If the model already sits behind an OpenAI-compatible `/v1/chat/completions` (Ollama, LM Studio, vLLM, llama.cpp
server, Groq, OpenRouter …), use `protocol: "openai-chat"` instead of writing a server. The engine sends
`{ model, messages: [system, user], temperature: 0.2, max_tokens: 600, stream: false, ...extra }`: the system prompt
is `instructions` + role text + the allowed action shapes; the user message is the request above as JSON text (minus
`camera`, which is attached as an `image_url` data URL). It reads the first `{…}` in the answer (after removing
`<think>…</think>` and code fences) as the reply. Use `"extra": { "reasoning_effort": "none" }` for thinking models.
Write a `layster.mind/1` server only when you need state between calls, non-chat models, tensors, robots, or
control over the prompt.

## Body: `layster.body/1`

WebSocket, one JSON object per text frame. All positions in the **body frame** (the base thing's pose; metres,
x right, y up, z forward). The device connects to `link.url` and reconnects every 3 s.

Device → bridge, first message:

```json
{ "type": "hello", "protocol": "layster.body/1", "body": "arm", "app": "Robot Helper", "commands": ["pick", "home", "stop"], "workspace": { "center": [0, 0.15, 0.2], "size": [0.5, 0.4, 0.4] } }
```

Device → bridge, a command that passed the safety gate (`pose`/`target` args already converted):

```json
{ "type": "command", "id": "c3", "name": "pick", "args": { "target": { "at": [0.02, 0.05, 0.25], "yaw": 0, "frame": "body" } }, "frame": "body" }
```

Device → bridge, stop (the user's hand came too close while moving):

```json
{ "type": "stop", "id": "s4", "reason": "handTooClose" }
```

Bridge → device:

```json
{ "type": "hello", "name": "sim-arm", "protocol": "layster.body/1" }
```

```json
{ "type": "state", "status": "picking", "busy": true, "joints": { "base": 12.5, "shoulder": 30.1 }, "tool": [0.02, 0.05, 0.25] }
```

```json
{ "type": "result", "id": "c3", "ok": true }
```

`state` may carry anything; the device stores it under `body.<id>` (`.connected`, `.status` = `state.status`,
`.busy`, `.state`) and fires the event `body:<id>`. Answer every `command` with exactly one `result`
(`{ "ok": false, "error": "stopped" | "busy" | … }` on failure). Refuse a command while busy.

`rosbridge` instead: the device `advertise`s and `publish`es `ros.topic` with the converted args as `msg`; no results
come back (sent = success). Use it for existing ROS 2 stacks (`rosbridge_server` on port 9090).

## Episodes (`layster.episode/1`) — training data from recordings

`<persistentDataPath>/layster/episodes/<UTC start>/meta.json` + `episode.jsonl` (one `{ "t", "kind", "data" }` per
line; kinds `start`, `stop`, `mark`, `pose`, `hands`, `world`, `event`, `action`, `mind` (`phase` request / reply /
error), `camera`, `command`, `blocked`) + `camera/<t>.jpg`. All positions in the `world` frame. Convert to LeRobot or
other formats outside the engine. `mind_server.py` also logs every request/reply to `mind_requests.jsonl`.
