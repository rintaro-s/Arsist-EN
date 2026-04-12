# AdapterManager — `src/main/adapters/AdapterManager.ts`

Manages device-specific SDK "adapters" — directories that contain the patches needed to target a particular XR device.

---

## Adapter Directory Layout

Adapters live in `Adapters/<device-id>/` relative to the Arsist repo root (or `process.resourcesPath` in packaged builds):

```
Adapters/
└── XREAL_Air2/
    ├── adapter.json           Adapter metadata
    ├── AndroidManifest.xml    Patched manifest (optional)
    ├── Scripts/               C# editor scripts (optional)
    │   └── XREALBuildPatcher.cs
    └── Packages/              UPM manifest entries (optional)
```

### `adapter.json` schema

```json
{
  "id": "XREAL_Air2",
  "name": "XREAL Air 2",
  "description": "...",
  "targetDevice": "XREAL_Air2",
  "sdkVersion": "2.1.0",
  "unityVersion": "2022.3.x",
  "features": ["6dof", "hand-tracking"],
  "dependencies": ["com.xreal.xr"],
  "buildSettings": {
    "minSdkVersion": 29,
    "targetSdkVersion": 33
  }
}
```

---

## Public Methods

### `listAdapters()`

Scans the `Adapters/` directory and returns all valid adapters (those with a readable `adapter.json`).

Returns: `AdapterInfo[]`

```typescript
interface AdapterInfo {
  id: string
  name: string
  description: string
  targetDevice: string
  sdkVersion: string
  path: string
  features?: string[]
}
```

### `getAdapter(adapterId)`

Returns the full adapter object for a single adapter by its `id` (directory name).

### `applyPatch(adapterId, projectPath)`

Copies adapter patches into the **Arsist project** (not the Unity working directory — that happens later in `UnityBuilder.applyDevicePatch()`).

Steps:
1. Resolves the adapter directory.
2. Updates `ProjectSettings.asset` if the adapter provides build setting overrides (minSdkVersion, targetSdkVersion).
3. Updates `manifest.json` in the Unity project's `Packages/` if the adapter lists dependencies.

Returns `{ success: boolean, error?: string }`.

### `createAdapterTemplate(adapterId, targetDir)`

Generates a skeleton adapter directory with a boilerplate `adapter.json` and placeholder files. Useful for adding support for a new device.

---

## Adapter Resolution Priority

When `UnityBuilder` calls `resolveAdapterDir(targetDevice)`:

1. Exact directory name match: `Adapters/<targetDevice>/`
2. Normalised match: replace hyphens/spaces with underscores, lowercase comparison

This means `"XREAL Air 2"`, `"xreal_air_2"`, and `"XREAL_Air2"` all resolve to the same `Adapters/XREAL_Air2/` directory.

---

## `ProjectSettings.asset` Patching

When an adapter's `buildSettings` specifies `minSdkVersion` or `targetSdkVersion`, `AdapterManager` reads the existing `ProjectSettings/ProjectSettings.asset` (Unity YAML format) and replaces the relevant fields using regex substitution, preserving the surrounding YAML structure.

## `manifest.json` Patching

When an adapter declares `dependencies`, the manager reads `Packages/manifest.json`, merges in the new package entries (without overwriting existing ones), and writes the file back.
