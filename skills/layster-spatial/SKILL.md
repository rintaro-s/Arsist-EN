---
name: layster-spatial
description: Build or change a Layster.Spatial app in Arsist — a project.spatial.json MR app whose things are placed by conditions (on a desk, near the user, on a wall) in rooms the author never sees, with AI minds (LLM/VLM/world model/VLA over openai-chat or layster.mind/1), robot bodies behind a safety gate, rules, world.* scripts and recording. Use when the user asks to create/edit a Spatial project, place things "in any room", connect an AI or robot to a space, or when a folder contains project.spatial.json or you are about to call spatial_* tools. Not for project.json (Layster.Virtual) projects.
---

# Layster.Spatial

Layster is Arsist's IR. **Layster.Spatial** (`project.spatial.json`) describes *space*: what the app shows, where it
should go in terms of the room (conditions + fallbacks), which AI minds see and do what, which robots it drives.
The engine solves placements in the real room at runtime with the same solver you can run now (`spatial_solve`).
It is **not compatible** with Layster.Virtual (`project.json`) — never convert between them, never mix tools
(`ir_*` are Virtual only).

Reference files (read when needed):
- [reference/schema.md](reference/schema.md) — every field, type and default; what the validator rejects
- [reference/recipes.md](reference/recipes.md) — validated copy-paste patterns (panels, HUD, characters, walls, minds, robot arm, recording, scripts)
- [reference/vocabulary.md](reference/vocabulary.md) — entity words, synonyms, affordances, the 7 built-in test spaces, the `world.*` script API

Source of truth if anything here looks stale: `src/shared/layster/spatial/types.ts` (+ `doc/19-layster.md`,
`doc/20-spatial-runtime.md`). `spatial_reference` returns the live summary.

## Workflow

Tools come from the Arsist MCP server (`arsist`; see `doc/09-mcp-server.md`). Every tool takes an optional
`projectPath`; after `spatial_create_project` or `arsist_open_project` it can be omitted.
Without MCP, call the same tools from a shell: `node scripts/arsist.mjs tool spatial_solve '{}' --project <dir> --json`
(also `arsist validate|solve|lower <dir>`; `doc/21-cli.md`). Each call is a new session, so always pass the folder.

1. **Open or create.** Existing folder: `arsist_open_project` (it reports whether the folder is Virtual or Spatial).
   New:

   ```json
   { "tool": "spatial_create_project", "args": { "parentDir": "/home/me/LaysterApps", "name": "Desk Buddy", "targetDevice": "Meta_Quest" } }
   ```

   The new project already has one panel `hello` (on a support surface, fallback in front of the user). Replace or
   remove it (`spatial_remove` with `kind` + `id`).
2. **Read the reference once:** `spatial_reference` (no args). Then `spatial_get_project` for the summary and
   `spatial_get` (`kind`: thing | mind | body | rule | script | settings, plus `id`) for full JSON of one item.
3. **Add things.** One call per item; the whole item is passed and replaces the one with the same id. The result lists
   that item's problems.

   ```json
   { "tool": "spatial_set_thing", "args": { "thing": {
     "id": "card",
     "visual": { "kind": "panel", "size": [0.38, 0.24], "padding": 20, "items": [
       { "type": "text", "id": "title", "text": "Hello, space", "size": 40, "align": "center" },
       { "type": "button", "id": "ok", "text": "OK", "size": 32 } ] },
     "place": {
       "on": { "is": ["table"] }, "distance": [0.3, 1.4], "clearance": [0.4, 0.3], "facing": "user",
       "fallback": [
         { "on": { "has": ["support"], "not": ["bed", "floor"] }, "distance": [0.3, 1.8], "height": [0.35, 1.2] },
         { "at": { "frame": "user", "at": [0, 1.0, 0.8] } } ] } } } }
   ```

4. **Add minds, bodies, rules, scripts** the same way: `spatial_set_mind` `{ "mind": … }`, `spatial_set_body`
   `{ "body": … }`, `spatial_set_rule` `{ "rule": … }`, `spatial_set_script` `{ "script": … }`. Add a body's base
   thing before the body, and things/minds before the rules that name them. Settings (`app`, `presentation`,
   `interaction`, `recording`, `memory`, `spaces`, `targetDevice`, `name`, `version`) go through
   `spatial_set_settings`; objects are merged into the current ones:

   ```json
   { "tool": "spatial_set_rule", "args": { "rule": { "id": "card-ok", "when": { "select": "card.ok" }, "do": [ { "do": "hide", "thing": "card" } ] } } }
   ```

   ```json
   { "tool": "spatial_set_settings", "args": { "app": { "edge": "192.168.0.23:11434" }, "spaces": { "use": ["studio", "desk-front", "living", "classroom", "open-floor", "tiny", "no-scan"] } } }
   ```

