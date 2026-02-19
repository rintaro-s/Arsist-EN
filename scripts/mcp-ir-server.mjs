import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

function id() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.createHash('sha1').update(`${Date.now()}_${Math.random()}`).digest('hex').slice(0, 12);
}

function toRel(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

async function loadProject(projectPath) {
  const projectFile = path.join(projectPath, 'project.json');
  if (!(await fs.pathExists(projectFile))) {
    throw new Error(`project.json not found: ${projectFile}`);
  }
  const project = await fs.readJSON(projectFile);
  project.scenes = Array.isArray(project.scenes) ? project.scenes : [];
  project.uiLayouts = Array.isArray(project.uiLayouts) ? project.uiLayouts : [];
  if (!project.dataFlow || typeof project.dataFlow !== 'object') {
    project.dataFlow = { dataSources: [], transforms: [] };
  }
  return project;
}

async function saveProject(projectPath, project) {
  project.updatedAt = new Date().toISOString();
  await fs.writeJSON(path.join(projectPath, 'project.json'), project, { spaces: 2 });

  const scenesDir = path.join(projectPath, 'Scenes');
  await fs.ensureDir(scenesDir);
  for (const scene of project.scenes || []) {
    if (!scene?.id) continue;
    await fs.writeJSON(path.join(scenesDir, `${scene.id}.json`), scene, { spaces: 2 });
  }

  const uiDir = path.join(projectPath, 'UI');
  await fs.ensureDir(uiDir);
  for (const layout of project.uiLayouts || []) {
    if (!layout?.id) continue;
    await fs.writeJSON(path.join(uiDir, `${layout.id}.json`), layout, { spaces: 2 });
  }
}

function getScene(project, sceneId) {
  const scenes = project.scenes || [];
  if (sceneId) {
    const found = scenes.find((s) => s.id === sceneId);
    if (!found) throw new Error(`scene not found: ${sceneId}`);
    return found;
  }
  if (!scenes[0]) throw new Error('scene not found');
  return scenes[0];
}

function getLayout(project, layoutId) {
  const layouts = project.uiLayouts || [];
  if (layoutId) {
    const found = layouts.find((l) => l.id === layoutId);
    if (!found) throw new Error(`layout not found: ${layoutId}`);
    return found;
  }
  if (!layouts[0]) throw new Error('layout not found');
  return layouts[0];
}

function findElement(root, elementId) {
  if (!root) return null;
  if (root.id === elementId) return root;
  for (const child of root.children || []) {
    const found = findElement(child, elementId);
    if (found) return found;
  }
  return null;
}

function textResult(data) {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

const tools = [
  {
    name: 'ir_get_project',
    description: 'Load project IR summary (scenes, layouts, dataFlow).',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'ir_import_model_asset',
    description: 'Import GLB/GLTF file into project Assets/Models and return assetPath.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        sourcePath: { type: 'string' },
      },
      required: ['projectPath', 'sourcePath'],
    },
  },
  {
    name: 'ir_place_model',
    description: 'Place model object into scene with transform.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        sceneId: { type: 'string' },
        modelAssetPath: { type: 'string' },
        name: { type: 'string' },
        position: { type: 'object' },
        rotation: { type: 'object' },
        scale: { type: 'object' },
      },
      required: ['projectPath', 'modelAssetPath'],
    },
  },
  {
    name: 'ir_list_scene_objects',
    description: 'List current scene object placements (id, type, modelPath, transform).',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        sceneId: { type: 'string' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'ir_update_object_transform',
    description: 'Update object transform by objectId.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        sceneId: { type: 'string' },
        objectId: { type: 'string' },
        position: { type: 'object' },
        rotation: { type: 'object' },
        scale: { type: 'object' },
      },
      required: ['projectPath', 'objectId'],
    },
  },
  {
    name: 'ir_remove_scene_object',
    description: 'Remove object from scene by objectId.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        sceneId: { type: 'string' },
        objectId: { type: 'string' },
      },
      required: ['projectPath', 'objectId'],
    },
  },
  {
    name: 'ir_add_canvas_object',
    description: 'Add 3D canvas object and attach UI layout (scope=canvas).',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        sceneId: { type: 'string' },
        layoutId: { type: 'string' },
        name: { type: 'string' },
        widthMeters: { type: 'number' },
        heightMeters: { type: 'number' },
        pixelsPerUnit: { type: 'number' },
        position: { type: 'object' },
        rotation: { type: 'object' },
        scale: { type: 'object' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'ir_add_ui_element',
    description: 'Add UI element to layout root/parent id.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        layoutId: { type: 'string' },
        parentElementId: { type: 'string' },
        type: { type: 'string' },
        content: { type: 'string' },
        bind: { type: 'object' },
        style: { type: 'object' },
        layout: { type: 'string' },
      },
      required: ['projectPath', 'type'],
    },
  },
  {
    name: 'ir_list_ui_layouts',
    description: 'List UI layouts and scope with element counts.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'ir_update_ui_element',
    description: 'Update UI element properties (type, content, bind, style, layout) by elementId.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        layoutId: { type: 'string' },
        elementId: { type: 'string' },
        type: { type: 'string' },
        content: { type: 'string' },
        bind: { type: 'object' },
        style: { type: 'object' },
        layout: { type: 'string' },
      },
      required: ['projectPath', 'elementId'],
    },
  },
  {
    name: 'ir_remove_ui_element',
    description: 'Remove UI element by elementId.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        layoutId: { type: 'string' },
        elementId: { type: 'string' },
      },
      required: ['projectPath', 'elementId'],
    },
  },
  {
    name: 'ir_add_datasource',
    description: 'Add DataSource to project dataFlow.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        type: { type: 'string' },
        mode: { type: 'string' },
        storeAs: { type: 'string' },
        updateRate: { type: 'number' },
        parameters: { type: 'object' },
      },
      required: ['projectPath', 'type', 'mode', 'storeAs'],
    },
  },
  {
    name: 'ir_update_datasource',
    description: 'Update DataSource properties by datasourceId.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        datasourceId: { type: 'string' },
        type: { type: 'string' },
        mode: { type: 'string' },
        storeAs: { type: 'string' },
        updateRate: { type: 'number' },
        parameters: { type: 'object' },
      },
      required: ['projectPath', 'datasourceId'],
    },
  },
  {
    name: 'ir_remove_datasource',
    description: 'Remove DataSource by datasourceId.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        datasourceId: { type: 'string' },
      },
      required: ['projectPath', 'datasourceId'],
    },
  },
  {
    name: 'ir_add_transform',
    description: 'Add Transform to project dataFlow.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        type: { type: 'string' },
        inputs: { type: 'array' },
        storeAs: { type: 'string' },
        expression: { type: 'string' },
        updateRate: { type: 'number' },
        parameters: { type: 'object' },
      },
      required: ['projectPath', 'type', 'inputs', 'storeAs'],
    },
  },
  {
    name: 'ir_update_transform',
    description: 'Update Transform properties by transformId.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        transformId: { type: 'string' },
        type: { type: 'string' },
        inputs: { type: 'array' },
        storeAs: { type: 'string' },
        expression: { type: 'string' },
        updateRate: { type: 'number' },
        parameters: { type: 'object' },
      },
      required: ['projectPath', 'transformId'],
    },
  },
  {
    name: 'ir_remove_transform',
    description: 'Remove Transform by transformId.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        transformId: { type: 'string' },
      },
      required: ['projectPath', 'transformId'],
    },
  },
];

