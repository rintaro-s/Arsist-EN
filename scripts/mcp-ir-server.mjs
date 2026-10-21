#!/usr/bin/env node
/**
 * Arsist の MCP サーバー (stdio)。エージェント (Claude Code / Codex / Qwen Code / Claude Desktop / Cursor …) が起動する。
 *
 * 中身は TypeScript (src/main/mcp/server.ts / tools.ts) で、エディタの内蔵エージェントと同じツールを使う。
 * ここはそれを呼ぶだけ。先に `npm run build:main` が要る (エディタを `npm run dev` で動かしていれば済んでいる)。
 *
 *   ARSIST_PROJECT_PATH=<プロジェクト> node scripts/mcp-ir-server.mjs
 *
 * Electron で動かすときは ELECTRON_RUN_AS_NODE=1 を付ける (付けないとエディタがもう 1 つ立ち上がる)。
 * エディタの「MCP / エージェント」画面が、各エージェントの設定にこの形で書き込む。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
// 開発中: <repo>/dist/main/main/mcp/server.js / パッケージ版: resources/app.asar/dist/... (ARSIST_APP_ROOT)
const roots = [process.env.ARSIST_APP_ROOT, path.join(here, '..')].filter(Boolean);
const entry = roots.map((r) => path.join(r, 'dist', 'main', 'main', 'mcp', 'server.js')).find((p) => fs.existsSync(p));

if (!entry) {
  process.stderr.write('[arsist-mcp] dist/main/main/mcp/server.js not found. Run "npm run build:main" in the Arsist folder first.\n');
  process.exit(1);
}

require(entry).runStdioServer().catch((error) => {
  process.stderr.write(`[arsist-mcp] failed to start: ${error?.stack || error}\n`);
  process.exit(1);
});
