#!/usr/bin/env node
/**
 * エディタを実際に起動し、CDP 越しに操作して画面を撮る。
 *
 * 型が通ってもレンダラーは実行時に落ちる（null 参照、R3F のサスペンド、
 * 存在しないストア関数など）。実際に開いて操作しないと分からない壊れ方が多いので、
 * ここでは「実ユーザーと同じ DOM 操作」だけを使い、アプリ側には一切細工しない。
 *
 *   node tools/editor-smoke/smoke.mjs <projectName> [outDir]
 *
 * projectName は最近開いたプロジェクト一覧に出る名前。事前に一度開いておくこと。
 * 出力: 各手順の PNG と innerText、コンソールエラーの一覧。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const projectName = process.argv[2];
const outDir = process.argv[3] || path.join(repoRoot, 'tools', 'editor-smoke', 'out');

if (!projectName) {
  console.error('usage: node tools/editor-smoke/smoke.mjs <projectName> [outDir]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const PORT = 9333;
const child = spawn('npx', ['electron', '.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], {
  cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
});
let appLog = '';
child.stdout.on('data', (d) => { appLog += d; });
child.stderr.on('data', (d) => { appLog += d; });

async function findTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.startsWith('devtools'));
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('CDP target not found\n' + appLog.slice(-3000));
}

const target = await findTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let nextId = 0;
const pending = new Map();
const consoleErrors = [];

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(message.params?.exceptionDetails?.exception?.description
      ?? message.params?.exceptionDetails?.text ?? 'unknown exception');
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  }
};

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};

const shot = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, name), Buffer.from(result.data, 'base64'));
};

/** 画面上のテキストで要素を探して押す。クラス名ではなく見えている文字で探すのは、実ユーザーと同じにするため。 */
const clickByText = (text, container = 'tree-item') => evaluate(`
  (() => {
    const els = Array.from(document.querySelectorAll('*'))
      .filter(e => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(text)});
    if (!els.length) return 'not-found';
    let el = els[0];
    for (let i = 0; i < 6 && el; i++) {
      if (el.className && String(el.className).includes(${JSON.stringify(container)})) break;
      if (el.onclick || el.tagName === 'BUTTON') break;
      el = el.parentElement;
    }
    (el || els[0]).click();
    return 'clicked';
  })()
`);

await send('Runtime.enable');
await send('Page.enable');
await sleep(3000);
await shot('01-welcome.png');

console.log('open project:', await clickByText(projectName, 'card'));
await sleep(6000);
await shot('02-scene.png');

const summary = await evaluate(`
  (() => {
    const text = document.body.innerText;
    return JSON.stringify({
      title: document.title,
      hasImageAnchors: text.includes('画像アンカー') || text.includes('Image Anchors'),
      hasTasks: text.includes('画像認識タスク') || text.includes('Recognition tasks'),
      canvases: document.querySelectorAll('canvas').length,
    });
  })()
`);
console.log('after open:', summary);

// 左パネルに並ぶものを順に選び、各インスペクタが落ちずに描けることを見る
const items = await evaluate(`
  JSON.stringify(Array.from(document.querySelectorAll('.tree-item'))
    .map(e => e.textContent.trim()).filter(Boolean))
`);
const names = JSON.parse(items || '[]');
console.log('tree items:', names.join(', '));

let index = 3;
for (const name of names) {
  const clicked = await clickByText(name);
  await sleep(1000);
  const file = `${String(index).padStart(2, '0')}-${name.replace(/[^\w-]/g, '_')}`;
  await shot(`${file}.png`);
  fs.writeFileSync(path.join(outDir, `${file}.txt`), await evaluate('document.body.innerText'));
  console.log(`select "${name}":`, clicked);
  index++;
}

fs.writeFileSync(path.join(outDir, 'applog.txt'), appLog);
console.log('CONSOLE ERRORS:', consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 12), null, 2) : 'none');
console.log('output:', outDir);

child.kill('SIGTERM');
await sleep(500);
process.exit(consoleErrors.length > 0 ? 1 : 0);
