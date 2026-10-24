# Electron Main Process — `src/main/main.ts` + `preload.ts`

## Responsibilities

- Create and manage the single `BrowserWindow` (`contextIsolation: true`, `nodeIntegration: false`; a paint
  watchdog relaunches once with software rendering when the GPU fails — `ARSIST_SOFTWARE_RENDER=1` /
  `ARSIST_DISABLE_GPU=1` force it; Help → "Reset GPU Shader Cache and Restart")
- Register the `arsist-file://` custom protocol for local asset access
- Own the lazily-created `ProjectManager` (Layster.Virtual), `UnityBuilder` and `AdapterManager`
- Register the Layster.Spatial IPC (`registerSpatialIpc`, `src/main/layster/spatialIpc.ts`) and the AI / package
  IPC (`registerAiIpc`, `src/main/ipc/aiIpc.ts`)
- Watch the open project for changes made outside the editor (`ProjectWatcher` → `project:external-change`;
  Spatial: `SpatialWatcher` → `spatial:changed`)
- Persist settings in `electron-store`
- Build the native menu (labels from `MENU_STRINGS` / `mt()`, rebuilt on `app:set-language`)
- Stop every background process when the window closes (last section)

The editor **does not run the MCP server** any more: a stdio MCP server is started by the agent that uses it.
The editor only registers Arsist in agents' settings and self-tests the launch command (`doc/09`).

---

## Key Module-Level State

| Variable | Type | Purpose |
|----------|------|---------|
| `mainWindow` | `BrowserWindow \| null` | The single app window |
| `projectManager` | `ProjectManager \| null` | Created on the first `project:create` / `project:load` |
| `unityBuilder` | `UnityBuilder \| null` | Created on demand; re-created when the Unity path changes |
| `adapterManager` | `AdapterManager \| null` | Created on the first adapter query |
| `currentProjectPathForAssets` | `string \| null` | Root of the open project, **Virtual or Spatial**: `arsist-file://` origin check, default project for `model:*` / `vision:preview`, project path given to the AI IPC |
| `projectWatcher` | `ProjectWatcher` | Watches the open Virtual project (`project.json`, `Scenes/`, `UI/`) |
| `store` | `electron-store` | Persistent app settings (see below) |
| `quitting` | `boolean` | Set once shutdown has started |

The open **Spatial** project's folder is also kept in `spatialIpc.ts` (`currentSpatialProjectDir()`). The two sides
switch together: opening/creating a Virtual project calls `openedVirtualProject` (→ `forgetSpatialProject()` stops the
Spatial watcher and clears its folder, then the Virtual `projectWatcher` starts); opening/creating a Spatial project
calls the `onOpened` hook passed to `registerSpatialIpc` (→ `openedSpatialProject`: the Virtual `projectWatcher` is
closed and `currentProjectPathForAssets` points at the Spatial folder).

---

## Persistent Settings (`electron-store`)

Defaults declared in `main.ts`:

| Key | Default | Description |
|-----|---------|-------------|
| `unityPath` | `''` | Absolute path to the Unity editor binary |
| `unityVersion` | `'6000.0.40f1'` | Minimum version `unity:validate` accepts (actual ≥ this passes); same as the template's `ProjectVersion.txt` and README. Stores created before 2026-10 may still hold `'2022.3.20f1'` |
| `recentProjects` | `[]` | Last 5 opened project folders (Virtual and Spatial) |
| `theme` | `'dark'` | UI colour theme |
| `layoutSettings` | `{leftPanelWidth:280, rightPanelWidth:320, bottomPanelHeight:200}` | Panel sizes |
| `defaultOutputPath` | `''` | Default APK output directory |
| `defaultProjectPath` | `''` | Default new-project location |
| `sdkDir` | `''` | Override path for the `sdk/` directory |
| `gpuFingerprint`, `gpuCachePurgePending` | `''`, `false` | GPU-driver change detection → shader cache purge |

Other keys written without a default: `language` (`'ja'` unless set), `showVisionTab`, `setupWizardCompleted`,
`unityManualLicenseFile`, `huggingFaceToken`, `assistant` (built-in assistant settings; the API key is encrypted with
`safeStorage` when the OS offers it), `extensionFolders` (registered extension folders), `spatialLayout`, `spatialBuildOutputPath`.
Standalone scripts in `scripts/` reconstruct this config path by hand — keep them in sync with `src/main/platform/`.

---

## Custom Protocol — `arsist-file://`

