#!/usr/bin/env node
/**
 * arsist — Arsist をエディタ無しで動かすコマンド (CI・エージェント・スクリプト向け)。doc/21-cli.md。
 *
 *   npm run arsist -- <command> …      /   npx arsist <command> …   /   node scripts/arsist.mjs <command> …
 *
 * 中身はエディタと同じコンパイル済みの dist/main (MCP のツール・SpatialProjectManager・UnityBuilder …) を呼ぶだけ。
 * 先に `npm run build:main` が要る (無ければ・古ければそう言う)。
 *
 * どのコマンドも --json で「stdout に JSON 1 つ、ログは stderr」になる。終了コード:
 *   0 成功 / 1 失敗 / 2 使い方の誤り / 3 検証で問題が見つかった
 *
 * 設定はエディタと同じ electron-store の config.json (scripts/lib/config-path.js) から読み、
 * 指定 (--unity / --sdk / --out …) と環境変数 (ARSIST_UNITY_PATH / ARSIST_SDK_DIR / ARSIST_OUTPUT_PATH …) が優先する。
 * このコマンドは config.json に書かない (書くのは `arsist ext link|unlink` だけ。エディタの「フォルダを登録」と同じ)。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs, listOption, UsageError } from './lib/cli-args.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
// 開発中: <repo>/dist/main / パッケージ版: ARSIST_APP_ROOT (resources/app.asar) の dist/main
const APP_ROOT = [process.env.ARSIST_APP_ROOT, REPO].filter(Boolean)
  .find((r) => fs.existsSync(path.join(r, 'dist', 'main', 'main', 'mcp', 'tools.js'))) ?? REPO;
const DIST = path.join(APP_ROOT, 'dist', 'main');

const EXIT = { ok: 0, fail: 1, usage: 2, invalid: 3 };

class CliError extends Error {
  constructor(message, code = EXIT.fail, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

// ---- 出力 -------------------------------------------------------------------

let jsonMode = false;
let quiet = false;
const realStdoutWrite = process.stdout.write.bind(process.stdout);

/** --json のときは、dist の中の console.log も含めてログをすべて stderr に回す (stdout は JSON 1 つだけ)。 */
function enterJsonMode() {
  jsonMode = true;
  const toErr = (...a) => console.error(...a);
  console.log = toErr;
  console.info = toErr;
  console.debug = toErr;
}

const log = (...a) => { if (!quiet) console.error(...a); };
const say = (text = '') => { if (!jsonMode) realStdoutWrite(`${text}\n`); };

function emitJson(obj) {
  realStdoutWrite(`${JSON.stringify(obj, null, 2)}\n`);
}

// ---- dist/main --------------------------------------------------------------

function distFile(rel) {
  return path.join(DIST, ...rel.split('/')) + '.js';
}

let staleChecked = false;
/** dist/main が無ければ止める。src より古ければ知らせる (止めない。古いままでも動くことが多い)。 */
function checkDist() {
  if (!fs.existsSync(distFile('main/mcp/tools'))) {
    throw new CliError('dist/main is missing: run `npm run build:main` in the Arsist folder first');
  }
  if (staleChecked || process.env.ARSIST_CLI_SKIP_STALE_CHECK === '1') return;
  staleChecked = true;
  const src = path.join(APP_ROOT, 'src');
  if (!fs.existsSync(src)) return; // パッケージ版 (src が無い)
  const stale = [];
  for (const top of ['main', 'shared', 'bridge']) walkTs(path.join(src, top), (file) => {
    const rel = path.relative(src, file).replace(/\.tsx?$/, '.js');
    const out = path.join(DIST, rel);
    let outTime = 0;
    try { outTime = fs.statSync(out).mtimeMs; } catch { /* 無い */ }
    if (fs.statSync(file).mtimeMs > outTime + 1000) stale.push(path.relative(APP_ROOT, file));
  });
  if (stale.length) {
    console.error(`[arsist] dist/main is older than ${stale.length} source file(s) (e.g. ${stale.slice(0, 3).join(', ')}): ` +
      'run `npm run build:main` to use the current code (set ARSIST_CLI_SKIP_STALE_CHECK=1 to silence)');
  }
}

function walkTs(dir, visit) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTs(p, visit);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) visit(p);
  }
}

function dist(rel) {
  checkDist();
  const file = distFile(rel);
  if (!fs.existsSync(file)) throw new CliError(`${path.relative(APP_ROOT, file)} not found: run \`npm run build:main\``);
  return require(file);
}

// ---- 設定 (エディタの config.json + 指定 + 環境変数) ---------------------------

function configStorePath() {
  const { getConfigStorePath } = require(path.join(HERE, 'lib', 'config-path.js'));
  return getConfigStorePath('arsist-engine');
}

function readStore(file) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  } catch {
    return {};
  }
}

