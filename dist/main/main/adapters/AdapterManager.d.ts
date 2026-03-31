export interface DeviceAdapter {
    id: string;
    name: string;
    manufacturer: string;
    description: string;
    sdkVersion: string;
    unityVersion: string;
    features: AdapterFeatures;
    buildSettings: AdapterBuildSettings;
    patchFiles: PatchFileInfo[];
}
export interface AdapterFeatures {
    tracking6DoF: boolean;
    tracking3DoF: boolean;
    handTracking: boolean;
    planeDetection: boolean;
    imageTracking: boolean;
    passthrough: boolean;
    spatialAudio: boolean;
}
export interface AdapterBuildSettings {
    minSdkVersion: number;
    targetSdkVersion: number;
    targetArchitecture: 'ARM64' | 'ARMv7' | 'x86_64';
    graphicsAPI: 'OpenGLES3' | 'Vulkan';
    orientation: 'Landscape' | 'Portrait' | 'Auto';
    xrLoaderName: string;
    requiredPackages: string[];
}
export interface PatchFileInfo {
    type: 'manifest' | 'script' | 'package' | 'prefab' | 'config';
    sourcePath: string;
    destinationPath: string;
    description: string;
}
export declare class AdapterManager {
    private adaptersDir;
    private adaptersCache;
    constructor();
    private static resolveAdaptersDir;
    /**
     * 利用可能なすべてのアダプターを取得
     */
    listAdapters(): Promise<DeviceAdapter[]>;
    /**
     * 特定のアダプターを取得
     */
    getAdapter(adapterId: string): Promise<DeviceAdapter | null>;
    /**
     * 新しいアダプターを登録
     */
    registerAdapter(adapter: DeviceAdapter): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * アダプターのパッチをUnityプロジェクトに適用
     */
    applyPatch(adapterId: string, unityProjectPath: string): Promise<{
        success: boolean;
        appliedPatches: string[];
        error?: string;
    }>;
    /**
     * アダプターテンプレートを生成（新規デバイス対応時用）
     */
    createAdapterTemplate(deviceName: string, manufacturer: string): Promise<{
        success: boolean;
        path?: string;
        error?: string;
    }>;
    private loadAdapter;
    private updateProjectSettings;
    private updatePackageManifest;
    private createTemplateFiles;
}
//# sourceMappingURL=AdapterManager.d.ts.map