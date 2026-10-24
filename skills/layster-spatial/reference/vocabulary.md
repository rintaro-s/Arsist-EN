# Layster.Spatial vocabulary, built-in spaces and the `world` script API

Sources: `src/shared/layster/spatial/vocabulary.ts`, `spaces.ts`, `scriptApi.ts`. The build copies the vocabulary
into `spatial.json`, so the device uses exactly this table. `spatial_reference` and `spatial_list_spaces` return the
live versions.

## Words

Use the canonical word (lower-case English) in `is`. Synonyms (including the Meta MRUK labels in capitals and
Japanese) are normalised to it. Words that are not in the table are allowed; they then have no affordances unless
the entity lists `has`.

| Word | Synonyms | Default affordances (`has`) | Typical size [w, h, d] m | Kind |
|---|---|---|---|---|
| `floor` | FLOOR, ground, 床 | support, walk | [4, 0, 4] | structural |
| `wall` | WALL_FACE, WALL_ART, INVISIBLE_WALL_FACE, 壁 | mount, obstacle | [3, 2.4, 0] | structural, vertical |
| `ceiling` | CEILING, 天井 | — | [4, 0, 4] | structural |
| `door` | DOOR_FRAME, 扉, ドア | obstacle | [0.9, 2.0, 0] | vertical |
| `window` | WINDOW_FRAME, 窓 | — | [1.2, 1.2, 0] | vertical |
| `table` | TABLE, テーブル, 机, counter, COUNTER | support, obstacle | [1.2, 0.72, 0.7] | |
| `desk` | デスク, 勉強机 | support, obstacle | [1.2, 0.72, 0.6] | |
| `chair` | 椅子, いす | sit, obstacle | [0.5, 0.85, 0.5] | |
| `couch` | COUCH, sofa, ソファ | sit, support, obstacle | [1.9, 0.8, 0.9] | |
| `bed` | BED, ベッド | sit, support, obstacle | [1.4, 0.5, 2.0] | |
| `shelf` | STORAGE, storage, cabinet, 棚, 本棚 | support, obstacle | [0.8, 1.2, 0.35] | |
| `screen` | SCREEN, tv, monitor, テレビ, モニター | screen, obstacle | [1.0, 0.6, 0.08] | |
| `lamp` | LAMP, ランプ, 照明 | obstacle | [0.3, 1.4, 0.3] | |
| `plant` | PLANT, 植木, 観葉植物 | obstacle | [0.4, 0.9, 0.4] | |
| `cup` | mug, コップ, カップ | grasp | [0.08, 0.1, 0.08] | |
| `bottle` | ボトル, ペットボトル | grasp | [0.07, 0.22, 0.07] | |
| `book` | notebook, 本, ノート | grasp | [0.18, 0.03, 0.25] | |
| `phone` | cell phone, スマホ | grasp, screen | [0.075, 0.01, 0.15] | |
| `laptop` | ノートパソコン, PC | screen | [0.33, 0.02, 0.23] | |
| `pen` | pencil, ペン, 鉛筆 | grasp | [0.15, 0.01, 0.01] | |
| `box` | 箱 | grasp, support | [0.3, 0.2, 0.3] | |
| `person` | human, 人 | obstacle | [0.5, 1.7, 0.3] | |
| `robot` | ロボット, arm | obstacle | [0.3, 0.4, 0.3] | |

**Broader words** — a query for the broader word also matches the narrower one (not the other way round):
`desk` → `table`; `chair`, `couch`, `bed` → `seat`; `laptop`, `phone` → `screen`.
So `"on": { "is": ["table"] }` already finds desks; `"is": ["desk", "table"]` is harmless but redundant.

**Vertical faces** — `wall`, `door`, `window` are vertical by definition. Any other entity counts as vertical when it
is a thin, tall box (depth < 5 cm, height > 0.3 m, width > 0.1 m), e.g. the classroom whiteboard (`screen`,
depth 0.03). Things placed `on` a vertical entity hang on its front face (its local +z) and take its orientation.
A TV with depth ≥ 5 cm is *not* vertical: `on` it means on top of it.

**Affordance queries worth knowing**

| You want | Query |
|---|---|
| Any surface at table height | `{ "has": ["support"] }` + `"height": [0.4, 1.3]` on the placement (otherwise the floor qualifies too) |
| A surface but not a bed, couch or the floor | `{ "has": ["support"], "not": ["bed", "couch", "floor"] }` |
| A wall | `{ "is": ["wall"] }` (or `{ "has": ["mount"] }`) |
| Something to sit on | `{ "has": ["sit"] }` or `{ "is": ["seat"] }` |
| A big enough desk | `{ "is": ["table"], "minSize": [0.6, 0.4] }` |
| Something nearby only | add `"within": 2` (horizontal metres from the user) |

