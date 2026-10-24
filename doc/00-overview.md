# Arsist Engine — Architecture Overview

Start here. This page gives the whole picture in a few minutes; every other doc (`01` … `20`) is a deep-dive
into one part. [CODEMAP.md](../CODEMAP.md) is the fast "where do I change X" index plus the XREAL/Quest
device-responsibility map.

## What Arsist is

A desktop **authoring tool + Unity build pipeline** for AR/XR apps. Users (and AI agents) compose an app in an
Electron/React editor; Arsist writes it down as a JSON IR and drives a headless Unity build into an Android APK
for **XREAL** glasses, **Meta Quest** headsets and plain **Android phones**.

Arsist does **not** implement head tracking, sensor fusion or rendering itself. All of that is delegated to the
vendors' Unity SDKs (`sdk/com.xreal.xr`, `sdk/quest`) through Unity XR Management / OpenXR. The engine's job is
to configure Unity and the scene the way each SDK expects.

---

## The three layers

```
Layer 1  Editor (Electron / React)        people and agents write here
Layer 2  IR  = "Layster"                  what was written; the single source of truth
Layer 3  Build + runtime (Unity, C#)      makes the IR run on the device
```

| Layer | Where | What it does |
|-------|-------|--------------|
| 1. Editor | `src/main/` (Electron main, Node), `src/renderer/` (React), `src/main/mcp/` + `src/main/agent/` (AI tools) | Edits the IR. Both humans (GUI) and agents (MCP tools / built-in assistant / direct JSON edits) write the same files |
| 2. Layster IR | Types: `src/shared/types.ts` (Virtual), `src/shared/layster/` (names/versions, Spatial) | JSON files in the project folder. Nothing else is authoritative |
| 3. Build + runtime | `src/main/unity/UnityBuilder.ts` → `UnityBackend/ArsistBuilder/` (`Editor/ArsistBuildPipeline.cs`, `Runtime/`), `Adapters/`, `Extensions/` | Turns the IR into an APK; the Unity runtime interprets it on the device |

Layer 3 (the generated `Assets/ArsistGenerated/*.json` and the Unity runtime) is **shared** by both IR
profiles; it is not itself an IR.

### Layster: two profiles that are not compatible

The IR is called **Layster** (`doc/19-layster.md`). It has two profiles, and there is deliberately **no converter**
between them:

| Profile | What you write | File | Versions |
|---------|----------------|------|----------|
| **Layster.Virtual** | Screens and coordinates: scenes of objects, UI layouts, DataFlow, scripts, models, perception | `project.json` (+ copies in `Scenes/<id>.json`, `UI/<id>.json`) | `irVersion` 1–5 = **α1–α5**, 6 = **β 1.0.0** (current) |
| **Layster.Spatial** | Space: things placed by conditions + fallbacks ("on a table, near the user"), minds (AI), bodies (robots), rules, recording | `project.spatial.json` (+ `spaces/*.json`, `.layster/secrets.local.json`) | **β 1.0.0** |

Both files start with a `layster` header, e.g. `{ "profile": "virtual", "stage": "beta", "version": "1.0.0" }`.
Versions are shown to people only through `src/shared/layster/version.ts` (`formatLayster`,
`describeVirtualIrVersion`) — "Layster.Virtual α5", "Layster.Spatial β 1.0.0", never "IR v5".

A folder is one or the other: `detectProjectKind` (`src/main/layster/projectKind.ts`) checks for
`project.spatial.json` first, then `project.json`, and the renderer opens the matching workspace
(`src/renderer/spatial/openProject.ts`).

Inside **Virtual**, the core data model is still **DataSource → DataStore → UI**: data sources (REST, WebSocket,
MQTT, clock, XR sensors …) and transforms write keys into one DataStore; UI elements bind to those keys; scripts
read and write the same store. Spatial is lowered at build time (`src/shared/layster/spatial/lower.ts`) into the
same Layer-3 files Virtual produces, plus a `spatial.json` read by `Runtime/Spatial/`.

---