/** 使う設定と、それぞれどこから来たか。 */
function resolveConfig(opts = {}) {
  const storePath = configStorePath();
  const store = readStore(storePath);
  const pick = (flag, env, key) => {
    if (flag !== undefined && flag !== '') return { value: flag, from: 'flag' };
    if (env && process.env[env]) return { value: process.env[env], from: `env ${env}` };
    if (key && store[key] !== undefined && store[key] !== '') return { value: store[key], from: `config ${key}` };
    return { value: undefined, from: 'unset' };
  };
  const extraFolders = [
    ...listOption(opts['ext-folder']).map((p) => path.resolve(p)),
    ...String(process.env.ARSIST_EXTENSION_FOLDERS ?? '').split(path.delimiter).filter(Boolean).map((p) => path.resolve(p)),
  ];
  return {
    configFile: storePath,
    configExists: fs.existsSync(storePath),
    unityPath: pick(opts.unity, 'ARSIST_UNITY_PATH', 'unityPath'),
    unityVersion: pick(undefined, 'ARSIST_UNITY_VERSION', 'unityVersion'),
    sdkDir: pick(opts.sdk, 'ARSIST_SDK_DIR', 'sdkDir'),
    outputPath: pick(opts.out, 'ARSIST_OUTPUT_PATH', 'defaultOutputPath'),
    manualLicenseFile: pick(opts.license, 'ARSIST_MANUAL_LICENSE_FILE', 'unityManualLicenseFile'),
    extensionsDir: pick(undefined, 'ARSIST_EXTENSIONS_DIR', undefined).value
      ? { value: process.env.ARSIST_EXTENSIONS_DIR, from: 'env ARSIST_EXTENSIONS_DIR' }
      : { value: path.join(path.dirname(storePath), 'extensions'), from: 'default (<config dir>/extensions)' },
    extraExtensionFolders: extraFolders,
    recentProjects: Array.isArray(store.recentProjects) ? store.recentProjects.filter((p) => typeof p === 'string') : [],
  };
}

/** 拡張機能の一覧をエディタ / MCP サーバーと同じ場所から作る (ユーザーの置き場 + 登録したフォルダ)。 */
function setupCatalog(config) {
  const { setUserExtensionsDir, setLinkedFoldersSource } = dist('main/extensions/catalogService');
  const { readLinkedFoldersFile } = dist('main/extensions/linkedFolders');
  setUserExtensionsDir(config.extensionsDir.value);
  setLinkedFoldersSource(() => [...readLinkedFoldersFile(config.configFile), ...config.extraExtensionFolders]);
}

let session = null;
function toolSession(config, projectPath) {
  if (!session) {
    const { ToolSession } = dist('main/mcp/tools');
    session = new ToolSession({
      projectPath: projectPath ?? process.env.ARSIST_PROJECT_PATH ?? process.env.MCP_PROJECT_PATH ?? null,
      recentProjects: () => config.recentProjects,
    });
  }
  return session;
}

/** MCP のツールを 1 つ呼ぶ (エージェントと同じ実装)。失敗は CliError にする。 */
async function tool(config, name, args, projectPath) {
  const { callArsistTool } = dist('main/mcp/tools');
  const outcome = await callArsistTool(toolSession(config, projectPath), name, args);
  if (!outcome.ok) throw new CliError(`${name}: ${outcome.error}`);
  return outcome.result;
}

// ---- プロジェクト -----------------------------------------------------------

async function projectKind(dir) {
  if (!dir) throw new CliError('a project folder is required', EXIT.usage);
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) throw new CliError(`not found: ${abs}`);
  const { detectProjectKind } = dist('main/layster/projectKind');
  const kind = await detectProjectKind(abs);
  if (kind.kind === 'none') throw new CliError(`${abs} has neither project.json (Layster.Virtual) nor project.spatial.json (Layster.Spatial)`);
  return { ...kind, dir: abs };
}

async function requireSpatial(dir) {
  const kind = await projectKind(dir);
  if (kind.kind !== 'spatial') throw new CliError(`${kind.dir} is ${kind.label}; this command needs a Layster.Spatial project (project.spatial.json)`, EXIT.usage);
  return kind;
}

async function matchDevice(name) {
  const { listAdapterLocations } = dist('main/adapters/adapterDirs');
  const { matchAdapterName } = dist('shared/adapterNames');
  const all = (await listAdapterLocations()).map((a) => a.name);
  const hit = matchAdapterName(all, name);
  if (!hit) throw new CliError(`unknown device "${name}" (known: ${all.join(', ') || 'none'}; see \`arsist devices\`)`, EXIT.usage);
  return hit;
}

