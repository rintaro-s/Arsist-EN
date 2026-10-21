/**
 * VRM ファイルの版 (0.x / 1.0) を、glb の JSON の部分だけを読んで見分ける。
 *
 * エンジン標準の読み込み (UniVRM-*.unitypackage) は VRM 0.x しか読めない。VRoid などが今出す VRM 1.0 は、
 * VRM の読み込みを置き換える公式の拡張機能 (Extensions/vrm10) が要る。インスペクタ・ir_validate_project・
 * ビルドはこれで「1.0 を使っているか」を見て、その拡張機能が無効ならはっきり言う
 * (黙っていると実機でキャラクターが出ないだけになる)。
 */
import * as fs from 'fs-extra';

export type VrmSpec = '0.x' | '1.0' | 'unknown';

export function vrmSpecFromGlb(bytes: Buffer): VrmSpec {
  try {
    if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF') return 'unknown';
    const jsonLength = bytes.readUInt32LE(12);
    if (bytes.toString('ascii', 16, 20) !== 'JSON' || 20 + jsonLength > bytes.length) return 'unknown';
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
    const ext = gltf?.extensions ?? {};
    if (ext.VRMC_vrm) return '1.0';
    if (ext.VRM) return '0.x';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** ファイルの先頭 (glb のヘッダと JSON) だけを読む。 */
export async function readVrmSpec(file: string): Promise<VrmSpec> {
  let fd: number | null = null;
  try {
    fd = await fs.open(file, 'r');
    const head = Buffer.alloc(20);
    await fs.read(fd, head, 0, 20, 0);
    if (head.toString('ascii', 0, 4) !== 'glTF') return 'unknown';
    const jsonLength = head.readUInt32LE(12);
    if (jsonLength > 64 * 1024 * 1024) return 'unknown';
    const all = Buffer.alloc(20 + jsonLength);
    head.copy(all, 0);
    await fs.read(fd, all, 20, jsonLength, 20);
    return vrmSpecFromGlb(all);
  } catch {
    return 'unknown';
  } finally {
    if (fd !== null) await fs.close(fd).catch(() => {});
  }
}
