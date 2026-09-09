#!/usr/bin/env node
/**
 * ML Kit bundled OCR スパイクのビルド (tools/mlkit-spike/)。
 *
 * Arsist 本体のビルドパイプラインは通さない。スパイクの目的は
 * 「Play Services の無い Quest 3 で bundled ML Kit が動くか」だけなので、
 * Unity を直接叩いて最小 APK を作る。詳細は tools/mlkit-spike/README.md。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getConfigStorePath } = require('./lib/config-path');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectPath = path.join(repoRoot, 'tools', 'mlkit-spike');
const outputPath = path.join(projectPath, 'Build', 'MlkitOcrSpike.apk');
const logPath = path.join(projectPath, 'Build', 'build.log');

function resolveUnity() {
  if (process.env.ARSIST_UNITY_PATH) return process.env.ARSIST_UNITY_PATH;
  try {
    const store = JSON.parse(fs.readFileSync(getConfigStorePath('arsist-engine'), 'utf8'));
    if (store.unityPath) return store.unityPath;
  } catch { /* not configured yet */ }
  return null;
}

const unity = resolveUnity();
if (!unity) {
  console.error('Unity not found. Set ARSIST_UNITY_PATH, or configure it once in the Arsist editor.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

// 前回が異常終了していると残り、"another Unity instance is running" で落ちる
const lockFile = path.join(projectPath, 'Temp', 'UnityLockfile');
if (fs.existsSync(lockFile)) fs.rmSync(lockFile, { force: true });

const args = [
  '-batchmode', '-quit', '-nographics',
  '-projectPath', projectPath,
  '-buildTarget', 'Android',
  '-executeMethod', 'SpikeBuild.BuildFromCLI',
  '-arsistOutput', outputPath,
  '-logFile', logPath,
];

console.log(`[spike] ${unity} ${args.join(' ')}`);
console.log('[spike] first run downloads the ML Kit artifacts (~20 MB) and takes a few minutes.');

const child = spawn(unity, args, { stdio: 'inherit' });
child.on('exit', (code) => {
  if (code === 0 && fs.existsSync(outputPath)) {
    const size = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(1);
    console.log(`\n[spike] built ${outputPath} (${size} MB)`);
    console.log('[spike] next: adb install -r ' + path.relative(repoRoot, outputPath));
    console.log('[spike] see tools/mlkit-spike/README.md for what a pass looks like');
  } else {
    console.error(`\n[spike] build failed (exit ${code}). Log: ${logPath}`);
    process.exit(code || 1);
  }
});
