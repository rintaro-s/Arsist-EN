/**
 * Layster.Virtual (project.json) の版間移行。版の名前 (α1〜α5 / β 1.0.0 …) は
 * src/shared/layster/version.ts の VIRTUAL_FORMATS、考え方は doc/19-layster.md §1。
 *
 * Unity がプロジェクトを新しいエディタで開くときにするのと同じ考え方:
 *   - 古い版のファイルは、そのまま黙って書き換えない
 *   - メモリ上では今の形に直して読み込む (でないとエディタが動かない)
 *   - 書き戻すのはユーザーが「アップグレード」を選んだときだけ。元のファイルは残す
 *
 * 移行はひとつ前の版からひとつ次の版へ、順に適用する。各移行は冪等で、
 * 今の版のプロジェクトに掛けても何も変えない (テストで確認している)。
 *
 * 版を上げる手順 (`npm run ir:new -- "<説明>"` で 1〜3 の雛形が入る):
 *   1. src/shared/irVersion.ts の CURRENT_IR_VERSION を上げ、src/shared/layster/version.ts の
 *      VIRTUAL_FORMATS に人に見せる名前 (β x.y.z) を足す
 *   2. MIGRATIONS の末尾に defineMigration(<新しい版>, { ops: [...] }) を足す。
 *      項目の追加・改名・削除・値の言い換えは ops (src/shared/irOps.ts) で 1 行ずつ書ける。
 *      それで書けない変更だけ apply に関数で書く。
 *   3. src/renderer/i18n/strings.ts に `ir.migration.<新しい版>` の説明を足す
 *   4. 形の変わる例を migrations.test.ts に足す
 * 版の抜け・冪等性・説明文の有無は migrations.test.ts が全部の移行について自動で確かめる。
 * `layster` の見出し (版の名前) は migrateProject が最後に今の版のものを書くので、各移行で触らなくてよい。
 *
 * 拡張機能のデータ (extensions.<id> / 物の ext.<id>) はここでは移行しない。拡張機能ごとに
 * 自分の版を持ち、extension.json の data.migrations で移行する (src/shared/extensions.ts)。
 */
import { CURRENT_IR_VERSION, readIrVersion } from '../../shared/irVersion';
import { applyIrOps, type IrOp } from '../../shared/irOps';
import { VIRTUAL_FORMATS, virtualHeaderFor } from '../../shared/layster/version';
import { createARSettings, createInitialDataFlow, migrateAppType, PROJECT_TEMPLATES } from './defaults';

/** 何でも入る project.json の素の形。型を付けるのは移行が終わってから。 */
export type RawProject = Record<string, any>;

export interface IrMigration {
  from: number;
  to: number;
  /** i18n やログで使う識別子。`ir.migration.<to>` */
  id: string;
  /**
   * その場で書き換える。返すのは「実際に何を変えたか」の短い識別子の一覧で、
   * 何も変えなかったなら空。ログとアップグレード画面に出す。
   */
  apply: (project: RawProject) => string[];
}

/**
 * 1 段の移行を作る。from は to - 1、id は to の文字列で決まる。
 *
 *   defineMigration(5, { ops: [
 *     { op: 'default', path: 'arSettings.foo', value: 1 },
 *     { op: 'rename', path: 'scenes[].objects[].oldName', to: 'newName' },
 *   ] })
 *
 * ops を先に掛け、そのあと apply (あれば) を呼ぶ。どちらも冪等であること。
 */
export function defineMigration(
  to: number,
  step: { ops?: IrOp[]; apply?: (project: RawProject) => string[] },
): IrMigration {
  if (!Number.isInteger(to) || to < 2) throw new Error(`IR migration target must be >= 2 (got ${to})`);
  return {
    from: to - 1,
    to,
    id: String(to),
    apply: (project) => [
      ...(step.ops?.length ? applyIrOps(project, step.ops) : []),
      ...(step.apply ? step.apply(project) : []),
    ],
  };
}

export interface MigrationOutcome {
  project: RawProject;
  from: number;
  to: number;
  /** 適用した移行の id */
  applied: string[];
  /** 移行が実際に変えた項目 */
  changes: string[];
}

export class IrVersionError extends Error {
  constructor(public readonly found: number, public readonly supported: number) {
    super(`project irVersion ${found} is newer than this editor supports (${supported})`);
    this.name = 'IrVersionError';
  }
}

// ---- 1 → 2 -------------------------------------------------------------

function migrate1to2(project: RawProject): string[] {
  const changes: string[] = [];

  if (!PROJECT_TEMPLATES.includes(project.appType)) {
    project.appType = migrateAppType(String(project.appType ?? ''));
    changes.push('appType');
  }

  if (!project.arSettings || typeof project.arSettings !== 'object') {
    project.arSettings = createARSettings(project.appType);
    changes.push('arSettings');
  }
  if (!project.arSettings.interaction) {
    project.arSettings.interaction = { controllerRay: true, handTracking: false };
    changes.push('interaction');
  }

  if (!project.dataFlow || typeof project.dataFlow !== 'object') {
    project.dataFlow = createInitialDataFlow();
    changes.push('dataFlow');
  }

  // 存在しなくなった仕組みの項目。残しておくと「使われているように見える」だけで害。
  for (const key of ['logicGraphs', 'uiAuthoring', 'uiCode']) {
    if (key in project) {
      delete project[key];
      changes.push(key);
    }
  }

  if (!Array.isArray(project.scripts)) {
    project.scripts = [];
    changes.push('scripts');
  }

  // 一時期あった空専用の解析設定。エンジンから外したので項目ごと落とす
  // (中身は汎用 op の並びとして pipeline に書き直す必要があり、自動では起こせない)。
  const tasks = project.perception?.tasks;
  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      if (task && typeof task === 'object' && 'analysis' in task) {
        delete task.analysis;
        changes.push('perception.analysis');
      }
    }
  }

  if (!Array.isArray(project.models)) {
    project.models = [];
    changes.push('models');
  }

  return changes;
}

