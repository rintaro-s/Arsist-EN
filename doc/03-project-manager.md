# ProjectManager — `src/main/project/ProjectManager.ts`

Reads and writes **Layster.Virtual** projects (`project.json`) for the editor. Called only from the main process
via the `project:*` IPC handlers in `main.ts` (`doc/02`). It is the editor's half of the project files; the other
writers (MCP tools, built-in assistant, `.arsist` import) go through `projectIO.ts` with the same layout and rules
(see "Related modules").

**Layster.Spatial projects are not handled here.** `project.spatial.json` is read and written only by
`src/main/layster/SpatialProjectManager.ts` (IPC `spatial:*`, `doc/19` §4). Which kind a folder is decides
`detectProjectKind` (`src/main/layster/projectKind.ts`): `project.spatial.json` → Spatial, else `project.json` →
Virtual. `createSpatialProjectOnDisk` refuses a folder that already holds either file.

---

## Project File Layout on Disk (Virtual)

```
<project-root>/
├── project.json          The whole ArsistProject, including copies of all scenes and UI layouts
├── Scenes/<scene-id>.json   One file per SceneData
├── UI/<layout-id>.json      One file per UILayoutData
├── Scripts/
├── Assets/               Models/ Textures/ Fonts/ Audio/ (+ Animations/, Video/, Other/ when imported)
├── Build/
└── Backups/              project.<version-tag>.<timestamp>.json, written when an upgrade is accepted
```

Scenes and UI layouts exist **twice** (inside `project.json` and as individual files). The editor always writes
both with the same content. When something outside the editor changes only one copy, the **changed copy wins**
on the next load (`sceneCopies.ts`); the stale copy is then rewritten to match. Never write a loader that
silently prefers one copy.

---

## Public Methods

### `createProject(options)`

Creates `<options.path>/<options.name>/` (with `Assets/{Textures,Models,Fonts,Audio}`, `Scenes`, `UI`,
`Scripts`, `Build`) and writes `project.json` plus the first scene and UI layout.

**options shape (`CreateProjectOptions`):**
```typescript
{
  name: string
  path: string          // parent directory; project goes inside path/name/
  template: ProjectTemplate
  targetDevice: string  // adapter folder name, e.g. 'Meta_Quest'
}
```

The new project carries `layster: virtualHeaderFor(CURRENT_IR_VERSION)` and `irVersion: CURRENT_IR_VERSION`
(6 = Layster.Virtual β 1.0.0), empty `models` / `extensions`, `storage: { persist: [] }`, a default design system
and build settings (`packageName: com.arsist.<name>`, `minSdkVersion` 32 for Quest-like targets / 29 otherwise,
`targetSdkVersion: 34`, remote input UDP 19100 / TCP 19101).

AR settings come from `createARSettings(template)` in `src/main/project/defaults.ts` (shared with the migrations,
so new and migrated projects get the same defaults; all with `interaction: { controllerRay: true, handTracking: false }`):

| Template | trackingMode | presentationMode | defaultDepth | Initial content |
|----------|-------------|------------------|--------------|-----------------|
| `3d_ar_scene` | `6dof` | `world_anchored` | 2 | `SampleCube` at z = 2 |
| `2d_floating_screen` | `3dof` | `floating_screen` | 2 | `FloatingScreen` plane; `floatingScreen` 1.6 × 0.9 m at 2 m |
| `head_locked_hud` | `head_locked` | `head_locked_hud` | 1 | HUD with `STATUS` / `00:00:00` texts |

Returns `{ success: true, project }` (the renderer derives the path as `path/name`).

---

### `loadProject(projectPath)`

Returns `LoadProjectResult` `{ success, project?, error?, irVersion?, missing?, upgrade?, notices? }`.

1. Reads `project.json`. Invalid JSON → `error: 'project.json: <line/column>'` (the editor keeps its current
   state and reloads once the file is fixed).
2. `migrateProject(raw)` (`migrations.ts`) brings it to `CURRENT_IR_VERSION` **in memory**. A version newer than
   this editor → `error: 'irTooNew'` with `irVersion: { found, supported }`; the project is not opened.
3. `checkProjectRequirements` (`src/shared/extensions.ts`): extensions enabled in the project and the target
   device must exist in this editor (extension catalog + built-in adapters). Otherwise
   `error: 'requirementsMissing'` + `missing`, and the editor offers to import the `.arsist` / folder.
4. Scenes and UI layouts are taken from whichever copy changed (`resolveSceneAndUiCopies`), with missing fields
   filled in by `src/shared/irRepair.ts`; `scripts` defaults to `[]`.
