#!/usr/bin/env node
/**
 * Layster.Spatial のプロジェクト (project.spatial.json) をコマンドでビルドする。エディタの「ビルド」と同じ処理
 * (dist/main の SpatialProjectManager → validate → lower → UnityBuilder) を使う。先に `npm run build:main` が要る。
 *
 *   node scripts/layster-build.mjs <プロジェクトのフォルダ> [--device Meta_Quest] [--out <出力先>] [--dev] [--clean]
 *       APK を作る。Unity のパスと出力先は、無ければエディタの設定 (unityPath / defaultOutputPath) を使う。
 *       環境変数 ARSIST_UNITY_PATH / ARSIST_OUTPUT_PATH でも渡せる。
 *
 *   node scripts/layster-build.mjs <プロジェクトのフォルダ> --lower-only --out <フォルダ>
 *       Unity を動かさず、ビルドに渡す 5 つ (manifest.json / scenes.json / ui_layouts.json / scripts.json / spatial.json)
 *       を書き出すだけ。ランタイム側を作るときの確認用 (doc/19-layster.md §4.1)。
 *
 * 鍵 (.layster/secrets.local.json) は、Mind が使っていれば APK に焼き込まれる (ログに出る)。
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = (...p) => path.join(here, '..', 'dist', 'main', ...p);

function fail(message) {
  console.error(`[Layster] ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--device', '--out'].includes(args[i - 1])));
const projectDir = positional[0] ? path.resolve(positional[0]) : undefined;
if (!projectDir) fail('usage: node scripts/layster-build.mjs <spatial project dir> [--device <adapter>] [--out <dir>] [--lower-only] [--dev] [--clean]');
if (!fs.existsSync(dist('main', 'layster', 'SpatialProjectManager.js'))) fail('dist/main is missing or old: run `npm run build:main` first');

const { readSpatialProject, readSecrets, validateSpatialProjectAt } = require(dist('main', 'layster', 'SpatialProjectManager.js'));
const { lowerSpatialProject } = require(dist('shared', 'layster', 'spatial', 'lower.js'));

const { project, notices } = await readSpatialProject(projectDir).catch((e) => fail(e.message));
for (const n of notices) console.log(`[Layster] note: ${n}`);
const device = option('--device') || process.env.ARSIST_TARGET_DEVICE || project.targetDevice;

// フォルダが分かるので、動きの名前 (Assets/Animations/*.fbx) も見る (エディタのビルドと同じ)
const problems = await validateSpatialProjectAt(projectDir, project);
for (const p of problems) console.log(`[Layster] ${p.level === 'error' ? 'ERROR' : 'WARNING'}: ${p.path}: ${p.message.en}`);
if (problems.some((p) => p.level === 'error')) fail('the problems above stop the build');

let lowered;
try {
  lowered = lowerSpatialProject(project, { secrets: await readSecrets(projectDir), targetDevice: device });
} catch (e) {
  fail(e.message);
}
for (const w of lowered.warnings) console.log(`[Layster] WARNING: ${w}`);
for (const name of lowered.bakedSecrets) console.log(`[Layster] WARNING: the key "${name}" is baked into the APK`);

if (flag('--lower-only')) {
  const out = option('--out');
  if (!out) fail('--lower-only needs --out <dir>');
  fs.mkdirSync(out, { recursive: true });
  const write = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + '\n');
  // UnityBuilder.transferProjectData と同じく、manifest.json は scenes も持つ
  write('manifest.json', { ...lowered.manifestData, scenes: lowered.scenesData });
  write('scenes.json', lowered.scenesData);
  write('ui_layouts.json', lowered.uiData);
  write('scripts.json', lowered.scriptsData);
  write('spatial.json', lowered.spatialData);
  console.log(`[Layster] wrote manifest.json, scenes.json, ui_layouts.json, scripts.json, spatial.json to ${path.resolve(out)}`);
  process.exit(0);
}

// ---- Unity でビルドする (scripts/run-unity-build.js と同じ設定の読み方) ----
const { getConfigStorePath } = require(path.join(here, 'lib', 'config-path'));
const storePath = getConfigStorePath('arsist-engine');
let store = {};
try {
  if (fs.existsSync(storePath)) store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
} catch {
  store = {};
}
const unityPath = process.env.ARSIST_UNITY_PATH || store.unityPath;
// Unity は相対パスを自分のプロジェクトから読むので、ここで絶対パスにする
const rawOutput = option('--out') || process.env.ARSIST_OUTPUT_PATH || store.defaultOutputPath;
const outputPath = rawOutput ? path.resolve(rawOutput) : rawOutput;
if (!unityPath) fail('Unity path not found (set ARSIST_UNITY_PATH or configure it in the editor)');
if (!outputPath) fail('output path not found (pass --out, set ARSIST_OUTPUT_PATH or configure it in the editor)');

const { UnityBuilder } = require(dist('main', 'unity', 'UnityBuilder.js'));
const { setLinkedFoldersSource } = require(dist('main', 'extensions', 'catalogService.js'));
const { readLinkedFoldersFile } = require(dist('main', 'extensions', 'linkedFolders.js'));

const builder = new UnityBuilder(unityPath);
builder.setExtensionUserDir(process.env.ARSIST_EXTENSIONS_DIR || path.join(path.dirname(storePath), 'extensions'));
if (store.sdkDir) builder.setSdkDir(String(store.sdkDir).trim());
setLinkedFoldersSource(() => readLinkedFoldersFile(storePath));
builder.on('progress', (p) => console.log(`[progress] ${p.phase} ${p.progress}% ${p.message}`));
builder.on('log', (l) => console.log(l));

console.log(`[Layster] Building ${project.name} (Layster.Spatial) for ${device}...`);
const result = await builder.build({
  projectPath: path.join(outputPath, 'TempUnityProject'),
  sourceProjectPath: projectDir,
  outputPath,
  targetDevice: device,
  buildTarget: 'Android',
  developmentBuild: flag('--dev'),
  cleanBuild: flag('--clean'),
  manualLicenseFile: process.env.ARSIST_MANUAL_LICENSE_FILE || store.unityManualLicenseFile || undefined,
  manifestData: lowered.manifestData,
  scenesData: lowered.scenesData,
  uiData: lowered.uiData,
  scriptsData: lowered.scriptsData,
  spatialData: lowered.spatialData,
  buildTimeoutMinutes: 60,
});
console.log('[Layster] Build result:', result);
process.exit(result.success ? 0 : 1);
