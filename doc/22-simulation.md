# 22. Simulation (`doc/22-simulation.md`)

Two simulators turn a project into PNGs of "what the user would see on the headset", without a device. Both take
the same arguments (the `arsist sim` CLI passes them through, doc/21) and write `<out>/result.json`.

| | Preview (`scripts/sim/preview.mjs`, `arsist sim --engine preview`, default) | Unity (`scripts/sim/unity.mjs`, `--engine unity`) |
|---|---|---|
| What runs | the editor's own 3D components in a hidden Electron page | the real Arsist runtime as a Linux player |
| Speed | ~0.3–2 s per image (VRM loading dominates) | minutes for the first build, ~10 s per run after |
| Needs | `npm run build:renderer`, Electron (node_modules), a display or `xvfb-run` | Unity + Linux Build Support, `xvfb-run` |
| Truth | **approximate** — every image says so in its corner | the engine itself |

Use the preview while iterating (layout, placement in every test space, text size at the device FOV), and the Unity
simulator before you trust behaviour (scripts, minds, the real UI renderer).

## Preview simulator (`scripts/sim/preview.mjs`)

`src/renderer/sim/` (page `sim.html`, a second Vite input) ・ `scripts/sim/{preview.mjs,electron-main.cjs,args.mjs}`

```bash
npm run build:renderer                    # once; the page is part of the renderer build
node scripts/sim/preview.mjs samples/spatial/desk-buddy --out tmp/sim/desk --times 0,2,5
node scripts/sim/preview.mjs samples/spatial/robot-helper --out tmp/sim/robot --space desk-front --view overview --overlays
node scripts/sim/preview.mjs tmp/Cohabit --out tmp/sim/cohabit --device XREAL_One
```

