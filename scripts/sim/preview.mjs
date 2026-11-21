#!/usr/bin/env node
/**
 * プレビュー シミュレータ — Unity もエディタの画面も使わず、「端末でユーザーに見えるもの」をおおよそ描いて PNG にする。
 * (doc/22-simulation.md。本物の Unity ランタイムで撮るのは scripts/sim/unity.mjs)
 *
 *   node scripts/sim/preview.mjs <project dir> --out <dir> [--space <id>|all] [--scene <id>|all]
 *     [--device <adapter>] [--times 0,2,5] [--width 1280 --height 720] [--view first-person|overview]
 *     [--overlays] [--lang en|ja] [--timeout <sec>] [--json]
 *
 * 要るもの: `npm run build:renderer` 済みの dist/renderer/sim/sim.html と、node_modules の Electron。
 * Electron は見えない窓で動き、設定は一時フォルダ (HOME / XDG_CONFIG_HOME / --user-data-dir) に閉じ込める
 * (本物の ~/.config/arsist-engine は触らない)。DISPLAY が無ければ xvfb-run で動かす (無ければ止まって知らせる)。
 *
 * 出力: <out>/<space>-t<sec>.png (Virtual は <scene>-t0.png)、<out>/result.json。
 * 終了コード: 0 = 全部撮れた / 1 = 撮れなかったものがある / 2 = 引数・準備の誤り。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { USAGE, parseArgs, safeName, timeTag } from './args.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);

function fail(message, code = 2) {
  console.error(`preview: ${message}`);
  process.exit(code);
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.ok) fail(`${parsed.error}\n${USAGE}`);
const opts = parsed.opts;
if (opts.help) { console.log(USAGE); process.exit(0); }

// ---------- プロジェクト ----------
const projectDir = path.resolve(opts.project);
const spatialFile = path.join(projectDir, 'project.spatial.json');
const virtualFile = path.join(projectDir, 'project.json');
let kind;
let project;
try {
  if (fs.existsSync(spatialFile)) { kind = 'spatial'; project = JSON.parse(fs.readFileSync(spatialFile, 'utf8')); }
  else if (fs.existsSync(virtualFile)) { kind = 'virtual'; project = JSON.parse(fs.readFileSync(virtualFile, 'utf8')); }
  else fail(`${projectDir} has neither project.spatial.json nor project.json`);
} catch (e) {
  fail(`cannot read the project: ${e.message}`);
}

const simHtml = path.join(repoRoot, 'dist', 'renderer', 'sim', 'sim.html');
if (!fs.existsSync(simHtml)) {
  fail(`${path.relative(process.cwd(), simHtml)} is missing — run \`npm run build:renderer\` first (the simulator page is part of the renderer build).`);
}

let electronBin;
try {
  electronBin = require('electron');
} catch {
  fail('Electron is not installed (node_modules/electron) — run `npm install`.');
}

const warnings = [];

// ---------- 端末 (視野角) ----------
function findAdapter(name) {
  if (!name) return null;
  const roots = [path.join(repoRoot, 'Adapters')];
  const extRoot = path.join(repoRoot, 'Extensions');
  if (fs.existsSync(extRoot)) {
    for (const e of fs.readdirSync(extRoot)) roots.push(path.join(extRoot, e, 'Adapters'));
  }
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const hit = fs.readdirSync(root).find((d) => d.toLowerCase() === name.toLowerCase());
    if (hit && fs.existsSync(path.join(root, hit, 'adapter.json'))) {
      try { return { name: hit, adapter: JSON.parse(fs.readFileSync(path.join(root, hit, 'adapter.json'), 'utf8')) }; }
      catch (e) { warnings.push(`cannot read ${hit}/adapter.json: ${e.message}`); }
    }
  }
  return null;
}
const deviceName = opts.device || project.targetDevice || '';
const found = findAdapter(deviceName);
if (!found) warnings.push(`adapter "${deviceName || '(none)'}" not found; using 50° vertical, 16:9`);
const adapter = found?.adapter ?? null;

// ---------- 撮るもの ----------
const outDir = path.resolve(opts.out);
fs.mkdirSync(outDir, { recursive: true });
const projectUrl = pathToFileURL(projectDir + path.sep).href;
const base = {
  width: opts.width, height: opts.height, view: opts.view, overlays: opts.overlays, lang: opts.lang,
  adapter, deviceName: found?.name ?? (deviceName || 'unknown'), projectUrl,
};
const shots = []; // { file, key, t, job }

if (kind === 'spatial') {
  const projectSpaces = [];
  const spacesDir = path.join(projectDir, 'spaces');
  if (fs.existsSync(spacesDir)) {
    for (const f of fs.readdirSync(spacesDir).filter((x) => x.endsWith('.json')).sort()) {
      try { projectSpaces.push(JSON.parse(fs.readFileSync(path.join(spacesDir, f), 'utf8'))); }
      catch (e) { warnings.push(`spaces/${f}: ${e.message}`); }
    }
  }
  const inUse = Array.isArray(project.spaces?.use) && project.spaces.use.length ? project.spaces.use : ['studio'];
  const spaces = !opts.space || opts.space === 'all' ? inUse : opts.space.split(',').map((s) => s.trim()).filter(Boolean);
  const suffix = opts.view === 'overview' ? '-overview' : '';
  for (const spaceId of spaces) {
    for (const t of opts.times) {
      shots.push({
        file: path.join(outDir, `${safeName(spaceId)}${suffix}-${timeTag(t)}.png`), key: spaceId, t,
        job: { ...base, kind: 'spatial', project, spaceId, projectSpaces, t },
      });
    }
  }
} else {
  if (opts.view === 'overview') warnings.push('--view overview is only for Layster.Spatial; rendering first-person');
  if (opts.times.length > 1 || opts.times[0] !== 0) warnings.push('Layster.Virtual preview is static; --times is ignored (rendered at t=0)');
  // Scenes/<id>.json と UI/<id>.json の写しがあれば、そちらが勝つ (エディタの sceneCopies と同じ約束。doc/09)
  const fileCopy = (dir, item) => {
    const f = item?.id ? path.join(projectDir, dir, `${item.id}.json`) : null;
    if (!f || !fs.existsSync(f)) return item;
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (e) { warnings.push(`${dir}/${item.id}.json: ${e.message}; using the copy in project.json`); return item; }
  };
  if (Array.isArray(project.scenes)) project.scenes = project.scenes.map((s) => fileCopy('Scenes', s));
  if (Array.isArray(project.uiLayouts)) project.uiLayouts = project.uiLayouts.map((l) => fileCopy('UI', l));
  const scenes = Array.isArray(project.scenes) ? project.scenes : [];
  const idOf = (s, i) => s?.id ?? `scene-${i}`;
  let chosen;
  if (!opts.scene) chosen = scenes.slice(0, 1).map((s) => idOf(s, 0));
  else if (opts.scene === 'all') chosen = scenes.map(idOf);
  else {
    chosen = opts.scene.split(',').map((want) => {
      const i = scenes.findIndex((s) => s?.id === want || s?.name === want);
      if (i < 0) { warnings.push(`scene "${want}" not found`); return null; }
      return idOf(scenes[i], i);
    }).filter(Boolean);
  }
  if (scenes.length === 0) chosen = ['(none)'];
  for (const sceneId of chosen) {
    const scene = scenes.find((s, i) => idOf(s, i) === sceneId);
    const label = scene?.name || sceneId;
    shots.push({
      file: path.join(outDir, `${safeName(label)}-t0.png`), key: label, t: 0,
      job: { ...base, view: 'first-person', kind: 'virtual', project, sceneId, t: 0 },
    });
  }
}
if (shots.length === 0) fail('nothing to render');

// ---------- Electron を、本物の設定から切り離して動かす ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arsist-sim-'));
for (const d of ['home', 'config', 'cache', 'userdata']) fs.mkdirSync(path.join(tmp, d));
const planPath = path.join(tmp, 'plan.json');
const resultPath = path.join(tmp, 'electron-result.json');
fs.writeFileSync(planPath, JSON.stringify({
  simHtml, width: opts.width, height: opts.height, resultPath,
  frameTimeoutMs: Math.max(10000, Math.min(60000, opts.timeout * 1000)),
  jobs: shots.map((s) => ({ file: s.file, job: s.job })),
}));

const env = {
  ...process.env,
  HOME: path.join(tmp, 'home'),
  XDG_CONFIG_HOME: path.join(tmp, 'config'),
  XDG_CACHE_HOME: path.join(tmp, 'cache'),
  ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  ELECTRON_NO_ATTACH_CONSOLE: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const electronArgs = [
  path.join(here, 'electron-main.cjs'), `--user-data-dir=${path.join(tmp, 'userdata')}`, '--no-sandbox', planPath,
];

function hasCommand(cmd) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}

// 画面: ARSIST_SIM_DISPLAY = direct | xvfb で強制できる。
// Electron 28 の Chromium の headless (--headless / --ozone-platform=headless) は、ここ (Linux) では起動直後に落ちたので使わない。
let mode = process.env.ARSIST_SIM_DISPLAY;
if (!mode) {
  if (process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY) mode = 'direct';
  else if (hasCommand('xvfb-run')) mode = 'xvfb';
  else fail('no display (DISPLAY / WAYLAND_DISPLAY) and no xvfb-run — install Xvfb (e.g. `apt install xvfb`) or run inside a desktop session.');
}
let command = electronBin;
let args = electronArgs;
if (mode === 'xvfb') {
  command = 'xvfb-run';
  args = ['-a', '-s', `-screen 0 ${Math.max(opts.width, 1280)}x${Math.max(opts.height, 720)}x24`, electronBin, ...electronArgs];
} else if (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) {
  args = [...electronArgs.slice(0, -1), '--ozone-platform=wayland', electronArgs.at(-1)];
}

const started = Date.now();
const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', (d) => { output += d; if (process.env.ARSIST_SIM_DEBUG) process.stderr.write(d); });
child.stderr.on('data', (d) => { output += d; if (process.env.ARSIST_SIM_DEBUG) process.stderr.write(d); });
const killer = setTimeout(() => { output += '\n[preview] timed out; killing Electron'; child.kill('SIGKILL'); }, opts.timeout * 1000);
const exitCode = await new Promise((resolve) => child.on('close', (code) => resolve(code)));
clearTimeout(killer);

let electronResult = null;
try { electronResult = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch { /* 下で扱う */ }
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