const server = new Server(
  {
    name: 'arsist-ir-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};

  try {
    if (name === 'ir_get_project') {
      const project = await loadProject(args.projectPath);
      return textResult({
        id: project.id,
        name: project.name,
        appType: project.appType,
        targetDevice: project.targetDevice,
        scenes: (project.scenes || []).map((s) => ({ id: s.id, name: s.name, objects: (s.objects || []).length })),
        uiLayouts: (project.uiLayouts || []).map((l) => ({ id: l.id, name: l.name, scope: l.scope })),
        dataFlow: {
          dataSources: (project.dataFlow?.dataSources || []).length,
          transforms: (project.dataFlow?.transforms || []).length,
        },
      });
    }

    if (name === 'ir_import_model_asset') {
      const projectPath = args.projectPath;
      const sourcePath = args.sourcePath;
      const ext = path.extname(sourcePath).toLowerCase();
      if (!['.glb', '.gltf'].includes(ext)) {
        throw new Error(`unsupported model extension: ${ext}`);
      }
      if (!(await fs.pathExists(sourcePath))) {
        throw new Error(`source model not found: ${sourcePath}`);
      }

      const bytes = await fs.readFile(sourcePath);
      const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 8);
      const base = path.basename(sourcePath, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'model';
      const fileName = `${base}_${hash}${ext}`;

      const relPath = toRel(path.join('Assets', 'Models', fileName));
      const absPath = path.join(projectPath, relPath);
      await fs.ensureDir(path.dirname(absPath));
      await fs.copyFile(sourcePath, absPath);

      return textResult({ success: true, assetPath: relPath });
    }

    if (name === 'ir_place_model') {
      const project = await loadProject(args.projectPath);
      const scene = getScene(project, args.sceneId);
      const obj = {
        id: id(),
        name: args.name || path.basename(String(args.modelAssetPath || ''), path.extname(String(args.modelAssetPath || ''))) || 'Model',
        type: 'model',
        modelPath: toRel(args.modelAssetPath),
        transform: {
          position: args.position || { x: 0, y: 0, z: 2 },
          rotation: args.rotation || { x: 0, y: 0, z: 0 },
          scale: args.scale || { x: 1, y: 1, z: 1 },
        },
      };
      scene.objects = Array.isArray(scene.objects) ? scene.objects : [];
      scene.objects.push(obj);
      await saveProject(args.projectPath, project);
      return textResult({ success: true, object: obj, sceneId: scene.id });
    }

    if (name === 'ir_list_scene_objects') {
      const project = await loadProject(args.projectPath);
      const scene = getScene(project, args.sceneId);
      return textResult({
        sceneId: scene.id,
        sceneName: scene.name,
        objects: (scene.objects || []).map((o) => ({
          id: o.id,
          name: o.name,
          type: o.type,
          modelPath: o.modelPath,
          canvasSettings: o.canvasSettings,
          transform: o.transform,
        })),
      });
    }

    if (name === 'ir_update_object_transform') {
      const project = await loadProject(args.projectPath);
      const scene = getScene(project, args.sceneId);
      const obj = (scene.objects || []).find((o) => o.id === args.objectId);
      if (!obj) throw new Error(`object not found: ${args.objectId}`);

      obj.transform = obj.transform || {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };

      if (args.position) obj.transform.position = { ...obj.transform.position, ...args.position };
      if (args.rotation) obj.transform.rotation = { ...obj.transform.rotation, ...args.rotation };
      if (args.scale) obj.transform.scale = { ...obj.transform.scale, ...args.scale };

      await saveProject(args.projectPath, project);
      return textResult({ success: true, objectId: obj.id, transform: obj.transform });
    }

    if (name === 'ir_remove_scene_object') {
      const project = await loadProject(args.projectPath);
      const scene = getScene(project, args.sceneId);
      const before = (scene.objects || []).length;
      scene.objects = (scene.objects || []).filter((o) => o.id !== args.objectId);
      const removed = before !== scene.objects.length;
      await saveProject(args.projectPath, project);
      return textResult({ success: removed, objectId: args.objectId, sceneId: scene.id });
    }

    if (name === 'ir_add_canvas_object') {
      const project = await loadProject(args.projectPath);
      const scene = getScene(project, args.sceneId);

      let layout = null;
      if (args.layoutId) {
        layout = getLayout(project, args.layoutId);
      } else {
        layout = (project.uiLayouts || []).find((l) => l.scope === 'canvas') || null;
      }
      if (!layout) throw new Error('canvas layout not found. create scope=canvas layout first');

      const obj = {
        id: id(),
        name: args.name || 'Canvas',
        type: 'canvas',
        canvasSettings: {
          layoutId: layout.id,
          widthMeters: Number(args.widthMeters ?? 1.2),
          heightMeters: Number(args.heightMeters ?? 0.7),
          pixelsPerUnit: Number(args.pixelsPerUnit ?? 1000),
        },
        transform: {
          position: args.position || { x: 0, y: 0, z: 2 },
          rotation: args.rotation || { x: 0, y: 0, z: 0 },
          scale: args.scale || { x: 1, y: 1, z: 1 },
        },
      };

      scene.objects = Array.isArray(scene.objects) ? scene.objects : [];
      scene.objects.push(obj);
      await saveProject(args.projectPath, project);
      return textResult({ success: true, object: obj, sceneId: scene.id });
    }

    if (name === 'ir_add_ui_element') {
      const project = await loadProject(args.projectPath);
      const layout = getLayout(project, args.layoutId);

      const element = {
        id: id(),
        type: args.type,
        content: args.content,
        bind: args.bind,
        layout: args.layout,
        style: args.style || {},
        children: [],
      };

      const root = layout.root;
      let parent = root;
      if (args.parentElementId) {
        const found = findElement(root, args.parentElementId);
        if (!found) throw new Error(`parent element not found: ${args.parentElementId}`);
        parent = found;
      }

      parent.children = Array.isArray(parent.children) ? parent.children : [];
      parent.children.push(element);

      await saveProject(args.projectPath, project);
      return textResult({ success: true, layoutId: layout.id, element });
    }

    if (name === 'ir_list_ui_layouts') {
      const project = await loadProject(args.projectPath);
      return textResult({
        layouts: (project.uiLayouts || []).map((l) => ({
          id: l.id,
          name: l.name,
          scope: l.scope,
          resolution: l.resolution,
          rootId: l.root?.id,
          rootChildren: Array.isArray(l.root?.children) ? l.root.children.length : 0,
        })),
      });
    }

    if (name === 'ir_update_ui_element') {
      const project = await loadProject(args.projectPath);
      const layout = getLayout(project, args.layoutId);
      const element = findElement(layout.root, args.elementId);
      if (!element) throw new Error(`element not found: ${args.elementId}`);

      if (args.type !== undefined) element.type = args.type;
      if (args.content !== undefined) element.content = args.content;
      if (args.bind !== undefined) element.bind = args.bind;
      if (args.style !== undefined) element.style = { ...element.style, ...args.style };
      if (args.layout !== undefined) element.layout = args.layout;

      await saveProject(args.projectPath, project);
      return textResult({ success: true, layoutId: layout.id, element });
    }

    if (name === 'ir_remove_ui_element') {
      const project = await loadProject(args.projectPath);
      const layout = getLayout(project, args.layoutId);

      function removeFromTree(node, targetId) {
        if (!node || !Array.isArray(node.children)) return false;
        const before = node.children.length;
        node.children = node.children.filter((c) => c.id !== targetId);
        if (node.children.length !== before) return true;
        for (const child of node.children) {
          if (removeFromTree(child, targetId)) return true;
        }
        return false;
      }

      const removed = removeFromTree(layout.root, args.elementId);
      if (!removed) throw new Error(`element not found: ${args.elementId}`);

      await saveProject(args.projectPath, project);
      return textResult({ success: true, layoutId: layout.id, elementId: args.elementId });
    }

    if (name === 'ir_add_datasource') {
      const project = await loadProject(args.projectPath);
      const ds = {
        id: id(),
        type: args.type,
        mode: args.mode,
        storeAs: args.storeAs,
      };
      if (args.updateRate !== undefined) ds.updateRate = args.updateRate;
      if (args.parameters !== undefined) ds.parameters = args.parameters;

      project.dataFlow.dataSources = Array.isArray(project.dataFlow.dataSources) ? project.dataFlow.dataSources : [];
      project.dataFlow.dataSources.push(ds);
      await saveProject(args.projectPath, project);
      return textResult({ success: true, datasource: ds });
    }

    if (name === 'ir_update_datasource') {
      const project = await loadProject(args.projectPath);
      const ds = (project.dataFlow?.dataSources || []).find((d) => d.id === args.datasourceId);
      if (!ds) throw new Error(`datasource not found: ${args.datasourceId}`);

      if (args.type !== undefined) ds.type = args.type;
      if (args.mode !== undefined) ds.mode = args.mode;
      if (args.storeAs !== undefined) ds.storeAs = args.storeAs;
      if (args.updateRate !== undefined) ds.updateRate = args.updateRate;
      if (args.parameters !== undefined) ds.parameters = args.parameters;

      await saveProject(args.projectPath, project);
      return textResult({ success: true, datasource: ds });
    }

    if (name === 'ir_remove_datasource') {
      const project = await loadProject(args.projectPath);
      const before = (project.dataFlow?.dataSources || []).length;
      project.dataFlow.dataSources = (project.dataFlow?.dataSources || []).filter((d) => d.id !== args.datasourceId);
      const removed = before !== project.dataFlow.dataSources.length;
      if (!removed) throw new Error(`datasource not found: ${args.datasourceId}`);

      await saveProject(args.projectPath, project);
      return textResult({ success: true, datasourceId: args.datasourceId });
    }

    if (name === 'ir_add_transform') {
      const project = await loadProject(args.projectPath);
      const tf = {
        id: id(),
        type: args.type,
        inputs: Array.isArray(args.inputs) ? args.inputs : [],
        storeAs: args.storeAs,
      };
      if (args.expression !== undefined) tf.expression = args.expression;
      if (args.updateRate !== undefined) tf.updateRate = args.updateRate;
      if (args.parameters !== undefined) tf.parameters = args.parameters;

      project.dataFlow.transforms = Array.isArray(project.dataFlow.transforms) ? project.dataFlow.transforms : [];
      project.dataFlow.transforms.push(tf);
      await saveProject(args.projectPath, project);
      return textResult({ success: true, transform: tf });
    }

    if (name === 'ir_update_transform') {
      const project = await loadProject(args.projectPath);
      const tf = (project.dataFlow?.transforms || []).find((t) => t.id === args.transformId);
      if (!tf) throw new Error(`transform not found: ${args.transformId}`);

      if (args.type !== undefined) tf.type = args.type;
      if (args.inputs !== undefined) tf.inputs = Array.isArray(args.inputs) ? args.inputs : [];
      if (args.storeAs !== undefined) tf.storeAs = args.storeAs;
      if (args.expression !== undefined) tf.expression = args.expression;
      if (args.updateRate !== undefined) tf.updateRate = args.updateRate;
      if (args.parameters !== undefined) tf.parameters = args.parameters;

      await saveProject(args.projectPath, project);
      return textResult({ success: true, transform: tf });
    }

    if (name === 'ir_remove_transform') {
      const project = await loadProject(args.projectPath);
      const before = (project.dataFlow?.transforms || []).length;
      project.dataFlow.transforms = (project.dataFlow?.transforms || []).filter((t) => t.id !== args.transformId);
      const removed = before !== project.dataFlow.transforms.length;
      if (!removed) throw new Error(`transform not found: ${args.transformId}`);

      await saveProject(args.projectPath, project);
      return textResult({ success: true, transformId: args.transformId });
    }

    throw new Error(`unknown tool: ${name}`);
  } catch (error) {
    return textResult({ success: false, error: String(error?.message || error) });
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