5. **Validate:** `spatial_validate` → `{ ok, errors, warnings }`. Errors stop the build; fix all of them and read
   every warning.
6. **Solve across rooms and iterate.** This is the step that makes the app work in rooms you have never seen:

   ```json
   { "tool": "spatial_solve", "args": { "spaces": ["studio", "desk-front", "living", "classroom", "open-floor", "tiny", "no-scan"], "things": ["card"] } }
   ```

   Per thing and space you get `rule` (0 = its own conditions, 1.. = that fallback, `"default"` = nothing fit, put
   in front of the user), `host` (the entity it stands on/hangs on), `at` (world metres: x right, y up, z forward,
   user at the origin facing +z) and `notes` (why each rule failed: `distance ×27`, `nothing matches …`, `wall`,
   `collision`, `visible`, `clearance`, `avoid`, `floor`, `height`). Adjust conditions and fallbacks until every
   thing lands somewhere sensible in **every** space — at minimum `open-floor`, `no-scan` and `tiny`, which break
   naive placements. `"default"` should be rare and deliberate. `spatial_list_spaces` lists the spaces; add your own
   as `spaces/<id>.json` (schema.md § SpaceFixture).
7. **Try minds** in the editor: bottom panel → **Mind I/O** shows the exact observation / system prompt / HTTP body
   for the selected space; **Try** sends it (keys stay in the main process) and shows the actions the device would run.
   For writing a mind server see the `layster-mind-server` skill.
8. **Build.**
   - Check what the device will get without Unity: `npm run build:main`, then
     `node scripts/layster-build.mjs <project dir> --lower-only --out <dir>` → `manifest.json`, `scenes.json`,
     `ui_layouts.json`, `scripts.json`, `spatial.json` (validation errors and lowering warnings such as panel overflow
     are printed).
   - APK: the editor's Build button, or `node scripts/layster-build.mjs <project dir> [--device Meta_Quest] [--out <dir>]`
     (needs Unity, the `sdk/` folder and the editor's configured paths; usually not available to an agent — say so
     instead of guessing).

Editing `project.spatial.json` by hand is allowed (the open editor reloads it); keep it valid JSON, never touch the
`layster` header, and run `spatial_validate` + `spatial_solve` afterwards. The tools are safer: atomic writes, one
writer at a time, and they refuse files from a newer Arsist.

## Decision rules

**Placement**
- Describe *where* with conditions — `on` (`is` words or `has` affordances), `near` (thing / entity / user / frame
  point), `distance`, `height`, `visible`, `clearance`, `avoid`. Never place by world coordinates: the room is unknown.
  An `at` in the `user` or `head` frame is fine as the **last** fallback.
- **Always end the fallback chain somewhere sensible** — usually `{ "at": { "frame": "user", "at": [x, ~1.0, 0.7–0.9] } }`
  for panels or a ring around the user for characters. One level of fallbacks only (nested ones are ignored).
- `{ "has": ["support"] }` also matches the floor and beds: add `"height": [0.35, 1.2]` and/or `"not": ["bed", "floor"]`.
- **Do not block the view.** Characters stand diagonally (front-left/right) and at least ~0.8 m away
  (`distance`), never straight ahead at face distance. HUDs (`mode: "head"`) stay small and below the line of sight
  (`at: [0, -0.3, 1.5]`). Use `mode: "body"` for menus that should follow without being glued to the head.
- Characters are tall (≥ 1 m) so a `near` ring stands them on the floor; give them `"facing": "user"`.
- Bound things to each other with `near: { "thing": … }` + `avoid`; things are solved in dependency order.
- `keep: "forever"` only for things the user expects to find again (a desk card, a robot base); `keep: "none"` for
  labels that should track moving entities. Add `"grabbable": true` when the user should be able to move it by hand
  (the released spot becomes its place and, with `forever`, is remembered); listen with `{ "event": "released:<id>" }`.
