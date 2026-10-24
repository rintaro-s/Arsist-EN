#!/usr/bin/env node
/**
 * Unity シミュレーター (doc/22-simulation.md)。APK と同じシーン (Jint のスクリプト・TMP の UI・VRM・Layster.Spatial の
 * ランタイムと規則・Mind) を Linux のプレイヤーとして作り、xvfb の上で動かして頭のカメラの画を撮る。
 * ヘッドセットは要らない。先に `npm run build:main` が要る。
 *
 *   node scripts/sim/unity.mjs <project dir> --out <dir> [--space <id | file.json>] [--device <adapter>]
 *        [--times 1,3,6] [--width 1280 --height 720] [--timeline file.json] [--fov <縦の度>]
 *        [--mind-url <url> | --mind-stub [reply.json]] [--no-space] [--keep-storage] [--rebuild] [--work <dir>] [--json]
 *
 * 書くもの: <out>/shot-<t>.png、<out>/result.json (撮った画・頭・物の置き場所・store・ログの抜き出し・エラー)。
 * 最後に result.json の中身を標準出力に出す (--json のときはそれだけ。途中の経過は標準エラーへ)。
 *
 * ビルドは UnityBuilder (エディタの「ビルド」と同じ準備) に simulation を渡し、APK の代わりに Linux のプレイヤーを作る。
 * 作業フォルダは tmp/ArsistSim/<端末>/ (APK のビルドの作業フォルダには触らない)。入力が前回と同じならビルドを飛ばす。
 *
 * timeline (JSON の配列、または { "steps": [...] }):
 *   { "t": 1, "head": { "yaw": 30, "pitch": -15, "at": [0, 1.6, 0] }, "over": 0.6 }   頭 (at は足元が原点の world)
 *   { "t": 2, "select": "card.hint" }      パネルのボタン (bindingId) を押す
 *   { "t": 2, "event": "name" }            ArsistScriptEvent を鳴らす
 *   { "t": 3, "say": "..." }               say の行動 (Virtual では store の say.text)
 *   { "t": 3, "action": { "do": "highlight", "entity": "desk" } }   Spatial の行動
 *   { "t": 4, "set": { "key": "value" } }  store に入れる
 *   { "t": 5, "shot": "name" }             その時刻にも撮る
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import http from 'http';
import crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const dist = (...p) => path.join(repo, 'dist', 'main', ...p);

// ---- 引数 ----
const args = process.argv.slice(2);
const VALUE_OPTIONS = ['--out', '--space', '--device', '--times', '--width', '--height', '--timeline', '--fov', '--mind-url', '--work', '--timeout'];
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && (VALUE_OPTIONS.includes(args[i - 1]) || (args[i - 1] === '--mind-stub' && a.endsWith('.json')))));
const jsonOnly = flag('--json');
const log = (...m) => (jsonOnly ? console.error : console.log)(...m);

const result = { ok: false, engine: 'unity', format: 'arsist.sim/1', files: [], shots: [], errors: [], warnings: [], log: [] };
function finish(code) {
  try {
    if (result.out) fs.writeFileSync(path.join(result.out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  } catch { /* 出力先に書けないときは標準出力だけ */ }
  console.log(JSON.stringify(result, null, jsonOnly ? 0 : 2));
  process.exit(code);
}
function fail(message) {
  result.errors.push(message);
  log(`[ArsistSim] ERROR: ${message}`);
  finish(1);
}

const projectDir = positional[0] ? path.resolve(positional[0]) : undefined;
if (!projectDir) fail('usage: node scripts/sim/unity.mjs <project dir> --out <dir> [--space <id>] [--device <adapter>] [--times 1,3,6] [--width 1280 --height 720] [--timeline file.json] [--json]');
if (!option('--out')) fail('--out <dir> is required');
const out = path.resolve(option('--out'));
fs.mkdirSync(out, { recursive: true });
result.out = out;
result.project = projectDir;
if (!fs.existsSync(dist('main', 'unity', 'UnityBuilder.js'))) fail('dist/main is missing: run `npm run build:main` first');

const width = Math.max(64, parseInt(option('--width') ?? '1280', 10) || 1280);
const height = Math.max(64, parseInt(option('--height') ?? '720', 10) || 720);
const times = (option('--times') ?? '1,3,6').split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x >= 0);