## Process architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Electron main process (Node.js) — src/main/                              │
│  main.ts           lifecycle, menu, IPC handlers, arsist-file:// protocol│
│  project/          ProjectManager (Virtual), migrations, projectIO,      │
│                    ProjectWatcher, sceneCopies, .arsist packages         │
│  layster/          SpatialProjectManager, spatialIpc, spatialWatcher,    │
│                    projectKind, mindClient                               │
│  unity/            UnityBuilder (headless Unity build)                   │
│  adapters/         AdapterManager + adapterDirs (device adapters)        │
│  extensions/       extension catalog, install / pack / link              │
│  ipc/aiIpc.ts      MCP registration, built-in assistant, .arsist export  │
│  mcp/ agent/       IR tools (shared by MCP + assistant), assistant loop  │
│  model/ vision/ device/ platform/   ONNX import, HF download, previews,  │
│                    adb, OS-specific paths, child-process tracking        │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ preload.ts: contextBridge → window.electronAPI
┌───────────────────────────────▼─────────────────────────────────────────┐
│ Renderer (Chromium + React) — src/renderer/                              │
│  App.tsx           WelcomeScreen │ MainLayout (Virtual) │ LiveLayoutMode │
│                    │ SpatialWorkspace (Spatial)                          │
│  stores/           Zustand: projectStore (Virtual IR), uiStore           │
│  spatial/          Spatial editor + its own store                        │
│  components/       panels, viewports, dialogs, vision, models, …         │
└─────────────────────────────────────────────────────────────────────────┘

 Child processes / separate programs
 ┌──────────────────────────────┐  ┌─────────────────────────────────────┐
 │ Unity (batchmode)            │  │ MCP stdio server                    │
 │ ArsistBuildPipeline          │  │ src/main/mcp/server.ts              │
 │ .BuildFromCLI → APK          │  │ (launcher scripts/mcp-ir-server.mjs)│
 │ started by UnityBuilder      │  │ started by the *agent*, not editor  │
 └──────────────────────────────┘  └─────────────────────────────────────┘
 ┌──────────────────────────────┐  ┌─────────────────────────────────────┐
 │ dotnet tools                 │  │ On the device (built APK)           │
 │ tools/vision-preview (Vision │  │ Unity runtime; optional WebSocket   │
 │ / Models "Try"), perception- │  │ remote control (python/Control.py), │
 │ check (npm run test:percep.) │  │ LAN log relay (npm run logs)        │
 └──────────────────────────────┘  └─────────────────────────────────────┘
