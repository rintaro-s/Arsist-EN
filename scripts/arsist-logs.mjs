#!/usr/bin/env node
/**
 * 実機アプリのログを LAN で受け取る。
 *
 *   npm run logs                    ずっと流す (Ctrl-C で止める)
 *   npm run logs -- --for 20        20秒だけ受けて終了   ← エージェント向け
 *   npm run logs -- --grep Arsist   一致する行だけ
 *   npm run logs -- --level error   error 以上だけ
 *   npm run logs -- --json          受け取った JSON をそのまま
 *
 * 送り側は APK に焼き込まれた ArsistLogRelay。宛先はビルドしたマシンなので、
 * 自分がビルドした APK のログだけが勝手に届く。ペアリング操作は要らない。
 *
 * adb は不要。ヘッドセットを装着したまま、ケーブルを抜いたままで読める。
 */
import dgram from 'node:dgram';

const args = process.argv.slice(2);
const readOption = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const hasFlag = (name) => args.includes(name);

const port = Number(readOption('--port', process.env.ARSIST_LOG_PORT || '9770'));
const grep = readOption('--grep');
const levelFilter = readOption('--level');
const seconds = Number(readOption('--for', '0'));
const asJson = hasFlag('--json');
const quiet = hasFlag('--quiet');

const LEVEL_ORDER = { info: 0, warn: 1, error: 2 };
const minLevel = levelFilter ? (LEVEL_ORDER[levelFilter] ?? 0) : 0;
const grepRegex = grep ? new RegExp(grep, 'i') : null;

const COLOR = { info: '\x1b[0m', warn: '\x1b[33m', error: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m' };
const colorize = (text, color) => (process.stdout.isTTY ? color + text + COLOR.reset : text);

const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
let received = 0;
const seenApps = new Set();

socket.on('message', (buffer, remote) => {
  let entry;
  try {
    entry = JSON.parse(buffer.toString('utf8'));
  } catch {
    return; // このポートに流れてくる他人のパケットは黙って捨てる
  }
  if (entry.token !== 'arsist') return;

  if ((LEVEL_ORDER[entry.level] ?? 0) < minLevel) return;
  if (grepRegex && !grepRegex.test(entry.msg ?? '')) return;

  received++;

  if (!seenApps.has(entry.app) && !quiet) {
    seenApps.add(entry.app);
    console.error(colorize(`[logs] ${entry.app} @ ${remote.address}`, COLOR.dim));
  }

  if (asJson) {
    console.log(JSON.stringify(entry));
    return;
  }

  const time = new Date(entry.t ?? Date.now()).toISOString().slice(11, 23);
  const level = (entry.level ?? 'info').toUpperCase().padEnd(5);
  console.log(colorize(`${time} ${level} ${entry.msg}`, COLOR[entry.level] ?? COLOR.info));

  if (entry.stack) {
    console.log(colorize(entry.stack.split('\n').map((l) => '        ' + l).join('\n'), COLOR.dim));
  }
  if (entry.dropped) {
    console.log(colorize(`        (${entry.dropped} 件が溢れて捨てられました)`, COLOR.dim));
  }
});

socket.on('error', (error) => {
  console.error(`[logs] socket error: ${error.message}`);
  process.exit(1);
});

socket.bind(port, () => {
  if (!quiet) {
    console.error(colorize(`[logs] listening on udp/${port}`, COLOR.dim));
    console.error(colorize('[logs] launch the app on the headset; no adb needed', COLOR.dim));
  }
});

if (seconds > 0) {
  setTimeout(() => {
    if (!quiet) console.error(colorize(`[logs] ${seconds}s elapsed, ${received} line(s)`, COLOR.dim));
    socket.close();
    // 何も来なかったのは「アプリが起動していない」か「LANが違う」。区別できるよう終了コードを変える
    process.exit(received > 0 ? 0 : 2);
  }, seconds * 1000);
}

process.on('SIGINT', () => {
  socket.close();
  process.exit(0);
});