| Option | Meaning |
|---|---|
| `<project dir>` | folder with `project.spatial.json` (Spatial) or `project.json` (Virtual) |
| `--out <dir>` | where the PNGs and `result.json` go (required) |
| `--space <id>[,id…] \| all` | Spatial: test spaces (built-in `spaces.ts` or the project's `spaces/<id>.json`). Default / `all` = `spaces.use` |
| `--scene <id\|name>[,…] \| all` | Virtual: scenes. Default: the first scene |
| `--device <adapter>` | adapter folder (`Adapters/`, `Extensions/*/Adapters/`) whose `display.fieldOfView` sets the view. Default: the project's `targetDevice`. Quest's per-model `display.quest3` is used first |
| `--times 0,2,5` | Spatial: one image per time (seconds after start). Virtual is static (t=0 only) |
| `--width/--height` | image size (default 1280×720). The device's aspect is letterboxed inside it (black = outside the display) |
| `--view first-person\|overview` | the user's eyes (default) or the Space Lab's angle from above (Spatial only) |
| `--overlays` | entity / thing name tags, the placement table (rule colour, host, solver notes), what the time model skipped |
| `--lang en\|ja` | language of entity names in overlays (default `en`) |
| `--timeout <sec>` | kill Electron after this long (default 90) |
| `--json` | print `result.json` on stdout instead of a summary |

Files: `<space>-t<sec>.png` (Spatial; `<space>-overview-t<sec>.png` with `--view overview`), `<scene name>-t0.png` (Virtual).
`result.json`: `ok`, `simulator: "preview"`, `approximate: true`, `kind`, `device`, `fov`, `files[]` (`file`, `space` /
`scene`, `t`, `ms`), Spatial `placements[space][]` (`thing`, `mode`, `frame`, `rule` 0 / n / `"default"`, world `at` / `yaw`,
`host`, `notes`, `visible`) and `timeline[space][t]` (`log` of rule actions, `skipped`, `store`), `warnings`, `errors`,
`console` (renderer errors). Exit code 0 = every image written, 1 = some failed, 2 = bad arguments / missing build.

What is drawn:

- **Spatial** — the camera is the test space's user (world origin, eye height, facing +Z) with the device's vertical FOV.
  The space's entities are the stand-in for passthrough (Space Lab's `EntityBoxes`), things are drawn at the pose
  `solver.ts` gives (the device's calculation) with Space Lab's `ThingMeshes` (panels/labels as canvas textures, characters
  as a capsule with a nose, models as a wire box), head-mode things in front of the eyes, bodies' workspaces,
  `highlight` boxes. The outline colour of each thing is the placement rule that won (green intended, yellow fallback,
  red default).
- **Time model (approximate, `spatialTimeline.ts`)** — triggers `start`, `placed`, `fallback` (all at t=0), `every`, and
  `event` from `emit`; actions `say` (`say.text` / `say.thing`, cleared after the runtime's default duration), `show`,
  `hide`, `set`, `highlight`, `emit`; `cooldownMs` and `if` (store / `has`). Panel text bound to a store key shows the
  value; `say.text` without a bound panel becomes a subtitle line. Everything else (`select`, `gaze`, `near`, `seen`,
  `mind`, `move`, `look`, `animate`, `ask`, `command`, scripts, minds) is **not** run and is listed in `warnings`.
- **Virtual** — the start viewpoint (IR origin, +Z) with the device FOV, objects via the live view's `FirstPersonView`
  (primitives, VRM as the real model with the arms lowered when the file loads, otherwise a capsule), world canvases with
  their UI layout and the `uhd` layout as a head-locked 1.92 × 1.08 m board (the build's fixed 1920 × 1080 canvas at
  0.001) at `floatingScreen.distance × 0.5` (min 0.3 m, default 1 m), always on top — the same geometry `GenerateCanvasUI`
  builds, so on a 50° display (XREAL) only the middle of the HUD is visible. UI is the preview dialog's `SimpleUIRenderer` rasterized through SVG `foreignObject`; bound text shows its
  written content (no data sources run). Passthrough is the checkerboard; images in UI are placeholders.

Isolation: Electron runs with a temporary `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `--user-data-dir` (never the
real `arsist-engine` config), an offscreen window (nothing appears on screen; a hidden normal window was ~25× slower because
Chromium throttles its frames) and `webSecurity: false` only to read the project's own files. Without `DISPLAY` /
`WAYLAND_DISPLAY` it runs under `xvfb-run -a`; if that is missing it stops with a message. Chromium's own headless mode
(`--headless`, `--ozone-platform=headless`) crashes at start with Electron 28, so it is not used.
`ARSIST_SIM_DISPLAY=direct|xvfb` forces the choice, `ARSIST_SIM_DEBUG=1` prints Electron's output and timings.

## Unity simulator (`scripts/sim/unity.mjs`)

`UnityBackend/ArsistBuilder/Assets/Arsist/Editor/Simulation/ArsistSimBuild.cs` ・
`Runtime/Simulation/{ArsistSimulator,SimulationSpaceProvider}.cs` ・ `Runtime/Simulation/ArsistSimRoom.shader` ・
`src/main/unity/UnityBuilder.ts` (`UnityBuildConfig.simulation`) ・ `scripts/sim/unity.mjs`

Runs the **real** Arsist runtime on a Linux PC without a headset and takes screenshots of the head camera: the same
scene the APK would contain (Jint scripts, UI canvases with TMP, VRMs, the Layster.Spatial runtime with its solver,
rules and minds), built as a Linux player and run under `xvfb`. It is slower than the editor's preview but it is the
engine itself, not an approximation.

```bash
npm run build:main
node scripts/sim/unity.mjs samples/spatial/desk-buddy --out tmp/ArsistSim/out/desk --space studio --times 2,5
node scripts/sim/unity.mjs tmp/Cohabit --out tmp/ArsistSim/out/cohabit --times 3,8 --json
```

| Option | Meaning |
|---|---|
| `--out <dir>` | where `shot-<t>.png`, `result.json`, `player.log`, `sim.json` go (required) |
| `--space <id \| file.json>` | a test space: built-in (`spaces.ts`), the project's `spaces/<id>.json`, or a fixture file. Spatial: fed to the runtime as a provider. Virtual: only drawn |
| `--device <adapter>` | default: the project's `targetDevice`. Decides tags, extensions, the scene's rig and the field of view |
| `--times 1,3,6` | seconds after start to take a shot (default `1,3,6`) |
| `--width/--height` | screen size (default 1280×720) |
| `--fov <deg>` | vertical field of view (default: the adapter's horizontal FOV converted for this aspect; Quest ≈ 77°, XREAL ≈ 29°) |
| `--timeline <file>` | scripted head pose and input (below) |
| `--mind-stub [reply.json]` / `--mind-url <url>` | point every Mind at a local stub (answers with `reply.json` or a fixed `say`) or at another URL |
| `--no-space` | do not draw the test space |
| `--keep-storage` | keep what the previous run saved on the "device" (store persist keys, `keep: forever` places) |
| `--rebuild` | build even when the inputs did not change |
| `--json` | print only the result JSON (progress goes to stderr) |

Timeline (array, or `{ "steps": [...] }`; `t` in seconds after start):

```jsonc
[
  { "t": 1, "head": { "yaw": 35, "pitch": -20 }, "over": 0.8 },   // turn the head in 0.8 s (at: [x, eyeY, z], feet origin)
  { "t": 3, "select": "card.hint" },                               // press a panel button (bindingId)
  { "t": 3.5, "event": "hint" },                                   // ArsistScriptEvent
  { "t": 4, "say": "Hello" },                                      // Spatial `say` action (Virtual: store say.text)
  { "t": 4, "action": { "do": "highlight", "entity": "desk" } },   // any Spatial action
  { "t": 5, "set": { "quiz.answer": 4 } },                         // store
  { "t": 6, "shot": "after-hint" }                                 // extra screenshot
]
```

`result.json` (`format: "arsist.sim/1"`): `ok`, `files` (PNG paths), `shots[]` (`file`, `t`, `head`, `stats.meanLuma` /
`stats.nonBackground` — a shot with almost no pixels apart from the background is listed in `warnings`, `things[]` with the
placed pose / rule / host for Spatial, a `store` snapshot), `timeline[]` (what was applied), `log` (the `[Arsist]`,
`[ArsistJS]`, `[Layster]`, `[ArsistSim]` and error lines of the player log), `errors`, `warnings`, `player`,
`playerLog`, `unityBuildLog`, `built`, `buildSeconds`.

### How it works

1. `unity.mjs` reads the project like the editor's build does (Spatial: `readSpatialProject` → `validate` → `lower`;
   Virtual: the same assembly as `scripts/run-unity-build.js`) and calls `UnityBuilder.build()` with
   `simulation: { playerPath }` and a separate workspace `tmp/ArsistSim/<device>/TempUnityProject`.
2. `UnityBuilder` prepares the workspace exactly as for an APK (sync, Jint, transfer, adapter patch, extensions, UniVRM) with
   three differences: no device SDK is integrated (there is no headset; extensions that need `sdk:*` become absent and
   their script globals get the usual no-op stand-ins), the Standalone scripting defines are copied from Android minus the
   device ones (before Unity starts, like `syncInferenceDefine`), and Unity is started with
   `-buildTarget Linux64 -executeMethod Arsist.Builder.Simulation.ArsistSimBuild.BuildFromCLI`.
3. `ArsistSimBuild` runs the unchanged `ArsistBuildPipeline.BuildFromCLI` (scene generation, UI, scripts, VRM, spatial)
   with `SimulationPlayerPath` set: the device validation is skipped and Phase 4 builds a Mono Linux player (OpenGL Core,
   windowed, Standalone XR loaders off, the room shader always included) instead of the APK.
4. The player runs under `xvfb-run` (Mesa llvmpipe). `ArsistSimulator` (compiled only for `UNITY_STANDALONE`, so never in
   an APK) starts when `-arsist-sim <sim.json>` is on the command line: it disables the head camera's
   `TrackedPoseDriver`, places the head (Unity origin = head at start, like `PinSpawnViewpointToOrigin` on the device;
   floor at −eyeHeight), sets the FOV, plays the timeline and reads the back buffer at the end of the frame (`ReadPixels`, so the HUD camera and
   overlay canvases are in the picture).
5. Spatial: `SimulationSpaceProvider` writes the fixture's entities into the world state through the normal
   `ISpatialProvider` path (like quest-room's MRUK provider), reports the floor and `Ready`; the real solver, rules, minds
   and actions then run. Spaces without `scan` write nothing (only the built-in assumed floor).
6. Passthrough stand-in: when the head camera clears to transparent / black (passthrough, XREAL see-through), the fixture
   is drawn as flat-shaded boxes (`Hidden/ArsistSim/Room`, no lights added to the scene) on layer 31 by an extra camera that
   renders *before* the head camera, and the head camera clears depth only — so, like the real world on the device, the room
   never hides app content (a head-locked subtitle behind a wall stays visible). Apps that paint their own background
   (VR / skybox) are left alone. Outside the room the background is dark grey.
7. On-device storage (`project.storage.persist`, `keep: forever`) goes to `~/.config/unity3d/ArsistSim/…` (the simulator
   build sets the company name) and is wiped before every run unless `--keep-storage` is given.

The player is reused while the inputs (lowered project, device, engine C#, project assets, extensions) are unchanged, so a
second run with another timeline or space only starts the player (~10 s). The first build in a fresh workspace imports
everything (several minutes); later builds take ~1–2 min.

### Requirements and limits

- Linux, Unity with **Linux Build Support (Mono)** (`PlaybackEngines/LinuxStandaloneSupport`), `xvfb-run`. Nothing else;
  no GPU is needed (llvmpipe).
- No device SDK runs: no OVRManager / passthrough / XREAL session, no hand or controller tracking, no device camera
  (`camera.*`, vision tasks and Mind camera frames get nothing), no system keyboard. Quest-only extensions (e.g.
  `quest-room`) are absent; their place in Spatial projects is taken by the test space.
- The camera is a mono camera with the device's FOV, not the per-eye stereo view.
- `UNITY_ANDROID` code paths (JNI plugins, Android permissions, the bundled ONNX Runtime) do not run; models on Unity's
  Inference Engine do.
- Minds call their real endpoints unless `--mind-stub` / `--mind-url` is given.
