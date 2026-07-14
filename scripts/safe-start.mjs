import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

const isLinux = process.platform === 'linux';
const isWindows = process.platform === 'win32';
const safeMode = process.env.ARSIST_SAFE_MODE === '1' || process.env.ARSIST_SAFE_MODE === 'true';

function setupLinuxEnv(env) {
  if (!isLinux) return env;

  const home = os.homedir();

  // 安全な Fontconfig 設定を用意する（壊れたシステム設定を回避）
  const safeConfigDir = path.join(home, '.config', 'Arsist', 'fontconfig');
  if (!existsSync(safeConfigDir)) {
    mkdirSync(safeConfigDir, { recursive: true });
  }
  const safeFontsConf = path.join(safeConfigDir, 'fonts.conf');
  if (!existsSync(safeFontsConf)) {
    const fontsConf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/usr/share/fonts</dir>
  <dir>/usr/local/share/fonts</dir>
  <dir>~/.fonts</dir>
  <dir>~/.local/share/fonts</dir>
  <cachedir>~/.cache/fontconfig</cachedir>
  <config>
    <rescan>0</rescan>
  </config>
</fontconfig>
`;
    writeFileSync(safeFontsConf, fontsConf, 'utf-8');
  }
  if (!env.FONTCONFIG_PATH) {
    env.FONTCONFIG_PATH = safeConfigDir;
  }

  // GTK settings.ini が空/壊れている場合は修復
  try {
    const gtkDir = path.join(home, '.config', 'gtk-3.0');
    const settingsPath = path.join(gtkDir, 'settings.ini');
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, 'utf-8').trim();
      if (content && !content.startsWith('[')) {
        const backup = `${settingsPath}.bak-${Date.now()}`;
        renameSync(settingsPath, backup);
        writeFileSync(settingsPath, '[Settings]\n', 'utf-8');
      }
    } else {
      if (!existsSync(gtkDir)) mkdirSync(gtkDir, { recursive: true });
      writeFileSync(settingsPath, '[Settings]\n', 'utf-8');
    }
  } catch {
    // ignore
  }

  // Portal を優先して GTK ダイアログを安定化
  env.ELECTRON_USE_XDG_DESKTOP_PORTAL = env.ELECTRON_USE_XDG_DESKTOP_PORTAL || '1';
  env.GTK_USE_PORTAL = env.GTK_USE_PORTAL || '1';
  env.ELECTRON_OZONE_PLATFORM_HINT = env.ELECTRON_OZONE_PLATFORM_HINT || 'x11';

  // 周辺でよく使われるトラブル回避変数
  env.VULKAN_DISABLE = env.VULKAN_DISABLE || '1';

  return env;
}

function buildBaseArgs() {
  const args = process.argv.slice(2).length ? process.argv.slice(2) : ['.'];
  if (safeMode) {
    return ['--no-sandbox', '--disable-gpu', ...args];
  }
  return args;
}

function isKnownHarmlessWarning(line) {
  return [
    /^Fontconfig warning:/,
    /^\(electron:[\d]+\): Gtk-WARNING/,
    /Gtk-WARNING.*settings\.ini/,
    /Failed to parse.*settings\.ini/,
  ].some((p) => p.test(line));
}

function startElectron() {
  const env = { ...process.env };
  // ELECTRON_RUN_AS_NODE が設定されていると Electron 組み込みモジュールが使えなくなるため外す
  delete env.ELECTRON_RUN_AS_NODE;

  if (isLinux) setupLinuxEnv(env);

  const electronModule = isWindows ? 'electron.cmd' : 'electron';
  const electronBin = path.join(process.cwd(), 'node_modules', '.bin', electronModule);

  const args = buildBaseArgs();

  const child = spawn(electronBin, args, {
    env,
    stdio: ['inherit', 'inherit', 'pipe'],
    shell: false,
  });

  let buffer = '';
  child.stderr?.on('data', (data) => {
    buffer += data.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!isKnownHarmlessWarning(line)) {
        process.stderr.write(`${line}\n`);
      }
    }
  });

  child.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[safe-start] Failed to start electron:', err.message);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (buffer) {
      if (!isKnownHarmlessWarning(buffer)) process.stderr.write(`${buffer}\n`);
    }
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

startElectron();
