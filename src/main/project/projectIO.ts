/**
 * プロジェクトのファイルの読み書き (エディタの外から触るもの用: MCP のツール・内蔵エージェント・書き出し)。
 *
 * エディタ (ProjectManager) と同じ配置で読み書きする:
 *   project.json        プロジェクト全体 (シーン・UI の写しも中に持つ)
 *   Scenes/<id>.json    シーン 1 つずつ
 *   UI/<id>.json        UI レイアウト 1 つずつ
 * シーン・UI は 2 か所にあり、外でどちらか一方だけ書き換えられたら、変わった方を使う (sceneCopies.ts)。
 * 書くときは両方を同じ中身で書く。
 *
 * 守ること:
 *   - 書くときは 1 ファイルずつ「一時ファイルに書いて rename」(atomicWriteJson)。途中で落ちても、
 *     エディタが半分だけ書かれた JSON を読むことはない
 *   - IR の版が今と違うプロジェクトには書かない。古い版はエディタでアップグレードを承諾してから
 *     (黙って書き換えないという約束、migrations.ts)。新しい版は読むことも断る
 *   - 同じプロジェクトへの書き込みは、このプロセスの中では 1 つずつ (withProjectWrite)
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { CURRENT_IR_VERSION, readIrVersion } from '../../shared/irVersion';
import { describeVirtualIrVersion } from '../../shared/layster/version';

/** 'Layster.Virtual α5' (エラーの文に出す) */
const virtualLabel = (irVersion: number) => `Layster.Virtual ${describeVirtualIrVersion(irVersion)}`;
import { describeJsonError, resolveSceneAndUiCopies } from './sceneCopies';

/** readProjectFiles が読んだときの知らせ (どの写しを使った・何を補った)。ir_validate_project がエージェントに返す */
export const projectReadNotes = new WeakMap<object, string[]>();

export class ProjectFormatError extends Error {
  constructor(message: string, public readonly code: 'notFound' | 'tooNew' | 'needsUpgrade' | 'invalid') {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

/** 一時ファイルに書いてから置き換える (読む側が途中の状態を見ない)。書いた文字列を返す。 */
export async function atomicWriteJson(file: string, data: unknown): Promise<string> {
  await fs.ensureDir(path.dirname(file));
  const text = JSON.stringify(data, null, 2);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tmp, text, 'utf8');
  try {
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.remove(tmp).catch(() => {});
    throw e;
  }
  return text;
}

/**
 * プロジェクトを読む。シーンと UI は、ファイル (Scenes/ / UI/) があればそちらを、無ければ project.json の中を使う
 * (エディタと同じく、ファイルが正)。
 * @param forWrite 書くつもりなら、版が今と違うときに断る
 */
export async function readProjectFiles(projectPath: string, options: { forWrite?: boolean } = {}): Promise<Record<string, any>> {
  const file = path.join(projectPath, 'project.json');
  if (!await fs.pathExists(file)) throw new ProjectFormatError(`project.json not found in ${projectPath}`, 'notFound');
  let project: Record<string, any>;
  const text = await fs.readFile(file, 'utf8');
  try {
    project = JSON.parse(text);
  } catch (e) {
    throw new ProjectFormatError(`project.json is not valid JSON: ${describeJsonError(text, e)}`, 'invalid');
  }
  const version = readIrVersion(project);
  if (version > CURRENT_IR_VERSION) {
    throw new ProjectFormatError(
      `this project is ${virtualLabel(version)}, newer than this Arsist (${virtualLabel(CURRENT_IR_VERSION)}); update Arsist`, 'tooNew');
  }
  if (options.forWrite && version < CURRENT_IR_VERSION) {
    throw new ProjectFormatError(
      `this project is ${virtualLabel(version)} (current ${virtualLabel(CURRENT_IR_VERSION)}). Open it in the Arsist editor and accept the upgrade first; ` +
      'it is not rewritten silently.', 'needsUpgrade');
  }

  // シーン・UI は project.json の写しと個別ファイルのうち、新しく変わった方を使う (エディタと同じ規則。sceneCopies.ts)。
  // エージェントが project.json の中を直接書き換えたあとにツールを呼んでも、その編集を消さない
  const copies = await resolveSceneAndUiCopies(projectPath, project);
  project.scenes = copies.scenes;
  project.uiLayouts = copies.uiLayouts;
  projectReadNotes.set(project, copies.notes);
  if (!project.dataFlow || typeof project.dataFlow !== 'object') project.dataFlow = { dataSources: [], transforms: [] };
  if (!Array.isArray(project.dataFlow.dataSources)) project.dataFlow.dataSources = [];
  if (!Array.isArray(project.dataFlow.transforms)) project.dataFlow.transforms = [];
  if (!Array.isArray(project.scripts)) project.scripts = [];
  return project;
}

/** エディタ (ProjectManager.saveProject) と同じ配置で書く。 */
export async function writeProjectFiles(projectPath: string, project: Record<string, any>, options: { touch?: boolean } = {}): Promise<void> {
  if (options.touch !== false) project.updatedAt = new Date().toISOString();
  await atomicWriteJson(path.join(projectPath, 'project.json'), project);
  for (const scene of project.scenes ?? []) {
    if (scene?.id) await atomicWriteJson(path.join(projectPath, 'Scenes', `${scene.id}.json`), scene);
  }
  for (const layout of project.uiLayouts ?? []) {
    if (layout?.id) await atomicWriteJson(path.join(projectPath, 'UI', `${layout.id}.json`), layout);
  }
}

const queues = new Map<string, Promise<unknown>>();

/**
 * 読んで・変えて・書く、を 1 つずつ行う (同じプロジェクトへの書き込みが重なって片方が消えないように)。
 * mutate が投げたら何も書かない。
 */
export async function withProjectWrite<T>(projectPath: string, mutate: (project: Record<string, any>) => Promise<T> | T): Promise<T> {
  const key = path.resolve(projectPath);
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    const project = await readProjectFiles(projectPath, { forWrite: true });
    const result = await mutate(project);
    await writeProjectFiles(projectPath, project);
    return result;
  });
  queues.set(key, run);
  try {
    return await run;
  } finally {
    if (queues.get(key) === run) queues.delete(key);
  }
}
