# Layster.Spatial recipes

Copy-paste patterns. Each block is a **project fragment**: merge its arrays into `project.spatial.json`, or pass
each item to its tool (`spatial_set_thing` with `{ "thing": … }`, `spatial_set_mind` with `{ "mind": … }`,
`spatial_set_body`, `spatial_set_rule`, `spatial_set_script`; `recording` / `memory` go through
`spatial_set_settings`). Every block here passes `validateSpatialProject` with no errors and no warnings, lowers
without warnings, and was solved in all seven built-in spaces; the "Lands" line says where.

Rename ids freely, but keep references (`near.thing`, `select: "<thing>.<item>"`, `ask.mind`, `base.thing`) in step.

## Contents

1. [Panel on a desk, with fallbacks](#1-panel-on-a-desk-with-fallbacks)
2. [HUD line locked to the view](#2-hud-line-locked-to-the-view)
3. [Panel that follows the user](#3-panel-that-follows-the-user)
4. [Character standing near the user](#4-character-standing-near-the-user)
5. [Character next to a panel](#5-character-next-to-a-panel)
6. [Poster on a wall](#6-poster-on-a-wall)
7. [Label on a real object](#7-label-on-a-real-object)
8. [Model on the floor, out of the way](#8-model-on-the-floor-out-of-the-way)
9. [LLM mind on a PC (Ollama)](#9-llm-mind-on-a-pc-ollama)
10. [Cloud LLM mind (Groq) with a key](#10-cloud-llm-mind-groq-with-a-key)
11. [World-model mind (layster.mind/1) with beliefs](#11-world-model-mind-laystermind1-with-beliefs)
12. [Robot arm body with confirm and rules](#12-robot-arm-body-with-confirm-and-rules)
13. [Recording with consent](#13-recording-with-consent)
14. [Script using world.*](#14-script-using-world)

## 1. Panel on a desk, with fallbacks

Prefer a real desk/table in reach with free space; else any surface at table height; else in front of the user at
chest height. `keep: "forever"` brings it back to the same desk spot next launch.

```json
{
  "things": [
    {
      "id": "card",
      "name": "Question card",
      "visual": {
        "kind": "panel", "size": [0.38, 0.3], "background": "#F4EFE6F0", "padding": 20,
        "items": [
          { "type": "text", "id": "title", "text": "Today's question", "size": 30, "color": "#5A4A3A", "align": "center" },
          { "type": "text", "id": "body", "text": "3x + 5 = 17", "size": 52, "color": "#222222", "align": "center", "reveal": 12 },
          { "type": "row", "gap": 16, "items": [
            { "type": "button", "id": "hint", "text": "Hint", "size": 30 },
            { "type": "button", "id": "done", "text": "Done", "size": 30 }
          ] }
        ]
      },
      "place": {
        "on": { "is": ["table"] }, "distance": [0.3, 1.4], "clearance": [0.4, 0.3], "facing": "user", "keep": "forever",
        "fallback": [
          { "on": { "has": ["support"], "not": ["bed", "floor"] }, "distance": [0.3, 1.8], "height": [0.35, 1.2], "facing": "user" },
          { "at": { "frame": "user", "at": [0.15, 1.0, 0.7] }, "facing": "user" }
        ]
      }
    }
  ],
  "rules": [
    { "id": "card-hint", "when": { "select": "card.hint" }, "do": [ { "do": "say", "text": "Subtract 5 from both sides first." } ], "cooldownMs": 2000 },
    { "id": "card-done", "when": { "select": "card.done" }, "do": [ { "do": "hide", "thing": "card" } ] }
  ]
}
```

Lands: on a table in `desk-front` (the desk), `living` (coffee table), `classroom` (nearest desk) and `tiny`
(side table); fallback 2 (in front of the user) in `studio` (its desk is 2.2 m away, outside `distance`),
`open-floor` and `no-scan`. Widen `distance` to `[0.3, 2.5]` if a desk across the room is acceptable.

## 2. HUD line locked to the view

Subtitles / status. `mode: "head"` ignores the room entirely. Bind to `say.text` to show every `say` action.
Keep it below the line of sight (`y` ≈ −0.3 at 1.5 m) and narrow.

```json
{
  "things": [
    {
      "id": "subtitle",
      "visual": { "kind": "panel", "size": [0.6, 0.08], "background": "#00000099", "padding": 10,
        "items": [ { "type": "text", "id": "line", "text": "", "size": 34, "color": "#FFFFFF", "align": "center", "bind": "say.text" } ] },
      "place": { "mode": "head", "at": { "frame": "head", "at": [0, -0.3, 1.5] } }
    }
  ]
}
```

Lands: always 1.5 m ahead, 0.3 m below the eyes (head frame).

## 3. Panel that follows the user

A menu that stays with the user without being glued to the head: `mode: "body"` re-solves after the user walks
1.2 m or turns 60°. The ring is around the head, inside the view.

```json
{
  "things": [
    {
      "id": "menu",
      "visual": {
        "kind": "panel", "size": [0.3, 0.2], "padding": 16,
        "items": [
          { "type": "text", "id": "title", "text": "Menu", "size": 30, "align": "center" },
          { "type": "button", "id": "start", "text": "Start", "size": 30 }
        ]
      },
      "place": {
        "mode": "body", "near": { "user": "head" }, "around": [0.6, 0.8], "visible": 30, "facing": "user",
        "fallback": [ { "at": { "frame": "user", "at": [0, 1.1, 0.7] }, "facing": "user" } ]
      }
    }
  ]
}
```

Lands: 0.6 m in front of the head, 15 cm below the eyes, in every space (own rule).

## 4. Character standing near the user

Front-right, not straight ahead (a 1.5 m character in front blocks the view). `near` a point in the `user` frame
with `prefer: "closest"` (the default) takes that point when it is free and the nearest free spot around it otherwise;
the fallbacks try the left side, then any free spot on a ring around the user.

```json
{
  "things": [
    {
      "id": "buddy",
      "name": "Buddy",
      "visual": { "kind": "character", "file": "Assets/Characters/buddy.vrm", "blink": true, "breathe": true, "lookAtUser": "nearby", "height": 1.45 },
      "place": {
        "near": { "frame": "user", "at": [0.7, 0, 1.1] }, "around": [0, 0.6], "distance": [0.8, 2.5], "facing": "user",
        "fallback": [
          { "near": { "frame": "user", "at": [-0.7, 0, 1.1] }, "around": [0, 0.6], "distance": [0.8, 2.5], "facing": "user" },
          { "near": { "user": "feet" }, "around": [0.8, 2.5], "facing": "user" }
        ]
      }
    }
  ],
  "rules": [
    { "id": "buddy-hello", "when": { "placed": "buddy" }, "do": [
      { "do": "look", "thing": "buddy", "at": { "user": "head" } },
      { "do": "say", "thing": "buddy", "text": "Hi! I'll be over here." }
    ] }
  ]
}
```

Lands: front-right on the floor (~1.3 m) in every space except `tiny`, where the wall 0.8 m ahead pushes it to the
front-left fallback.
Import the VRM first (editor: Assets → Characters) so `Assets/Characters/buddy.vrm` exists; animations are
`Assets/Animations/<name>.fbx` (`"animation": "<name>"`).

## 5. Character next to a panel

`near: { "thing": … }` places relative to another thing; things are solved in dependency order. `avoid` keeps
0.3 m between them.

```json
{
  "things": [
    {
      "id": "quiz",
      "visual": {
        "kind": "panel", "size": [0.36, 0.22], "padding": 18,
        "items": [
          { "type": "text", "id": "q", "text": "What is 7 × 8?", "size": 40, "align": "center" },
          { "type": "button", "id": "ask", "text": "Ask the buddy", "size": 30 }
        ]
      },
      "place": {
        "on": { "has": ["support"], "not": ["bed", "floor"] }, "distance": [0.3, 1.6], "height": [0.35, 1.2],
        "fallback": [ { "at": { "frame": "user", "at": [0, 1.0, 0.8] } } ]
      }
    },
    {
      "id": "tutor",
      "visual": { "kind": "character", "file": "Assets/Characters/tutor.vrm", "height": 1.4 },
      "place": {
        "near": { "thing": "quiz" }, "around": [0.6, 1.4], "distance": [0.8, 3.0], "avoid": ["quiz"], "prefer": "inView", "facing": "user",
        "fallback": [ { "near": { "user": "feet" }, "around": [1.0, 2.2], "facing": "user" } ]
      }
    }
  ],
  "rules": [
    { "id": "tutor-look", "when": { "select": "quiz.ask" }, "do": [
      { "do": "look", "thing": "tutor", "at": { "thing": "quiz" } },
      { "do": "say", "thing": "tutor", "text": "Seven eights… think of 7 × 10 minus 7 × 2." }
    ], "cooldownMs": 3000 }
  ]
}
```

Lands: the tutor stands 0.6–1.4 m from the quiz, at least 0.8 m from the user, in every space (own rule). Without
`distance`, a quiz floating in front of the user (its fallback) let the tutor stand 0.2 m in front of the user's face —
always bound characters away from the user.

## 6. Poster on a wall

`on: { "is": ["wall"] }` hangs the panel on the wall's inside face, oriented with the wall. Keep it in view and at a
readable height; fall back to floating in front of the user when there are no walls (`open-floor`, `no-scan`).

```json
{
  "things": [
    {
      "id": "poster",
      "visual": {
        "kind": "panel", "size": [0.6, 0.4], "background": "#20242CF0", "padding": 24,
        "items": [
          { "type": "text", "id": "title", "text": "Daily goals", "size": 44, "align": "center" },
          { "type": "text", "id": "goals", "text": "", "size": 30, "bind": "goals.text" }
        ]
      },
      "place": {
        "on": { "is": ["wall"] }, "visible": 45, "distance": [0.8, 4.0], "height": [0.9, 1.6], "prefer": "inView",
        "fallback": [ { "near": { "user": "head" }, "around": [1.2, 1.5], "visible": 35, "facing": "user" } ]
      }
    }
  ]
}
```

Lands: on the front wall in `studio`, `desk-front`, `living` and `tiny`; the fallback (floating 1.2 m ahead) in
`classroom` (its front wall is 6 m away, outside `distance`), `open-floor` and `no-scan`.

## 7. Label on a real object

Tag something the world knows (scan, detector or a mind's belief). `near` an entity with a `height` puts the label
just above it; the fallback keeps it visible when the object is unknown.

```json
{
  "things": [
    {
      "id": "cup-tag",
      "visual": { "kind": "label", "text": "Drink water", "height": 0.035, "color": "#FFFFFF" },
      "place": {
        "near": { "entity": { "is": ["cup"] } }, "around": [0.1, 0.25], "height": [0.8, 1.3], "keep": "none", "facing": "user",
        "fallback": [ { "near": { "user": "head" }, "around": [0.8, 1.0], "visible": true, "facing": "user" } ]
      }
    }
  ],
  "rules": [
    { "id": "cup-glow", "when": { "seen": { "is": ["cup"] } }, "do": [
      { "do": "highlight", "target": { "entity": { "is": ["cup"] } }, "label": "cup", "seconds": 3 },
      { "do": "place", "thing": "cup-tag" }
    ], "cooldownMs": 10000 }
  ]
}
```

`keep: "none"` re-solves when the world changes, so the label follows the cup once it is detected. Lands: next to the
cup in `desk-front` (the only built-in space with a cup); the fallback elsewhere.

## 8. Model on the floor, out of the way

A decorative model on the floor, not in the walking line straight ahead, away from furniture.

```json
{
  "things": [
    {
      "id": "plant-model",
      "visual": { "kind": "model", "file": "Assets/Models/plant.glb", "height": 0.6 },
      "place": {
        "on": { "is": ["floor"] }, "distance": [1.0, 2.5], "avoid": ["table", "chair", "couch", "bed"], "prefer": "inView",
        "visible": 60,
        "fallback": [ { "on": { "is": ["floor"] }, "distance": [0.6, 3.0] } ]
      }
    }
  ]
}
```

Lands: on the floor in view in `studio`, `living`, `open-floor`, `no-scan`; the fallback (any free floor spot,
possibly beside or behind the user) in `desk-front`, `classroom`, `tiny`.

## 9. LLM mind on a PC (Ollama)

OpenAI-compatible chat on the PC (`{edge}` = the PC's `host:port`, here Ollama's 11434 via `app.edge`).
`reasoning_effort: "none"` stops thinking models (Qwen3 family) from spending the whole budget on hidden reasoning
and returning nothing. Allow only the actions the mind needs. `run.on: "manual"` = only when asked.

```json
{
  "app": { "edge": "192.168.0.23:11434" },
  "things": [
    {
      "id": "talk-pad",
      "visual": { "kind": "panel", "size": [0.3, 0.12], "padding": 14,
        "items": [ { "type": "button", "id": "talk", "text": "Talk", "size": 34 } ] },
      "place": {
        "on": { "has": ["support"], "not": ["bed", "floor"] }, "distance": [0.3, 1.6], "height": [0.35, 1.2],
        "fallback": [ { "at": { "frame": "user", "at": [0.2, 1.0, 0.7] } } ]
      }
    },
    {
      "id": "subtitle",
      "visual": { "kind": "panel", "size": [0.6, 0.08], "background": "#00000099", "padding": 10,
        "items": [ { "type": "text", "id": "line", "text": "", "size": 34, "align": "center", "bind": "say.text" } ] },
      "place": { "mode": "head", "at": { "frame": "head", "at": [0, -0.3, 1.5] } }
    }
  ],
  "minds": [
    {
      "id": "chat",
      "name": "Chat (Ollama on the PC)",
      "role": "converse",
      "where": "edge",
      "protocol": "openai-chat",
      "endpoint": "http://{edge}/v1/chat/completions",
      "model": "qwen3.5:9b",
      "instructions": "You are a friendly helper in the user's room. Answer in one or two short sentences.",
      "observe": { "frame": "user", "world": { "within": 3, "max": 15 }, "user": ["head", "gaze"], "events": 5 },
      "output": { "actions": ["say", "highlight"], "beliefs": false },
      "run": { "on": "manual", "minGapMs": 1500, "timeoutMs": 15000 },
      "extra": { "reasoning_effort": "none" },
      "onFail": { "say": "Sorry, I can't think right now." }
    }
  ],
  "rules": [
    { "id": "talk", "when": { "select": "talk-pad.talk" }, "do": [ { "do": "ask", "mind": "chat" } ], "cooldownMs": 3000 }
  ]
}
```

On the PC: `OLLAMA_HOST=0.0.0.0 ollama serve` (listen on the LAN) and `ollama pull qwen3.5:9b`. LM Studio / vLLM work
the same with their `/v1/chat/completions` URL.

## 10. Cloud LLM mind (Groq) with a key

The key is referenced by **name** only. Set the value in the editor (Mind → API key) or in
`<project>/.layster/secrets.local.json` (git-ignored, baked into the build). Never send camera images to a cloud mind
without telling the user (the validator warns).

```json
{
  "things": [
    {
      "id": "ask-pad",
      "visual": { "kind": "panel", "size": [0.3, 0.12], "padding": 14,
        "items": [ { "type": "button", "id": "ask", "text": "What should I do?", "size": 28 } ] },
      "place": {
        "on": { "has": ["support"], "not": ["bed", "floor"] }, "distance": [0.3, 1.6], "height": [0.35, 1.2],
        "fallback": [ { "at": { "frame": "user", "at": [0.2, 1.0, 0.7] } } ]
      }
    }
  ],
  "minds": [
    {
      "id": "coach",
      "role": "decide",
      "where": "cloud",
      "protocol": "openai-chat",
      "endpoint": "https://api.groq.com/openai/v1/chat/completions",
      "model": "qwen/qwen3-32b",
      "auth": { "secret": "GROQ_API_KEY" },
      "instructions": "Suggest one small next step for tidying the user's desk. Point at the object with highlight.",
      "observe": { "frame": "user", "world": { "within": 2.5, "max": 20 } },
      "output": { "actions": ["say", "highlight"], "beliefs": false },
      "run": { "on": "manual", "minGapMs": 2000, "timeoutMs": 12000 },
      "extra": { "reasoning_effort": "none" },
      "onFail": { "say": "The coach is offline." }
    }
  ],
  "rules": [
    { "id": "ask-coach", "when": { "select": "ask-pad.ask" }, "do": [ { "do": "ask", "mind": "coach" } ], "cooldownMs": 3000 }
  ]
}
```

## 11. World-model mind (layster.mind/1) with beliefs

Your own server (template `python/layster/mind_server.py`, see the `layster-mind-server` skill) receives the world
every second and returns **beliefs** — entities it thinks exist (hidden, predicted, moving). They enter the world as
`source: "mind:<id>"`, fade over ~20 s, and are usable by placements, rules and other minds like scanned objects.

```json
{
  "app": { "edge": "192.168.0.23:8765" },
  "things": [
    {
      "id": "status",
      "visual": { "kind": "panel", "size": [0.5, 0.07], "background": "#00000080", "padding": 8,
        "items": [ { "type": "text", "id": "line", "text": "", "size": 26, "align": "center", "bind": "lab.status" } ] },
      "place": { "mode": "head", "at": { "frame": "head", "at": [0, -0.32, 1.5] } }
    }
  ],
  "minds": [
    {
      "id": "predictor",
      "name": "World model (PC)",
      "role": "predict",
      "where": "edge",
      "protocol": "layster",
      "endpoint": "http://{edge}/mind",
      "instructions": "Predict hidden or moved objects from the history of observations. Return beliefs with honest confidence.",
      "observe": { "frame": "world", "world": { "within": 5, "max": 60, "minConfidence": 0.1 }, "user": ["head", "hands", "gaze"], "camera": { "width": 384, "quality": 70 }, "events": 20 },
      "output": { "actions": ["highlight", "set"], "beliefs": true },
      "run": { "on": "interval", "everyMs": 1000, "minGapMs": 500, "timeoutMs": 4000 },
      "onFail": { "say": "World model unreachable (is mind_server.py running?)" }
    }
  ],
  "rules": [
    { "id": "lab-start", "when": { "start": true }, "do": [ { "do": "set", "key": "lab.status", "value": "Waiting for the world model" } ] },
    { "id": "lab-reply", "when": { "mind": "predictor" }, "do": [ { "do": "set", "key": "lab.status", "value": "Prediction received" } ], "cooldownMs": 5000 },
    { "id": "lab-box", "when": { "seen": { "is": ["box"], "minConfidence": 0.3 } }, "do": [
      { "do": "highlight", "target": { "entity": { "is": ["box"] } }, "label": "maybe here", "color": "#4EC9B0", "seconds": 3 }
    ], "cooldownMs": 8000 }
  ]
}
```

Reply positions must be in the observation's `frame` (`world` here). A `seen` rule fires for beliefs too.

## 12. Robot arm body with confirm and rules

The arm's base is a thing the user can grab and line up with the real robot (`grabbable`), remembered across launches.
Every command passes the safety gate: workspace box, the user's hand within 0.25 m of the target blocks it,
2 commands/s, and `confirm: "always"` asks in the headset first. Give the user a visible stop.

```json
{
  "app": { "edge": "192.168.0.23:8765" },
  "things": [
    {
      "id": "arm-base",
      "name": "Arm base",
      "visual": { "kind": "shape", "shape": "cylinder", "size": [0.12, 0.02, 0.12], "color": "#FFB000", "opacity": 0.6 },
      "place": {
        "on": { "is": ["table"] }, "distance": [0.4, 1.2], "prefer": "center", "keep": "forever", "facing": "user",
        "fallback": [
          { "on": { "has": ["support"], "not": ["bed", "couch", "floor"] }, "distance": [0.4, 2.5], "height": [0.4, 1.0] },
          { "on": { "is": ["floor"] }, "distance": [0.6, 1.2], "visible": true }
        ]
      },
      "grabbable": true
    },
    {
      "id": "target",
      "name": "Pick target",
      "visual": { "kind": "shape", "shape": "sphere", "size": [0.04, 0.04, 0.04], "color": "#4EC9B0", "opacity": 0.8 },
      "place": {
        "on": { "has": ["support"], "not": ["bed", "couch", "floor"] }, "near": { "thing": "arm-base" },
        "fallback": [ { "near": { "thing": "arm-base" }, "around": [0.2, 0.3] } ]
      },
      "grabbable": true
    },
    {
      "id": "pad",
      "visual": {
        "kind": "panel", "size": [0.34, 0.2], "background": "#14161CE6", "padding": 18,
        "items": [
          { "type": "text", "id": "state", "text": "", "size": 26, "align": "center", "bind": "body.arm.status" },
          { "type": "row", "gap": 12, "items": [
            { "type": "button", "id": "pick", "text": "Pick", "size": 28 },
            { "type": "button", "id": "home", "text": "Home", "size": 28 },
            { "type": "button", "id": "stop", "text": "STOP", "size": 28, "background": "#B00020" }
          ] }
        ]
      },
      "place": {
        "near": { "thing": "arm-base" }, "around": [0.35, 0.6], "height": [0.7, 1.3], "avoid": ["arm-base", "target"], "visible": 50, "facing": "user",
        "fallback": [ { "near": { "user": "head" }, "around": [0.6, 0.8], "visible": true, "facing": "user" } ]
      }
    }
  ],
  "bodies": [
    {
      "id": "arm",
      "name": "Desk arm",
      "kind": "arm",
      "link": { "protocol": "layster-body", "url": "ws://{edge-host}:8766" },
      "base": { "thing": "arm-base" },
      "workspace": { "center": [0, 0.15, 0.18], "size": [0.5, 0.35, 0.36] },
      "commands": [
        { "name": "pick", "description": "Grasp what is at the target", "args": { "target": "target" }, "confirm": "always" },
        { "name": "home", "description": "Rest pose", "confirm": "never" },
        { "name": "stop", "description": "Stop immediately", "confirm": "never" }
      ],
      "safety": { "stopIfHandWithin": 0.25, "maxPerSecond": 2 },
      "twin": { "showWorkspace": true }
    }
  ],
  "rules": [
    { "id": "pick", "when": { "select": "pad.pick" }, "do": [ { "do": "command", "body": "arm", "name": "pick", "args": { "target": { "thing": "target" } } } ] },
    { "id": "home", "when": { "select": "pad.home" }, "do": [ { "do": "command", "body": "arm", "name": "home" } ] },
    { "id": "stop", "when": { "select": "pad.stop" }, "do": [ { "do": "command", "body": "arm", "name": "stop" } ] },
    { "id": "blocked", "when": { "event": "body:arm:blocked" }, "do": [ { "do": "say", "text": "Stopped for safety." } ], "cooldownMs": 2000 }
  ]
}
```

Lands: the base on a table in every furnished space (in `studio` via fallback 1 on the desk 2 m away), on the floor
0.6 m ahead in `open-floor` / `no-scan` (fallback 2); the user grabs it and lines it up with the real robot.

On the PC: `python3 python/layster/body_bridge.py --port 8766` (simulated arm). For ROS 2 use
`"link": { "protocol": "rosbridge", "url": "ws://{edge-host}:9090" }` and give **every** command
`"ros": { "topic": "/arm/pick", "type": "geometry_msgs/msg/PoseStamped" }`. To let a policy (VLA) drive it, add a
`role: "act"` mind with `observe.frame: "body:arm"` and `output.actions: ["command", "say"]` — the gate still applies.

## 13. Recording with consent

Episodes for world-model / policy training (`layster.episode/1`). Nothing is written until the user accepts the
consent text (asked every launch). Say plainly what is recorded; only add `camera` when you need it.

```json
{
  "things": [
    {
      "id": "rec-pad",
      "visual": { "kind": "panel", "size": [0.3, 0.12], "padding": 14,
        "items": [ { "type": "button", "id": "toggle", "text": "Record", "size": 32 } ] },
      "place": {
        "on": { "has": ["support"], "not": ["bed", "floor"] }, "distance": [0.3, 1.6], "height": [0.35, 1.2],
        "fallback": [ { "at": { "frame": "user", "at": [-0.25, 1.0, 0.7] } } ]
      }
    }
  ],
  "recording": {
    "enabled": true,
    "streams": ["pose", "hands", "world", "events", "actions", "minds", "camera"],
    "hz": 10,
    "camera": { "width": 320, "everyMs": 1000 },
    "maxMinutes": 20,
    "consent": { "text": "For research, this session records your head and hand positions, the room layout, what you press, what the AI decided, and one small camera picture per second. It stays on the device. OK?" }
  },
  "scripts": [
    {
      "id": "rec-toggle",
      "name": "Record button",
      "trigger": { "type": "event", "value": "rec-pad.toggle" },
      "enabled": true,
      "code": "if (world.record.active()) { world.record.stop(); ui.setText('rec-pad.toggle', 'Record'); }\nelse { world.record.start(); ui.setText('rec-pad.toggle', 'Stop'); }\n"
    }
  ]
}
```

Pass `recording` to `spatial_set_settings` (it is merged into the current settings).

## 14. Script using world.*

For logic placements, rules and minds cannot express. Here: when the user has looked away from the card for a while,
bring it back into view; count tidy-ups in a persisted store key.

```json
{
  "things": [
    {
      "id": "note",
      "visual": {
        "kind": "panel", "size": [0.32, 0.18], "padding": 16,
        "items": [
          { "type": "text", "id": "count", "text": "", "size": 30, "align": "center", "bind": "memory.tidyCount" },
          { "type": "button", "id": "tidy", "text": "I tidied up", "size": 28 }
        ]
      },
      "place": {
        "on": { "has": ["support"], "not": ["bed", "floor"] }, "distance": [0.3, 1.6], "height": [0.35, 1.2],
        "fallback": [ { "at": { "frame": "user", "at": [0, 1.0, 0.8] } } ]
      }
    }
  ],
  "memory": { "persist": ["memory."] },
  "scripts": [
    {
      "id": "note-logic",
      "name": "Note logic",
      "trigger": { "type": "onStart" },
      "enabled": true,
      "code": "var away = 0;\nworld.on('note.tidy', function () {\n  var n = (store.get('memory.tidyCount') || 0) + 1;\n  store.set('memory.tidyCount', n);\n  var desk = world.find({ is: ['table'], within: 2 });\n  if (desk) world.act({ do: 'highlight', target: { entity: { id: desk.id } }, label: 'nice', seconds: 2 });\n});\nsetInterval(function () {\n  var t = world.thing('note');\n  var u = world.user();\n  if (!t || !t.placed || !u.head) return;\n  var dx = t.at[0] - u.head.at[0], dz = t.at[2] - u.head.at[2];\n  var dot = (dx * u.head.forward[0] + dz * u.head.forward[2]) / Math.max(0.01, Math.sqrt(dx * dx + dz * dz));\n  away = dot < 0.3 ? away + 1 : 0;\n  if (away >= 10) { away = 0; world.place('note', { near: { user: 'head' }, around: [0.7, 0.9], visible: true }); }\n}, 1000);\n"
    }
  ]
}
```

`world.on(name)` receives panel button events (`<thing>.<item>`) and anything emitted. Positions from `world.*` are in
the `world` frame (x right, y up, z forward).
