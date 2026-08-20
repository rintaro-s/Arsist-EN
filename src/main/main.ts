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
import {
  isUnsupportedTextureExtension,
  isUnityTextureExtension,
  UNITY_TEXTURE_EXTENSIONS,
} from '../shared/assets';
import {
  liveContext,
  getUnitySearchRoots,
  getUnityExeRelative,
  getUnityDirectCandidates,
  isWaylandSession,
} from './platform/paths';

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
    sdkDir: '',
    // GPUドライバ指紋と、次回起動時にシェーダキャッシュを消すかのフラグ
    gpuFingerprint: '',
    gpuCachePurgePending: false,
  },
});

let mainWindow: BrowserWindow | null = null;
// 起動安定化: GPU初期化失敗などでウィンドウが描画されない環境向けの
// 「ソフトウェアレンダリングで再起動」を1回だけ試みるためのフラグ。
// 環境変数で無限ループを防ぐ（再起動時に ARSIST_SOFTWARE_RENDER=1 を渡す）。
const softwareRenderRequested =
  process.env.ARSIST_SOFTWARE_RENDER === '1' ||
  process.env.ARSIST_DISABLE_GPU === '1';
let paintFallbackTried = softwareRenderRequested;
let projectManager: ProjectManager | null = null;
let unityBuilder: UnityBuilder | null = null;
let adapterManager: AdapterManager | null = null;
let currentProjectPathForAssets: string | null = null;
let mcpServerProcess: ChildProcess | null = null;
let mcpServerEnabled = false;
let mcpServerPort = 0; // stdio transport なので不要だが、情報として保持

const isDev = process.env.NODE_ENV === 'development';

// ── UI language (native menu / dialogs follow the renderer's language) ──
type AppLang = 'en' | 'ja';

function getAppLang(): AppLang {
  try {
    const v = store.get('language' as any) as unknown as string;
    return v === 'en' ? 'en' : 'ja';
  } catch {
    return 'ja';
  }
}

const MENU_STRINGS: Record<string, { en: string; ja: string }> = {
  'menu.file': { en: 'File', ja: 'ファイル' },
  'menu.newProject': { en: 'New Project', ja: '新規プロジェクト' },
  'menu.openProject': { en: 'Open Project', ja: 'プロジェクトを開く' },
  'menu.save': { en: 'Save', ja: '保存' },
  'menu.saveAs': { en: 'Save As', ja: '名前を付けて保存' },
  'menu.buildSettings': { en: 'Build Settings', ja: 'ビルド設定' },
  'menu.build': { en: 'Build', ja: 'ビルド' },
  'menu.settings': { en: 'Settings', ja: '設定' },
  'menu.quit': { en: 'Quit', ja: '終了' },
  'menu.edit': { en: 'Edit', ja: '編集' },
  'menu.undo': { en: 'Undo', ja: '元に戻す' },
  'menu.redo': { en: 'Redo', ja: 'やり直す' },
  'menu.cut': { en: 'Cut', ja: '切り取り' },
  'menu.copy': { en: 'Copy', ja: 'コピー' },
  'menu.paste': { en: 'Paste', ja: '貼り付け' },
  'menu.delete': { en: 'Delete', ja: '削除' },
  'menu.selectAll': { en: 'Select All', ja: 'すべて選択' },
  'menu.view': { en: 'View', ja: '表示' },
  'menu.view3d': { en: '3D View', ja: '3Dビュー' },
  'menu.view2d': { en: '2D Canvas View', ja: '2D Canvasビュー' },
  'menu.viewDataflow': { en: 'DataFlow Editor', ja: 'DataFlowエディタ' },
  'menu.viewScript': { en: 'Script Editor', ja: 'スクリプトエディタ' },
  'menu.devtools': { en: 'Developer Tools', ja: '開発者ツール' },
  'menu.help': { en: 'Help', ja: 'ヘルプ' },
  'menu.resetGpuCache': {
    en: 'Reset GPU Shader Cache and Restart',
    ja: 'GPUシェーダキャッシュをリセットして再起動',
  },
  'menu.docs': { en: 'Documentation', ja: 'ドキュメント' },
  'menu.github': { en: 'GitHub Repository', ja: 'GitHubリポジトリ' },
  'menu.about': { en: 'About Arsist', ja: 'Arsistについて' },
  'dialog.selectProjectFolder': { en: 'Select project folder', ja: 'プロジェクトフォルダを選択' },
  'about.detail': {
    en: 'Cross-platform development engine for AR glasses.\n\nGenerate apps for different AR glasses (XREAL, Rokid, VITURE, etc.) from a single source.',
    ja: 'ARグラス・クロスプラットフォーム開発エンジン\n\nXREAL, Rokid, VITURE等の異なるARグラス向けアプリを単一ソースから生成可能。',
  },
};