/** Spatial の検証: validateSpatialProject + 拡張機能と端末が揃っているか + lower の警告 (ビルドと同じ順)。 */
async function validateSpatial(config, dir, device) {
  const v = await tool(config, 'spatial_validate', { projectPath: dir });
  // spatial_validate は 'error: <path>: …' の形。ここでは errors / warnings に分けるので頭の level は外す
  const strip = (x) => String(x).replace(/^(error|warning): /, '');
  const errors = v.errors.map(strip);
  const warnings = v.warnings.map(strip);
  const { readSpatialProject, readSecrets } = dist('main/layster/SpatialProjectManager');
  const { project } = await readSpatialProject(dir);
  const target = device || project.targetDevice;
  const { getExtensionCatalog } = dist('main/extensions/catalogService');
  const { listBuiltinAdapterNames } = dist('main/adapters/adapterDirs');
  const { checkProjectRequirements } = dist('shared/extensions');
  const { CURRENT_IR_VERSION } = dist('shared/irVersion');
  const catalog = await getExtensionCatalog(true);
  for (const m of checkProjectRequirements({ ...project, targetDevice: target }, catalog.extensions.map((e) => e.manifest), await listBuiltinAdapterNames(), CURRENT_IR_VERSION)) {
    errors.push(`${m.kind}: ${m.detail}`);
  }
  let lowered = null;
  if (errors.length === 0) {
    const { lowerSpatialProject } = dist('shared/layster/spatial/lower');
    try {
      lowered = lowerSpatialProject(project, { secrets: await readSecrets(dir), targetDevice: target });
      for (const w of lowered.warnings) warnings.push(`lower: ${w}`);
      for (const n of lowered.bakedSecrets) warnings.push(`lower: the key "${n}" is baked into the APK`);
    } catch (e) {
      errors.push(`lower: ${e.message}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, notices: v.notices ?? [], project, lowered, targetDevice: target };
}

async function validateVirtual(config, dir) {
  const r = await tool(config, 'ir_validate_project', { projectPath: dir });
  return { ok: r.ok, errors: r.problems, warnings: r.warnings };
}

// ---- コマンド ---------------------------------------------------------------

const COMMANDS = {};
const command = (name, spec) => { COMMANDS[name] = spec; };

command('info', {
  usage: 'arsist info <dir>',
  summary: 'Kind (Virtual / Spatial), Layster version, name, device and counts of a project',
  async run({ positional }, config) {
    const kind = await projectKind(positional[0]);
    if (kind.kind === 'spatial') {
      const p = await tool(config, 'spatial_get_project', { projectPath: kind.dir });
      const out = {
        kind: 'spatial', format: p.format, name: p.name, path: kind.dir, targetDevice: p.targetDevice,
        counts: { things: p.things.length, minds: p.minds.length, bodies: p.bodies.length, rules: p.rules.length, scripts: p.scripts.length, spaces: p.spaces.length },
        extensions: p.extensions, problems: p.problems, ...(p.notices ? { notices: p.notices } : {}),
      };
      return { ok: true, ...out };
    }
    const p = await tool(config, 'ir_get_project', { projectPath: kind.dir });
    return {
      ok: true, kind: 'virtual', format: p.format, irVersion: p.irVersion, name: p.name, path: kind.dir, targetDevice: p.targetDevice,
      ...(p.readOnly ? { readOnly: p.readOnly } : {}),
      counts: {
        scenes: p.scenes.length, objects: p.scenes.reduce((n, s) => n + s.objects, 0),
        uiLayouts: p.uiLayouts.length, uiElements: p.uiLayouts.reduce((n, l) => n + l.elements, 0),
        scripts: p.scripts.length, models: p.models.length,
        dataSources: p.dataFlow.dataSources, transforms: p.dataFlow.transforms,
      },
      extensions: p.extensions,
    };
  },
  print(r) {
    say(`${r.name}  (${r.format})`);
    say(`  path:    ${r.path}`);
    say(`  device:  ${r.targetDevice}`);
    say(`  counts:  ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (r.extensions?.length) say(`  extensions: ${r.extensions.join(', ')}`);
    if (r.problems) say(`  problems: ${r.problems.errors} error(s), ${r.problems.warnings} warning(s)`);
    if (r.readOnly) say(`  read-only: ${r.readOnly}`);
  },
});

command('validate', {
  usage: 'arsist validate <dir> [--device X]',
  summary: 'Check a project like the build does (exit 3 when there are errors)',
  async run({ positional, options }, config) {
    const kind = await projectKind(positional[0]);
    if (kind.kind === 'spatial') {
      const device = options.device ? await matchDevice(options.device) : undefined;
      const r = await validateSpatial(config, kind.dir, device);
      return { ok: r.ok, kind: 'spatial', format: kind.label, path: kind.dir, targetDevice: r.targetDevice, errors: r.errors, warnings: r.warnings, ...(r.notices.length ? { notices: r.notices } : {}) };
    }
    const r = await validateVirtual(config, kind.dir);
    return { ok: r.ok, kind: 'virtual', format: kind.label, path: kind.dir, errors: r.errors, warnings: r.warnings };
  },
  exitCode: (r) => (r.ok ? EXIT.ok : EXIT.invalid),
  print(r) {
    for (const e of r.errors) say(`ERROR: ${e}`);
    for (const w of r.warnings) say(`WARNING: ${w}`);
    for (const n of r.notices ?? []) say(`note: ${n}`);
    say(`${r.ok ? 'OK' : 'FAILED'}: ${r.path} (${r.format}) — ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
  },
});

command('upgrade', {
  usage: 'arsist upgrade <dir>... [--dry-run]',
  summary: 'Upgrade old Layster.Virtual project.json files (wraps scripts/layster-upgrade.mjs)',
  booleans: ['dry-run'],
  async run({ positional, options }) {
    if (!positional.length) throw new CliError('usage: arsist upgrade <dir>... [--dry-run]', EXIT.usage);
    checkDist();
    return runScript(path.join(HERE, 'layster-upgrade.mjs'), [...positional, ...(options['dry-run'] ? ['--dry-run'] : [])]);
  },
  exitCode: (r) => r.exitCode,
});

command('new', {
  usage: 'arsist new virtual|spatial <parentDir> <name> [--device X] [--template 3d_ar_scene|2d_floating_screen|head_locked_hud]',
  summary: 'Create a project (same as the editor\'s New Project)',
  async run({ positional, options }, config) {
    const [profile, parentDir, name] = positional;
    if (!['virtual', 'spatial'].includes(profile) || !parentDir || !name) {
      throw new CliError('usage: arsist new virtual|spatial <parentDir> <name> [--device X]', EXIT.usage);
    }
    const parent = path.resolve(parentDir);
    fs.mkdirSync(parent, { recursive: true });
    if (profile === 'spatial') {
      const device = await matchDevice(options.device || 'Meta_Quest');
      const r = await tool(config, 'spatial_create_project', { parentDir: parent, name, targetDevice: device });
      return { ok: true, kind: 'spatial', path: r.created, name: r.name, format: r.format, targetDevice: device };
    }
    const device = await matchDevice(options.device || 'XREAL_One');
    const { PROJECT_TEMPLATES } = dist('main/project/defaults');
    const template = options.template || '3d_ar_scene';
    if (!PROJECT_TEMPLATES.includes(template)) throw new CliError(`unknown template "${template}" (one of ${PROJECT_TEMPLATES.join(', ')})`, EXIT.usage);
    if (/[\\/:*?"<>|]/.test(name)) throw new CliError(`the project name cannot contain \\ / : * ? " < > | (got "${name}")`, EXIT.usage);
    const dir = path.join(parent, name);
    if (fs.existsSync(path.join(dir, 'project.json')) || fs.existsSync(path.join(dir, 'project.spatial.json'))) {
      throw new CliError(`a project already exists in ${dir}`);
    }
    const { ProjectManager } = dist('main/project/ProjectManager');
    const r = await new ProjectManager().createProject({ name, path: parent, template, targetDevice: device });
    if (!r.success) throw new CliError(r.error || 'could not create the project');
    const { describeVirtualIrVersion } = dist('shared/layster/version');
    return { ok: true, kind: 'virtual', path: dir, name, format: `Layster.Virtual ${describeVirtualIrVersion(r.project.irVersion)}`, targetDevice: device, template };
  },
  print(r) { say(`created ${r.path} (${r.format}, ${r.targetDevice})`); },
});

command('tools', {
  usage: 'arsist tools [--json]',
  summary: 'List every MCP tool (ir_*, arsist_*, spatial_*) with its input schema',
  async run() {
    const { ARSIST_TOOLS } = dist('main/mcp/tools');
    return {
      ok: true,
      count: ARSIST_TOOLS.length,
      tools: ARSIST_TOOLS.map((t) => ({ name: t.name, readOnly: t.readOnly, description: t.description, inputSchema: t.inputSchema })),
    };
  },
  print(r) {
    for (const t of r.tools) say(`${t.name.padEnd(30)} ${t.readOnly ? 'read ' : 'write'}  ${t.description.split(/(?<=\.)\s/)[0]}`);
    say(`\n${r.count} tools. \`arsist tool <name> --schema\` shows one tool's arguments.`);
  },
});

command('tool', {
  usage: 'arsist tool <name> [<json args> | --args-file f | --args-file -] [--project dir] [--schema]',
  summary: 'Call one MCP tool exactly like an agent would (callArsistTool + ToolSession)',
  booleans: ['schema'],
  async run({ positional, options }, config) {
    const [name, inline] = positional;
    if (!name) throw new CliError('usage: arsist tool <name> [<json args>] [--args-file f] [--project dir]', EXIT.usage);
    const { ARSIST_TOOLS } = dist('main/mcp/tools');
    const def = ARSIST_TOOLS.find((t) => t.name === name);
    if (!def) throw new CliError(`unknown tool: ${name} (see \`arsist tools\`)`, EXIT.usage);
    if (options.schema) return { ok: true, tool: name, readOnly: def.readOnly, description: def.description, inputSchema: def.inputSchema, schemaOnly: true };
    let text = inline;
    if (options['args-file'] !== undefined) {
      if (inline !== undefined) throw new CliError('pass the arguments either inline or with --args-file, not both', EXIT.usage);
      text = options['args-file'] === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(options['args-file']), 'utf8');
    }
    let args = {};
    if (text !== undefined && text.trim()) {
      try {
        args = JSON.parse(text);
      } catch (e) {
        throw new CliError(`the tool arguments are not valid JSON: ${e.message}`, EXIT.usage);
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new CliError('the tool arguments must be a JSON object', EXIT.usage);
    }
    const project = options.project ? path.resolve(options.project) : undefined;
    const { callArsistTool } = dist('main/mcp/tools');
    const outcome = await callArsistTool(toolSession(config, project), name, args);
    if (!outcome.ok) return { ok: false, tool: name, error: outcome.error };
    return { ok: true, tool: name, result: outcome.result };
  },
  // ツール自体の失敗は 1。結果が { ok: false } (ir_validate_project / spatial_validate …) なら 3
  exitCode: (r) => (!r.ok ? EXIT.fail : r.result && typeof r.result === 'object' && r.result.ok === false ? EXIT.invalid : EXIT.ok),
  print(r) {
    if (r.schemaOnly) {
      say(`${r.tool} (${r.readOnly ? 'read-only' : 'writes'})\n\n${r.description}\n\n${JSON.stringify(r.inputSchema, null, 2)}`);
      return;
    }
    if (!r.ok) { console.error(`[arsist] ${r.tool} failed: ${r.error}`); return; }
    say(typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2));
  },
});

command('solve', {
  usage: 'arsist solve <spatial dir> [--space id]... [--thing id]... [--strict]',
  summary: 'Run the placement solver in test rooms (spatial_solve); --strict exits 3 if a thing falls back to the default',
  repeatable: ['space', 'thing'],
  booleans: ['strict'],
  async run({ positional, options }, config) {
    const kind = await requireSpatial(positional[0]);
    const args = { projectPath: kind.dir };
    const spaces = listOption(options.space);
    const things = listOption(options.thing);
    if (spaces.length) args.spaces = spaces;
    if (things.length) args.things = things;
    const r = await tool(config, 'spatial_solve', args);
    const defaults = r.results.filter((x) => x.rule === 'default').map((x) => `${x.thing}@${x.space}`);
    return { ok: !(options.strict && defaults.length) && !(r.unknownSpaces?.length), path: kind.dir, ...r, defaulted: defaults };
  },
  exitCode: (r) => (r.unknownSpaces?.length ? EXIT.usage : r.ok ? EXIT.ok : EXIT.invalid),
  print(r) {
    if (r.unknownSpaces?.length) console.error(`[arsist] unknown space(s): ${r.unknownSpaces.join(', ')} (see \`arsist tool spatial_list_spaces\`)`);
    for (const x of r.results) {
      const at = Array.isArray(x.at) ? x.at.map((v) => v.toFixed(2)).join(', ') : JSON.stringify(x.at);
      say(`${x.space.padEnd(12)} ${x.thing.padEnd(20)} rule ${String(x.rule).padEnd(8)} ${x.host ? `on ${x.host} ` : ''}at [${at}]${x.notes ? `  (${x.notes.join('; ')})` : ''}`);
    }
    say('');
    for (const [thing, s] of Object.entries(r.summary)) say(`${thing}: own ${s.own}, fallback ${s.fallback}, default ${s.default}`);
  },
});

command('lower', {
  usage: 'arsist lower <spatial dir> --out <dir> [--device X]',
  summary: 'Write the five files a Spatial build hands to Unity, without Unity',
  async run({ positional, options }, config) {
    const kind = await requireSpatial(positional[0]);
    if (!options.out) throw new CliError('usage: arsist lower <spatial dir> --out <dir> [--device X]', EXIT.usage);
    const device = options.device ? await matchDevice(options.device) : undefined;
    const v = await validateSpatial(config, kind.dir, device);
    if (!v.ok) return { ok: false, path: kind.dir, errors: v.errors, warnings: v.warnings };
    const out = path.resolve(options.out);
    fs.mkdirSync(out, { recursive: true });
    const l = v.lowered;
    const files = {
      // UnityBuilder.transferProjectData と同じく、manifest.json は scenes も持つ (layster-build.mjs --lower-only と同じ)
      'manifest.json': { ...l.manifestData, scenes: l.scenesData },
      'scenes.json': l.scenesData,
      'ui_layouts.json': l.uiData,
      'scripts.json': l.scriptsData,
      'spatial.json': l.spatialData,
    };
    for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + '\n');
    return {
      ok: true, path: kind.dir, out, targetDevice: v.targetDevice, files: Object.keys(files), warnings: v.warnings, bakedSecrets: l.bakedSecrets,
      counts: { things: l.spatialData.things.length, minds: l.spatialData.minds.length, bodies: l.spatialData.bodies.length, rules: l.spatialData.rules.length },
    };
  },
  exitCode: (r) => (r.ok ? EXIT.ok : EXIT.invalid),
  print(r) {
    for (const e of r.errors ?? []) say(`ERROR: ${e}`);
    for (const w of r.warnings ?? []) say(`WARNING: ${w}`);
    if (r.ok) say(`wrote ${r.files.join(', ')} to ${r.out}`);
  },
});