## Built-in test spaces

The user stands (or sits) at the world origin facing +z in every space. `spatial_solve` defaults to the project's
`spaces.use`; new projects use `studio`, `desk-front`, `living`, `tiny`, `no-scan`.

| id | Name | Eye height | Knows | What is there |
|---|---|---|---|---|
| `studio` | Studio apartment | 1.6 | scan, hands, camera | 3.5 × 4 m room; desk (front right, ~2.2 m ahead, x 1.0) + chair; bed on the left; shelf on the right wall; TV ahead (2.55 m) |
| `desk-front` | Seated at a desk | 1.2 | scan, hands, camera | 2.6 × 1.8 m; desk 0.8 m ahead (top at 0.72 m) with a laptop and a cup; chair under the user; tall shelf on the left |
| `living` | Living room | 1.6 | scan, hands, camera | 5 × 6 m; couch behind the user, low coffee table 0.6 m ahead (top 0.4 m), TV + stand 3.75–3.95 m ahead, plant, lamp |
| `classroom` | Classroom | 1.6 | scan, hands, camera | 7 × 8 m; 12 small desks (0.6 × 0.45, top 0.7 m) in rows at x ±0.6/±1.6, z 1.0/2.2/3.4; the user stands in the aisle; whiteboard on the front wall (6 m) |
| `open-floor` | Open floor | 1.6 | scan, hands, camera | Only a 12 × 12 m floor. No furniture, no walls |
| `tiny` | Tiny room | 1.6 | scan, hands | 2 × 2.2 m; a wall 0.8 m in front; a small side table (0.45 × 0.4, top 0.55 m) at the right front |
| `no-scan` | No room data | 1.5 | — | Only a guessed floor (confidence 0.3, source `assumed`). Like a phone or XREAL without planes |

A placement that works in all seven (own rule or a sensible fallback, never `default` unless intended) works on any
device. `open-floor` and `no-scan` are the ones that break naive placements (no furniture, no walls); `tiny` breaks
placements that assume space in front; `classroom` breaks "the nearest table is the user's".

Write your own as `spaces/<id>.json` (schema: `schema.md` § SpaceFixture) and add the id to `spaces.use`.

## Script API (`world` and friends)

Spatial scripts get `world` plus these Layster.Virtual globals: `log`, timers, `store`, `storage`, `ui`, `audio`,
`camera`, `api`, `model`. Not available: `scene`, `vrm`, `viewer`, `perception`, `remote`.

| Call | Returns / does |
|---|---|
| `world.find({ is: ["table"], within: 2 })` | Nearest matching entity or `null`. Positions in `world` (m) |
| `world.entities({ has: ["support"] })` | All matching entities (array). `world.entities()` = all |
| `world.get(id)` | One entity or `null` |
| `world.believe({ id, is, at, size, confidence })` | Add/update an entity (source `script`, fades unless renewed) |
| `world.forget(id)` | Remove an entity |
| `world.user()` | `{ head: { at, forward }, feet, yaw, hands: { left, right }, gaze: { thing, entity, point } }` |
| `world.thing(id)` | `{ at, yaw, placed, visible, rule, host }` |
| `world.place(id)` / `world.place(id, placement)` | Re-solve (optionally with another placement); returns the result |
| `world.act(action)` / `world.act([a, b])` | Run actions (same vocabulary as rules and minds) |
| `world.ask("helper", { text: "…" }, function (reply) { … })` | Run a mind now; `reply = { actions, beliefs, text, ok, error }`; allowed actions run automatically |
| `world.on(name, function (e) { … })` | `"placed"`, `"fallback"`, `"seen"`, `"lost"`, `"mind"`, `"select"`, `"blocked"`, `"action:<do>"`, `"body:<id>"`, or any emitted event |
| `world.command("arm", "pick", { target: { thing: "t" } }, function (r) { … })` | Body command through the safety gate; `r = { ok, blocked, reason }` |
| `world.snapshot("user")` | The observation a mind would receive |
| `world.record.start()` / `stop()` / `mark("label")` / `active()` | Recording (asks for consent first) |
| `world.edge()` / `world.setEdge("192.168.0.23:8000")` | The PC address `{edge}` points to (kept on the device) |

Shared globals used most: `store.get(key)` / `store.set(key, value)`, `ui.setText("<thing>.<item>", text)`,
`ui.on(name, fn)`, `setTimeout` / `setInterval`, `log(msg)`, `api.request({ url, method, json }, fn)`,
`audio.play(source, { at }, fn)`. Full list: `arsist_script_reference` (Virtual) — the same entries apply.

Rules of thumb: prefer placements, rules and minds; a script is for logic they cannot express. Never assume a room
size; `world.find` may return `null` and entities may move or vanish. Callbacks arrive later on the main thread —
never busy-wait.
