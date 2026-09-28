# CLAUDE.md

Guidance for AI agents (Claude Code and others) working in this repository.

## Start here

Read [CODEMAP.md](CODEMAP.md) first for the module map and the XREAL/Quest device-responsibility map, then the
relevant deep-dive in [`doc/`](doc/) (`00-overview` … `16-models-beyond-vision`). [README.md](README.md) covers user-facing
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

- **IR is the source of truth.** TypeScript IR types live in [src/shared/types.ts](src/shared/types.ts); a schema
  change usually touches the type, [src/bridge/UnityBridge.ts](src/bridge/UnityBridge.ts), and the Unity consumer.
- **IR has a version.** When `project.json` changes shape, bump `CURRENT_IR_VERSION` in
  [src/shared/irVersion.ts](src/shared/irVersion.ts) and add a migration in
  [src/main/project/migrations.ts](src/main/project/migrations.ts) (+ `ir.migration.<n>` string + test).
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
- Inside any `Arsist.Runtime.*` namespace, a bare `Input` resolves to the sibling namespace
  `Arsist.Runtime.Input`, **not** `UnityEngine.Input` (C# walks up the namespace chain before it looks
  at `using` directives). Always write `UnityEngine.Input.gyro` etc. — this broke the build once.
