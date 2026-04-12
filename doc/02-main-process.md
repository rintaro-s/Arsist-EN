# Electron Main Process — `src/main/main.ts` + `preload.ts`

## Responsibilities

- Create and manage the `BrowserWindow`
- Register the `arsist-file://` custom protocol for secure local asset access
- Own singleton instances of `ProjectManager`, `UnityBuilder`, and `AdapterManager`
- Expose all system operations to the renderer via `contextBridge` / `ipcMain.handle`
- Manage the `electron-store` persistent settings file
- Spawn and manage the MCP stdio child process
- Build and register the native menu bar

---

## Key Module-Level Singletons

| Variable | Type | Purpose |
|----------|------|---------|
| `mainWindow` | `BrowserWindow \| null` | The single app window |
| `projectManager` | `ProjectManager \| null` | Lazy-created on first project operation |
| `unityBuilder` | `UnityBuilder \| null` | Lazy-created, re-created on Unity path change |
| `adapterManager` | `AdapterManager \| null` | Lazy-created on first adapter query |
| `currentProjectPathForAssets` | `string \| null` | Root path for `arsist-file://` origin checking |
| `mcpServerProcess` | `ChildProcess \| null` | The MCP stdio process handle |
| `store` | `electron-store` | Persistent app settings (see below) |

---

## Persistent Settings (`electron-store`)

| Key | Default | Description |
|-----|---------|-------------|
| `unityPath` | `''` | Absolute path to `Unity.exe` / `Unity` binary |
| `unityVersion` | `'2022.3.20f1'` | Target Unity version string |
| `recentProjects` | `[]` | Last 5 opened project paths |
| `theme` | `'dark'` | UI colour theme |
| `layoutSettings` | `{leftPanelWidth:280, ...}` | Panel size preferences |
| `defaultOutputPath` | `''` | Default APK output directory |
| `defaultProjectPath` | `''` | Default new-project location |
| `sdkDir` | `''` | Override path for the `sdk/` directory |

---

## Custom Protocol — `arsist-file://`

Registered before app ready. Allows the renderer to `fetch()` files inside the current project directory without relaxing CSP globally.

- URL format: `arsist-file:///absolute/path/to/file.glb`
- Windows drive-letter handling: `arsist-file://C:/...` is normalised by stripping the leading `/`
- Security: only paths **within** `currentProjectPathForAssets` are served; anything outside returns HTTP −10 (net::ERR_BLOCKED_BY_CLIENT)

---

## IPC Channel Reference

All channels are invoked with `ipcRenderer.invoke(channel, ...args)` → `ipcMain.handle(channel, ...)`.

### Project

| Channel | Args | Returns | Notes |
|---------|------|---------|-------|
| `project:create` | `options` | `{ success, project?, error? }` | Also updates recent projects list |
| `project:load` | `projectPath: string` | `{ success, project?, error? }` | Also updates recent projects list |
| `project:save` | `data` | `{ success, error? }` | |
| `project:export` | `options` | `{ success, error? }` | |

### Unity

| Channel | Args | Returns | Notes |
|---------|------|---------|-------|
| `unity:set-path` | `unityPath: string` | `{ success }` | Persisted to `store` |
| `unity:get-path` | — | `string` | |
| `unity:build` | `buildConfig` | `BuildResult` | Fires `unity:build-progress` and `unity:build-log` push events during build |
| `unity:cancel-build` | — | `{ success }` | Kills the Unity child process |
| `unity:validate` | — | `{ valid, error? }` | Checks Unity binary + version |
| `unity:detect-paths` | — | `{ candidates, details }` | Scans Unity Hub install directories |

**Push events** sent from main → renderer during a build:
- `unity:build-progress` — `{ phase, progress, message }` (`BuildProgress`)
- `unity:build-log` — `string` (single log line)

### Adapters

| Channel | Args | Returns |
|---------|------|---------|
| `adapters:list` | — | adapter list |
| `adapters:get` | `adapterId: string` | adapter object |
| `adapters:apply-patch` | `adapterId, projectPath` | `{ success }` |

### File System

| Channel | Args | Returns |
|---------|------|---------|
| `fs:read-file` | `filePath: string` | `{ success, content? }` |
| `fs:write-file` | `filePath, content` | `{ success }` |
| `fs:select-directory` | — | `string \| null` |
| `fs:select-file` | `filters?` | `string \| null` |
| `fs:exists` | `filePath: string` | `{ exists: boolean }` |

### SDK

