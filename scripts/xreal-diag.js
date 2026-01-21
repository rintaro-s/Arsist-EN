const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCmd(cmd, args, { stdio = 'pipe' } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio });
    let out = '';
    let err = '';
    if (p.stdout) p.stdout.on('data', (d) => (out += d.toString('utf8')));
    if (p.stderr) p.stderr.on('data', (d) => (err += d.toString('utf8')));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) return resolve({ out, err });
      const e = new Error(`${cmd} ${args.join(' ')} exited with code ${code}`);
      e.out = out;
      e.err = err;
      reject(e);
    });
  });
}

function parseArgs(argv) {
  const args = { seconds: 25 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--seconds') {
      args.seconds = Number(argv[++i]) || args.seconds;
    }
  }
  return args;
}

(async () => {
  const { seconds } = parseArgs(process.argv);

  const storePath = path.join(os.homedir(), '.config', 'arsist-engine', 'config.json');
  const store = readJson(storePath);

  const unityPath = process.env.ARSIST_UNITY_PATH || store.unityPath;
  const outputPath = process.env.ARSIST_OUTPUT_PATH || store.defaultOutputPath;
  const sourceProjectPath = process.env.ARSIST_PROJECT_PATH || (store.recentProjects && store.recentProjects[0]);

  if (!unityPath) throw new Error('Unity path not found (set ARSIST_UNITY_PATH or configure in app)');
  if (!outputPath) throw new Error('Output path not found (set ARSIST_OUTPUT_PATH or configure in app)');
  if (!sourceProjectPath) throw new Error('Project path not found (set ARSIST_PROJECT_PATH or open a project in app)');

  const projectJsonPath = path.join(sourceProjectPath, 'project.json');
  const project = readJson(projectJsonPath);

  const unityWorkDir = path.join(outputPath, 'TempUnityProject');

  const { remoteInput, ...androidBuild } = project.buildSettings || {};
  const manifestData = {
    projectId: project.id,
    projectName: project.name,
    version: project.version,
    appType: project.appType,
    targetDevice: project.targetDevice,
    arSettings: project.arSettings,
    uiAuthoring: project.uiAuthoring,
    uiCode: project.uiCode,
    designSystem: project.designSystem,
    build: androidBuild,
    buildSettings: project.buildSettings,
    remoteInput,
    exportedAt: new Date().toISOString(),
  };

  const logFilePath = pickFirstExisting([
    process.env.ARSIST_UNITY_LOG,
    path.join(outputPath, 'unity_build.log'),
  ]);

  const builder = new UnityBuilder(unityPath);
  builder.on('progress', (p) => console.log(`[progress] ${p.phase} ${p.progress}% ${p.message}`));
  builder.on('log', (l) => console.log(l));

  console.log('[Arsist] Building (XREAL One diag)...');
  const result = await builder.build({
    projectPath: unityWorkDir,
    sourceProjectPath,
    outputPath,
    targetDevice: project.targetDevice || 'XREAL_One',
    buildTarget: 'Android',
    developmentBuild: true,
    manifestData,
    scenesData: project.scenes || [],
    uiData: project.uiLayouts || [],
    logicCode: '',
    buildTimeoutMinutes: 60,
    logFilePath,
  });

  console.log('[Arsist] Build result:', result);
  if (!result.success) process.exit(1);

  const apkPath = result.outputPath;
  if (!apkPath || !fs.existsSync(apkPath)) {
    console.error('[Arsist] Build succeeded but APK path is missing:', apkPath);
    process.exit(1);
  }

  const packageName =
    (project.buildSettings && project.buildSettings.packageName) ||
    (project.buildSettings && project.buildSettings.build && project.buildSettings.build.packageName) ||
    androidBuild.packageName ||
    'com.arsist.app';

  // ADB phase (best-effort)
  try {
    await runCmd('adb', ['devices'], { stdio: 'pipe' });
  } catch {
    console.warn('[Arsist] adb not found or not working; skipping install/logcat.');
    process.exit(0);
  }

  console.log('[Arsist] Installing APK via adb...');
  await runCmd('adb', ['install', '-r', apkPath], { stdio: 'inherit' });

  console.log('[Arsist] Clearing logcat...');
  try {
    await runCmd('adb', ['logcat', '-c'], { stdio: 'inherit' });
  } catch {
    // ignore
  }

  console.log('[Arsist] Launching app...');
  await runCmd('adb', ['shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'inherit' });

  console.log(`[Arsist] Capturing logcat for ${seconds}s...`);
  await sleep(seconds * 1000);

  const { out } = await runCmd('adb', ['logcat', '-d'], { stdio: 'pipe' });
  const interesting = out
    .split(/\r?\n/)
    .filter((line) =>
      /XREALXRLoader|XREALCallbackHandler|XREALError|ArsistModelLoader|Arsist\]|Unity\s|AndroidRuntime|E\/Unity|XR Plugin/i.test(line)
    )
    .join('\n');

  const diagPath = path.join(outputPath, `xreal_diag_${Date.now()}.log`);
  fs.writeFileSync(diagPath, interesting + '\n', 'utf8');
  console.log('[Arsist] Saved filtered logcat:', diagPath);

  process.exit(0);
})().catch((e) => {
  console.error('[Arsist] Fatal:', e && e.stack ? e.stack : e);
  process.exit(1);
});