function mt(key: string): string {
  const entry = MENU_STRINGS[key];
  const lang = getAppLang();
  return entry ? (entry[lang] ?? entry.en) : key;
}

// 起動安定化: GPUが壊れている/使えない環境（ドライバ不整合・ヘッドレス・
// リモート・VM等）ではハードウェアアクセラレーションを無効化して、
// 必ずソフトウェア合成でウィンドウが描画されるようにする。
// 既定はGPU有効（3Dビューの性能のため）だが、
//   - 環境変数 ARSIST_DISABLE_GPU=1 / ARSIST_SOFTWARE_RENDER=1
//   - もしくは初回描画に失敗した際の自動再起動（後述のwatchdog）
// でソフトウェアレンダリングに切り替わる。
if (softwareRenderRequested) {
  try {
    app.disableHardwareAcceleration();
  } catch {
    // ignore
  }
  try {
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    // GPUが無い環境でもWebGL(three.js 3Dビュー)が動くようソフトGLを許可
    app.commandLine.appendSwitch('use-gl', 'angle');
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  } catch {
    // ignore
  }
}

// ── GPUシェーダキャッシュの自動無効化 ────────────────────────────────
//
// Chromium/ANGLE はリンク済みシェーダプログラムのバイナリを userData/GPUCache に
// 保存する。GPUドライバを更新するとこのバイナリは互換性を失い、
//   "Program binary could not be loaded. Binary is not compatible with
//    current driver/hardware combination."
// で全シェーダのリンクが失敗する（ウィンドウは出るが3Dビューだけ死ぬ）。
// ブラウザは別プロファイルなので無事に見え、「Electronだけ GPU が壊れている」
// ように見えるのが厄介なところ。
//
// 対策は「ドライバが変わったらキャッシュを捨てる」だけ。ただし GPU 情報は
// GPUプロセスが起動しないと取れず、その時点では既にキャッシュを掴んでいる
// （Windows では削除できない）ため、
//   1. 起動直後（GPUプロセス起動前）に、前回のフラグを見て同期的に削除
//   2. ready 後にドライバ指紋を取り、変化していたらフラグを立てて1回だけ再起動
// の2段構えにしている。
const GPU_CACHE_DIRS = ['GPUCache', 'DawnCache', 'ShaderCache', 'GrShaderCache'];
const GPU_FINGERPRINT_KEY = 'gpuFingerprint';
const GPU_PURGE_PENDING_KEY = 'gpuCachePurgePending';

function purgeGpuCaches(reason: string): void {
  let userDataDir: string;
  try {
    userDataDir = app.getPath('userData');
  } catch {
    return;
  }

  const removed: string[] = [];
  for (const dirName of GPU_CACHE_DIRS) {
    const dir = path.join(userDataDir, dirName);
    try {
      if (!fs.pathExistsSync(dir)) continue;
      fs.removeSync(dir);
      removed.push(dirName);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[arsist] GPUキャッシュの削除に失敗: ${dir}: ${(error as Error).message}`);
    }
  }

  if (removed.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[arsist] GPUシェーダキャッシュを削除しました (${reason}): ${removed.join(', ')}`);
  }
}

// 1) GPUプロセスが起動する前に、保留中の削除を実行する
{
  const manualReset = process.env.ARSIST_RESET_GPU_CACHE === '1';
  let purgePending = false;
  try {
    purgePending = store.get(GPU_PURGE_PENDING_KEY) === true;
  } catch {
    purgePending = false;
  }

  if (manualReset || purgePending) {
    purgeGpuCaches(manualReset ? 'ARSIST_RESET_GPU_CACHE=1' : 'GPU driver change detected on the previous run');
    try {
      store.set(GPU_PURGE_PENDING_KEY, false);
    } catch {
      // ignore
    }
  }
}

