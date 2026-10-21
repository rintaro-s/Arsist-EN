/**
 * Arsist の MCP サーバーを、各エージェントの設定にワンクリックで登録する。
 *
 * 書き方はエージェントごとに違う:
 *   mcpServers の JSON      Claude Desktop / Qwen Code / Gemini CLI / Cursor / Windsurf / LM Studio
 *   Claude Code             `claude mcp add-json --scope user` (CLI があれば) / ~/.claude.json の mcpServers
 *   Codex                   ~/.codex/config.toml の [mcp_servers.arsist]
 *   VS Code                 <ユーザー設定>/mcp.json の servers ({ type: "stdio", … })
 *
 * 守ること:
 *   - 他の登録 (他のサーバー・他の設定) には触れない。Arsist の 1 項目だけを足す / 直す / 消す
 *   - 読めない (壊れた / コメント入りの) JSON には書かない — 黙って上書きすると相手の設定が消える
 *   - 書く前に <ファイル>.arsist-backup に写し、一時ファイル経由で置き換える
 *
 * 場所は home / platform / env を渡して決める (テストでは本物の HOME に触れない)。
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { spawnSync } from 'child_process';

export const SERVER_KEY = 'arsist';

export interface LaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface TargetEnv {
  home: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** CLI を探して使うか (テストでは false) */
  useCli?: boolean;
}

export type TargetStatus = 'registered' | 'outdated' | 'notRegistered' | 'unreadable';

export interface TargetState {
  id: string;
  name: string;
  configPath: string | null;
  /** そのエージェントが入っていそうか (設定フォルダか CLI がある) */
  detected: boolean;
  status: TargetStatus;
  detail?: string;
  /** 登録に使う方法 */
  via: 'json' | 'toml' | 'cli';
}

interface Target {
  id: string;
  name: string;
  format: 'mcpServers' | 'vscode' | 'codex' | 'claudeCode';
  file(t: TargetEnv): string | null;
  /** 入っているかの目安 (このフォルダがある / この CLI がある) */
  marker(t: TargetEnv): string | null;
  cli?: string;
}

function appData(t: TargetEnv): string {
  if (t.platform === 'win32') return t.env.APPDATA || path.join(t.home, 'AppData', 'Roaming');
  if (t.platform === 'darwin') return path.join(t.home, 'Library', 'Application Support');
  return t.env.XDG_CONFIG_HOME?.trim() || path.join(t.home, '.config');
}

export const TARGETS: Target[] = [
  {
    id: 'claude-code', name: 'Claude Code', format: 'claudeCode', cli: 'claude',
    file: (t) => path.join(t.home, '.claude.json'),
    marker: (t) => path.join(t.home, '.claude'),
  },
  {
    id: 'claude-desktop', name: 'Claude Desktop', format: 'mcpServers',
    file: (t) => path.join(appData(t), 'Claude', 'claude_desktop_config.json'),
    marker: (t) => path.join(appData(t), 'Claude'),
  },
  {
    id: 'codex', name: 'Codex CLI', format: 'codex', cli: 'codex',
    file: (t) => path.join(t.env.CODEX_HOME?.trim() || path.join(t.home, '.codex'), 'config.toml'),
    marker: (t) => t.env.CODEX_HOME?.trim() || path.join(t.home, '.codex'),
  },
  {
    id: 'qwen-code', name: 'Qwen Code', format: 'mcpServers', cli: 'qwen',
    file: (t) => path.join(t.home, '.qwen', 'settings.json'),
    marker: (t) => path.join(t.home, '.qwen'),
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', format: 'mcpServers', cli: 'gemini',
    file: (t) => path.join(t.home, '.gemini', 'settings.json'),
    marker: (t) => path.join(t.home, '.gemini'),
  },
  {
    id: 'cursor', name: 'Cursor', format: 'mcpServers',
    file: (t) => path.join(t.home, '.cursor', 'mcp.json'),
    marker: (t) => path.join(t.home, '.cursor'),
  },
  {
    id: 'vscode', name: 'VS Code (Copilot)', format: 'vscode',
    file: (t) => path.join(appData(t), 'Code', 'User', 'mcp.json'),
    marker: (t) => path.join(appData(t), 'Code', 'User'),
  },
  {
    id: 'windsurf', name: 'Windsurf', format: 'mcpServers',
    file: (t) => path.join(t.home, '.codeium', 'windsurf', 'mcp_config.json'),
    marker: (t) => path.join(t.home, '.codeium', 'windsurf'),
  },
  {
    id: 'lm-studio', name: 'LM Studio', format: 'mcpServers',
    file: (t) => path.join(t.home, '.lmstudio', 'mcp.json'),
    marker: (t) => path.join(t.home, '.lmstudio'),
  },
];

