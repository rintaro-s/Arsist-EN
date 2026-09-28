#!/usr/bin/env node
/**
 * 実機の Java ブリッジを、デスクトップの JVM で動かして確かめる。
 * 使い方:  node tools/ort-bridge-check/run.js <onnxruntime.jar> <model.onnx>
 * jar は README の curl で取る (実機と同じ 1.30.0)。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [jar, model] = process.argv.slice(2);
if (!jar || !model) {
  console.error('usage: node tools/ort-bridge-check/run.js <onnxruntime.jar> <model.onnx>');
  process.exit(2);
}
for (const [what, p] of [['onnxruntime jar', jar], ['model', model]]) {
  if (!fs.existsSync(p)) {
    console.error(`${what} not found: ${p}\nSee tools/ort-bridge-check/README.md`);
    process.exit(2);
  }
}

const here = __dirname;
const bridge = path.resolve(here, '../../UnityBackend/ArsistBuilder/Assets/Arsist/Editor/AndroidPlugins/ArsistOnnxRuntime.java.txt');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'arsist-ort-'));
fs.mkdirSync(path.join(work, 'com', 'arsist', 'ort'), { recursive: true });
fs.copyFileSync(bridge, path.join(work, 'com', 'arsist', 'ort', 'ArsistOnnxRuntime.java'));

const sources = [
  path.join(work, 'com', 'arsist', 'ort', 'ArsistOnnxRuntime.java'),
  path.join(here, 'android', 'util', 'Log.java'),
  path.join(here, 'BridgeCheck.java'),
];
const out = path.join(work, 'out');

const compile = spawnSync('javac', ['-nowarn', '-cp', jar, '-d', out, ...sources], { stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);

const run = spawnSync('java', ['-cp', `${jar}:${out}`, 'BridgeCheck', model], { stdio: 'inherit' });
process.exit(run.status ?? 1);
