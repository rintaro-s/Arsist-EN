# Bridge Layer — `src/bridge/UnityBridge.ts`

Turns a **Layster.Virtual** `ArsistProject` into the build manifest that Unity reads from
`Assets/ArsistGenerated/manifest.json`. It is pure TypeScript (no Electron, no Node APIs), so the renderer, the
main process, CLI scripts and tests all import it.

**Every build goes through `generateBuildManifest`** — the Virtual Build dialog, `scripts/run-unity-build.js`, and
the Layster.Spatial build (`src/shared/layster/spatial/lower.ts` builds an *internal* `ArsistProject` from the
Spatial project and passes it here, so model shipping, extensions, features and log relay behave the same).
The Build dialog used to hand-roll its own manifest and silently shipped no models and no perception; never build
a manifest anywhere else. `src/bridge/UnityBridge.buildManifest.test.ts` locks this.

---

## Where the bridge sits in a build

```
Virtual:  BuildDialog ──generateBuildManifest(project, { targetDevice })──┐
          scenesData = project.scenes        (raw IR, not converted)      │
          uiData     = project.uiLayouts     (raw IR)                     ├─► IPC unity:build ─► runUnityBuild
          scriptsData = projectStore.exportScriptBundle()                 │
                                                                          │
Spatial:  spatial:build ─► validate ─► lowerSpatialProject()              │
          manifestData = { ...generateBuildManifest(internal), layster,   │
                           scripting, requiresFeatures }                   │
          scenesData / uiData / scriptsData / spatialData ────────────────┘

UnityBuilder.transferProjectData writes Assets/ArsistGenerated/:
  manifest.json  = manifestData + scenes + logRelay + deviceTags + features + extensions
                   + absentExtensions + replacements   (added by UnityBuilder)
  scenes.json, ui_layouts.json, dataflow.json (from manifest.dataFlow), scripts.json, spatial.json (Spatial only)
```

Scenes and UI layouts are passed to Unity **as IR**; `ArsistBuildPipeline` (C#) interprets them directly,
including the editor → Unity coordinate mirror (`x → -x`, `doc/01`).

---

## Functions

### `generateBuildManifest(project, overrides?)`

`overrides.targetDevice` (the device picked in the build screen) wins over `project.targetDevice`. Returns
`generateUnityManifest(project)` plus:

| Key | Content |
|-----|---------|
| `targetDevice` | override or project value |
| `version` | the app version |
| `build` | `buildSettings` without `remoteInput` |
| `buildSettings`, `remoteInput`, `designSystem` | as in the IR |
| `scenes` | full `project.scenes` (UnityBuilder overwrites it with `scenesData` anyway) |
| `projectExtensions` | `project.extensions` as enabled in the IR; which ones actually go in is decided by `UnityBuilder.planExtensions` and written as `extensions` |
| `storage` | `{ persist }` (feature detection and logs; the device reads `scripts.json`'s `storage`) |
| `exportedAt` | timestamp |

### `generateUnityManifest(project)`

The base manifest:

| Key | Content |
|-----|---------|
| `arsistVersion` | `'1.0.0'` |
| `projectId`, `projectName`, `appType`, `targetDevice`, `arSettings`, `dataFlow` | from the IR |
| `build` | `packageName`, `version`, `versionCode`, `minSdkVersion`, `targetSdkVersion` |
| `design` | the design system's font and colours |
| `scenes` | `{ id, name, objectCount }[]` (replaced by the full scenes later) |
| `uiLayouts` | `{ id, name, scope }[]` |
| `scriptBundle` | enabled scripts `{ id, trigger, code, enabled }` + `storage` |
| `irVersion` | `project.irVersion ?? CURRENT_IR_VERSION` — logged on the device |
| `layster` | `project.layster`, else `virtualHeaderFor(irVersion)`. A Spatial build passes its own `{ profile: 'spatial', … }` header so the build and device logs show "Layster.Spatial β 1.0.0" |
| `models` | `shippedModels(project)` |
| `perception` | `undefined` unless there are targets or tasks; then targets (with `holdMs` default 2000 and regions) and the tasks that still resolve (see below), with `engine` defaulting to `{ kind: 'mlkit', script: 'japanese' }` and `pipeline` only for `vision` tasks |
| `generatedAt` | timestamp |

Covered by `UnityBridge.perception.test.ts`.

### `shippedModels(project)`

Every model with an `id` and a `file` whose `includeInBuild` is not `false`. Scripts reach models by name
(`model.*`), which cannot be traced statically, so all imported models ship; untick "include in build" (or delete
the model) to leave one out. (The inline comment above `models:` in `generateUnityManifest` still says only
`infer`-referenced models are shipped — that is outdated.)

### `referencedModels(project)`

Models referenced by `infer` ops in vision tasks. Used by the Vision editor's preview, not by the build.

### `isTaskResolvable(task, targets)` (internal)

Drops perception tasks that would build fine and then never work: no `storeAs`, a `vision` task with no ops, or a
`region` source whose target / region no longer exists. `viewport` sources need no target.

---

## Unused converters

`convertSceneToUnity(scene)` and `convertUIToUnity(layout)` (with the private `convertObjectToUnity`,
`convertUIElementToUnity`, `calculateRectTransform`, …) are still exported but **nothing calls them**: the build
sends raw IR scenes and layouts. Their output shapes (`UnitySceneData` with `MeshFilter` / `MeshRenderer` /
`ArsistModelRuntimeLoader` / `ArsistCanvasSurface` components, `UnityUIData` with `rectTransform` /
`layoutGroup`) are not what the Unity side reads. Do not build on them.

---

## Removed: `uiCodeSync.ts`

This doc used to describe `src/renderer/utils/uiCodeSync.ts` (UI layout ↔ HTML). The file still exists
(`layoutToHtml` / `htmlToLayout`), but no component imports it — the UI editor no longer has an HTML code mode,
and the file references element types and style fields that are not in `types.ts`. Treat it as dead code.
