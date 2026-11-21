/**
 * プレビュー シミュレータの Electron 側 (scripts/sim/preview.mjs が起動する。直接は使わない)。
 *
 *   electron scripts/sim/electron-main.cjs <plan.json>
 *
 * plan.json: { simHtml, width, height, resultPath, jobs: [{ file, job }] }
 * 見えない窓で sim.html を開き、job ごとに window.__arsistSim.render(job) → 描き終わったら capturePage → PNG。
 * 結果 (job ごとの情報・失敗) を resultPath に書いて終わる。エディタの main や設定 (electron-store) は使わない。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const planPath = process.argv.find((a) => a.endsWith('.json') && fs.existsSync(a));
if (!planPath) {
  console.error('[sim] usage: electron electron-main.cjs <plan.json>');
  process.exit(2);
}
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

// 画素はそのまま (HiDPI の倍率を掛けない)。GPU が無い環境でも WebGL を描けるようにする
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.disableDomainBlockingFor3DAPIs();

function log(...args) {
  if (process.env.ARSIST_SIM_DEBUG) console.error('[sim]', ...args);
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms); }),
  ]);
}

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: plan.width,
    height: plan.height,
    useContentSize: true,
    frame: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#000000',
    webPreferences: {
      // offscreen の方が速い (見えない普通の窓は requestAnimationFrame が間引かれて 1 枚 6 秒かかった)
      offscreen: process.env.ARSIST_SIM_OFFSCREEN !== '0',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      // プロジェクトのファイル (VRM) を file:// で読む。外のページは開かない
      webSecurity: false,
    },
  });
  win.setContentSize(plan.width, plan.height);
  const consoleLines = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleLines.push(message);
    log('console', level, message);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    consoleLines.push(`renderer gone: ${details.reason}`);
  });

  const results = { frames: [], errors: [], console: consoleLines };
  try {
    await withTimeout(win.loadURL(pathToFileURL(plan.simHtml).href), 30000, 'loading sim.html');
    await withTimeout((async () => {
      for (let i = 0; i < 200; i++) {
        if (await win.webContents.executeJavaScript('!!window.__arsistSimBoot')) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('sim page did not start (see console)');
    })(), 15000, 'starting the sim page');

    for (const { file, job } of plan.jobs) {
      const started = Date.now();
      try {
        const info = await withTimeout(
          win.webContents.executeJavaScript(`window.__arsistSim.render(${JSON.stringify(job)})`),
          plan.frameTimeoutMs ?? 45000,
          `rendering ${path.basename(file)}`,
        );
        if (info && info.error) {
          results.errors.push({ file, error: info.error });
          continue;
        }
        if (process.env.ARSIST_SIM_DUMP) {
          fs.writeFileSync(file.replace(/\.png$/, '.html'), await win.webContents.executeJavaScript('document.body.outerHTML'));
        }
        const image = await win.webContents.capturePage();
        const png = image.toPNG();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, png);
        const size = image.getSize();
        results.frames.push({ file, info, ms: Date.now() - started, size });
        log('wrote', file, size, Date.now() - started, 'ms');
      } catch (e) {
        results.errors.push({ file, error: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e) {
    results.errors.push({ file: null, error: e instanceof Error ? e.message : String(e) });
  }
  fs.writeFileSync(plan.resultPath, JSON.stringify(results));
  win.destroy();
  app.quit();
}

app.on('window-all-closed', () => {});
main().catch((e) => {
  try { fs.writeFileSync(plan.resultPath, JSON.stringify({ frames: [], errors: [{ file: null, error: String(e && e.stack || e) }] })); } catch { /* ignore */ }
  app.exit(1);
});
