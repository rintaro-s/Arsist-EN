# Renderer Stores — `src/renderer/stores/`

Renderer state lives in Zustand stores. None has side-effects beyond calling `window.electronAPI`; all I/O goes through IPC.

| Store | File | Holds |
|-------|------|-------|
| `useProjectStore` | `stores/projectStore.ts` | The open **Layster.Virtual** project (`project.json`) |
| `useUIStore` | `stores/uiStore.ts` | Editor UI state (views, dialogs, build log, console) |
| `useSpatialStore` | `spatial/store.ts` | The open **Layster.Spatial** project (`project.spatial.json`) — separate, see below |

`stores/dataStoreContext.ts` is not a Zustand store: `DataStoreProvider` / React context holding the preview's
runtime data (`data`, `setData`, `updateData(path, value)` with dotted paths); `App.tsx` wraps the app in it and
`PreviewDialog` uses it.

Which workspace shows is decided in `App.tsx`: `useSpatialStore.project` set → `SpatialWorkspace`; else
`useProjectStore.project` set → `MainLayout` (or `LiveLayoutMode` when `appMode === 'live'`); else `WelcomeScreen`.
Opening a folder goes through `spatial/openProject.ts` (`openProjectFolder`), which asks main (`spatial:detect`)
whether it is Virtual or Spatial. Menu Save / Build are routed to the Spatial store when a Spatial project is open.

---

## `projectStore.ts` — `useProjectStore`

Zustand + Immer. Holds the full `ArsistProject` IR in memory and exposes mutations for every part of the IR.

### State Fields

| Field | Type | Description |
|-------|------|-------------|
| `project` | `ArsistProject \| null` | The loaded IR |
| `projectPath` | `string \| null` | Filesystem path of the project root |
| `isDirty` | `boolean` | `true` when unsaved changes exist |
| `currentSceneId` | `string \| null` | Scene being edited in SceneViewport |
| `selectedObjectIds` | `string[]` | Object IDs selected in the 3D scene |
| `currentUILayoutId` | `string \| null` | Layout open in UIEditor |
| `selectedUIElementId` | `string \| null` | Element selected in UIEditor |
| `selectedDataSourceId` | `string \| null` | DataSource selected in right panel |
| `selectedTransformId` | `string \| null` | Transform selected in right panel |
| `currentScriptId` | `string \| null` | Script open in ScriptEditor |
| `selectedPerceptionTargetId` / `…RegionId` / `…TaskId` | `string \| null` | Selection in the Vision tab |
| `readOnly` | `boolean` | An older Layster.Virtual version opened without accepting the upgrade; saving is refused |
| `irUpgrade` | `IrUpgradeOffer \| null` | The upgrade offer (`from`/`to`/`applied`/`changes`/extension migrations) |
| `showIrUpgrade` | `boolean` | `IrUpgradeDialog` visible (shown again when saving while read-only) |
| `missingRequirements` | `{ path, missing[] } \| null` | Load returned `requirementsMissing` (extension/device lacking) → `MissingRequirementsDialog` |
| `externalChange` | `{ files } \| null` | Files changed outside (agent/MCP) while there are unsaved edits → `ExternalChangeBanner` |
| `externalProblem` | `string \| null` | An externally changed file could not be read yet (half-written JSON) |

### Actions — Project Lifecycle

| Action | Side Effects |
|--------|-------------|
| `createProject(options)` | Calls `window.electronAPI.project.create()`, sets state from result |
| `loadProject(path)` | Calls `window.electronAPI.project.load()`, sets state from result; `readOnly` if the result carries an upgrade offer; `requirementsMissing` → `missingRequirements` |
| `saveProject()` | Calls `window.electronAPI.project.save(project)`, clears `isDirty`. While `readOnly` it re-opens the upgrade dialog instead |
| `upgradeProject()` / `declineUpgrade()` | Accept (`project.upgrade()`, clears `readOnly`) / keep it read-only |
| `reloadProject({ external? })` | Re-read from disk, keeping current scene/layout/selection if still present |
| `handleExternalChange(payload)` / `dismissExternalChange()` | Reload on outside changes (`projectPackage.onExternalChange`) if not dirty, else set `externalChange` |
| `clearMissingRequirements()` | |
| `closeProject()` | Resets all state to null/empty |