command('build', {
  usage: 'arsist build <dir> [--device X] [--out D] [--dev] [--clean] [--unity P] [--sdk D] [--license F] [--timeout MIN] [--skip-validate] [--dry-run]',
  summary: 'Build an APK with Unity (Virtual: like the Build dialog; Spatial: validate → lower → Unity)',
  booleans: ['dev', 'clean', 'skip-validate', 'dry-run'],
  async run({ positional, options }, config) {
    const kind = await projectKind(positional[0]);
    const device = options.device ? await matchDevice(options.device) : undefined;
    let plan;
    if (kind.kind === 'spatial') {
      const v = await validateSpatial(config, kind.dir, device);
      for (const w of v.warnings) log(`[arsist] WARNING: ${w}`);
      if (!v.ok && !options['skip-validate']) return { ok: false, stage: 'validate', path: kind.dir, errors: v.errors, warnings: v.warnings };
      if (!v.lowered) throw new CliError(`cannot lower the project: ${v.errors.join('; ')}`);
      const l = v.lowered;
      plan = { targetDevice: v.targetDevice, manifestData: l.manifestData, scenesData: l.scenesData, uiData: l.uiData, scriptsData: l.scriptsData, spatialData: l.spatialData };
    } else {
      const v = await validateVirtual(config, kind.dir);
      for (const w of v.warnings) log(`[arsist] WARNING: ${w}`);
      if (!v.ok && !options['skip-validate']) return { ok: false, stage: 'validate', path: kind.dir, errors: v.errors, warnings: v.warnings };
      const { readProjectFiles } = dist('main/project/projectIO');
      const { generateBuildManifest } = dist('bridge/UnityBridge');
      const project = await readProjectFiles(kind.dir);
      const targetDevice = device || project.targetDevice || 'XREAL_One';
      const scripts = project.scripts ?? [];
      // エディタのビルド画面 (BuildDialog + projectStore.exportScriptBundle) と同じ組み立て
      plan = {
        targetDevice,
        manifestData: generateBuildManifest(project, { targetDevice }),
        scenesData: project.scenes ?? [],
        uiData: project.uiLayouts ?? [],
        scriptsData: {
          version: '1.0',
          scripts: scripts.filter((s) => s.enabled).map((s) => ({ id: s.id, trigger: s.trigger, code: s.code, enabled: s.enabled })),
          storage: { persist: project.storage?.persist ?? [] },
        },
      };
    }
    const unityPath = config.unityPath.value;
    const outputPath = config.outputPath.value ? path.resolve(String(config.outputPath.value)) : undefined;
    const settings = {
      kind: kind.kind, path: kind.dir, targetDevice: plan.targetDevice, unityPath: unityPath ?? null, outputPath: outputPath ?? null,
      sdkDir: config.sdkDir.value ?? null, developmentBuild: !!options.dev, cleanBuild: !!options.clean,
    };
    const missing = [...(unityPath ? [] : ['unityPath']), ...(outputPath ? [] : ['outputPath'])];
    if (options['dry-run']) return { ok: true, dryRun: true, ready: missing.length === 0, missing, ...settings, sources: { unityPath: config.unityPath.from, outputPath: config.outputPath.from, sdkDir: config.sdkDir.from } };
    if (!unityPath) throw new CliError('Unity path not found: pass --unity, set ARSIST_UNITY_PATH or configure it in the editor');
    if (!outputPath) throw new CliError('output folder not found: pass --out, set ARSIST_OUTPUT_PATH or configure it in the editor');

    const { UnityBuilder } = dist('main/unity/UnityBuilder');
    const builder = new UnityBuilder(unityPath);
    builder.setExtensionUserDir(config.extensionsDir.value);
    if (config.sdkDir.value) builder.setSdkDir(String(config.sdkDir.value).trim());
    builder.on('progress', (p) => log(`[progress] ${p.phase} ${p.progress}% ${p.message}`));
    builder.on('log', (l) => log(l));
    const onSignal = () => { log('[arsist] cancelling the build…'); builder.cancel(); };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    log(`[arsist] building ${kind.name} (${kind.label}) for ${plan.targetDevice} → ${outputPath}`);
    const timeout = options.timeout ? Number(options.timeout) : 60;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new CliError('--timeout takes minutes (a positive number)', EXIT.usage);
    const result = await builder.build({
      projectPath: path.join(outputPath, 'TempUnityProject'),
      sourceProjectPath: kind.dir,
      outputPath,
      targetDevice: plan.targetDevice,
      buildTarget: 'Android',
      developmentBuild: !!options.dev,
      cleanBuild: !!options.clean,
      unityVersion: config.unityVersion.value,
      manualLicenseFile: config.manualLicenseFile.value || undefined,
      manifestData: plan.manifestData,
      scenesData: plan.scenesData,
      uiData: plan.uiData,
      scriptsData: plan.scriptsData,
      ...(plan.spatialData ? { spatialData: plan.spatialData } : {}),
      buildTimeoutMinutes: timeout,
    });
    return { ok: !!result.success, ...settings, apk: result.outputPath ?? null, ...(result.error ? { error: result.error } : {}) };
  },
  exitCode: (r) => (r.ok ? EXIT.ok : r.stage === 'validate' ? EXIT.invalid : EXIT.fail),
  print(r) {
    for (const e of r.errors ?? []) say(`ERROR: ${e}`);
    if (r.dryRun) {
      say(`would build ${r.path} (${r.kind}) for ${r.targetDevice}`);
      say(`  unity:  ${r.unityPath ?? '(not set)'}  [${r.sources.unityPath}]`);
      say(`  output: ${r.outputPath ?? '(not set)'}  [${r.sources.outputPath}]`);
      say(`  sdk:    ${r.sdkDir ?? '(not set)'}  [${r.sources.sdkDir}]`);
      return;
    }
    if (r.ok) say(`built ${r.apk}`);
    else if (r.error) say(`build failed: ${r.error}`);
  },
});

