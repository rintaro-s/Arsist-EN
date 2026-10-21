/** main (src/main/ipc/aiIpc.ts) とやり取りする形。 */

export interface McpAgentState {
  id: string;
  name: string;
  configPath: string | null;
  detected: boolean;
  status: 'registered' | 'outdated' | 'notRegistered' | 'unreadable';
  detail?: string;
  via: 'json' | 'toml' | 'cli';
}

export interface McpAgentsInfo {
  spec: { command: string; args: string[]; env: Record<string, string> };
  json: string;
  commandLine: string;
  agents: McpAgentState[];
  tools: Array<{ name: string; description: string; readOnly: boolean }>;
}

export interface AssistantSettingsView {
  baseUrl: string;
  model: string;
  temperature?: number;
  maxSteps?: number;
  hasKey: boolean;
  encrypted: boolean;
  canEncrypt: boolean;
}

export type AssistantEvent =
  | { type: 'thinking'; step: number }
  | { type: 'tool-call'; id: string; name: string; args: unknown }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'snapshot'; snapshotId: string }
  | { type: 'message'; content: string }
  | { type: 'error'; message: string }
  | { type: 'done'; changed: boolean; steps: number };

export interface PackageImportReply {
  ok: boolean;
  canceled?: boolean;
  kind?: 'project' | 'extension';
  error?: string;
  problems?: string[];
  // project
  projectPath?: string;
  name?: string;
  files?: number;
  extensions?: Array<{ id: string; version: string; action: 'installed' | 'kept' | 'needsConfirm' | 'failed'; installedVersion?: string; message?: string; stagedDir?: string }>;
  // extension
  id?: string;
  version?: string;
  source?: string;
  needsConfirm?: { id: string; installed: string; incoming: string; downgrade: boolean };
}

/** よく使う OpenAI 互換のサービス (URL を入れる手間を省くだけ。何でも手で入れられる) */
export const ASSISTANT_PRESETS: Array<{ id: string; label: string; baseUrl: string; keyNeeded: boolean }> = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyNeeded: true },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyNeeded: true },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyNeeded: true },
  { id: 'qwen', label: 'Qwen (DashScope)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyNeeded: true },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyNeeded: true },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', keyNeeded: false },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', keyNeeded: false },
  { id: 'custom', label: 'Custom', baseUrl: '', keyNeeded: false },
];
