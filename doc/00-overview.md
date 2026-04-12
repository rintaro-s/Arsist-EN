# Arsist Engine — Architecture Overview

## What Is Arsist Engine

Arsist Engine is a desktop application that lets users compose AR/XR experiences through a visual editor and then compile them into Android APKs for devices such as XREAL Air and Meta Quest. The application is built as an Electron app with a React renderer and a Unity backend.

The core design principle is a **three-layer data model**:

```
DataSource → DataStore → UI
```

- **DataSource** — external data that feeds the application at runtime (REST APIs, WebSocket streams, MQTT, XR sensor data, system clock, etc.)
- **DataStore** — a key-value store where data is held and optionally processed by Transforms before being displayed
- **UI** — React-composed UI layout definitions that bind to DataStore variables

Every aspect of a project is represented in a JSON-serialisable **Intermediate Representation (IR)** called `ArsistProject`. That IR is the single source of truth edited in the GUI and later exported for Unity to consume.

---

## Process Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Electron Main Process (Node.js)                                │
│                                                                 │
│  main.ts            — app lifecycle, IPC handlers              │
│  project/           — ProjectManager (CRUD on IR files)        │
│  unity/             — UnityBuilder (headless build pipeline)   │
│  adapters/          — AdapterManager (device SDK patch system) │
└────────────────────────────┬────────────────────────────────────┘
                             │  contextBridge / ipcMain ↕ ipcRenderer
┌────────────────────────────▼────────────────────────────────────┐
│  Electron Renderer Process (Chromium + React)                   │
│                                                                 │
│  App.tsx            — root component, dialog orchestration     │
│  stores/            — Zustand state (project IR + UI state)    │
│  components/        — editor panels, viewports, dialogs        │
│  utils/uiCodeSync   — IR ↔ HTML serialisation                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Unity Backend  (UnityBackend/ArsistBuilder project)            │
│                                                                 │
│  Receives JSON IR written by UnityBuilder                      │
│  Runs Arsist.Builder.ArsistBuildPipeline.BuildFromCLI          │
│  Produces an Android APK                                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  MCP Server  (scripts/mcp-ir-server.mjs)                        │
│                                                                 │
│  Spawned as child process by main.ts on user request           │
│  Exposes IR-editing tools over the MCP stdio protocol          │
│  Allows AI agents (e.g. Claude) to author project IR           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Python Remote Control  (python/Control.py)                     │
│                                                                 │
│  Connects to the built APK via WebSocket at runtime            │
│  Controls VRM expressions, bone rotations, scene objects       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
Arsist-EN/
│
├── src/
│   ├── main/                      Electron main process
│   │   ├── main.ts                App entry, IPC handlers
│   │   ├── preload.ts             contextBridge API surface
│   │   ├── project/
│   │   │   └── ProjectManager.ts  IR create / load / save / export
│   │   ├── unity/
│   │   │   └── UnityBuilder.ts    Build pipeline (6 phases)
│   │   └── adapters/
│   │       └── AdapterManager.ts  Device SDK patch management
│   │
│   ├── renderer/                  Chromium / React UI
│   │   ├── App.tsx                Root component + menu event listeners
│   │   ├── stores/
│   │   │   ├── projectStore.ts    IR state (Zustand + Immer)
│   │   │   ├── uiStore.ts         Editor UI state (Zustand)
│   │   │   └── dataStoreContext.ts Runtime DataStore (React context)
│   │   ├── components/
│   │   │   ├── panels/
│   │   │   │   ├── LeftPanel.tsx  Hierarchy / list panels
│   │   │   │   └── RightPanel.tsx Inspector panels
│   │   │   ├── viewport/
│   │   │   │   ├── SceneViewport.tsx  3-D scene editor (react-three-fiber)
│   │   │   │   ├── UIEditor.tsx       2-D UI canvas editor
│   │   │   │   ├── UICanvas.tsx       UI preview canvas
│   │   │   │   ├── DataFlowEditor.tsx DataFlow pipeline editor
│   │   │   │   ├── ScriptEditor.tsx   JS script editor
│   │   │   │   ├── CodeEditor.tsx     Code view
│   │   │   │   └── VRMViewer.tsx      VRM avatar preview
│   │   │   └── dialogs/           Build, Settings, NewProject, etc.
│   │   └── utils/
│   │       └── uiCodeSync.ts      IR ↔ HTML bi-directional serialiser
│   │
│   ├── bridge/
│   │   └── UnityBridge.ts         IR → Unity JSON converters
│   │
│   └── shared/
│       └── types.ts               Central TypeScript type definitions (IR)
│
├── scripts/
│   └── mcp-ir-server.mjs          MCP stdio server for AI-driven IR editing
│
├── python/
│   └── Control.py                 Python WebSocket controller for built APKs
│
├── UnityBackend/
│   └── ArsistBuilder/             Unity project used as build template
│
├── Adapters/                      Device-specific SDK patch directories
│
└── sdk/                           External SDK packages (XREAL, Quest, nupkg)
```

---

## Four Views Inside the Editor

The renderer exposes four distinct editing contexts, switched via `uiStore.currentView`:

| View | Left Panel | Viewport | Right Panel |
|------|-----------|---------|-------------|
| `scene` | Object hierarchy | 3-D React-Three-Fiber canvas | Object inspector (Transform, Material, Canvas) |
| `ui` | UI layout tree | 2-D drag-and-drop canvas | Element style / binding inspector |
| `dataflow` | DataSource + Transform list | DataFlow pipeline (3-column) | Source / Transform settings |
| `script` | Script file list | Monaco-like textarea editor | Script metadata inspector |

---

## Build Pipeline Summary

When the user clicks "Build", the renderer collects the full IR and calls `unity:build` over IPC. The `UnityBuilder` executes these phases in order:

1. **prepare-unity** — Copy the `UnityBackend/ArsistBuilder` template to a working directory
2. **prepare-jint** — Ensure `Jint.dll` and `Acornima.dll` are present in `Assets/Plugins/`
3. **transfer** — Write `manifest.json`, `scenes.json`, `ui_layouts.json`, `dataflow.json`, `scripts.json` to `Assets/ArsistGenerated/`, copy project assets
4. **patch** — Apply the selected device adapter's `AndroidManifest.xml` and editor scripts
5. **sdk** — Copy the XREAL or Quest SDK packages into the Unity `Packages/` directory and update `manifest.json`
6. **build** — Spawn Unity in headless (`-batchmode -nographics -quit`) mode, invoking `ArsistBuildPipeline.BuildFromCLI`

Unity licensing failures are detected by pattern matching and retried up to five times with different strategies (with/without `-nographics`, local `.ulf` file, GUI mode on Windows).

---

## Key Design Decisions

- **No logic graphs** — earlier versions had a "LogicGraph" node editor. That has been removed. All runtime logic lives in the JS script system (Jint) or in DataFlow Transforms.
- **IR is flat JSON** — projects are stored as `project.json` + per-scene `Scenes/<id>.json` + per-layout `UI/<id>.json`. There is no binary format.
- **Adapters are directories** — adding support for a new XR device requires only placing a folder in `Adapters/` with an `adapter.json`, `AndroidManifest.xml`, and optional `.cs` build-patcher scripts.
- **MCP enables AI authoring** — the MCP server exposes 17 IR-editing tools. An AI agent with MCP support can create scenes, place models, build UI layouts, and configure DataFlow entirely through tool calls without opening the GUI.
