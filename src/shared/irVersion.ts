/**
 * IR (project.json の形式) の版。
 *
 * ファイル形式を変えるときは、ここを上げて src/main/project/migrations.ts に
 * 「前の版 → この版」の移行を足す。ArsistProject.irVersion がこの値より古い
 * プロジェクトを開くと、エディタは Unity と同じように「アップグレードするか」を訊き、
 * 承諾されるまではメモリ上で移行した形で読み取り専用として扱う。
 *
 * 版の履歴:
 *   1  irVersion という項目が無かった頃 (2025〜)。
 *   2  irVersion を導入。学習済みモデル (models) と `infer` op を追加。
 *      それまで ProjectManager.loadProject に散らばっていた後方互換の補正
 *      (appType の旧名、arSettings / interaction / dataFlow / scripts の補完、
 *      logicGraphs 等の旧項目の削除) を移行として明文化。
 *   3  モデルを画像認識から切り離した。ModelDefinition に `use` (image / text / tensor) と
 *      `text` (分割器・生成の設定) を追加。画像の読み方 (task / input / output / labels) は
 *      use が image のときだけ持つ。v2 のモデルはすべて画像のモデルなので use: 'image' を補う。
 */
export const CURRENT_IR_VERSION = 3;

/** project.json から版を読む。項目が無ければ 1。数でなければ 1 として扱う。 */
export function readIrVersion(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 1;
  const value = (raw as { irVersion?: unknown }).irVersion;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}