command('devices', {
  usage: 'arsist devices',
  summary: 'Devices a project can target (Adapters/ and extensions) with their tags',
  async run(_a, config) {
    const r = await tool(config, 'ir_list_devices', {});
    return { ok: true, devices: r.devices };
  },
  print(r) { for (const d of r.devices) say(`${d.device.padEnd(20)} ${d.source}${d.extensionId ? `:${d.extensionId}` : ''}  ${d.tags.join(' ')}`); },
});

command('config', {
  usage: 'arsist config',
  summary: 'Show the settings the CLI uses and where each comes from (read-only)',
  async run(_a, config) {
    const v = (x) => ({ value: x.value ?? null, from: x.from });
    return {
      ok: true, configFile: config.configFile, configExists: config.configExists,
      unityPath: v(config.unityPath), unityVersion: v(config.unityVersion), sdkDir: v(config.sdkDir), outputPath: v(config.outputPath),
      manualLicenseFile: v(config.manualLicenseFile), extensionsDir: v(config.extensionsDir), extraExtensionFolders: config.extraExtensionFolders,
      dist: DIST,
    };
  },
  print(r) {
    say(`config file: ${r.configFile}${r.configExists ? '' : ' (does not exist)'}`);
    for (const k of ['unityPath', 'unityVersion', 'sdkDir', 'outputPath', 'manualLicenseFile', 'extensionsDir']) say(`${k.padEnd(18)} ${r[k].value ?? '(not set)'}  [${r[k].from}]`);
    if (r.extraExtensionFolders.length) say(`extra extension folders: ${r.extraExtensionFolders.join(', ')}`);
  },
});

