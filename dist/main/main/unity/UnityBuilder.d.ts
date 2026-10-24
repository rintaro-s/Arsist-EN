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
     * Layster.Spatial のランタイムが読む spatial.json (doc/19-layster.md §4.1、lower.ts が作る)。
     * Virtual のビルドでは無い (前のビルドの spatial.json は消える)。
     */
    spatialData?: object;
    /**
     * true の場合、作業用Unityプロジェクト（Library/を含む）を捨ててゼロから作り直す。
     * 通常は false（差分ビルド）でよい。キャッシュ由来の不整合を疑うときの逃げ道。
     */
    cleanBuild?: boolean;
    /**
     * シミュレーター (doc/22-simulation.md、scripts/sim/unity.mjs)。作業用プロジェクトの準備は同じで、最後に APK の代わりに
     * Linux のプレイヤー (playerPath) を作る。ヘッドセットが無いので端末の SDK は入れない (SDK を要る拡張機能も入らない)。
     */
    simulation?: {
        playerPath: string;
    };
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
    /** ユーザーが自分で置いた拡張機能の場所 (<userData>/extensions)。main.ts が設定する */
    private extensionUserDir;
    /** このビルドで有効な拡張機能 (build() の最初に決まり、transfer と stage が使う) */
    private buildExtensions;
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
    setExtensionUserDir(dir: string | null): void;
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
    /** ビルド中か (終了時に「やめていいか」を聞くために使う)。 */
    isBuilding(): boolean;
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
    /**
     * Unity Inference Engine (旧 Sentis)。ONNX を実機で動かすためのパッケージ。
     * 2.2.0〜2.6.x はすべて Unity 6000.0 以降で動く (レジストリの unity フィールド)。
     * 2.6 で ONNX opset 25 まで対応。
     */
    static readonly INFERENCE_PACKAGE = "com.unity.ai.inference";
    static readonly INFERENCE_PACKAGE_VERSION = "2.6.1";
    /**
     * モデル (`infer` op) を使うプロジェクトでだけ Inference Engine を入れる。
     * 常に入れると、使わないプロジェクトの APK までコンピュートシェーダー分 (数 MB) 太る。
     * 外したプロジェクトからは抜く。ArsistBuildPipeline はパッケージの有無で
     * ARSIST_INFERENCE define を立て、無いのにモデルがあれば落とす。
     */
    private ensureInferencePackage;
    /**
     * ProjectSettings.asset の scriptingDefineSymbols に ARSIST_INFERENCE を入れる / 抜く (純粋な文字列処理)。
     * 形は
     *   scriptingDefineSymbols:
     *     Android: GLTFAST;ARSIST_INFERENCE
     * で、空のときは `scriptingDefineSymbols: {}`。Android の行だけを見る (ビルド対象は Android だけ)。
     */
    static syncInferenceDefine(assetText: string, wanted: boolean): string;
    /**
     * シミュレーター: Linux のプレイヤーの define を Android と同じにする (端末の SDK の define は除く)。
     * Unity が起きたときのコンパイルに効くよう、起動前に ProjectSettings.asset を直す (syncInferenceDefine と同じ理由)。
     */
    private syncSimulationDefines;
    /** scriptingDefineSymbols の Standalone の行を、Android の行から端末の SDK の define を抜いたものにする (純粋な文字列処理)。 */
    static simulationDefines(assetText: string): string;
    /** 検出済み Unity バージョンのメジャー番号（例 6000 / 2022）。不明なら 0。 */
    private getUnityMajorVersion;
    /** uGUI / TextMeshPro の依存をUnityバージョンに応じて設定する。 */
    private applyUnityUiDependencies;
    private projectUsesVRM;
    /** 物が使っている VRM のうち、VRM 1.0 のもの (プロジェクトからの相対パス)。 */
    private vrm10ModelsInProject;
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
     * Unity のログファイルから「本当の失敗理由」を拾う。
     *
     * batchmode の Unity は、スクリプトのコンパイルが1件でも通らないと、
     * 何をしようとしていたか（パッケージのインポートでもビルドでも）に関係なく落ちる。
     * その理由は stdout ではなくログファイルにしか出ないため、ここで探して呼び出し側に返す。
     */
    private extractUnityFailureReason;
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
    /**
     * 実機ログの送り先（このマシンの LAN アドレス）を解決する。
     *
     * 「ビルドしたマシンを自動で信頼する」の実体がこれ。ペアリングも設定も要らない代わりに、
     * 焼き込んだアドレスから動いたら届かなくなる（次のビルドで直る）。
     */
    private resolveLogRelay;
    /** このマシンの IPv4 LAN アドレス。ループバックと仮想NICは除く。 */
    private static listLanAddresses;
    private transferProjectData;
    private applyDevicePatch;
    private ensureAndroidCleartextHttpPolicy;
    private isXrealTarget;
    private isQuestTarget;
    private integrateRequiredSdks;
    private integrateXrealSdk;
    private applyXrealRequiredDependencies;
    /**
     * Linux エディタでコンパイルが通らない Meta XR SDK の箇所に当てるパッチ。
     *
     * Meta XR SDK Core 85.0.0 の `Editor/MetaXRSimulator/Installer.cs` は
     * `#if UNITY_EDITOR_WIN / #elif UNITY_EDITOR_OSX` しか持たず、Linux では
     * `downloadedInstallerPath` がどの分岐でも宣言されないため CS0103 になる。
     * これは MetaXRSimulatorCore.Editor アセンブリ全体のコンパイルを失敗させ、
     * その時点で Unity のバッチ処理（UniVRM インポートやビルド）ごと止まる。
     *
     * Meta XR Simulator 自体が Linux 非対応なので、変数は使われない。
     * 「宣言だけ足してコンパイルを通す」のが最小の修正になる。
     *
     * 将来 Meta 側が修正したら正規表現がマッチしなくなり、自動的に何もしなくなる。
     */
    private static readonly QUEST_CORE_LINUX_PATCHES;
    /** パッチ内容を変えたらこの版数を上げる（キャッシュを作り直させるため）。 */
    private static readonly QUEST_CORE_PATCH_VERSION;
    /**
     * Packages/ に置くべき Meta XR SDK Core の tgz を返す。
     * Linux 以外、またはパッチ不要なら元の tgz をそのまま返す。
     */
    private resolveQuestCoreTgz;
    /** tar をサブプロセスで実行する（Linux 限定の処理なので tar の存在を前提にしてよい）。 */
    private runTar;
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
    /**
     * Android ビルドに使える Gradle を探す。
     *
     * Unity は同梱の Gradle (PlaybackEngines/AndroidPlayer/Tools/gradle) を優先して使う。
     * 無ければシステムの Gradle (GRADLE_HOME / PATH) も候補にする。どれも無ければ null。
     * 候補の並びは src/main/platform/paths.ts の getGradleCandidates が決める。
     */
    detectGradle(): Promise<string | null>;
    /**
     * targetSdkVersion に対応する platforms/android-N が SDK に入っているか先に見る。
     *
     * 入っていないと Gradle が「licences have not been accepted」で落ちるが、
     * これは licence の話ではなく単に未インストールという意味で、しかも
     * IL2CPP のコンパイルを全部終えた後、5分以上経ってから出る。
     * ここで先に言えば、その5分を待たずに済む。
     */
    private warnIfTargetSdkPlatformMissing;
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
    /**
     * このビルドの「端末のタグ」「使っている機能」「入る拡張機能」を決める。
     *
     * 端末のタグ = adapter.json (src/shared/adapterTags.ts) + sdk/ に何があるか (sdk:*)。
     * sdk:* はここでしか分からない (エディタ上では保留にしている) ので、拡張機能の条件は
     * ここで最終的に確かめる。合わない拡張機能はビルドから外し、理由をログに出す。
     * 同じプロジェクトを別の端末に出したときに、その端末で動かない拡張機能が外れるのは正常。
     */
    private planExtensions;
    /** sdk/ に置いてあり、この端末のビルドに入る SDK のタグ。 */
    private detectSdkTags;
    /**
     * 有効な拡張機能の C# を Unity プロジェクトに入れ、無効になったものを抜く。
     * 写しは syncDirectory (差分 + .meta 保護) なので、変わっていなければ Unity は再インポートしない。
     */
    private stageExtensions;
    private static readonly OVERRIDES_RECORD;
    private static readonly PACKAGES_RECORD;
    private static readonly UNITYPACKAGES_RECORD;
    private static readonly UNIVRM_MARKER;
    /**
     * 拡張機能の .unitypackage (unity.unitypackages) を作業用の Unity プロジェクトに展開する。
     * Unity のインポートを使わずに自分で展開するのは、置いたファイルを正確に覚えておき、
     * 拡張機能が入らなくなったときにそれだけを消すため (記録: <作業用プロジェクト>/.arsist-extension-unitypackages.json)。
     * 2 つの拡張機能が同じファイルを置こうとしたら止める。
     *
     * @returns 今回置いた (置いてある) ファイルとフォルダ。エンジンの SDK を外すときに残すもの。
     */
    private stageExtensionUnityPackages;
    /**
     * 置き換えられた部品のために、エンジンが入れていた SDK を作業用の Unity プロジェクトから外す
     * (src/shared/engineParts.ts の dropsFromBuild)。今は VRM の読み込みだけ: 拡張機能が自分の UniVRM を
     * 持ってくるので、エンジンの UniVRM 0.x を残すと UniGLTF の版違いがぶつかる。
     * 拡張機能が外れたら、次のビルドで Phase 3.6 がエンジンの UniVRM をもう一度取り込む。
     */
    private dropReplacedEngineSdks;
    /**
     * 拡張機能によるエンジンの改変 (unity.overrides)。
     *
     * Assets/Arsist/<path> を拡張機能の Overrides/<path> で置き換える。置き換える前に、元のファイル
     * (テンプレート UnityBackend/ArsistBuilder/Assets/Arsist/<path>) の SHA-256 が replaces と同じかを見る。
     * エンジンが更新されて元が変わっていたら止める — 古い前提の上書きで、新しいエンジンの修正を黙って消さない。
     * 前回上書きして今回は上書きしないファイルは、元に戻す (記録: Assets/.arsist-overrides.json)。
     */
    private stageEngineOverrides;
    /**
     * 拡張機能の Unity パッケージ (unity.packages)。端末の SDK など。
     * 拡張機能の中のファイル / フォルダは Packages/arsist-ext-<id>/ に写して `file:` で、版の指定はそのまま
     * Packages/manifest.json に足す。エンジンが入れたパッケージは上書きしない (版の食い違いで壊さない)。
     * 前回足して今回は要らないものは外す (記録: Packages/.arsist-extension-packages.json)。
     */
    private stageExtensionPackages;
    /** 中身が同じなら書かない (mtime を変えると Unity が再インポート・再コンパイルする)。 */
    private writeIfChanged;
    /**
     * targetDevice のアダプタのフォルダ。エンジン同梱の Adapters/ と、拡張機能が足した端末の両方から探す
     * (照合の規則は src/shared/adapterNames.ts。型番まで書かれていても拾う: "Meta Quest 3" → Meta_Quest。
     * 一致しないと device patch がまるごと飛び、権限の足りない APK が何事もなく出来上がる)。
     */
    private resolveAdapterDir;
    private emitProgress;
}
//# sourceMappingURL=UnityBuilder.d.ts.map