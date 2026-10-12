/**
 * IR の modelPath (プロジェクト相対・絶対パス・file: URL) を、エディタが読める arsist-file:// の URL にする。
 * GLB と VRM で同じものを使う。
 */
function toArsistFileUrl(absPath: string): string {
  // Windows パス（バックスラッシュ）をフォワードスラッシュに統一
  let normalized = absPath.replace(/\\/g, '/');
  // 先頭のスラッシュを除去（ただし //で始まる UNC パスは保護）
  if (!normalized.startsWith('//')) normalized = normalized.replace(/^\/+/, '');
  // Windows ドライブレター (C: など) の場合は arsist-file://C:/... 形式
  if (/^[A-Za-z]:/.test(normalized)) return `arsist-file://${encodeURI(normalized)}`;
  // Unix パスは arsist-file:///... 形式
  return `arsist-file:///${encodeURI(normalized)}`;
}

export function resolveModelUrl(modelPath: string | undefined | null, projectPath: string | null): string {
  if (!modelPath) return '';
  if (modelPath.startsWith('arsist-file:')) return modelPath;
  if (modelPath.startsWith('http://') || modelPath.startsWith('https://')) return modelPath;

  if (modelPath.startsWith('file:')) {
    try {
      const u = new URL(modelPath);
      let rawPath = u.pathname;
      // Windows: file:///C:/Users/... の場合、/C: 部分を処理
      if (rawPath.startsWith('/') && /^[A-Za-z]:/.test(rawPath.slice(1))) rawPath = rawPath.slice(1);
      return toArsistFileUrl(rawPath);
    } catch {
      // fallthrough
    }
  }

  const normalized = modelPath.replace(/\\/g, '/');
  // Absolute path (both /path and C:/path for Windows)
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return toArsistFileUrl(normalized);

  // Project-relative asset path (e.g. Assets/Models/foo.glb)
  if (projectPath) {
    const base = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
    return toArsistFileUrl(`${base}/${normalized.replace(/^\/+/, '')}`);
  }
  // Fallback (legacy): interpret as absolute-ish
  return toArsistFileUrl(normalized);
}