const EXT_SUBS = ['pack', 'install', 'link', 'unlink', 'links', 'new', 'override'];
command('ext', {
  usage: `arsist ext <${EXT_SUBS.join('|')}> …   (same arguments as npm run ext:<sub>)`,
  summary: 'Extensions: scaffold, pack, install, link folders, start an engine override',
  passthrough: true,
  async run({ raw }) {
    const [sub, ...rest] = raw;
    if (!EXT_SUBS.includes(sub)) throw new CliError(`usage: arsist ext <${EXT_SUBS.join('|')}> …`, EXIT.usage);
    if (sub !== 'new') checkDist();
    return sub === 'new'
      ? runScript(path.join(HERE, 'ext-new.mjs'), rest)
      : runScript(path.join(HERE, 'ext-tools.mjs'), [sub, ...rest]);
  },
  exitCode: (r) => r.exitCode,
});

command('logs', {
  usage: 'arsist logs [--for SEC] [--grep RE] [--level info|warn|error] [--json] [--port N]',
  summary: 'Receive device logs over the LAN (wraps scripts/arsist-logs.mjs; --json streams one JSON object per line)',
  passthrough: true,
  streams: true,
  async run({ raw }) {
    return runScript(path.join(HERE, 'arsist-logs.mjs'), raw, { inherit: true });
  },
  // arsist-logs.mjs は「--for の間に何も届かなかった」を 2 で返す。CLI では 2 は使い方の誤りなので 1 にする
  exitCode: (r) => (r.exitCode === 2 ? EXIT.fail : r.exitCode),
});

