/**
 * エディタの設定フォルダ (electron-store の userData と同じ場所)。Electron の外 (MCP サーバー) からも同じ場所を指す。
 * 規則は src/main/platform/paths.ts の getConfigDir (ここで写さない)。
 */
import * as os from 'os';
import { getConfigDir, liveContext } from '../platform/paths';

export function arsistConfigDir(): string {
  return getConfigDir(liveContext(os.homedir()));
}
