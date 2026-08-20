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
    /**
     * true の場合、作業用Unityプロジェクト（Library/を含む）を捨ててゼロから作り直す。
     * 通常は false（差分ビルド）でよい。キャッシュ由来の不整合を疑うときの逃げ道。
     */
    cleanBuild?: boolean;
}
export interface BuildProgress {
    phase: string;
    progress: number;
    message: string;
}
export declare class UnityBuilder extends EventEmitter {
    private unityPath;
    private sdkDir;
    private currentProcess;
    private unityTemplatePath;
    private buildInProgress;
    private lastLogFile;
    private preparedAndroidSdkPath;
    /** validate() が取得した Unity バージョン文字列（例 "6000.0.40f1"）。パッケージ版数の分岐に使う。 */
    private detectedUnityVersion;
    /** 作業ディレクトリ再利用の互換バージョン。準備処理を変えたら上げる（＝全ユーザーが1回だけ作り直す）。 */
    private static readonly WORKSPACE_CACHE_VERSION;
    private static readonly WORKSPACE_STAMP_FILE;
    private isLicensingNoise;
    constructor(unityPath: string);
    private resolveUnityTemplatePathSync;
    private buildUnityTemplateCandidates;
    private resolveUnityTemplatePath;
    private resolveRepoRoot;
    getUnityPath(): string;
    setUnityPath(unityPath: string): void;
    setSdkDir(sdkDir: string): void;
    private resolveSdkDir;
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
     * ビルド前に IR の「実機で無言に壊れる」組み合わせを検出する。
     *
     * 特に Canvas は、参照先の UILayout が未割り当て/削除済みでもビルド自体は成功し、
     * 実機ではプレースホルダだけが表示される。原因が分かりにくいので、
     * 黙って直したり素通りさせたりせず、ここでビルドを失敗させる。
     */
    private findIrProblems;
    /** UI 要素ツリーを深さ優先で走査する。 */
    private walkUiElements;
    private formatIrProblems;
    /**
     * ビルドキャンセル
     */
    cancel(): void;
    private getUnityVersion;
    private isUnityVersionCompatible;
    private normalizeUnityVersion;
    private compareVersions;
    /** Unity が読み飛ばすディレクトリ（末尾 `~`）と VCS メタデータはコピーしない。 */
    private isSyncExcludedDirName;
    private stampOf;
    /** root 以下のファイルを再帰列挙し、相対パス -> スタンプ の対応表を返す。 */
    private collectFileStamps;
    /**
     * 同期先に置く「前回コピーしたソース側のスタンプ」記録。
     * `.` 始まりのファイルは Unity のアセットパイプラインが無視するので、
     * Assets/ や Packages/ の直下に置いても取り込まれない。
     */
    private static readonly SYNC_MANIFEST_FILE;
    private readSyncManifest;
    /**
     * src -> dest を差分同期する。
     *
     * 変更判定は「ソース側スタンプ」と「前回同期時に記録したソース側スタンプ」の比較で行う。
     * コピー先の mtime を見ないのは、`preserveTimestamps` がサブミリ秒を丸めてしまい
     * 毎回わずかにズレて“変更あり”と誤判定されるため。
     *
     * Unity が生成した `.meta` は、対応するアセットが残っている限り prune しない
     * （消すと GUID が振り直され、結局フルインポートになる）。
     */
    private syncDirectory;
    /**
     * prune 後に残った空ディレクトリを掃除する。
     * `isRoot` の呼び出し（同期先そのもの）は空でも削除しない。
     */
    private removeEmptyDirs;
    /** アセットフォルダと、それに対応する `.meta` をまとめて消す。 */
    private removeAssetFolder;
    /** 作業ディレクトリを作り直すべきか判定するためのフィンガープリント。 */
    private computeSettingsFingerprint;
    private readWorkspaceStamp;
    /**
     * 作業用Unityプロジェクトを用意する。
     *
     * 既存の作業ディレクトリが再利用可能なら Library/ を温存したまま差分更新する。
     * 再利用できない（初回 / テンプレートの ProjectSettings が変わった / Unity を変えた /
     * cleanBuild 指定）場合のみ、ゼロから作り直す。
     */
    private prepareUnityProject;
    /** 作業ディレクトリの中身を消す（保持対象ディレクトリも含めて完全にクリーンにする）。 */
    private resetWorkspaceDir;
    /**
     * uGUI / TextMeshPro をUnityバージョンに合わせて manifest に足す。
     * Unity 6 では TextMeshPro は com.unity.ugui 2.0.0 に統合済みで、
     * 旧 com.unity.textmeshpro を要求すると解決に失敗する。
     */
    private ensureUnityUiPackages;
    /** 検出済み Unity バージョンのメジャー番号（例 6000 / 2022）。不明なら 0。 */
    private getUnityMajorVersion;
    /** uGUI / TextMeshPro の依存をUnityバージョンに応じて設定する。 */
    private applyUnityUiDependencies;
    private projectUsesVRM;
    private resolveUniVRMUnityPackagePath;
    /**
     * .unitypackage を作業プロジェクトへ取り込む。既に同じパッケージを取り込み済みなら何もしない。
     *
     * インポートは Unity をもう1プロセス起動するため数分単位のコストがある。
     * 作業ディレクトリを再利用するようになったので、毎ビルド走らせる必要はない。
     */
    private ensureUnityPackageImported;
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
    private detectAndroidSdkPathCandidate;
    private getAndroidSdkMirrorPath;
    private isPathUnderWindowsProtectedRoot;
    private isDirectoryWritable;
    private prepareWritableAndroidSdkPath;
    private findWindowsExecutablePathSync;
    private ensureWindowsShellAvailability;
    /**
     * Unityプロジェクトの ProjectSettings/AndroidExternalToolsSettings.asset を生成し、
     * JDK / Android SDK / NDK パスを書き込む。
     * Unity はプロジェクト読み込み時にこのファイルを参照するため、プロセス起動前に作成する必要がある。
     */
    private writeAndroidToolchainSettings;
    private executeUnityBuild;
    private parseUnityProgress;
    private verifyBuildOutput;
    /**
     * エラー行と、それに続くインデントされた本文をまとめて1つのメッセージにする。
     *
     * Gradle/AGP は原因を次の行にインデントで書く:
     *     [:nr_loader:] .../AndroidManifest.xml Error:
     *         Namespace 'nrsdk.pack' is used in multiple modules and/or libraries: ...
     * 行単位で拾うと "... Error:" だけがUIに出て、肝心の原因が消えてしまう。
     */
    private collectErrorMessage;
    private readUnityLogIssues;
    private resolveAdapterDir;
    private emitProgress;
}
//# sourceMappingURL=UnityBuilder.d.ts.map