command('mcp', {
  usage: 'arsist mcp [--project dir]',
  summary: 'Start the stdio MCP server (what agents launch; stdout is the MCP channel)',
  streams: true,
  async run({ options }, config) {
    if (options.project) process.env.ARSIST_PROJECT_PATH = path.resolve(options.project);
    const { runStdioServer } = dist('main/mcp/server');
    await runStdioServer();
    // runStdioServer は config.json の登録フォルダだけを見る。--ext-folder / ARSIST_EXTENSION_FOLDERS も足す
    if (config.extraExtensionFolders.length) setupCatalog(config);
    // 標準入力が閉じるまで動き続ける
    return new Promise(() => {});
  },
});

const SIM_ENGINES = { preview: 'preview.mjs', unity: 'unity.mjs' };
command('sim', {
  usage: 'arsist sim <dir> [--engine preview|unity] --out <dir> [--space id] [--device X] [--times 0,2,5] [--width 1280 --height 720] [--json]',
  summary: 'Render a project to PNGs without a device (preview = fast editor-like render, unity = real runtime)',
  passthrough: true,
  streams: true,
  async run({ raw }) {
    const args = [...raw];
    let engine = 'preview';
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--engine') { engine = args[i + 1]; args.splice(i, 2); break; }
      if (args[i].startsWith('--engine=')) { engine = args[i].slice(9); args.splice(i, 1); break; }
    }
    if (!SIM_ENGINES[engine]) throw new CliError(`unknown --engine "${engine}" (preview | unity)`, EXIT.usage);
    const script = path.join(HERE, 'sim', SIM_ENGINES[engine]);
    if (!fs.existsSync(script)) {
      throw new CliError(`the ${engine} simulator (scripts/sim/${SIM_ENGINES[engine]}) is not in this Arsist yet`);
    }
    return runScript(script, args, { inherit: true });
  },
  exitCode: (r) => r.exitCode,
});

// ---- 別のスクリプトを動かす ---------------------------------------------------

/**
 * node で別のスクリプトを動かす。inherit なら入出力をそのまま流す (logs / sim / ふつうの表示)。
 * --json のときは stdout を集めて { ok, exitCode, output } にする (stderr はそのまま流す)。
 */