// ---- 設定 (エディタの設定は読むだけ) ----
const { getConfigStorePath } = require(path.join(repo, 'scripts', 'lib', 'config-path'));
const storePath = getConfigStorePath('arsist-engine');
let store = {};
try {
  if (fs.existsSync(storePath)) store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
} catch { store = {}; }
const unityPath = process.env.ARSIST_UNITY_PATH || store.unityPath;
if (!unityPath || !fs.existsSync(unityPath)) fail('Unity not found (set ARSIST_UNITY_PATH or configure it in the editor)');
if (process.platform !== 'linux') fail('the Unity simulator runs on Linux only (it builds a Linux player and runs it under xvfb)');
const xvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).stdout.trim();
if (!xvfb) fail('xvfb-run not found (the player needs an X display; install the xvfb package)');
const linuxSupport = path.join(path.dirname(unityPath), 'Data', 'PlaybackEngines', 'LinuxStandaloneSupport');
if (!fs.existsSync(linuxSupport)) fail(`Unity Linux Build Support is not installed (${linuxSupport})`);

// ---- プロジェクトを読む (Spatial / Virtual) ----
const isSpatial = fs.existsSync(path.join(projectDir, 'project.spatial.json'));
const isVirtual = !isSpatial && fs.existsSync(path.join(projectDir, 'project.json'));
if (!isSpatial && !isVirtual) fail(`${projectDir} has neither project.spatial.json nor project.json`);
result.profile = isSpatial ? 'spatial' : 'virtual';

let build; // UnityBuilder.build に渡す中身
let device;
let spatialProject;
if (isSpatial) {
  const { readSpatialProject, readSecrets } = require(dist('main', 'layster', 'SpatialProjectManager.js'));
  const { validateSpatialProject } = require(dist('shared', 'layster', 'spatial', 'validate.js'));
  const { lowerSpatialProject } = require(dist('shared', 'layster', 'spatial', 'lower.js'));
  const { project } = await readSpatialProject(projectDir).catch((e) => fail(e.message));
  spatialProject = project;
  device = option('--device') || project.targetDevice || 'Meta_Quest';
  const problems = validateSpatialProject(project);
  for (const p of problems) (p.level === 'error' ? result.errors : result.warnings).push(`${p.path}: ${p.message.en}`);
  if (problems.some((p) => p.level === 'error')) fail('the project has errors (see errors)');
  let lowered;
  try {
    lowered = lowerSpatialProject(project, { secrets: await readSecrets(projectDir), targetDevice: device });
  } catch (e) {
    fail(e.message);
  }
  result.warnings.push(...lowered.warnings);
  build = {
    manifestData: lowered.manifestData,
    scenesData: lowered.scenesData,
    uiData: lowered.uiData,
    scriptsData: lowered.scriptsData,
    spatialData: lowered.spatialData,
  };
} else {
  const { generateBuildManifest } = require(dist('bridge', 'UnityBridge.js'));
  const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const project = readJson(path.join(projectDir, 'project.json'));
  // scripts/run-unity-build.js と同じ: 参照だけのシーン / UI は Scenes/ と UI/ から読む
  const expand = (refs, dir, key) => (refs || []).map((ref) => {
    if (ref && ref[key]) return ref;
    const file = path.join(projectDir, dir, `${ref.id}.json`);
    return fs.existsSync(file) ? readJson(file) : ref;
  });
  project.scenes = expand(project.scenes, 'Scenes', 'objects');
  project.uiLayouts = expand(project.uiLayouts, 'UI', 'root');
  device = option('--device') || project.targetDevice || 'XREAL_One';
  const scripts = project.scripts || [];
  build = {
    manifestData: {
      ...generateBuildManifest(project, { targetDevice: device }),
      uiAuthoring: project.uiAuthoring,
      uiCode: project.uiCode,
      scripting: { enabled: scripts.some((sc) => sc.enabled) },
    },
    scenesData: project.scenes || [],
    uiData: project.uiLayouts || [],
    scriptsData: {
      version: '1.0',
      scripts: scripts.filter((sc) => sc.enabled).map((sc) => ({ id: sc.id, name: sc.name, trigger: sc.trigger, code: sc.code, enabled: sc.enabled })),
      storage: { persist: (project.storage && project.storage.persist) || [] },
    },
  };
}
result.device = device;

