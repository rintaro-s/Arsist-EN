/**
 * シーンと UI レイアウトは、2 か所に同じものが書かれている:
 *   project.json の scenes[] / uiLayouts[]   (全体を 1 ファイルで見たいとき用の写し)
 *   Scenes/<id>.json / UI/<id>.json          (1 つずつのファイル)
 * エディタは保存のたびに両方を同じ中身で書く。ずれるのは、外 (AI エージェントが JSON を直接編集した、手で直した)
 * でどちらか一方だけが変わったとき。以前は個別ファイルを常に正としていたので、project.json の中を
 * 書き換えると黙って無視され、次の保存で消えていた (個別ファイルが無いシーンは丸ごと消えていた)。
 *
 * どちらを使うか:
 *   1. 中身が同じ → 個別ファイル
 *   2. 前回それぞれの写しがどうだったか (seen) が分かる → 変わった方。両方変わっていたら個別ファイル
 *      (衝突として知らせる)。どちらも変わっていなければ前回選んだ方 (片方だけ直された状態が続いても戻らない)
 *   3. seen が無い (エディタで開いた直後・MCP サーバー) → 更新時刻が新しい方。同時なら個別ファイル
 * 個別ファイルが壊れた JSON (書きかけ) なら、前回選んだ中身 → project.json の写し の順に使う。
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import type { SceneData, UILayoutData } from '../../shared/types';
import { repairScene, repairUILayout } from '../../shared/irRepair';

/** キーの順番に関係なく比べるための文字列 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).filter((k) => (value as Record<string, unknown>)[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export type CopySource = 'file' | 'embedded' | 'previous';

/** 前回見たときの、それぞれの写しの中身 (stableStringify) と、使った方 */
export interface CopySeen {
  file?: string;
  embedded?: string;
  chosen?: string;
}

export interface CopyInput {
  /** 個別ファイルの中身。無ければ undefined、読めなければ fileError */
  file?: unknown;
  fileError?: string;
  fileMtimeMs?: number;
  /** project.json の中の写し (中身が揃っているときだけ。id と名前だけの参照なら undefined) */
  embedded?: unknown;
  projectMtimeMs?: number;
  seen?: CopySeen;
}

export interface CopyChoice {
  value: unknown;
  source: CopySource;
  /** 両方が別々に変わっていた */
  conflict: boolean;
  /** 次に読むときに渡す */
  seen: CopySeen;
}

export function chooseCopy(input: CopyInput): CopyChoice | null {
  const { file, embedded, seen } = input;
  const f = file !== undefined && input.fileError === undefined ? stableStringify(file) : undefined;
  const e = embedded !== undefined ? stableStringify(embedded) : undefined;
  const done = (value: unknown, source: CopySource, conflict = false): CopyChoice =>
    ({ value, source, conflict, seen: { file: f ?? seen?.file, embedded: e, chosen: stableStringify(value) } });

  if (f === undefined) {
    // 個別ファイルが無い・壊れている。壊れているなら、エディタが今持っている中身を保つ (書きかけを拾わない)
    if (input.fileError !== undefined && seen?.chosen !== undefined) return done(JSON.parse(seen.chosen), 'previous');
    if (embedded !== undefined) return done(embedded, 'embedded');
    return null;
  }
  if (e === undefined || f === e) return done(file, 'file');

  if (seen) {
    const fileChanged = f !== seen.file;
    const embeddedChanged = e !== seen.embedded;
    if (embeddedChanged && !fileChanged) return done(embedded, 'embedded');
    if (fileChanged) return done(file, 'file', embeddedChanged);
    // どちらも前回のまま: 前回選んだ方を使い続ける
    return seen.chosen === e ? done(embedded, 'embedded') : done(file, 'file');
  }

  if (input.projectMtimeMs !== undefined && input.fileMtimeMs !== undefined && input.projectMtimeMs > input.fileMtimeMs) {
    return done(embedded, 'embedded');
  }
  return done(file, 'file');
}

/**
 * JSON の読み間違いを「何行目の何文字目」で言う。V8 の文言は版によって位置を言わない
 * ("Unexpected token '}', ... is not valid JSON") ので、自分で最初に崩れた所を探す。
 * 人にも、ファイルを直接書いた AI エージェントにも、直す場所がすぐ分かるように。
 */
