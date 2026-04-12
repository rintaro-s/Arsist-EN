# MCP Server — `scripts/mcp-ir-server.mjs`

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) stdio server that exposes the Arsist IR as a set of tools callable by AI agents (e.g. Claude via Claude Desktop).

---

## Purpose

Allows an AI model to author a complete Arsist project — creating scenes, placing 3D models, building UI layouts, configuring DataFlow — entirely through structured tool calls, without any GUI interaction.

---

## Transport

Stdio (`StdioServerTransport`). The server reads JSON-RPC from stdin and writes responses to stdout. Stderr is available for diagnostics.

The server is launched by the Electron main process via:
```
<electron-path> scripts/mcp-ir-server.mjs
```
with `MCP_PROJECT_PATH` injected into the environment.

---

## Internal Helpers

### `loadProject(projectPath)`

Reads `project.json` from disk, normalises `scenes`, `uiLayouts`, and `dataFlow` to arrays/objects if missing.

### `saveProject(projectPath, project)`

Updates `project.updatedAt`, writes `project.json`, and also writes individual `Scenes/<id>.json` and `UI/<id>.json` files.

### `getScene(project, sceneId?)`

Returns the scene matching `sceneId`, or the first scene if `sceneId` is omitted.

### `getLayout(project, layoutId?)`

Returns the layout matching `layoutId`, or the first layout if `layoutId` is omitted.

### `findElement(root, elementId)`

Recursive depth-first search through a `UIElement` tree.

---

## Tool Reference (17 tools)

### Scene / Model

| Tool | Required args | Description |
|------|--------------|-------------|
| `ir_get_project` | `projectPath` | Returns project summary (scenes, layouts, dataFlow counts) |
| `ir_import_model_asset` | `projectPath`, `sourcePath` | Copies a GLB/GLTF file into `Assets/Models/` with a content-hash suffix; returns `assetPath` |
| `ir_place_model` | `projectPath`, `modelAssetPath` | Adds a `type:'model'` SceneObject with optional transform; returns the object |
| `ir_list_scene_objects` | `projectPath` | Lists all objects in the scene (id, name, type, modelPath, transform) |
| `ir_update_object_transform` | `projectPath`, `objectId` | Partial-updates position/rotation/scale |
| `ir_remove_scene_object` | `projectPath`, `objectId` | Removes object from scene |
| `ir_add_canvas_object` | `projectPath` | Adds a `type:'canvas'` object linked to a layout; creates default `canvas` scope layout if none exists |

### UI

| Tool | Required args | Description |
|------|--------------|-------------|
| `ir_list_ui_layouts` | `projectPath` | Lists all layouts with scope, resolution, root element count |
| `ir_add_ui_element` | `projectPath`, `type` | Appends a UIElement to a parent (or root) in a layout |
| `ir_update_ui_element` | `projectPath`, `elementId` | Updates type/content/bind/style/layout of an element |
| `ir_remove_ui_element` | `projectPath`, `elementId` | Removes element from tree recursively |

### DataFlow

| Tool | Required args | Description |
|------|--------------|-------------|
| `ir_add_datasource` | `projectPath`, `type`, `mode`, `storeAs` | Adds a DataSourceDefinition |
| `ir_update_datasource` | `projectPath`, `datasourceId` | Updates DataSource fields |
| `ir_remove_datasource` | `projectPath`, `datasourceId` | Removes DataSource |
| `ir_add_transform` | `projectPath`, `type`, `inputs`, `storeAs` | Adds a TransformDefinition |
| `ir_update_transform` | `projectPath`, `transformId` | Updates Transform fields |
| `ir_remove_transform` | `projectPath`, `transformId` | Removes Transform |

---

## Typical AI Workflow

```
1. ir_get_project          → understand existing state
2. ir_import_model_asset   → copy a GLB into Assets/Models/
3. ir_place_model          → add it to the scene at a given position
4. ir_list_ui_layouts      → find the HUD layout ID
5. ir_add_ui_element       → add a Panel to the layout root
6. ir_add_ui_element       → add a Text element inside the panel
7. ir_add_datasource       → add a REST_Client data source
8. ir_update_ui_element    → bind the text to the DataStore key
```

After these calls, the human user opens the GUI, sees the result, and triggers a build.

---

## Error Handling

All tool implementations are wrapped in a `try/catch`. On error, the tool returns:
```json
{ "success": false, "error": "<message>" }
```
rather than throwing, so the AI agent always receives a readable failure reason.

---

## Client Configuration

To connect Claude Desktop to the running server, the JSON configuration returned by `mcp:get-client-config` is:

```json
{
  "mcpServers": {
    "arsist-ir": {
      "command": "<electron-path>",
      "args": ["<path-to>/scripts/mcp-ir-server.mjs"],
      "env": {
        "MCP_PROJECT_PATH": "<project-root>"
      }
    }
  }
}
```

This is pasted into `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or the equivalent on other platforms.
