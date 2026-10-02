#!/usr/bin/env node
/**
 * 拡張機能の配布と、エンジンの改変を作るためのコマンド。エディタと同じ処理 (dist/main) を使う。
 * 先に `npm run build:main` が要る。
 *
 *   npm run ext:pack -- <拡張機能のフォルダ> [出力.arsist]
 *       .arsist にまとめる (全ファイルの SHA-256 入り)。
 *
 *   npm run ext:install -- <file.arsist | フォルダ> [--force]
 *       ユーザーの拡張機能フォルダ (<ユーザーデータ>/extensions) に入れる。エディタの「インポート」と同じ。
 *       同じ id が入っていれば止まる (--force で入れ替え)。
 *
 *   npm run ext:override -- <拡張機能のフォルダ> <Assets/Arsist からのパス> [--reset]
 *       エンジンのファイルを改変する準備。エンジンの元ファイルを Overrides/<パス> に写し、
 *       extension.json の unity.overrides にパスと元の SHA-256 (replaces) を書く。あとは写しを編集する。
 *       既に写しがあるときは replaces だけを今のエンジンに合わせる (エンジンを更新したあと、
 *       自分の変更を新しい元ファイルに当て直してから実行する)。--reset で写しも元に戻す。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(ROOT, 'UnityBackend', 'ArsistBuilder', 'Assets', 'Arsist');

function fail(message) {
  console.error(`ext: ${message}`);
  process.exit(1);
}

function dist(rel) {
  const file = path.join(ROOT, 'dist', 'main', ...rel.split('/'));
  if (!fs.existsSync(`${file}.js`)) fail(`${rel}.js not found — run "npm run build:main" first`);
  return require(file);
}

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));

async function pack() {
  const [dir, out] = args;
  if (!dir) fail('usage: npm run ext:pack -- <extension folder> [out.arsist]');
  const { packExtension } = dist('main/extensions/packages');
  const result = await packExtension(path.resolve(dir), out ? path.resolve(out) : undefined);
  console.log(`${result.file}`);
  console.log(`  ${result.manifest.id} ${result.manifest.version}: ${result.files} files, ${(result.bytes / 1024).toFixed(1)} KB`);
}

async function install() {
  const [source] = args;
  if (!source) fail('usage: npm run ext:install -- <file.arsist | folder> [--force]');
  const { getConfigStorePath } = require(path.join(ROOT, 'scripts', 'lib', 'config-path'));
  const userDir = path.join(path.dirname(getConfigStorePath('arsist-engine')), 'extensions');
  const { installExtension } = dist('main/extensions/packages');
  const result = await installExtension(path.resolve(source), userDir, { force: flags.has('--force') });
  if (result.ok) {
    console.log(`installed ${result.id} ${result.version}${result.replaced ? ` (replaced ${result.replaced})` : ''}`);
    console.log(`  ${result.path}`);
    return;
  }
  if (result.needsConfirm) {
    const c = result.needsConfirm;
    fail(`${c.id} ${c.installed} is already installed; this is ${c.incoming}${c.downgrade ? ' (older)' : ''}. Add --force to replace it.`);
  }
  fail(`${result.error}${result.problems ? `\n- ${result.problems.join('\n- ')}` : ''}`);
}

function override() {
  const [dir, rel] = args;
  if (!dir || !rel) fail('usage: npm run ext:override -- <extension folder> <path under Assets/Arsist> [--reset]');
  const extDir = path.resolve(dir);
  const manifestFile = path.join(extDir, 'extension.json');
  if (!fs.existsSync(manifestFile)) fail(`${extDir} has no extension.json`);
  const clean = rel.replace(/\\/g, '/').replace(/^(UnityBackend\/ArsistBuilder\/)?(Assets\/)?Arsist\//, '');
  if (clean.split('/').includes('..')) fail('the path must stay inside Assets/Arsist');

  const original = path.join(ENGINE, ...clean.split('/'));
  const copy = path.join(extDir, 'Overrides', ...clean.split('/'));
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.unity ??= {};
  manifest.unity.overrides ??= [];
  let entry = manifest.unity.overrides.find((o) => o.path === clean);
  if (!entry) { entry = { path: clean }; manifest.unity.overrides.push(entry); }

  if (fs.existsSync(original)) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(original)).digest('hex');
    if (!fs.existsSync(copy) || flags.has('--reset')) {
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(original, copy);
      console.log(`copied the engine's ${clean} to Overrides/${clean} — edit that copy`);
    } else if (entry.replaces && entry.replaces !== hash) {
      console.log(`the engine's ${clean} changed since this override was made; make sure your edits in Overrides/${clean} still fit the new file`);
    }
    entry.replaces = hash;
  } else {
    // エンジンに無いファイルを足す
    delete entry.replaces;
    if (!fs.existsSync(copy)) {
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.writeFileSync(copy, '');
      console.log(`Assets/Arsist/${clean} does not exist in the engine; created an empty Overrides/${clean} to add it`);
    }
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`extension.json: unity.overrides ← ${clean}${entry.replaces ? ` (replaces ${entry.replaces.slice(0, 12)}…)` : ' (new file)'}`);
}

switch (command) {
  case 'pack': await pack(); break;
  case 'install': await install(); break;
  case 'override': override(); break;
  default: fail('commands: pack | install | override  (npm run ext:pack / ext:install / ext:override)');
}
