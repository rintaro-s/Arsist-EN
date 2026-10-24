# Layster.Virtual IR — files, shapes, direct edits

Source of truth: `src/shared/types.ts` (`ArsistProject`, `SceneObject`, `UILayoutData`, `UIElement`, `ScriptData`).
Script globals: `src/shared/scriptApi.ts` (= `arsist_script_reference`).

## Files in a project folder

| File | Holds |
|---|---|
| `project.json` | Everything: `layster` header, `irVersion` (6), `name`, `version` (the app's), `appType`, `targetDevice`, `arSettings`, `designSystem`, `dataFlow { dataSources, transforms }`, `scenes[]`, `uiLayouts[]`, `buildSettings`, `scripts[]` (code inline), `models[]`, `extensions{}`, `storage { persist }`, `perception` |
| `Scenes/<id>.json` | One scene (copy of the entry in `scenes[]`) |
| `UI/<id>.json` | One UI layout (copy of the entry in `uiLayouts[]`) |
| `Assets/Models/`, `Assets/Animations/<name>.fbx`, … | Imported files (use the import tools so names are right) |
| `Backups/` | Upgrade and assistant backups — do not edit |

Never change `irVersion` or `layster` by hand. A project with an older `irVersion` must be upgraded by the user first.

## Coordinates

Metres; origin = the head at app start; **+Z ahead, +Y up, +X = the user's LEFT**; rotation in Euler degrees, all
zeros = facing the user. Standing users: the floor is ≈ 1.5–1.6 m below the origin (`y: -1.5` puts a character's feet
on the floor). Typical spots: panel ahead `{ x: 0, y: -0.1, z: 1.5 }`; to the user's right `{ x: -0.6, … }`.

## Scene objects

`type`: `primitive` (`primitiveType` cube | sphere | plane | cylinder | capsule, `material.color`), `model`
(`modelPath` .glb/.gltf), `vrm` (`modelPath` .vrm, optional `character`), `light`, `camera`, `empty`, `canvas`
(`canvasSettings { layoutId, widthMeters, heightMeters, pixelsPerUnit }`). Common: `id`, `name`, `assetId` (script
handle; keep unique), `transform { position, rotation, scale }` (objects `{ x, y, z }`), `children`, `ext { <extension id>: {…} }`.

`character` (VRM only): `{ animation?: "<Assets/Animations name>", blink?: true, breathe?: true, lookAtUser?: "off" | "always" | "nearby" }`.

A complete scene as it may appear in `scenes[]` or `Scenes/<id>.json` (no field needs filling in):

```json
{
  "id": "main",
  "name": "Main",
  "objects": [
    {
      "id": "obj-marker", "name": "Marker", "type": "primitive", "primitiveType": "cube", "assetId": "marker",
      "transform": { "position": { "x": -0.3, "y": -0.2, "z": 1.5 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.1, "y": 0.1, "z": 0.1 } },
      "material": { "color": "#4EC9B0", "metallic": 0, "roughness": 0.5 }
    },
    {
      "id": "obj-guide", "name": "Guide", "type": "vrm", "modelPath": "Assets/Models/guide_1a2b3c4d.vrm", "assetId": "guide",
      "transform": { "position": { "x": 0.8, "y": -1.5, "z": 2.0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1, "y": 1, "z": 1 } },
      "character": { "animation": "Idle", "blink": true, "breathe": true, "lookAtUser": "nearby" }
    },
    {
      "id": "obj-quiz", "name": "Quiz panel", "type": "canvas", "assetId": "quiz",
      "canvasSettings": { "layoutId": "layout-quiz", "widthMeters": 0.8, "heightMeters": 0.5, "pixelsPerUnit": 1200 },
      "transform": { "position": { "x": 0, "y": -0.1, "z": 1.5 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1, "y": 1, "z": 1 } }
    }
  ]
}
```

## UI layouts

`{ id, name, scope: "uhd" | "canvas", resolution: { width, height }, root: UIElement }`. For a canvas, the resolution
should equal `widthMeters × pixelsPerUnit` by `heightMeters × pixelsPerUnit` (0.8 m × 1200 = 960 px).

UIElement: `{ id, type, content?, assetPath?, bindingId?, bind?: { key, format? }, layout?: "FlexRow" | "FlexColumn" | "Absolute", style, children, reveal?: { speed } }`.
Types: Panel, Text, Button, Image, Slider, Input, Gauge, Graph, Keyboard. `bindingId` names the element for scripts
(`ui.setText(bindingId, …)`) and events (a Button fires its `bindingId`; an Input fires `<bindingId>:submit`).
`bind.key` shows a store value; `bind.format` is a template with `{value}` (`"Score: {value}"`) or a .NET number format (`"0.0"`). Style keys: `width`, `height`, `margin`/`padding` (`{ top, right, bottom, left }`),
`flexDirection`, `justifyContent`, `alignItems`, `gap`, `backgroundColor`, `color`, `borderRadius`, `borderWidth`,
`borderColor`, `opacity`, `fontSize`, `fontWeight`, `textAlign`, `position`, `top`/`right`/`bottom`/`left`.

```json
{
  "id": "layout-quiz",
  "name": "Quiz",
  "scope": "canvas",
  "resolution": { "width": 960, "height": 600 },
  "root": {
    "id": "quiz-root", "type": "Panel", "layout": "FlexColumn",
    "style": { "backgroundColor": "#1E1E28E6", "padding": { "top": 32, "right": 32, "bottom": 32, "left": 32 }, "gap": 24, "borderRadius": 24 },
    "children": [
      { "id": "quiz-q", "type": "Text", "content": "What is 7 × 8?", "bindingId": "question", "style": { "fontSize": 48, "color": "#FFFFFF", "textAlign": "center" }, "children": [], "reveal": { "speed": 20 } },
      { "id": "quiz-score", "type": "Text", "content": "", "bind": { "key": "quiz.score", "format": "Score: {value}" }, "style": { "fontSize": 32, "color": "#BBBBBB" }, "children": [] },
      { "id": "quiz-btn", "type": "Button", "content": "Answer", "bindingId": "answer_btn", "style": { "fontSize": 36, "backgroundColor": "#3A6FD8", "borderRadius": 12 }, "children": [] }
    ]
  }
}
```

## Scripts

`{ id, name, trigger: { type: "onStart" | "onUpdate" | "interval" | "event", value? }, code, enabled, description?, createdAt, updatedAt }`
in `project.json` `scripts[]`. Use `ir_add_script` / `ir_update_script` (they validate the trigger and the syntax and
fill the timestamps). Example (trigger `{ "type": "event", "value": "answer_btn" }`):

```javascript
// The Button with bindingId "answer_btn" fires this script.
var score = (store.get('quiz.score') || 0) + 1;
store.set('quiz.score', score);            // the Text bound to quiz.score updates itself
ui.setText('question', 'Correct! Next one…');
scene.faceUser('guide', 0.5);
vrm.playAnimation('guide', 'Clap', { then: 'stand' });
setTimeout(function () { ui.setText('question', 'What is 6 × 9?'); }, 1500);
```

Most-used globals (full list: `arsist_script_reference`): `store.get/set`, `ui.setText/setVisibility/on`,
`scene.setPosition/moveTo/faceUser/setVisible`, `viewer.pose/placeInFront`, `vrm.playAnimation/walkTo/lookAt/setExpression (0..100)`,
`audio.play`, `api.request`, `model.generate/embed`, `camera.capture`, `storage.save`, timers, `log`.

## Direct edits — rules

1. Keep the file valid JSON; while it is not, the editor keeps the last good version and shows where the error is.
2. Do not edit `irVersion`, `layster`, `Backups/`.
3. A scene/layout lives in `project.json` **and** in `Scenes/` / `UI/`: edit one copy; the editor (or the next tool
   call) copies the changed one over the other. Do not edit both differently.
4. Give every new object/element a unique `id`; keep `assetId` / `bindingId` unique.
5. Run `ir_validate_project` afterwards; any `files: … filled in …` line means you left a field out.
