/**
 * 開発用の Electron 起動係 (npm run dev の 3 本目)。
 *
 * dist/main の変化で Electron を入れ替える。ここで大事なのは**必ず終われること**:
 *   - Electron は npx 経由ではなく**実体を直接**起こす。`shell: true` で起こすと
 *     子は sh になり、kill してもその下の Electron が生き残る (端末を閉じるしか
 *     止められないアプリになっていた)。
 *   - 自分のプロセスグループで起こし、止めるときはグループごと落とす
 *     (Electron は GPU / renderer の子プロセスを持つ)。
 *   - SIGTERM で聞かなければ、少し待って SIGKILL。
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import chokidar from 'chokidar';

const electronPath = (await import('electron')).default;

let child = null;
let restarting = false;
let restartTimer = null;

function start() {
  const env = { ...process.env, NODE_ENV: 'development' };
  child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env,
    shell: false,
    // 自分のグループの長にする (Windows にグループは無いので付けない)
    detached: process.platform !== 'win32',
  });

  child.on('exit', (code) => {
    if (!restarting) {
      // Electron が手動で閉じられた等
      process.exit(code ?? 0);
    }
  });
}

/** Electron を子ごと止める。force なら SIGKILL。 */
function stop(force = false) {
  const target = child;
  if (!target) return;
  child = null;

  const pid = target.pid;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return;
    }
    // 負の pid = プロセスグループ全体 (Electron の GPU / renderer も一緒に)
    process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    try {
      target.kill(force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      // すでに終わっている
    }
  }

  if (force) return;
  // 聞かない相手にはとどめを刺す
  const timer = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }, 1500);
  timer.unref?.();
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

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    restarting = true; // 子の exit で二重に終了処理をしない
    stop();
    // Electron 側の後始末 (Unity ビルド等の停止) を少しだけ待ってから自分も終わる
    setTimeout(() => {
      stop(true);
      process.exit(0);
    }, 800).unref?.();
  });
}

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