/** mcpServers 形式の 1 項目 (多くのエージェントが使う形)。 */
export function mcpServersEntry(spec: LaunchSpec): Record<string, unknown> {
  return { command: spec.command, args: spec.args, env: spec.env };
}

/** どのエージェントにも貼れる設定 (画面の「JSON をコピー」)。 */
export function genericConfigJson(spec: LaunchSpec): string {
  return JSON.stringify({ mcpServers: { [SERVER_KEY]: mcpServersEntry(spec) } }, null, 2);
}

function hasCli(name: string | undefined, t: TargetEnv): string | null {
  if (!name || !t.useCli) return null;
  const which = t.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(which, [name], { encoding: 'utf8', timeout: 3000, windowsHide: true });
  const found = r.status === 0 ? r.stdout.split(/\r?\n/).find((l) => l.trim()) : null;
  return found ? found.trim() : null;
}

// ---- JSON ----

async function readJsonObject(file: string): Promise<{ ok: true; data: Record<string, any> } | { ok: false; error: string }> {
  if (!await fs.pathExists(file)) return { ok: true, data: {} };
  const text = await fs.readFile(file, 'utf8');
  if (text.trim() === '') return { ok: true, data: {} };
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: `${file} is not a JSON object` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `${file} is not plain JSON (${(e as Error).message}); add the entry by hand (Copy JSON)` };
  }
}

