/**
 * MCP SDK (@modelcontextprotocol/sdk) の読み込み口。
 *
 * SDK は package.json の exports でサブパス (server/index.js など) を公開しているが、main の tsconfig
 * (module: CommonJS → moduleResolution: node10) の TypeScript はそれを辿れない。実行時の require は Node が
 * exports を解決するので問題なく読めるため、ここで require し、使う分だけの型を付ける。
 */
/* eslint-disable @typescript-eslint/no-var-requires */

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export interface McpServerLike {
  setRequestHandler(schema: unknown, handler: (request: any) => Promise<unknown>): void;
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
}

export interface McpClientLike {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools: McpTool[] }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<McpCallResult>;
  close(): Promise<void>;
}

export function loadServerSdk(): {
  Server: new (info: { name: string; version: string }, options: { capabilities: Record<string, unknown>; instructions?: string }) => McpServerLike;
  StdioServerTransport: new () => unknown;
  CallToolRequestSchema: unknown;
  ListToolsRequestSchema: unknown;
} {
  const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
  return { Server, StdioServerTransport, CallToolRequestSchema, ListToolsRequestSchema };
}

export function loadClientSdk(): {
  Client: new (info: { name: string; version: string }, options: { capabilities: Record<string, unknown> }) => McpClientLike;
  StdioClientTransport: new (params: { command: string; args?: string[]; env?: Record<string, string>; cwd?: string; stderr?: 'pipe' | 'inherit' | 'ignore' }) => { stderr?: NodeJS.ReadableStream | null };
} {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  return { Client, StdioClientTransport };
}
