/**
 * Arsist の MCP サーバー (stdio)。外部のエージェント (Claude Code / Codex / Qwen Code / Claude Desktop …) が
 * 自分で起動して使う。起動は scripts/mcp-ir-server.mjs (このファイルの runStdioServer を呼ぶだけ)。
 *
 * 環境変数:
 *   ARSIST_PROJECT_PATH     最初に開いておくプロジェクト (旧名 MCP_PROJECT_PATH も読む)
 *   ARSIST_EXTENSIONS_DIR   ユーザーの拡張機能の置き場 (無ければエディタと同じ <ユーザーデータ>/extensions)
 *
 * stdout は MCP の通信そのものなので、ログは必ず stderr に出す。
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { ARSIST_TOOLS, callArsistTool, ToolSession } from './tools';
import { loadServerSdk } from './sdk';
import { setUserExtensionsDir } from '../extensions/catalogService';
import { arsistConfigDir } from './configPaths';

export const SERVER_NAME = 'arsist';
export const SERVER_VERSION = '2.0.0';

const INSTRUCTIONS = [
  'Arsist builds AR/VR apps (Meta Quest, XREAL, Android phones) from a project folder.',
  'Start with arsist_open_project (or arsist_list_recent_projects), then ir_get_project.',
  'Read arsist_script_reference before writing scripts or placing objects (editor coordinates: +Z ahead, +X = user\'s left).',
  'Run ir_validate_project after changes. Projects in an old format are read-only until upgraded in the editor.',
].join(' ');

/** 最近開いたプロジェクト (エディタの electron-store の設定から読む。無ければ空)。 */
export function readRecentProjects(): string[] {
  try {
    const config = fs.readJSONSync(path.join(arsistConfigDir(), 'config.json'));
    return Array.isArray(config?.recentProjects) ? config.recentProjects.filter((p: unknown) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export async function runStdioServer(): Promise<void> {
  const sdk = loadServerSdk();
  setUserExtensionsDir(process.env.ARSIST_EXTENSIONS_DIR || path.join(arsistConfigDir(), 'extensions'));

  const session = new ToolSession({
    projectPath: process.env.ARSIST_PROJECT_PATH || process.env.MCP_PROJECT_PATH || null,
    recentProjects: readRecentProjects,
  });

  const server = new sdk.Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(sdk.ListToolsRequestSchema, async () => ({
    tools: ARSIST_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: { readOnlyHint: t.readOnly },
    })),
  }));

  server.setRequestHandler(sdk.CallToolRequestSchema, async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
    const { name, arguments: args } = request.params;
    const outcome = await callArsistTool(session, name, args as Record<string, any>);
    if (!outcome.ok) {
      process.stderr.write(`[arsist-mcp] ${name} failed: ${outcome.error}\n`);
      // 旧サーバーと同じ形 ({ success: false, error }) も本文に入れておく (それを見て分岐しているクライアントのため)
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: outcome.error }, null, 2) }], isError: true };
    }
    const text = typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result, null, 2);
    return { content: [{ type: 'text', text }] };
  });

  await server.connect(new sdk.StdioServerTransport());
  process.stderr.write(`[arsist-mcp] ready: ${ARSIST_TOOLS.length} tools${session.projectPath ? `, project ${session.projectPath}` : ''}\n`);
}
