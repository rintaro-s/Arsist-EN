/**
 * Arsist Engine - Electron Main Process
 * メインプロセス：ウィンドウ管理、IPC通信、システム連携
 */
import { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs-extra';
import { createHash } from 'crypto';
import * as os from 'os';
import Store from 'electron-store';
import { spawn, ChildProcess } from 'child_process';
import { UnityBuilder } from './unity/UnityBuilder';
import { ProjectManager } from './project/ProjectManager';
import { AdapterManager } from './adapters/AdapterManager';

// fetch() でローカルアセットを読めるようにする（dev/prod共通）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'arsist-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

// 設定ストア
const store = new Store({
  defaults: {
    unityPath: '',
    unityVersion: '2022.3.20f1',
    recentProjects: [],
    theme: 'dark',
    layoutSettings: {
      leftPanelWidth: 280,
      rightPanelWidth: 320,
      bottomPanelHeight: 200,
    },
    defaultOutputPath: '',
    defaultProjectPath: '',
  },
});

let mainWindow: BrowserWindow | null = null;
let projectManager: ProjectManager | null = null;
let unityBuilder: UnityBuilder | null = null;
let adapterManager: AdapterManager | null = null;
let currentProjectPathForAssets: string | null = null;
let mcpServerProcess: ChildProcess | null = null;
let mcpServerEnabled = false;
let mcpServerPort = 0; // stdio transport なので不要だが、情報として保持

const isDev = process.env.NODE_ENV === 'development';

// Linux向け：Vulkan周りの警告/不安定さを避ける（WebGLは通常OpenGL経由）
if (process.platform === 'linux') {
  try {
    app.commandLine.appendSwitch('disable-features', 'Vulkan');
  } catch {
    // ignore
  }
  // ファイルダイアログのGTKエラー回避のため、portalを優先
  process.env.ELECTRON_USE_XDG_DESKTOP_PORTAL = process.env.ELECTRON_USE_XDG_DESKTOP_PORTAL || '1';
  process.env.GTK_USE_PORTAL = process.env.GTK_USE_PORTAL || '1';
  // Wayland環境でGtkFileChooserNativeが不安定なケースがあるので、未指定ならX11ヒントを優先
  process.env.ELECTRON_OZONE_PLATFORM_HINT = process.env.ELECTRON_OZONE_PLATFORM_HINT || 'x11';
  try {
    app.commandLine.appendSwitch('ozone-platform-hint', process.env.ELECTRON_OZONE_PLATFORM_HINT);
  } catch {
    // ignore
  }
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/');
}

function updateRecentProjects(projectPath: string) {
  const key = 'recentProjects';
  const existing = store.get(key);
  const list = Array.isArray(existing) ? existing.filter((p) => typeof p === 'string') as string[] : [];
  const normalized = path.resolve(projectPath);
  const next = [normalized, ...list.filter((p) => path.resolve(p) !== normalized)].slice(0, 5);
  store.set(key, next);
}

function detectAssetKindByExt(filePath: string): 'model' | 'texture' | 'video' | 'other' {
  const ext = path.extname(filePath).toLowerCase();
  if (['.glb', '.gltf'].includes(ext)) return 'model';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return 'texture';
  if (['.mp4', '.webm', '.mov'].includes(ext)) return 'video';
  return 'other';
}

type UnityCandidate = { path: string; version?: string };

function normalizeUnityVersionForSort(version: string): number[] {
  // e.g. 6000.0.61f1 -> [6000,0,61,1]
  const cleaned = version.replace(/f/i, '.');
  return cleaned.split(/\.|-/).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n));
}

