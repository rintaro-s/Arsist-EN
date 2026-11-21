/**
 * arsist CLI (scripts/arsist.mjs)。引数の読み方と、いくつかのコマンドを一時フォルダで実際に動かす。
 * HOME / XDG_CONFIG_HOME / APPDATA を一時フォルダにするので、本物の ~/.config/arsist-engine は読みも書きもしない。
 * dist/main が無ければ (npm run build:main 前) コマンドの方は飛ばす。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// @ts-ignore -- plain ESM helper without type declarations
import { parseArgs, listOption, UsageError } from './lib/cli-args.mjs';

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'arsist.mjs');
const HAS_DIST = fs.existsSync(path.join(ROOT, 'dist', 'main', 'main', 'mcp', 'tools.js'));
const DESK_BUDDY = path.join(ROOT, 'samples', 'spatial', 'desk-buddy');
const SAMPLE_EXTENSIONS = path.join(ROOT, 'samples', 'extensions');

describe('parseArgs', () => {
  it('reads positionals, valued options, booleans and --a=b', () => {
    const r = parseArgs(['solve', 'dir', '--space', 'studio', '--json', '--out=x', '--strict'], { booleans: ['strict'], repeatable: ['space'] });
    expect(r.positional).toEqual(['solve', 'dir']);
    expect(r.options).toEqual({ space: ['studio'], json: true, out: 'x', strict: true });
  });

  it('collects repeatable options and splits comma lists', () => {
    const r = parseArgs(['--space', 'a,b', '--space', 'c'], { repeatable: ['space'] });
    expect(listOption(r.options.space)).toEqual(['a', 'b', 'c']);
    expect(listOption(undefined)).toEqual([]);
  });

  it('keeps everything after -- as rest, and -h means help', () => {
    const r = parseArgs(['-h', 'x', '--', '--json', 'y']);
    expect(r.options.help).toBe(true);
    expect(r.positional).toEqual(['x']);
    expect(r.rest).toEqual(['--json', 'y']);
  });

  it('a valued option without a value is a usage error; a boolean with a junk value too', () => {
    expect(() => parseArgs(['--out'])).toThrow(UsageError);
    expect(() => parseArgs(['--json=maybe'])).toThrow(UsageError);
    expect(parseArgs(['--json=false']).options.json).toBe(false);
  });
});

describe.skipIf(!HAS_DIST)('arsist CLI (needs dist/main)', () => {
  let tmp: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arsist-cli-'));
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home, { recursive: true });
    env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), APPDATA: path.join(home, 'AppData'), ARSIST_CLI_SKIP_STALE_CHECK: '1' };
    for (const k of Object.keys(env)) {
      if (k.startsWith('ARSIST_') && k !== 'ARSIST_CLI_SKIP_STALE_CHECK') delete env[k];
    }
    delete env.MCP_PROJECT_PATH;
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function run(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: tmp, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 60_000 });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  }
  function json(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
    const r = run([...args, '--json'], extraEnv);
    let body: any;
    try {
      body = JSON.parse(r.stdout);
    } catch {
      throw new Error(`stdout is not one JSON object (exit ${r.code}):\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
    }
    return { ...r, body };
  }

  it('config reads only the fake config dir', () => {
    const r = json(['config']);
    expect(r.code).toBe(0);
    expect(r.body.configFile.startsWith(tmp)).toBe(true);
    expect(r.body.configExists).toBe(false);
    expect(r.body.unityPath.from).toBe('unset');
    const withEnv = json(['config'], { ARSIST_UNITY_PATH: '/opt/unity/Editor/Unity' });
    expect(withEnv.body.unityPath).toEqual({ value: '/opt/unity/Editor/Unity', from: 'env ARSIST_UNITY_PATH' });
  }, 30_000);

  it('usage errors exit 2', () => {
    expect(run(['no-such-command']).code).toBe(2);
    expect(run([]).code).toBe(2);
    expect(json(['tool', 'ir_get_project', '{not json']).code).toBe(2);
    expect(json(['tool', 'no_such_tool']).code).toBe(2);
    expect(json(['new', 'other', tmp, 'X']).code).toBe(2);
  }, 30_000);

  it('info on TestProject (Layster.Virtual)', () => {
    const r = json(['info', path.join(ROOT, 'TestProject')]);
    expect(r.code).toBe(0);
    expect(r.body).toMatchObject({ ok: true, kind: 'virtual', name: 'Test AR App' });
    expect(r.body.format).toMatch(/^Layster\.Virtual /);
    expect(r.body.counts).toHaveProperty('scenes');
  }, 30_000);

  it('validate desk-buddy: exit 3 without its extension, 0 with --ext-folder', () => {
    const missing = json(['validate', DESK_BUDDY]);
    expect(missing.code).toBe(3);
    expect(missing.body.ok).toBe(false);
    expect(missing.body.errors.join('\n')).toMatch(/quest-room/);

    const ok = json(['validate', DESK_BUDDY, '--ext-folder', SAMPLE_EXTENSIONS]);
    expect(ok.code).toBe(0);
    expect(ok.body).toMatchObject({ ok: true, kind: 'spatial', errors: [] });
  }, 60_000);

  it('tool spatial_solve on desk-buddy behaves like the MCP tool', () => {
    const r = json(['tool', 'spatial_solve', '{"spaces":["studio","tiny"]}', '--project', DESK_BUDDY]);
    expect(r.code).toBe(0);
    expect(r.body.ok).toBe(true);
    expect(r.body.result.spaces).toEqual(['studio', 'tiny']);
    expect(Object.keys(r.body.result.summary).length).toBeGreaterThan(0);

    const solve = json(['solve', DESK_BUDDY, '--space', 'studio']);
    expect(solve.code).toBe(0);
    expect(solve.body.results.every((x: any) => x.space === 'studio')).toBe(true);
  }, 30_000);

  it('tools lists every tool with a schema, including spatial_*', () => {
    const r = json(['tools']);
    expect(r.code).toBe(0);
    const names = r.body.tools.map((t: any) => t.name);
    expect(names).toContain('spatial_solve');
    expect(names).toContain('ir_validate_project');
    expect(r.body.tools.every((t: any) => t.inputSchema && typeof t.readOnly === 'boolean')).toBe(true);
  }, 30_000);

  it('lower writes the five build files', () => {
    const out = path.join(tmp, 'lowered');
    const r = json(['lower', DESK_BUDDY, '--out', out, '--ext-folder', SAMPLE_EXTENSIONS]);
    expect(r.code).toBe(0);
    for (const f of ['manifest.json', 'scenes.json', 'ui_layouts.json', 'scripts.json', 'spatial.json']) {
      expect(fs.existsSync(path.join(out, f))).toBe(true);
    }
    const spatial = JSON.parse(fs.readFileSync(path.join(out, 'spatial.json'), 'utf8'));
    expect(spatial.things.length).toBe(r.body.counts.things);
  }, 30_000);

  it('new spatial / new virtual create projects; a second one in the same place fails', () => {
    const parent = path.join(tmp, 'projects');
    const s = json(['new', 'spatial', parent, 'Room App']);
    expect(s.code).toBe(0);
    expect(fs.existsSync(path.join(parent, 'Room App', 'project.spatial.json'))).toBe(true);
    const v = json(['new', 'virtual', parent, 'Screen App', '--device', 'Meta_Quest']);
    expect(v.code).toBe(0);
    expect(v.body.targetDevice).toBe('Meta_Quest');
    expect(json(['info', path.join(parent, 'Screen App')]).body.kind).toBe('virtual');
    expect(json(['validate', path.join(parent, 'Room App')]).code).toBe(0);
    expect(json(['new', 'virtual', parent, 'Screen App']).code).toBe(1);
    expect(json(['new', 'spatial', parent, 'Other', '--device', 'No_Such_Device']).code).toBe(2);
  }, 60_000);

  it('build --dry-run resolves settings from flags and env without Unity', () => {
    const r = json(['build', DESK_BUDDY, '--dry-run', '--out', path.join(tmp, 'apk'), '--ext-folder', SAMPLE_EXTENSIONS], { ARSIST_UNITY_PATH: '/opt/unity/Editor/Unity' });
    expect(r.code).toBe(0);
    expect(r.body).toMatchObject({ dryRun: true, ready: true, kind: 'spatial', targetDevice: 'Meta_Quest', unityPath: '/opt/unity/Editor/Unity' });
    expect(r.body.sources).toMatchObject({ unityPath: 'env ARSIST_UNITY_PATH', outputPath: 'flag' });
  }, 30_000);

  it('ext link writes only the fake config; the linked extension is then found', () => {
    const link = json(['ext', 'link', SAMPLE_EXTENSIONS]);
    expect(link.code).toBe(0);
    const configFile = json(['config']).body.configFile as string;
    expect(configFile.startsWith(tmp)).toBe(true);
    expect(JSON.parse(fs.readFileSync(configFile, 'utf8')).extensionFolders).toContain(SAMPLE_EXTENSIONS);
    expect(json(['validate', DESK_BUDDY]).code).toBe(0);
    expect(json(['ext', 'unlink', SAMPLE_EXTENSIONS]).code).toBe(0);
  }, 60_000);

  it('sim says clearly when a simulator script is missing, and rejects unknown engines', () => {
    const bad = json(['sim', DESK_BUDDY, '--engine', 'nope']);
    expect(bad.code).toBe(2);
    if (!fs.existsSync(path.join(ROOT, 'scripts', 'sim', 'unity.mjs'))) {
      const r = json(['sim', DESK_BUDDY, '--engine', 'unity', '--out', path.join(tmp, 'sim')]);
      expect(r.code).toBe(1);
      expect(r.body.error).toMatch(/scripts\/sim\/unity\.mjs/);
    }
  }, 30_000);
});
