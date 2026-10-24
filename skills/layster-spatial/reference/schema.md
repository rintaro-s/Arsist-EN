# Layster.Spatial schema (β 1.0.0)

Every field of `project.spatial.json`, transcribed from `src/shared/layster/spatial/types.ts` (the only source of
truth) with the defaults applied by `defaults.ts`, `solver.ts`, `observe.ts`, `lower.ts` and the runtime
(`doc/20-spatial-runtime.md`). If this file and `types.ts` ever disagree, `types.ts` wins.

Conventions: metres / degrees / seconds (milliseconds only in fields ending in `Ms`). Axes **x = right, y = up,
z = forward** (RUF, same as Unity). `yaw` is clockwise seen from above (+z turns toward +x). Vectors are arrays:
`Vec3 = [x, y, z]`, `Vec2 = [a, b]`. Ids (things, minds, bodies, rules, scripts) match `^[A-Za-z0-9_-]+$` and are
unique per list. `?` = optional.

## Contents

- [SpatialProject](#spatialproject) — the file
- [Frames, Offset, Target](#frames-offset-target)
- [Entity, EntityQuery, Affordance](#entity-entityquery-affordance)
- [Thing, ThingVisual, PanelItem](#thing)
- [Placement](#placement)
- [Action](#action)
- [Mind, Observation, MindRun](#mind)
- [Body, BodyCommand](#body)
- [Rule, When, Condition](#rule)
- [SpatialScript](#spatialscript)
- [Recording](#recording)
- [SpaceFixture](#spacefixture-spacesidjson) (`spaces/<id>.json`)
- [What the validator rejects](#what-spatial_validate-reports)

## SpatialProject

| Field | Type | Default (new project) | Notes |
|---|---|---|---|
| `layster` | `{ profile: "spatial", stage: "beta", version: "1.0.0" }` | that | Never edit. A newer version is refused |
| `id` | string | uuid | |
| `name` | string | | |
| `version` | string | `"1.0.0"` | The app's own version (yours to choose) |
| `createdAt` / `updatedAt` | ISO string | now | |
| `targetDevice` | string | `"Meta_Quest"` (tool default) | `Adapters/` folder name (`Meta_Quest`, `XREAL_One`, `Android_Phone`, …). The IR content stays device-independent |
| `app` | SpatialApp | see below | |
| `presentation` | `{ reality: "passthrough" \| "virtual-room", assumedEyeHeight?: number }` | `{ reality: "passthrough", assumedEyeHeight: 1.5 }` | `assumedEyeHeight` = head-to-floor guess when the device does not know the floor |
| `interaction` | `{ controllers: boolean, hands: boolean, gazeDwellSeconds?: number }` | `{ controllers: true, hands: true, gazeDwellSeconds: 0 }` | `0` = no dwell-to-press |
| `things` | Thing[] | one panel `hello` | |
| `minds` | Mind[] | `[]` | |
| `bodies` | Body[] | `[]` | |
| `rules` | Rule[] | `[]` | |
| `scripts` | SpatialScript[] | `[]` | |
| `memory` | `{ persist: string[] }` | `{ persist: [] }` | Store keys kept on the device across launches. `"study."` (trailing dot) = prefix, else exact key. Keys starting with `layster.` are always kept |
| `recording` | Recording | disabled, see [Recording](#recording) | |
| `spaces` | `{ use: string[] }` | `["studio", "desk-front", "living", "tiny", "no-scan"]` | Test rooms for the editor and `spatial_solve` |
| `models` | ModelDefinition[] | `[]` | Same ONNX model definitions as Layster.Virtual (doc/15, doc/16) |
| `extensions` | `Record<id, { enabled, dataVersion, settings }>` | `{}` | e.g. `"quest-room": { "enabled": true, "dataVersion": 1, "settings": {} }` fills the world with the Quest room scan |

**SpatialApp**: `packageName` (must match `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`, new projects get `com.layster.<slug>`),
`versionCode` (1), `minSdkVersion` (32 for Quest/Meta targets, else 29), `targetSdkVersion` (34),
`edge?` — default PC address `"host:port"` that `{edge}` in mind/body URLs points to (the device can override it with
`world.setEdge`, stored as `layster.edge`).

## Frames, Offset, Target

**FrameRef**

| Frame | Origin and orientation |
|---|---|
| `world` | The user's feet at app start (floor height); +z = the horizontal direction they faced. Gravity-aligned |
| `user` | The user's feet now; orientation = the head's horizontal yaw. Gravity-aligned (does not tilt) |
| `head` | Between the eyes; tilts with the head |
| `hand.left` / `hand.right` | Palm (controller grip without hand tracking) |
| `thing:<id>` | A placed thing |
| `entity:<id>` | An entity of the world state |
| `body:<id>` | A body's base (its base thing's pose) — known only at runtime, not by the editor solver |

**Offset**: `{ frame: FrameRef, at: Vec3, yaw?: number }` — `yaw` relative to the frame; when omitted the
placement's `facing` decides.

**Target** (one of):
`{ thing: "<id>" }` · `{ entity: EntityQuery }` (the one nearest to the user) · `{ frame: FrameRef, at?: Vec3 }` ·
`{ user: "head" | "feet" | "hand.left" | "hand.right" }`.

## Entity, EntityQuery, Affordance

**Entity** — everything in the world state (room scan, detections, mind beliefs, test spaces) is an oriented box.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `is` | string[] | What it is; first = primary. Words from the vocabulary (synonyms are normalised), unknown words allowed |
| `at` | Vec3 | Box centre in `world` |
| `yaw?` | number | Default 0 |
| `size` | Vec3 | `[width (local x), height (y), depth (local z)]`. Walls/vertical faces: depth ≈ 0, the room-inside is local +z. Floors: height 0 |
| `has?` | Affordance[] | Default: from the words (`vocabulary.ts`) |
| `confidence` | number 0..1 | |
| `seenAt?` | number | Seconds since app start |
| `source` | string | `scan` · `detector:<id>` · `mind:<id>` · `space` · `user` · `assumed` · `script` |
| `data?` | object | Anything |

Runtime fading: `scan`/`space`/`user`/`assumed` never fade; `detector:*` fades to 1/e in 10 s; `mind:*`/`script`
in 20 s; below 0.15 the entity is removed (`lost`).

**Affordance**: `support` (things can stand on it) · `sit` · `mount` (vertical face you can hang things on) · `walk` ·
`grasp` (hand-held) · `obstacle` · `screen`.

**EntityQuery** — all given conditions must match.

| Field | Type | Default | Notes |
|---|---|---|---|
| `id?` | string | | Exactly this entity |
| `is?` | string[] | | Any of these words (synonyms and narrower words match: `desk` matches a query for `table`; `chair`/`couch`/`bed` match `seat`; `laptop`/`phone` match `screen`) |
| `has?` | Affordance[] | | Must have all |
| `not?` | string[] | | Exclude entities matching any of these words |
| `minSize?` | Vec2 | | Top face `[width, depth]` (front face `[width, height]` for vertical) lower bound |
| `within?` | number | | Max horizontal distance from the user |
| `minConfidence?` | number | `0.2` | |

## Thing

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | | Also the Unity object id, and the prefix of panel events (`<id>.<item id>`) |
| `name?` | string | | Display name |
| `visual` | ThingVisual | | Required |
| `place` | Placement | | Required |
| `visibleAtStart?` | boolean | `true` | `false` → appears on a `show` action |
| `occlusion?` | `"auto"` \| `"off"` | `"auto"` | Hidden by real objects when the device can |
| `grabbable?` | boolean | `false` | Hands/controllers can move it |
| `tags?` | string[] | | |
| `ext?` | `Record<extensionId, object>` | | Per-thing extension options |

**ThingVisual** (`kind` decides the rest). The solver uses a box per thing (`thingSize`):

| kind | Fields | Solver box `[w, h, d]` |
|---|---|---|
| `shape` | `shape: "cube" \| "sphere" \| "cylinder" \| "capsule" \| "quad"`, `size: Vec3`, `color: "#RRGGBB[AA]"`, `opacity?` | `size` |
| `model` | `file: "Assets/Models/x.glb"` (required, .glb/.gltf), `height?` (m, scaled to it) | `[h, h, h]`, h = `height` ?? 0.3 |
| `character` | `file: "Assets/Characters/x.vrm"` (required), `animation?` (FBX name in `Assets/Animations/`), `blink?` (true), `breathe?` (true), `lookAtUser?: "off" \| "always" \| "nearby"` ("nearby"), `height?` (1.5) | `[0.3h, h, 0.2h]` |
| `panel` | `size: Vec2` [w, h] m, `items: PanelItem[]`, `ppm?` (pixels per metre, 1000 → 1 px = 1 mm), `background?` (`"#1E1E28E6"`), `padding?` (24 px) | `[w, h, 0.01]` |
| `label` | `text`, `height?` (text height m, 0.04), `color?` (`#FFFFFF`) | `[max(h, 0.6·h·chars), h, 0.01]` |
| `marker` | — (invisible reference point, e.g. a robot base) | `[0.05, 0.05, 0.05]` |

The front of every thing is its local +z. Panels/labels are readable from the front.

**PanelItem** — stacked top to bottom, sizes in pixels (`ppm` px per metre):

| type | Fields | Notes |
|---|---|---|
| `text` | `id?`, `text`, `size?` (32), `color?` (`#FFFFFF`), `align?: left \| center \| right` (left), `bind?` (store key; shows its value), `reveal?` (letters/s) | With an id: `ui.setText("<thing>.<id>", …)` |
| `button` | `id` (required), `text`, `size?` (32), `color?`, `background?` (`#3A6FD8`), `event?` | Fires `<thing>.<id>` (or `event`) plus `select` |
| `input` | `id` (required), `bind` (store key), `placeholder?`, `size?` | |
| `image` | `id?`, `file` (`Assets/Images/…`), `height` (px) | |
| `row` | `items: PanelItem[]`, `gap?` (16 px) | Side by side |
| `space` | `height` (px) | |

Panel item ids are unique inside the panel (including rows). If the items need more height than `size[1] × ppm`,
the build warns that the bottom is cut off — rough height per text/button ≈ `size × 2.2` px + 16 px gap.

## Placement

Conditions, not coordinates. Tried in order: the placement itself (rule `0`), then each `fallback` (rule `1..`),
then the **default spot** (rule `"default"`: 1.2 / 0.9 / 0.6 m in front of the user, eye height − 0.25 m, facing the
user). A thing never disappears.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `mode?` | `world` \| `body` \| `head` \| `hand` | `world` | `world` stays put; `body` follows lazily (re-solved when the user moves 1.2 m or turns 60°); `head` locked to the view; `hand` on the palm |
| `on?` | EntityQuery | | On top of a matching entity (on the front face of a vertical one). Candidates: a 10 cm grid inset by half the thing (or half the clearance). On the floor: rings around the user (`distance`, default 0.6–2.5 m) |
| `near?` | Target | | Ring of points around the target (`around`). With `on` too, `near` only sets the reference for `prefer` |
| `at?` | Offset | | Used when there is no `on`/`near`, and for `head`/`hand` modes (head default `[0, -0.1, 1.2]`, hand default `[0, 0.08, 0]`) |
| `distance?` | Vec2 | | Horizontal distance range from the user (hard) |
| `height?` | Vec2 | | Range for the **bottom** of the thing above the floor (hard). With `near` it also sets the ring height (middle of the range) |
| `facing?` | `user` \| `away` \| `surface` \| `keep` | `user` | `surface` aligns to the host's edges; things on walls always take the wall's orientation |
| `visible?` | boolean \| number | | At placement time inside the view cone: `true` = ±35°, a number = half-angle in degrees (hard) |
| `clearance?` | Vec2 | | Free `[width, depth]` on the host around the spot (hard) |
| `avoid?` | string[] | | Thing ids or entity words to keep ≥ 0.3 m away from (hard) |
| `prefer?` | `closest` \| `farthest` \| `largest` \| `center` \| `inView` | `closest` | Score among valid spots (distance to the `near` target, else to the user). Ties keep candidate order (deterministic) |
| `around?` | Vec2 | `[0.3, 1.0]` | Ring radii for `near` (10 cm steps, 15° steps starting toward the user) |
| `fallback?` | Placement[] | | Tried in order. A fallback does not inherit `mode`/`keep`; `facing` defaults to `user`. Fallbacks inside fallbacks are ignored |
| `keep?` | `none` \| `session` \| `forever` | `session` | `none` re-solves whenever the world changes; `forever` remembers the spot relative to its host across launches (world mode only) |

Always checked: not behind a room wall, not colliding with furniture or already placed things (things are solved in
dependency order), standing things (bottom < 5 cm) must be on a known floor (when the space has one); things on walls need 10 cm free in front.
Ring height for `near` without `height`: tall things (≥ 1 m, e.g. characters) stand on the floor; near `{ user: "head" }`
→ 15 cm below the eyes; otherwise the target's height.

## Action

One vocabulary for rules (`do`), mind replies and scripts (`world.act`).

| do | Fields | Runtime behaviour |
|---|---|---|
| `place` | `thing`, `place?: Placement`, `at?: Offset` | `at` → that pose (faces the user if no yaw); else re-solve with `place` or the thing's own placement |
| `move` | `thing`, `to: Target`, `speed?` | Characters walk (0.7 m/s default); other things slide. To an entity → on top of it |
| `look` | `thing`, `at: Target` | Characters turn and look; others turn toward it |
| `say` | `thing?`, `text`, `audio?` (URL or base64 WAV), `seconds?` | Sets store `say.text` / `say.thing`, cleared after `seconds` (1.2 + 0.12 × chars, max 12). If no panel binds `say.text`, a subtitle line appears |
| `animate` | `thing`, `clip`, `then?` | Character animation; `then: "stand"` returns to the relaxed stance |
| `show` / `hide` | `thing` | |
| `highlight` | `target: Target`, `label?`, `color?`, `seconds?` (5) | Wire box + small label |
| `set` | `key`, `value` | Store write (bound panel text follows) |
| `emit` | `event`, `data?` | Script event: rules `{ event }`, `run.on: "event"` minds, `world.on(name)` |
| `believe` | `entity: Partial<Entity> & { id }` | Adds/updates an entity |
| `forget` | `entity` (id) | |
| `ask` | `mind`, `text?` | Runs that mind now |
| `command` | `body`, `name`, `args?` | Through the safety gate |

Every executed action also fires the event `action:<do>`.

## Mind

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | | |
| `name?` | string | | |
| `role` | `decide` \| `converse` \| `perceive` \| `predict` \| `act` | | Shapes the openai-chat system prompt: decide = maybe do something (empty actions OK); converse = short talk; perceive = report entities as beliefs; predict = world model, beliefs with honest confidence; act = body commands, one small step at a time |
| `where` | `device` \| `edge` \| `cloud` | | Shown to the user; `cloud` + camera is a warning |
| `protocol` | `layster` \| `openai-chat` | | |
| `endpoint` | string | | `http(s)://…`; `{edge}` → the saved PC `host:port`, `{edge-host}` → host only |
| `model?` | string | | openai-chat model name (warning when missing) |
| `auth?` | `{ secret, header?, scheme? }` | header `Authorization`, scheme `Bearer` | Secret **name** only; value in `<project>/.layster/secrets.local.json`, baked into the build (logged) |
| `instructions?` | string | | openai-chat: system prompt head; layster: `goal` |
| `observe` | Observation | | Required |
| `output` | `{ actions?: ActionKind[], beliefs?: boolean, text?: string }` | | Only listed actions run (others dropped and logged). `text` = store key for the free text |
| `run` | MindRun | | Required |
| `extra?` | object | | Merged into the request body (openai-chat: e.g. `reasoning_effort: "none"`; layster: sent as `extra`) |
| `onFail?` | `{ use?: mindId, say?: string }` | | Fallback mind / subtitle on failure |

**Observation**

| Field | Type | Default | Notes |
|---|---|---|---|
| `frame?` | FrameRef | `user` | Frame for every position in the request (and expected in the reply) |
| `world?` | `{ is?, within?, max?, minConfidence? }` | omitted = no entities | Nearest first; `max` 30, `minConfidence` 0.2 |
| `things?` | boolean \| string[] | | Poses of all / these things |
| `user?` | `("head" \| "hands" \| "gaze")[]` | | |
| `camera?` | `{ width, quality? }` | | JPEG still (needs the perception camera in the build); > 1280 px warns |
| `events?` | number | | How many recent events |
| `store?` | string[] | | Store keys (`"x."` = prefix) |

**MindRun**: `on: "interval" | "change" | "event" | "manual"`, `everyMs?` (interval: required, ≥ 200; the reply's
`nextInMs` overrides), `event?` (required for `event`), `minGapMs?` (1000), `timeoutMs?` (10000). One request per mind
at a time; after a failure it waits 5 s (or `everyMs`).

Runtime store keys: `mind.<id>.status` (`thinking` / `ok` / `error: …`), `mind.<id>.text`, `mind.<id>.ms`. Event
`mind` with data `{ mind, ok, text, actions, beliefs, ms, error }`.

## Body

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | | |
| `name?` | string | | |
| `kind` | `arm` \| `mobile` \| `humanoid` \| `device` \| `other` | | |
| `link` | `{ protocol: "layster-body" \| "rosbridge", url }` | | `ws://` or `wss://`; `{edge}` / `{edge-host}` substituted |
| `base` | `{ thing }` | | A thing (usually a marker or small shape) that is the body's origin |
| `workspace` | `{ center: Vec3, size: Vec3 }` | | Box in the body frame; size > 0 |
| `commands` | BodyCommand[] | | Names unique |
| `safety?` | `{ stopIfHandWithin?, maxPerSecond? }` | `0.25` m, `2` | < 0.1 m warns |
| `twin?` | `{ showWorkspace?, file? }` | | |
| `store?` | string | `body.<id>` | Runtime writes `.connected`, `.status`, `.busy`, `.state` under it |

**BodyCommand**: `name`, `description?`, `args?: Record<name, "number" | "string" | "boolean" | "pose" | "target">`
(`pose`/`target` args are converted to `{ at, yaw, frame: "body" }` before sending), `confirm?: "never" | "always"`
(default `never`), `ros?: { topic, type }` (required for every command with `rosbridge`).

Safety gate, in order: unknown command → `unknownCommand`; target outside the workspace → `outsideWorkspace`; a hand
within `stopIfHandWithin` of the target → `handTooClose` (and a `stop` if moving); over `maxPerSecond` → `tooFrequent`;
`confirm: "always"` → OK/× in view (60 s timeout), then the gate runs again. Blocked → event `body:<id>:blocked`.

## Rule

| Field | Type | Default |
|---|---|---|
| `id` | string | |
| `name?` | string | |
| `when` | When | required |
| `if?` | Condition[] | all must hold |
| `do` | Action[] | (empty warns) |
| `cooldownMs?` | number | |
| `enabled?` | boolean | `true` |

**When** (exactly one key):
`{ start: true }` · `{ every: ms }` (≥ 100) · `{ select: "<thing>.<item>" }` (a panel button) ·
`{ gaze: thingId, seconds? }` · `{ near: thingId | "user", to: Target, within: m }` · `{ seen: EntityQuery }` ·
`{ lost: EntityQuery }` · `{ event: name }` · `{ mind: mindId }` (a reply arrived) · `{ placed: thingId }` ·
`{ fallback: thingId }` (placed by a fallback or the default spot).

**Condition**: `{ store: key, eq?, ne?, gt?, lt?, exists? }` · `{ has: EntityQuery }` (the world has one) ·
`{ not: Condition }`.

## SpatialScript

`{ id, name, trigger: { type: "onStart" | "onUpdate" | "interval" | "event", value?: ms | eventName }, code, enabled }`.
JavaScript (Jint, ES2020 without modules), all scripts share one global scope. Globals: `world` (see `vocabulary.md`
§ Script API) plus `log`, timers, `store`, `storage`, `ui`, `audio`, `camera`, `api`, `model` from Layster.Virtual.
`scene`, `vrm`, `viewer`, `perception`, `remote` are **not** available — use `world`.

## Recording

| Field | Type | Default |
|---|---|---|
| `enabled` | boolean | `false` |
| `streams` | `("pose" \| "hands" \| "world" \| "events" \| "actions" \| "minds" \| "camera")[]` | all but `camera` |
| `hz?` | number | `10` (pose/hands) |
| `camera?` | `{ width, everyMs }` | 320 px / 1000 ms when `camera` is streamed without it (warning) |
| `maxMinutes?` | number | |
| `consent` | `{ text }` | required non-empty when enabled; shown every launch, nothing is written until accepted |
| `send?` | `{ url }` | multipart POST of `meta.json` + `episode.jsonl` at the end |

Output: `<persistentDataPath>/layster/episodes/<UTC start>/` with `meta.json`, `episode.jsonl` (`{ t, kind, data }`,
format `layster.episode/1`, positions in `world`), `camera/<t>.jpg`. Scripts: `world.record.start() / stop() / mark() / active()`.

## SpaceFixture (`spaces/<id>.json`)

Your own test rooms, used by the editor and `spatial_solve` when listed in `spaces.use`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Must not clash with a built-in id |
| `name` | `{ en, ja }` | |
| `description?` | `{ en, ja }` | |
| `user` | `{ eyeHeight }` | User stands at the world origin facing +z (1.6 standing, 1.2 seated) |
| `knows` | `("scan" \| "hands" \| "camera")[]` | What the device can sense |
| `entities` | Entity[] | Furniture centres: `y = height / 2`. Walls: depth 0, yaw so local +z points into the room (front wall at +z → yaw 180, right wall → -90, left → 90, back → 0) |

## What `spatial_validate` reports

Errors stop the build: bad/duplicate ids; header not spatial or newer; references to missing things/minds/bodies
(in `near`, frames `thing:`/`body:`, actions, `when`, `onFail.use`, `base.thing`); a thing placed near/relative to
itself; unknown affordance; ranges not `[min, max]`; model/character without `file`; panel `button`/`input` without
`id` or duplicate item ids; unknown action kinds; `command` naming an unknown body/command; mind endpoint missing or
not http(s); `interval` without `everyMs ≥ 200`; `event` run without `event`; `every < 100`; body link not ws(s);
workspace size ≤ 0; duplicate command names; rosbridge command without `ros`; recording enabled without consent text;
bad `app.packageName`.

Warnings: head/hand mode without `at`; world placement without `on`/`near`/`at`; `keep: forever` outside world mode;
nested fallbacks; openai-chat without `model`; camera > 1280 px or sent to a cloud mind; `stopIfHandWithin` < 0.1;
rule with no actions; camera stream without camera settings; no things.

The build (`lower.ts`) additionally fails when a mind's `auth.secret` has no value, and warns when panel items overflow.