if (!electronResult) {
  const tail = output.split('\n').filter((l) => l.trim()).slice(-15).join('\n');
  fail(`Electron (${mode}) exited with ${exitCode} before writing results.\n${tail}`, 1);
}

// ---------- result.json ----------
const byFile = new Map(electronResult.frames.map((f) => [f.file, f]));
const files = [];
const placements = {};
const timeline = {};
let fov = null;
for (const s of shots) {
  const frame = byFile.get(s.file);
  if (!frame) continue;
  const info = frame.info ?? {};
  fov = fov ?? info.fov ?? null;
  for (const w of info.warnings ?? []) warnings.push(w);
  files.push({ file: path.basename(s.file), [kind === 'spatial' ? 'space' : 'scene']: s.key, t: s.t, ms: frame.ms });
  if (info.placements && !placements[s.key]) placements[s.key] = info.placements;
  if (info.timeline) (timeline[s.key] ??= {})[String(s.t)] = info.timeline;
}
const errors = electronResult.errors.map((e) => ({ file: e.file ? path.basename(e.file) : null, error: e.error }));
const consoleErrors = (electronResult.console ?? []).filter((l) => !/Electron Security Warning|DevTools/.test(l)).slice(0, 20);
const result = {
  ok: errors.length === 0 && files.length === shots.length,
  simulator: 'preview',
  approximate: true,
  kind,
  layster: project.layster ?? null,
  project: { name: project.name ?? path.basename(projectDir), dir: projectDir },
  device: base.deviceName,
  fov,
  view: opts.view,
  size: { width: opts.width, height: opts.height },
  times: kind === 'spatial' ? opts.times : [0],
  display: mode,
  ms: Date.now() - started,
  files,
  ...(kind === 'spatial' ? { placements, timeline } : {}),
  warnings: [...new Set(warnings)],
  errors,
  console: consoleErrors,
};
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));

if (opts.json) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  console.log(`preview (approximate): ${result.project.name} [${kind}] on ${result.device}${fov ? ` (FOV ${fov.horizontal}°×${fov.vertical}°)` : ''}`);
  for (const f of files) console.log(`  ${path.join(outDir, f.file)}  (${f.ms} ms)`);
  if (kind === 'spatial') {
    for (const [space, list] of Object.entries(placements)) {
      const text = list.map((p) => `${p.thing}:${p.rule === 0 ? 'intended' : p.rule === 'default' ? 'DEFAULT' : `fallback${p.rule}`}`).join(' ');
      console.log(`  [${space}] ${text}`);
    }
  }
  for (const w of result.warnings) console.log(`  warning: ${w}`);
  for (const e of errors) console.log(`  error: ${e.file ?? ''} ${e.error}`);
  console.log(`  result: ${path.join(outDir, 'result.json')}  (${result.ms} ms, display: ${mode})`);
}
process.exit(result.ok ? 0 : 1);
