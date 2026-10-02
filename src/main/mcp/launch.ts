/**
 * エージェントが Arsist の MCP サーバーを起動するときのコマンド。
 *
 * Node を別に入れなくて済むよう、エディタの Electron を Node として使う (ELECTRON_RUN_AS_NODE=1)。
 * これを付け忘れると、エージェントがエディタをもう 1 つ立ち上げてしまう (旧実装がそうだった)。
 *   開発中:      <repo>/node_modules/electron/dist/electron <repo>/scripts/mcp-ir-server.mjs
 *   パッケージ版: <Arsist> <resources>/scripts/mcp-ir-server.mjs  (ARSIST_APP_ROOT = app.asar)
 */
import * as path from 'path';
import type { LaunchSpec } from './agentTargets';
import { loadClientSdk } from './sdk';

export interface LaunchContext {
  execPath: string;
  isPackaged: boolean;
  /** 開発中はリポジトリ、パッケージ版は app.getAppPath() (resources/app.asar) */
  appRoot: string;
  resourcesPath: string;
  /** 既定で開くプロジェクト (無ければエージェントが arsist_open_project で選ぶ) */
  projectPath?: string | null;
  extensionsDir?: string | null;
}

export function arsistLaunchSpec(ctx: LaunchContext): LaunchSpec {
  const script = ctx.isPackaged
    ? path.join(ctx.resourcesPath, 'scripts', 'mcp-ir-server.mjs')
    : path.join(ctx.appRoot, 'scripts', 'mcp-ir-server.mjs');
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' };
  if (ctx.isPackaged) env.ARSIST_APP_ROOT = ctx.appRoot;
  if (ctx.projectPath) env.ARSIST_PROJECT_PATH = ctx.projectPath;
  if (ctx.extensionsDir) env.ARSIST_EXTENSIONS_DIR = ctx.extensionsDir;
  return { command: ctx.execPath, args: [script], env };
}

export interface SelfTestResult {
  ok: boolean;
  tools?: number;
  ms?: number;
  error?: string;
  stderr?: string;
}

/** エージェントと同じように起動して、ツールの一覧と 1 回の呼び出しが通るかを見る。 */
export async function selfTestMcp(spec: LaunchSpec, timeoutMs = 20000): Promise<SelfTestResult> {
  const started = Date.now();
  const { Client, StdioClientTransport } = loadClientSdk();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
  Object.assign(env, spec.env);
  const transport = new StdioClientTransport({ command: spec.command, args: spec.args, env, stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
  const client = new Client({ name: 'arsist-self-test', version: '1.0.0' }, { capabilities: {} });

  const timer = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer within ${timeoutMs / 1000} s`)), timeoutMs));
  try {
    await Promise.race([client.connect(transport), timer]);
    const tools = await Promise.race([client.listTools(), timer]);
    const call = await Promise.race([client.callTool({ name: 'arsist_list_recent_projects', arguments: {} }), timer]);
    if (call.isError) throw new Error(call.content?.[0]?.text ?? 'tool call failed');
    return { ok: true, tools: tools.tools.length, ms: Date.now() - started, stderr: stderr.trim() };
  } catch (e) {
    return { ok: false, error: (e as Error).message, stderr: stderr.trim().slice(-2000) };
  } finally {
    await client.close().catch(() => {});
  }
}