// ---- 2 → 3 -------------------------------------------------------------

/**
 * モデルに「何に使うか」(use) を付ける。v2 までのモデルは画像認識の `infer` op 専用だったので、
 * すべて image。画像の読み方 (task / input / output) はそのまま残す。
 */
function migrate2to3(project: RawProject): string[] {
  const changes: string[] = [];
  if (!Array.isArray(project.models)) {
    project.models = [];
    changes.push('models');
    return changes;
  }
  for (const model of project.models) {
    if (!model || typeof model !== 'object') continue;
    if (model.use !== 'image' && model.use !== 'text' && model.use !== 'tensor') {
      model.use = 'image';
      if (!changes.includes('models.use')) changes.push('models.use');
    }
  }
  return changes;
}

export const MIGRATIONS: IrMigration[] = [
  defineMigration(2, { apply: migrate1to2 }),
  defineMigration(3, { apply: migrate2to3 }),
  // 拡張機能の置き場。中身 (extensions.<id> / 物の ext.<id>) は拡張機能ごとの版で移行する。
  defineMigration(4, { ops: [{ op: 'default', path: 'extensions', value: {} }] }),
  // キャラクターと保存。VRM の character・文字の reveal は無ければ「今までどおり」なので補わない
  // (補うと古い VRM がいきなり瞬きを始める)。端末に保存するキーの置き場だけ足す。
  defineMigration(5, { ops: [{ op: 'default', path: 'storage', value: { persist: [] } }] }),
  // Layster.Virtual β 1.0.0。形は α5 と同じで、先頭に見出しを持つ (doc/19-layster.md §1.2)。
  // 以後の版の見出しは migrateProject が書く (ここは β 1.0.0 で固定)。
  defineMigration(6, { ops: [{ op: 'set', path: 'layster', value: { profile: 'virtual', stage: 'beta', version: '1.0.0' } }] }),
  // カメラ (シーンに置く仮想カメラ)、UI の画像に映すもの (カメラの映像・PC からの画面の配信)、VRM を自分の頭と手で動かす設定 (embody) を足しました。項目を足しただけで、今までの中身は変わりません。
  defineMigration(7, { ops: [
    // 例: { op: 'default', path: 'arSettings.newThing', value: 1 },
    //     { op: 'rename', path: 'scenes[].objects[].oldName', to: 'newName' },
  ] }),
  // @ir-migrations-end (npm run ir:new はこの行の上に足す)
];

// ---- 実行 -----------------------------------------------------------------

/**
 * project.json の素の中身を、今の版まで移行する (その場で書き換える)。
 * 今の版より新しければ IrVersionError を投げる。
 */
export function migrateProject(raw: RawProject): MigrationOutcome {
  const from = readIrVersion(raw);
  if (from > CURRENT_IR_VERSION) throw new IrVersionError(from, CURRENT_IR_VERSION);

  const applied: string[] = [];
  const changes: string[] = [];
  let version = from;

  while (version < CURRENT_IR_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) {
      // 版の穴。開発中に MIGRATIONS を足し忘れたときにしか起きない。
      throw new Error(`no IR migration from version ${version}`);
    }
    changes.push(...step.apply(raw));
    applied.push(step.id);
    version = step.to;
  }

  raw.irVersion = CURRENT_IR_VERSION;
  // 版の名前の見出し。移行が無くても、見出しが欠けている・違うなら今の版のものにする
  // (エージェントが見出しを消して書いた / 手で irVersion だけ上げた、などを直す)。
  const header = virtualHeaderFor(CURRENT_IR_VERSION);
  if (header && (JSON.stringify(raw.layster) !== JSON.stringify(header) || Object.keys(raw)[0] !== 'layster')) {
    // 見出しを先頭に置く (ファイルを開いて最初に目に入るように)
    const rest: RawProject = { ...raw };
    delete rest.layster;
    for (const key of Object.keys(raw)) delete raw[key];
    Object.assign(raw, { layster: { ...header } }, rest);
    if (!changes.includes('layster')) changes.push('layster');
  }
  return { project: raw, from, to: CURRENT_IR_VERSION, applied, changes };
}

/** 移行が要るか (ファイルを書き換えずに判定したいとき用)。 */
export function needsMigration(raw: unknown): boolean {
  return readIrVersion(raw) < CURRENT_IR_VERSION;
}

/**
 * 退避ファイルの名前に入れる版 ('alpha5' / 'beta1.0.0' / 表に無ければ 'v7')。
 * 退避した project.json をどの Arsist に戻せば読めるかが、名前を見れば分かるように。
 */
export function virtualBackupTag(irVersion: number): string {
  const f = VIRTUAL_FORMATS[irVersion];
  if (!f) return `v${irVersion}`;
  return f.stage === 'alpha' ? `alpha${f.version}` : `beta${f.version}`;
}