/** GPUドライバ/レンダラの指紋。これが変わるとキャッシュ済みバイナリは無効になる。 */
function buildGpuFingerprint(info: unknown): string | null {
  if (!info || typeof info !== 'object') return null;
  const gpuInfo = info as Record<string, any>;
  const aux = (gpuInfo.auxAttributes ?? {}) as Record<string, any>;
  const devices = Array.isArray(gpuInfo.gpuDevice) ? gpuInfo.gpuDevice : [];

  const parts = [
    aux.glRenderer,
    aux.glVendor,
    aux.glVersion,
    ...devices.map((d: Record<string, any>) => `${d?.vendorId}:${d?.deviceId}:${d?.driverVersion ?? ''}`),
  ].filter((v) => typeof v === 'string' ? v.length > 0 : v !== undefined && v !== null);

  if (parts.length === 0) return null;
  return createHash('sha1').update(parts.join('|')).digest('hex');
}

/**
 * 2) ドライバ指紋が前回と変わっていたら、次回起動時に削除するようフラグを立て、
 *    1回だけ自動で再起動する（キャッシュを掴んでいない状態で消すため）。
 */
async function checkGpuDriverChange(): Promise<void> {
  // 再起動直後は再度判定しない（ループ防止）
  if (process.env.ARSIST_GPU_CACHE_RESET_DONE === '1') return;
  if (softwareRenderRequested) return;

  let fingerprint: string | null = null;
  try {
    fingerprint = buildGpuFingerprint(await app.getGPUInfo('complete'));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[arsist] GPU情報を取得できませんでした: ${(error as Error).message}`);
    return;
  }
  if (!fingerprint) return;

  let previous: string | null = null;
  try {
    const stored = store.get(GPU_FINGERPRINT_KEY);
    previous = typeof stored === 'string' && stored ? stored : null;
  } catch {
    previous = null;
  }

  if (previous === fingerprint) return;

  try {
    store.set(GPU_FINGERPRINT_KEY, fingerprint);
  } catch {
    // ignore
  }

  // 初回起動時は比較対象が無いだけなので、記録するだけで再起動しない
  if (!previous) return;

  // eslint-disable-next-line no-console
  console.warn('[arsist] GPUドライバの変更を検出しました → シェーダキャッシュを破棄して再起動します');
  try {
    store.set(GPU_PURGE_PENDING_KEY, true);
  } catch {
    // ignore
  }
  process.env.ARSIST_GPU_CACHE_RESET_DONE = '1';
  try {
    app.relaunch();
  } catch {
    // ignore
  }
  app.exit(0);
}

/**
 * 手動リセット（ヘルプメニュー）。自動検出が効かないケース
 * （キャッシュ破損、指紋が変わらないドライバ更新など）の逃げ道。
 * 削除自体は次回起動時（GPUプロセスがキャッシュを掴む前）に行う。
 */
function resetGpuCacheAndRelaunch(): void {
  try {
    store.set(GPU_PURGE_PENDING_KEY, true);
  } catch {
    // ignore
  }
  try {
    app.relaunch();
  } catch {
    // ignore
  }
  app.exit(0);
}

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
  // ozone-platform-hint の決定:
  //   - ユーザーが明示指定していればそれを尊重
  //   - 純粋なWayland環境ではX11を強制しない（XWaylandが無いとウィンドウ生成に失敗しうる）。
  //     'auto' にしてElectronにセッションを判定させる。
  //   - それ以外（X11/不明）は従来通りX11ヒントで安定側に倒す。
  const ozoneHint =
    process.env.ELECTRON_OZONE_PLATFORM_HINT ||
    (isWaylandSession(process.env) ? 'auto' : 'x11');
  process.env.ELECTRON_OZONE_PLATFORM_HINT = ozoneHint;
  try {
    app.commandLine.appendSwitch('ozone-platform-hint', ozoneHint);
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
  if (isUnityTextureExtension(filePath) || isUnsupportedTextureExtension(filePath)) return 'texture';
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
  const ctx = liveContext(os.homedir());

  // Hub-managed installs: <root>/<version>/Editor/<unityExe>
  const exeRel = getUnityExeRelative(ctx);
  for (const root of getUnitySearchRoots(ctx)) {
    if (!await fs.pathExists(root)) continue;
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const p = path.join(root, ent.name, 'Editor', exeRel);
      if (await fs.pathExists(p)) details.push({ path: path.normalize(p), version: ent.name });
    }
  }

  // Explicit override (UNITY_PATH / ARSIST_UNITY_PATH) + distro/package installs.
  for (const p of getUnityDirectCandidates(ctx)) {
    if (await fs.pathExists(p)) details.push({ path: p });
  }

  // 重複排除 + 新しい順に並べ替え
  const unique = new Map<string, UnityCandidate>();
  for (const d of details) unique.set(d.path, d);
  const arr = Array.from(unique.values());
  arr.sort((a, b) => compareUnityVersionsDesc(a.version, b.version));
  return { candidates: arr.map((d) => d.path), details: arr };
}

// ソフトウェアレンダリングで一度だけ再起動する（GPU初期化失敗時のフォールバック）。
function relaunchWithSoftwareRendering(reason: string): void {
  if (paintFallbackTried) return;
  paintFallbackTried = true;
  // eslint-disable-next-line no-console
  console.warn(`[arsist] GPU描画に失敗した可能性 (${reason}) → ソフトウェアレンダリングで再起動します`);
  // relaunchされる子プロセスは現在のenvを引き継ぐ
  process.env.ARSIST_SOFTWARE_RENDER = '1';
  try {
    app.relaunch();
  } catch {
    // ignore
  }
  app.exit(0);
}

// 画面が真っ白/真っ黒になるのを防ぐため、読み込み失敗時は必ず可視のエラー画面を出す。
function showLoadErrorPage(win: BrowserWindow, message: string): void {
  const safe = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{height:100%;margin:0;background:#1e1e1e;color:#d4d4d4;
      font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
    .box{max-width:640px;padding:32px;text-align:center;line-height:1.6}
    h1{font-size:18px;margin:0 0 12px}
    code{display:block;margin-top:16px;padding:12px;background:#2a2a2a;border-radius:6px;
      font-size:12px;white-space:pre-wrap;text-align:left;color:#ff9e9e}
  </style></head><body><div class="box">
    <h1>Arsist Engine を表示できませんでした / Failed to render UI</h1>
    <div>アプリの読み込みに失敗しました。下記のエラーを確認してください。<br>
    The application failed to load. See the error below.</div>
    <code>${safe}</code>
  </div></body></html>`;
  try {
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    if (!win.isVisible()) win.show();
  } catch {
    // ignore
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'Arsist Engine',
    backgroundColor: '#1a1a2e',
    // 描画準備が整ってから表示（真っ白なフレームのちらつき/ブランク対策）
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    frame: false,
    titleBarStyle: 'hidden',
  });

  const win = mainWindow;
  let shown = false;
  const reveal = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    if (paintWatchdog) {
      clearTimeout(paintWatchdog);
      paintWatchdog = null;
    }
    if (!win.isVisible()) win.show();
  };

  // 通常はこれで表示される
  win.once('ready-to-show', reveal);
  // 実際に描画されたら確実に表示（ready-to-showが来ない環境の保険）
  win.webContents.once('did-finish-load', reveal);

  // Watchdog: 一定時間内に描画されない場合、GPUが原因の可能性が高い。
  //   - まだソフトレンダリングを試していなければ、無効化して自動再起動。
  //   - 既に試済みなら、とにかくウィンドウを表示する（永久ブランク回避）。
  let paintWatchdog: NodeJS.Timeout | null = setTimeout(() => {
    if (shown || win.isDestroyed()) return;
    if (!paintFallbackTried) {
      relaunchWithSoftwareRendering('first-paint-timeout');
    } else {
      reveal();
    }
  }, 10000);

  // 描画/GPUプロセスが落ちた場合のフォールバック
  win.webContents.on('render-process-gone', (_e, details) => {
    // eslint-disable-next-line no-console
    console.error('[arsist] render-process-gone:', details.reason);
    if (!paintFallbackTried && details.reason !== 'clean-exit') {
      relaunchWithSoftwareRendering(`render-process-gone:${details.reason}`);
    }
  });

  // 読み込み失敗（アセット欠落・devサーバ未起動など）→ 可視のエラー画面
  win.webContents.on('did-fail-load', (_e, errorCode, errorDesc, validatedURL) => {
    // -3 (ERR_ABORTED) はリダイレクト等で発生し得るので無視
    if (errorCode === -3) return;
    // eslint-disable-next-line no-console
    console.error(`[arsist] did-fail-load ${errorCode} ${errorDesc} @ ${validatedURL}`);
    showLoadErrorPage(win, `${errorDesc} (${errorCode})\n${validatedURL}`);
  });

  // 開発モードかプロダクションかで読み込みURLを変更
  if (isDev) {
    win.loadURL('http://localhost:5173').catch((err) => {
      showLoadErrorPage(win, `dev server (http://localhost:5173) に接続できません。\n${String(err)}`);
    });
    win.webContents.openDevTools();
  } else {
    // __dirname points to dist/main/main in production; renderer lives at dist/renderer
    const indexPath = path.join(__dirname, '../../renderer/index.html');
    win.loadFile(indexPath).catch((err) => {
      showLoadErrorPage(win, `UI (${indexPath}) を読み込めません。\nnpm run build を実行してください。\n${String(err)}`);
    });
  }

  win.on('closed', () => {
    if (paintWatchdog) {
      clearTimeout(paintWatchdog);
      paintWatchdog = null;
    }
    mainWindow = null;
  });

  // メニューバー設定
  createMenu();
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: mt('menu.file'),
      submenu: [
        { label: mt('menu.newProject'), accelerator: 'CmdOrCtrl+N', click: () => handleNewProject() },
        { label: mt('menu.openProject'), accelerator: 'CmdOrCtrl+O', click: () => handleOpenProject() },
        { type: 'separator' },
        { label: mt('menu.save'), accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save') },
        { label: mt('menu.saveAs'), accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow?.webContents.send('menu:save-as') },
        { type: 'separator' },
        { label: mt('menu.buildSettings'), accelerator: 'CmdOrCtrl+Shift+B', click: () => mainWindow?.webContents.send('menu:build-settings') },
        { label: mt('menu.build'), accelerator: 'CmdOrCtrl+B', click: () => mainWindow?.webContents.send('menu:build') },
        { type: 'separator' },
        { label: mt('menu.settings'), accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.send('menu:settings') },
        { type: 'separator' },
        { label: mt('menu.quit'), accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: mt('menu.edit'),
      submenu: [
        { label: mt('menu.undo'), accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: mt('menu.redo'), accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: mt('menu.cut'), accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: mt('menu.copy'), accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: mt('menu.paste'), accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: mt('menu.delete'), accelerator: 'Delete', click: () => mainWindow?.webContents.send('menu:delete') },
        { type: 'separator' },
        { label: mt('menu.selectAll'), accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: mt('menu.view'),
      submenu: [
        { label: mt('menu.view3d'), accelerator: 'F1', click: () => mainWindow?.webContents.send('menu:view', '3d') },
        { label: mt('menu.view2d'), accelerator: 'F2', click: () => mainWindow?.webContents.send('menu:view', '2d') },
        { label: mt('menu.viewDataflow'), accelerator: 'F3', click: () => mainWindow?.webContents.send('menu:view', 'dataflow') },
        { label: mt('menu.viewScript'), accelerator: 'F4', click: () => mainWindow?.webContents.send('menu:view', 'script') },
        { type: 'separator' },
        { label: mt('menu.devtools'), accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
      ],
    },
    {
      label: mt('menu.help'),
      submenu: [
        { label: mt('menu.docs'), click: () => shell.openExternal('https://arsist.dev/docs') },
        { label: mt('menu.github'), click: () => shell.openExternal('https://github.com/arsist') },
        { type: 'separator' },
        { label: mt('menu.resetGpuCache'), click: () => resetGpuCacheAndRelaunch() },
        { type: 'separator' },
        { label: mt('menu.about'), click: () => showAboutDialog() },
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
      title: mt('dialog.selectProjectFolder'),
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
    detail: mt('about.detail'),
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
ipcMain.handle('app:set-language', async (_, lang: string) => {
  const next: AppLang = lang === 'en' ? 'en' : 'ja';
  try {
    store.set('language' as any, next as any);
  } catch { /* ignore */ }
  // Rebuild the native menu so its labels follow the selected UI language.
  try {
    createMenu();
  } catch { /* ignore */ }
  return { success: true, lang: next };
});

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

  const configuredSdkDir = store.get('sdkDir') as string | undefined;
  if (configuredSdkDir && configuredSdkDir.trim()) {
    unityBuilder.setSdkDir(configuredSdkDir.trim());
  }

  return await unityBuilder.build({
    ...buildConfig,
    unityVersion: buildConfig?.unityVersion || unityVersion,
  });
});

ipcMain.handle('unity:cancel-build', async () => {
  const unityPath = store.get('unityPath') as string;
  if (!unityPath) {
    return { success: false, error: 'Unity path not configured' };
  }

  if (!unityBuilder || unityBuilder.getUnityPath() !== unityPath) {
    unityBuilder = new UnityBuilder(unityPath);
  }

  unityBuilder.cancel();
  return { success: true };
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

ipcMain.handle('sdk:get-dir', async () => {
  return store.get('sdkDir') || '';
});

ipcMain.handle('sdk:set-dir', async (_, sdkDir: string) => {
  store.set('sdkDir', sdkDir);
  return { success: true };
});

function resolveConfiguredSdkDir(): string {
  const configured = store.get('sdkDir') as string | undefined;
  if (configured && configured.trim()) return configured.trim();
  // Packaged app: electron-builder copies sdk/ into resources/
  if (process.resourcesPath) {
    const packed = path.join(process.resourcesPath, 'sdk');
    if (fs.pathExistsSync(packed)) return packed;
  }
  // Dev: source tree relative to cwd or __dirname
  const cwdSdk = path.join(process.cwd(), 'sdk');
  if (fs.pathExistsSync(cwdSdk)) return cwdSdk;
  return path.join(__dirname, '../../..', 'sdk');
}

ipcMain.handle('sdk:xreal-status', async () => {
  try {
    const sdkRoot = resolveConfiguredSdkDir();
    const pkgJsonPath = path.join(sdkRoot, 'com.xreal.xr', 'package', 'package.json');
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
    const questDir = path.join(resolveConfiguredSdkDir(), 'quest');
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

ipcMain.handle('sdk:bundled-deps', async () => {
  try {
    const sdkDir = resolveConfiguredSdkDir();
    const deps: Array<{ name: string; path: string; exists: boolean; description: string }> = [];

    // UniVRM
    const vrmGlob = await fs.readdir(sdkDir).catch(() => [] as string[]);
    const vrmPkg = vrmGlob.find((f) => /^UniVRM.*\.unitypackage$/i.test(f));
    deps.push({
      name: 'UniVRM',
      path: vrmPkg ? path.join(sdkDir, vrmPkg) : path.join(sdkDir, 'UniVRM-*.unitypackage'),
      exists: !!vrmPkg,
      description: 'VRM avatar loading package',
    });

    // JKG-M3 (font)
    const jkgPkg = vrmGlob.find((f) => /^JKG-M3\.unitypackage$/i.test(f));
    deps.push({
      name: 'JKG-M3 (Font)',
      path: jkgPkg ? path.join(sdkDir, jkgPkg) : path.join(sdkDir, 'JKG-M3.unitypackage'),
      exists: !!jkgPkg,
      description: 'Japanese font Unity package',
    });

    // nupkg (Jint scripting)
    const nupkgDir = path.join(sdkDir, 'nupkg');
    const nupkgFiles = await fs.readdir(nupkgDir).catch(() => [] as string[]);
    const jintPkg = nupkgFiles.find((f) => /^jint.*\.nupkg$/i.test(f));
    const esprimaPkg = nupkgFiles.find((f) => /^esprima.*\.nupkg$/i.test(f));
    deps.push({
      name: 'Jint (Scripting Engine)',
      path: jintPkg ? path.join(nupkgDir, jintPkg) : path.join(nupkgDir, 'jint.*.nupkg'),
      exists: !!jintPkg,
      description: 'JavaScript execution engine (.NET)',
    });
    deps.push({
      name: 'Esprima (Parser for Jint)',
      path: esprimaPkg ? path.join(nupkgDir, esprimaPkg) : path.join(nupkgDir, 'esprima.*.nupkg'),
      exists: !!esprimaPkg,
      description: 'JavaScript parser (Jint dependency)',
    });

    return { deps };
  } catch (error) {
    return { deps: [], error: (error as Error).message };
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

    // Unity が取り込めない画像形式はここで断る。
    // 通してしまうとエディタ上は正常に見えるのに、ビルドすると
    // UI.Image が sprite=null のまま「真っ白な四角」になる。
    if (isUnsupportedTextureExtension(sourcePath)) {
      return {
        success: false,
        error:
          `${ext} は Unity が対応していない画像形式のため取り込めません（ビルドすると白い四角になります）。\n` +
          `${ext} is not a texture format Unity can import; it would render as a blank white box in the build.\n` +
          `対応形式 / supported: ${UNITY_TEXTURE_EXTENSIONS.join(', ')}`,
      };
    }

    const kind = params.kind || (
      ['.glb', '.gltf'].includes(ext) ? 'model' :
      isUnityTextureExtension(sourcePath) ? 'texture' :
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

  // GPUドライバが更新されていたらシェーダキャッシュを捨てて1回だけ再起動する。
  // ウィンドウ生成をブロックしないよう await しない。
  void checkGpuDriverChange();

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
