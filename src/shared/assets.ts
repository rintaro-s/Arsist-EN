/**
 * Arsist Engine — asset format rules (shared by main / renderer / bridge)
 *
 * Unity のテクスチャインポータが読める拡張子はエディタ(Chromium)が表示できる
 * 拡張子より狭い。特に **WebP は Unity が非対応** で、読み込ませても
 * TextureImporter ではなく DefaultImporter が割り当てられ、Sprite として
 * ロードできない。その状態でビルドすると UI.Image は sprite=null のまま
 * 「真っ白な四角」として描画されるだけで、エラーも出ない。
 *
 * エディタでは正常に見えてビルドで壊れる、という追いにくい不具合になるため、
 * 取り込み時とビルド前の両方でここを唯一の基準として弾く。
 *
 * 対応形式: https://docs.unity3d.com/Manual/ImportingTextures.html
 */
export const UNITY_TEXTURE_EXTENSIONS = [
  '.bmp',
  '.exr',
  '.gif',
  '.hdr',
  '.iff',
  '.jpg',
  '.jpeg',
  '.pict',
  '.png',
  '.psd',
  '.tga',
  '.tif',
  '.tiff',
] as const;

/** ファイルダイアログのフィルタ用（先頭のドットなし）。 */
export const UNITY_TEXTURE_FILTER_EXTENSIONS = UNITY_TEXTURE_EXTENSIONS.map((e) => e.slice(1));

/**
 * エディタ(Chromium)では開けるが Unity が取り込めない画像形式。
 * 取り込みを断るときに「なぜダメか」を説明するために保持する。
 */
export const UNITY_UNSUPPORTED_TEXTURE_EXTENSIONS = ['.webp', '.avif', '.jxl', '.svg'] as const;

export function getExtension(filePath: string): string {
  const i = filePath.lastIndexOf('.');
  return i < 0 ? '' : filePath.slice(i).toLowerCase();
}

export function isUnityTextureExtension(filePath: string): boolean {
  return (UNITY_TEXTURE_EXTENSIONS as readonly string[]).includes(getExtension(filePath));
}

/**
 * 画像として扱う意図があるのに Unity が取り込めない形式かどうか。
 * 判定できない拡張子（未知）は false を返し、ここでは弾かない。
 */
export function isUnsupportedTextureExtension(filePath: string): boolean {
  return (UNITY_UNSUPPORTED_TEXTURE_EXTENSIONS as readonly string[]).includes(getExtension(filePath));
}