```

Every child process the editor starts is tracked (`src/main/platform/childProcesses.ts`) and killed when the
window closes (`doc/02`).

---

## Directory structure

```
Arsist-EN/
├── src/
│   ├── main/            Electron main process (see the diagram above)
│   ├── renderer/        React editor (Virtual + Spatial workspaces, live layout mode)
│   ├── bridge/          UnityBridge.ts — Virtual IR → build manifest
│   └── shared/          IR types and pure logic shared by main, renderer and tests
│       ├── types.ts     Layster.Virtual types (ArsistProject …)
│       ├── irVersion.ts, irOps.ts, irRepair.ts   Virtual versions, declarative migrations, repair
│       ├── layster/     version.ts (names/versions) + spatial/ (types, solver, validate, lower, …)
│       └── extensions.ts, tags.ts, adapterTags.ts, engineFeatures.ts, engineParts.ts, scriptApi.ts, …
├── UnityBackend/ArsistBuilder/   Unity project used as the build template
│   └── Assets/Arsist/{Editor, Runtime}   build pipeline + runtime (Scripting, UI, Perception,
│                                         Inference, VRM, Spatial, Extensions, …)
├── Adapters/            Built-in device adapters: XREAL_One, Meta_Quest, Android_Phone
├── Extensions/          Official extensions shipped with the engine (vrm10)
├── samples/             extensions/ (quest-room, quest-input) and spatial/ (Layster.Spatial samples)
├── scripts/             CLI helpers (MCP launcher, ext-*, ir-new, layster-build/upgrade, logs, mock device)
├── tools/               dotnet tools: perception-check, vision-preview, ort-bridge-check, …
├── python/              Control.py (remote control), layster/ (demo Mind / Body servers)
├── products/            Applications built on (or next to) the engine
└── sdk/                 Vendor SDKs (gitignored, user-supplied; needed to build/package)
```

---

## Inside the Virtual editor

`MainLayout` shows tabs switched by `uiStore.currentView`:

| Tab | What you edit |
|-----|---------------|
| `scene` | 3D scene (react-three-fiber): objects, transforms, materials, VRM characters, image anchors. Hidden for `head_locked_hud` projects |
| `ui` | 2D UI layouts (HUD and canvas surfaces); DataFlow sources/transforms live in its left panel (the old `dataflow` view now opens here) |
| `script` | JavaScript scripts (run by Jint on the device), API drawer from `src/shared/scriptApi.ts`, "Saved on the device" keys |
| `vision` | Image pipeline editor — **hidden by default** (Settings → Models → "Show the Vision tab") |
| `models` | ONNX models (image / text / tensor), Hugging Face import, "Try" panel |
| `extensions` | Enable/disable extensions, their settings and per-object options |

`LiveLayoutMode` (toolbar → live) is a separate screen that edits a running device (or a simulation) instead of
the project. A Spatial project opens `SpatialWorkspace` instead (Space Lab in the middle, inspectors right,
world table / Mind I/O / problems at the bottom).

---

## Build pipeline in one paragraph

The Build dialog (Virtual) calls `generateBuildManifest` (`src/bridge/UnityBridge.ts`) and invokes
`unity:build`; a Spatial build goes through `spatial:build`, which validates, lowers with `lower.ts` and calls
the **same** `runUnityBuild` in `main.ts`. `UnityBuilder.build()` then runs its phases — `prepare` →
`prepare-unity` (reused `TempUnityProject` workspace) → `prepare-jint` → `transfer` (writes
`Assets/ArsistGenerated/{manifest,scenes,ui_layouts,dataflow,scripts,spatial}.json` + assets) → `patch` (device
adapter) → `sdk` (XREAL / Quest packages) → `extensions` → `sdk-vrm` → `build` (Unity `-batchmode`,
`ArsistBuildPipeline.BuildFromCLI`) → `verify`. Progress and log lines are pushed to the renderer as
`unity:build-progress` / `unity:build-log`. Details: `doc/04`.

---

## Key design decisions

- **IR is the source of truth, and it is plain JSON.** No binary format; agents may edit the files directly and
  the open editor reloads them (`ProjectWatcher` / `spatialWatcher`). Out-of-editor writes go through
  `src/main/project/projectIO.ts` (atomic, queued, refuses other IR versions).
- **Old projects are never silently rewritten.** An older Virtual project opens read-only until the user accepts
  the upgrade (original kept in `Backups/`); a newer one does not open.
- **No logic graphs.** Runtime logic lives in JS scripts (Jint), DataFlow transforms or vision pipelines. The
  engine only offers general building blocks — never app-specific modes.
- **Devices are adapters, features are extensions, and they meet through tags.** A device is a folder in
  `Adapters/` (or an extension's `Adapters/`); new features go in as extensions (`Extensions/<id>/`) that touch
  the engine only through its extension contexts. Tags (`cap:*`, `device:*`, `platform:*`) decide what runs where.
- **AI tools live in one place.** `src/main/mcp/tools.ts` (43 `ir_*` / `arsist_*` tools + 14 `spatial_*` tools
  from `spatialTools.ts`) is used by both the stdio MCP server and the built-in assistant.

---

## Where to read next

| Doc | One line |
|-----|----------|
| [00-overview](00-overview.md) | This page: layers, Layster profiles, processes, map of the docs |
| [01-ir-types](01-ir-types.md) | Layster.Virtual types in `src/shared/types.ts` (+ a pointer to the Spatial types) |
| [02-main-process](02-main-process.md) | `main.ts` + `preload.ts`: settings, `arsist-file://`, every IPC channel, shutdown |
| [03-project-manager](03-project-manager.md) | Virtual project files on disk: create / load / migrate / save / export, scene copies |
| [04-unity-builder](04-unity-builder.md) | `UnityBuilder`: build phases, workspace reuse, SDKs, extensions, license retries |
| [05-adapter-manager](05-adapter-manager.md) | Device adapters: `adapter.json`, lookup by name, tags, how the build applies them |
| [06-bridge-layer](06-bridge-layer.md) | `UnityBridge.ts`: the build manifest both Virtual and Spatial builds go through |
| [07-renderer-stores](07-renderer-stores.md) | Zustand stores: `projectStore` (Virtual IR), `uiStore`, `spatial/store.ts` (Spatial) |
| [08-ui-components](08-ui-components.md) | Editor components (Virtual `MainLayout` and the Spatial workspace), dialogs; runtime UI notes |
| [09-mcp-server](09-mcp-server.md) | MCP server, agent registration, built-in assistant, `.arsist` project packages |
| [10-python-control](10-python-control.md) | Python remote control of a running app over WebSocket |
| [11-perception](11-perception.md) | Image anchors: recogniser, camera frame sources per device, handedness |
| [12-ar-behaviors](12-ar-behaviors.md) | Relative placement, OCR / perception tasks, text input, pointing, DataStore |
| [13-device-logs](13-device-logs.md) | Reading a device's logs over the LAN without adb (`npm run logs`) |
| [14-classic-vision](14-classic-vision.md) | The image pipeline (general vision steps) and its editor |
| [15-models-and-ir-versions](15-models-and-ir-versions.md) | ONNX models in pipelines, GPU readback budget, Virtual IR versions and migrations |
| [16-models-beyond-vision](16-models-beyond-vision.md) | Text / tensor models, LLMs, tokenizers, `model.*`, bundled ONNX Runtime |
| [17-extensions](17-extensions.md) | Extensions, tags, replaceable engine parts, overrides, changing the IR |
| [18-characters-voice-memory](18-characters-voice-memory.md) | VRM characters, animations, voice / audio, camera stills, on-device storage |
| [19-layster](19-layster.md) | Layster: names and versions, Virtual vs Spatial, the Spatial IR spec and lowering |
| [20-spatial-runtime](20-spatial-runtime.md) | Layster.Spatial on the device: world state, solver, Mind / Body protocols, recording |