### Actions — Models, storage, extensions, Vision

| Action | Notes |
|--------|-------|
| `addModel` / `updateModel` / `removeModel` | `project.models` (doc/15, doc/16) |
| `setPersistedKeys(persist)` | `project.storage.persist` (trimmed, de-duplicated) |
| `setExtensionEnabled(manifest, enabled)` / `updateExtensionSettings(id, updates)` | `project.extensions.<id>` |
| `updateObjectExtension(objectId, id, updates \| null)` | `SceneObject.ext.<id>` |
| `add/update/remove/selectPerceptionTarget`, `…Region`, `…Task` | Vision tab (image targets, regions, tasks) |

### Actions — Scene

| Action | Notes |
|--------|-------|
| `addScene(name)` | Creates a new `SceneData` with UUIDv4, switches to it |
| `removeScene(id)` | Falls back to first remaining scene |
| `setCurrentScene(id)` | Clears `selectedObjectIds` |

### Actions — SceneObject

| Action | Notes |
|--------|-------|
| `addObject(partial)` | Default position `{x:0, y:0, z:2}`, default material white 50%/50% |
| `updateObject(id, updates)` | Shallow merge into the object |
| `removeObject(id)` | Also removes from `selectedObjectIds` |
| `selectObjects(ids)` | Replace selection |
| `duplicateObject(id)` | Deep-clones (JSON round-trip), offsets X+0.5, appends "(Copy)" to name |

### Actions — UILayout

| Action | Notes |
|--------|-------|
| `addUILayout(name, scope)` | Canvas resolution 1024×1024, HUD 1920×1080. Returns new `layoutId`. |
| `removeUILayout(id)` | Refuses if it is the last UHD layout. Clears `canvasSettings` on any canvas SceneObject referencing it. |
| `setCurrentUILayout(id)` | Clears `selectedUIElementId` |
| `addUIElement(parentId, partial)` | Inserts at `parentId` or root if `parentId` is null. Uses recursive tree walk. |
| `updateUIElement(id, updates)` | `Object.assign` via recursive walk |
| `removeUIElement(id)` | Splice from parent's children via recursive walk. Clears selection. |
| `selectUIElement(id \| null)` | |

### Actions — DataFlow

| Action | Notes |
|--------|-------|
| `addDataSource(partial)` | Default type `System_Clock`, mode `polling` |
| `updateDataSource(id, updates)` | Shallow merge |
| `removeDataSource(id)` | Clears selection |
| `selectDataSource(id)` | Also clears `selectedTransformId` |
| `addTransform(partial)` | Default type `Formula` |
| `updateTransform(id, updates)` | |
| `removeTransform(id)` | |
| `selectTransform(id)` | Also clears `selectedDataSourceId` |

### Actions — AR Settings

| Action | Notes |
|--------|-------|
| `updateARSettings(updates)` | Shallow merge into `project.arSettings` |

### Actions — Scripts

| Action | Notes |
|--------|-------|
| `addScript(name)` | Creates `ScriptData` with `trigger: {type:'onStart'}` and a boilerplate comment |
| `updateScript(id, updates)` | Updates `updatedAt` timestamp automatically |
| `removeScript(id)` | Falls back to first remaining script |
| `setCurrentScript(id)` | |
| `exportScriptBundle()` | Returns a `ScriptBundle` (only `enabled` scripts included) |

---

## `uiStore.ts` — `useUIStore`

Plain Zustand (no Immer). Holds all **editor UI state** that is not part of the project IR.

### State Sections

#### View

| Field | Type | Notes |
|-------|------|-------|
| `appMode` | `'editor' \| 'live'` | `'live'` = live layout mode, a separate screen (`LiveLayoutMode`) |
| `currentView` | `'scene' \| 'ui' \| 'dataflow' \| 'script' \| 'vision' \| 'models' \| 'extensions'` | Note: `setCurrentView('dataflow')` is redirected to `'ui'` internally |
| `showVisionTab` | `boolean` (default `false`) | Settings → Models → "Show the Vision tab"; hiding it while on `'vision'` moves to `'models'` |

#### Dialogs

