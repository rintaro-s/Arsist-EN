# Agent skills for Layster (Arsist's IR)

Skills in the [Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) format: each folder
holds a `SKILL.md` (YAML frontmatter `name` + `description` saying when to use it, then concise instructions) and
optional `reference/` files the agent opens only when needed. They teach an AI agent to write Layster and build apps
with the Arsist MCP tools.

| Skill | Use it for |
|---|---|
| [`layster-spatial/`](layster-spatial/SKILL.md) | Layster.Spatial apps (`project.spatial.json`): things placed by conditions in any room, AI minds, robot bodies, rules, `world.*` scripts, recording. References: full schema, validated recipes, vocabulary + test spaces + script API |
| [`layster-virtual/`](layster-virtual/SKILL.md) | Layster.Virtual apps (`project.json`): scenes, UI layouts, VRM characters, scripts, storage, extensions via the `ir_*` tools or direct edits |
| [`layster-mind-server/`](layster-mind-server/SKILL.md) | Wrapping your own model as a `layster.mind/1` server or a robot as a `layster.body/1` bridge, and testing it (curl, editor Mind I/O → Try) |

The skills describe the contracts in `src/shared/layster/spatial/`, `src/shared/types.ts`, `src/main/mcp/tools.ts` and
`src/main/mcp/spatialTools.ts`; `doc/19-layster.md`, `doc/20-spatial-runtime.md` and `doc/09-mcp-server.md` are the long
form. When those change, update the skills too (tool names, fields and defaults are quoted exactly).

## Prerequisite: the Arsist MCP server

The skills call the `arsist` MCP tools (`spatial_*`, `ir_*`, `arsist_*`). Register the server once from the editor
(toolbar → **Connect AI agents (MCP)** → Add for your agent), or add the JSON from `doc/09-mcp-server.md` by hand.
`npm run build:main` must have been run so `dist/main` exists. Without MCP the skills still help: both IR files are
plain JSON that agents may edit directly (the open editor reloads them).

## Using them with Claude Code

Claude Code loads skills from `.claude/skills/<name>/SKILL.md` (this project only) or `~/.claude/skills/<name>/SKILL.md`
(all projects). Copy or symlink the folders — symlinks keep them in sync with the repo:

```bash
# this repository only (run in the repo root)
mkdir -p .claude/skills
ln -s ../../skills/layster-spatial      .claude/skills/layster-spatial
ln -s ../../skills/layster-virtual      .claude/skills/layster-virtual
ln -s ../../skills/layster-mind-server  .claude/skills/layster-mind-server

# or for every project on this machine
mkdir -p ~/.claude/skills
ln -s "$PWD/skills/layster-spatial" "$PWD/skills/layster-virtual" "$PWD/skills/layster-mind-server" ~/.claude/skills/
```

On Windows use `mklink /D` (or copy the folders). Restart Claude Code (or start a new session); it picks a skill when
the task matches its `description`, or you can ask for it by name ("use the layster-spatial skill").

## Using them with other agents

- **Agents that support Agent Skills** (e.g. the Claude apps / API with skills, other SDK-based agents): upload or copy
  each folder as-is into the agent's skills location.
- **Agents without skill support** (Codex CLI, Qwen Code, Gemini CLI, Cursor, the built-in assistant's prompt …): point
  them at the file, e.g. in `AGENTS.md` / `GEMINI.md` / rules: "Before editing a Layster.Spatial project read
  `skills/layster-spatial/SKILL.md` and open its `reference/` files as needed." The content is plain Markdown and
  agent-neutral; only the MCP tool names are Arsist-specific.

## Keeping them correct

Every JSON example (recipes, tool calls, protocol messages, scenes/layouts) was checked against the code when written:
Spatial fragments pass `validateSpatialProject` with no problems, lower without warnings and were solved in all seven
built-in spaces (the "Lands" notes in `recipes.md` come from `solveAll`); tool-call examples were run through
`callArsistTool`; scripts pass `checkScriptSyntax`. After changing the IR, re-check the examples the same way
(a throwaway vitest that extracts the ```json blocks is enough).