- `occlusion` stays `auto` (hidden behind real furniture when the room is scanned); use `"off"` only for things that must
  stay visible through walls (a guide arrow).
- Animation names (`animation`, `animate.clip`) must be files `Assets/Animations/<name>.fbx`; `spatial_validate` warns otherwise.
- Panels: estimate height (≈ `size × 2.2` px + 16 px gap per text/button line at `ppm` 1000 = px per metre); the
  lowering step warns when items overflow.

**Minds**
- Allow the minimum actions in `output.actions` (`say`, `highlight` for a chat helper; `command` only for an `act`
  mind driving a body). Anything else the model returns is dropped and logged.
- Prefer `run.on: "manual"` (asked by a rule/button) or `"event"`; `interval` only for world models/policies, with
  `everyMs ≥ 200` and a realistic `timeoutMs`.
- Observe only what is needed (`world.within` / `max`, specific `things`, `store` keys). Camera images are costly
  and private; never send them to `where: "cloud"` without the user knowing.
- Thinking models over openai-chat (Qwen3 family, …): `"extra": { "reasoning_effort": "none" }`, otherwise they may
  spend the token budget thinking and return nothing.
- Give every mind an `onFail` (`say` a short message or `use` a fallback mind).
- **Secrets by name only:** `"auth": { "secret": "GROQ_API_KEY" }`. The value lives in
  `<project>/.layster/secrets.local.json` (git-ignored; the editor's Mind panel writes it) and is baked into the APK
  (the build logs it). Never put a key in `project.spatial.json`, `extra`, the endpoint URL or a script.
- `{edge}` in an endpoint = the PC `host:port` (`app.edge` default, changeable on the device); `{edge-host}` = host only.

**Bodies (robots)**
- Base = a thing (marker or small shape), usually `grabbable` + `keep: "forever"` so the user can align it with the
  real robot. The workspace box is in the body frame and should be tight.
- Every motion command that could touch something: `"confirm": "always"`. Keep `stopIfHandWithin` ≥ 0.25 m and
  `maxPerSecond` ≤ 2 unless the user insists. Always offer a visible stop (`confirm: "never"` `stop` command bound to
  a big button) and react to `body:<id>:blocked`.
- The gate runs on the device; the robot side must still enforce its own joint/speed limits.

**Behaviour**
- Prefer rules (`when` → `if` → `do`) over scripts; scripts for logic rules cannot express. Panel buttons fire
  `<thing>.<item>`; `ui.setText("<thing>.<item>", …)` changes a text item with an id; bound items (`bind`) follow the
  store.
- Recording: enable only with an honest consent text that names every stream; add `camera` only when needed.
- Keep the engine general: never ask for app-specific engine features; express the app in the IR.

## Checklist before saying "done"

- `spatial_validate` → `ok: true`, warnings read and either fixed or explained.
- `spatial_solve` over all spaces in `spaces.use` (ideally all seven built-ins): no thing at `"default"` unless
  intended, nothing inside the user's face, characters not straight ahead.
- Every referenced file exists (`Assets/Characters/*.vrm`, `Assets/Models/*.glb`, `Assets/Animations/<name>.fbx`).
  The Spatial tools do not copy files: import in the editor, or copy the file yourself into `Assets/Models`
  (.glb/.gltf), `Assets/Characters` (.vrm), `Assets/Images` (.png/.jpg), `Assets/Audio` (.wav/.mp3/.ogg) or
  `Assets/Animations` (.fbx — the file name is the animation name; no hash suffix).
- Minds: endpoint reachable (Mind I/O → Try) or clearly reported as untested; secret names listed for the user to fill.
- If the project is in `samples/spatial/`: `npm test` (the samples test re-solves every sample).
- **Check your work visually**: `arsist sim <project dir> --out <dir> --times 0,3` (or
  `node scripts/sim/preview.mjs …`, after `npm run build:renderer`) writes one first-person PNG per space and time at
  the device's FOV, plus `result.json` with the placements. Open a few PNGs: panels readable at that distance, nothing
  covering the user's view, the character not blocking the panel. `--overlays` adds rule colours and solver notes,
  `--view overview` the Space Lab angle. It is approximate (no minds, select/gaze not run; doc/22); `--engine unity`
  runs the real runtime when Unity is available.