Declared privileged (`standard`, `secure`, `supportFetchAPI`, `corsEnabled`, `bypassCSP`) before app ready and
registered with `protocol.registerFileProtocol` once ready. Lets the renderer `fetch()` / load files of the open
project (GLB/VRM models, textures).

- URL format: `arsist-file:///absolute/path/to/file.glb`; Windows also `arsist-file://C:/...` (a one-letter host
  is treated as a drive letter; a leading `/` before `C:` is stripped)
- Security: only paths **inside** `currentProjectPathForAssets` are served; anything else (or no project open)
  gets `error: -10` (`net::ERR_ACCESS_DENIED`); a parsing error gets `-2` (`net::ERR_FAILED`)
- Only the Virtual project sets that root — opening a Spatial project does not change it

---

## IPC Channel Reference

All request/response channels are `ipcRenderer.invoke(channel, ...args)` → `ipcMain.handle(channel, ...)`.
Unless noted, handlers live in `main.ts`.

### App

| Channel | Args | Returns | Notes |
|---------|------|---------|-------|
| `app:set-language` | `'en' \| 'ja'` | `{ success, lang }` | Persists `language` and rebuilds the native menu |

### Project (Layster.Virtual)

| Channel | Args | Returns | Notes |
|---------|------|---------|-------|
| `project:create` | `CreateProjectOptions` | `{ success, project?, error? }` | Creates `<path>/<name>/`; sets the asset root, recent list, watcher |
| `project:load` | `projectPath: string` | `LoadProjectResult` | `error` may be `'irTooNew'` (+ `irVersion`) or `'requirementsMissing'` (+ `missing`); `upgrade` set = opened read-only; `notices` |
| `project:save` | `Partial<ArsistProject>` (the renderer sends the whole project) | `{ success, error? }` | `error: 'readOnly'` while an upgrade is pending |
| `project:upgrade` | — | `{ success, error?, backupPath? }` | Accepts the pending upgrade: backs up `project.json` to `Backups/`, rewrites at the current version |
| `project:export` | `ExportOptions` | `{ success, outputPath?, error? }` | Writes manifest/scenes/ui/dataflow/scripts JSON (`doc/03`) |

### Layster.Spatial (`src/main/layster/spatialIpc.ts`)

Channel names and request/result types are in `src/shared/layster/spatial/ipc.ts` (`SPATIAL_IPC`). Everything
except `detect` / `create` / `load` works on the currently open Spatial project.

| Channel | Args | Returns | Notes |
|---------|------|---------|-------|
| `spatial:detect` | `dir` | `ProjectKindInfo` `{ kind: 'virtual'\|'spatial'\|'none', label?, name?, file? }` | Used by every "open" path to pick the workspace. `project.spatial.json` wins over `project.json` |
| `spatial:create` | `{ parentDir, name, targetDevice }` | `SpatialLoadResult` | Creates `<parentDir>/<name>/` with `Assets/…`, `spaces/`, `Scripts/`, `.gitignore` |
| `spatial:load` | `dir` | `SpatialLoadResult` `{ success, project?, path?, notices?, tooNew?, error? }` | Never rewrites the file on read |
| `spatial:save` | `SpatialProject` | `{ success, error? }` | Atomic write via `SpatialProjectManager` |
| `spatial:spaces` | — | `{ builtin, project }` | Built-in test spaces + `spaces/*.json` |
| `spatial:save-space` | `SpaceFixture` | `{ success, error? }` | |
| `spatial:try-mind` | `TryMindRequest` | `TryMindResult` | Calls a Mind over HTTP **from main** (no CORS, keys never reach the renderer; `mindClient.ts`) |
| `spatial:secrets` | `{ op: 'list'\|'set'\|'remove', name?, value? }` | `{ success, names, error? }` | Keys in `.layster/secrets.local.json`; values are never returned |
| `spatial:import-asset` | `{ kind, sourcePath? }` | `ImportAssetResult` | Opens a file dialog when `sourcePath` is omitted |
| `spatial:build` | `SpatialBuildRequest` | `SpatialBuildResult` | Validates, lowers (`lower.ts`), then the same `runUnityBuild` as `unity:build`; logs/progress on the `unity:*` push events |

### Unity

| Channel | Args | Returns | Notes |
|---------|------|---------|-------|
| `unity:set-path` | `unityPath: string` | `{ success }` | Persisted to `store` |
| `unity:get-path` | — | `string` | |
| `unity:detect-paths` | — | `{ success, candidates, details }` | `findUnityCandidates()` (below) |
| `unity:detect-gradle` | — | Gradle path or `null` | Phones only need Gradle |
| `unity:validate` | — | `{ valid, version?, error? }` | Binary exists, template project found, version ≥ `unityVersion` |
| `unity:build` | `UnityBuildConfig` | `{ success, outputPath?, error?, warnings? }` | `runUnityBuild()` — shared with `spatial:build` |
| `unity:cancel-build` | — | `{ success }` | Kills the Unity child process |

