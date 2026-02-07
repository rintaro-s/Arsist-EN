import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import chokidar from 'chokidar';

let child = null;
let restarting = false;
let restartTimer = null;

function start() {
  const env = { ...process.env, NODE_ENV: 'development' };
  child = spawn('npx', ['electron', '.'], {
    stdio: 'inherit',
    env,
    shell: true,
  });

  child.on('exit', (code, signal) => {
    if (!restarting) {
      // Electronが手動で閉じられた等
      process.exit(code ?? 0);
    }
  });
}

function stop() {
  if (!child) return;
  try {
    // Windows: シグナルが使えないため通常のkill()を使用
    if (process.platform === 'win32') {
      child.kill();
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // ignore
  }
  child = null;
}

function restart(reason = '') {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restarting = true;
    if (reason) {
      // eslint-disable-next-line no-console
      console.log(`[dev-electron] restart: ${reason}`);
    }
    stop();
    start();
    restarting = false;
  }, 200);
}

process.on('SIGINT', () => {
  stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});

// dist/main の変更でElectronを再起動（preload含む）
const watchPath = new URL('../dist/main', import.meta.url).pathname;
const watcher = chokidar.watch(watchPath, {
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 150,
    pollInterval: 50,
  },
});

watcher.on('add', (p) => restart(`add ${p}`));
watcher.on('change', (p) => restart(`change ${p}`));
watcher.on('unlink', (p) => restart(`unlink ${p}`));

start();
