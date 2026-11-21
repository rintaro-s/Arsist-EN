#!/usr/bin/env node
/**
 * Layster.Virtual (project.json の形) の版を 1 つ上げる雛形を入れる。doc/19-layster.md §1。
 *
 *   npm run ir:new -- "<変更の説明 (日本語)>" ["<English description>"] [--version 1.1.0] [--dry-run]
 *
 * --version は人に見せる β の版 (semver)。省略すると直前の β の minor を 1 上げる
 * (項目を足すだけなら minor、形を壊すなら major を自分で書く)。
 *
 * 書き換えるもの:
 *   src/shared/irVersion.ts          CURRENT_IR_VERSION を +1、版の履歴に 1 行
 *   src/shared/layster/version.ts    VIRTUAL_FORMATS に <新しい数>: β <版> を 1 行
 *   src/main/project/migrations.ts   MIGRATIONS の末尾に defineMigration(<新しい版>, { ops: [] })
 *   src/renderer/i18n/strings.ts     ir.migration.<新しい版> (アップグレード画面の説明)
 *
 * そのあと人がやること (最後に表示する):
 *   - migrations.ts の ops に変更を書く ({ op: 'default' | 'set' | 'rename' | 'remove' | 'map', path, ... })
 *   - src/shared/types.ts の型、src/bridge/UnityBridge.ts、Unity 側の読み手を合わせる
 *   - migrations.test.ts に「古い形 → 新しい形」の例を足す
 * 版の抜け・冪等性・説明文の有無は migrations.test.ts が自動で確かめる。
 *
 * 拡張機能のデータの形を変えるだけなら、これは要らない (extension.json の data.version を上げる)。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  version: path.join(ROOT, 'src/shared/irVersion.ts'),
  migrations: path.join(ROOT, 'src/main/project/migrations.ts'),
  strings: path.join(ROOT, 'src/renderer/i18n/strings.ts'),
  layster: path.join(ROOT, 'src/shared/layster/version.ts'),
};

function fail(message) {
  console.error(`ir:new: ${message}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const versionAt = argv.indexOf('--version');
const wantedVersion = versionAt >= 0 ? argv[versionAt + 1] : undefined;
const args = argv.filter((a, i) => a !== '--dry-run' && a !== '--version' && (versionAt < 0 || i !== versionAt + 1));
const [ja, en] = args;
if (!ja) fail('usage: npm run ir:new -- "<変更の説明>" ["<English>"] [--version 1.1.0] [--dry-run]');
if (wantedVersion !== undefined && !/^\d+\.\d+\.\d+$/.test(wantedVersion)) fail(`--version must be semver (x.y.z), got "${wantedVersion}"`);

const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const versionSrc = fs.readFileSync(files.version, 'utf8');
const m = versionSrc.match(/export const CURRENT_IR_VERSION = (\d+);/);
if (!m) fail('CURRENT_IR_VERSION not found in src/shared/irVersion.ts');
const current = Number(m[1]);
const next = current + 1;

// 人に見せる名前 (β x.y.z)。VIRTUAL_FORMATS の最後の β から決める
const laysterSrc = fs.readFileSync(files.layster, 'utf8');
const formatsAnchor = '  // @virtual-formats-end';
if (!laysterSrc.includes(formatsAnchor)) fail('"// @virtual-formats-end" not found in src/shared/layster/version.ts');
if (new RegExp(`^\\s*${next}: \\{`, 'm').test(laysterSrc)) fail(`VIRTUAL_FORMATS already has ${next}`);
const betas = [...laysterSrc.matchAll(/^\s*\d+: \{ stage: 'beta', version: '(\d+)\.(\d+)\.(\d+)' \}/gm)];
const last = betas[betas.length - 1];
const betaVersion = wantedVersion ?? (last ? `${last[1]}.${Number(last[2]) + 1}.0` : '1.0.0');
const formatLine = `  ${next}: { stage: 'beta', version: '${betaVersion}' },\n`;
const newLaysterSrc = laysterSrc.replace(formatsAnchor, formatLine + formatsAnchor);

const historyAnchor = ' *\n * 版を上げる手順は';
if (!versionSrc.includes(historyAnchor)) fail('history anchor not found in irVersion.ts (the comment layout changed)');
const newVersionSrc = versionSrc
  .replace(historyAnchor, ` *   ${next}  Layster.Virtual β ${betaVersion}。${ja}\n${historyAnchor}`)
  .replace(m[0], `export const CURRENT_IR_VERSION = ${next};`);

const migrationsSrc = fs.readFileSync(files.migrations, 'utf8');
const migAnchor = '  // @ir-migrations-end';
if (!migrationsSrc.includes(migAnchor)) fail('"// @ir-migrations-end" not found in migrations.ts');
if (new RegExp(`^\\s*defineMigration\\(${next},`, 'm').test(migrationsSrc)) fail(`a migration to ${next} already exists`);
const migration = [
  `  // ${ja}`,
  `  defineMigration(${next}, { ops: [`,
  "    // 例: { op: 'default', path: 'arSettings.newThing', value: 1 },",
  "    //     { op: 'rename', path: 'scenes[].objects[].oldName', to: 'newName' },",
  '  ] }),',
  '',
].join('\n');
const newMigrationsSrc = migrationsSrc.replace(migAnchor, migration + migAnchor);

const stringsSrc = fs.readFileSync(files.strings, 'utf8');
const strAnchor = '  // @ir-migration-strings-end';
if (!stringsSrc.includes(strAnchor)) fail('"// @ir-migration-strings-end" not found in strings.ts');
if (stringsSrc.includes(`'ir.migration.${next}'`)) fail(`ir.migration.${next} already exists in strings.ts`);
const entry = [
  `  'ir.migration.${next}': {`,
  `    en: ${quote(en ?? `TODO (English): ${ja}`)},`,
  `    ja: ${quote(ja)},`,
  '  },',
  '',
].join('\n');
const newStringsSrc = stringsSrc.replace(strAnchor, entry + strAnchor);

if (dryRun) {
  console.log(`[dry run] Virtual ${current} → ${next} (Layster.Virtual β ${betaVersion})`);
  console.log(formatLine);
  console.log(migration);
  console.log(entry);
  process.exit(0);
}

fs.writeFileSync(files.version, newVersionSrc);
fs.writeFileSync(files.migrations, newMigrationsSrc);
fs.writeFileSync(files.strings, newStringsSrc);
fs.writeFileSync(files.layster, newLaysterSrc);

console.log(`Virtual ${current} → ${next} = Layster.Virtual β ${betaVersion}`);
console.log('  src/shared/irVersion.ts         CURRENT_IR_VERSION と履歴');
console.log(`  src/shared/layster/version.ts   VIRTUAL_FORMATS ${next}: β ${betaVersion}`);
console.log('  src/main/project/migrations.ts  defineMigration(' + next + ', { ops: [] })');
console.log('  src/renderer/i18n/strings.ts    ir.migration.' + next + (en ? '' : '  (英語は TODO のまま)'));
console.log('');
console.log('Next:');
console.log('  1. migrations.ts の ops に変更を書く (src/shared/irOps.ts の default / set / rename / remove / map)');
console.log('  2. src/shared/types.ts・src/bridge/UnityBridge.ts・Unity 側の読み手を合わせる');
console.log('  3. migrations.test.ts に「古い形 → 新しい形」の例を 1 つ足す');
console.log('  4. npm test  (版の抜け・冪等性・説明文は自動で確かめる)');
