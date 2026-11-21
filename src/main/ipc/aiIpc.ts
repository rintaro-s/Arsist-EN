/**
 * MCP (外部のエージェントへの登録)・内蔵エージェント・プロジェクトの書き出し / 読み込みの IPC。
 * main.ts が大きいので、ここにまとめる。
 */
import * as os from 'os';
import * as path from 'path';
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { arsistLaunchSpec, selfTestMcp } from '../mcp/launch';
import { genericConfigJson, registerTarget, targetStates, unregisterTarget, type TargetEnv } from '../mcp/agentTargets';
import { ARSIST_TOOLS, ToolSession } from '../mcp/tools';
import { AssistantConversation, listModels, restoreSnapshot, systemPrompt, type AssistantSettings } from '../agent/assistant';
import { getExtensionCatalog, getUserExtensionsDir, invalidateExtensionCatalog } from '../extensions/catalogService';
import { exportProject, importProject, peekPackageKind } from '../project/projectPackage';
import { installExtension, PACKAGE_EXTENSION } from '../extensions/packages';

export interface AiIpcContext {
  getMainWindow(): BrowserWindow | null;
  /** electron-store (使うのは get / set だけ) */
  store: { get(key: string): unknown; set(key: string, value: unknown): void };
  /** エディタで開いているプロジェクト (Virtual でも Spatial でも。main.ts の currentProjectPathForAssets) */
  getProjectPath(): string | null;
  isDev: boolean;
}

const targetEnv = (): TargetEnv => ({ home: os.homedir(), platform: process.platform, env: process.env, useCli: true });

