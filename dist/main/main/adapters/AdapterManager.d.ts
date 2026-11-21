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
    device?: {
        manufacturer?: string;
        models?: string[];
        displayName?: string;
        category?: string;
    };
    display?: Record<string, unknown>;
    capabilities?: Record<string, boolean>;
    input?: Record<string, unknown>;
    sdk?: Record<string, unknown>;
    build?: Record<string, unknown>;
    manifest?: Record<string, unknown>;
    patches?: unknown[];
    [key: string]: unknown;
}
export declare class AdapterManager {
    private readonly adaptersDir;
    constructor();
    private read;
    /**
     * 利用可能なすべてのアダプター (エンジン同梱 + 拡張機能が足した端末)。
     * adapter.json の中身に、どこから来たか (folder / source / extensionId) を添えて返す。
     */
    listAdapters(): Promise<Array<DeviceAdapter & AdapterOrigin>>;
    /**
     * 特定のアダプターを取得 (名前は targetDevice。型番付きでも当たる: src/shared/adapterNames.ts)。
     * 拡張機能の端末は入れ替わることがあるので、覚えておかずに毎回探す。
     */
    getAdapter(adapterId: string): Promise<(DeviceAdapter & AdapterOrigin) | null>;
}
//# sourceMappingURL=AdapterManager.d.ts.map