| Channel | Returns | Notes |
|---------|---------|-------|
| `sdk:get-dir` / `sdk:set-dir` | `string` / `{ success }` | Override the `sdk/` location |
| `sdk:xreal-status` | `{ exists, path, version? }` | Checks `sdk/com.xreal.xr/package/package.json` |
| `sdk:quest-status` | `{ exists, path, corePackage?, mrukPackage? }` | Checks `sdk/quest/*.tgz` |
| `sdk:bundled-deps` | `{ deps }` | Lists UniVRM, JKG-M3, Jint, Esprima presence |

### Assets

| Channel | Args | Returns |
|---------|------|---------|
| `assets:import` | `{ projectPath, sourcePath, kind? }` | `{ success, assetPath? }` — copies file to `Assets/{kind}/`, returns relative path |
| `assets:list` | `{ projectPath }` | `{ success, items[] }` — recursive walk of `Assets/` |

### Settings Store

| Channel | Args | Returns |
|---------|------|---------|
| `store:get` | `key: string` | any |
| `store:set` | `key, value` | `{ success }` |

### MCP Server

| Channel | Args | Returns | Notes |
|---------|------|---------|-------|
| `mcp:start` | `projectPath: string` | `{ success, config? }` | Spawns `mcp-ir-server.mjs` as stdio child |
| `mcp:stop` | — | `{ success, message }` | Sends SIGTERM |
| `mcp:status` | — | `{ enabled, running, config? }` | |
| `mcp:get-client-config` | — | JSON snippet for Claude Desktop | |

### Window

| Channel | Effect |
|---------|--------|
| `window:minimize` | `mainWindow.minimize()` |
| `window:maximize` | Toggle maximize |
| `window:close` | `mainWindow.close()` |

---

## Menu → Renderer Push Events

Menu items send one-way messages to the renderer via `mainWindow.webContents.send(...)`:

| IPC event | Trigger |
|-----------|---------|
| `menu:new-project` | File → New Project |
| `menu:save` | File → Save (Ctrl+S) |
| `menu:save-as` | File → Save As |
| `menu:build-settings` | File → Build Settings |
| `menu:build` | File → Build |
| `menu:settings` | File → Settings |
| `menu:delete` | Edit → Delete |
| `menu:view` | View → {3D/2D/DataFlow/Script} |
| `project:open` | File → Open Project (after path selected) |

The renderer subscribes to these via `window.electronAPI.menu.*` in `App.tsx`.

---

## `preload.ts` — contextBridge Surface

The preload script exposes `window.electronAPI` with the following namespaces, each mapping directly to the IPC channels above:

```
window.electronAPI
├── project.{create, load, save, export}
├── unity.{setPath, getPath, build, cancelBuild, validate, detectPaths, onBuildProgress, onBuildLog}
├── adapters.{list, get, applyPatch}
├── fs.{readFile, writeFile, selectDirectory, selectFile, exists}
├── sdk.{getDir, setDir, xrealStatus, questStatus, bundledDeps}
├── assets.{import, list}
├── store.{get, set}
├── mcp.{start, stop, getStatus, getClientConfig}
├── window.{minimize, maximize, close}
└── menu.{onNewProject, onSave, onSaveAs, onBuildSettings, onBuild, onSettings, onDelete, onViewChange, onProjectOpen}
```

`onBuildProgress` and `onBuildLog` return cleanup functions (remove the listener) — callers must invoke the returned function when unmounting.

---

## Unity Path Auto-Detection — `findUnityCandidates()`

Scans standard Unity Hub install directories on each platform:

| Platform | Scan root |
|----------|-----------|
| Windows | `%ProgramFiles%/Unity/Hub/Editor/` |
| macOS | `/Applications/Unity/Hub/Editor/` |
| Linux | `~/Unity/Hub/Editor/` + `/usr/bin/unity-editor` |

Results are de-duplicated and sorted newest-version-first by parsing version strings like `6000.0.61f1`.

---

## MCP Server Lifecycle

1. `mcp:start` is called by the renderer with the current project path.
2. Main spawns `mcp-ir-server.mjs` using `process.execPath` (Electron's Node.js) with `stdio: ['pipe','pipe','pipe']`.
3. `MCP_PROJECT_PATH` is injected into the child's environment.
4. After 500 ms, if the process is still alive and no error appeared on stderr, `mcpServerEnabled` is set to `true` and the client configuration JSON is returned to the renderer.
5. `mcp:stop` sends SIGTERM. The process's `exit` handler also clears `mcpServerProcess`.
6. `mcp:get-client-config` returns the JSON snippet that the user pastes into Claude Desktop's `settings.json`.