5. Extension data (`extensions.<id>`, `ext.<id>` on objects) is migrated per extension
   (`migrateExtensionData`); such an upgrade is reported even when the IR itself is current.
6. If anything was migrated, `upgrade: PendingUpgrade` is returned (`from`, `to`, `applied` migration ids,
   `changes`, `extensions?`) and the manager is **read-only** until `upgradeProject()`. Nothing is written in
   that state (not even `Scripts/`).
7. Otherwise stale scene/UI copies are rewritten to match (atomically) and reported in `notices`.

The migrations themselves (α1 → … → α5 → β 1.0.0, declarative `irOps`, `npm run ir:new`) are described in
`doc/15` §3 and `doc/19` §1.3. `migrateProject` also puts the current `layster` header first in the object.

---

### `upgradeProject()`

Called by `project:upgrade` after the user accepts the upgrade (`IrUpgradeDialog`). Copies the original
`project.json` to `Backups/project.<tag>.<timestamp>.json` (`<tag>` = `alpha5`, `beta1.0.0`, … via
`virtualBackupTag`, so the name tells which Arsist can still read it), sets `irVersion` / `layster` to the current
version, clears read-only and saves. Returns `{ success, backupPath? }`; on a save failure the pending upgrade is
restored.

---

### `saveProject(data)`

`data` is a `Partial<ArsistProject>` merged into the current project (the renderer sends the whole project).
Refuses with `error: 'readOnly'` while an upgrade is pending.

Steps:
1. Updates `updatedAt`.
2. Writes `project.json`, every `Scenes/<id>.json` and every `UI/<id>.json` with `atomicWriteJson`
   (temp file + rename, so neither the editor nor an agent ever reads half a file).
3. Reports each written file's content to the write observer (`ProjectWatcher.recordOwnWrite`), so the editor's
   own save is not mistaken for an external change.
4. Records that both copies are now identical (`seenAfterSave`).

---

### `exportProject(options)`

Writes the build data as loose files, for inspection or external use. **Not** what the Build dialog uses —
builds go through `generateBuildManifest` + `UnityBuilder` (`doc/04`, `doc/06`).

**`options` shape (`ExportOptions`):**
```typescript
{
  format: 'unity' | 'json' | 'yaml'
  outputPath: string
  includeAssets: boolean
}
```

The same files the build's transfer step writes into `Assets/ArsistGenerated/`
(`UnityBuilder.transferProjectData`), built the same way:

| Output | When |
|--------|------|
| `manifest.json` — `generateBuildManifest(project)` from `src/bridge/UnityBridge.ts` | `format` `'unity'` or `'json'` |
| `manifest.yaml` — the same object as YAML | `format === 'yaml'` |
| `scenes.json`, `ui_layouts.json`, `scripts.json` (enabled scripts + `storage.persist`, the `scriptBundle` of `generateUnityManifest`) | always |
| `dataflow.json` | when the project has `dataFlow` |
| `Assets/` copy | `includeAssets` |

Values that only exist at build time (`logRelay`, `deviceTags`, `features`, `extensions`, `replacements`) are not
in the exported manifest.

### Other accessors

`isReadOnly()`, `getPendingUpgrade()`, `getCurrentProject()`, `getProjectPath()`, `setWriteObserver(fn)`.

---

## Internal Helpers

### `createInitialScene(template)` / `createInitialUI(template)`

Scene `MainScene` (uuid id) with the template's sample object; UI layout `MainUI` (uuid id) with
`scope: 'uhd'`, `resolution: 1920 × 1080` and a `FlexColumn` root `Panel`.

---

## Related modules (`src/main/project/`)

| File | Role |
|------|------|
| `migrations.ts` | Virtual version migrations (`MIGRATIONS`, `migrateProject`, `IrVersionError`, `virtualBackupTag`) |
| `defaults.ts` | `createARSettings`, `createInitialDataFlow`, `migrateAppType` (old names `3D_AR` …), `PROJECT_TEMPLATES` |
| `projectIO.ts` | Out-of-editor reads/writes: `readProjectFiles` (refuses newer versions; with `forWrite` also older ones), `writeProjectFiles`, `withProjectWrite` (one write at a time per project), `atomicWriteJson` |
| `sceneCopies.ts` | Picks the changed copy of each scene/UI layout, `syncStaleCopies`, JSON error locations |
| `projectWatcher.ts` | `ProjectWatcher`: watches the folder (chokidar), ignores content the editor itself wrote, debounces, sends `project:external-change` |
| `projectPackage.ts` | `.arsist` project export/import (optionally with the extensions it uses) |
| `animationAssets.ts`, `vrmInfo.ts` | FBX import into `Assets/Animations/<name>.fbx`; VRM 0.x / 1.0 detection |