function runScript(script, args, { inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const capture = jsonMode && !inherit;
    const child = spawn(process.execPath, [script, ...args], {
      stdio: ['inherit', capture ? 'pipe' : 'inherit', 'inherit'],
      env: process.env,
    });
    let out = '';
    child.stdout?.on('data', (d) => { out += d; });
    child.on('error', reject);
    const forward = (sig) => () => child.kill(sig);
    process.on('SIGINT', forward('SIGINT'));
    process.on('SIGTERM', forward('SIGTERM'));
    child.on('close', (code, signal) => {
      const exitCode = code ?? (signal ? EXIT.fail : 0);
      resolve({ ok: exitCode === 0, exitCode, script: path.relative(APP_ROOT, script), ...(capture ? { output: out.split(/\r?\n/).filter(Boolean) } : {}), passthrough: !capture });
    });
  });
}

// ---- 入口 -------------------------------------------------------------------

function helpText() {
  const lines = [
    'arsist — drive Arsist without the editor (doc/21-cli.md)',
    '',
    'usage: arsist <command> [options]      every command takes --json (one JSON object on stdout)',
    '',
  ];
  for (const [name, c] of Object.entries(COMMANDS)) lines.push(`  ${name.padEnd(9)} ${c.summary}`);
  lines.push(
    '',
    'exit codes: 0 ok, 1 failure, 2 usage error, 3 validation problems',
    'settings:   the editor\'s config.json; override with --unity/--sdk/--out/--license or ARSIST_UNITY_PATH, ARSIST_SDK_DIR,',
    '            ARSIST_OUTPUT_PATH, ARSIST_MANUAL_LICENSE_FILE, ARSIST_EXTENSIONS_DIR, ARSIST_EXTENSION_FOLDERS (see `arsist config`)',
    '            --ext-folder <dir> (repeatable) adds an extension folder for this run only',
    '`arsist <command> --help` shows one command\'s usage. Needs `npm run build:main` first.',
  );
  return lines.join('\n');
}

function packageVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version; } catch { return 'unknown'; }
}

async function main(argv) {
  const [name, ...rest] = argv;
  // 共通の指定はどこに書いてもよい
  if (rest.includes('--json') || name === '--json') enterJsonMode();
  if (rest.includes('--quiet')) quiet = true;

  if (!name || name === 'help' || name === '--help' || name === '-h') {
    const topic = name === 'help' ? rest.find((a) => !a.startsWith('-')) : undefined;
    if (topic && COMMANDS[topic]) say(`${COMMANDS[topic].usage}\n\n${COMMANDS[topic].summary}`);
    else say(helpText());
    if (jsonMode) emitJson({ ok: true, commands: Object.fromEntries(Object.entries(COMMANDS).map(([n, c]) => [n, { usage: c.usage, summary: c.summary }])) });
    return name ? EXIT.ok : EXIT.usage;
  }
  if (name === '--version' || name === 'version') {
    if (jsonMode) emitJson({ ok: true, version: packageVersion() });
    else say(packageVersion());
    return EXIT.ok;
  }
  const cmd = COMMANDS[name];
  if (!cmd) throw new CliError(`unknown command "${name}" (see \`arsist help\`)`, EXIT.usage);

  let parsed;
  if (cmd.passthrough) {
    // 引数はそのまま渡す。--json は logs / sim では渡した先が読む (stdout を流す)、ext では CLI がまとめる
    const raw = cmd.streams ? rest : rest.filter((a) => a !== '--json' && a !== '--quiet');
    if (rest[0] === '--help' || rest[0] === '-h') {
      say(`${cmd.usage}\n\n${cmd.summary}`);
      return EXIT.ok;
    }
    // sim / logs は JSON を渡した先が出す (CLI は何も足さない。渡す前に失敗したときだけ CLI が JSON を出す)
    parsed = { raw, options: {}, positional: [] };
  } else {
    parsed = parseArgs(rest, { booleans: cmd.booleans ?? [], repeatable: ['ext-folder', ...(cmd.repeatable ?? [])] });
    if (parsed.options.help) {
      say(`${cmd.usage}\n\n${cmd.summary}`);
      if (jsonMode) emitJson({ ok: true, usage: cmd.usage, summary: cmd.summary });
      return EXIT.ok;
    }
  }
  const config = resolveConfig(parsed.options);
  if (name !== 'ext' && name !== 'logs' && name !== 'sim' && name !== 'upgrade') setupCatalog(config);

  const result = await cmd.run(parsed, config);
  const code = cmd.exitCode ? cmd.exitCode(result) : (result.ok ? EXIT.ok : EXIT.fail);
  const { passthrough, ...shown } = result;
  if (passthrough) return code;
  if (jsonMode) emitJson({ command: name, ...shown, exitCode: code });
  else if (cmd.print) cmd.print(result);
  else if (shown.output) say(shown.output.join('\n'));
  return code;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => {
    const code = e instanceof UsageError ? EXIT.usage : e instanceof CliError ? e.code : EXIT.fail;
    if (jsonMode) emitJson({ ok: false, command: process.argv[2] ?? null, error: e.message, ...(e.extra ?? {}), exitCode: code });
    else console.error(`arsist: ${e instanceof CliError || e instanceof UsageError ? e.message : (e?.stack || e)}`);
    process.exitCode = code;
  },
);