export function describeJsonError(text: string, error: unknown): string {
  const message = ((error as Error)?.message ?? String(error)).split('\n')[0];
  if (/line \d+/.test(message)) return message;
  const pos = locateJsonError(text);
  if (pos === null) return message;
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const column = pos - before.lastIndexOf('\n');
  const short = message.replace(/\s*in JSON at position \d+.*$/, '').replace(/,\s*".*$/, '');
  return `${short} (line ${line}, column ${column})`;
}

/** 最初に JSON として崩れた位置 (文字の番号)。崩れていなければ null。 */
export function locateJsonError(text: string): number | null {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const fail = (): never => { throw i; };
  const literal = (word: string) => { if (text.startsWith(word, i)) i += word.length; else fail(); };
  const string = () => {
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') i++;
      else if (text.charCodeAt(i) < 0x20) fail();
      i++;
    }
    if (i >= text.length) fail();
    i++;
  };
  const number = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m || m[0] === '') fail();
    i += m![0].length;
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++; ws();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        string(); ws();
        if (text[i] !== ':') fail();
        i++; value(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return; }
        fail();
      }
    }
    if (c === '[') {
      i++; ws();
      if (text[i] === ']') { i++; return; }
      for (;;) {
        value(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return; }
        fail();
      }
    }
    if (c === '"') return string();
    if (c === 't') return literal('true');
    if (c === 'f') return literal('false');
    if (c === 'n') return literal('null');
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    fail();
  };
  try {
    value(); ws();
    return i < text.length ? i : null;
  } catch (at) {
    return typeof at === 'number' ? Math.min(at, text.length) : null;
  }
}

/** ファイルを JSON として読む。無ければ value も error も無し、壊れていれば error (行・桁つき)。 */
async function readJsonFile(file: string): Promise<{ value?: unknown; error?: string; mtimeMs?: number }> {
  let text: string;
  let mtimeMs: number;
  try {
    [text, mtimeMs] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file).then((s) => s.mtimeMs)]);
  } catch {
    return {};
  }
  try {
    return { value: JSON.parse(text), mtimeMs };
  } catch (e) {
    return { error: describeJsonError(text, e), mtimeMs };
  }
}

export interface ResolvedCopies {
  scenes: SceneData[];
  uiLayouts: UILayoutData[];
  /** 人とエージェントに見せる短い知らせ (どの写しを使ったか・何を補ったか) */
  notes: string[];
  /** 次に読むときに渡す (キー: scene:<id> / ui:<id>) */
  seen: Map<string, CopySeen>;
  /**
   * 使った中身と食い違っている写し (value をそこへ写せば揃う)。エディタはこれを書いて 2 つの写しを揃える。
   * 揃えないと、次にエージェントが古い方の写しを読んで書き、さっきの編集を消してしまう。
   * value は補う前の中身 (エージェントが書いたもの、そのまま)。書きかけ (壊れた JSON) の写しは含めない。
   */
  stale: Array<{ kind: 'scene' | 'ui'; id: string; copy: 'file' | 'embedded'; value: unknown }>;
}

/**
 * project.json の写しと Scenes/ ・ UI/ の個別ファイルから、使う中身を決めて、描けるところまで補う。
 * エディタ (ProjectManager) と、エディタの外で書くもの (MCP のツール・内蔵エージェント) の両方が使う。
 */
export async function resolveSceneAndUiCopies(
  projectPath: string,
  project: { scenes?: unknown; uiLayouts?: unknown },
  options: { seen?: Map<string, CopySeen> } = {},
): Promise<ResolvedCopies> {
  const notes: string[] = [];
  const seen = new Map<string, CopySeen>();
  const stale: ResolvedCopies['stale'] = [];
  const projectMtimeMs = await fs.stat(path.join(projectPath, 'project.json')).then((s) => s.mtimeMs).catch(() => undefined);

  const resolve = async (kind: 'scene' | 'ui', ref: any, index: number) => {
    const dirName = kind === 'scene' ? 'Scenes' : 'UI';
    const id = typeof ref?.id === 'string' && ref.id ? ref.id : null;
    const listName = kind === 'scene' ? 'scenes' : 'uiLayouts';
    if (!id) {
      notes.push(`project.json ${listName}[${index}] has no "id"; skipped`);
      return null;
    }
    const rel = `${dirName}/${id}.json`;
    const fileRead = await readJsonFile(path.join(projectPath, dirName, `${id}.json`));
    // project.json の写しは、中身まであるときだけ写しとして扱う (id と名前だけなら参照)
    const full = kind === 'scene' ? Array.isArray(ref.objects) : ref.root !== undefined;
    const key = `${kind}:${id}`;
    const choice = chooseCopy({
      file: fileRead.value,
      fileError: fileRead.error,
      fileMtimeMs: fileRead.mtimeMs,
      embedded: full ? ref : undefined,
      projectMtimeMs,
      seen: options.seen?.get(key),
    });
    if (!choice) {
      notes.push(fileRead.error ? `${rel}: ${fileRead.error}; nothing else to use, skipped` : `${rel} does not exist and project.json has only a reference; skipped`);
      return null;
    }
    seen.set(key, choice.seen);
    if (choice.source === 'embedded' && fileRead.value !== undefined) notes.push(`${rel}: using the copy in project.json (it was edited there)`);
    if (choice.source === 'embedded' && fileRead.value === undefined && fileRead.error === undefined) notes.push(`${rel} does not exist yet; using the copy in project.json`);
    if (choice.source === 'previous') notes.push(`${rel}: ${fileRead.error}; keeping what the editor had until it is valid again`);
    if (choice.source === 'embedded' && fileRead.error !== undefined) notes.push(`${rel}: ${fileRead.error}; using the copy in project.json`);
    if (choice.conflict) notes.push(`${rel} and project.json were both changed differently; using ${rel}`);
    if (choice.source === 'embedded' && fileRead.error === undefined) {
      stale.push({ kind, id, copy: 'file', value: choice.value });
    } else if (choice.source === 'file' && full && stableStringify(ref) !== stableStringify(choice.value)) {
      stale.push({ kind, id, copy: 'embedded', value: choice.value });
    }
    // 補う前に写す (chooseCopy が覚えた文字列は補う前の中身。補った分は次の保存でファイルに入る)
    const value = JSON.parse(JSON.stringify(choice.value));
    return kind === 'scene' ? repairScene(legacyScene(value), rel, notes) : repairUILayout(value, rel, notes);
  };

  const scenes: SceneData[] = [];
  const sceneRefs = Array.isArray(project.scenes) ? project.scenes : [];
  for (let i = 0; i < sceneRefs.length; i++) {
    const scene = await resolve('scene', sceneRefs[i], i);
    if (scene) scenes.push(scene as SceneData);
  }
  const uiLayouts: UILayoutData[] = [];
  const uiRefs = Array.isArray(project.uiLayouts) ? project.uiLayouts : [];
  for (let i = 0; i < uiRefs.length; i++) {
    const layout = await resolve('ui', uiRefs[i], i);
    if (layout) uiLayouts.push(layout as UILayoutData);
  }

  // 一覧に無い個別ファイル (エージェントがファイルだけ足した) は読まないので、そう知らせる
  for (const [dirName, list] of [['Scenes', scenes], ['UI', uiLayouts]] as const) {
    const ids = new Set((list as Array<{ id: string }>).map((x) => x.id));
    const files = await fs.readdir(path.join(projectPath, dirName)).catch(() => [] as string[]);
    for (const name of files) {
      if (!name.endsWith('.json') || name.includes('.tmp-')) continue;
      const id = name.slice(0, -'.json'.length);
      if (!ids.has(id)) notes.push(`${dirName}/${name} is not listed in project.json ${dirName === 'Scenes' ? 'scenes' : 'uiLayouts'}; add {"id": "${id}", ...} there to use it`);
    }
  }
  return { scenes, uiLayouts, notes, seen, stale };
}

