"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdapterManager = void 0;
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
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
const adapterDirs_1 = require("./adapterDirs");
class AdapterManager {
    adaptersDir;
    constructor() {
        this.adaptersDir = (0, adapterDirs_1.findBuiltinAdaptersDir)();
    }
    async read(loc) {
        try {
            const raw = await fs.readJSON(path.join(loc.dir, 'adapter.json'));
            return { ...raw, folder: loc.name, source: loc.source, extensionId: loc.extensionId };
        }
        catch (error) {
            console.error(`Failed to read ${loc.dir}/adapter.json:`, error);
            return null;
        }
    }
    /**
     * 利用可能なすべてのアダプター (エンジン同梱 + 拡張機能が足した端末)。
     * adapter.json の中身に、どこから来たか (folder / source / extensionId) を添えて返す。
     */
    async listAdapters() {
        try {
            const adapters = [];
            for (const loc of await (0, adapterDirs_1.listAdapterLocations)(this.adaptersDir)) {
                const a = await this.read(loc);
                if (a)
                    adapters.push(a);
            }
            return adapters;
        }
        catch (error) {
            console.error('Failed to list adapters:', error);
            return [];
        }
    }
    /**
     * 特定のアダプターを取得 (名前は targetDevice。型番付きでも当たる: src/shared/adapterNames.ts)。
     * 拡張機能の端末は入れ替わることがあるので、覚えておかずに毎回探す。
     */
    async getAdapter(adapterId) {
        const loc = await (0, adapterDirs_1.resolveAdapter)(adapterId, this.adaptersDir);
        return loc ? this.read(loc) : null;
    }
}
exports.AdapterManager = AdapterManager;
//# sourceMappingURL=AdapterManager.js.map