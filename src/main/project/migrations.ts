/**
 * IR の版間移行。
 *
 * Unity がプロジェクトを新しいエディタで開くときにするのと同じ考え方:
 *   - 古い版のファイルは、そのまま黙って書き換えない
 *   - メモリ上では今の形に直して読み込む (でないとエディタが動かない)
 *   - 書き戻すのはユーザーが「アップグレード」を選んだときだけ。元のファイルは残す
 *
 * 移行はひとつ前の版からひとつ次の版へ、順に適用する。各移行は冪等で、
 * 今の版のプロジェクトに掛けても何も変えない (テストで確認している)。
 *
 * 版を上げる手順:
 *   1. src/shared/irVersion.ts の CURRENT_IR_VERSION を上げる
 *   2. ここに { from, to, id, apply } を足す
 *   3. src/renderer/i18n/strings.ts に `ir.migration.<to>` の説明を足す
 *   4. migrations.test.ts に「古い形 → 新しい形」の確認を足す
 */
import { CURRENT_IR_VERSION, readIrVersion } from '../../shared/irVersion';
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
  { from: 1, to: 2, id: '2', apply: migrate1to2 },
  { from: 2, to: 3, id: '3', apply: migrate2to3 },
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
  return { project: raw, from, to: CURRENT_IR_VERSION, applied, changes };
}

/** 移行が要るか (ファイルを書き換えずに判定したいとき用)。 */
export function needsMigration(raw: unknown): boolean {
  return readIrVersion(raw) < CURRENT_IR_VERSION;
}