export function registerAiIpc(ctx: AiIpcContext): void {
  const recentProjects = () => {
    const list = ctx.store.get('recentProjects');
    return Array.isArray(list) ? (list as string[]) : [];
  };

  const spec = (includeProject: boolean) => arsistLaunchSpec({
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    appRoot: app.isPackaged ? app.getAppPath() : process.cwd(),
    resourcesPath: process.resourcesPath ?? '',
    projectPath: includeProject ? ctx.getProjectPath() : null,
  });

  // ---- MCP: エージェントへの登録 ----

  ipcMain.handle('mcp:agents', async (_, includeProject: boolean) => {
    const s = spec(includeProject === true);
    return {
      spec: s,
      json: genericConfigJson(s),
      commandLine: [...Object.entries(s.env).map(([k, v]) => `${k}=${JSON.stringify(v)}`), JSON.stringify(s.command), ...s.args.map((a) => JSON.stringify(a))].join(' '),
      agents: await targetStates(s, targetEnv()),
      tools: ARSIST_TOOLS.map((t) => ({ name: t.name, description: t.description, readOnly: t.readOnly })),
    };
  });

  ipcMain.handle('mcp:register', async (_, id: string, includeProject: boolean) => registerTarget(id, spec(includeProject === true), targetEnv()));
  ipcMain.handle('mcp:unregister', async (_, id: string) => unregisterTarget(id, targetEnv()));
  ipcMain.handle('mcp:self-test', async (_, includeProject: boolean) => selfTestMcp(spec(includeProject === true)));

  // ---- 内蔵エージェント ----

  const readSettings = (): AssistantSettings & { hasKey: boolean; encrypted: boolean } => {
    const raw = (ctx.store.get('assistant') ?? {}) as Record<string, any>;
    let apiKey = '';
    if (typeof raw.apiKeyEnc === 'string' && raw.apiKeyEnc) {
      try { apiKey = safeStorage.decryptString(Buffer.from(raw.apiKeyEnc, 'base64')); } catch { apiKey = ''; }
    } else if (typeof raw.apiKey === 'string') {
      apiKey = raw.apiKey;
    }
    return {
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : 'https://api.openai.com/v1',
      model: typeof raw.model === 'string' ? raw.model : '',
      temperature: typeof raw.temperature === 'number' ? raw.temperature : undefined,
      maxSteps: typeof raw.maxSteps === 'number' ? raw.maxSteps : 24,
      apiKey,
      hasKey: apiKey.length > 0,
      encrypted: typeof raw.apiKeyEnc === 'string' && raw.apiKeyEnc.length > 0,
    };
  };

  ipcMain.handle('assistant:get-settings', async () => {
    const s = readSettings();
    // 鍵そのものは画面に返さない
    return { baseUrl: s.baseUrl, model: s.model, temperature: s.temperature, maxSteps: s.maxSteps, hasKey: s.hasKey, encrypted: s.encrypted, canEncrypt: safeStorage.isEncryptionAvailable() };
  });

  ipcMain.handle('assistant:set-settings', async (_, next: { baseUrl?: string; model?: string; temperature?: number | null; maxSteps?: number; apiKey?: string | null }) => {
    const raw = { ...((ctx.store.get('assistant') ?? {}) as Record<string, any>) };
    if (typeof next.baseUrl === 'string') raw.baseUrl = next.baseUrl.trim();
    if (typeof next.model === 'string') raw.model = next.model.trim();
    if (next.temperature === null) delete raw.temperature;
    else if (typeof next.temperature === 'number') raw.temperature = next.temperature;
    if (typeof next.maxSteps === 'number') raw.maxSteps = Math.max(1, Math.min(100, Math.round(next.maxSteps)));
    if (next.apiKey !== undefined) {
      delete raw.apiKey;
      delete raw.apiKeyEnc;
      if (next.apiKey) {
        // 使えるなら OS の鍵束で暗号化して置く (平文の設定ファイルに API キーを残さない)
        if (safeStorage.isEncryptionAvailable()) raw.apiKeyEnc = safeStorage.encryptString(next.apiKey).toString('base64');
        else raw.apiKey = next.apiKey;
      }
    }
    ctx.store.set('assistant', raw);
    return { ok: true };
  });

  ipcMain.handle('assistant:models', async (_, override?: { baseUrl?: string; apiKey?: string }) => {
    const s = readSettings();
    return listModels({ ...s, baseUrl: override?.baseUrl || s.baseUrl, apiKey: override?.apiKey || s.apiKey });
  });

  const conversations = new Map<string, AssistantConversation>();
  const sessions = new Map<string, ToolSession>();

  ipcMain.handle('assistant:send', async (_, conversationId: string, text: string, context: { selection?: string; language?: string; targetDevice?: string }) => {
    const projectPath = ctx.getProjectPath();
    let session = sessions.get(conversationId);
    if (!session) {
      session = new ToolSession({ projectPath, recentProjects });
      sessions.set(conversationId, session);
    }
    if (projectPath) session.projectPath = projectPath;
    let conv = conversations.get(conversationId);
    if (!conv) {
      conv = new AssistantConversation(session);
      conversations.set(conversationId, conv);
    }
    if (conv.running) return { ok: false, error: 'already running' };

    const settings = readSettings();
    const send = (event: unknown) => ctx.getMainWindow()?.webContents.send('assistant:event', { conversationId, event });
    // 終わるまで待たずに返す (途中経過は assistant:event で流す)
    void conv.send(text, settings, systemPrompt({ projectPath: session.projectPath, targetDevice: context?.targetDevice, selection: context?.selection, language: context?.language }), send);
    return { ok: true };
  });

  ipcMain.handle('assistant:abort', async (_, conversationId: string) => {
    conversations.get(conversationId)?.abort();
    return { ok: true };
  });

  ipcMain.handle('assistant:reset', async (_, conversationId: string) => {
    conversations.get(conversationId)?.abort();
    conversations.delete(conversationId);
    sessions.delete(conversationId);
    return { ok: true };
  });

  ipcMain.handle('assistant:undo', async (_, snapshotId: string) => {
    const projectPath = ctx.getProjectPath();
    if (!projectPath) return { ok: false, error: 'no project is open' };
    try {
      await restoreSnapshot(projectPath, snapshotId);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // ---- プロジェクトの書き出し / 読み込み ----

  // LLM を含むプロジェクトは数百 MB になり、数秒かかる。選択画面を閉じてから終わるまでを画面に知らせる
  const busy = async <T>(action: 'export' | 'import', file: string, work: () => Promise<T>): Promise<T> => {
    ctx.getMainWindow()?.webContents.send('project:package-busy', { action, file });
    try {
      return await work();
    } finally {
      ctx.getMainWindow()?.webContents.send('project:package-busy', null);
    }
  };

  ipcMain.handle('project:export-package', async (_, projectPath: string, bundleExtensions: boolean) => {
    const win = ctx.getMainWindow();
    const options: Electron.SaveDialogOptions = {
      defaultPath: `${path.basename(projectPath)}${PACKAGE_EXTENSION}`,
      filters: [{ name: 'Arsist project', extensions: [PACKAGE_EXTENSION.slice(1)] }],
    };
    const saved = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (saved.canceled || !saved.filePath) return { ok: false, canceled: true };
    const outFile = saved.filePath;
    try {
      return await busy('export', outFile, async () => {
        const catalog = await getExtensionCatalog(true);
        const r = await exportProject(projectPath, outFile, { installed: catalog.extensions, bundleExtensions: bundleExtensions !== false });
        return { ok: true, ...r };
      });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  /** .arsist / .zip を選んで、中身に応じて読み込む (プロジェクトなら置き場所を訊いて展開、拡張機能なら入れる)。 */
  ipcMain.handle('project:import-package', async () => {
    const win = ctx.getMainWindow();
    const openOptions: Electron.OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'Arsist package', extensions: [PACKAGE_EXTENSION.slice(1), 'zip'] }] };
    const picked = win ? await dialog.showOpenDialog(win, openOptions) : await dialog.showOpenDialog(openOptions);
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true };
    const file = picked.filePaths[0];

    const kind = await peekPackageKind(file);
    if (kind === 'extension') {
      const userDir = getUserExtensionsDir();
      if (!userDir) return { ok: false, error: 'not ready' };
      return busy('import', file, async () => {
        const catalog = await getExtensionCatalog(true);
        const r = await installExtension(file, userDir, { installedVersionOf: (id) => catalog.extensions.find((e) => e.manifest.id === id)?.manifest.version ?? null });
        invalidateExtensionCatalog();
        return { ...r, kind, source: file };
      });
    }
    if (kind !== 'project') return { ok: false, error: `${path.basename(file)} is not an Arsist project or extension package` };

    const folderOptions: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], title: 'Where to put the project' };
    const dest = win ? await dialog.showOpenDialog(win, folderOptions) : await dialog.showOpenDialog(folderOptions);
    if (dest.canceled || dest.filePaths.length === 0) return { ok: false, canceled: true };
    try {
      return await busy('import', file, async () => {
        const catalog = await getExtensionCatalog(true);
        const r = await importProject(file, dest.filePaths[0], { installed: catalog.extensions, userExtensionsDir: getUserExtensionsDir() });
        invalidateExtensionCatalog();
        return { ok: true as const, kind, ...r };
      });
    } catch (e) {
      return { ok: false, kind, error: (e as Error).message };
    }
  });

  /** 読み込んだプロジェクトに入っていた、今のより新しい拡張機能を入れる (画面で確認したあと)。 */
  ipcMain.handle('project:install-staged-extension', async (_, stagedDir: string) => {
    const userDir = getUserExtensionsDir();
    if (!userDir) return { ok: false, error: 'not ready' };
    const r = await installExtension(stagedDir, userDir, { force: true });
    invalidateExtensionCatalog();
    return r;
  });
}
