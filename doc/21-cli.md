# `arsist` — the command line

Everything the editor does to a project can be done from a shell, so CI jobs, AI agents without MCP and plain
scripts can drive Arsist without launching Electron. The CLI is a thin layer over the same compiled code the editor
uses (`dist/main`): the MCP tools (`src/main/mcp/tools.ts`), `SpatialProjectManager`, `ProjectManager`, the Spatial
validator / solver / lowering and `UnityBuilder`. Nothing is re-implemented, so the CLI cannot drift from the editor.

```bash
npm run build:main                  # once, and after pulling (the CLI says so when dist/main is missing or older than src/)
npm run arsist -- <command> …       # or: node scripts/arsist.mjs <command> …   or, after `npm link`: arsist <command> …
```

Entry point: `scripts/arsist.mjs` (`package.json` `"bin": { "arsist": … }`); argument parsing `scripts/lib/cli-args.mjs`;
tests `scripts/arsist.test.ts` (part of `npm test`).

## Conventions

| | |
|---|---|
| `--json` | Every command prints **one JSON object on stdout** (`{ "command", "ok", …, "exitCode" }`); logs, Unity output and warnings go to stderr. Exceptions: `logs --json` streams one object per line, `sim --json` prints the simulator's own summary, `mcp` speaks MCP on stdout |
| Exit codes | `0` ok · `1` failure (I/O, tool error, Unity build failed) · `2` usage (unknown command / tool / device / bad JSON) · `3` validation problems (`validate`, `lower`, `build` before Unity, `tool` whose result is `{ ok: false }`, `solve --strict`) |
| Help | `arsist help`, `arsist <command> --help` |
| npm | `npm run arsist -- …` prints npm's own `> arsist-engine@…` banner on stdout; for `--json` and `mcp` use `npm run -s arsist -- …` or `node scripts/arsist.mjs …` |
| Stale build | If a `src/{main,shared,bridge}` file is newer than its `dist/main` output, a warning on stderr asks for `npm run build:main` (the command still runs). `ARSIST_CLI_SKIP_STALE_CHECK=1` silences it |

### Settings