/** 後方互換: objects.type === 'ui_surface' → 'canvas'、旧 components フィールド削除 */
function legacyScene(scene: any): any {
  for (const obj of Array.isArray(scene?.objects) ? scene.objects : []) {
    if (obj?.type === 'ui_surface') {
      obj.type = 'canvas';
      if (obj.uiSurface) {
        obj.canvasSettings = {
          layoutId: obj.uiSurface.layoutId || '',
          widthMeters: obj.uiSurface.width || 1.2,
          heightMeters: obj.uiSurface.height || 0.7,
          pixelsPerUnit: obj.uiSurface.pixelsPerUnit || 1000,
        };
        delete obj.uiSurface;
      }
    }
    if (obj) delete obj.components;
  }
  return scene;
}

/** エディタが両方の写しを同じ中身で書いたあとの seen */
export function seenAfterSave(scenes: Array<{ id: string }>, uiLayouts: Array<{ id: string }>): Map<string, CopySeen> {
  const seen = new Map<string, CopySeen>();
  for (const [kind, list] of [['scene', scenes], ['ui', uiLayouts]] as const) {
    for (const item of list) {
      const text = stableStringify(item);
      seen.set(`${kind}:${item.id}`, { file: text, embedded: text, chosen: text });
    }
  }
  return seen;
}

/**
 * 食い違っている写しに、使った中身を写す (resolveSceneAndUiCopies の stale)。書いたファイルの相対パスを返す。
 * project.json は読み直したうえで、該当するシーン / レイアウトだけを差し替える (他の項目・irVersion には触れない)。
 * write はエディタの保存と同じ書き方 (一時ファイル + rename、自分の書き込みとして監視役に知らせる) を渡す。
 */
export async function syncStaleCopies(
  projectPath: string,
  stale: ResolvedCopies['stale'],
  write: (file: string, data: unknown) => Promise<void>,
): Promise<string[]> {
  const written: string[] = [];
  for (const item of stale.filter((s) => s.copy === 'file')) {
    const rel = `${item.kind === 'scene' ? 'Scenes' : 'UI'}/${item.id}.json`;
    await write(path.join(projectPath, rel), item.value);
    written.push(rel);
  }
  const embedded = stale.filter((s) => s.copy === 'embedded');
  if (embedded.length > 0) {
    const file = path.join(projectPath, 'project.json');
    let raw: any;
    try {
      raw = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      return written; // 今まさに書き換え中。次の読み直しで揃える
    }
    let changed = false;
    for (const item of embedded) {
      const list = raw?.[item.kind === 'scene' ? 'scenes' : 'uiLayouts'];
      const index = Array.isArray(list) ? list.findIndex((x: any) => x?.id === item.id) : -1;
      if (index < 0) continue;
      list[index] = item.value;
      changed = true;
    }
    if (changed) {
      await write(file, raw);
      written.push('project.json');
    }
  }
  return written;
}
