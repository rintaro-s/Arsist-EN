/**
 * Arsist Engine - Adapter Manager
 * 端末アダプタ (Adapters/<name>/adapter.json と、拡張機能が足した Extensions/<id>/Adapters/<name>/) を読む。
 *
 * 場所の解決は adapterDirs.ts だけが行う。ビルドへの適用 (パッチ・マニフェスト・パッケージ) は
 * UnityBuilder と ArsistBuildPipeline の仕事で、ここは読むだけ (エディタの端末の選択肢・FOV・タグ用)。
 * 以前あった applyPatch / registerAdapter / createAdapterTemplate は古い adapter.json の形
 * (patchFiles / buildSettings) を前提にしていて、どこからも呼ばれていなかったので消した。
 * 新しい端末は `npm run ext:new -- <id> --device <Name>` で拡張機能として足す (doc/05, doc/17)。
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { findBuiltinAdaptersDir, listAdapterLocations, resolveAdapter } from './adapterDirs';

/** アダプターがどこから来たか */
export interface AdapterOrigin {
  /** フォルダ名 = targetDevice */
  folder: string;
  source: 'builtin' | 'extension';
  extensionId?: string;
}

/**
 * adapter.json の主な項目 (doc/05)。読むのはエディタの表示とタグ (src/shared/adapterTags.ts) だけなので、
 * 知らない項目もそのまま通す。
 */
export interface DeviceAdapter {
  id: string;
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  device?: { manufacturer?: string; models?: string[]; displayName?: string; category?: string };
  display?: Record<string, unknown>;
  capabilities?: Record<string, boolean>;
  input?: Record<string, unknown>;
  sdk?: Record<string, unknown>;
  build?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  patches?: unknown[];
  [key: string]: unknown;
}

export class AdapterManager {
  private readonly adaptersDir: string | null;

  constructor() {
    this.adaptersDir = findBuiltinAdaptersDir();
  }

  private async read(loc: { dir: string; name: string; source: 'builtin' | 'extension'; extensionId?: string }): Promise<(DeviceAdapter & AdapterOrigin) | null> {
    try {
      const raw = await fs.readJSON(path.join(loc.dir, 'adapter.json'));
      return { ...raw, folder: loc.name, source: loc.source, extensionId: loc.extensionId };
    } catch (error) {
      console.error(`Failed to read ${loc.dir}/adapter.json:`, error);
      return null;
    }
  }

  /**
   * 利用可能なすべてのアダプター (エンジン同梱 + 拡張機能が足した端末)。
   * adapter.json の中身に、どこから来たか (folder / source / extensionId) を添えて返す。
   */
  async listAdapters(): Promise<Array<DeviceAdapter & AdapterOrigin>> {
    try {
      const adapters: Array<DeviceAdapter & AdapterOrigin> = [];
      for (const loc of await listAdapterLocations(this.adaptersDir)) {
        const a = await this.read(loc);
        if (a) adapters.push(a);
      }
      return adapters;
    } catch (error) {
      console.error('Failed to list adapters:', error);
      return [];
    }
  }

  /**
   * 特定のアダプターを取得 (名前は targetDevice。型番付きでも当たる: src/shared/adapterNames.ts)。
   * 拡張機能の端末は入れ替わることがあるので、覚えておかずに毎回探す。
   */
  async getAdapter(adapterId: string): Promise<(DeviceAdapter & AdapterOrigin) | null> {
    const loc = await resolveAdapter(adapterId, this.adaptersDir);
    return loc ? this.read(loc) : null;
  }
}