// ---- 試す空間 ----
let space = null;
const spaceArg = option('--space');
if (spaceArg) {
  if (spaceArg.endsWith('.json') && fs.existsSync(spaceArg)) {
    space = JSON.parse(fs.readFileSync(spaceArg, 'utf8'));
  } else {
    const { findBuiltinSpace } = require(dist('shared', 'layster', 'spatial', 'spaces.js'));
    space = findBuiltinSpace(spaceArg) ?? null;
    if (!space) {
      const { listProjectSpaces } = require(dist('main', 'layster', 'SpatialProjectManager.js'));
      space = (await listProjectSpaces(projectDir)).find((s) => s.id === spaceArg) ?? null;
    }
    if (!space) fail(`unknown space "${spaceArg}" (built-in: studio, desk-front, living, classroom, open-floor, tiny, no-scan, or the project's spaces/<id>.json, or a .json file)`);
  }
  fs.writeFileSync(path.join(out, 'space.json'), JSON.stringify(space, null, 2) + '\n');
  result.space = space.id ?? spaceArg;
}
const eyeHeight = space?.user?.eyeHeight ?? spatialProject?.presentation?.assumedEyeHeight ?? 1.6;

// ---- 画角: --fov か、端末の adapter.json の画角 (横) をこの画の縦横比で縦に直す ----
function deviceFov() {
  const file = path.join(repo, 'Adapters', device, 'adapter.json');
  if (!fs.existsSync(file)) return null;
  try {
    let display = JSON.parse(fs.readFileSync(file, 'utf8')).display;
    if (display && !display.fieldOfView) display = Object.values(display).find((d) => d && d.fieldOfView);
    const fov = display?.fieldOfView;
    if (fov?.horizontal) {
      const h = (fov.horizontal * Math.PI) / 180;
      return (2 * Math.atan(Math.tan(h / 2) * (height / width)) * 180) / Math.PI;
    }
    if (fov?.vertical) return fov.vertical;
  } catch { /* 既定へ */ }
  return null;
}
const fov = Number(option('--fov')) || deviceFov() || 60;
result.fov = Math.round(fov * 10) / 10;

// ---- timeline ----
let timeline = [];
if (option('--timeline')) {
  try {
    const t = JSON.parse(fs.readFileSync(path.resolve(option('--timeline')), 'utf8'));
    timeline = Array.isArray(t) ? t : Array.isArray(t?.steps) ? t.steps : [];
  } catch (e) {
    fail(`timeline: ${e.message}`);
  }
}
const shots = [...new Set(times)].map((t) => ({ t, name: `${t.toFixed(1)}s` }));
for (const step of timeline) if (typeof step?.shot === 'string' && Number.isFinite(step.t)) shots.push({ t: step.t, name: step.shot });
const steps = timeline.filter((s) => s && typeof s === 'object' && !('shot' in s && Object.keys(s).length <= 2));
const lastT = Math.max(0, ...shots.map((s) => s.t), ...steps.map((s) => (Number(s.t) || 0) + (Number(s.over) || 0)));