**Push events** sent from main → renderer during a build (Virtual and Spatial alike):
- `unity:build-progress` — `{ phase, progress, message }`
- `unity:build-log` — `string` (one log line)

### Models, vision preview, devices

| Channel | Args | Returns / notes |
|---------|------|-----------------|
| `model:import` | `{ projectPath, sourcePath? }` | Copies an ONNX into `Assets/Models/`, returns a definition draft (file dialog if no path) |
| `model:import-tokenizer` | `{ projectPath, modelName?, sourcePath? }` | Imports a HuggingFace `tokenizer.json` (+ neighbours) |
| `model:inspect` | `{ projectPath, file }` | ONNX inputs/outputs |
| `model:read-labels` | `{ path? }` | `{ success, labels }` |
| `model:hf-inspect` | `{ repo }` | Lists ONNX variants of a Hugging Face repo (uses `huggingFaceToken`) |
| `model:hf-import` | `{ runId, repo, variantPath, projectPath?, name? }` | Downloads + imports; progress pushed as `model:hf-progress` |
| `model:hf-cancel` | `runId` | |
| `model:try` / `model:try-cancel` | `{ runId, projectPath?, request }` / `runId` | Runs the model with the device C# under ONNX Runtime; lines pushed as `model:try-line` |
| `vision:preview` | `{ pipeline, image, models?, projectPath?, frames?, focus?, fps?, probe? }` | Runs a vision pipeline through `tools/vision-preview` |
| `device:list` | — | `adb devices -l` (adb found via Unity's Android SDK first) |
| `device:install` | `{ serial, apkPath }` | `adb install -r -d`; lines pushed as `device:install-log` |

### Adapters

| Channel | Args | Returns |
|---------|------|---------|
| `adapters:list` | — | adapter.json contents + `{ folder, source, extensionId? }`, built-in and extension adapters |
| `adapters:get` | `adapterId` (= targetDevice) | one adapter or `null` |

### Extensions

| Channel | Args | Returns / notes |
|---------|------|-----------------|
| `extensions:list` | `targetDevice?` | `{ success, extensions, problems, deviceTags, userDir, linkedFolders }` |
| `extensions:import` | `'package' \| 'folder'` | Picks a `.arsist` / folder and installs it into `<userData>/extensions` |
| `extensions:install` | `source, force?` | Same, from a path; `needsConfirm` when the id exists |
| `extensions:uninstall` | `id` | |
| `extensions:export` | `id` | Packs to `<id>-<version>.arsist` (save dialog) |
| `extensions:link-folder` / `extensions:unlink-folder` | — / `dir` | Register a folder used in place (`extensionFolders`) |
| `extensions:readme` | `id` | README.md text (≤ 512 KB) |
| `extensions:open-dir` / `extensions:open-user-dir` | `id` / — | Opens the folder in the OS file manager |

### File System

| Channel | Args | Returns |
|---------|------|---------|
| `fs:read-file` | `filePath: string` | `{ success, content?, error? }` |
| `fs:write-file` | `filePath, content` | `{ success, error? }` |
| `fs:select-directory` | — | `string \| null` |
| `fs:select-file` | `filters?` | `string \| null` |
| `fs:exists` | `filePath: string` | `{ exists: boolean }` |

### SDK

| Channel | Returns | Notes |
|---------|---------|-------|
| `sdk:get-dir` / `sdk:set-dir` | `string` / `{ success }` | Override the `sdk/` location |
| `sdk:xreal-status` | `{ exists, path, version? }` | Checks `sdk/com.xreal.xr/package/package.json` |
| `sdk:quest-status` | `{ exists, path, corePackage?, mrukPackage?, error? }` | Checks `sdk/quest/com.meta.xr.sdk.core-*.tgz` (+ MRUK) |
| `sdk:bundled-deps` | `{ deps }` | UniVRM / JKG-M3 `.unitypackage`, Jint / Esprima `.nupkg` presence |

### Assets and animations

| Channel | Args | Returns |
|---------|------|---------|
| `assets:import` | `{ projectPath, sourcePath, kind? }` | `{ success, assetPath? }` — copies to `Assets/{Models,Textures,Video,Other}/<name>_<sha1-8>.<ext>`; refuses image formats Unity cannot import; `kind: 'animation'` delegates to `animations:import` |
| `assets:list` | `{ projectPath }` | `{ success, items[] }` — recursive walk of `Assets/` |
| `animations:import` | `{ projectPath, sourcePath, name? }` | Humanoid FBX → `Assets/Animations/<name>.fbx` (no hash: the file name is the animation name) |
| `animations:list` | `{ projectPath }` | `{ success, animations }` |
| `animations:vrm-spec` | `{ projectPath, modelPath }` | `{ success, spec: '1.0' \| '0.x' \| null }` |

### Settings Store

| Channel | Args | Returns |
|---------|------|---------|
| `store:get` | `key: string` | any |
| `store:set` | `key, value` | `{ success }` |

### AI and project packages (`src/main/ipc/aiIpc.ts`, `doc/09`)

| Channel | Notes |
|---------|-------|
| `mcp:agents`, `mcp:register`, `mcp:unregister`, `mcp:self-test` | Register Arsist's MCP server in external agents' settings (only the `arsist` entry, backed up first) and self-test the launch spec |
| `assistant:get-settings`, `assistant:set-settings`, `assistant:models`, `assistant:send`, `assistant:abort`, `assistant:reset`, `assistant:undo` | Built-in OpenAI-compatible assistant; events pushed as `assistant:event` |
| `project:export-package`, `project:import-package`, `project:install-staged-extension` | `.arsist` project export/import (optionally bundling extensions); busy state pushed as `project:package-busy` |

### Window

| Channel | Effect |
|---------|--------|
| `window:minimize` | `mainWindow.minimize()` |
| `window:maximize` | Toggle maximize |
| `window:close` | `mainWindow.close()` |

### Other push events (main → renderer)

| Event | Payload |
|-------|---------|
| `project:external-change` | `{ projectPath, files }` — Virtual project files changed outside the editor |
| `spatial:changed` | `{ projectPath, files }` — `project.spatial.json` / `spaces/*.json` changed outside |
| `model:hf-progress`, `model:try-line`, `device:install-log`, `assistant:event`, `project:package-busy` | See the tables above |

---

## Menu → Renderer Push Events

Menu items send one-way messages to the renderer via `mainWindow.webContents.send(...)`:

| IPC event | Trigger |
|-----------|---------|
| `menu:new-project` | File → New Project (Ctrl+N) |
| `project:open` | File → Open Project (Ctrl+O), after a folder is chosen — the renderer then calls `openProjectFolder`, which picks Virtual or Spatial via `spatial:detect` |
| `menu:save` | File → Save (Ctrl+S) |
| `menu:save-as` | File → Save As |
| `menu:build-settings` | File → Build Settings (Ctrl+Shift+B) |
| `menu:build` | File → Build (Ctrl+B) |
| `menu:settings` | File → Settings (Ctrl+,) |
| `menu:delete` | Edit → Delete |
| `menu:view` | View → `'3d'` / `'2d'` / `'dataflow'` / `'script'` (F1–F4; `dataflow` now opens the UI tab) |

The renderer subscribes to these via `window.electronAPI.menu.*` in `App.tsx`.

---

## `preload.ts` — contextBridge Surface

The preload script exposes `window.electronAPI`; each method maps to one channel above:

```
window.electronAPI
├── project.{create, load, save, export, upgrade}
├── spatial.{detect, create, load, save, spaces, saveSpace, tryMind, secrets, importAsset, build, onChanged}
├── model.{import, inspect, readLabels, importTokenizer, hfInspect, hfImport, hfCancel, onHfProgress,
│          try, cancelTry, onTryLine}
├── vision.{preview}
├── device.{list, install, onInstallLog}
├── unity.{setPath, getPath, detectGradle, build, cancelBuild, validate, detectPaths, onBuildProgress, onBuildLog}
├── adapters.{list, get}
├── extensions.{list, openUserDir, import, install, uninstall, linkFolder, readme, openDir, unlinkFolder, export}
├── fs.{readFile, writeFile, selectDirectory, selectFile, exists}
├── sdk.{getDir, setDir, xrealStatus, questStatus, bundledDeps}
├── assets.{import, list}
├── animations.{import, list, vrmSpec}
├── store.{get, set}
├── mcp.{agents, register, unregister, selfTest}
├── assistant.{getSettings, setSettings, models, send, abort, reset, undo, onEvent}
├── projectPackage.{export, import, installStagedExtension, onExternalChange, onBusy}
├── window.{minimize, maximize, close}
├── app.{setLanguage}
└── menu.{onNewProject, onSave, onSaveAs, onBuildSettings, onBuild, onSettings, onDelete, onViewChange, onProjectOpen}
```

All `on*` subscriptions **except** the `menu.*` ones return a cleanup function (removes the listener) — callers
must invoke it when unmounting. `menu.*` listeners are registered once in `App.tsx` and never removed.

---

## Unity Path Auto-Detection — `findUnityCandidates()`

Roots and executable names come from `src/main/platform/paths.ts` (`getUnitySearchRoots`,
`getUnityExeRelative`, `getUnityDirectCandidates`); each root is scanned for `<root>/<version>/Editor/<exe>`.

| Platform | Scan roots |
|----------|------------|
| Windows | `%ProgramFiles%\Unity\Hub\Editor`, `%ProgramFiles(x86)%\Unity\Hub\Editor` |
| macOS | `/Applications/Unity/Hub/Editor`, `~/Applications/Unity/Hub/Editor` |
| Linux | `~/Unity/Hub/Editor`, `$XDG_DATA_HOME/unity3d/Hub/Editor`, `$XDG_DATA_HOME/UnityHub/Editor`, `/opt/Unity/Hub/Editor`, `/opt/unityhub/Editor`, Flatpak `~/.var/app/com.unity.UnityHub/data/unity3d/Hub/Editor` |

Direct candidates are added on every OS from `ARSIST_UNITY_PATH`, `UNITY_PATH`, `UNITY_EDITOR_PATH`, and on Linux
`/usr/bin/unity-editor`, `/usr/local/bin/unity-editor`. Results are de-duplicated and sorted newest version first
(versions like `6000.0.40f1`).

---

## Closing the window ends everything (`platform/childProcesses.ts`)

The editor does most of its heavy work in other processes: the Unity build (which itself starts Gradle and
Java), the `dotnet` tools behind the Vision/Models "Try" panels, and `adb`. None of them die
just because the Electron window is gone — closing the app used to leave a full Unity build chewing CPU in
the background, with no window left to stop it.

- Every spawn goes through `trackChild(...)`, which remembers it until it exits. Long-running ones also pass
  `longRunningOptions(...)`, which sets `detached: true` on Linux/macOS so the child becomes a process-group
  leader — `process.kill(-pid)` then takes its Gradle/Java children with it. Windows has no process groups to
  signal, so `killTree` shells out to `taskkill /pid <id> /T /F`.
- `shutdownBackgroundWork()` in `main.ts` cancels the build, closes the project watchers (`ProjectWatcher`,
  `closeSpatialWatcher()`) and calls `killAllChildren()` (SIGTERM, then SIGKILL 1.5 s later for anything still standing). It runs from the
  window's `close` event, `before-quit`, `window-all-closed` and on `SIGINT`/`SIGTERM` (Ctrl+C in a terminal).
- `window-all-closed` quits on macOS too. Staying in the Dock would only keep a build running with no way to
  see it; Linux/Windows are the first-class targets here.
- **Never open a modal dialog on the way out.** `dialog.showMessageBoxSync` blocks the main thread, so while it
  is up nothing is processed — not IPC, not `SIGINT`, not `SIGTERM`. A "the build is still running, close
  anyway?" confirmation on `close` turned the editor into something that could only be stopped by killing the
  terminal. Closing now always stops everything and logs the cancelled build instead of asking.
- **`npm run dev` uses `concurrently --kill-others`.** Without it, closing the window ends only Electron;
  `vite` and `tsc --watch` keep running and the terminal never comes back — which is exactly what happened.
  Any one of the three exiting now stops the other two.
- To check this without clicking: `ARSIST_DEV_CLOSE_AFTER=25000 npm run dev` closes the window from the inside
  after 25 s, the same way the window's close button does (`win.close()`), and the shell prompt must return with
  no `vite` / `tsc` / `electron` left behind. (`xdotool windowclose` is **not** a valid substitute: it destroys
  the X window without sending `WM_DELETE_WINDOW`, so Electron never sees a close and nothing shuts down.)
- `scripts/dev-electron.mjs` starts the Electron **binary** (from `require('electron')`), not `npx electron`
  through a shell: with `shell: true` the child is `sh`, so killing it left Electron running. It starts Electron
  in its own process group and kills that group (SIGTERM, then SIGKILL) on `SIGINT`/`SIGTERM`/`SIGHUP`, which is
  what makes Ctrl+C in `npm run dev` actually stop everything.
