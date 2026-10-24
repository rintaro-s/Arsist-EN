---
name: layster-virtual
description: Build or modify a Layster.Virtual app in Arsist — a project.json AR/VR app made of scenes (primitives, GLB models, VRM characters, UI canvases at fixed coordinates), UI layouts, JavaScript scripts, data flow, extensions and device storage — through the arsist MCP ir_* tools or by editing project.json / Scenes/ / UI/ directly. Use when the user works on a folder with project.json, asks to add objects, panels, HUDs, characters or scripts to an Arsist project, or you are about to call ir_* tools. Not for project.spatial.json (use layster-spatial).
---

# Layster.Virtual

Layster is Arsist's IR. **Layster.Virtual** (`project.json`, internally `irVersion` 6 = "Layster.Virtual β 1.0.0";
1–5 were α1–α5) describes screens and coordinates: scenes with objects at fixed positions, UI layouts, scripts. It is
**not compatible** with Layster.Spatial (`project.spatial.json`); never convert between them and never use `spatial_*`
tools on it. Name versions only as the tools report them ("Layster.Virtual β 1.0.0", never "IR v6").

Reference: [reference/ir.md](reference/ir.md) — `project.json` layout, scene objects, UI elements, scripts, the
direct-edit rules, with validated examples. Live references from the MCP server: `arsist_script_reference` (every
script global incl. installed extensions + IR essentials). Docs: `doc/09-mcp-server.md`, `doc/18-characters-voice-memory.md`,
`doc/17-extensions.md`; types: `src/shared/types.ts`; script API source: `src/shared/scriptApi.ts`.

## Coordinates (the classic trap)

Tool and IR coordinates are metres with the origin at the user's head at app start: **+Z ahead, +Y up, +X = the
user's LEFT**. Rotation = Euler degrees; `{ x: 0, y: 0, z: 0 }` faces the user. A panel 1.8 m ahead at eye level:
`{ "x": 0, "y": 0, "z": 1.8 }`; something to the user's right has **negative** x. (Layster.Spatial uses +X = right —
do not carry numbers across.)

## Workflow

`projectPath` is optional on every tool once a project is open.

1. **Open** and check the format:

   ```json
   { "tool": "arsist_open_project", "args": { "projectPath": "/home/me/ArsistProjects/Quiz" } }
   ```

   - Layster.Spatial → stop, use the `layster-spatial` skill.
   - **Older version (α1–α5)**: the tools refuse to write. Ask the user to open it in the editor and accept the
     upgrade (or, only with their explicit OK, `npm run build:main && node scripts/layster-upgrade.mjs <dir>`, which
     backs up `project.json` first; `--dry-run` shows the changes). Never edit `irVersion` or the `layster` header and
     never rewrite an old project silently.
   - **Newer** than this Arsist → do not touch it.
   - New projects are created in the editor (New Project); there is no tool for it.
2. **Read** `arsist_script_reference` before scripts or placement, then `ir_get_project`.
3. **Device**: `ir_list_devices` (with capability tags) → `ir_set_target_device` `{ "device": "Meta_Quest" }`.
   AR look: `ir_update_ar_settings` (`backgroundMode` passthrough | skybox | solidColor, `interaction`
   `{ controllerRay, handTracking }` — never both false).
4. **Scene objects**:

   ```json
   { "tool": "ir_add_primitive", "args": { "primitiveType": "cube", "name": "Marker", "assetId": "marker", "color": "#4EC9B0", "position": { "x": -0.3, "y": -0.2, "z": 1.5 }, "scale": { "x": 0.1, "y": 0.1, "z": 0.1 } } }
   ```

   Models/characters: `ir_import_model_asset` `{ sourcePath }` (.glb/.gltf/.vrm, copied to `Assets/Models/` with a
   hash suffix) → `ir_place_model` `{ modelAssetPath, name, assetId, position, rotation, scale }`. A `.vrm` becomes a
   character (blinks, breathes, looks at the user nearby). Animations: `ir_import_animation` `{ sourcePath, name? }`
   (humanoid FBX → `Assets/Animations/<name>.fbx`, no hash; the name is what scripts and `character.animation` use),
   `ir_list_animations`, then:

   ```json
   { "tool": "ir_place_model", "args": { "modelAssetPath": "Assets/Models/guide_1a2b3c4d.vrm", "name": "Guide", "assetId": "guide", "position": { "x": 0.8, "y": -1.5, "z": 2.0 } } }
   ```

   ```json
   { "tool": "ir_update_object", "args": { "objectId": "guide", "character": { "animation": "Idle", "lookAtUser": "always" } } }
   ```

   Move/rotate/scale: `ir_update_object_transform` (partial vectors merge). Remove: `ir_remove_scene_object`.
   `assetId` is how scripts address an object.
