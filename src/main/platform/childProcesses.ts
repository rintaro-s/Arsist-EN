/**
 * 外に出したプロセスの後始末。
 *
 * エディタが動かす仕事の多く (Unity のビルド、MCP サーバー、dotnet のツール、adb) は別プロセスで、
 * ウィンドウを閉じても**そのまま走り続ける**。Unity のビルドは Gradle / Java をさらに起動するので、
 * 親だけ kill しても子が残り、閉じたはずのアプリのせいでマシンが重いままになる。
 *
 * そこで、起こしたプロセスをここに登録しておき、終了時にまとめて止める。
 *   Linux / macOS : detached: true で起こしたものはプロセスグループの長になるので、
 *                   `process.kill(-pid)` で子孫ごと止められる。
 *   Windows       : シグナルが無いので taskkill /T /F で木ごと止める。
 * 止まらないものが残らないよう、少し待ってから強制終了も撃つ。
 */
import { spawn, ChildProcess, SpawnOptions } from 'child_process';

interface Tracked {
  child: ChildProcess;
  /** ログに出す名前 (「何が残っているか」が分かるように) */
  label: string;
  /** detached: true で起こしたか。プロセスグループごと止められる */
  group: boolean;
}

const tracked = new Map<number, Tracked>();

/**
 * 長く走るプロセスの既定。グループごと止められるようにする。
 * 渡した型をそのまま返すので、spawn の戻り値の型 (stdout が null かどうか) は変わらない。
 */
export function longRunningOptions<T extends SpawnOptions>(options: T = {} as T): T & { detached: boolean } {
  return {
    ...options,
    // Windows の detached は「別のコンソールを開く」意味になってしまうので付けない
    // (Windows では taskkill /T で木ごと止める)。
    detached: process.platform !== 'win32',
  };
}

/** 起こしたプロセスを覚えておく。終了したら自動で外れる。 */
export function trackChild<T extends ChildProcess>(child: T, label: string, group = false): T {
  const pid = child.pid;
  if (pid == null) return child;

  tracked.set(pid, { child, label, group });
  const forget = () => { tracked.delete(pid); };
  child.once('exit', forget);
  child.once('close', forget);
  child.once('error', forget);
  return child;
}

/** 覚えているプロセスの数 (「まだ何か動いている」の判断に使う)。 */
export function trackedCount(): number {
  return tracked.size;
}

export function trackedLabels(): string[] {
  return Array.from(tracked.values(), (t) => t.label);
}

/** 1 つのプロセスを、子孫ごと止める。 */
export function killTree(pid: number, group: boolean, force = false): void {
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  try {
    if (process.platform === 'win32') {
      // /T: 子孫も /F: 強制。SIGTERM 相当が無いので最初から木ごと落とす。
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return;
    }
    if (group) {
      // 負の pid = プロセスグループ全体 (Unity が起こした Gradle / Java もここで止まる)
      process.kill(-pid, signal);
      return;
    }
    process.kill(pid, signal);
  } catch {
    // すでに終わっている場合など。残骸が無ければそれでよい。
  }
}

/**
 * 覚えているプロセスを全部止める。終了時に呼ぶ。
 * まず SIGTERM、それでも残っていれば SIGKILL。待ち時間はアプリの終了を止めない程度にする。
 */
export function killAllChildren(log: (message: string) => void = () => {}): void {
  if (tracked.size === 0) return;

  const entries = Array.from(tracked.entries());
  log(`[Arsist] Stopping ${entries.length} background process(es): ${entries.map(([, t]) => t.label).join(', ')}`);

  for (const [pid, t] of entries) {
    killTree(pid, t.group);
  }

  // 聞かない相手に、少しだけ猶予を置いてとどめを刺す。
  setTimeout(() => {
    for (const [pid, t] of entries) {
      if (!tracked.has(pid)) continue;
      log(`[Arsist] Force-stopping '${t.label}' (pid ${pid})`);
      killTree(pid, t.group, true);
    }
  }, 1500).unref?.();
}
