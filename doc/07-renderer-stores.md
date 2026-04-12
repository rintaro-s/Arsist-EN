# Renderer Stores — `src/renderer/stores/`

Two Zustand stores cover all renderer state. Neither store has any side-effects beyond calling `window.electronAPI`; all I/O goes through IPC.

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

### Actions — Project Lifecycle

| Action | Side Effects |
|--------|-------------|
| `createProject(options)` | Calls `window.electronAPI.project.create()`, sets state from result |
| `loadProject(path)` | Calls `window.electronAPI.project.load()`, sets state from result |
| `saveProject()` | Calls `window.electronAPI.project.save(project)`, clears `isDirty` |
| `closeProject()` | Resets all state to null/empty |

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
| `currentView` | `'scene' \| 'ui' \| 'dataflow' \| 'script'` | Note: `setCurrentView('dataflow')` is redirected to `'ui'` internally |

#### Dialogs

All are boolean `show*` flags with matching `setShow*` actions:
- `showNewProjectDialog`
- `showBuildDialog`
- `showSettingsDialog`
- `showPreviewDialog`
- `showMCPDialog`
- `showSetupWizard`

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
