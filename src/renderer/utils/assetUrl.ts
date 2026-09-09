/**
 * プロジェクト内アセットの相対パスを、レンダラーから読める URL に変換する。
 *
 * Electron の custom protocol `arsist-file://` 経由で読む（file:// は
 * レンダラーのサンドボックスから直接触れないため）。
 */
export function toArsistFileUrl(projectPath: string, assetPath: string): string {
  // 絶対パスを組み立てる（バックスラッシュはスラッシュに統一）
  const absPath = `${projectPath}/${assetPath}`.replace(/\\/g, '/');
  // Windows のドライブレター (C: 等) は arsist-file://C:/... 形式
  if (/^[A-Za-z]:/.test(absPath)) {
    return `arsist-file://${absPath}`;
  }
  // Unix パスは arsist-file:///... 形式
  return `arsist-file:///${absPath}`;
}
