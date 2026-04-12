# ProjectManager — `src/main/project/ProjectManager.ts`

Handles all file-system operations for Arsist projects. Called exclusively from the main process via `ipcMain.handle` in `main.ts`.

---

## Project File Layout on Disk

```
<project-root>/
├── project.json          Top-level ArsistProject (minus large data arrays)
├── Scenes/
│   └── <scene-id>.json   One file per SceneData
├── UI/
│   └── <layout-id>.json  One file per UILayoutData
└── Assets/
    ├── Models/           GLB/GLTF files
    ├── Textures/
    └── ...
```

`project.json` contains the full `ArsistProject` shape **including** all scenes and UI layouts so it is self-contained. The individual `Scenes/` and `UI/` JSON files are written in parallel for diff-friendliness.

---

## Public Methods

### `createProject(options)`

Creates a new project directory and writes the initial `project.json`.

**options shape:**
```typescript
{
  name: string
  path: string          // parent directory; project goes inside path/name/
  template: ProjectTemplate
  targetDevice: string
}
```

Sets up AR settings and design system defaults based on `template`:

| Template | trackingMode | presentationMode |
|----------|-------------|-----------------|
| `3d_ar_scene` | `6dof` | `world_anchored` |
| `2d_floating_screen` | `3dof` | `floating_screen` |
| `head_locked_hud` | `head_locked` | `head_locked_hud` |

Returns `{ success: true, project: ArsistProject, projectPath: string }`.

---

### `loadProject(projectPath)`

Reads `project.json` and runs backward-compatibility patches, then returns the normalised `ArsistProject`.

**Backward-compatibility logic (in `migrateProject`):**

1. If `scenes` is missing, creates a default scene with `id: 'scene-1'`.
2. If `uiLayouts` is missing, creates a default HUD layout.
3. If `dataFlow` is missing, initialises `{ dataSources: [], transforms: [] }`.
4. If `buildSettings` is missing, supplies defaults (`packageName: 'com.arsist.app'`, etc.).
5. If `arSettings` is missing, supplies defaults from the `appType`.
6. If `designSystem` is missing, supplies a dark-theme default.
7. If `scripts` is missing, sets to `[]`.

Returns `{ success: true, project: ArsistProject }`.

---

### `saveProject(data)`

Writes the full project IR back to disk.

**`data` shape:**
```typescript
{
  projectPath: string
  project: ArsistProject
}
```

Steps:
1. Updates `project.updatedAt` to current ISO timestamp.
2. Writes `project.json` (full project, spaces: 2).
3. Ensures `Scenes/` directory, writes `Scenes/<id>.json` for each scene.
4. Ensures `UI/` directory, writes `UI/<id>.json` for each layout.

---

### `exportProject(options)`

Exports the project in various formats for external use. Not the Unity build export — that goes through `UnityBuilder`.

**`options` shape:**
```typescript
{
  projectPath: string
  outputPath: string
  format: 'json' | 'yaml' | 'unity-manifest'
}
```

| Format | Output |
|--------|--------|
| `json` | `arsist-export.json` — full project IR as JSON |
| `yaml` | `arsist-export.yaml` — full project IR as YAML |
| `unity-manifest` | `manifest.json` — Unity-compatible manifest via `generateUnityManifest()` |

---

## Internal Helpers

### `generateUnityManifest(project)`

Builds the manifest object that Unity reads from `Assets/ArsistGenerated/manifest.json`. Includes:
- Project metadata (id, name, version, targetDevice)
- AR settings (trackingMode, presentationMode, worldScale)
- Remote control settings (enableRemoteControl, port, password)
- DataFlow definition (dataSources, transforms)
- Build settings (packageName, versionCode, etc.)
- List of all scene IDs and names

### `generateDefaultScene()`

Returns a `SceneData` with `id: 'scene-1'`, `name: 'Main Scene'`, and an empty `objects` array.

### `generateDefaultUILayout()`

Returns a `UILayoutData` with:
- `scope: 'uhd'`, `resolution: { width: 1920, height: 1080 }`
- A root `Panel` element with `FlexColumn` layout and a default `Text` child

### `migrateProject(project)`

Applies all backward-compatibility patches in-place and returns the patched project. Called automatically during `loadProject`.
