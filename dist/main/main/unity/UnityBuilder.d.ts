/**
 * Arsist Engine - Unity Builder
 * Unity CLI連携によるヘッドレスビルド実行
 */
import { EventEmitter } from 'events';
export interface UnityBuildConfig {
    projectPath: string;
    /** Arsistプロジェクトのルート（project.jsonがあるフォルダ）。Assetsコピーに使用 */
    sourceProjectPath?: string;
    outputPath: string;
    targetDevice: string;
    buildTarget: 'Android' | 'iOS' | 'Windows' | 'MacOS';
    developmentBuild: boolean;
    manifestData: object;
    scenesData: object[];
    uiData: object[];
    unityVersion?: string;
    unityPathOverride?: string;
    buildTimeoutMinutes?: number;
    logFilePath?: string;
    cleanOutput?: boolean;
    /** Unityのライセンスファイル(.ulf)を明示したい場合に指定 */
    manualLicenseFile?: string;
}
export interface BuildProgress {
    phase: string;
    progress: number;
    message: string;
}
export declare class UnityBuilder extends EventEmitter {
    private unityPath;
    private currentProcess;
    private unityTemplatePath;
    private buildInProgress;
    private lastLogFile;
    private isLicensingNoise;
    constructor(unityPath: string);
    private resolveUnityTemplatePath;
    private resolveRepoRoot;
    getUnityPath(): string;
    setUnityPath(unityPath: string): void;
    /**
     * Unity実行環境の検証
     */
    validate(requiredVersion?: string): Promise<{
        valid: boolean;
        version?: string;
        error?: string;
    }>;
    /**
     * ULFファイルの有効性チェック
     */
    private validateLicenseFile;
    private normalizeOsPath;
    private importManualLicense;
    /**
     * ビルド実行
     */
    build(config: UnityBuildConfig): Promise<{
        success: boolean;
        outputPath?: string;
        error?: string;
    }>;
    /**
     * ビルドキャンセル
     */
    cancel(): void;
    private getUnityVersion;
    private isUnityVersionCompatible;
    private normalizeUnityVersion;
    private compareVersions;
    private prepareUnityProject;
    private transferProjectData;
    private applyDevicePatch;
    private isXrealTarget;
    private isQuestTarget;
    private integrateRequiredSdks;
    private integrateXrealSdk;
    private integrateQuestSdk;
    private applyQuestXrBootstrap;
    private readQuestSampleDependencies;
    private applyQuestRequiredDependencies;
    private executeUnityBuild;
    private parseUnityProgress;
    private verifyBuildOutput;
    private readUnityLogIssues;
    private resolveAdapterDir;
    private emitProgress;
}
//# sourceMappingURL=UnityBuilder.d.ts.map