All are boolean `show*` flags with matching `setShow*` actions:
- `showNewProjectDialog`
- `showBuildDialog`
- `showSettingsDialog`
- `showPreviewDialog`
- `showMCPDialog`
- `showSetupWizard`
- `showAssistant` — the built-in AI assistant panel (`AssistantPanel`)

#### Panel Sizes

| Field | Range |
|-------|-------|
| `leftPanelWidth` | 180–480 px |
| `rightPanelWidth` | 220–480 px |
| `bottomPanelHeight` | 80–400 px |

#### 3D Viewport

| Field | Default | Description |
|-------|---------|-------------|
| `showGrid` | `true` | Grid plane visible |
| `showAxes` | `true` | Origin axis markers |
| `showSpawnView` | `true` | The user's spawn point (origin) and its field of view |
| `snapToGrid` | `false` | Grid snap for transform gizmos |
| `transformMode` | `'translate'` | W/E/R keyboard shortcuts change this |
| `transformSpace` | `'world'` | `'local'` or `'world'` |

#### Build State

| Field | Description |
|-------|-------------|
| `buildProgress` | 0–100 percentage |
| `buildMessage` | Current phase description |
| `buildLogs` | Array of all log lines received from main |
| `isBuilding` | `true` while a build is in progress |

Actions: `setBuildProgress(p, msg)`, `addBuildLog(line)`, `clearBuildLogs()`, `setIsBuilding(bool)`.

#### Console

`consoleLogs: ConsoleLog[]` — timestamped log entries.

```typescript
interface ConsoleLog {
  type: 'info' | 'warning' | 'error'
  message: string
  time: string  // toLocaleTimeString()
}
```

Actions:
- `addConsoleLog({ type, message })` — appends with current time
- `addNotification({ type, message })` — same but maps `'success'` type to `'info'`
- `clearConsoleLogs()`

#### Bottom Panel Tab

`bottomTab: 'console'` — currently only one tab exists.

---

## `spatial/store.ts` — `useSpatialStore`

Plain Zustand, **separate from `projectStore`** (the Layster.Spatial shape is different; the two are never mixed).
I/O goes through `spatial/api.ts` (`spatialApi()` → `window.electronAPI.spatial`, channels in
`src/shared/layster/spatial/ipc.ts`).

| Field | Description |
|-------|-------------|
| `project` / `path` | The open `SpatialProject` and its folder |
| `dirty` / `savedSnapshot` | Unsaved-change flag; compared by reference, so undoing back to the saved shape clears it |
| `externalChange` | `project.spatial.json` changed outside while dirty (otherwise it is reloaded silently) |
| `selection` | `{ kind: 'thing' \| 'mind' \| 'body' \| 'rule' \| 'script', id }` or `{ kind: 'recording' \| 'settings' \| 'spaces' }` |
| `selectedEntity` | Entity picked in the World table |
| `activeSpace` / `projectSpaces` | Test space being solved; spaces from the project's `spaces/*.json` (built-ins come from `shared/layster/spatial/spaces.ts`) |
| `bottomTab` | `'world' \| 'mind' \| 'problems'` |
| `previewBeliefs` | Entities a "try Mind" reply guessed, added to the 3D view |
| `status` | `{ type, key, params }` — an i18n key from `i18n/spatialStrings.ts` |
| `showBuild` | `SpatialBuildDialog` visible |
| `undoStack` / `redoStack` | Up to 100 snapshots |

| Action | Notes |
|--------|-------|
| `open(project, path)` / `close()` | Selects the first thing (or settings), loads spaces |
| `update(fn, coalesce?)` | **The only way to edit**: clones, applies `fn`, stamps `updatedAt`, pushes undo. Same `coalesce` key within 0.8 s → one undo step |
| `undo()` / `redo()` | |
| `save()` | `spatial:save`. No autosave (Ctrl+S / menu) |
| `reloadFromDisk()` | Re-read, keeping the selection/space if they still exist |
| `setSelection`, `setSelectedEntity`, `setActiveSpace`, `setBottomTab`, `setPreviewBeliefs`, `setStatus`, `setShowBuild`, `loadSpaces` | |

Helpers: `findSpace(id, projectSpaces)`, `uniqueId(base, taken)`.
