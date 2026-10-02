import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { codexBlock, registerTarget, removeCodexToml, targetStates, TARGETS, unregisterTarget, upsertCodexToml, type LaunchSpec, type TargetEnv } from './agentTargets';

let home: string;
let t: TargetEnv;
const spec: LaunchSpec = {
  command: '/opt/Arsist/arsist',
  args: ['/opt/Arsist/resources/scripts/mcp-ir-server.mjs'],
  env: { ELECTRON_RUN_AS_NODE: '1', ARSIST_PROJECT_PATH: 'C:\\Users\\me\\My "AR" App' },
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'arsist-agents-'));
  t = { home, platform: 'linux', env: {}, useCli: false };
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const read = (rel: string) => fs.readFileSync(path.join(home, rel), 'utf8');

describe('one-click agent registration', () => {
  it('registers in every agent and reports it, without touching other entries', async () => {
    fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
    fs.writeFileSync(path.join(home, '.qwen', 'settings.json'), JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }));

    for (const target of TARGETS) {
      const r = await registerTarget(target.id, spec, t);
      expect(r.ok, `${target.id}: ${r.message}`).toBe(true);
    }
    const states = await targetStates(spec, t);
    expect(states.map((s) => [s.id, s.status])).toEqual(TARGETS.map((x) => [x.id, 'registered']));

    const qwen = JSON.parse(read('.qwen/settings.json'));
    expect(qwen.theme).toBe('dark');
    expect(qwen.mcpServers.other).toEqual({ command: 'x' });
    expect(qwen.mcpServers.arsist).toEqual({ command: spec.command, args: spec.args, env: spec.env });
    // 書く前の中身を残している
    expect(JSON.parse(read('.qwen/settings.json.arsist-backup')).mcpServers.arsist).toBeUndefined();

    // VS Code は servers / type: stdio
    expect(JSON.parse(read('.config/Code/User/mcp.json')).servers.arsist.type).toBe('stdio');
    // Claude Code (CLI 無し) は ~/.claude.json の mcpServers
    expect(JSON.parse(read('.claude.json')).mcpServers.arsist.command).toBe(spec.command);
  });

  it('notices an outdated entry and a broken file, and never overwrites the broken one', async () => {
    await registerTarget('cursor', spec, t);
    const moved = { ...spec, command: '/new/place/arsist' };
    expect((await targetStates(moved, t)).find((s) => s.id === 'cursor')!.status).toBe('outdated');

    fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
    fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), '{ // comment\n "a": 1 }');
    const state = (await targetStates(spec, t)).find((s) => s.id === 'gemini-cli')!;
    expect(state.status).toBe('unreadable');
    const r = await registerTarget('gemini-cli', spec, t);
    expect(r.ok).toBe(false);
    expect(read('.gemini/settings.json')).toBe('{ // comment\n "a": 1 }');
  });

  it('removes only its own entry', async () => {
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { keep: { command: 'k' } } }));
    await registerTarget('cursor', spec, t);
    await unregisterTarget('cursor', t);
    expect(JSON.parse(read('.cursor/mcp.json'))).toEqual({ mcpServers: { keep: { command: 'k' } } });
    expect((await unregisterTarget('windsurf', t)).ok).toBe(true); // 何も無くても失敗しない
  });

  it('follows the OS for Claude Desktop', async () => {
    const win: TargetEnv = { home, platform: 'win32', env: { APPDATA: path.join(home, 'Roaming') } };
    expect((await targetStates(spec, win)).find((s) => s.id === 'claude-desktop')!.configPath)
      .toBe(path.join(home, 'Roaming', 'Claude', 'claude_desktop_config.json'));
    const mac: TargetEnv = { home, platform: 'darwin', env: {} };
    expect((await targetStates(spec, mac)).find((s) => s.id === 'claude-desktop')!.configPath)
      .toBe(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
  });
});

describe('Codex config.toml', () => {
  const existing = 'model = "o4"\n\n[mcp_servers.other]\ncommand = "x"\n\n[profiles.fast]\nmodel = "mini"\n';

  it('adds, updates in place and removes its table, keeping the rest', () => {
    const added = upsertCodexToml(existing, spec);
    expect(added).toContain('[mcp_servers.other]');
    expect(added).toContain('[profiles.fast]');
    expect(added).toContain(codexBlock(spec));
    // パスの \ と " はエスケープされる
    expect(codexBlock(spec)).toContain('ARSIST_PROJECT_PATH = "C:\\\\Users\\\\me\\\\My \\"AR\\" App"');

    const updated = upsertCodexToml(added, { ...spec, command: '/elsewhere' });
    expect(updated.match(/\[mcp_servers\.arsist\]/g)).toHaveLength(1);
    expect(updated).toContain('command = "/elsewhere"');

    // 間に挟まっていても、その表だけを消す
    const middle = '[mcp_servers.arsist]\ncommand = "old"\n\n[profiles.fast]\nmodel = "mini"\n';
    expect(removeCodexToml(middle)).toBe('\n[profiles.fast]\nmodel = "mini"\n');
    expect(removeCodexToml(added).trim()).toBe(existing.trim());
  });
});