function compareUnityVersionsDesc(a?: string, b?: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const av = normalizeUnityVersionForSort(a);
  const bv = normalizeUnityVersionForSort(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const diff = (bv[i] || 0) - (av[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function findUnityCandidates(): Promise<{ candidates: string[]; details: UnityCandidate[] }> {
  const details: UnityCandidate[] = [];

  if (process.platform === 'linux') {
    const home = os.homedir();
    const hubEditorRoot = path.join(home, 'Unity', 'Hub', 'Editor');
    if (await fs.pathExists(hubEditorRoot)) {
      const entries = await fs.readdir(hubEditorRoot, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const p = path.join(hubEditorRoot, ent.name, 'Editor', 'Unity');
        if (await fs.pathExists(p)) details.push({ path: p, version: ent.name });
      }
    }
    // PATH上のUnityも候補に（見つからなければ無視）
    const pathUnity = '/usr/bin/unity-editor';
    if (await fs.pathExists(pathUnity)) details.push({ path: pathUnity });
  }

  if (process.platform === 'win32') {
    const roots = [
      path.join(process.env['ProgramFiles'] || 'C:/Program Files', 'Unity', 'Hub', 'Editor'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Unity', 'Hub', 'Editor'),
    ];
    for (const root of roots) {
      if (!await fs.pathExists(root)) continue;
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const p = path.join(root, ent.name, 'Editor', 'Unity.exe');
        if (await fs.pathExists(p)) details.push({ path: p, version: ent.name });
      }
    }
  }

  if (process.platform === 'darwin') {
    const hubEditorRoot = path.join('/Applications', 'Unity', 'Hub', 'Editor');
    if (await fs.pathExists(hubEditorRoot)) {
      const entries = await fs.readdir(hubEditorRoot, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const p = path.join(hubEditorRoot, ent.name, 'Unity.app', 'Contents', 'MacOS', 'Unity');
        if (await fs.pathExists(p)) details.push({ path: p, version: ent.name });
      }
    }
  }

  // 重複排除 + 新しい順に並べ替え
  const unique = new Map<string, UnityCandidate>();
  for (const d of details) unique.set(d.path, d);
  const arr = Array.from(unique.values());
  arr.sort((a, b) => compareUnityVersionsDesc(a.version, b.version));
  return { candidates: arr.map((d) => d.path), details: arr };
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'Arsist Engine',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    frame: false,
    titleBarStyle: 'hidden',
  });

  // 開発モードかプロダクションかで読み込みURLを変更
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // メニューバー設定
  createMenu();
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'ファイル',
      submenu: [
        { label: '新規プロジェクト', accelerator: 'CmdOrCtrl+N', click: () => handleNewProject() },
        { label: 'プロジェクトを開く', accelerator: 'CmdOrCtrl+O', click: () => handleOpenProject() },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save') },
        { label: '名前を付けて保存', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow?.webContents.send('menu:save-as') },
        { type: 'separator' },
        { label: 'ビルド設定', accelerator: 'CmdOrCtrl+Shift+B', click: () => mainWindow?.webContents.send('menu:build-settings') },
        { label: 'ビルド', accelerator: 'CmdOrCtrl+B', click: () => mainWindow?.webContents.send('menu:build') },
        { type: 'separator' },
        { label: '設定', accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.send('menu:settings') },
        { type: 'separator' },
        { label: '終了', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: '編集',
      submenu: [
        { label: '元に戻す', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'やり直す', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: '切り取り', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'コピー', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '貼り付け', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '削除', accelerator: 'Delete', click: () => mainWindow?.webContents.send('menu:delete') },
        { type: 'separator' },
        { label: 'すべて選択', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: '表示',
      submenu: [
        { label: '3Dビュー', accelerator: 'F1', click: () => mainWindow?.webContents.send('menu:view', '3d') },
        { label: '2D Canvasビュー', accelerator: 'F2', click: () => mainWindow?.webContents.send('menu:view', '2d') },
        { label: 'ロジックエディタ', accelerator: 'F3', click: () => mainWindow?.webContents.send('menu:view', 'logic') },
        { type: 'separator' },
        { label: '開発者ツール', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
      ],
    },
    {
      label: 'ヘルプ',
      submenu: [
        { label: 'ドキュメント', click: () => shell.openExternal('https://arsist.dev/docs') },
        { label: 'GitHubリポジトリ', click: () => shell.openExternal('https://github.com/arsist') },
        { type: 'separator' },
        { label: 'Arsistについて', click: () => showAboutDialog() },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function handleNewProject(): Promise<void> {
  mainWindow?.webContents.send('menu:new-project');
}

async function handleOpenProject(): Promise<void> {
  try {
    const result = await showOpenDialogSafe({
      properties: ['openDirectory'],
      title: 'プロジェクトフォルダを選択',
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const projectPath = result.filePaths[0];
      mainWindow?.webContents.send('project:open', projectPath);
    }
  } catch {
    // ignore
  }
}

function showAboutDialog(): void {
  dialog.showMessageBox(mainWindow!, {
    type: 'info',
    title: 'Arsist Engine',
    message: 'Arsist Engine v1.0.0',
    detail: 'ARグラス・クロスプラットフォーム開発エンジン\n\nXREAL, Rokid, VITURE等の異なるARグラス向けアプリを単一ソースから生成可能。',
  });
}

async function showOpenDialogSafe(options: Electron.OpenDialogOptions) {
  // Linux の GtkFileChooserNative が親付きで不安定な環境があるため、
  // まずは親無しを試し、失敗したら親付きにフォールバックする。
  if (process.platform === 'linux') {
    try {
      return await dialog.showOpenDialog(options);
    } catch {
      // fallthrough
    }
  }

  try {
    return await dialog.showOpenDialog(mainWindow!, options);
  } catch {
    // 親付きが失敗する場合もあるため最後に親無しを試す
    return await dialog.showOpenDialog(options);
  }
}

// ========================================
// IPC Handlers
// ========================================

// プロジェクト管理
ipcMain.handle('project:create', async (_, options) => {
  if (!projectManager) {
    projectManager = new ProjectManager();
  }
  const res = await projectManager.createProject(options);
  if (res?.success) {
    const projectDir = path.join(options.path, options.name);
    currentProjectPathForAssets = projectDir;
    updateRecentProjects(projectDir);
  }
  return res;
});

ipcMain.handle('project:load', async (_, projectPath: string) => {
  if (!projectManager) {
    projectManager = new ProjectManager();
  }
  const res = await projectManager.loadProject(projectPath);
  if (res?.success) {
    currentProjectPathForAssets = projectPath;
    updateRecentProjects(projectPath);
  }
  return res;
});

ipcMain.handle('project:save', async (_, data) => {
  if (!projectManager) return { success: false, error: 'Project manager not initialized' };
  return await projectManager.saveProject(data);
});

ipcMain.handle('project:export', async (_, options) => {
  if (!projectManager) return { success: false, error: 'Project manager not initialized' };
  return await projectManager.exportProject(options);
});

// Unity連携
ipcMain.handle('unity:set-path', async (_, unityPath: string) => {
  store.set('unityPath', unityPath);
  if (unityBuilder) {
    unityBuilder.setUnityPath(unityPath);
  }
  return { success: true };
});

ipcMain.handle('unity:get-path', async () => {
  return store.get('unityPath');
});

ipcMain.handle('unity:build', async (_, buildConfig) => {
  const unityPath = store.get('unityPath') as string;
  const unityVersion = store.get('unityVersion') as string;
  if (!unityPath) {
    return { success: false, error: 'Unity path not configured' };
  }

  if (!unityBuilder || unityBuilder.getUnityPath() !== unityPath) {
    unityBuilder = new UnityBuilder(unityPath);
  }

  // unity:build を複数回呼ぶと listener が積み上がってログ/進捗が重複するため毎回リセット
  unityBuilder.removeAllListeners('progress');
  unityBuilder.removeAllListeners('log');

  // ビルド進捗をレンダラーに通知
  unityBuilder.on('progress', (progress) => {
    mainWindow?.webContents.send('unity:build-progress', progress);
  });

  unityBuilder.on('log', (log) => {
    mainWindow?.webContents.send('unity:build-log', log);
  });

  return await unityBuilder.build({
    ...buildConfig,
    unityVersion: buildConfig?.unityVersion || unityVersion,
  });
});

ipcMain.handle('unity:validate', async () => {
  const unityPath = store.get('unityPath') as string;
  const unityVersion = store.get('unityVersion') as string;
  if (!unityPath) {
    return { valid: false, error: 'Unity path not configured' };
  }
  
  if (!unityBuilder || unityBuilder.getUnityPath() !== unityPath) {
    unityBuilder = new UnityBuilder(unityPath);
  }
  
  return await unityBuilder.validate(unityVersion);
});

// アダプター管理
ipcMain.handle('adapters:list', async () => {
  if (!adapterManager) {
    adapterManager = new AdapterManager();
  }
  return await adapterManager.listAdapters();
});

ipcMain.handle('adapters:get', async (_, adapterId: string) => {
  if (!adapterManager) {
    adapterManager = new AdapterManager();
  }
  return await adapterManager.getAdapter(adapterId);
});

ipcMain.handle('adapters:apply-patch', async (_, adapterId: string, projectPath: string) => {
  if (!adapterManager) {
    adapterManager = new AdapterManager();
  }
  return await adapterManager.applyPatch(adapterId, projectPath);
});

// ファイルシステム操作
ipcMain.handle('fs:read-file', async (_, filePath: string) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('fs:write-file', async (_, filePath: string, content: string) => {
  try {
    await fs.outputFile(filePath, content);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('fs:select-directory', async () => {
  try {
    const result = await showOpenDialogSafe({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  } catch {
    return null;
  }
});

ipcMain.handle('fs:select-file', async (_, filters?: Electron.FileFilter[]) => {
  try {
    const result = await showOpenDialogSafe({
      properties: ['openFile'],
      filters: filters || [],
    });
    return result.canceled ? null : result.filePaths[0];
  } catch {
    return null;
  }
});

ipcMain.handle('fs:exists', async (_, filePath: string) => {
  try {
    return { exists: await fs.pathExists(filePath) };
  } catch {
    return { exists: false };
  }
});

ipcMain.handle('sdk:xreal-status', async () => {
  try {
    const repoRoot = path.join(__dirname, '../../..');
    const pkgJsonPath = path.join(repoRoot, 'sdk', 'com.xreal.xr', 'package', 'package.json');
    if (!await fs.pathExists(pkgJsonPath)) {
      return { exists: false, path: pkgJsonPath };
    }
    const pkg = await fs.readJSON(pkgJsonPath);
    const version = typeof pkg?.version === 'string' ? pkg.version : undefined;
    return { exists: true, path: pkgJsonPath, version };
  } catch (error) {
    return { exists: false, error: (error as Error).message };
  }
});

ipcMain.handle('sdk:quest-status', async () => {
  try {
    const repoRoot = path.join(__dirname, '../../..');
    const questDir = path.join(repoRoot, 'sdk', 'quest');
    if (!await fs.pathExists(questDir)) {
      return { exists: false, path: questDir, error: 'sdk/quest directory not found' };
    }

    const entries = await fs.readdir(questDir);
    const core = entries.find((f) => /^com\.meta\.xr\.sdk\.core-.*\.tgz$/i.test(f));
    const mruk = entries.find((f) => /^com\.meta\.xr\.mrutilitykit-.*\.tgz$/i.test(f));

    return {
      exists: !!core,
      path: questDir,
      corePackage: core,
      mrukPackage: mruk,
      error: core ? undefined : 'com.meta.xr.sdk.core-*.tgz not found in sdk/quest',
    };
  } catch (error) {
    return { exists: false, error: (error as Error).message };
  }
});

ipcMain.handle('assets:import', async (_, params: { projectPath: string; sourcePath: string; kind?: 'model' | 'texture' | 'video' | 'other' }) => {
  try {
    const projectPath = params?.projectPath;
    const sourcePath = params?.sourcePath;
    if (!projectPath || !sourcePath) {
      return { success: false, error: 'projectPath/sourcePath is required' };
    }
    if (!await fs.pathExists(sourcePath)) {
      return { success: false, error: `Source not found: ${sourcePath}` };
    }

    const ext = path.extname(sourcePath).toLowerCase();
    const kind = params.kind || (
      ['.glb', '.gltf'].includes(ext) ? 'model' :
      ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? 'texture' :
      ['.mp4', '.webm', '.mov'].includes(ext) ? 'video' :
      'other'
    );

    const subdir = kind === 'model'
      ? path.join('Assets', 'Models')
      : kind === 'texture'
        ? path.join('Assets', 'Textures')
        : kind === 'video'
          ? path.join('Assets', 'Video')
          : path.join('Assets', 'Other');

    const destDir = path.join(projectPath, subdir);
    await fs.ensureDir(destDir);

    const baseName = path.basename(sourcePath, ext);
    const hash = createHash('sha1').update(await fs.readFile(sourcePath)).digest('hex').slice(0, 8);
    const safeBase = baseName.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40) || 'asset';
    const fileName = `${safeBase}_${hash}${ext}`;

    const destAbs = path.join(destDir, fileName);
    await fs.copyFile(sourcePath, destAbs);

    const rel = path.join(subdir, fileName).replace(/\\/g, '/');
    return { success: true, assetPath: rel };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('assets:list', async (_, params: { projectPath: string }) => {
  try {
    const projectPath = params?.projectPath;
    if (!projectPath) return { success: false, error: 'projectPath is required' };

    const root = path.join(projectPath, 'Assets');
    if (!await fs.pathExists(root)) {
      return { success: true, items: [] };
    }

    const items: Array<{ relPath: string; name: string; kind: 'model' | 'texture' | 'video' | 'other' | 'dir'; size?: number; modifiedTime?: number }> = [];

    const walk = async (dirAbs: string) => {
      const entries = await fs.readdir(dirAbs, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name.startsWith('.')) continue;
        const abs = path.join(dirAbs, ent.name);
        const rel = normalizeRel(path.relative(projectPath, abs));

        if (ent.isDirectory()) {
          items.push({ relPath: rel, name: ent.name, kind: 'dir' });
          await walk(abs);
          continue;
        }

        const stat = await fs.stat(abs);
        items.push({
          relPath: rel,
          name: ent.name,
          kind: detectAssetKindByExt(ent.name),
          size: stat.size,
          modifiedTime: stat.mtimeMs,
        });
      }
    };

    await walk(root);

    // ディレクトリは後ろへ、ファイルを先に
    items.sort((a, b) => {
      if (a.kind === 'dir' && b.kind !== 'dir') return 1;
      if (a.kind !== 'dir' && b.kind === 'dir') return -1;
      return a.relPath.localeCompare(b.relPath);
    });

    return { success: true, items };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('unity:detect-paths', async () => {
  try {
    const result = await findUnityCandidates();
    return { success: true, candidates: result.candidates, details: result.details };
  } catch (error) {
    return { success: false, error: (error as Error).message, candidates: [], details: [] };
  }
});

// 設定
ipcMain.handle('store:get', async (_, key: string) => {
  return store.get(key);
});

ipcMain.handle('store:set', async (_, key: string, value: any) => {
  store.set(key, value);
  return { success: true };
});

// ========================================
// MCP サーバー管理
// ========================================

function startMCPServer(projectPath: string): Promise<{ success: boolean; message?: string; config?: any }> {
  return new Promise((resolve) => {
    if (mcpServerProcess) {
      resolve({ success: false, message: 'MCP server is already running' });
      return;
    }

    try {
      const scriptPath = isDev
        ? path.join(process.cwd(), 'scripts', 'mcp-ir-server.mjs')
        : path.join(process.resourcesPath, 'scripts', 'mcp-ir-server.mjs');

      // Node.js パスを取得（Electron内蔵のNode.jsを使用）
      const nodePath = process.execPath; // Electronの実行ファイル
      const args = [scriptPath];

      // 環境変数で stdio transport を使う
      const env = {
        ...process.env,
        MCP_PROJECT_PATH: projectPath,
      };

      mcpServerProcess = spawn(nodePath, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
      });

      mcpServerProcess.on('error', (err) => {
        mcpServerEnabled = false;
        mcpServerProcess = null;
        resolve({ success: false, message: `Failed to start MCP server: ${err.message}` });
      });

      mcpServerProcess.on('exit', (code) => {
        mcpServerEnabled = false;
        mcpServerProcess = null;
      });

      // サーバー起動確認（stderr にログが出る）
      let startupOutput = '';
      const startupTimeout = setTimeout(() => {
        if (mcpServerProcess) {
          mcpServerEnabled = true;
          resolve({
            success: true,
            message: 'MCP server started (stdio transport)',
            config: {
              transport: 'stdio',
              command: nodePath,
              args: args,
              projectPath: projectPath,
              tools: 17, // 現在のツール数
              clientSetup: {
                description: 'Add the following configuration to your MCP client (e.g., Claude Desktop settings.json):',
                config: {
                  mcpServers: {
                    'arsist-ir': {
                      command: nodePath,
                      args: args,
                      env: {
                        MCP_PROJECT_PATH: projectPath,
                      },
                    },
                  },
                },
              },
            },
          });
        }
      }, 500);

      mcpServerProcess.stderr?.on('data', (data) => {
        startupOutput += data.toString();
        if (startupOutput.includes('error') || startupOutput.includes('Error')) {
          clearTimeout(startupTimeout);
          mcpServerProcess?.kill();
          mcpServerProcess = null;
          mcpServerEnabled = false;
          resolve({ success: false, message: `MCP server startup error: ${startupOutput}` });
        }
      });
    } catch (error) {
      mcpServerEnabled = false;
      mcpServerProcess = null;
      resolve({ success: false, message: `Exception: ${(error as Error).message}` });
    }
  });
}

function stopMCPServer(): { success: boolean; message: string } {
  if (!mcpServerProcess) {
    return { success: false, message: 'MCP server is not running' };
  }

  try {
    mcpServerProcess.kill('SIGTERM');
    mcpServerProcess = null;
    mcpServerEnabled = false;
    return { success: true, message: 'MCP server stopped' };
  } catch (error) {
    return { success: false, message: `Failed to stop MCP server: ${(error as Error).message}` };
  }
}

function getMCPServerStatus(): { enabled: boolean; running: boolean; config?: any } {
  return {
    enabled: mcpServerEnabled,
    running: mcpServerProcess !== null,
    config: mcpServerEnabled && currentProjectPathForAssets
      ? {
          transport: 'stdio',
          projectPath: currentProjectPathForAssets,
          tools: 17,
        }
      : undefined,
  };
}

ipcMain.handle('mcp:start', async (_, projectPath: string) => {
  return await startMCPServer(projectPath);
});

ipcMain.handle('mcp:stop', async () => {
  return stopMCPServer();
});

ipcMain.handle('mcp:status', async () => {
  return getMCPServerStatus();
});

ipcMain.handle('mcp:get-client-config', async () => {
  if (!mcpServerEnabled || !currentProjectPathForAssets) {
    return { success: false, message: 'MCP server is not running' };
  }

  const nodePath = process.execPath;
  const scriptPath = isDev
    ? path.join(process.cwd(), 'scripts', 'mcp-ir-server.mjs')
    : path.join(process.resourcesPath, 'scripts', 'mcp-ir-server.mjs');

  return {
    success: true,
    config: {
      description: 'Add this configuration to your MCP client (e.g., Claude Desktop settings.json on Windows: %APPDATA%\\Claude\\claude_desktop_config.json)',
      json: {
        mcpServers: {
          'arsist-ir': {
            command: nodePath,
            args: [scriptPath],
            env: {
              MCP_PROJECT_PATH: currentProjectPathForAssets,
            },
          },
        },
      },
    },
  };
});

// ========================================
// ウィンドウ操作
// ========================================

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

// ========================================
// アプリライフサイクル
// ========================================

app.whenReady().then(() => {
  try {
    protocol.registerFileProtocol('arsist-file', (request, callback) => {
      try {
        const u = new URL(request.url);
        // arsist-file:///C:/... または arsist-file://C:/Users/... 形式に対応
        let pathname = u.pathname;
        
        // ホスト名がドライブレター（C など）の場合
        if (u.host && /^[A-Za-z]$/.test(u.host)) {
          pathname = `${u.host}:${u.pathname}`;
        } else if (u.host) {
          // その他のホスト名がある場合
          pathname = `/${u.host}${u.pathname}`;
        }
        
        let pathname_decoded = decodeURIComponent(pathname);
        
        // Windows: /C:/... -> C:/... とバックスラッシュ正規化
        if (process.platform === 'win32') {
          if (pathname_decoded.startsWith('/') && /^[A-Za-z]:/.test(pathname_decoded.slice(1))) {
            pathname_decoded = pathname_decoded.slice(1);
          }
          pathname_decoded = pathname_decoded.replace(/\\/g, '/');
        }
        
        const abs = path.resolve(pathname_decoded);
        const base = currentProjectPathForAssets ? path.resolve(currentProjectPathForAssets) : null;
        if (base) {
          const rel = path.relative(base, abs);
          if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
            callback({ path: abs });
            return;
          }
        }

        // プロジェクト未ロード時 / 範囲外は拒否
        callback({ error: -10 });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[arsist-file protocol error]', err);
        callback({ error: -2 });
      }
    });
  } catch {
    // ignore
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
