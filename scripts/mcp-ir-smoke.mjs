import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const projectPath = process.argv[2];
const sourceModelPath = process.argv[3];

if (!projectPath || !sourceModelPath) {
  console.error('Usage: node scripts/mcp-ir-smoke.mjs <projectPath> <sourceModelPath>');
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: 'node',
  args: ['scripts/mcp-ir-server.mjs'],
  cwd: process.cwd(),
  stderr: 'pipe',
});

if (transport.stderr) {
  transport.stderr.on('data', (d) => {
    const s = d.toString();
    if (s.trim().length > 0) process.stderr.write(`[mcp-server] ${s}`);
  });
}

const client = new Client({ name: 'arsist-smoke-client', version: '1.0.0' }, { capabilities: {} });

function parseText(res) {
  const txt = (res?.content || []).find((c) => c.type === 'text')?.text;
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

let placedObjectId = null;

try {
  await client.connect(transport);

  const toolsRes = await client.listTools();
  const names = new Set((toolsRes.tools || []).map((t) => t.name));
  const required = [
    'ir_get_project',
    'ir_import_model_asset',
    'ir_place_model',
    'ir_list_scene_objects',
    'ir_update_object_transform',
    'ir_remove_scene_object',
    'ir_add_canvas_object',
    'ir_add_ui_element',
    'ir_list_ui_layouts',
  ];
  for (const r of required) {
    if (!names.has(r)) throw new Error(`tool missing: ${r}`);
  }

  const p = parseText(await client.callTool({ name: 'ir_get_project', arguments: { projectPath } }));
  const sceneId = p?.scenes?.[0]?.id;
  if (!sceneId) throw new Error('scene not found in project');

  const imported = parseText(await client.callTool({
    name: 'ir_import_model_asset',
    arguments: { projectPath, sourcePath: sourceModelPath },
  }));
  if (!imported?.success || !imported?.assetPath) {
    throw new Error(`import failed: ${JSON.stringify(imported)}`);
  }

  const placed = parseText(await client.callTool({
    name: 'ir_place_model',
    arguments: {
      projectPath,
      sceneId,
      modelAssetPath: imported.assetPath,
      name: 'MCP_Smoke_Model',
      position: { x: 0.12, y: 1.0, z: 2.34 },
      rotation: { x: 0, y: 15, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }));
  placedObjectId = placed?.object?.id;
  if (!placedObjectId) throw new Error(`place failed: ${JSON.stringify(placed)}`);

  const updated = parseText(await client.callTool({
    name: 'ir_update_object_transform',
    arguments: {
      projectPath,
      sceneId,
      objectId: placedObjectId,
      position: { x: 0.5, y: 1.2, z: 2.8 },
    },
  }));
  if (!updated?.success) throw new Error(`transform update failed: ${JSON.stringify(updated)}`);

  const listed = parseText(await client.callTool({
    name: 'ir_list_scene_objects',
    arguments: { projectPath, sceneId },
  }));
  const target = (listed?.objects || []).find((o) => o.id === placedObjectId);
  if (!target) throw new Error('placed object not found in list');

  const removed = parseText(await client.callTool({
    name: 'ir_remove_scene_object',
    arguments: { projectPath, sceneId, objectId: placedObjectId },
  }));
  if (!removed?.success) throw new Error(`remove failed: ${JSON.stringify(removed)}`);

  console.log(JSON.stringify({
    success: true,
    verified: {
      tools: required.length,
      importAssetPath: imported.assetPath,
      placeObjectId: placedObjectId,
      transformUpdated: true,
      listConfirmed: true,
      cleanupRemoved: true,
    },
  }, null, 2));

  await client.close();
  process.exit(0);
} catch (error) {
  try {
    if (placedObjectId) {
      await client.callTool({
        name: 'ir_remove_scene_object',
        arguments: { projectPath, objectId: placedObjectId },
      });
    }
    await client.close();
  } catch {
    // ignore cleanup errors
  }
  console.error(JSON.stringify({ success: false, error: String(error?.message || error) }, null, 2));
  process.exit(1);
}
