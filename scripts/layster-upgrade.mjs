#!/usr/bin/env node
/**
 * Layster.Virtual のプロジェクト (project.json) を今の版にアップグレードする。doc/19-layster.md §1。
 *
 *   node scripts/layster-upgrade.mjs <プロジェクトのフォルダ>... [--dry-run]
 *
 * エディタで「アップグレードして保存」を選んだときと同じ移行 (src/main/project/migrations.ts の migrateProject) を掛ける:
 *   - 書き換える前に、元の project.json を <フォルダ>/Backups/project.<版>.<時刻>.json に写す
 *   - 書くのは project.json だけ (Scenes/ ・ UI/ の写しには触らない。移行は IR 本体の形だけを変える)
 *   - Spatial のプロジェクト (project.spatial.json) と、この Arsist より新しい版のファイルは断る
 *   - 拡張機能のデータ (extensions.<id> の dataVersion) は移行しない。それはエディタで開いたときに訊かれる
 * --dry-run は何も書かず、何が変わるかだけを出す。
 *
 * 先に `npm run build:main` が要る (コンパイル済みの dist/main の移行を使う。TypeScript の写しを持たないため)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = (...p) => path.join(ROOT, 'dist', 'main', ...p);

const migrationsJs = dist('main', 'project', 'migrations.js');
const versionJs = dist('shared', 'layster', 'version.js');
const irVersionJs = dist('shared', 'irVersion.js');
for (const f of [migrationsJs, versionJs, irVersionJs]) {
  if (!fs.existsSync(f)) {
    console.error(`layster-upgrade: ${path.relative(ROOT, f)} not found. Run "npm run build:main" first.`);
    process.exit(1);
  }
}
const { migrateProject, virtualBackupTag } = require(migrationsJs);
const { describeVirtualIrVersion, SPATIAL_PROJECT_FILE } = require(versionJs);
const { CURRENT_IR_VERSION, readIrVersion } = require(irVersionJs);

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const dirs = argv.filter((a) => a !== '--dry-run');
if (dirs.length === 0) {
  console.error('usage: node scripts/layster-upgrade.mjs <project dir>... [--dry-run]');
  process.exit(1);
}

const label = (n) => `Layster.Virtual ${describeVirtualIrVersion(n)}`;

/** 2 つの値の違う所を 'a.b[2].c' の形で並べる (多すぎたら切る)。 */
function diffPaths(a, b, at = '', out = []) {
  if (out.length > 40) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const isObj = (v) => v && typeof v === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${at || '(root)'}: ${a === undefined ? '(none)' : JSON.stringify(a).slice(0, 60)} → ${b === undefined ? '(removed)' : JSON.stringify(b).slice(0, 60)}`);
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diffPaths(a[k], b[k], Array.isArray(a) ? `${at}[${k}]` : (at ? `${at}.${k}` : k), out);
  return out;
}

let failed = 0;
for (const dir of dirs) {
  const file = path.join(dir, 'project.json');
  const tag = path.relative(process.cwd(), dir) || dir;
  if (!fs.existsSync(file)) {
    if (fs.existsSync(path.join(dir, SPATIAL_PROJECT_FILE))) {
      console.log(`- ${tag}: Layster.Spatial project — nothing to do (this tool upgrades Layster.Virtual only)`);
    } else {
      console.log(`! ${tag}: no project.json`);
      failed++;
    }
    continue;
  }
  const text = fs.readFileSync(file, 'utf8');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    console.log(`! ${tag}: project.json is not valid JSON (${e.message})`);
    failed++;
    continue;
  }
  if (raw?.layster?.profile === 'spatial') {
    console.log(`! ${tag}: project.json says it is Layster.Spatial — refusing`);
    failed++;
    continue;
  }
  const from = readIrVersion(raw);
  if (from > CURRENT_IR_VERSION) {
    console.log(`! ${tag}: ${label(from)} is newer than this Arsist (${label(CURRENT_IR_VERSION)}) — refusing`);
    failed++;
    continue;
  }
  const before = JSON.parse(text);
  const outcome = migrateProject(raw);
  // 改行は元のファイルに合わせる (CRLF のファイルを LF で書くと、全行が変わったように見える)
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const after = (JSON.stringify(raw, null, 2) + '\n').replace(/\n/g, eol);
  if (after === text || (outcome.applied.length === 0 && outcome.changes.length === 0)) {
    console.log(`= ${tag}: already ${label(CURRENT_IR_VERSION)}`);
    continue;
  }
  console.log(`${dryRun ? '~' : '+'} ${tag}: ${label(from)} → ${label(CURRENT_IR_VERSION)}` +
    (outcome.applied.length ? ` (steps ${outcome.applied.join(', ')})` : ' (heading only)'));
  for (const line of diffPaths(before, raw)) console.log(`    ${line}`);
  if (dryRun) continue;

  const backupDir = path.join(dir, 'Backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(backupDir, `project.${virtualBackupTag(from)}.${stamp}.json`);
  fs.copyFileSync(file, backup);
  // 書きかけのファイルを残さない (一時ファイルに書いてから置き換える)
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, after);
  fs.renameSync(tmp, file);
  console.log(`    backup: ${path.relative(process.cwd(), backup)}`);
}
process.exit(failed > 0 ? 1 : 0);
