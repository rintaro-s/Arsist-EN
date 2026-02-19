const fs = require('fs');
const path = require('path');

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function rel(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function walkElement(el, onVisit) {
  onVisit(el);
  for (const child of el.children || []) walkElement(child, onVisit);
}

function main() {
  const projectPath = process.argv[2];
  if (!projectPath) {
    console.error('Usage: node scripts/verify-ir-consistency.js <projectPath>');
    process.exit(2);
  }

  const projectFile = path.join(projectPath, 'project.json');
  if (!exists(projectFile)) {
    console.error(`project.json not found: ${projectFile}`);
    process.exit(2);
  }

  const project = readJson(projectFile);
  const errors = [];
  const warnings = [];

  if (!project.dataFlow || !Array.isArray(project.dataFlow.dataSources) || !Array.isArray(project.dataFlow.transforms)) {
    errors.push('dataFlow must contain arrays: dataSources, transforms');
  }

  if ('uiAuthoring' in project || 'uiCode' in project || 'logicGraphs' in project) {
    warnings.push('legacy fields found (uiAuthoring/uiCode/logicGraphs). IR-only方針に合わせるなら削除推奨');
  }

  const layouts = Array.isArray(project.uiLayouts) ? project.uiLayouts : [];
  const layoutById = new Map(layouts.map((l) => [l.id, l]));

  for (const layout of layouts) {
    if (!layout.id) errors.push('ui layout id missing');
    if (!['uhd', 'canvas'].includes(layout.scope)) {
      errors.push(`layout ${layout.id || layout.name}: invalid scope ${layout.scope}`);
    }
    if (!layout.root || typeof layout.root !== 'object') {
      errors.push(`layout ${layout.id || layout.name}: root missing`);
      continue;
    }

    walkElement(layout.root, (el) => {
      if (!el.id) errors.push(`layout ${layout.id}: element id missing`);
      if (!el.type) errors.push(`layout ${layout.id}: element type missing (${el.id || 'unknown'})`);
      if (!Array.isArray(el.children)) errors.push(`layout ${layout.id}: element children must be array (${el.id || 'unknown'})`);
    });
  }

  const scenes = Array.isArray(project.scenes) ? project.scenes : [];
  for (const scene of scenes) {
    for (const obj of scene.objects || []) {
      if (!obj.id) errors.push(`scene ${scene.id}: object id missing`);
      if (!obj.type) errors.push(`scene ${scene.id}: object type missing (${obj.name || 'unknown'})`);

      if (obj.type === 'model') {
        if (!obj.modelPath) {
          errors.push(`scene ${scene.id}: model object ${obj.id} has no modelPath`);
        } else {
          const modelAbs = path.join(projectPath, rel(obj.modelPath));
          if (!exists(modelAbs)) warnings.push(`scene ${scene.id}: modelPath not found on disk: ${obj.modelPath}`);
        }
      }

      if (obj.type === 'canvas') {
        const cs = obj.canvasSettings;
        if (!cs) {
          errors.push(`scene ${scene.id}: canvas object ${obj.id} missing canvasSettings`);
        } else {
          if (!layoutById.has(cs.layoutId)) {
            errors.push(`scene ${scene.id}: canvas ${obj.id} references unknown layoutId ${cs.layoutId}`);
          } else {
            const layout = layoutById.get(cs.layoutId);
            if (layout.scope !== 'canvas') {
              warnings.push(`scene ${scene.id}: canvas ${obj.id} references non-canvas layout ${cs.layoutId} (scope=${layout.scope})`);
            }
          }
        }
      }
    }
  }

  const result = {
    project: { id: project.id, name: project.name, path: projectPath },
    counts: {
      scenes: scenes.length,
      uiLayouts: layouts.length,
      errors: errors.length,
      warnings: warnings.length,
    },
    errors,
    warnings,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

main();
