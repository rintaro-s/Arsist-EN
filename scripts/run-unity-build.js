const fs = require('fs');
const path = require('path');
const os = require('os');

// Use the same compiled entrypoint Electron uses (dist/main/main/*)
const { UnityBuilder } = require(path.join('..', 'dist', 'main', 'main', 'unity', 'UnityBuilder'));

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function pickFirstExisting(paths) {
  for (const p of paths) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

(async () => {
  const appName = 'arsist-engine';
  const storePath = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName, 'config.json')
    : path.join(os.homedir(), '.config', appName, 'config.json');
  let store = {};
  try {
    if (fs.existsSync(storePath)) {
      store = readJson(storePath);
    }
  } catch {
    store = {};
  }

  const unityPath = process.env.ARSIST_UNITY_PATH || store.unityPath;
  const outputPath = process.env.ARSIST_OUTPUT_PATH || store.defaultOutputPath;
  const sourceProjectPath = process.env.ARSIST_PROJECT_PATH || (store.recentProjects && store.recentProjects[0]);

  if (!unityPath) throw new Error('Unity path not found (set ARSIST_UNITY_PATH or configure in app)');
  if (!outputPath) throw new Error('Output path not found (set ARSIST_OUTPUT_PATH or configure in app)');
  if (!sourceProjectPath) throw new Error('Project path not found (set ARSIST_PROJECT_PATH or open a project in app)');

  const projectJsonPath = path.join(sourceProjectPath, 'project.json');
  const project = readJson(projectJsonPath);

  const unityWorkDir = path.join(outputPath, 'TempUnityProject');
  const manualLicenseFile = process.env.ARSIST_MANUAL_LICENSE_FILE;

  const { remoteInput, ...androidBuild } = project.buildSettings || {};
  const selectedTargetDevice = process.env.ARSIST_TARGET_DEVICE || project.targetDevice || 'XREAL_One';
  const scripts = project.scripts || [];
  const hasActiveScripts = scripts.some((sc) => sc.enabled);
  const manifestData = {
    projectId: project.id,
    projectName: project.name,
    version: project.version,
    appType: project.appType,
    targetDevice: selectedTargetDevice,
    arSettings: project.arSettings,
    uiAuthoring: project.uiAuthoring,
    uiCode: project.uiCode,
    designSystem: project.designSystem,
    build: androidBuild,
    buildSettings: project.buildSettings,
    remoteInput,
    scripting: { enabled: hasActiveScripts },
    exportedAt: new Date().toISOString(),
  };
  const scriptsData = {
    version: '1.0',
    scripts: scripts
      .filter((sc) => sc.enabled)
      .map((sc) => ({ id: sc.id, name: sc.name, trigger: sc.trigger, code: sc.code, enabled: sc.enabled })),
  };

  const logFilePath = pickFirstExisting([
    process.env.ARSIST_UNITY_LOG,
    path.join(outputPath, 'unity_build.log'),
  ]);

  const builder = new UnityBuilder(unityPath);
  builder.on('progress', (p) => console.log(`[progress] ${p.phase} ${p.progress}% ${p.message}`));
  builder.on('log', (l) => console.log(l));

  console.log('[Arsist] Running headless Unity build via UnityBuilder...');
  const result = await builder.build({
    projectPath: unityWorkDir,
    sourceProjectPath,
    outputPath,
    targetDevice: selectedTargetDevice,
    buildTarget: 'Android',
    developmentBuild: process.env.ARSIST_DEVELOPMENT_BUILD === 'true',
    manualLicenseFile: manualLicenseFile || undefined,
    manifestData,
    scenesData: project.scenes || [],
    uiData: project.uiLayouts || [],
    scriptsData,
    logicCode: '',
    buildTimeoutMinutes: 60,
    logFilePath,
  });

  console.log('[Arsist] Build result:', result);
  
  // ビルド失敗時の詳細ログ出力
  if (!result.success && logFilePath && fs.existsSync(logFilePath)) {
    try {
      const logContent = fs.readFileSync(logFilePath, 'utf8');
      const errorLines = logContent.split('\n').filter(line => 
        line.includes('error') || line.includes('Error') || 
        line.includes('failed') || line.includes('compiler') ||
        line.includes('Aborting')
      );
      if (errorLines.length > 0) {
        console.error('[Arsist] ===== Build Error Details =====');
        errorLines.slice(-30).forEach(line => console.error(line));
        console.error('[Arsist] ===== End of Error Details =====');
      }
    } catch (logErr) {
      console.error('[Arsist] Could not read build log:', logErr.message);
    }
  }
  
  process.exit(result.success ? 0 : 1);
})().catch((e) => {
  console.error('[Arsist] Fatal:', e);
  process.exit(1);
});