The CLI reads the editor's electron-store file (`config.json` in the folder from `src/main/platform/paths.ts`, located
through `scripts/lib/config-path.js` like the other scripts). Flags beat environment variables, which beat the file.
`arsist config` shows the result and where each value came from. The CLI never writes `config.json`, except
`arsist ext link|unlink` (same as the editor's "register folder").

| Setting | Flag | Environment | config.json key |
|---|---|---|---|
| Unity editor | `--unity` | `ARSIST_UNITY_PATH` | `unityPath` |
| SDK folder (`sdk/`) | `--sdk` | `ARSIST_SDK_DIR` | `sdkDir` |
| Build output folder | `--out` (build) | `ARSIST_OUTPUT_PATH` | `defaultOutputPath` |
| Unity licence file | `--license` | `ARSIST_MANUAL_LICENSE_FILE` | `unityManualLicenseFile` |
| Unity version hint | — | `ARSIST_UNITY_VERSION` | `unityVersion` |
| Installed extensions | — | `ARSIST_EXTENSIONS_DIR` | (`<config dir>/extensions`) |
| Extra extension folders (this run only) | `--ext-folder <dir>` (repeatable) | `ARSIST_EXTENSION_FOLDERS` (path-list) | `extensionFolders` (registered folders, always read) |
| Default project for `tool` | `--project` | `ARSIST_PROJECT_PATH` | — |

For an isolated run (CI, tests) point `HOME` / `XDG_CONFIG_HOME` (Windows: `APPDATA`) at an empty folder and pass
everything by flag or environment.

## Commands

### Projects

| Command | What it does |
|---|---|
| `arsist info <dir>` | Kind (`virtual` / `spatial`), Layster label ("Layster.Virtual β 1.0.0"), name, device, counts (scenes/objects/layouts/… or things/minds/bodies/rules/…), enabled extensions |
| `arsist validate <dir> [--device X]` | Virtual: `ir_validate_project` (missing extensions/device, unsupported features, script syntax, …). Spatial: `spatial_validate` + `checkProjectRequirements` (extensions and device present) + lowering warnings — the same checks a build runs. Exit 3 on errors |
| `arsist upgrade <dir>… [--dry-run]` | Upgrades old Layster.Virtual `project.json` (wraps `scripts/layster-upgrade.mjs`; backups in `Backups/`) |
| `arsist new virtual\|spatial <parentDir> <name> [--device X] [--template T]` | Creates `<parentDir>/<name>` like the editor's New Project (Virtual default `XREAL_One` + `3d_ar_scene`; Spatial default `Meta_Quest`). Refuses a folder that already holds a project |
| `arsist devices` | Device adapters (built in + from extensions) with their tags (`ir_list_devices`) |
| `arsist config` | The settings above and their sources |

### Agent tools without MCP

| Command | What it does |
|---|---|
| `arsist tools` | Every MCP tool (`arsist_*`, `ir_*`, `spatial_*`) with `readOnly` and the input schema (`--json` for the full list) |
| `arsist tool <name> [<json>] [--args-file f\|-] [--project dir]` | Calls one tool through `callArsistTool` with a `ToolSession`, exactly as the MCP server does; the result is under `result`. `--schema` prints that tool's schema instead |

```bash
arsist tool spatial_solve '{"spaces":["studio","tiny"]}' --project samples/spatial/desk-buddy --json
arsist tool ir_add_primitive --args-file add-cube.json --project ~/Apps/MyApp
echo '{"kind":"thing","id":"card"}' | arsist tool spatial_get --args-file - --project ~/Apps/Room
```

Each invocation is a new session, so pass `projectPath` in the arguments or `--project` (there is no
`arsist_open_project` state between calls). Writes go through `projectIO` / `withSpatialWrite` like every other
out-of-editor write, and an open editor reloads them.

### Layster.Spatial

| Command | What it does |
|---|---|
| `arsist solve <dir> [--space id]… [--thing id]… [--strict]` | Runs the placement solver (`spatial_solve`) in the project's test spaces or the named ones. `--strict`: exit 3 if any thing lands on `"default"` (nothing fit) |
| `arsist lower <dir> --out D [--device X]` | Validates, then writes `manifest.json`, `scenes.json`, `ui_layouts.json`, `scripts.json`, `spatial.json` — what the build hands to Unity (same as `layster-build.mjs --lower-only`) |

### Build

`arsist build <dir> [--device X] [--out D] [--dev] [--clean] [--unity P] [--sdk D] [--license F] [--timeout MIN] [--skip-validate] [--dry-run]`

Works for both profiles. Virtual takes the Build dialog's path (`readProjectFiles` → `generateBuildManifest` + the
script bundle → `UnityBuilder.build`); Spatial validates, lowers and passes `spatialData` (the `spatialIpc` path).
Validation errors stop it with exit 3 before Unity starts (`--skip-validate` to override). `--dry-run` only resolves
device, Unity, output and SDK (`ready`, `missing`, `sources`) — handy to check a CI machine. Ctrl-C cancels the
Unity build. The APK path is `apk` in the JSON.

### Everything else

| Command | What it does |
|---|---|
| `arsist ext <pack\|install\|link\|unlink\|links\|new\|override> …` | Same arguments as `npm run ext:<sub>` (`scripts/ext-tools.mjs`, `scripts/ext-new.mjs`); with `--json` the script's stdout is returned as `output` lines |
| `arsist logs [--for SEC] [--grep RE] [--level L] [--json]` | Device logs over the LAN (`scripts/arsist-logs.mjs`, doc/13). With `--for`, exit 1 when nothing arrived |
| `arsist mcp [--project dir]` | Starts the stdio MCP server (`runStdioServer`, doc/09) — an agent can register `node <repo>/scripts/arsist.mjs mcp` |
| `arsist sim <dir> [--engine preview\|unity] --out D [--space id] [--device X] [--times 0,2,5] [--width W --height H] [--json]` | Renders the project to PNGs + `result.json` without a device. `preview` (default) = `scripts/sim/preview.mjs`, a fast editor-like render; `unity` = `scripts/sim/unity.mjs`, the real runtime. All other arguments are passed through; if the simulator script is not present the CLI says so (exit 1) |

## Typical CI job

```bash
npm ci && npm run build:main
export HOME=$(mktemp -d)                      # never touch a developer's settings
arsist validate apps/room --json --ext-folder samples/extensions
arsist solve apps/room --strict --json
arsist lower apps/room --out out/lowered --ext-folder samples/extensions
ARSIST_UNITY_PATH=/opt/unity/6000.0/Editor/Unity ARSIST_SDK_DIR=$PWD/sdk \
  arsist build apps/room --out out/apk --json --ext-folder samples/extensions
```
