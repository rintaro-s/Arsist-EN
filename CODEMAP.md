# Arsist Engine — Code Map (for humans and AI agents)

A machine-readable orientation map. If you are an AI agent modifying this repo, **read this first**, then the
relevant `doc/NN-*.md` deep-dive. For "where do I change X" jump to [Task index](#task-index).

> Deep-dive docs live in [`doc/`](doc/) (`00-overview` … `10-python-control`). This file is the fast index +
> the device/SDK responsibility map that those docs don't cover.

---

## What Arsist is

A desktop **authoring tool + build pipeline**, not a runtime tracking engine. Users compose AR/XR experiences in a
visual editor; the engine exports a JSON **Intermediate Representation (IR)** and drives a headless **Unity** build
into an Android APK for AR glasses (XREAL) and VR headsets (Meta Quest).

- **No in-repo head tracking / sensor fusion / HID.** All pose/tracking/rendering is delegated to vendor SDKs
  (`sdk/com.xreal.xr`, `sdk/quest`) through **Unity XR Management + OpenXR / AR Foundation**.
- Core data model: **DataSource → DataStore → UI** (see `doc/00-overview.md`).

## Tech stack per layer

| Layer | Language | Entry point |
|-------|----------|-------------|
| Electron main (orchestration) | TypeScript | [src/main/main.ts](src/main/main.ts) → `dist/main/main/main.js` |
| Renderer (editor UI) | TypeScript + React | [src/renderer/main.tsx](src/renderer/main.tsx) → [App.tsx](src/renderer/App.tsx) |
| IR ↔ Unity bridge | TypeScript | [src/bridge/UnityBridge.ts](src/bridge/UnityBridge.ts) |
| IR type definitions (source of truth) | TypeScript | [src/shared/types.ts](src/shared/types.ts) |
| Unity build + runtime engine | C# | [UnityBackend/ArsistBuilder/](UnityBackend/ArsistBuilder/) |
| Device adapters | JSON + C# | [Adapters/](Adapters/) |
| MCP server (AI authoring) | JS | [scripts/mcp-ir-server.mjs](scripts/mcp-ir-server.mjs) |
| Remote control (runtime) | Python | [python/Control.py](python/Control.py) |

Build system: **npm + Vite + tsc + electron-builder** (no CMake/Cargo). Unity project pinned in
[ProjectVersion.txt](UnityBackend/ArsistBuilder/ProjectSettings/ProjectVersion.txt).

---

## Module map

### Electron main — `src/main/`
| File | Responsibility |
|------|----------------|
| [main.ts](src/main/main.ts) | App lifecycle, IPC handlers, menu, MCP spawn, Unity path detection, OS tuning |
| [preload.ts](src/main/preload.ts) | contextBridge IPC surface exposed to renderer |
| [project/ProjectManager.ts](src/main/project/ProjectManager.ts) | IR create/load/save/export; AR defaults per template |
| [unity/UnityBuilder.ts](src/main/unity/UnityBuilder.ts) | **6-phase headless Unity build**; license retry; toolchain/SDK detection (largest file) |
| [adapters/AdapterManager.ts](src/main/adapters/AdapterManager.ts) | Discover/apply device adapter folders |
| `platform/` *(added in portability work)* | Centralized OS-dependent detection (Unity/JDK/Android SDK/license/config paths) |

### Renderer — `src/renderer/`
Four editor views switched by `uiStore.currentView`: `scene` / `ui` / `dataflow` / `script`.
- `stores/` — Zustand state: `projectStore.ts` (IR), `uiStore.ts` (editor UI), `dataStoreContext.ts` (runtime DataStore).
- `components/viewport/` — `SceneViewport` (r3f 3D), `UIEditor`/`UICanvas` (2D), `DataFlowEditor`, `ScriptEditor`/`CodeEditor` (Monaco), `VRMViewer`.
- `components/panels/` — Left (hierarchy), Right (inspector), Bottom.
- `components/dialogs/` — Build, Settings, NewProject, Preview, MCP, **SetupWizard** (SDK/Unity path setup), Error.
- `utils/uiCodeSync.ts` — IR ↔ HTML serialization.

### Unity runtime engine — `UnityBackend/ArsistBuilder/Assets/Arsist/`
Interprets the IR at runtime, by domain: `Runtime/Scripting/` (Jint JS host + wrappers), `Runtime/Scene/`,
`Runtime/UI/`, `Runtime/DataFlow/`, `Runtime/Data/`, `Runtime/VRM/`, `Runtime/Network/` (WebSocket for Python),
`Runtime/Input/` (gaze), `Runtime/Events/`, `Runtime/Audio/`, `Runtime/Animation/`, `Runtime/Pooling/`.
`Editor/` holds the build pipeline + code generators. Key: [Editor/ArsistBuildPipeline.cs](UnityBackend/ArsistBuilder/Assets/Arsist/Editor/ArsistBuildPipeline.cs) (`BuildFromCLI` entry), [Runtime/XROriginSetup.cs](UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/XROriginSetup.cs) (runtime rig).

### Device adapters — `Adapters/<device>/`
Each = `adapter.json` (metadata) + `AndroidManifest.xml` + a C# build patcher. Present: `XREAL_One/`, `Meta_Quest/`.

---

## Build pipeline (IR → APK)

`renderer "Build"` → IPC `unity:build` → `UnityBuilder.build()` runs 6 phases:
`prepare-unity` → `prepare-jint` → `transfer` (writes `manifest/scenes/ui_layouts/dataflow/scripts.json`) →
`patch` (device adapter manifest + editor scripts) → `sdk` (copy XREAL/Quest packages into Unity `Packages/`) →
`build` (spawn Unity `-batchmode -nographics -quit`, invoke `ArsistBuildPipeline.BuildFromCLI`). See `doc/04-unity-builder.md`.

**The working Unity project is reused between builds** (`<outputPath>/TempUnityProject`) so `Library/` — and with it
asset imports, C# compilation, IL2CPP and Gradle output — stays warm. Everything Arsist copies in goes through
`syncDirectory()` (source-stamp diffing, `.arsist-sync.json` sidecar), never a blind `overwrite` copy: rewriting
mtimes would make Unity re-import the file and defeat the cache. A full rebuild is triggered by the `cleanBuild`
flag or by a change of Unity editor / target device / template `ProjectSettings`.

---

## Device path map — who owns what (XREAL vs Quest)

Both devices are **build-time adapters over Unity XR**; tracking is entirely inside the vendor SDK. The engine's job is
to configure Unity + the scene the way the SDK expects, then get out of the way.

| Concern | Engine code | Delegated to (SDK ground truth) |
|---------|-------------|--------------------------------|
| XREAL player/graphics settings | [XrealBuildPatcher.cs](Adapters/XREAL_One/XrealBuildPatcher.cs) `ApplyPlayerSettings` | must satisfy `sdk/com.xreal.xr/.../Editor/XREALProjectValidator.cs` (minSdk29, IL2CPP, ARM64, OpenGLES3) |
| XREAL XR loader | `XrealBuildPatcher.ConfigureXRLoader` | `Unity.XR.XREAL.XREALXRLoader`, registered by `sdk/.../Editor/XREALMetadata.cs` (loader name `"XREAL"`) |
| XREAL session config | `XrealBuildPatcher.EnsureXrealSettingsConfigObject` | `Unity.XR.XREAL.XREALSettings` (key `com.unity.xr.management.xrealsettings`); embedded by `XREALBuildProcessor : XRBuildHelper<XREALSettings>` |
| XREAL Android manifest | [Adapters/XREAL_One/AndroidManifest.xml](Adapters/XREAL_One/AndroidManifest.xml) | `sdk/.../Editor/Android/XREALManifestProvider.cs` **auto-injects** `nreal_sdk`, `com.nreal.supportDevices`, `autoLog`; removes LAUNCHER when `SupportMultiResume` |
| XREAL scene rig | [ArsistBuildPipeline.cs](UnityBackend/ArsistBuilder/Assets/Arsist/Editor/ArsistBuildPipeline.cs) `CreateXROrigin` | canonical = SDK prefab **`XR Interaction Setup`** (carries `XREALSessionManager`, `XREALTrackingModeChangeListener`, InputActionManager w/ `XREAL Actions`, XR Origin cam=black FOV≈25). Note its inner XR Origin is a nested **XRI Starter Assets** prefab (external dep) |
| XREAL runtime pose/DoF | `XROriginSetup.cs` | `XREALUtility.MainCamera` = `XROrigin.Camera` via TrackedPoseDriver; DoF via `XREALPlugin.SwitchTrackingTypeAsync`; `TrackingType {MODE_6DOF,MODE_3DOF,MODE_0DOF,MODE_0DOF_STAB}` |
| Quest player settings + manifest | [QuestBuildPatcher.cs](Adapters/Meta_Quest/QuestBuildPatcher.cs) | Meta XR SDK; Vulkan+GLES3, SinglePassInstanced, OVRManager |
| Background (passthrough vs VR) | `ArsistBuildPipeline.GetBackgroundMode` / `ApplyBackgroundToCamera` / `ConfigureQuestPassthrough` + `XROriginSetup.ApplyBackground` | `OVRPassthroughLayer` (Underlay) + `OVRManager.isInsightPassthroughEnabled` + `OculusProjectConfig._insightPassthroughSupport` |
| Interaction (controller ray / hand tracking) | `ArsistBuildPipeline.GetInteractionSettings` / `ApplyInteractionSettings` → `XROriginSetup._enableRayInteraction` (trigger-select) + [Runtime/Input/ArsistHandInteraction.cs](UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/Input/ArsistHandInteraction.cs) (pinch-select, Quest only) | `Unity.XR.Hands.XRHandSubsystem` (`com.unity.xr.hands`, gated by `#if XR_HANDS`) via OpenXR Hand Tracking Subsystem feature |

**Why XREAL was less stable than Quest:** the engine reimplemented (via reflection + manual manifest/scene patching)
things the SDK does automatically, and some of it conflicted (LAUNCHER vs multi-resume; fictional `XREALSessionConfig`
component; missing `XREALSessionManager` stability logic; unset stereo mode). The direction is to lean on the SDK.

**Known XREAL constraints — do not regress these:**

- `XREALSettings.SupportMultiResume` defaults to `true`, and `XREALManifestProvider` then **removes every
  `activity/intent-filter`** — including the MAIN/LAUNCHER one Arsist ships. `ConfigureXrealSettingsFields` forces
  it to `false` so the app keeps a launcher icon.
- `XREALUtility.MainCamera` resolves **only** through `FindAnyObjectByType<XROrigin>().Camera`. A bare
  `AddComponent<XROrigin>()` leaves that null and silently disables `XREALSessionManager`. `CreateXROrigin` wires
  `Camera` / `CameraFloorOffsetObject` explicitly.
- The SDK prefab `XR Interaction Setup` **cannot be instantiated as shipped**: its nested `XR Origin (XR Rig)`
  lives in the XRI *Starter Assets* sample, which Arsist does not import (`Missing Nested Prefab Asset` in the
  Unity log). That is why `CreateXROrigin` still hand-rolls the rig. Importing that sample is the proper fix.
- Always-on-top HUD lives on its own **`ArsistHUD` layer**, not `UI`. The HUD camera (`depth=100`,
  `clearFlags=Depth`) renders that layer and the main camera excludes it — otherwise both draw the HUD and it
  burns in twice on the additive see-through display. World-placed UI Surfaces stay on `UI` so they remain
  depth-sorted against the scene.
- Graphics Jobs is unsupported on OpenGLES; XREAL is GLES3-only, so `PlayerSettings.graphicsJobs` must stay
  `false`.
- **Spawn viewpoint = the scene origin.** `XROrigin.RequestedTrackingOriginMode` defaults to `NotSpecified`, and
  the resulting height is device-dependent: in `Device` mode XROrigin adds `CameraYOffset` (default **1.1176 m**)
  to the floor-offset object, and in `Floor` mode (what Quest reports) the pose carries the user's real height
  instead. Either way content authored at `(0,0,0)` lands somewhere other than the user's eye, differently per
  device. `PinSpawnViewpointToOrigin()` forces `Device` + `CameraYOffset = 0` so the session-start head pose is
  exactly the origin — which is what the editor's spawn-viewpoint marker draws.
- Background mode is **only** a Quest concept. On XREAL, black (RGB 0) is transparent in the optical combiner, so
  a skybox or solid-colour background does not hide reality — it just tints the view. `GetBackgroundMode()`
  therefore pins XREAL to `passthrough` and logs a warning if the project asked for anything else.
- XREAL SDK 3.1.0 ships several AARs (`nr_common`, `nr_loader`, …) that **all declare
  `package="nrsdk.pack"`**. AGP 8 (Unity 6) rejects a namespace shared by multiple libraries, so the Gradle
  manifest merger fails with `Namespace 'nrsdk.pack' is used in multiple modules and/or libraries`. This built
  fine on Unity 2022/AGP 7. `XrealBuildPatcher.EnsureUniqueAarNamespaces()` rewrites the namespace inside the
  *copied* AARs under `Packages/com.xreal.xr` (never `sdk/`). Safe because those AARs carry only native `.so`
  files — empty `classes.jar`, empty `R.txt`, no `res/`.
- When rewriting an AAR, **never use `ZipArchiveMode.Update`**. Mono's implementation produces an archive whose
  central directory lists every entry but whose *local headers* stop being walkable partway through. Gradle
  extracts AARs sequentially (`ZipInputStream`-style), so it silently drops the entries after the break and
  `AarResourcesCompilerTransform` dies with `NoSuchFileException: .../AndroidManifest.xml` — while `unzip -l`
  and any central-directory reader show the file as present. `WriteAarNamespace()` writes a fresh archive with
  `ZipArchiveMode.Create` and verifies the local-header chain before swapping the file in.

---

## Task index — "I want to change X, look here"

- **Unity editor / Android SDK / JDK / license detection, OS paths** → `src/main/platform/` + [UnityBuilder.ts](src/main/unity/UnityBuilder.ts) + [main.ts](src/main/main.ts) `findUnityCandidates`.
- **A build fails / retry / licensing** → [UnityBuilder.ts](src/main/unity/UnityBuilder.ts) `build()` and retry ladder.
- **XREAL setup / stability / DoF / manifest** → [XrealBuildPatcher.cs](Adapters/XREAL_One/XrealBuildPatcher.cs) + `CreateXROrigin` in [ArsistBuildPipeline.cs](UnityBackend/ArsistBuilder/Assets/Arsist/Editor/ArsistBuildPipeline.cs); ground truth in `sdk/com.xreal.xr/package/`.
- **Quest setup** → [QuestBuildPatcher.cs](Adapters/Meta_Quest/QuestBuildPatcher.cs).
- **Where the user starts / what they see** → `SpawnViewMarker` in
  [SceneViewport.tsx](src/renderer/components/viewport/SceneViewport.tsx) (FOV read from the adapter's
  `display.fieldOfView`, toggled by `showSpawnView`) + `PinSpawnViewpointToOrigin` in `ArsistBuildPipeline.cs`.
  Coordinate contract documented in `doc/01-ir-types.md`.
- **Background: passthrough (MR) vs skybox/solid (VR)** → `arSettings.backgroundMode` in the Build dialog →
  `ArsistBuildPipeline` (`GetBackgroundMode`, `ApplyBackgroundToCamera`, `ConfigureQuestPassthrough`,
  `ConfigureOculusProjectConfigForQuest`) **and** `XROriginSetup.ApplyBackground`. Both sides must agree —
  `XROriginSetup.Awake()` reconfigures the camera at runtime, so a build-time-only change is silently undone.
- **Interaction: controller ray vs hand tracking** → `arSettings.interaction` in the Build dialog →
  `ArsistBuildPipeline` (`GetInteractionSettings`, `ApplyInteractionSettings`) → `XROriginSetup._enableRayInteraction`
  (trigger-select ray, XREAL+Quest) and/or `Arsist.Runtime.Input.ArsistHandInteraction` (pinch-select, Quest only,
  `#if XR_HANDS`). Both call `SendMessage("OnGaze{Enter,Exit,DwellSelect}")` on the hit object — the same messages
  `ArsistGazeInput`/`ArsistGazeTarget` use — so any interactable authored for gaze also works with the other two.
  Building with both `controllerRay` and `handTracking` off is rejected (`UnityBuilder.ts` validation, and
  `ArsistBuildPipeline` as a defense-in-depth check) since the built app would be unoperable.
- **Add a new device** → new folder in [Adapters/](Adapters/) (`adapter.json` + manifest + patcher); see `doc/05-adapter-manager.md`.
- **IR schema / a new project field** → [src/shared/types.ts](src/shared/types.ts) (then bridge + Unity consumer).
- **IR → Unity JSON mapping** → [src/bridge/UnityBridge.ts](src/bridge/UnityBridge.ts).
- **Editor UI / panels / viewports** → `src/renderer/components/`; state in `src/renderer/stores/`.
- **In-app JS scripting (Jint)** → `UnityBackend/.../Runtime/Scripting/`.
- **Runtime remote control (Python/WebSocket)** → [python/](python/) + `UnityBackend/.../Runtime/Network/ArsistWebSocketServer.cs`.
- **AI/MCP authoring tools** → [scripts/mcp-ir-server.mjs](scripts/mcp-ir-server.mjs); see `doc/09-mcp-server.md`.
- **Remote control wire protocol / batch commands** → `ArsistWebSocketServer.cs`
  (`DrainFrames` for framing, `ExecuteBatch` / `DispatchCommand` for dispatch). Note the remote API works in
  **runtime Unity world space**, not editor IR space.
- **Applied products (some built on the engine, some standalone)** → [products/](products/); e.g.
  [products/VirtualReal](products/VirtualReal/README.md) (VRChat → AR avatar mirroring, built on this
  engine's Unity runtime), [products/ArsistAIChat](products/ArsistAIChat/README.md) (AI chat over
  passthrough + hand tracking, built the normal way through this engine's editor/build pipeline — the
  reference example for `ArsistScriptEvent`-on-select, `api.post` with headers, and the `Input` element's
  system-keyboard bridge, see below), and [products/QuestAIChat](products/QuestAIChat/README.md) (the
  same idea but standalone WebXR — no Unity, no dependency on this engine's runtime at all, with its own
  hand-tracking-driven virtual keyboard instead of the OS system keyboard).
- **`Input` UI element → Quest system keyboard** → selecting an `Input` element (gaze/ray/hand, same path
  as Button) calls `Arsist.Runtime.Input.ArsistSystemKeyboardTarget.OpenKeyboard()`, which opens Unity's
  `TouchScreenKeyboard` — Quest's OS-level keyboard overlay, not a custom in-app keyboard. Requires the
  `oculus.software.overlay_keyboard` manifest `uses-feature` (added automatically, only when a project has
  an `Input` element — `ArsistBuildPipeline.ProjectHasInputElement`/`QuestBuildPatcher.ConfigureSystemKeyboard`)
  and (unconfirmed field name, best-effort) `OVRManager.requireSystemKeyboard`.
- **Script engine (Jint, JS) → UI selection wiring** → a UI element selected via gaze/controller-ray/hand
  (any of them; they all funnel through `ArsistGazeTarget.OnGazeDwellSelect`) fires
  `ArsistScriptEvent.Fire(bindingId)`, which a script with `trigger: {type: "event", value: bindingId}`
  picks up (`ScriptTriggerManager.cs`). `ApiWrapper.cs`'s `api.get`/`api.post` take an optional
  `headersJson` overload for `Authorization` etc. — needed for calling any keyed external API from a
  script. Globals exposed to script JS: `api`, `ui`, `store`, `scene`, `vrm`, `remote`, `log`, `error`
  (`ScriptEngineManager.cs`).

## Gotchas / non-obvious constraints

- `sdk/` is **gitignored and user-supplied** (XREAL/Quest/UniVRM/Jint). It must exist to build; `package.json`
  `extraResources` references it.
- `sdk/com.xreal.xr/package/Runtime/Scripts/XREALXRLoader.cs` has **local (non-pristine) modifications** — don't
  assume it matches stock SDK 3.1.0.
- Unity version: project is pinned in `ProjectVersion.txt`; keep detection scripts and README consistent with it.
- Standalone helper scripts (`scripts/*.js`) reconstruct the electron-store config path by hand — keep in sync with
  `src/main/platform/` config-path logic.
