# CLAUDE.md

Guidance for AI agents (Claude Code and others) working in this repository.

## Start here

Read [CODEMAP.md](CODEMAP.md) first for the module map and the XREAL/Quest device-responsibility map, then the
relevant deep-dive in [`doc/`](doc/) (`00-overview` … `17-extensions`). [README.md](README.md) covers user-facing
setup.

## What this project is

Arsist is a **desktop authoring tool + Unity build pipeline** for AR-glasses apps — Electron/React (TypeScript) editor
+ Unity (C#) build backend + Python remote control. It does **not** implement head tracking itself; XREAL and Meta
Quest tracking/rendering are delegated to their Unity SDKs (`sdk/com.xreal.xr`, `sdk/quest`).

## Commands

```bash
npm install
npm run dev            # editor in dev (main tsc-watch + Vite + Electron)
npm run build          # build:main (tsc) + build:renderer (vite)
npm run build:main     # TypeScript main process only — fast typecheck of src/main
npm run lint           # eslint src --ext .ts,.tsx
npm test               # vitest
npm run test:perception # 姿勢推定・画像処理パイプライン・ジャイロを Unity 無しで数値検証 (dotnet)
npm run logs           # 実機アプリのログを LAN で受ける (adb 不要, doc/13-device-logs.md)
npm run package        # electron-builder (needs sdk/ present)
npm run xreal:diag     # build + adb install + filtered logcat (needs Unity + device)
npm run ext:new -- <id> [--requires cap:hand-tracking]   # scaffold an extension (Extensions/<id>/)
npm run ext:new -- <id> --device My_Glasses              # scaffold an extension that adds a device (adapter + XR hook)
npm run ext:pack -- <extension folder>                   # → <id>-<version>.arsist (zip + SHA-256 of every file)
npm run ext:install -- <file.arsist | folder> [--force]  # same as the editor's Extensions → Import
npm run ext:override -- <extension folder> <path under Assets/Arsist>  # start an engine modification
npm run ir:new -- "<説明>" ["<English>"]                  # scaffold an IR version bump (+ migration + upgrade text)
```

Unity builds and on-device verification require a full Unity install, the `sdk/` directory, and hardware — usually
**not available in an automated environment**. For non-Unity changes, `npm run build:main`, `npm run lint`, and
`npm test` are the fast feedback loop. The perception geometry
(`Runtime/Perception/Vision/{LinAlg,Homography,PlanarPoseSolver}.cs`) has no UnityEngine dependency and is
covered by `npm run test:perception` — **run it whenever that math changes**, because a wrong sign there
compiles cleanly and only shows up as a misplaced anchor on hardware.
The same applies to the image pipeline (`Runtime/Perception/{Vision/Classic,Pipeline}/`) and the phone
gyro maths (`Runtime/Tracking/{GyroMath,PhoneCameraMath}.cs`): they are deliberately UnityEngine-free so
the same harness covers them — see `doc/14-classic-vision.md` for the mistakes it has already caught.
**The engine provides general vision steps only; never add an app-specific mode** (a "sky" feature was
added once and reverted — users must be able to build such apps themselves in the Vision editor).
The Vision tab itself is **hidden by default** (Settings → Models → "Show the Vision tab"); the pipeline,
its runtime and its builds are untouched by that switch.
Trained models are ONNX plus an IR-side definition (`ModelDefinition`), never a converted format;
pre/post-processing lives in `Runtime/Perception/Models/` and is UnityEngine-free for the same reason
(`doc/15-models-and-ir-versions.md`). Models are a project asset, not part of vision: `use` is
`image` / `text` / `tensor`, and text models (LLMs, embeddings) run through `Runtime/Inference/`
(tokenizer, generation, KV cache — also UnityEngine-free and covered by `npm run test:perception`)
and the script API `model.*` (`doc/16-models-beyond-vision.md`). Models can be pulled straight from
Hugging Face (repo → precision variants → download), with an optional token in Settings.
There are **two device runtimes**, chosen per model (`ModelDefinition.runtime`, default automatic):
Unity's Inference Engine (GPU, standard ONNX ops only) and a **bundled ONNX Runtime**
(`Runtime/Inference/ArsistOrtRunner.cs` + `Editor/AndroidPlugins/ArsistOnnxRuntime.java.txt`, CPU, +33 MB,
added to a build only when some model needs it). Unity's importer has no `If`/`Loop` or `com.microsoft`
ops (`src/shared/unityOps.ts`), which rules out most current LLM exports, so those are routed to ONNX
Runtime automatically. Keep that op table in sync with `ArsistBuildPipeline.UnityImportableOps`.

## Conventions

- **New features go in as extensions when they can.** An extension is one folder, `Extensions/<id>/`
  (`extension.json` + `Runtime/*.cs` + optional `Editor/*.cs`), and touches the engine only through
  `ArsistExtensionContext` / `ArsistScriptBridge` (runtime) and `ArsistBuildContext` (build). Its settings and
  per-object options are declared in `extension.json` (the editor forms are generated from that) and live in
  `project.extensions.<id>` / `SceneObject.ext.<id>`, with their **own** `dataVersion` + declarative migrations —
  an extension's data change never needs an IR bump. `doc/17-extensions.md`; worked examples
  `samples/extensions/{quest-room,quest-input}/` — **samples, not part of the engine**: they load because that
  folder is registered (`npm run ext:link -- samples/extensions`, stored as `extensionFolders` in config.json and
  read by the editor, builds and the MCP server). `Extensions/` holds the **official** extensions that ship with the engine (now `vrm10`); put only general-purpose ones there.
- **Extensions may add devices (`provides.adapters` + `Adapters/<name>/`), SDKs (`unity.packages`) and engine
  modifications (`unity.overrides`, files under `Overrides/` replacing `Assets/Arsist/<path>` in the build workspace
  only, guarded by the original's SHA-256).** Never edit the engine to support one device or one app when an
  extension can carry it. Adapter lookup for every caller goes through `src/main/adapters/adapterDirs.ts`.
- **To swap out part of the engine, prefer a replaceable part over an override.** `extension.json` `"replaces"` names
  parts from `src/shared/engineParts.ts` (`vrm-loader`, `storage-backend`, `script:<built-in name>`); the entry passes an
  implementation of the part's C# interface in `ReplaceEngineParts` (or `script.Set` for a script name). Only one enabled
  extension may replace a part (the build stops otherwise), and the runtime refuses undeclared replacements. To make
  another engine piece replaceable: add an interface, route the engine's use through `ArsistEngineParts.Get`, and add one
  line to both `engineParts.ts` and `ArsistEngineParts.cs` (a test checks they match). `unity.unitypackages` brings a
  `.unitypackage` (unpacked by the build, removed again when the extension leaves). doc/17 §2.6.
- **A project that enables an extension (or targets a device) this editor lacks does not open** — the load returns
  `requirementsMissing` and the editor offers to import the `.arsist` / folder. Builds apply the same rule.
- **Devices, engine features and extensions meet through tags, not names.** `adapter.json` (`capabilities` +
  `tags`) gives a device its tags (`src/shared/adapterTags.ts`), `src/shared/engineFeatures.ts` says what each
  engine feature needs, an extension's `requires` says where it runs. Prefer adding a tag over another
  `isQuestTarget()`-style name check. `requires` lists only hard needs (a feature with a fallback has none).
- **IR is the source of truth.** TypeScript IR types live in [src/shared/types.ts](src/shared/types.ts); a schema
  change usually touches the type, [src/bridge/UnityBridge.ts](src/bridge/UnityBridge.ts), and the Unity consumer.
- **IR has a version.** When `project.json` changes shape, bump `CURRENT_IR_VERSION` in
  [src/shared/irVersion.ts](src/shared/irVersion.ts) and add a migration in
  [src/main/project/migrations.ts](src/main/project/migrations.ts) (+ `ir.migration.<n>` string + test).
  `npm run ir:new` scaffolds all three; write the change as declarative ops (`src/shared/irOps.ts`:
  default / set / rename / remove / map) and only fall back to an `apply` function when ops cannot say it.
  `migrations.test.ts` checks every step for gaps, idempotence and both upgrade texts automatically.
  Old projects open read-only until the user accepts the upgrade; never silently rewrite them.
- **Device support = adapters.** Add a folder under [Adapters/](Adapters/); don't hardcode device logic elsewhere.
- **Prefer the SDK's intended setup over reimplementation.** For XREAL, configure Unity/the scene the way
  `sdk/com.xreal.xr/package/` (settings, validator, manifest provider, `XR Interaction Setup` prefab) expects, rather
  than re-deriving it with reflection. This is the main lever for XREAL stability.
- **Cross-platform:** keep OS-dependent path/tool detection in `src/main/platform/` (Linux and Windows are equal
  first-class targets; macOS best-effort). Don't scatter new `process.platform` branches.
- Match surrounding code style, comment density, and naming (mixed Japanese/English comments are normal here).
- **i18n (English/Japanese):** all user-facing renderer text goes through the string table in
  [src/renderer/i18n/strings.ts](src/renderer/i18n/strings.ts) (each key holds `{ en, ja }`). Read it with the
  `useT()` hook (`const t = useT(); t('scope.key')`, `{param}` interpolation via `t('key', { param })`). Add a key
  first, then reference it — never hardcode UI strings. The native (main-process) menu has its own small table in
  [src/main/main.ts](src/main/main.ts) (`MENU_STRINGS` / `mt()`), rebuilt via the `app:set-language` IPC. Default
  language is Japanese; the switch lives in Settings and is persisted in electron-store (`language`).
- **Theming (dark/light):** colors are CSS variables (RGB channel triples) in
  [src/renderer/styles/globals.css](src/renderer/styles/globals.css), exposed to Tailwind as `arsist-*` classes.
  Use tokens (`bg-arsist-surface`, `text-arsist-muted`, …), not hardcoded hex, so both themes work. The design is
  **flat**: prefer surface contrast + spacing over borders; use the `.hairline*` utilities for the rare divider, and
  avoid heavy frames/shadows. Theme is toggled via `data-theme` on `<html>` (see `src/renderer/theme/`), persisted in
  electron-store (`theme`).

- **AI tools live in one place.** MCP tools are TypeScript in `src/main/mcp/tools.ts`; the stdio server
  (external agents) and the built-in OpenAI-compatible assistant (`src/main/agent/`) both call them. Out-of-editor
  writes go through `src/main/project/projectIO.ts` (atomic, queued, refuse other IR versions) and the editor
  reloads via `ProjectWatcher` — never write project files any other way. Registration into agents' settings
  (`agentTargets.ts`) only touches the `arsist` entry and backs the file up first. Test it with a fake `HOME`;
  never against your real `~/.claude.json` etc. See `doc/09-mcp-server.md`.

- **Script APIs are listed once, in [src/shared/scriptApi.ts](src/shared/scriptApi.ts).** The Script tab's reference and
  the agents' reference (`src/main/mcp/scriptReference.ts`) are both generated from it; a wrapper method that is not listed
  there is invisible to people and agents alike. Extension APIs come from each extension's README "スクリプト" section.

- **Characters (IR v5).** A VRM object's `character` (starting animation, blink, breathe, lookAtUser) makes it move; without
  it a VRM stands still. A VRM never shows a T-pose: whenever no animation plays, `ArsistCharacter` holds a relaxed standing
  pose (arms down, swaying a little) — `vrm.stopAnimation`, `then: "stand"`. Animations are humanoid FBX files in `Assets/Animations/<name>.fbx` (the file
  name is the animation name everywhere: `character.animation`, `vrm.playAnimation`, the generated AnimatorController's
  state names) — import them through `src/main/project/animationAssets.ts`, never with a hash suffix. The build imports
  them as Humanoid and generates the controller; `src/shared/characterChecks.ts` reports names that do not exist.
  The engine's own UniVRM is 0.x only (VRM 0.x models, no VRMA); VRM 1.0 models need the official `vrm10` extension
  (`Extensions/vrm10`, replaces `vrm-loader`), and while it is on the build leaves the engine's UniVRM 0.x out. `project.storage.persist` lists store keys kept on the device
  ("memory." = prefix, else exact key; `isPersistedKey` in types.ts and the runtime must agree).

- **Agents may edit the IR files directly** and the open editor reloads them (~0.45 s). Scenes / UI layouts exist in
  `project.json` *and* `Scenes/` / `UI/`; `src/main/project/sceneCopies.ts` picks the copy that changed and writes it
  into the other one, and `src/shared/irRepair.ts` fills in missing fields instead of crashing the view. Never make a
  loader that silently prefers one copy again (doc/09).

## Gotchas

- `sdk/` is gitignored and user-supplied; it must exist to build/package.
- `sdk/.../XREALXRLoader.cs` is locally modified — treat as project-specific, don't edit the SDK to fix engine bugs.
- Standalone scripts in `scripts/` reconstruct the electron-store config path manually — keep in sync with
  `src/main/platform/`.
- Keep the Unity version consistent across `ProjectVersion.txt`, detection scripts, and README.
- Camera frames are read back from the GPU already downscaled (`FrameBudget` decides the width) and the
  row order of that readback is **measured at runtime** (`GpuFrameReader.EnsureProbe`), not assumed.
  Don't reintroduce `GetPixels32` on the main thread; it stalls the frame.
- The Unity Inference Engine package is only in the workspace manifest when the project has models, so
  runtime code touching `Unity.InferenceEngine` must stay inside `#if ARSIST_INFERENCE`. That define is
  synced in two places (`UnityBuilder.syncInferenceDefine` before launch, `ApplyDeviceScriptingDefines`
  during the build); a stale define in a reused workspace breaks the editor compile.
- Vision ops that remember anything between runs (`track`, `stabilize`, `motion`, `event`) keep it in the
  per-task `VisionState`, keyed by op id; never in statics. The editor preview replays frame sequences
  through the same state, so a stateless shortcut would only look right on a single photo.
- **Android's entry point is forced to `Activity`** (`UseClassicAndroidActivity`), because Unity 6's default
  (GameActivity) has no working `TouchScreenKeyboard` and Meta's keyboard overlay needs `UnityPlayerActivity`.
  The entry point and the manifest go together: `UnityPlayerActivity` + `@style/UnityThemeSelector`, never
  `UnityPlayerGameActivity` + `@style/BaseUnityGameActivityTheme` (that theme only exists in a GameActivity
  build, so mixing them fails in AAPT with `resource style/BaseUnityGameActivityTheme not found`). An adapter's
  `AndroidManifest.xml` must use the Activity pair; the build rewrites it if it does not.
- **Vision `infer` only runs models Unity's engine can import.** Models routed to the bundled ONNX Runtime live
  in StreamingAssets, not Resources, so the vision pipeline cannot load them; the build now stops with a clear
  message instead of failing on the device. Such a model can still be driven from a script (`model.*`).
- **JNI cannot be called from a thread that is not attached to the JVM.** Unity's `AndroidJavaClass` /
  `AndroidJavaObject` do not throw in that case — they return `0` / `null` / `""`, so the failure surfaces as an
  error with no reason (the ONNX Runtime bridge did exactly this: `badInput:input_ids:` and nothing else).
  Any background thread that talks to Java must wrap its work in
  `AndroidJNI.AttachCurrentThread()` / `DetachCurrentThread()` (see `ArsistOrtRunner.RunBlocking`), or hand the
  call back to the main thread. The Java side itself can be exercised on a desktop JVM with
  `tools/ort-bridge-check`, but that cannot catch this — it only shows up on the device.
- **An extension's C# is only in builds whose device tags satisfy its `requires`** (`UnityBuilder.stageExtensions`
  copies it to `Assets/ArsistExtensions/<id>/` and removes it again when it no longer applies). So a Quest-only
  extension may use the Meta SDK directly, without `#if`, but a device-neutral one must not touch any device SDK.
  Its entry class is created by the generated `ArsistExtensionRegistry.g.cs` (no reflection), and its namespace
  is preserved via a generated `link.xml` — Jint calls script APIs by reflection, so a stripped method shows up
  only on the device as `undefined`. MonoBehaviours in an extension follow Unity's one-class-per-file-name rule.
- **Never put `[SerializeField]` / public serialized fields inside an `#if` whose define is set during the build**
  (`XR_HANDS`, `ARSIST_META_QUEST`, … are added in `ApplyDeviceScriptingDefines`, after the editor has already
  compiled without them). The editor and the player then disagree on the class layout and Unity stops with
  `script class layout is incompatible between the editor and the player`. Keep serialized fields outside the
  `#if` (see `ArsistHandInteraction`). `ARSIST_INFERENCE` avoids this differently: it is synced before Unity
  starts (`UnityBuilder.syncInferenceDefine`).
- **Hand tracking needs both `XR_HANDS` and the OpenXR "Hand Tracking Subsystem" feature** — until 2026-10 neither
  was set, so `ArsistHandInteraction` shipped as an empty class. Both are now set on Quest builds. Do not also enable
  "Meta Hand Tracking Aim": it makes hands appear as controllers, and the controller ray and the hand ray then both
  fire.
- **Do not use drei's `<Line>` in the editor; use `StableLine`** (`components/viewport/StableLine.tsx`). drei disposes
  the line's *material* whenever `points` is a new array (always, with inline literals), so every re-render of the 3D
  view — a reload, a selection, a gizmo drag — threw away the line shaders and froze the editor ~2 s recompiling them.
  More generally: never let a re-render dispose materials that are still on screen.
- **A dynamic TMP font drops characters silently when its atlas is full.** The bundled JKG-M3 samples at 90pt into one
  1024² atlas (~80 glyphs), so Japanese UI lost characters on the device ("ここに座れないな" → "こにれないな").
  `ConfigureDynamicFontAtlas` in the build pipeline turns on multi-atlas and makes the atlas 2048²; keep that if the font changes.
- **VRM expressions take 0..100**, not 0..1 (`VRMExpressionController.SetExpression`), and `VRMWrapper.setExpression` logs
  every call — anything that sets expressions every frame (lip sync, blinking) must call the controller directly.
- Inside any `Arsist.Runtime.*` namespace, a bare `Input` resolves to the sibling namespace
  `Arsist.Runtime.Input`, **not** `UnityEngine.Input` (C# walks up the namespace chain before it looks
  at `using` directives). Always write `UnityEngine.Input.gyro` etc. — this broke the build once.
