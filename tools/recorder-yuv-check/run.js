#!/usr/bin/env node
/**
 * quest-input の録画の色変換 (ArsistYuv.java) を、デスクトップの JVM で確かめる。
 * 使い方:  node tools/recorder-yuv-check/run.js
 * javac / java は JAVA_HOME か PATH から。無ければ Unity 同梱の OpenJDK
 * (<Unity>/Editor/Data/PlaybackEngines/AndroidPlayer/OpenJDK) を JAVA_HOME に指定する。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const here = __dirname;
const source = path.resolve(here, '../../samples/extensions/quest-input/Runtime/Android/ArsistYuv.java');
const bin = (name) => (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'arsist-yuv-'));
const out = path.join(work, 'out');
const compile = spawnSync(bin('javac'), ['-nowarn', '-d', out, source, path.join(here, 'YuvCheck.java')], { stdio: 'inherit' });
if (compile.error) {
  console.error(`javac not found (${compile.error.message}). Set JAVA_HOME, e.g. to Unity's AndroidPlayer/OpenJDK.`);
  process.exit(2);
}
if (compile.status !== 0) process.exit(compile.status ?? 1);

const run = spawnSync(bin('java'), ['-cp', out, 'YuvCheck'], { stdio: 'inherit' });
fs.rmSync(work, { recursive: true, force: true });
process.exit(run.status ?? 1);