// ---- Mind: 手元のスタブ / 別の URL ----
let stubServer = null;
const mindCalls = [];
if (isSpatial && (flag('--mind-stub') || option('--mind-url'))) {
  const minds = build.spatialData?.minds ?? [];
  let base = option('--mind-url');
  if (flag('--mind-stub')) {
    const replyFile = args[args.indexOf('--mind-stub') + 1];
    const reply = replyFile && replyFile.endsWith('.json') && fs.existsSync(replyFile)
      ? JSON.parse(fs.readFileSync(replyFile, 'utf8'))
      : { text: 'simulator mind stub', actions: [{ do: 'say', text: 'Hello from the simulator mind stub.' }] };
    stubServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const id = decodeURIComponent((req.url || '').split('/').pop() || '');
        const mind = minds.find((m) => m.id === id);
        mindCalls.push({ mind: id, bytes: body.length, at: new Date().toISOString() });
        const payload = mind?.protocol === 'openai-chat' ? { choices: [{ message: { role: 'assistant', content: JSON.stringify(reply) } }] } : reply;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
    });
    await new Promise((r) => stubServer.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${stubServer.address().port}/mind`;
    log(`[ArsistSim] Mind stub on ${base}`);
  }
  for (const m of minds) m.endpoint = flag('--mind-stub') ? `${base}/${encodeURIComponent(m.id)}` : base;
  result.minds = minds.map((m) => ({ id: m.id, endpoint: m.endpoint }));
}

// ---- ビルド (入力が前回と同じなら飛ばす) ----
const work = path.resolve(option('--work') || path.join(repo, 'tmp', 'ArsistSim', device));
const playerDir = path.join(work, 'player');
const playerPath = path.join(playerDir, 'ArsistSim.x86_64');
fs.mkdirSync(work, { recursive: true });

function newestMtime(dir, depth = 0) {
  let newest = 0;
  if (depth > 8 || !fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'Library', 'Temp', 'Logs', 'Backups', '.layster'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestMtime(p, depth + 1));
    else newest = Math.max(newest, fs.statSync(p).mtimeMs);
  }
  return newest;
}
// generatedAt / exportedAt は毎回変わるので、比べるときは外す
const stable = JSON.stringify(build, (k, v) => (k === 'generatedAt' || k === 'exportedAt' ? undefined : v));
const fingerprint = crypto.createHash('sha1').update(JSON.stringify({
  build: stable, device, unityPath,
  engine: newestMtime(path.join(repo, 'UnityBackend', 'ArsistBuilder', 'Assets')),
  builder: fs.statSync(dist('main', 'unity', 'UnityBuilder.js')).mtimeMs,
  assets: newestMtime(path.join(projectDir, 'Assets')),
  extensions: newestMtime(path.join(repo, 'Extensions')) + newestMtime(path.join(repo, 'samples', 'extensions')),
})).digest('hex');
const stampFile = path.join(work, 'sim-build.json');
let stamp = null;
try { stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8')); } catch { /* 初回 */ }
const reuse = !flag('--rebuild') && stamp?.fingerprint === fingerprint && fs.existsSync(playerPath);
const unityLog = path.join(work, 'unity_sim_build.log');
result.unityBuildLog = unityLog;

if (reuse) {
  log(`[ArsistSim] inputs unchanged; reusing the player ${playerPath}`);
  result.built = false;
} else {
  const { UnityBuilder } = require(dist('main', 'unity', 'UnityBuilder.js'));
  const { setLinkedFoldersSource } = require(dist('main', 'extensions', 'catalogService.js'));
  const { readLinkedFoldersFile } = require(dist('main', 'extensions', 'linkedFolders.js'));
  const builder = new UnityBuilder(unityPath);
  builder.setExtensionUserDir(process.env.ARSIST_EXTENSIONS_DIR || path.join(path.dirname(storePath), 'extensions'));
  if (store.sdkDir) builder.setSdkDir(String(store.sdkDir).trim());
  setLinkedFoldersSource(() => readLinkedFoldersFile(storePath));
  builder.on('progress', (p) => log(`[progress] ${p.phase} ${p.progress}% ${p.message}`));
  builder.on('log', (l) => { if (!/^\[Unity\] /.test(l) || /\[Arsist\]|error/i.test(l)) log(l); });
  log(`[ArsistSim] building ${path.basename(projectDir)} (${result.profile}) for ${device} as a Linux player in ${work} ...`);
  const started = Date.now();
  // 失敗したビルドの後に古いプレイヤーを「できた」と取り違えないよう、先に消す
  fs.rmSync(playerDir, { recursive: true, force: true });
  const r = await builder.build({
    projectPath: path.join(work, 'TempUnityProject'),
    sourceProjectPath: projectDir,
    outputPath: work,
    targetDevice: device,
    buildTarget: 'Android',
    developmentBuild: false,
    ...build,
    buildTimeoutMinutes: 60,
    logFilePath: unityLog,
    simulation: { playerPath },
  });
  result.buildSeconds = Math.round((Date.now() - started) / 1000);
  if (!r.success) {
    result.log.push(...grepLog(unityLog, 80));
    fail(`Unity build failed: ${r.error}`);
  }
  fs.writeFileSync(stampFile, JSON.stringify({ fingerprint, builtAt: new Date().toISOString() }) + '\n');
  result.built = true;
}
result.player = playerPath;

// ---- 動かす ----
// 端末に残す値 (store の persist、keep: forever の置き場所) は、シミュレーターのビルドでは会社名 ArsistSim の下に入る。
// 前の実行を引き継がないよう毎回消す (--keep-storage で残す)
const simData = path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config'), 'unity3d', 'ArsistSim');
if (!flag('--keep-storage') && fs.existsSync(simData)) fs.rmSync(simData, { recursive: true, force: true });
for (const f of fs.readdirSync(out)) if (/^shot-.*\.png$/.test(f) || f === 'sim-player.json') fs.rmSync(path.join(out, f));
const simConfig = {
  out,
  width,
  height,
  fov,
  eyeHeight,
  spatial: isSpatial,
  shots,
  timeline: steps,
  quitAfter: lastT + 0.5,
  space: space ? { id: space.id, knows: space.knows ?? ['scan'], entities: space.entities ?? [] } : null,
  drawSpace: !flag('--no-space'),
  // パススルー (透明な黒で消す) の代わりの色。試す空間を描くときは、壁の外だけに見える
  background: [0.16, 0.17, 0.19],
};
const simConfigPath = path.join(out, 'sim.json');
fs.writeFileSync(simConfigPath, JSON.stringify(simConfig, null, 2) + '\n');
const playerLog = path.join(out, 'player.log');
result.playerLog = playerLog;
const timeoutSec = Number(option('--timeout')) || Math.ceil(lastT + 120);
log(`[ArsistSim] running the player under xvfb (${width}x${height}, fov ${result.fov}°, shots at ${shots.map((s) => s.t).join(', ')} s) ...`);
const code = await new Promise((resolve) => {
  const child = spawn(xvfb, [
    '-a', '-s', `-screen 0 ${width}x${height}x24`,
    playerPath,
    '-arsist-sim', simConfigPath,
    '-screen-width', String(width), '-screen-height', String(height), '-screen-fullscreen', '0',
    '-force-glcore',
    '-logFile', playerLog,
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const timer = setTimeout(() => {
    result.errors.push(`the player did not finish within ${timeoutSec} s (killed)`);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }, timeoutSec * 1000);
  child.on('close', (c) => {
    clearTimeout(timer);
    if (stderr.trim()) result.log.push(...stderr.trim().split('\n').slice(-10).map((l) => `[xvfb] ${l}`));
    resolve(c);
  });
});
if (stubServer) stubServer.close();
if (mindCalls.length) result.mindCalls = mindCalls;
result.playerExit = code;

// ---- 結果 ----
let player = null;
try { player = JSON.parse(fs.readFileSync(path.join(out, 'sim-player.json'), 'utf8')); } catch { /* 下で言う */ }
if (!player) result.errors.push('the player wrote no sim-player.json (see playerLog)');
result.graphics = player?.graphics;
result.shots = player?.shots ?? [];
result.timeline = player?.timeline ?? [];
result.files = result.shots.filter((s) => s.file).map((s) => s.file);
for (const s of result.shots) {
  if (s.error) result.errors.push(`shot ${s.name}: ${s.error}`);
  else if (s.stats && s.stats.nonBackground < 0.002) result.warnings.push(`shot ${s.name} is (almost) a single colour: nothing in view?`);
}
for (const e of player?.errors ?? []) result.errors.push(`player: ${e}`);
result.log.push(...grepLog(playerLog, 300));
result.ok = !!player && result.files.length === shots.length && code === 0;
finish(result.ok ? 0 : 1);

/** ログから [Arsist] / [ArsistJS] / [Layster] / [ArsistSim] の行と、エラー・例外の行を抜く。 */
function grepLog(file, max) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const keep = lines.filter((l) => /\[(Arsist|ArsistJS|Layster|ArsistSim)\]|Exception|error CS\d+|^\s*Error/i.test(l) && !/^\s*at |UnityEngine\.Debug/.test(l));
    return keep.slice(-max).map((l) => l.slice(0, 400));
  } catch {
    return [];
  }
}
