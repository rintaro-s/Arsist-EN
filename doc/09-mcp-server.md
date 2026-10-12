# MCP server, AI agent registration and the built-in assistant

Arsist exposes its IR to AI agents as a set of [MCP](https://modelcontextprotocol.io/) tools. The same tool set is
used by two different callers:

| Caller | How it runs the tools | Code |
|---|---|---|
| External agents (Claude Code, Codex, Qwen Code, Claude Desktop, Gemini CLI, Cursor, VS Code, Windsurf, LM Studio, anything that speaks MCP) | stdio MCP server started **by the agent** | `src/main/mcp/server.ts` (launcher `scripts/mcp-ir-server.mjs`) |
| Built-in assistant (any OpenAI-compatible `/chat/completions` endpoint with function calling) | in the editor's main process | `src/main/agent/assistant.ts` |

There is one tool implementation, `src/main/mcp/tools.ts` (`ARSIST_TOOLS`, `callArsistTool`). Add a tool there and
both callers get it.

---

## Files

| File | Role |
|---|---|
| `src/main/mcp/tools.ts` | Every tool: name, description, JSON schema, `readOnly`, `run(args, session)` |
| `src/main/mcp/scriptReference.ts` | Script API reference (`arsist_script_reference`, also put in the assistant's system prompt). Each installed extension's README `## スクリプト` section is appended |
| `src/main/mcp/server.ts` | `runStdioServer()` — stdio MCP server, tool annotations (`readOnlyHint`), errors as `isError` |
| `src/main/mcp/sdk.ts` | Loads `@modelcontextprotocol/sdk` through `require` (main tsconfig uses node10 resolution, which ignores `exports`) |
| `src/main/mcp/launch.ts` | `arsistLaunchSpec()` — the command an agent should run; `selfTestMcp()` — starts it exactly like an agent would and lists the tools |
| `src/main/mcp/agentTargets.ts` | One-click registration into each agent's settings file |
| `src/main/project/projectIO.ts` | Safe read/modify/write of a project from outside the editor |
| `src/main/project/projectWatcher.ts` | Watches the open project so the editor sees what an agent wrote |
| `src/main/ipc/aiIpc.ts` | IPC: `mcp:*`, `assistant:*`, `project:export-package` / `import-package` |
| `scripts/mcp-ir-server.mjs` | Thin launcher: requires `dist/main/main/mcp/server.js` |

---

## How the server is started

An MCP stdio server is started by the agent, not by the editor. The agent runs the Electron binary as plain Node:

```json
{
  "mcpServers": {
    "arsist": {
      "command": "<path to the Arsist / Electron executable>",
      "args": ["<app root>/scripts/mcp-ir-server.mjs"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1",
        "ARSIST_PROJECT_PATH": "<project folder, optional>"
      }
    }
  }
}
```

| Env | Meaning |
|---|---|
| `ELECTRON_RUN_AS_NODE=1` | Required. Without it Electron opens a window instead of running the script (the old implementation broke on this) |
| `ARSIST_PROJECT_PATH` | Default project. Optional — without it the agent calls `arsist_open_project` (or passes `projectPath` per call). `MCP_PROJECT_PATH` is still accepted |
| `ARSIST_APP_ROOT` | Set for packaged builds so the launcher finds `dist/` inside the app |
| `ARSIST_EXTENSIONS_DIR` | Extensions folder (default: `<config dir>/extensions`) |

`dist/main` must exist (`npm run build:main`); the launcher says so on stderr if it does not.

---

## One-click registration (MCP dialog)

Toolbar → **Connect AI agents (MCP)**. For every agent the dialog shows whether it is installed (its config folder
or CLI exists), whether Arsist is registered, and Add / Update / Remove.

| Agent | Where it is written |
|---|---|
| Claude Code | `claude mcp add-json arsist … --scope user` when the CLI is on PATH; otherwise `~/.claude.json` `mcpServers` |
| Claude Desktop | `<appData>/Claude/claude_desktop_config.json` |
| Codex CLI | `$CODEX_HOME` or `~/.codex/config.toml`, `[mcp_servers.arsist]` |
| Qwen Code | `~/.qwen/settings.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| Cursor | `~/.cursor/mcp.json` |
| VS Code (Copilot) | `<appData>/Code/User/mcp.json` (`servers`) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| LM Studio | `~/.lmstudio/mcp.json` |

`<appData>` = `%APPDATA%` (Windows), `~/Library/Application Support` (macOS), `$XDG_CONFIG_HOME` or `~/.config` (Linux).

Rules (the files belong to other programs):

- Only the `arsist` entry is touched; every other key and server is kept as is.
- Before the first change, the file is copied to `<file>.arsist-backup`.
- A file that is not valid JSON is **not** rewritten (status "unreadable").
- Writes are atomic (temp file + rename).
- Status "outdated" means an `arsist` entry exists but points somewhere else (e.g. the app moved); Update rewrites it.

Anything not listed: **Copy JSON** (the block above) or **Copy command**. **Test the server** launches the server
the same way an agent would and reports the tool count, so a broken path shows up before the agent is restarted.

---

## Writing safely while the editor is open

The agent edits the files; the editor holds its own copy in memory. To keep both consistent:

1. **Atomic writes** — every JSON file is written to a temp file and renamed (`atomicWriteJson`), also by the editor's
   own `saveProject`. A reader never sees half a file.
2. **One write at a time per project** — `withProjectWrite` queues read-modify-write per path inside a process.
3. **IR version** — tools refuse to write to a project whose IR is older than this Arsist (open it in the editor
   and accept the upgrade first; projects are never upgraded silently) and refuse to read a newer one.
4. **Editor reload** — `ProjectWatcher` watches `project.json`, `Scenes/`, `UI/`. The editor's own writes are
   recognised by content hash and ignored. On an external change:
   - no unsaved edits → the editor reloads quietly, keeping the current scene, layout, selection and script;
   - unsaved edits → a banner asks: reload (drop mine) or keep mine (saving overwrites theirs).

---

## Editing the files directly (no MCP needed)

The IR is plain JSON, so any agent that can edit text can work on a project, and the open editor follows along.

| File | Holds |
|---|---|
| `project.json` | everything: settings, `scripts[]` (code inline), `dataFlow`, `extensions`, `models`, and copies of `scenes[]` / `uiLayouts[]` |
| `Scenes/<id>.json`, `UI/<id>.json` | one scene / one UI layout each |

**Two copies.** Scenes and UI layouts are written in both places. Before, the per-file copy always won, so an edit
inside `project.json` was ignored and then erased by the next save (a scene without a `Scenes/` file was dropped).
Now `src/main/project/sceneCopies.ts` decides:

1. Both copies the same → nothing to decide.
2. The editor remembers what each copy looked like last time (`CopySeen`) → it uses the copy that changed. If both
   changed differently, the per-file copy wins and the console says so.
3. On first open (and in the MCP server, which has no history) → the newer file by mtime; a tie goes to the per-file copy.
4. Then the editor **writes the chosen content into the other copy**, so the next reader (an agent, MCP, a build) never
   edits a stale copy. It writes exactly what was chosen (not the filled-in defaults), and never into a file that is
   being written or into a project waiting for an IR upgrade.

**Live reload.** `ProjectWatcher` watches the project folder (not single files — the editor saves by rename, which
would detach a per-file watch) and the editor reloads about 0.45 s after a write, keeping the view, selection, camera
and loaded models. With unsaved edits it asks first.

**Half-written / invalid files.** While `project.json` or a `Scenes/` / `UI/` file is not valid JSON, the editor keeps the
last good content and shows a banner with the line and column (`describeJsonError`, which locates the error itself —
V8 does not always say where). It reloads by itself once the file is valid.

**Tolerant loading.** Missing fields are filled in rather than crashing the view (`src/shared/irRepair.ts`): object ids
(stable, from the position), `type` (guessed from `modelPath`), `transform` (`[x, y, z]` arrays accepted), UI element ids,
`style`, `children`, layout `scope` / `resolution`. Every fill-in is reported in the console as `[IR] …`, and
`ir_validate_project` returns the same notes (`files: …`) so an agent can see how its text was read.

Debugging: `ARSIST_DEBUG_WATCH=1` prints when each change is seen and when the editor is told.

---

## Tools (38)

`projectPath` is optional everywhere once a project is open (`ARSIST_PROJECT_PATH` / `arsist_open_project`).

| Group | Tools |
|---|---|
| Session | `arsist_open_project`, `arsist_list_recent_projects`, `arsist_script_reference` |
| Project | `ir_get_project`, `ir_validate_project`, `ir_list_devices`, `ir_set_target_device`, `ir_update_ar_settings` |
| Scene | `ir_list_scene_objects`, `ir_get_scene_object`, `ir_add_primitive`, `ir_import_model_asset` (.glb/.gltf/.vrm), `ir_place_model`, `ir_update_object_transform`, `ir_update_object`, `ir_remove_scene_object`, `ir_add_canvas_object` |
| UI | `ir_list_ui_layouts`, `ir_get_ui_layout`, `ir_add_ui_layout`, `ir_add_ui_element`, `ir_update_ui_element`, `ir_remove_ui_element` (elements by id or `bindingId`) |
| DataFlow | `ir_add_datasource`, `ir_update_datasource`, `ir_remove_datasource`, `ir_add_transform`, `ir_update_transform`, `ir_remove_transform` |
| Scripts | `ir_list_scripts`, `ir_get_script`, `ir_check_script`, `ir_add_script`, `ir_update_script`, `ir_remove_script` — the trigger is validated and code with a syntax error is refused (with the line) |
| Extensions | `ir_list_extensions`, `ir_set_extension`, `ir_set_object_extension` — values are checked against the extension's `extension.json` fields |

Errors come back as `{ "success": false, "error": "…" }` (MCP: `isError: true`) so the agent can correct itself.

Coordinates in the IR (also in `arsist_script_reference`): meters, origin = the head at start, **+Z ahead, +X = the
user's left**, +Y up.

---

## Built-in assistant

Toolbar → robot icon. A chat panel that sends the request to an OpenAI-compatible endpoint and lets the model call the
tools above in-process.

- **Settings**: preset (OpenAI, OpenRouter, DeepSeek, Qwen DashScope, Groq, Ollama, LM Studio, Custom), base URL
  (`…/v1`), API key, model (with "List models" → `GET /models`), max tool calls per request (default 24). The model must
  support function calling.
- **API key**: encrypted with Electron `safeStorage` (OS keychain) when available and never sent back to the renderer.
- **Before sending**: unsaved edits are saved (the tools read the files). Selection, target device and UI language are
  passed as context; the system prompt includes the script reference.
- **Undo**: before the first write of a request, `project.json`, `Scenes/` and `UI/` are copied to
  `Backups/agent/<timestamp>/`. "Undo these changes" restores that snapshot.
- **Stop** aborts the HTTP request; a dangling tool call in the history is repaired so the next request is valid.
- Tool results longer than 12k characters are truncated before they go back to the model.

---

## Tests

| Command | Covers |
|---|---|
| `npx vitest run src/main/mcp src/main/agent src/main/project` | tools, registration into a fake HOME, assistant loop against a mock HTTP server, packages, watcher |
| `npm run verify:mcp` / `npm run verify:mcp:full -- <project>` | the real stdio server through the MCP client SDK (needs `npm run build:main`) |

Not covered automatically: the packaged app (asar paths for `ARSIST_APP_ROOT`) and real agents / real API providers.
