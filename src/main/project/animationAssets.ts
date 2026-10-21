/**
 * キャラクターの動き (人型の FBX) をプロジェクトの Assets/Animations/ に入れる・一覧する。
 *
 * ファイル名がそのまま動きの名前になる (スクリプトの vrm.playAnimation(id, 'Walk')、物の character.animation、
 * Unity の AnimatorController の状態名)。だから他のアセットと違ってハッシュを付けず、読める名前のまま置く。
 * 同じ名前で中身が違うファイルがあれば _2, _3 … を付ける (中身が同じなら入れ直さない)。
 *
 * エディタの assets:import と MCP の ir_import_animation の両方がここを使う。
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { createHash } from 'crypto';

export const ANIMATIONS_DIR = 'Assets/Animations';
export const ANIMATION_EXTENSIONS = ['.fbx'];

/** 動きの名前に使える形 (英数字・_・-)。日本語などは _ になる。 */
export function cleanAnimationName(raw: string): string {
  const base = raw.replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  return cleaned || 'Animation';
}

export interface ImportedAnimation {
  /** 動きの名前 (スクリプト・character.animation で使う) */
  name: string;
  /** プロジェクトからの相対パス (Assets/Animations/<name>.fbx) */
  assetPath: string;
  /** 同じ中身が既にあったので入れ直さなかった */
  existed: boolean;
}

async function sha1(file: string): Promise<string> {
  return createHash('sha1').update(await fs.readFile(file)).digest('hex');
}

export async function importAnimation(projectPath: string, sourcePath: string, wantedName?: string): Promise<ImportedAnimation> {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!ANIMATION_EXTENSIONS.includes(ext)) {
    throw new Error(`unsupported animation file: ${ext || '(none)'} (use a humanoid .fbx, e.g. from Mixamo)`);
  }
  if (!await fs.pathExists(sourcePath)) throw new Error(`file not found: ${sourcePath}`);

  const dir = path.join(projectPath, ANIMATIONS_DIR);
  await fs.ensureDir(dir);
  const base = cleanAnimationName(wantedName || path.basename(sourcePath));
  const hash = await sha1(sourcePath);
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? base : `${base}_${n}`;
    const dest = path.join(dir, `${name}${ext}`);
    if (await fs.pathExists(dest)) {
      if (await sha1(dest) === hash) return { name, assetPath: `${ANIMATIONS_DIR}/${name}${ext}`, existed: true };
      continue;
    }
    await fs.copyFile(sourcePath, dest);
    return { name, assetPath: `${ANIMATIONS_DIR}/${name}${ext}`, existed: false };
  }
  throw new Error(`too many animations named ${base}`);
}

export interface AnimationAsset {
  name: string;
  assetPath: string;
  bytes: number;
}

/** Assets/Animations/ の動き (名前順)。フォルダが無ければ空。 */
export async function listAnimations(projectPath: string): Promise<AnimationAsset[]> {
  const dir = path.join(projectPath, ANIMATIONS_DIR);
  if (!await fs.pathExists(dir)) return [];
  const out: AnimationAsset[] = [];
  for (const entry of await fs.readdir(dir)) {
    const ext = path.extname(entry).toLowerCase();
    if (!ANIMATION_EXTENSIONS.includes(ext)) continue;
    const stat = await fs.stat(path.join(dir, entry)).catch(() => null);
    if (!stat?.isFile()) continue;
    out.push({ name: entry.slice(0, -ext.length), assetPath: `${ANIMATIONS_DIR}/${entry}`, bytes: stat.size });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
