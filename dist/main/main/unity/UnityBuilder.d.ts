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
    /** スクリプトデータ (scripts.json 相当の内容) */
    scriptsData?: object;
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
    private projectUsesVRM;
    private resolveUniVRMUnityPackagePath;
    private importUnityPackage;
    /**
     * Jint 4.x と Acornima の DLL を Assets/Plugins/ へ配置する。
     * - ローカルの sdk/nupkg/ を優先（オフライン対応）。
     * - なければ NuGet から自動ダウンロード。
     * - Jint.dll / Acornima.dll が両方とも存在する場合はスキップ。
     */
    private ensureJintDlls;
    /** ファイルを HTTP/HTTPS でダウンロードする（リダイレクト追跡） */
    private downloadFile;
    /** .nupkg (=ZIP) を destDir に展開する（PowerShell / unzip / python3 互換） */
    private extractFromZip;
    /** dir 以下を再帰的に検索して fileName に一致する最初のファイルパスを返す */
    private findFileRecursive;
    private transferProjectData;
    private applyDevicePatch;
    private ensureAndroidCleartextHttpPolicy;
    private isXrealTarget;
    private isQuestTarget;
    private integrateRequiredSdks;
    private integrateXrealSdk;
    private applyXrealRequiredDependencies;
    private integrateQuestSdk;
    private applyQuestXrBootstrap;
    private readQuestSampleDependencies;
    private applyQuestRequiredDependencies;
    /**
     * JDKのホームディレクトリを返す。
     * 優先順位: JAVA_HOME env → JDK_HOME env → Unity bundled OpenJDK → 一般的なインストールパス
     */
    private detectJdkPath;
    /** ディレクトリ名からJDKメジャーバージョン番号を抽出. 例: "jdk-17.0.5.8-hotspot" → 17 */
    private parseJdkMajorVersion;
    /**
     * Android SDK ルートディレクトリを返す。
     * 優先順位: ANDROID_HOME → ANDROID_SDK_ROOT → %LOCALAPPDATA%\Android\Sdk
     */
    private detectAndroidSdkPath;
    /**
     * Unityプロジェクトの ProjectSettings/AndroidExternalToolsSettings.asset を生成し、
     * JDK / Android SDK / NDK パスを書き込む。
     * Unity はプロジェクト読み込み時にこのファイルを参照するため、プロセス起動前に作成する必要がある。
     */
    private writeAndroidToolchainSettings;
    private executeUnityBuild;
    private parseUnityProgress;
    private verifyBuildOutput;
    private readUnityLogIssues;
    private resolveAdapterDir;
    private emitProgress;
}
//# sourceMappingURL=UnityBuilder.d.ts.map