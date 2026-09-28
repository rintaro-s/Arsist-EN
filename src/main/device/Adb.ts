/**
 * 端末への配布 (adb)。
 *
 * ビルド画面の「ビルドしてインストール」から使う。やることは 2 つだけ:
 *   つながっている端末を並べる (`adb devices -l`)
 *   ビルドした APK を入れる (`adb -s <端末> install -r <apk>`)
 *
 * adb は Unity が同梱している Android SDK のものを優先して使う (別途入れなくてよい)。
 * 見つからなければ環境変数の SDK、最後に PATH。
 *
 * ここでするのは「並べる」と「このアプリを入れる」だけ。端末の他の状態には触らない。
 */
import * as os from 'os';
import * as fs from 'fs-extra';
import { spawn } from 'child_process';
import { trackChild } from '../platform/childProcesses';
import { getAdbCandidates, liveContext } from '../platform/paths';

export interface AdbDevice {
  serial: string;
  /** 'device' なら使える。'unauthorized' は端末側で許可待ち、'offline' は応答なし */
  state: string;
  /** 機種名 (adb が返せば)。Quest 3 なら "eureka" のような開発名のこともある */
  model?: string;
  /** 画面に出す名前 */
  label: string;
}

export interface AdbResult {
  success: boolean;
  error?: string;
  /** adb が見つからないときだけ true (入れ方を案内する) */
  adbMissing?: boolean;
}

let cachedAdb: string | null = null;

/** adb の場所。無ければ null。 */
export async function findAdb(unityPath?: string | null): Promise<string | null> {
  if (cachedAdb && (await fs.pathExists(cachedAdb))) return cachedAdb;
  for (const candidate of getAdbCandidates(liveContext(os.homedir()), unityPath ?? null)) {
    try {
      if (await fs.pathExists(candidate)) {
        cachedAdb = candidate;
        return candidate;
      }
    } catch {
      // 読めない場所は飛ばす
    }
  }
  cachedAdb = null;
  return null;
}

function run(
  command: string,
  args: string[],
  onLine?: (line: string) => void,
  timeoutMs = 0,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = trackChild(spawn(command, args), `adb ${args[0] ?? ''}`.trim());
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | null = null;
    if (timeoutMs > 0) timer = setTimeout(() => child.kill(), timeoutMs);

    const feed = (chunk: Buffer, into: 'out' | 'err') => {
      const text = String(chunk);
      if (into === 'out') stdout += text;
      else stderr += text;
      if (!onLine) return;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) onLine(line.trim());
      }
    };

    child.stdout.on('data', (chunk) => feed(chunk, 'out'));
    child.stderr.on('data', (chunk) => feed(chunk, 'err'));
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(e) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** `adb devices -l` の 1 行を読む。 */
export function parseDeviceLine(line: string): AdbDevice | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('List of devices')) return null;
  if (trimmed.startsWith('*') || trimmed.startsWith('adb server')) return null;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return null;
  const [serial, state, ...rest] = parts;

  const fields = new Map<string, string>();
  for (const item of rest) {
    const at = item.indexOf(':');
    if (at > 0) fields.set(item.slice(0, at), item.slice(at + 1));
  }
  const model = fields.get('model')?.replace(/_/g, ' ');
  const device = fields.get('device');
  const label = model || device || serial;

  return { serial, state, model, label: model ? `${label} (${serial})` : serial };
}

/** つながっている端末。adb が無ければ adbMissing。 */
export async function listDevices(unityPath?: string | null): Promise<AdbResult & { devices: AdbDevice[]; adbPath?: string }> {
  const adb = await findAdb(unityPath);
  if (!adb) return { success: false, adbMissing: true, error: 'adbNotFound', devices: [] };

  const result = await run(adb, ['devices', '-l'], undefined, 15000);
  if (result.code !== 0) {
    return { success: false, error: (result.stderr || result.stdout).trim() || `adb exited ${result.code}`, devices: [], adbPath: adb };
  }

  const devices: AdbDevice[] = [];
  for (const line of result.stdout.split(/\r?\n/).slice(1)) {
    const device = parseDeviceLine(line);
    if (device) devices.push(device);
  }
  return { success: true, devices, adbPath: adb };
}

/**
 * APK を入れる (上書き)。入れるのはこのプロジェクトがビルドしたものだけ。
 * 端末が 1 台でも serial を必ず指定する (別の端末に入れてしまわないように)。
 */
export async function installApk(
  serial: string,
  apkPath: string,
  unityPath: string | null | undefined,
  onLine: (line: string) => void,
): Promise<AdbResult> {
  const adb = await findAdb(unityPath);
  if (!adb) return { success: false, adbMissing: true, error: 'adbNotFound' };
  if (!serial) return { success: false, error: 'noDeviceSelected' };
  if (!(await fs.pathExists(apkPath))) return { success: false, error: 'apkMissing' };

  // -r: 同じアプリが入っていれば置き換える / -d: 版が下がる場合も許す (開発中はよくある)
  const result = await run(adb, ['-s', serial, 'install', '-r', '-d', apkPath], onLine);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.code === 0 && /Success/i.test(output)) return { success: true };

  const failure = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-3).join(' ');
  return { success: false, error: failure || `adb exited ${result.code}` };
}
