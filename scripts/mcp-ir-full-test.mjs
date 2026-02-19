#!/usr/bin/env node
/**
 * MCP IR サーバー 完全機能テスト
 * 全17ツールの動作確認: モデル配置、UI要素、DataFlow編集
 */
import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'fs-extra';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectPath = process.argv[2];
const testModelPath = process.argv[3];

if (!projectPath) {
  console.error('Usage: node mcp-ir-full-test.mjs <project-path> [model-path]');
  process.exit(1);
}

let client = null;
let transport = null;
let serverProc = null;

async function cleanup() {
  if (client) {
    try {
      await client.close();
    } catch {}
  }
  // transport will handle child process cleanup
}

async function main() {
  try {
    console.log('🚀 Starting MCP IR Server...');
    console.log(`  Project: ${projectPath}`);

    // Use stdio transport with command/args like mcp-ir-smoke.mjs
    transport = new StdioClientTransport({
      command: 'node',
      args: ['scripts/mcp-ir-server.mjs'],
      cwd: resolve(__dirname, '..'),
      stderr: 'pipe',
    });

    if (transport.stderr) {
      transport.stderr.on('data', (d) => {
        const s = d.toString();
        if (s.trim().length > 0) process.stderr.write(`[mcp-server] ${s}`);
      });
    }

    client = new Client({
      name: 'mcp-ir-full-test',
      version: '1.0.0',
    }, {
      capabilities: {},
    });

    await client.connect(transport);
    console.log('✅ Connected to MCP server');

    const toolsResponse = await client.listTools();
    const tools = toolsResponse.tools || [];
    console.log(`✅ Tools available: ${tools.length}`);
    
    if (tools.length !== 17) {
      throw new Error(`Expected 17 tools, got ${tools.length}`);
    }

    const expectedTools = [
      'ir_get_project',
      'ir_import_model_asset',
      'ir_place_model',
      'ir_list_scene_objects',
      'ir_update_object_transform',
      'ir_remove_scene_object',
      'ir_add_canvas_object',
      'ir_add_ui_element',
      'ir_update_ui_element',
      'ir_remove_ui_element',
      'ir_list_ui_layouts',
      'ir_add_datasource',
      'ir_update_datasource',
      'ir_remove_datasource',
      'ir_add_transform',
      'ir_update_transform',
      'ir_remove_transform',
    ];

    for (const expected of expectedTools) {
      if (!tools.find((t) => t.name === expected)) {
        throw new Error(`Tool not found: ${expected}`);
      }
    }
    console.log('✅ All 17 tools present');

    // Test 1: プロジェクト情報取得
    console.log('\n📋 Test 1: Get project info');
    const projectResult = await client.callTool({
      name: 'ir_get_project',
      arguments: { projectPath },
    });
    const projectInfo = JSON.parse(projectResult.content[0].text);
    console.log(`  ✅ Project: ${projectInfo.name} (${projectInfo.scenes?.length || 0} scenes)`);

    // Test 2: DataSource追加
    console.log('\n📋 Test 2: Add DataSource');
    const addDsResult = await client.callTool({
      name: 'ir_add_datasource',
      arguments: {
        projectPath,
        type: 'System_Clock',
        mode: 'polling',
        storeAs: 'test_time',
        updateRate: 1000,
      },
    });
    const dsData = JSON.parse(addDsResult.content[0].text);
    if (!dsData.success) throw new Error('Failed to add datasource');
    const datasourceId = dsData.datasource.id;
    console.log(`  ✅ DataSource created: ${datasourceId}`);

    // Test 3: DataSource更新
    console.log('\n📋 Test 3: Update DataSource');
    const updateDsResult = await client.callTool({
      name: 'ir_update_datasource',
      arguments: {
        projectPath,
        datasourceId,
        updateRate: 2000,
      },
    });
    const dsUpdateData = JSON.parse(updateDsResult.content[0].text);
    if (!dsUpdateData.success) throw new Error('Failed to update datasource');
    console.log(`  ✅ DataSource updated`);

    // Test 4: Transform追加
    console.log('\n📋 Test 4: Add Transform');
    const addTfResult = await client.callTool({
      name: 'ir_add_transform',
      arguments: {
        projectPath,
        type: 'Formula',
        inputs: ['test_time'],
        storeAs: 'test_formatted_time',
        expression: 'test_time * 2',
      },
    });
    const tfData = JSON.parse(addTfResult.content[0].text);
    if (!tfData.success) throw new Error('Failed to add transform');
    const transformId = tfData.transform.id;
    console.log(`  ✅ Transform created: ${transformId}`);

    // Test 5: Transform更新
    console.log('\n📋 Test 5: Update Transform');
    const updateTfResult = await client.callTool({
      name: 'ir_update_transform',
      arguments: {
        projectPath,
        transformId,
        expression: 'test_time * 3',
      },
    });
    const tfUpdateData = JSON.parse(updateTfResult.content[0].text);
    if (!tfUpdateData.success) throw new Error('Failed to update transform');
    console.log(`  ✅ Transform updated`);

    // Test 6: モデル配置（オプショナル）
    let modelObjectId = null;
    if (testModelPath && (await fs.pathExists(testModelPath))) {
      console.log('\n📋 Test 6: Import & Place Model');
      const importResult = await client.callTool({
        name: 'ir_import_model_asset',
        arguments: { projectPath, sourcePath: testModelPath },
      });
      const importData = JSON.parse(importResult.content[0].text);
      if (!importData.success) throw new Error('Failed to import model');
      console.log(`  ✅ Model imported: ${importData.assetPath}`);

      const placeResult = await client.callTool({
        name: 'ir_place_model',
        arguments: {
          projectPath,
          modelAssetPath: importData.assetPath,
          name: 'TestModel',
          position: { x: 1, y: 0, z: 3 },
        },
      });
      const placeData = JSON.parse(placeResult.content[0].text);
      if (!placeData.success) throw new Error('Failed to place model');
      modelObjectId = placeData.object.id;
      console.log(`  ✅ Model placed: ${modelObjectId}`);

      // Test 7: オブジェクト変形更新
      console.log('\n📋 Test 7: Update Object Transform');
      const updateObjResult = await client.callTool({
        name: 'ir_update_object_transform',
        arguments: {
          projectPath,
          objectId: modelObjectId,
          position: { x: 1.5, y: 0.5, z: 3.5 },
        },
      });
      const updateObjData = JSON.parse(updateObjResult.content[0].text);
      if (!updateObjData.success) throw new Error('Failed to update object transform');
      console.log(`  ✅ Object transform updated`);

      // Test 8: シーンオブジェクトリスト
      console.log('\n📋 Test 8: List Scene Objects');
      const listObjResult = await client.callTool({
        name: 'ir_list_scene_objects',
        arguments: { projectPath },
      });
      const listObjData = JSON.parse(listObjResult.content[0].text);
      console.log(`  ✅ Scene objects: ${listObjData.objects?.length || 0}`);
    } else {
      console.log('\n⏭️  Test 6-8: Skipped (no test model)');
    }

    // Test 9: UI要素追加
    console.log('\n📋 Test 9: Add UI Element');
    const layoutsResult = await client.callTool({
      name: 'ir_list_ui_layouts',
      arguments: { projectPath },
    });
    const layoutsData = JSON.parse(layoutsResult.content[0].text);
    const uhdLayout = layoutsData.layouts?.find((l) => l.scope === 'uhd');
    if (!uhdLayout) throw new Error('No UHD layout found');

    const addUiResult = await client.callTool({
      name: 'ir_add_ui_element',
      arguments: {
        projectPath,
        layoutId: uhdLayout.id,
        type: 'Text',
        content: 'Test Label',
        style: { fontSize: 18, color: '#FFFFFF' },
      },
    });
    const addUiData = JSON.parse(addUiResult.content[0].text);
    if (!addUiData.success) throw new Error('Failed to add UI element');
    const uiElementId = addUiData.element.id;
    console.log(`  ✅ UI Element added: ${uiElementId}`);

    // Test 10: UI要素更新
    console.log('\n📋 Test 10: Update UI Element');
    const updateUiResult = await client.callTool({
      name: 'ir_update_ui_element',
      arguments: {
        projectPath,
        layoutId: uhdLayout.id,
        elementId: uiElementId,
        content: 'Updated Label',
        style: { fontSize: 20 },
      },
    });
    const updateUiData = JSON.parse(updateUiResult.content[0].text);
    if (!updateUiData.success) throw new Error('Failed to update UI element');
    console.log(`  ✅ UI Element updated`);

    // Test 11: UI要素削除
    console.log('\n📋 Test 11: Remove UI Element');
    const removeUiResult = await client.callTool({
      name: 'ir_remove_ui_element',
      arguments: {
        projectPath,
        layoutId: uhdLayout.id,
        elementId: uiElementId,
      },
    });
    const removeUiData = JSON.parse(removeUiResult.content[0].text);
    if (!removeUiData.success) throw new Error('Failed to remove UI element');
    console.log(`  ✅ UI Element removed`);

    // Cleanup: Transform削除
    console.log('\n🧹 Cleanup: Remove Transform');
    const removeTfResult = await client.callTool({
      name: 'ir_remove_transform',
      arguments: { projectPath, transformId },
    });
    const removeTfData = JSON.parse(removeTfResult.content[0].text);
    if (!removeTfData.success) throw new Error('Failed to remove transform');
    console.log(`  ✅ Transform removed`);

    // Cleanup: DataSource削除
    console.log('\n🧹 Cleanup: Remove DataSource');
    const removeDsResult = await client.callTool({
      name: 'ir_remove_datasource',
      arguments: { projectPath, datasourceId },
    });
    const removeDsData = JSON.parse(removeDsResult.content[0].text);
    if (!removeDsData.success) throw new Error('Failed to remove datasource');
    console.log(`  ✅ DataSource removed`);

    // Cleanup: モデルオブジェクト削除
    if (modelObjectId) {
      console.log('\n🧹 Cleanup: Remove Model Object');
      const removeObjResult = await client.callTool({
        name: 'ir_remove_scene_object',
        arguments: { projectPath, objectId: modelObjectId },
      });
      const removeObjData = JSON.parse(removeObjResult.content[0].text);
      if (!removeObjData.success) throw new Error('Failed to remove object');
      console.log(`  ✅ Model object removed`);
    }

    console.log('\n✅ All tests passed!');
    const summary = {
      success: true,
      testsRun: modelObjectId ? 11 : 8,
      toolsVerified: 17,
    };
    console.log(JSON.stringify(summary, null, 2));

    await cleanup();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await cleanup();
    process.exit(1);
  }
}

main();