5. **UI**: a layout is `uhd` (fixed to the view, HUD) or `canvas` (a panel in space shown by a canvas object).

   ```json
   { "tool": "ir_add_ui_layout", "args": { "name": "Quiz", "scope": "canvas" } }
   ```

   ```json
   { "tool": "ir_add_ui_element", "args": { "layoutId": "Quiz", "type": "Text", "content": "What is 7 × 8?", "bindingId": "question", "style": { "fontSize": 48, "color": "#FFFFFF" }, "reveal": { "speed": 20 } } }
   ```

   ```json
   { "tool": "ir_add_ui_element", "args": { "layoutId": "Quiz", "type": "Button", "content": "Answer", "bindingId": "answer_btn", "style": { "fontSize": 36 } } }
   ```

   ```json
   { "tool": "ir_add_canvas_object", "args": { "layoutId": "Quiz", "name": "Quiz panel", "widthMeters": 0.8, "heightMeters": 0.5, "pixelsPerUnit": 1200, "position": { "x": 0, "y": -0.1, "z": 1.5 } } }
   ```

   Match the layout's `resolution` to the panel (`ir_update_ui_layout` `{ layoutId, resolution: { width: widthMeters × pixelsPerUnit, height: … } }`).
   Show store values with `bind: { key }` instead of setting text in a loop. Elements: Panel, Text, Button, Image,
   Slider, Input, Gauge, Graph, Keyboard; nest with `parentElementId`; `layout` FlexRow | FlexColumn | Absolute.
6. **Scripts** (JavaScript on the device, Jint, ES2020 without modules, one shared global scope). Check, then add:

   ```json
   { "tool": "ir_add_script", "args": { "name": "Quiz logic", "trigger": { "type": "event", "value": "answer_btn" }, "code": "store.set('quiz.answer', '56');\nui.setText('question', 'Correct: 56');\nscene.faceUser('marker', 0.5);\n" } }
   ```

   Triggers: `onStart`, `onUpdate` (cheap only), `interval` (`value` ms), `event` (`value` = name; a Button/Input with
   `bindingId` "x" fires "x", Input confirm fires "x:submit", extensions fire "<id>:<what>", "app:pause"/"app:resume").
   `ir_check_script` `{ code }` checks syntax without saving; add/update refuse syntax errors.
7. **Device storage**: `ir_set_storage` `{ "persist": ["memory.", "user.name"] }` ("x." = prefix). Everything else in
   the store starts empty each launch.
8. **Extensions**: `ir_list_extensions` → `ir_set_extension` `{ id, enabled, settings }`, per object
   `ir_set_object_extension` `{ objectId, extensionId, values }`. Values are checked against the extension's
   `extension.json`. An extension only runs on devices whose tags satisfy its `requires`.
9. **Validate**: `ir_validate_project` — missing extensions/device, features the device cannot do, canvases without a
   layout, script syntax errors, duplicate assetIds, unknown animation names, and what the loader filled in.
10. **Build** in the editor (Build). Unity, `sdk/` and a device are usually not available to an agent — report what
    was not built/tested instead of guessing.

## Rules

- **Writes go through the tools or careful direct edits.** The tools write atomically through
  `src/main/project/projectIO.ts` (one writer per project, refuse other IR versions); the open editor reloads within
  ~0.5 s. Direct edits are fine (see reference/ir.md): keep JSON valid, keep `irVersion` and `layster` untouched.
- **Scenes and UI layouts exist twice**: inside `project.json` (`scenes[]`, `uiLayouts[]`) and as `Scenes/<id>.json`,
  `UI/<id>.json`. Edit either copy; the editor uses the one that changed and writes it into the other. Editing both
  differently → the per-file copy wins. A `Scenes/` file whose id is not listed in `project.json` is ignored.
- Missing fields are filled in (`src/shared/irRepair.ts`) rather than crashing; `ir_validate_project` lists them —
  treat any fill-in note as a bug in what you wrote.
- Characters: a VRM without `character` stands still in a relaxed pose (never a T-pose). VRM expressions take 0..100.
  The engine loads VRM 0.x; VRM 1.0 needs the official `vrm10` extension (`ir_set_extension` `{ "id": "vrm10", "enabled": true }`).
- Scripts: prefer `bind` + `store.set` over `ui.setText` loops; callbacks arrive later on the main thread, never
  busy-wait, one call may run ≤ 5 s; a missing extension global is a harmless stand-in.
- New features belong in extensions, not in the engine; device logic belongs in adapters (`CLAUDE.md`).
- UI text inside the *editor* (not the app) is out of scope here; app content may be any language.
