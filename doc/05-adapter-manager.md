# Device Adapters — `src/main/adapters/` (`AdapterManager.ts`, `adapterDirs.ts`)

A device is supported through an **adapter**: a folder holding the device's metadata (`adapter.json`), its
Android manifest and a C# build patcher. Device logic belongs there, not in the engine. The same adapters serve
both Layster profiles — the IR names the device by folder name in `targetDevice` (Virtual `project.json` and
Spatial `project.spatial.json` alike).

---

## Where adapters come from — `adapterDirs.ts`

Every caller (AdapterManager, `UnityBuilder.resolveAdapterDir`, `ProjectManager`'s requirement check, the
renderer's device list) goes through `src/main/adapters/adapterDirs.ts`, so no part of the system misses a device.

| Source | Location |
|--------|----------|
| Built-in | `Adapters/<Folder>/` — found at `process.resourcesPath/Adapters` (packaged), `<cwd>/Adapters` or relative to `__dirname` (dev) — `findBuiltinAdaptersDir()` |
| Extension | `<extension dir>/Adapters/<Folder>/` for each name in the extension's `provides.adapters` (doc/17; scaffold with `npm run ext:new -- <id> --device <Name>`) |

`listAdapterLocations()` lists both (a folder counts only if it has an `adapter.json`); when names collide the
built-in one wins, so an extension cannot silently take over a shipped device. `listBuiltinAdapterNames()` lists
only the built-in folders.

Built-in adapters today: **`XREAL_One`**, **`Meta_Quest`**, **`Android_Phone`**.

```
Adapters/
├── XREAL_One/      adapter.json, AndroidManifest.xml, XrealBuildPatcher.cs, README.md
├── Meta_Quest/     adapter.json, AndroidManifest.xml, QuestBuildPatcher.cs
└── Android_Phone/  adapter.json, AndroidManifest.xml, README.md
```

An adapter's `AndroidManifest.xml` must use `UnityPlayerActivity` + `@style/UnityThemeSelector` (the build forces
the classic Activity entry point and rewrites a manifest that does not).

---

## Name matching — `src/shared/adapterNames.ts`

**The folder name selects the adapter, not `adapter.json`'s `id`.** `resolveAdapter(targetDevice)` uses
`matchAdapterName`:

1. Exact folder name.
2. Equal after lowercasing and treating `-` / spaces as `_`.
3. Prefix: a target that also names a model still matches (`"Meta_Quest3"`, `"Meta Quest 3"` → `Meta_Quest`);
   with several hits the longest name wins.

No match → `UnityBuilder` builds without any device patch and logs a WARNING when the name looks like Quest /
Meta / XREAL ("No specific patch for …" otherwise).

---

## `adapter.json`

There is no enforced schema; the files carry (abridged, from `Meta_Quest/adapter.json`):

```jsonc
{
  "id": "meta-quest",                 // → tag device:meta-quest
  "name": "Meta Quest (2 / 3 / 3S / Pro)",
  "version": "1.0.0",
  "description": "...",
  "tags": ["cap:camera-access", "cap:controllers", "cap:system-keyboard", ...],
  "device":  { "manufacturer": "Meta", "models": [...], "displayName": "...", "category": "..." },
  "display": { "quest3": { "fieldOfView": { "horizontal": 110, "vertical": 96 }, ... }, ... },
  "capabilities": { "sixDofTracking": true, "handTracking": true, "passthrough": true, ... },
  "input":   { ... },
  "sdk":     { "name": "Meta XR SDK", ... },
  "build":   { "platform": "Android", "minApiLevel": 32, "graphicsApi": [...], ... },   // → platform:android
  "manifest": { ... }, "patches": [ ... ], "scripting": { ... }, "optimizations": { ... }
}
```

What the code actually reads:

| Field | Read by |
|-------|---------|
| `id`, `build.platform`, `capabilities` (true values), `tags` | `adapterTags()` in `src/shared/adapterTags.ts` → the device's tags (`device:*`, `platform:*`, `cap:*`). Engine features (`src/shared/engineFeatures.ts`) and extensions' `requires` are matched against these tags — prefer adding a tag over a name check |
| `display.fieldOfView` (directly or one level down, e.g. `display.quest3`) | `src/renderer/utils/deviceFov.ts` — the spawn-view frustum in the scene view and the live/simulation view |
| `device.displayName`, `name` | Device list for extension-provided devices (`src/renderer/extensions/useDeviceOptions.ts`) |

The rest (`sdk`, `build.*` beyond `platform`, `manifest`, `patches`, …) is descriptive; the real player settings
and manifest changes are made by the C# patcher.

---

## How a build applies an adapter — `UnityBuilder.applyDevicePatch`

The build does **not** use `AdapterManager`. In its `patch` phase (`doc/04`) `UnityBuilder`:

1. Resolves the folder with `resolveAdapter` (logs when it comes from an extension).
2. Copies `AndroidManifest.xml` (or `Manifest/AndroidManifest.xml`) to `Assets/Plugins/Android/AndroidManifest.xml`.
3. Copies the `.cs` files from the first existing of `Scripts/`, `Editor/`, or the adapter folder itself to
   `Assets/Arsist/Editor/Adapters/<Folder>/` (the patcher then runs inside the Unity build).
4. Copies `Packages/` into the Unity project's `Packages/` if present.
5. Ensures the Android cleartext-HTTP policy.

The device's tags are computed in `UnityBuilder.planExtensions` from `adapter.json` plus what is present in
`sdk/` (`sdk:*`), and decide which extensions and features go into the build.

---

## `AdapterManager` (IPC `adapters:*`)

| Method | IPC | What it does |
|--------|-----|--------------|
| `listAdapters()` | `adapters:list` | Every adapter (built-in + extension): the raw `adapter.json` plus `{ folder, source: 'builtin' \| 'extension', extensionId? }` |
| `getAdapter(adapterId)` | `adapters:get` | The adapter matching `adapterId` as a **targetDevice** (same name matching as the build), or `null`. Read fresh every time. Also used by `extensions:list` for the device's tags |

`AdapterManager` only **reads**: applying an adapter to a build (patches, manifest, packages) is done by
`UnityBuilder` and `ArsistBuildPipeline` (above). Folder lookup goes through `adapterDirs.ts` for every caller.
`DeviceAdapter` in `AdapterManager.ts` types the main keys of the current `adapter.json` (`device`, `capabilities`,
`tags`, `build`, `manifest`, `patches` …) and lets unknown keys through.

The old `applyPatch` / `registerAdapter` / `createAdapterTemplate` (and the `adapters:apply-patch` IPC) were removed
in 2026-10: they assumed an older `adapter.json` shape (`patchFiles[]`, `buildSettings.requiredPackages`), looked only
in `Adapters/<id>/` instead of the resolved folder, and nothing called them. To add a device, see below.

---

## Adding a device

1. Prefer an extension (`npm run ext:new -- <id> --device <Name>`): it adds `Adapters/<Name>/` inside the extension
   plus an XR hook, and leaves the engine untouched. Otherwise add a folder under `Adapters/`.
2. Give it accurate `capabilities` / `tags` — engine features and extensions find it only through those (doc/17 §1).
3. Put device-specific player settings and manifest fixes in its C# patcher, configured the way the vendor SDK
   expects (see the device map in [CODEMAP.md](../CODEMAP.md)).
