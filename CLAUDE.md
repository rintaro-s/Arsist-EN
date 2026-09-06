# CLAUDE.md

Guidance for AI agents (Claude Code and others) working in this repository.

## Start here

Read [CODEMAP.md](CODEMAP.md) first for the module map and the XREAL/Quest device-responsibility map, then the
relevant deep-dive in [`doc/`](doc/) (`00-overview` … `10-python-control`). [README.md](README.md) covers user-facing
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
npm run package        # electron-builder (needs sdk/ present)
npm run xreal:diag     # build + adb install + filtered logcat (needs Unity + device)
```

Unity builds and on-device verification require a full Unity install, the `sdk/` directory, and hardware — usually
**not available in an automated environment**. For non-Unity changes, `npm run build:main`, `npm run lint`, and
`npm test` are the fast feedback loop.

## Conventions

- **IR is the source of truth.** TypeScript IR types live in [src/shared/types.ts](src/shared/types.ts); a schema
  change usually touches the type, [src/bridge/UnityBridge.ts](src/bridge/UnityBridge.ts), and the Unity consumer.
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