async function writeWithBackup(file: string, text: string): Promise<void> {
  await fs.ensureDir(path.dirname(file));
  if (await fs.pathExists(file)) await fs.copy(file, `${file}.arsist-backup`, { overwrite: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

function sameEntry(a: any, b: any): boolean {
  return JSON.stringify(a?.command) === JSON.stringify(b?.command) && JSON.stringify(a?.args) === JSON.stringify(b?.args) &&
    JSON.stringify(a?.env ?? {}) === JSON.stringify(b?.env ?? {});
}

// ---- TOML (Codex) ----

function tomlString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function codexBlock(spec: LaunchSpec): string {
  const env = Object.entries(spec.env).map(([k, v]) => `${k} = ${tomlString(v)}`).join(', ');
  return [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${tomlString(spec.command)}`,
    `args = [${spec.args.map(tomlString).join(', ')}]`,
    `env = { ${env} }`,
  ].join('\n');
}

/** [mcp_servers.arsist] の表 (次の表の見出しまで) の範囲。無ければ null。 */
function findCodexTable(text: string): { start: number; end: number } | null {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `[mcp_servers.${SERVER_KEY}]`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) { end = i; break; }
  }
  // 表の直後の空行は表の一部として扱う (消したときに空行が溜まらないように)
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  return { start, end };
}

export function upsertCodexToml(text: string, spec: LaunchSpec): string {
  const lines = text.split('\n');
  const block = codexBlock(spec).split('\n');
  const found = findCodexTable(text);
  if (found) {
    lines.splice(found.start, found.end - found.start, ...block);
    return lines.join('\n');
  }
  const base = text.replace(/\s*$/, '');
  return `${base}${base ? '\n\n' : ''}${block.join('\n')}\n`;
}

export function removeCodexToml(text: string): string {
  const found = findCodexTable(text);
  if (!found) return text;
  const lines = text.split('\n');
  lines.splice(found.start, found.end - found.start);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ---- 状態・登録・削除 ----

export async function targetStates(spec: LaunchSpec, t: TargetEnv): Promise<TargetState[]> {
  const out: TargetState[] = [];
  for (const target of TARGETS) {
    const file = target.file(t);
    const marker = target.marker(t);
    const cli = hasCli(target.cli, t);
    const detected = Boolean(cli) || (marker ? await fs.pathExists(marker) : false);
    const via: TargetState['via'] = target.format === 'codex' ? 'toml' : target.format === 'claudeCode' && cli ? 'cli' : 'json';
    const state: TargetState = { id: target.id, name: target.name, configPath: file, detected, status: 'notRegistered', via };

    if (file && target.format === 'codex') {
      const text = (await fs.pathExists(file)) ? await fs.readFile(file, 'utf8') : '';
      const table = findCodexTable(text);
      if (table) {
        const current = text.split('\n').slice(table.start, table.end).join('\n');
        state.status = current.trim() === codexBlock(spec).trim() ? 'registered' : 'outdated';
      }
    } else if (file) {
      const read = await readJsonObject(file);
      if (!read.ok) {
        state.status = 'unreadable';
        state.detail = read.error;
      } else {
        const entry = target.format === 'vscode' ? read.data.servers?.[SERVER_KEY] : read.data.mcpServers?.[SERVER_KEY];
        if (entry) state.status = sameEntry(entry, mcpServersEntry(spec)) ? 'registered' : 'outdated';
      }
    }
    out.push(state);
  }
  return out;
}

export interface TargetActionResult {
  ok: boolean;
  message: string;
  configPath?: string | null;
}

export async function registerTarget(id: string, spec: LaunchSpec, t: TargetEnv): Promise<TargetActionResult> {
  const target = TARGETS.find((x) => x.id === id);
  if (!target) return { ok: false, message: `unknown agent "${id}"` };
  const file = target.file(t);
  if (!file) return { ok: false, message: `${target.name}: no config location on this OS` };

  if (target.format === 'claudeCode') {
    const cli = hasCli(target.cli, t);
    if (cli) {
      // Claude Code 自身に書かせる (~/.claude.json は Claude Code が動いている間も書き換えるため)
      spawnSync(cli, ['mcp', 'remove', '--scope', 'user', SERVER_KEY], { encoding: 'utf8', timeout: 15000, windowsHide: true });
      const r = spawnSync(cli, ['mcp', 'add-json', '--scope', 'user', SERVER_KEY, JSON.stringify({ type: 'stdio', ...mcpServersEntry(spec) })],
        { encoding: 'utf8', timeout: 15000, windowsHide: true });
      if (r.status === 0) return { ok: true, message: `${target.name}: registered with "claude mcp add-json" (user scope)`, configPath: file };
      return { ok: false, message: `${target.name}: claude mcp add-json failed: ${(r.stderr || r.stdout || '').trim()}` };
    }
  }

  if (target.format === 'codex') {
    const text = (await fs.pathExists(file)) ? await fs.readFile(file, 'utf8') : '';
    await writeWithBackup(file, upsertCodexToml(text, spec));
    return { ok: true, message: `${target.name}: [mcp_servers.${SERVER_KEY}] written`, configPath: file };
  }

  const read = await readJsonObject(file);
  if (!read.ok) return { ok: false, message: read.error, configPath: file };
  const data = read.data;
  if (target.format === 'vscode') {
    data.servers = { ...(data.servers ?? {}), [SERVER_KEY]: { type: 'stdio', ...mcpServersEntry(spec) } };
  } else {
    data.mcpServers = { ...(data.mcpServers ?? {}), [SERVER_KEY]: mcpServersEntry(spec) };
  }
  await writeWithBackup(file, `${JSON.stringify(data, null, 2)}\n`);
  return { ok: true, message: `${target.name}: added to ${file} (restart the agent to load it)`, configPath: file };
}

export async function unregisterTarget(id: string, t: TargetEnv): Promise<TargetActionResult> {
  const target = TARGETS.find((x) => x.id === id);
  if (!target) return { ok: false, message: `unknown agent "${id}"` };
  const file = target.file(t);
  if (!file || !await fs.pathExists(file)) return { ok: true, message: `${target.name}: nothing to remove`, configPath: file };

  if (target.format === 'claudeCode') {
    const cli = hasCli(target.cli, t);
    if (cli) {
      const r = spawnSync(cli, ['mcp', 'remove', '--scope', 'user', SERVER_KEY], { encoding: 'utf8', timeout: 15000, windowsHide: true });
      return r.status === 0
        ? { ok: true, message: `${target.name}: removed`, configPath: file }
        : { ok: false, message: `${target.name}: claude mcp remove failed: ${(r.stderr || r.stdout || '').trim()}` };
    }
  }

  if (target.format === 'codex') {
    const text = await fs.readFile(file, 'utf8');
    const next = removeCodexToml(text);
    if (next !== text) await writeWithBackup(file, next);
    return { ok: true, message: `${target.name}: removed`, configPath: file };
  }

  const read = await readJsonObject(file);
  if (!read.ok) return { ok: false, message: read.error, configPath: file };
  const data = read.data;
  const key = target.format === 'vscode' ? 'servers' : 'mcpServers';
  if (!data[key]?.[SERVER_KEY]) return { ok: true, message: `${target.name}: nothing to remove`, configPath: file };
  delete data[key][SERVER_KEY];
  await writeWithBackup(file, `${JSON.stringify(data, null, 2)}\n`);
  return { ok: true, message: `${target.name}: removed`, configPath: file };
}
