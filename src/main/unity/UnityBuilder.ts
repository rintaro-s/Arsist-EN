/**
 * Arsist Engine - Unity Builder
 * Unity CLI連携によるヘッドレスビルド実行
 */
import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs-extra';
import { app } from 'electron';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { liveContext, getUnityLicenseCandidates } from '../platform/paths';

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

/** 差分同期時に「不要になったファイル」をどこまで消すか。 */
type PruneMode =
  /** 消さない */
  | 'none'
  /** src に無いものは全部消す（srcが唯一の正） */
  | 'mirror'
  /** 前回同期したファイルのうち src から消えたものだけ消す（生成物は残す） */
  | 'tracked';

/** relPath -> "size:mtimeMs" の対応表。差分判定に使う。 */
type FileStampMap = Record<string, string>;

/** 作業ディレクトリのキャッシュ状態を記録するスタンプ。 */
interface WorkspaceStamp {
  version: number;
  unityPath: string;
  /**
   * このワークスペースを組んだときの対象デバイス。
   * デバイスが変わると Packages/ に別デバイスのSDKが残ったままになるため、作り直す。
   */
  targetDevice: string;
  /** ProjectSettings/ と Packages/manifest.json のフィンガープリント。変わったら作り直す。 */
  settingsFingerprint: string;
}

export interface BuildProgress {
  phase: string;
  progress: number;
  message: string;
}

export class UnityBuilder extends EventEmitter {
  private unityPath: string;
  private sdkDir: string = '';
  private currentProcess: ChildProcess | null = null;
  private unityTemplatePath: string;
  private buildInProgress = false;
  private lastLogFile: string | null = null;
  private preparedAndroidSdkPath: string | null = null;
  /** validate() が取得した Unity バージョン文字列（例 "6000.0.40f1"）。パッケージ版数の分岐に使う。 */
  private detectedUnityVersion: string | null = null;

  /** 作業ディレクトリ再利用の互換バージョン。準備処理を変えたら上げる（＝全ユーザーが1回だけ作り直す）。 */
  private static readonly WORKSPACE_CACHE_VERSION = 1;
  private static readonly WORKSPACE_STAMP_FILE = '.arsist-workspace.json';

  private isLicensingNoise(text?: string): boolean {
    const s = text || '';
    return (
      /Access token is unavailable/i.test(s) ||
      /Licensing::Module/i.test(s) ||
      /Licensing::Client/i.test(s) ||
      /LicensingClient has failed validation/i.test(s) ||
      /Code\s*10\s*while verifying Licensing Client signature/i.test(s) ||
      /Exception\s*occ?u?r?e?d?\s+while\s+accepting\s+client\s+connection/i.test(s) ||
      (/System\.IO\.IOException/i.test(s) && /(pipe|\u30D1\u30A4\u30D7)/i.test(s))
    );
  }

  constructor(unityPath: string) {
    super();
    this.unityPath = unityPath;
    // Initial value; will be overridden by resolveUnityTemplatePath() at build/validate time
    this.unityTemplatePath = this.resolveUnityTemplatePathSync();
  }

  private resolveUnityTemplatePathSync(): string {
    const candidates = this.buildUnityTemplateCandidates();
    for (const p of candidates) {
      try {
        if (fs.pathExistsSync(p)) return p;
      } catch { /* ignore */ }
    }
    return candidates[0];
  }

  private buildUnityTemplateCandidates(): string[] {
    const candidates: string[] = [];
    // 1) Packaged app: resources/ (electron-builder extraResources)
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'UnityBackend', 'ArsistBuilder'));
    }
    // 2) Dev: cwd
    candidates.push(path.join(process.cwd(), 'UnityBackend', 'ArsistBuilder'));
    // 3) app.getAppPath()
    try {
      const appPath = app.getAppPath();
      candidates.push(path.join(appPath, 'UnityBackend', 'ArsistBuilder'));
      candidates.push(path.join(path.dirname(appPath), 'UnityBackend', 'ArsistBuilder'));
    } catch { /* ignore */ }
    // 4) Relative from __dirname (dist/main/main/unity -> ../../../../)
    candidates.push(path.join(__dirname, '../../../..', 'UnityBackend', 'ArsistBuilder'));
    candidates.push(path.join(__dirname, '../../..', 'UnityBackend', 'ArsistBuilder'));
    return candidates;
  }

  private resolveUnityTemplatePath(): { path: string | null; searched: string[] } {
    const searched = this.buildUnityTemplateCandidates();

    for (const p of searched) {
      if (fs.pathExistsSync(p)) {
        return { path: p, searched };
      }
    }

    return { path: null, searched };
  }

  private resolveRepoRoot(): { path: string | null; searched: string[] } {
    const searched: string[] = [];

    const candidates: string[] = [];

    // 1) Packaged: process.resourcesPath IS the "repo root" equivalent
    if (process.resourcesPath) {
      candidates.push(process.resourcesPath);
    }

    candidates.push(process.cwd());

    try {
      const appPath = app.getAppPath();
      candidates.push(appPath);
      candidates.push(path.dirname(appPath));
    } catch {
      // ignore
    }

    // dist/main/main/unity -> repoRoot は ../../../..
    candidates.push(path.join(__dirname, '../../../..'));
    candidates.push(path.join(__dirname, '../../..'));

    for (const c of candidates) {
      const root = path.resolve(c);
      if (searched.includes(root)) continue;
      searched.push(root);
      if (fs.pathExistsSync(path.join(root, 'sdk')) && fs.pathExistsSync(path.join(root, 'Adapters'))) {
        return { path: root, searched };
      }
      if (fs.pathExistsSync(path.join(root, 'UnityBackend'))) {
        return { path: root, searched };
      }
      if (fs.pathExistsSync(path.join(root, 'package.json')) && fs.pathExistsSync(path.join(root, 'UnityBackend'))) {
        return { path: root, searched };
      }
    }

    return { path: null, searched };
  }

  getUnityPath(): string {
    return this.unityPath;
  }

  setUnityPath(unityPath: string): void {
    this.unityPath = unityPath;
  }

  setSdkDir(sdkDir: string): void {
    this.sdkDir = sdkDir;
  }

  private resolveSdkDir(): string {
    if (this.sdkDir && this.sdkDir.trim()) return this.sdkDir.trim();
    const resolvedRepo = this.resolveRepoRoot();
    if (resolvedRepo.path) return path.join(resolvedRepo.path, 'sdk');
    // Final fallback: packaged resources or cwd
    if (process.resourcesPath) return path.join(process.resourcesPath, 'sdk');
    return path.join(process.cwd(), 'sdk');
  }

  /**
   * Unity実行環境の検証
   */
  async validate(requiredVersion?: string): Promise<{ valid: boolean; version?: string; error?: string }> {
    try {
      // Unityパスの存在確認
      if (!await fs.pathExists(this.unityPath)) {
        return { valid: false, error: 'Unity executable not found' };
      }

      // バージョン取得
      const version = await this.getUnityVersion();
      this.detectedUnityVersion = this.normalizeUnityVersion(version) || version;

      // UnityBackendプロジェクトの存在確認
      const resolved = this.resolveUnityTemplatePath();
      if (!resolved.path) {
        return {
          valid: false,
          error: `Unity backend project not found. Please run setup first.\nSearched:\n- ${resolved.searched.join('\n- ')}`,
        };
      }
      this.unityTemplatePath = resolved.path;

      const projectAssets = path.join(this.unityTemplatePath, 'Assets');
      const projectSettings = path.join(this.unityTemplatePath, 'ProjectSettings');
      if (!await fs.pathExists(projectAssets) || !await fs.pathExists(projectSettings)) {
        return { valid: false, error: 'Unity backend project is incomplete (Assets/ProjectSettings missing)' };
      }

      if (requiredVersion) {
        const isCompatible = this.isUnityVersionCompatible(version, requiredVersion);
        if (!isCompatible) {
          return { valid: false, version, error: `Unity version mismatch. Required: ${requiredVersion}, Actual: ${version}` };
        }
      }

      return { valid: true, version };
    } catch (error) {
      return { valid: false, error: (error as Error).message };
    }
  }

  /**
   * ULFファイルの有効性チェック
   */
  private async validateLicenseFile(ulfPath: string): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!await fs.pathExists(ulfPath)) {
        return { valid: false, error: `License file not found: ${ulfPath}` };
      }
      
      const stat = await fs.stat(ulfPath);
      if (stat.size === 0) {
        return { valid: false, error: `License file is empty: ${ulfPath}` };
      }
      
      const content = await fs.readFile(ulfPath, 'utf-8');
      // Basic ULF file format check (should contain XML or specific markers)
      if (!content.includes('LICENSE') && !content.includes('license') && !content.includes('Unity')) {
        return { valid: false, error: `License file format invalid: ${ulfPath}` };
      }
      
      return { valid: true };
    } catch (error) {
      return { valid: false, error: `Failed to validate license file: ${(error as Error).message}` };
    }
  }

  private normalizeOsPath(p: string): string {
    if (!p) return p;
    if (process.platform === 'win32') {
      return p.replace(/\//g, '\\');
    }
    return p.replace(/\\/g, '/');
  }

  private async importManualLicense(ulfPath: string, logFile: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const args = [
        '-batchmode',
        '-nographics',
        '-quit',
        '-manualLicenseFile', this.normalizeOsPath(ulfPath),
        '-logFile', this.normalizeOsPath(logFile),
      ];

      const needsQuotes = (str: string) => str.includes(' ') || str.includes('"');
      const quoteForLog = (str: string) => needsQuotes(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
      this.emit('log', `[Unity] Importing manual license: ${quoteForLog(this.unityPath)} ${args.map(quoteForLog).join(' ')}`);

      const env = { ...process.env };
      if (!env.HOME) {
        try {
          env.HOME = process.platform === 'win32' ? (env.USERPROFILE || app.getPath('home')) : app.getPath('home');
        } catch {
          // ignore
        }
      }
      env.UNITY_LICENSE_FILE = ulfPath;

      const p = spawn(this.unityPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        shell: false,
        windowsHide: true,
      });

      const chunks: string[] = [];
      p.stdout?.on('data', (d) => chunks.push(d.toString()));
      p.stderr?.on('data', (d) => chunks.push(d.toString()));

      const timeout = setTimeout(() => {
        try {
          if (process.platform === 'win32') p.kill();
          else p.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve({ success: false, error: 'Unity license import timed out' });
      }, 5 * 60 * 1000);

      p.on('close', async (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ success: true });
          return;
        }

        try {
          const issues = await this.readUnityLogIssues(logFile);
          if (issues.errors.length > 0) {
            resolve({ success: false, error: issues.errors[0] });
            return;
          }
        } catch {
          // ignore
        }

        const combined = chunks.join('\n');
        resolve({ success: false, error: combined.trim() || `Unity license import failed with exit code ${code}` });
      });

      p.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ success: false, error: err.message });
      });
    });
  }

  /**
   * ビルド実行
   */
  async build(config: UnityBuildConfig): Promise<{ success: boolean; outputPath?: string; error?: string }> {
    try {
      if (this.buildInProgress || this.currentProcess) {
        return { success: false, error: 'Build already in progress' };
      }

      this.buildInProgress = true;
      this.lastLogFile = null;
      this.emitProgress('prepare', 0, 'ビルド準備中...');

      const unityPathToUse = config.unityPathOverride || this.unityPath;
      if (unityPathToUse !== this.unityPath) {
        this.unityPath = unityPathToUse;
      }

      const validation = await this.validate(config.unityVersion);
      if (!validation.valid) {
        return { success: false, error: validation.error || 'Unity validation failed' };
      }

      // ULFファイルの有効性チェック
      if (config.manualLicenseFile) {
        const licenseValidation = await this.validateLicenseFile(config.manualLicenseFile);
        if (!licenseValidation.valid) {
          this.emit('log', `[Arsist] Warning: ${licenseValidation.error}`);
          // ULFファイルが無効でもビルド続行（代替手段がある）
        } else {
          this.emit('log', `[Arsist] License file validated: ${config.manualLicenseFile}`);
        }
      }

      if (!config.projectPath || !config.outputPath) {
        return { success: false, error: 'Invalid build configuration: projectPath/outputPath is required' };
      }

      // projectPath は「作業用Unityプロジェクト」を展開するディレクトリ。
      // まだ存在しないのが正常なので、ここで作成する。
      try {
        if (await fs.pathExists(config.projectPath)) {
          const stat = await fs.stat(config.projectPath);
          if (!stat.isDirectory()) {
            return { success: false, error: `Project path is not a directory: ${config.projectPath}` };
          }
        } else {
          await fs.ensureDir(config.projectPath);
        }
      } catch (error) {
        return { success: false, error: `Failed to prepare project path: ${(error as Error).message}` };
      }

      if (!config.targetDevice || !config.buildTarget) {
        return { success: false, error: 'Invalid build configuration: targetDevice/buildTarget is required' };
      }

      await fs.ensureDir(config.outputPath);
      if (config.cleanOutput) {
        // 作業用Unityプロジェクトは outputPath の下にあるため、巻き添えで消さない。
        // （消すと Library/ が飛んで毎回フルビルドになる。クリーンにしたい場合は cleanBuild を使う）
        const workspaceName = path.resolve(config.projectPath).startsWith(path.resolve(config.outputPath))
          ? path.basename(path.resolve(config.projectPath))
          : null;
        for (const entry of await fs.readdir(config.outputPath)) {
          if (workspaceName && entry === workspaceName) continue;
          await fs.remove(path.join(config.outputPath, entry));
        }
      }

      // ULF(.ulf)が指定されている場合、Unityは「ライセンス取り込みだけして終了」することがあるため
      // 先に取り込みを完了させてから、本ビルドは -manualLicenseFile なしで実行する。
      const manualLicenseFileToImport = config.manualLicenseFile;
      if (manualLicenseFileToImport) {
        const licenseValidation = await this.validateLicenseFile(manualLicenseFileToImport);
        if (!licenseValidation.valid) {
          return { success: false, error: licenseValidation.error || 'Invalid license file' };
        }
        const licenseLog = path.join(config.outputPath, 'unity_license_import.log');
        const imported = await this.importManualLicense(manualLicenseFileToImport, licenseLog);
        if (!imported.success) {
          return { success: false, error: imported.error || 'Failed to import Unity license' };
        }
        this.emit('log', '[Arsist] Manual license imported successfully. Continuing to build...');
      }

      // Phase 1: Unityワークディレクトリ準備
      this.emitProgress('prepare-unity', 5, 'Unityプロジェクトを準備中...');
      const unityProjectPath = await this.prepareUnityProject(config.projectPath, {
        cleanBuild: config.cleanBuild,
        targetDevice: config.targetDevice,
      });

      // Phase 1.5: Jint/Esprima DLL を確認/ダウンロード
      this.emitProgress('prepare-jint', 8, 'Jintスクリプトエンジンを準備中...');
      await this.ensureJintDlls(unityProjectPath);

      // Phase 2: データ転送
      this.emitProgress('transfer', 10, 'プロジェクトデータを転送中...');
      await this.transferProjectData(unityProjectPath, config);

      // Phase 3: パッチ適用
      this.emitProgress('patch', 30, 'SDKパッチを適用中...');
      await this.applyDevicePatch(unityProjectPath, config.targetDevice);

      // Phase 3.5: 必須SDKをUnityプロジェクトへ組み込み
      this.emitProgress('sdk', 40, '必須SDKを確認/組み込み中...');
      await this.integrateRequiredSdks(unityProjectPath, config.targetDevice);

      // Phase 3.55: Android ツールチェーン設定ファイルを注入
      // Unity はプロジェクト読み込み時に ProjectSettings/AndroidExternalToolsSettings.asset を参照するため
      // プロセス起動前に書き込んでおく必要がある。
      await this.writeAndroidToolchainSettings(unityProjectPath);

      // Phase 3.6: VRMプロジェクトならUniVRMパッケージをインポート
      if (this.projectUsesVRM(config)) {
        this.emitProgress('sdk-vrm', 45, 'UniVRMパッケージをインポート中...');
        
        // UniVRMパッケージを解決
        const univrmPackage = await this.resolveUniVRMUnityPackagePath();
        if (!univrmPackage) {
          return {
            success: false,
            error: 'UniVRM package not found in sdk/ directory. Please place UniVRM-0.131.0_3b99.unitypackage or later.'
          };
        }

        this.emit('log', `[Arsist] Found UniVRM package: ${univrmPackage}`);
        
        // UniVRMパッケージをインポート（同じパッケージなら2回目以降はスキップされる）
        const importLog = path.join(config.outputPath, 'unity_univrm_import.log');
        const importResult = await this.ensureUnityPackageImported(
          unityProjectPath,
          univrmPackage,
          '.arsist-univrm.json',
          importLog,
        );

        if (!importResult.success) {
          this.emit('log', `[Arsist] UniVRM package import FAILED: ${importResult.error}`);
          this.emit('log', `[Arsist] Check log file: ${importLog}`);
          return {
            success: false,
            error: `UniVRM package import failed: ${importResult.error}`
          };
        }

        this.emit('log', '[Arsist] UniVRM package imported successfully');
        
        // link.xml更新：IL2CPP stripping対策
        this.emitProgress('sdk-vrm-protect', 48, 'VRM型保護を設定中...');
        const linkXmlPath = path.join(unityProjectPath, 'Assets', 'link.xml');
        try {
          let linkXmlContent = '';
          if (await fs.pathExists(linkXmlPath)) {
            linkXmlContent = await fs.readFile(linkXmlPath, 'utf-8');
          } else {
            linkXmlContent = `<?xml version="1.0" encoding="utf-8"?>
<linker>
</linker>
`;
          }
          
          // MToon保護エントリがない場合のみ追加
          if (!linkXmlContent.includes('com.vrmc.univrm.mtoon')) {
            const insertPoint = linkXmlContent.lastIndexOf('</linker>');
            if (insertPoint > 0) {
              const vrmPreservation = `  <assembly fullname="com.vrmc.univrm.mtoon">
    <type fullname="*" preserve="all" />
  </assembly>
  <assembly fullname="UniGLTF">
    <type fullname="*" preserve="all" />
  </assembly>
`;
              linkXmlContent = linkXmlContent.slice(0, insertPoint) + vrmPreservation + linkXmlContent.slice(insertPoint);
              await fs.writeFile(linkXmlPath, linkXmlContent, 'utf-8');
              this.emit('log', '[Arsist] Updated link.xml with VRM type preservation');
            }
          }
        } catch (err) {
          this.emit('log', `[Arsist] Warning: failed to update link.xml: ${(err as Error).message}`);
        }
      }

      // Phase 4: Unityビルド実行
      this.emitProgress('build', 50, 'Unityビルドを実行中...');
      const buildStartedAt = Date.now();
      const isLicensingError = (msg?: string) => {
        return this.isLicensingNoise(msg);
      };

      const findManualLicenseFile = async (): Promise<string | null> => {
        // Unity Hubでログイン済みでも、ヘッドレス環境ではtoken更新に失敗することがある。
        // その場合に備えて、ローカルの .ulf を指定して起動できるようにする。
        // 配置先は OS ごとに異なるため platform ヘルパで全 OS 分を列挙する
        // (以前は Linux パスのみで、Windows/macOS では自動発見できなかった)。
        const home = (() => {
          try {
            return app.getPath('home');
          } catch {
            return process.env.HOME || process.env.USERPROFILE || os.homedir();
          }
        })();

        const candidates = getUnityLicenseCandidates(liveContext(home));

        for (const p of candidates) {
          try {
            if (p && await fs.pathExists(p)) return p;
          } catch {
            // ignore
          }
        }
        return null;
      };

      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      // まずは従来通り -nographics で実行
      let buildResult = await this.executeUnityBuild(unityProjectPath, config, {
        batchMode: true,
        noGraphics: true,
        // ライセンス取り込みは事前に完了させるため、ここでは指定しない
      });

      // Licensing系でも「今回のビルドで成果物が生成されている」なら、失敗扱い/リトライを避ける
      if (!buildResult.success && isLicensingError(buildResult.error)) {
        const maybeOutput = await this.verifyBuildOutput(config, { sinceEpochMs: buildStartedAt });
        if (maybeOutput) {
          this.emit('log', `[Arsist] Licensing error observed, but a fresh output exists. Treating as success: ${maybeOutput}`);
          buildResult = { success: true };
        }
      }

      // Licensing系は“たまに”失敗することがあり、短時間のリトライで復旧することがある
      if (!buildResult.success && isLicensingError(buildResult.error)) {
        this.emit('log', '[Arsist] Unity licensing failed. Retrying once after 10s...');
        await sleep(10_000);
        buildResult = await this.executeUnityBuild(unityProjectPath, config, {
          batchMode: true,
          noGraphics: true,
          // ライセンス取り込みは事前に完了させるため、ここでは指定しない
        });

        if (!buildResult.success && isLicensingError(buildResult.error)) {
          const maybeOutput = await this.verifyBuildOutput(config, { sinceEpochMs: buildStartedAt });
          if (maybeOutput) {
            this.emit('log', `[Arsist] Licensing error observed, but a fresh output exists. Treating as success: ${maybeOutput}`);
            buildResult = { success: true };
          }
        }
      }

      // LinuxでDISPLAYがある場合は、さらに1回だけ -nographics を外して試す（環境依存の認証問題の回避狙い）
      if (!buildResult.success && isLicensingError(buildResult.error) && process.platform === 'linux' && process.env.DISPLAY) {
        this.emit('log', '[Arsist] Unity licensing still failing. Retrying without -nographics...');
        await sleep(5_000);
        buildResult = await this.executeUnityBuild(unityProjectPath, config, {
          batchMode: true,
          noGraphics: false,
          // ライセンス取り込みは事前に完了させるため、ここでは指定しない
        });
      }

      // Windowsでも最終手段としてGUI起動を試す（UIでのログイン/認証が必要な環境向け）
      if (!buildResult.success && isLicensingError(buildResult.error) && process.platform === 'win32') {
        this.emit('log', '[Arsist] Unity licensing still failing on Windows. Retrying with GUI (no -batchmode / no -nographics)...');
        await sleep(2_000);
        buildResult = await this.executeUnityBuild(unityProjectPath, config, {
          batchMode: false,
          noGraphics: false,
          // ライセンス取り込みは事前に完了させるため、ここでは指定しない
        });
      }

      // 最終手段: batchmode を外してGUI起動（DISPLAYがある環境のみ）
      if (!buildResult.success && isLicensingError(buildResult.error) && process.platform === 'linux' && process.env.DISPLAY) {
        this.emit('log', '[Arsist] Unity licensing still failing. Retrying without -batchmode (GUI fallback)...');
        await sleep(2_000);
        buildResult = await this.executeUnityBuild(unityProjectPath, config, {
          batchMode: false,
          noGraphics: false,
          manualLicenseFile: config.manualLicenseFile || undefined,
        });
      }

      // それでもダメなら、ローカルのライセンスファイルを明示してさらに1回だけ試す
      if (!buildResult.success && isLicensingError(buildResult.error)) {
        const manualLicenseFile = await findManualLicenseFile();
        if (manualLicenseFile) {
          this.emit('log', `[Arsist] Unity licensing still failing. Retrying with -manualLicenseFile: ${manualLicenseFile}`);
          await sleep(2_000);
          // 取り込み→ビルドの順で実施
          const licenseLog = path.join(config.outputPath, 'unity_license_import_retry.log');
          const imported = await this.importManualLicense(manualLicenseFile, licenseLog);
          if (imported.success) {
            buildResult = await this.executeUnityBuild(unityProjectPath, config, {
              batchMode: true,
              noGraphics: true,
            });
          }
        }
      }

      // 最後の手段: ULFファイルなしで再試行（Unity Hubのキャッシュを使用）
      if (!buildResult.success && isLicensingError(buildResult.error) && config.manualLicenseFile) {
        this.emit('log', '[Arsist] Licensing error persists. Retrying without manual license file (using Unity Hub cache)...');
        await sleep(3_000);
        buildResult = await this.executeUnityBuild(unityProjectPath, config, {
          batchMode: true,
          noGraphics: true,
          // manualLicenseFile を intentionally 指定しない
        });
      }

      // OpenXR は初回インポート直後のバッチビルドで
      // "OpenXR Settings found in project but not yet loaded. Please build again." が出ることがある。
      // その場合は同一プロジェクトで 1 回だけリトライして前に進める。
      if (!buildResult.success && /OpenXR Settings found in project but not yet loaded/i.test(buildResult.error || '')) {
        this.emit('log', '[Arsist] OpenXR settings not loaded yet. Retrying Unity build once...');
        buildResult = await this.executeUnityBuild(unityProjectPath, config);
      }

      // Phase 4: 出力ファイル確認（Unityがエラー終了しても成果物が出るケースがあるため、常に確認する）
      this.emitProgress('verify', 90, 'ビルド結果を確認中...');
      const outputFile = await this.verifyBuildOutput(config, { sinceEpochMs: buildStartedAt });

      if (!outputFile) {
        if (!buildResult.success) {
          return { success: false, error: buildResult.error || 'Unity build failed and no output was produced' };
        }
        return { success: false, error: 'Build output not found' };
      }

      if (!buildResult.success) {
        // 過去に「Licensingエラー等が出てもAPKは生成される」ケースがある。
        // ここでは成果物優先で成功扱いにし、ログに警告だけ残す。
        this.emit('log', `[Arsist] Unity reported failure, but output exists. Treating as success: ${outputFile}`);
        if (buildResult.error) {
          this.emit('log', `[Arsist] Unity reported error (ignored): ${buildResult.error}`);
        }
      }

      this.emitProgress('complete', 100, 'ビルド完了！');
      return { success: true, outputPath: outputFile };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    } finally {
      this.buildInProgress = false;
    }
  }

  /**
   * ビルドキャンセル
   */
  cancel(): void {
    if (this.currentProcess) {
      // Windows: シグナルが使えないため通常のkill()を使用
      if (process.platform === 'win32') {
        this.currentProcess.kill();
      } else {
        this.currentProcess.kill('SIGTERM');
      }
      this.currentProcess = null;
      this.emit('log', '[Arsist] Build cancelled by user');
    }
  }

  // ========================================
  // Private Methods
  // ========================================

  private async getUnityVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(this.unityPath, ['-version'], { stdio: 'pipe' });
      let output = '';

      process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error('Failed to get Unity version'));
        }
      });

      process.on('error', reject);
    });
  }

  private isUnityVersionCompatible(actual: string, required: string): boolean {
    const actualVersion = this.normalizeUnityVersion(actual);
    const requiredVersion = this.normalizeUnityVersion(required);
    if (!actualVersion || !requiredVersion) return true;
    return this.compareVersions(actualVersion, requiredVersion) >= 0;
  }

  private normalizeUnityVersion(version: string): string | null {
    const match = version.match(/\d+\.\d+\.\d+(?:f\d+)?/);
    return match ? match[0] : null;
  }

  private compareVersions(a: string, b: string): number {
    const parse = (v: string) => v.replace('f', '.').split('.').map(n => parseInt(n, 10));
    const av = parse(a);
    const bv = parse(b);
    const len = Math.max(av.length, bv.length);
    for (let i = 0; i < len; i++) {
      const diff = (av[i] || 0) - (bv[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  // ----------------------------------------------------------------
  // 差分同期ユーティリティ
  //
  // 以前は毎ビルドで作業ディレクトリを emptyDir + フルコピーしていたため、
  // Unity から見ると常に「新規プロジェクト」= 全アセット再インポート＋全C#再コンパイル＋
  // IL2CPPフルビルド＋Gradleフルビルドになっていた。ここでは mtime/size 比較で
  // 変わったファイルだけを touch し、Library/ を温存することでインクリメンタルにする。
  // ----------------------------------------------------------------

  /** Unity が読み飛ばすディレクトリ（末尾 `~`）と VCS メタデータはコピーしない。 */
  private isSyncExcludedDirName(name: string): boolean {
    return name.endsWith('~') || name === '.git' || name === '.svn' || name === 'node_modules';
  }

  private stampOf(stat: fs.Stats): string {
    // mtimeMs はファイルシステムによって小数以下の精度が違うため ms 単位に丸める
    return `${stat.size}:${Math.floor(stat.mtimeMs)}`;
  }

  /** root 以下のファイルを再帰列挙し、相対パス -> スタンプ の対応表を返す。 */
  private async collectFileStamps(root: string, relBase = ''): Promise<FileStampMap> {
    const result: FileStampMap = {};
    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(path.join(root, relBase), { withFileTypes: true });
    } catch {
      return result;
    }

    for (const entry of entries) {
      const rel = relBase ? path.join(relBase, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (this.isSyncExcludedDirName(entry.name)) continue;
        Object.assign(result, await this.collectFileStamps(root, rel));
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        result[rel] = this.stampOf(await fs.stat(path.join(root, rel)));
      } catch {
        // 読めないファイルは無視（同期対象外）
      }
    }

    return result;
  }

  /**
   * 同期先に置く「前回コピーしたソース側のスタンプ」記録。
   * `.` 始まりのファイルは Unity のアセットパイプラインが無視するので、
   * Assets/ や Packages/ の直下に置いても取り込まれない。
   */
  private static readonly SYNC_MANIFEST_FILE = '.arsist-sync.json';

  private async readSyncManifest(dest: string): Promise<FileStampMap> {
    try {
      const data = await fs.readJSON(path.join(dest, UnityBuilder.SYNC_MANIFEST_FILE));
      return (data && typeof data === 'object' ? data : {}) as FileStampMap;
    } catch {
      return {};
    }
  }

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
  private async syncDirectory(
    src: string,
    dest: string,
    options?: { prune?: PruneMode },
  ): Promise<{ stamps: FileStampMap; copied: number; removed: number }> {
    const prune: PruneMode = options?.prune ?? 'none';
    const stamps = await this.collectFileStamps(src);
    await fs.ensureDir(dest);
    const recorded = await this.readSyncManifest(dest);

    let copied = 0;
    for (const [rel, stamp] of Object.entries(stamps)) {
      const destPath = path.join(dest, rel);
      if (recorded[rel] === stamp && await fs.pathExists(destPath)) continue;

      await fs.ensureDir(path.dirname(destPath));
      await fs.copy(path.join(src, rel), destPath, { overwrite: true, preserveTimestamps: true });
      copied++;
    }

    let removed = 0;
    if (prune !== 'none') {
      const candidates = prune === 'tracked'
        ? Object.keys(recorded)
        : Object.keys(await this.collectFileStamps(dest));

      for (const rel of candidates) {
        if (stamps[rel] !== undefined) continue;
        if (rel === UnityBuilder.SYNC_MANIFEST_FILE) continue;
        // 対応するアセット（ファイル or フォルダ）が残っている .meta は Unity の資産なので残す
        if (rel.endsWith('.meta')) {
          const owner = rel.slice(0, -'.meta'.length);
          if (stamps[owner] !== undefined) continue;
          if (await fs.pathExists(path.join(src, owner))) continue;
        }
        const destPath = path.join(dest, rel);
        if (!await fs.pathExists(destPath)) continue;
        await fs.remove(destPath);
        removed++;
      }
      await this.removeEmptyDirs(dest);
    }

    await fs.writeJSON(path.join(dest, UnityBuilder.SYNC_MANIFEST_FILE), stamps, { spaces: 0 });

    return { stamps, copied, removed };
  }

  /**
   * prune 後に残った空ディレクトリを掃除する。
   * `isRoot` の呼び出し（同期先そのもの）は空でも削除しない。
   */
  private async removeEmptyDirs(root: string, isRoot = true): Promise<boolean> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return false;
    }

    let remaining = 0;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const emptied = await this.removeEmptyDirs(path.join(root, entry.name), false);
        if (!emptied) remaining++;
      } else {
        remaining++;
      }
    }

    if (remaining === 0 && !isRoot) {
      try {
        await fs.rmdir(root);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /** アセットフォルダと、それに対応する `.meta` をまとめて消す。 */
  private async removeAssetFolder(assetsRoot: string, relative: string): Promise<void> {
    const target = path.join(assetsRoot, relative);
    await fs.remove(target).catch(() => {});
    await fs.remove(`${target}.meta`).catch(() => {});
  }

  /** 作業ディレクトリを作り直すべきか判定するためのフィンガープリント。 */
  private async computeSettingsFingerprint(templatePath: string): Promise<string> {
    const parts: string[] = [];
    const projectSettings = await this.collectFileStamps(path.join(templatePath, 'ProjectSettings'));
    for (const rel of Object.keys(projectSettings).sort()) {
      parts.push(`ProjectSettings/${rel}=${projectSettings[rel]}`);
    }
    try {
      const manifestStat = await fs.stat(path.join(templatePath, 'Packages', 'manifest.json'));
      parts.push(`Packages/manifest.json=${this.stampOf(manifestStat)}`);
    } catch {
      parts.push('Packages/manifest.json=missing');
    }
    return crypto.createHash('sha1').update(parts.join('\n')).digest('hex');
  }

  private async readWorkspaceStamp(workingDir: string): Promise<WorkspaceStamp | null> {
    try {
      const stamp = await fs.readJSON(path.join(workingDir, UnityBuilder.WORKSPACE_STAMP_FILE));
      if (!stamp || typeof stamp !== 'object') return null;
      return stamp as WorkspaceStamp;
    } catch {
      return null;
    }
  }

  /**
   * 作業用Unityプロジェクトを用意する。
   *
   * 既存の作業ディレクトリが再利用可能なら Library/ を温存したまま差分更新する。
   * 再利用できない（初回 / テンプレートの ProjectSettings が変わった / Unity を変えた /
   * cleanBuild 指定）場合のみ、ゼロから作り直す。
   */
  private async prepareUnityProject(
    workingDir: string,
    options: { cleanBuild?: boolean; targetDevice: string },
  ): Promise<string> {
    await fs.ensureDir(workingDir);

    const settingsFingerprint = await this.computeSettingsFingerprint(this.unityTemplatePath);
    const previous = await this.readWorkspaceStamp(workingDir);
    const hasLibrary = await fs.pathExists(path.join(workingDir, 'Library'));

    const reuseBlocker = options.cleanBuild
      ? 'clean build requested'
      : !previous
        ? 'no previous workspace stamp'
        : previous.version !== UnityBuilder.WORKSPACE_CACHE_VERSION
          ? 'workspace cache format changed'
          : previous.unityPath !== this.unityPath
            ? 'Unity editor changed'
            : previous.targetDevice !== options.targetDevice
              ? `target device changed (${previous.targetDevice} -> ${options.targetDevice})`
              : previous.settingsFingerprint !== settingsFingerprint
                ? 'template ProjectSettings/manifest changed'
                : !hasLibrary
                  ? 'Library/ missing'
                  : null;

    if (reuseBlocker) {
      this.emit('log', `[Arsist] Preparing a fresh Unity workspace (${reuseBlocker})`);
      await this.resetWorkspaceDir(workingDir);
      await fs.copy(this.unityTemplatePath, workingDir, { preserveTimestamps: true });
    }

    // ProjectSettings / Packages はビルド中に書き換えられるため同期対象にしない。
    // （テンプレートへ戻すと毎回 define などが変わって全C#再コンパイルになる）
    // 新規作成直後でも呼ぶことで、同期記録（.arsist-sync.json）を残しておく。
    const sync = await this.syncDirectory(
      path.join(this.unityTemplatePath, 'Assets'),
      path.join(workingDir, 'Assets'),
      { prune: 'tracked' },
    );

    if (!reuseBlocker) {
      this.emit(
        'log',
        `[Arsist] Reusing Unity workspace (Library kept): ${sync.copied} file(s) updated, ${sync.removed} removed`,
      );
    }

    // 毎ビルド作り直す生成物。前回のプロジェクトの残骸が混ざるとビルド対象シーンや
    // アダプターのEditorスクリプトが二重になるので、ここで必ず消す。
    const assetsRoot = path.join(workingDir, 'Assets');
    await this.removeAssetFolder(assetsRoot, 'Scenes');
    await this.removeAssetFolder(assetsRoot, path.join('Arsist', 'Editor', 'Adapters'));

    await this.ensureUnityUiPackages(workingDir);

    await fs.writeJSON(
      path.join(workingDir, UnityBuilder.WORKSPACE_STAMP_FILE),
      {
        version: UnityBuilder.WORKSPACE_CACHE_VERSION,
        unityPath: this.unityPath,
        targetDevice: options.targetDevice,
        settingsFingerprint,
      } satisfies WorkspaceStamp,
      { spaces: 0 },
    );

    return workingDir;
  }

  /** 作業ディレクトリの中身を消す（保持対象ディレクトリも含めて完全にクリーンにする）。 */
  private async resetWorkspaceDir(workingDir: string): Promise<void> {
    await fs.emptyDir(workingDir);
  }

  /**
   * uGUI / TextMeshPro をUnityバージョンに合わせて manifest に足す。
   * Unity 6 では TextMeshPro は com.unity.ugui 2.0.0 に統合済みで、
   * 旧 com.unity.textmeshpro を要求すると解決に失敗する。
   */
  private async ensureUnityUiPackages(workingDir: string): Promise<void> {
    const manifestPath = path.join(workingDir, 'Packages', 'manifest.json');
    if (!await fs.pathExists(manifestPath)) return;

    const manifest = await fs.readJSON(manifestPath);
    const dependencies = (manifest.dependencies ?? {}) as Record<string, string>;
    const before = JSON.stringify(dependencies);

    this.applyUnityUiDependencies(dependencies);

    if (JSON.stringify(dependencies) !== before) {
      manifest.dependencies = dependencies;
      await fs.writeJSON(manifestPath, manifest, { spaces: 2 });
      this.emit('log', `[Arsist] Unity UI packages ensured for ${this.getUnityMajorVersion() >= 6000 ? 'Unity 6+' : 'Unity 2022'}`);
    }
  }

  /** 検出済み Unity バージョンのメジャー番号（例 6000 / 2022）。不明なら 0。 */
  private getUnityMajorVersion(): number {
    const match = (this.detectedUnityVersion || '').match(/(\d+)\.\d+\.\d+/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /** uGUI / TextMeshPro の依存をUnityバージョンに応じて設定する。 */
  private applyUnityUiDependencies(deps: Record<string, string>): void {
    if (this.getUnityMajorVersion() >= 6000) {
      // Unity 6: TextMeshPro は com.unity.ugui 2.x に同梱。旧パッケージは入れてはいけない。
      deps['com.unity.ugui'] = '2.0.0';
      delete deps['com.unity.textmeshpro'];
      return;
    }

    if (!deps['com.unity.ugui']) deps['com.unity.ugui'] = '1.0.0';
    if (!deps['com.unity.textmeshpro']) deps['com.unity.textmeshpro'] = '3.0.6';
  }

  private projectUsesVRM(config: UnityBuildConfig): boolean {
    try {
      const scenes = Array.isArray(config.scenesData) ? config.scenesData as any[] : [];
      return scenes.some((scene) => {
        const objects = Array.isArray((scene as any)?.objects) ? (scene as any).objects : [];
        return objects.some((obj: any) => String(obj?.type || '').toLowerCase() === 'vrm');
      });
    } catch {
      return false;
    }
  }

  private async resolveUniVRMUnityPackagePath(): Promise<string | null> {
    const roots = [
      this.resolveSdkDir(),
    ].filter((p): p is string => !!p);

    for (const root of roots) {
      if (!await fs.pathExists(root)) continue;
      const entries = await fs.readdir(root);
      const candidates = entries
        .filter((name) => /^UniVRM-.*\.unitypackage$/i.test(name))
        .map((name) => path.join(root, name));

      if (candidates.length > 0) {
        const stats = await Promise.all(candidates.map(async (p) => ({ p, s: await fs.stat(p) })));
        stats.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
        return stats[0].p;
      }
    }

    return null;
  }

  /**
   * .unitypackage を作業プロジェクトへ取り込む。既に同じパッケージを取り込み済みなら何もしない。
   *
   * インポートは Unity をもう1プロセス起動するため数分単位のコストがある。
   * 作業ディレクトリを再利用するようになったので、毎ビルド走らせる必要はない。
   */
  private async ensureUnityPackageImported(
    unityProjectPath: string,
    packagePath: string,
    markerName: string,
    logFile: string,
  ): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
    const markerPath = path.join(unityProjectPath, markerName);
    const stamp = `${packagePath}:${this.stampOf(await fs.stat(packagePath))}`;

    try {
      const existing = await fs.readJSON(markerPath);
      if (existing?.stamp === stamp) {
        this.emit('log', `[Arsist] Package already imported, skipping: ${path.basename(packagePath)}`);
        return { success: true, skipped: true };
      }
    } catch {
      // マーカーが無い/壊れている場合は普通にインポートする
    }

    const result = await this.importUnityPackage(unityProjectPath, packagePath, logFile);
    if (result.success) {
      await fs.writeJSON(markerPath, { stamp }, { spaces: 0 });
    }
    return result;
  }

  private async importUnityPackage(projectPath: string, packagePath: string, logFile: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const args = [
        '-batchmode',
        '-nographics',
        '-quit',
        // ターゲットを指定しないと Standalone 向けにインポートされ、
        // 本ビルドで Android 用に丸ごと再インポートされてしまう
        '-buildTarget', 'Android',
        '-projectPath', this.normalizeOsPath(projectPath),
        '-importPackage', this.normalizeOsPath(packagePath),
        '-logFile', this.normalizeOsPath(logFile),
      ];

      const proc = spawn(this.unityPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
        shell: false,
        windowsHide: true,
      });

      let stderr = '';
      let stdout = '';
      proc.stderr?.on('data', (d) => { stderr += d.toString(); });
      proc.stdout?.on('data', (d) => { stdout += d.toString(); });

      const timeout = setTimeout(() => {
        try { proc.kill(); } catch { /* ignore */ }
        resolve({ success: false, error: 'Unity package import timed out after 30 minutes' });
      }, 30 * 60 * 1000);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ success: true });
        } else {
          // エラーメッセージをログから取得
          let errorMsg = stderr.trim() || stdout.trim() || `Unity package import failed with exit code ${code}`;
          // 最初の100文字のみを返す（冗長なログを避けるため）
          if (errorMsg.length > 200) {
            errorMsg = errorMsg.substring(0, 200) + '...';
          }
          resolve({ success: false, error: errorMsg });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ success: false, error: err.message });
      });
    });
  }

  /**
   * Jint 4.x と Acornima の DLL を Assets/Plugins/ へ配置する。
   * - ローカルの sdk/nupkg/ を優先（オフライン対応）。
   * - なければ NuGet から自動ダウンロード。
   * - Jint.dll / Acornima.dll が両方とも存在する場合はスキップ。
   */
  private async ensureJintDlls(unityProjectPath: string): Promise<void> {
    // DLL 配置先は Assets/Plugins/ （サブフォルダなし）
    const pluginsDir  = path.join(unityProjectPath, 'Assets', 'Plugins');
    const jintDll     = path.join(pluginsDir, 'Jint.dll');
    const acornimaDll = path.join(pluginsDir, 'Acornima.dll');

    if (await fs.pathExists(jintDll) && await fs.pathExists(acornimaDll)) {
      this.emit('log', '[Arsist] Jint/Acornima DLLs already present, skipping');
      return;
    }

    await fs.ensureDir(pluginsDir);

    // 古い Esprima.dll が残っていれば削除（Jint 4.x では不要）
    const oldEsprima = path.join(pluginsDir, 'Esprima.dll');
    if (await fs.pathExists(oldEsprima)) {
      await fs.remove(oldEsprima);
      const oldEsprimaMeta = oldEsprima + '.meta';
      if (await fs.pathExists(oldEsprimaMeta)) await fs.remove(oldEsprimaMeta);
      this.emit('log', '[Arsist] Removed legacy Esprima.dll');
    }

    const packages: Array<{ id: string; version: string; dll: string }> = [
      { id: 'jint',                                    version: '4.6.0', dll: 'Jint.dll'                                    },
      { id: 'acornima',                                version: '1.2.0', dll: 'Acornima.dll'                                },
      // Jint 4.x が依存する .NET BCL ヘルパー (Unity IL2CPP リンカーが解決できないため明示配置)
      { id: 'system.runtime.compilerservices.unsafe',  version: '6.0.0', dll: 'System.Runtime.CompilerServices.Unsafe.dll' },
    ];

    // ローカル nupkg の探索ルート
    const localNupkgDir = path.join(this.resolveSdkDir(), 'nupkg');

    const tmpDir = path.join(pluginsDir, '_dl_tmp');
    await fs.ensureDir(tmpDir);

    try {
      for (const pkg of packages) {
        const destDll = path.join(pluginsDir, pkg.dll);
        if (await fs.pathExists(destDll)) {
          this.emit('log', `[Arsist] ${pkg.dll} already present, skipping`);
          continue;
        }

        const localNupkg = path.join(localNupkgDir, `${pkg.id}.${pkg.version}.nupkg`);
        const extract    = path.join(tmpDir, pkg.id);
        await fs.ensureDir(extract);

        if (await fs.pathExists(localNupkg)) {
          this.emit('log', `[Arsist] Using local nupkg for ${pkg.id} ${pkg.version}...`);
          await this.extractFromZip(localNupkg, extract);
        } else {
          const url   = `https://api.nuget.org/v3-flatcontainer/${pkg.id}/${pkg.version}/${pkg.id}.${pkg.version}.nupkg`;
          const nupkg = path.join(tmpDir, `${pkg.id}.nupkg`);
          this.emit('log', `[Arsist] Downloading ${pkg.id} ${pkg.version} from NuGet...`);
          await this.downloadFile(url, nupkg);
          await this.extractFromZip(nupkg, extract);
        }

        // netstandard2.1 > netstandard2.0 > net6.0 の優先順で DLL を探す
        const candidates = [
          path.join(extract, 'lib', 'netstandard2.1', pkg.dll),
          path.join(extract, 'lib', 'netstandard2.0', pkg.dll),
          path.join(extract, 'lib', 'net6.0',          pkg.dll),
        ];
        let found = false;
        for (const candidate of candidates) {
          if (await fs.pathExists(candidate)) {
            await fs.copy(candidate, destDll, { overwrite: true });
            this.emit('log', `[Arsist] Installed ${pkg.dll}`);
            found = true;
            break;
          }
        }
        if (!found) {
          const fallback = await this.findFileRecursive(extract, pkg.dll);
          if (fallback) {
            await fs.copy(fallback, destDll, { overwrite: true });
            this.emit('log', `[Arsist] Installed ${pkg.dll} (fallback search)`);
          } else {
            throw new Error(`${pkg.dll} が nupkg 内に見つかりませんでした`);
          }
        }
      }
    } finally {
      await fs.remove(tmpDir).catch(() => {});
    }

    this.emit('log', '[Arsist] Jint 4.x / Acornima DLLs ready in Assets/Plugins/');
  }

  /** ファイルを HTTP/HTTPS でダウンロードする（リダイレクト追跡） */
  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const follow = (currentUrl: string, redirectCount = 0) => {
        if (redirectCount > 10) { reject(new Error(`Too many redirects: ${url}`)); return; }
        const mod: typeof https | typeof http = currentUrl.startsWith('https') ? https : http;
        mod.get(currentUrl, { timeout: 60_000 }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            follow(res.headers.location, redirectCount + 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode} downloading ${currentUrl}`));
            return;
          }
          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on('finish', () => { (file as any).close(); resolve(); });
          file.on('error', (err) => { fs.remove(dest).catch(() => {}); reject(err); });
          res.on('error',  reject);
        }).on('error', reject);
      };
      follow(url);
    });
  }

  /** .nupkg (=ZIP) を destDir に展開する（PowerShell / unzip / python3 互換） */
  private async extractFromZip(zipPath: string, destDir: string): Promise<void> {
    await fs.ensureDir(destDir);
    return new Promise((resolve, reject) => {
      let proc;
      if (process.platform === 'win32') {
        const script = `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`;
        proc = spawn('powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { shell: false, windowsHide: true });
      } else {
        // Linux / macOS: unzip が無ければ python3 にフォールバック
        proc = spawn('unzip', ['-o', '-q', zipPath, '-d', destDir], { shell: false });
      }
      const stderr: string[] = [];
      proc.stderr?.on('data', (d: Buffer) => stderr.push(d.toString()));
      proc.on('close', async (code) => {
        if (code === 0) { resolve(); return; }
        // unzip 失敗時 python3 でリトライ（Linux）
        if (process.platform !== 'win32') {
          const py = spawn('python3', [
            '-c',
            `import zipfile,os; z=zipfile.ZipFile(r'${zipPath}'); z.extractall(r'${destDir}'); z.close()`,
          ], { shell: false });
          py.on('close', (c) => c === 0 ? resolve() : reject(new Error(`ZIP extraction failed: ${stderr.join('')}`)));
          py.on('error', reject);
          return;
        }
        reject(new Error(`ZIP extraction failed (code ${code}): ${stderr.join('')}`));
      });
      proc.on('error', reject);
    });
  }

  /** dir 以下を再帰的に検索して fileName に一致する最初のファイルパスを返す */
  private async findFileRecursive(dir: string, fileName: string): Promise<string | null> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          const found = await this.findFileRecursive(full, fileName);
          if (found) return found;
        } else if (e.name === fileName) {
          return full;
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  private async transferProjectData(unityProjectPath: string, config: UnityBuildConfig): Promise<void> {
    const dataDir = path.join(unityProjectPath, 'Assets', 'ArsistGenerated');
    await fs.ensureDir(dataDir);

    if (!config.manifestData || !config.scenesData || !config.uiData) {
      throw new Error('Invalid project data: manifest/scenes/ui is required');
    }

    // マニフェスト（scenesデータを含める）
    const manifestWithScenes = {
      ...config.manifestData,
      scenes: config.scenesData,
    };

    await fs.writeJSON(
      path.join(dataDir, 'manifest.json'),
      manifestWithScenes,
      { spaces: 2 }
    );

    // シーンデータ
    await fs.writeJSON(
      path.join(dataDir, 'scenes.json'),
      config.scenesData,
      { spaces: 2 }
    );

    // UIデータ
    await fs.writeJSON(
      path.join(dataDir, 'ui_layouts.json'),
      config.uiData,
      { spaces: 2 }
    );

    // DataFlow定義を出力
    const dataFlowData = (config.manifestData as any)?.dataFlow;
    if (dataFlowData) {
      await fs.writeJSON(
        path.join(dataDir, 'dataflow.json'),
        dataFlowData,
        { spaces: 2 }
      );
      this.emit('log', '[Arsist] DataFlow definition exported');
    }

    // スクリプトデータを出力 (ScriptEngineManager が読み込む)
    if (config.scriptsData) {
      await fs.writeJSON(
        path.join(dataDir, 'scripts.json'),
        config.scriptsData,
        { spaces: 2 }
      );
      this.emit('log', '[Arsist] scripts.json exported');
    }

    // 前回ビルドで出力した json のうち、今回出力しなかったものを消す
    // （dataflow/scripts を削除したのに Unity 側に残り続けるのを防ぐ）
    const expectedGeneratedFiles = new Set([
      'manifest.json',
      'scenes.json',
      'ui_layouts.json',
      ...(dataFlowData ? ['dataflow.json'] : []),
      ...(config.scriptsData ? ['scripts.json'] : []),
    ]);
    for (const entry of await fs.readdir(dataDir)) {
      if (entry.endsWith('.meta')) continue;
      if (expectedGeneratedFiles.has(entry)) continue;
      if (!entry.endsWith('.json')) continue;
      await fs.remove(path.join(dataDir, entry)).catch(() => {});
      await fs.remove(path.join(dataDir, `${entry}.meta`)).catch(() => {});
    }

    // Arsistプロジェクト内AssetsをUnityプロジェクトにコピー（実アセットとしてUnityに取り込ませる）
    if (config.sourceProjectPath) {
      const sourceAssets = path.join(config.sourceProjectPath, 'Assets');
      if (await fs.pathExists(sourceAssets)) {
        const destAssets = path.join(unityProjectPath, 'Assets', 'ArsistProjectAssets');
        // mirror: エディタ側で削除したアセットが Unity 側に残り続けないようにする。
        // Unity が生成した .meta は syncDirectory 側で保護されるので GUID は維持される。
        const sync = await this.syncDirectory(sourceAssets, destAssets, { prune: 'mirror' });
        this.emit(
          'log',
          `[Arsist] Project Assets synced into Unity (Assets/ArsistProjectAssets): ${sync.copied} updated, ${sync.removed} removed`,
        );
      } else {
        this.emit('log', `[Arsist] Project Assets folder not found: ${sourceAssets}`);
      }
    }

    this.emit('log', '[Arsist] Project data transferred to Unity');
  }

  private async applyDevicePatch(unityProjectPath: string, targetDevice: string): Promise<void> {
    const adapterDir = await this.resolveAdapterDir(targetDevice);
    
    if (!adapterDir || !await fs.pathExists(adapterDir)) {
      this.emit('log', `[Arsist] No specific patch for ${targetDevice}, using default settings`);
      await this.ensureAndroidCleartextHttpPolicy(unityProjectPath);
      return;
    }

    // AndroidManifest パッチ
    const manifestCandidates = [
      path.join(adapterDir, 'AndroidManifest.xml'),
      path.join(adapterDir, 'Manifest', 'AndroidManifest.xml'),
    ];
    for (const manifestPatch of manifestCandidates) {
      if (await fs.pathExists(manifestPatch)) {
        const destManifest = path.join(unityProjectPath, 'Assets', 'Plugins', 'Android', 'AndroidManifest.xml');
        await fs.ensureDir(path.dirname(destManifest));
        await fs.copy(manifestPatch, destManifest, { overwrite: true, preserveTimestamps: true });
        this.emit('log', '[Arsist] Applied AndroidManifest patch');
        break;
      }
    }

    // Editor Scripts パッチ
    const scriptsCandidates = [
      path.join(adapterDir, 'Scripts'),
      path.join(adapterDir, 'Editor'),
      adapterDir,
    ];
    for (const scriptsPatch of scriptsCandidates) {
      if (await fs.pathExists(scriptsPatch)) {
        const destScripts = path.join(unityProjectPath, 'Assets', 'Arsist', 'Editor', 'Adapters', path.basename(adapterDir));
        await fs.ensureDir(destScripts);
        const entries = await fs.readdir(scriptsPatch);
        const csFiles = entries.filter((f) => f.endsWith('.cs'));
        for (const file of csFiles) {
          await fs.copy(path.join(scriptsPatch, file), path.join(destScripts, file), {
            overwrite: true,
            preserveTimestamps: true,
          });
        }
        if (csFiles.length > 0) {
          this.emit('log', '[Arsist] Applied editor scripts patch');
        }
        break;
      }
    }

    // Packages パッチ
    const packagesPatch = path.join(adapterDir, 'Packages');
    if (await fs.pathExists(packagesPatch)) {
      const destPackages = path.join(unityProjectPath, 'Packages');
      await fs.copy(packagesPatch, destPackages, { overwrite: true, preserveTimestamps: true });
      this.emit('log', '[Arsist] Applied packages patch');
    }

    await this.ensureAndroidCleartextHttpPolicy(unityProjectPath);

    this.emit('log', `[Arsist] Device patch applied for ${targetDevice}`);
  }

  private async ensureAndroidCleartextHttpPolicy(unityProjectPath: string): Promise<void> {
    const manifestPath = path.join(unityProjectPath, 'Assets', 'Plugins', 'Android', 'AndroidManifest.xml');
    if (!await fs.pathExists(manifestPath)) {
      this.emit('log', '[Arsist] AndroidManifest.xml not found, skip cleartext policy patch');
      return;
    }

    const before = await fs.readFile(manifestPath, 'utf-8');
    let after = before;

    if (!/android:usesCleartextTraffic\s*=/.test(after)) {
      after = after.replace(/<application\b([^>]*)>/, '<application$1 android:usesCleartextTraffic="true">');
    } else {
      after = after.replace(/android:usesCleartextTraffic\s*=\s*"[^"]*"/g, 'android:usesCleartextTraffic="true"');
    }

    if (after !== before) {
      await fs.writeFile(manifestPath, after, 'utf-8');
      this.emit('log', '[Arsist] Enforced cleartext HTTP policy in AndroidManifest');
    }
  }

  private isXrealTarget(targetDevice: string): boolean {
    const normalized = (targetDevice || '').toLowerCase();
    return normalized.includes('xreal');
  }

  private isQuestTarget(targetDevice: string): boolean {
    const normalized = (targetDevice || '').toLowerCase();
    return normalized.includes('quest') || normalized.includes('meta');
  }

  private async integrateRequiredSdks(unityProjectPath: string, targetDevice: string): Promise<void> {
    if (this.isXrealTarget(targetDevice)) {
      await this.integrateXrealSdk(unityProjectPath);
    }

    if (this.isQuestTarget(targetDevice)) {
      await this.integrateQuestSdk(unityProjectPath);
    }
  }

  private async integrateXrealSdk(unityProjectPath: string): Promise<void> {
    const sdkSourceDir = path.join(this.resolveSdkDir(), 'com.xreal.xr', 'package');
    const sdkPackageJson = path.join(sdkSourceDir, 'package.json');

    if (!await fs.pathExists(sdkPackageJson)) {
      throw new Error(
        `XREAL SDK not found. Place the XREAL UPM package at sdk/com.xreal.xr/package (package.json missing).\nLooked for:\n- ${sdkPackageJson}`
      );
    }

    const destDir = path.join(unityProjectPath, 'Packages', 'com.xreal.xr');
    await fs.ensureDir(path.dirname(destDir));
    // 差分同期。以前は毎回 overwrite フルコピーしていたため、SDK 835ファイル分の
    // mtime が更新され Unity が全部再インポートしていた。
    // Unity が読まない `Samples~` / `Tools~` / `Marker~` は syncDirectory 側で除外される。
    const sync = await this.syncDirectory(sdkSourceDir, destDir, { prune: 'mirror' });
    this.emit('log', `[Arsist] XREAL SDK synced: ${sync.copied} file(s) updated, ${sync.removed} removed`);

    const manifestPath = path.join(unityProjectPath, 'Packages', 'manifest.json');
    if (!await fs.pathExists(manifestPath)) {
      throw new Error(`Unity manifest.json not found: ${manifestPath}`);
    }

    const manifest = await fs.readJSON(manifestPath);
    const dependencies = (manifest.dependencies ?? {}) as Record<string, string>;
    // Packages/manifest.json からの相対パス（同じフォルダ内のcom.xreal.xr）
    dependencies['com.xreal.xr'] = 'file:com.xreal.xr';

    // XREAL ビルドに必要な最低依存を補完（com.unity.modules.* + ugui）
    this.applyXrealRequiredDependencies(dependencies);

    manifest.dependencies = dependencies;
    await fs.writeJSON(manifestPath, manifest, { spaces: 2 });

    this.emit('log', '[Arsist] Embedded XREAL SDK: Packages/com.xreal.xr (manifest.json updated)');
  }

  private applyXrealRequiredDependencies(deps: Record<string, string>): void {
    const setIfMissing = (pkg: string, version: string) => {
      if (!deps[pkg]) deps[pkg] = version;
    };

    // XREAL SDK が内部で使用する Unity モジュール
    setIfMissing('com.unity.modules.physics', '1.0.0');
    setIfMissing('com.unity.modules.physics2d', '1.0.0');
    setIfMissing('com.unity.modules.ui', '1.0.0');
    setIfMissing('com.unity.modules.uielements', '1.0.0');
    setIfMissing('com.unity.modules.xr', '1.0.0');
    setIfMissing('com.unity.modules.audio', '1.0.0');
    // uGUI / TextMeshPro は Unity バージョンで構成が違うため専用ヘルパで解決する
    // （Unity 6 では TextMeshPro が com.unity.ugui 2.0.0 に統合されている）
    this.applyUnityUiDependencies(deps);
  }

  private async integrateQuestSdk(unityProjectPath: string): Promise<void> {
    const questSdkDir = path.join(this.resolveSdkDir(), 'quest');
    if (!await fs.pathExists(questSdkDir)) {
      throw new Error(`Quest SDK directory not found: ${questSdkDir}`);
    }

    const files = await fs.readdir(questSdkDir);
    const coreTgz = files.find((f) => /^com\.meta\.xr\.sdk\.core-.*\.tgz$/i.test(f));
    const mrukTgz = files.find((f) => /^com\.meta\.xr\.mrutilitykit-.*\.tgz$/i.test(f));

    if (!coreTgz) {
      throw new Error(
        `Quest SDK core package not found. Place com.meta.xr.sdk.core-*.tgz under sdk/quest.\nLooked in:\n- ${questSdkDir}`
      );
    }

    const packagesDir = path.join(unityProjectPath, 'Packages');
    await fs.ensureDir(packagesDir);

    const copiedPackages: Array<{ id: string; fileName: string }> = [];

    const copyTgzToPackages = async (packageId: string, fileName: string) => {
      const source = path.join(questSdkDir, fileName);
      const destination = path.join(packagesDir, fileName);
      // tgz の mtime が変わると Unity が tarball を展開し直すので、変化が無ければ触らない
      const sourceStamp = this.stampOf(await fs.stat(source));
      let destStamp: string | null = null;
      try {
        destStamp = this.stampOf(await fs.stat(destination));
      } catch {
        destStamp = null;
      }
      if (destStamp !== sourceStamp) {
        await fs.copy(source, destination, { overwrite: true, preserveTimestamps: true });
      }
      copiedPackages.push({ id: packageId, fileName });
    };

    await copyTgzToPackages('com.meta.xr.sdk.core', coreTgz);
    if (mrukTgz) {
      await copyTgzToPackages('com.meta.xr.mrutilitykit', mrukTgz);
    }

    const manifestPath = path.join(packagesDir, 'manifest.json');
    if (!await fs.pathExists(manifestPath)) {
      throw new Error(`Unity manifest.json not found: ${manifestPath}`);
    }

    const manifest = await fs.readJSON(manifestPath);
    const dependencies = (manifest.dependencies ?? {}) as Record<string, string>;
    for (const pkg of copiedPackages) {
      dependencies[pkg.id] = `file:${pkg.fileName}`;
    }

    // Quest SDKサンプル準拠の最低依存を補完
    const questSampleDependencies = await this.readQuestSampleDependencies(this.resolveSdkDir());
    this.applyQuestRequiredDependencies(dependencies, questSampleDependencies);

    manifest.dependencies = dependencies;
    await fs.writeJSON(manifestPath, manifest, { spaces: 2 });

    const names = copiedPackages.map((p) => `${p.id} -> ${p.fileName}`).join(', ');
    const physics2d = dependencies['com.unity.modules.physics2d'] || '(missing)';
    await this.applyQuestXrBootstrap(unityProjectPath, this.resolveSdkDir());
    this.emit('log', `[Arsist] Embedded Quest SDK packages: ${names} (manifest.json updated)`);
    this.emit('log', `[Arsist] Quest dependencies ensured (physics2d=${physics2d})`);
  }

  private async applyQuestXrBootstrap(unityProjectPath: string, sdkDirResolved: string): Promise<void> {
    const sampleRoot = path.join(sdkDirResolved, 'quest', 'Unity-InteractionSDK-Samples');
    if (!await fs.pathExists(sampleRoot)) {
      this.emit('log', `[Arsist] Quest XR bootstrap skipped: sample root not found (${sampleRoot})`);
      return;
    }

    const sampleAssetsXr = path.join(sampleRoot, 'Assets', 'XR');
    const sampleProjectSettings = path.join(sampleRoot, 'ProjectSettings');

    if (await fs.pathExists(sampleAssetsXr)) {
      const destAssetsXr = path.join(unityProjectPath, 'Assets', 'XR');
      await this.syncDirectory(sampleAssetsXr, destAssetsXr);
    }

    const copySettingIfExists = async (fileName: string) => {
      const src = path.join(sampleProjectSettings, fileName);
      const dst = path.join(unityProjectPath, 'ProjectSettings', fileName);
      if (await fs.pathExists(src)) {
        await fs.copy(src, dst, { overwrite: true, preserveTimestamps: true });
      }
    };

    await copySettingIfExists('EditorBuildSettings.asset');
    await copySettingIfExists('XRPackageSettings.asset');
    await copySettingIfExists('XRSettings.asset');

    this.emit('log', '[Arsist] Quest XR bootstrap assets/settings applied (Assets/XR + ProjectSettings XR files)');
  }

  private async readQuestSampleDependencies(sdkDirResolved: string): Promise<Record<string, string> | null> {
    const sampleManifestPath = path.join(
      sdkDirResolved,
      'quest',
      'Unity-InteractionSDK-Samples',
      'Packages',
      'manifest.json',
    );

    if (!await fs.pathExists(sampleManifestPath)) {
      return null;
    }

    try {
      const sampleManifest = await fs.readJSON(sampleManifestPath);
      const deps = sampleManifest?.dependencies;
      if (!deps || typeof deps !== 'object') return null;
      return deps as Record<string, string>;
    } catch {
      return null;
    }
  }

  private applyQuestRequiredDependencies(
    targetDependencies: Record<string, string>,
    sampleDependencies: Record<string, string> | null,
  ): void {
    const setIfMissing = (pkg: string, fallbackVersion: string) => {
      if (!targetDependencies[pkg]) {
        targetDependencies[pkg] = sampleDependencies?.[pkg] || fallbackVersion;
      }
    };

    // Meta Quest SDK core compileで必要になりやすい依存
    setIfMissing('com.unity.modules.physics2d', '1.0.0');
    setIfMissing('com.unity.modules.physics', '1.0.0');
    setIfMissing('com.unity.modules.ui', '1.0.0');
    setIfMissing('com.unity.modules.uielements', '1.0.0');
    setIfMissing('com.unity.ugui', '1.0.0');
    setIfMissing('com.unity.xr.management', '4.5.0');
    setIfMissing('com.unity.xr.oculus', '4.4.0');

    // サンプルにある built-in modules を不足分だけ補完
    if (sampleDependencies) {
      for (const [pkg, version] of Object.entries(sampleDependencies)) {
        if (!pkg.startsWith('com.unity.modules.')) continue;
        if (!targetDependencies[pkg]) {
          targetDependencies[pkg] = version;
        }
      }
    }
  }

  // ----------------------------------------------------------------
  // Android ツールチェーン検出ヘルパー
  // ----------------------------------------------------------------

  /**
   * JDKのホームディレクトリを返す。
   * 優先順位: JAVA_HOME env → JDK_HOME env → Unity bundled OpenJDK → 一般的なインストールパス
   */
  private async detectJdkPath(): Promise<string | null> {
    const javaExe = process.platform === 'win32' ? 'java.exe' : 'java';

    // 1) Unity 付属 OpenJDK を最優先（バージョン問題が起きない）
    try {
      const unityDir = path.dirname(this.unityPath); // Editor/
      const unityOpenJdk = path.join(unityDir, 'Data', 'PlaybackEngines', 'AndroidPlayer', 'OpenJDK');
      if (await fs.pathExists(path.join(unityOpenJdk, 'bin', javaExe))) {
        return unityOpenJdk;
      }
    } catch {
      // ignore
    }

    // 2) 環境変数
    for (const key of ['JAVA_HOME', 'JDK_HOME']) {
      const v = process.env[key];
      if (v && await fs.pathExists(path.join(v, 'bin', javaExe))) {
        return v;
      }
    }

    return null;
  }

  /** ディレクトリ名からJDKメジャーバージョン番号を抽出. 例: "jdk-17.0.5.8-hotspot" → 17 */
  private parseJdkMajorVersion(dirName: string): number {
    // パターン: jdk-17.x / jdk1.8 / temurin-17+... etc.
    const m = dirName.match(/jdk[_\-]?(\d+)[._]/i) || dirName.match(/jdk(\d+)/i);
    if (m) {
      const v = parseInt(m[1], 10);
      // Java 1.8 → major 8
      return v === 1 ? 8 : v;
    }
    return 0;
  }

  /**
   * Android SDK ルートディレクトリを返す。
   * 優先順位: ANDROID_HOME → ANDROID_SDK_ROOT → %LOCALAPPDATA%\Android\Sdk
   */
  private async detectAndroidSdkPath(): Promise<string | null> {
    const detected = await this.detectAndroidSdkPathCandidate();
    if (!detected) return null;

    if (process.platform !== 'win32') {
      return detected;
    }

    return await this.prepareWritableAndroidSdkPath(detected);
  }

  private async detectAndroidSdkPathCandidate(): Promise<string | null> {
    // 1) Unity 付属 Android SDK を最優先
    try {
      const unityDir = path.dirname(this.unityPath);
      const unitySdk = path.join(unityDir, 'Data', 'PlaybackEngines', 'AndroidPlayer', 'SDK');
      if (await fs.pathExists(unitySdk)) return unitySdk;
    } catch {
      // ignore
    }

    for (const key of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
      const v = process.env[key];
      if (v && await fs.pathExists(v)) return v;
    }

    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const candidate = path.join(localAppData, 'Android', 'Sdk');
      if (await fs.pathExists(candidate)) return candidate;
    } else if (process.platform === 'darwin') {
      const candidate = path.join(os.homedir(), 'Library', 'Android', 'sdk');
      if (await fs.pathExists(candidate)) return candidate;
    } else {
      const candidate = path.join(os.homedir(), 'Android', 'Sdk');
      if (await fs.pathExists(candidate)) return candidate;
    }

    return null;
  }

  private getAndroidSdkMirrorPath(sourceSdkPath: string): string {
    const unityVersion = path.basename(path.dirname(path.dirname(this.unityPath))) || 'unknown-unity';
    const sourceKey = sourceSdkPath
      .replace(/[:\\/]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'sdk';
    return path.join(app.getPath('userData'), 'android-sdk-cache', unityVersion, sourceKey);
  }

  private isPathUnderWindowsProtectedRoot(targetPath: string, env: NodeJS.ProcessEnv): boolean {
    if (process.platform !== 'win32') return false;

    const normalizedTarget = path.resolve(targetPath).toLowerCase();
    const protectedRoots = [
      env.ProgramW6432,
      env.ProgramFiles,
      env['ProgramFiles(x86)'],
      'C:\\Program Files',
      'C:\\Program Files (x86)',
    ]
      .filter((entry): entry is string => !!entry)
      .map((entry) => path.resolve(entry).toLowerCase());

    return protectedRoots.some((root) => normalizedTarget === root || normalizedTarget.startsWith(`${root}${path.sep}`.toLowerCase()));
  }

  private async isDirectoryWritable(dirPath: string): Promise<boolean> {
    const probePath = path.join(dirPath, `.arsist-write-test-${process.pid}-${Date.now()}.tmp`);
    try {
      await fs.writeFile(probePath, '');
      await fs.remove(probePath);
      return true;
    } catch {
      return false;
    }
  }

  private async prepareWritableAndroidSdkPath(sourceSdkPath: string): Promise<string> {
    if (this.preparedAndroidSdkPath) {
      return this.preparedAndroidSdkPath;
    }

    const shouldMirror = this.isPathUnderWindowsProtectedRoot(sourceSdkPath, process.env)
      || !await this.isDirectoryWritable(sourceSdkPath);

    if (!shouldMirror) {
      this.preparedAndroidSdkPath = sourceSdkPath;
      return sourceSdkPath;
    }

    const mirrorPath = this.getAndroidSdkMirrorPath(sourceSdkPath);
    const markerPath = path.join(mirrorPath, '.arsist-sdk-source');
    let needsCopy = true;

    if (await fs.pathExists(mirrorPath) && await fs.pathExists(markerPath)) {
      try {
        const existingMarker = (await fs.readFile(markerPath, 'utf8')).trim();
        if (existingMarker === sourceSdkPath) {
          needsCopy = false;
        }
      } catch {
        needsCopy = true;
      }
    }

    if (needsCopy) {
      this.emit('log', `[Arsist] Mirroring Android SDK to writable location: ${mirrorPath}`);
      await fs.remove(mirrorPath);
      await fs.ensureDir(path.dirname(mirrorPath));
      await fs.copy(sourceSdkPath, mirrorPath, { overwrite: true, errorOnExist: false });
      await fs.writeFile(markerPath, sourceSdkPath, 'utf8');
    }

    this.preparedAndroidSdkPath = mirrorPath;
    this.emit('log', `[Arsist] Android SDK prepared: ${mirrorPath}`);
    return mirrorPath;
  }

  private findWindowsExecutablePathSync(fileName: string, env: NodeJS.ProcessEnv): string | null {
    if (process.platform !== 'win32') return null;

    const dirs: string[] = [];
    const seen = new Set<string>();
    const pushDir = (dir?: string | null) => {
      if (!dir) return;
      const normalized = path.resolve(dir);
      const key = normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      dirs.push(normalized);
    };

    const pathEntries = (env.PATH || '').split(';').filter(Boolean);
    pathEntries.forEach((entry) => pushDir(entry));

    const systemRoot = env.SystemRoot || 'C:\\Windows';
    const programFiles = env.ProgramW6432 || env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    [
      path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
      path.join(systemRoot, 'SysWOW64', 'WindowsPowerShell', 'v1.0'),
      path.join(programFiles, 'PowerShell', '7'),
      path.join(programFilesX86, 'PowerShell', '7'),
      path.join(localAppData, 'Programs', 'PowerShell', '7'),
      path.join(localAppData, 'Microsoft', 'WindowsApps'),
    ].forEach((entry) => pushDir(entry));

    [
      path.join(programFiles, 'PowerShell'),
      path.join(programFilesX86, 'PowerShell'),
      path.join(localAppData, 'Programs', 'PowerShell'),
    ].forEach((root) => {
      if (!fs.existsSync(root)) return;
      try {
        const entries = fs.readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()
          .reverse();
        entries.forEach((entry) => pushDir(path.join(root, entry)));
      } catch {
        // ignore
      }
    });

    for (const dir of dirs) {
      const candidate = path.join(dir, fileName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private ensureWindowsShellAvailability(env: NodeJS.ProcessEnv): void {
    if (process.platform !== 'win32') return;

    const pathSep = ';';
    const prependPathDir = (dir: string) => {
      const currentPath = env.PATH || '';
      const entries = currentPath.split(pathSep).filter(Boolean);
      const normalizedEntries = new Set(entries.map((entry) => entry.toLowerCase()));
      if (normalizedEntries.has(dir.toLowerCase())) return;
      env.PATH = currentPath ? `${dir}${pathSep}${currentPath}` : dir;
    };

    const systemRoot = env.SystemRoot || 'C:\\Windows';
    const cmdPath = path.join(systemRoot, 'System32', 'cmd.exe');
    if (!env.ComSpec && fs.existsSync(cmdPath)) {
      env.ComSpec = cmdPath;
    }

    const powershellPath = this.findWindowsExecutablePathSync('powershell.exe', env);
    if (powershellPath) {
      prependPathDir(path.dirname(powershellPath));
      this.emit('log', `[Arsist] Windows PowerShell resolved: ${powershellPath}`);
      return;
    }

    this.emit('log', '[Arsist] WARNING: powershell.exe could not be resolved for Unity.');
  }

  /**
   * Unityプロジェクトの ProjectSettings/AndroidExternalToolsSettings.asset を生成し、
   * JDK / Android SDK / NDK パスを書き込む。
   * Unity はプロジェクト読み込み時にこのファイルを参照するため、プロセス起動前に作成する必要がある。
   */
  private async writeAndroidToolchainSettings(unityProjectPath: string): Promise<void> {
    const jdkPath = await this.detectJdkPath();
    const androidSdkPath = await this.detectAndroidSdkPath();

    if (!jdkPath && !androidSdkPath) {
      this.emit('log', '[Arsist] Android toolchain: no JDK/SDK found, skipping AndroidExternalToolsSettings.asset');
      return;
    }

    // NDK パスを Android SDK 内で検索
    let ndkPath = '';
    if (androidSdkPath) {
      const ndkRoots = [
        path.join(androidSdkPath, 'ndk'),
        path.join(androidSdkPath, 'ndk-bundle'),
      ];
      for (const ndkRoot of ndkRoots) {
        if (await fs.pathExists(ndkRoot)) {
          try {
            const entries = (await fs.readdir(ndkRoot)).sort();
            if (entries.length > 0) {
              ndkPath = path.join(ndkRoot, entries[entries.length - 1]); // 最新バージョン
            } else {
              ndkPath = ndkRoot;
            }
          } catch {
            ndkPath = ndkRoot;
          }
          break;
        }
      }
    }

    // Unity asset YAML (forward slashes required)
    const toUnityPath = (p: string) => p.replace(/\\/g, '/');

    const assetContent = [
      '%YAML 1.1',
      '%TAG !u! tag:unity3d.com,2011:',
      '--- !u!162 &1',
      'AndroidExternalToolsSettings:',
      '  m_ObjectHideFlags: 0',
      '  serializedVersion: 2',
      `  sdkRootPath: ${androidSdkPath ? toUnityPath(androidSdkPath) : ''}`,
      `  jdkRootPath: ${jdkPath ? toUnityPath(jdkPath) : ''}`,
      `  ndkRootPath: ${ndkPath ? toUnityPath(ndkPath) : ''}`,
      '  gradlePath: ',
      // maxJdkVersion: -1 = no upper limit (Unity interprets 0 as "version 0 = invalid")
      '  maxJdkVersion: -1',
      '  userGradleVersion: ',
      '',
    ].join('\n');

    const settingsDir = path.join(unityProjectPath, 'ProjectSettings');
    await fs.ensureDir(settingsDir);
    const assetPath = path.join(settingsDir, 'AndroidExternalToolsSettings.asset');
    await fs.writeFile(assetPath, assetContent, 'utf8');

    this.emit('log', `[Arsist] Wrote AndroidExternalToolsSettings.asset`);
    if (jdkPath) this.emit('log', `[Arsist]   jdkRootPath: ${jdkPath}`);
    if (androidSdkPath) this.emit('log', `[Arsist]   sdkRootPath: ${androidSdkPath}`);
    if (ndkPath) this.emit('log', `[Arsist]   ndkRootPath: ${ndkPath}`);
  }

  // ----------------------------------------------------------------

  private async executeUnityBuild(
    unityProjectPath: string,
    config: UnityBuildConfig,
    options?: { batchMode?: boolean; noGraphics?: boolean; manualLicenseFile?: string },
  ): Promise<{ success: boolean; error?: string }> {
    // Android ツールチェーンを事前検出（Promise外で await 可能）
    const jdkPath = await this.detectJdkPath();
    const androidSdkPath = await this.detectAndroidSdkPath();

    if (jdkPath) {
      this.emit('log', `[Arsist] JDK detected: ${jdkPath}`);
    } else {
      this.emit('log', '[Arsist] WARNING: JDK not detected. Unity Android build may fail with "JDK not found".');
      this.emit('log', '[Arsist] Install Android Build Support module via Unity Hub, or set JAVA_HOME.');
    }
    if (androidSdkPath) {
      this.emit('log', `[Arsist] Android SDK detected: ${androidSdkPath}`);
    } else {
      this.emit('log', '[Arsist] WARNING: Android SDK not detected. Set ANDROID_HOME or install Android Studio.');
    }

    return new Promise((resolve) => {
      const timeoutMinutes = config.buildTimeoutMinutes ?? 60;
      const logFile = config.logFilePath || path.join(config.outputPath, 'unity_build.log');
      this.lastLogFile = logFile;

      const describeExecutionContext = () => {
        const lines: string[] = [];
        lines.push(`[Arsist] platform=${process.platform}`);
        if (typeof (process as any).getuid === 'function') {
          try {
            lines.push(`[Arsist] uid=${(process as any).getuid()} gid=${(process as any).getgid?.()}`);
          } catch {
            // ignore
          }
        }
        try {
          const u = os.userInfo();
          lines.push(`[Arsist] user=${u.username} homedir=${u.homedir}`);
        } catch {
          // ignore
        }
        lines.push(`[Arsist] env.HOME=${process.env.HOME || ''}`);
        if (process.platform === 'linux') {
          lines.push(`[Arsist] env.XDG_RUNTIME_DIR=${process.env.XDG_RUNTIME_DIR || ''}`);
          lines.push(`[Arsist] env.DBUS_SESSION_BUS_ADDRESS=${process.env.DBUS_SESSION_BUS_ADDRESS ? '(set)' : ''}`);
          lines.push(`[Arsist] env.DISPLAY=${process.env.DISPLAY || ''}`);
        }
        return lines.join('\n');
      };

      const args = [
        ...(options?.batchMode === false ? [] : ['-batchmode']),
        ...(options?.noGraphics === false ? [] : ['-nographics']),
        '-quit',
        '-projectPath', this.normalizeOsPath(unityProjectPath),
        '-executeMethod', 'Arsist.Builder.ArsistBuildPipeline.BuildFromCLI',
        '-buildTarget', config.buildTarget,
        '-outputPath', this.normalizeOsPath(config.outputPath),
        '-targetDevice', config.targetDevice,
        '-developmentBuild', config.developmentBuild ? 'true' : 'false',
        ...(options?.manualLicenseFile ? ['-manualLicenseFile', this.normalizeOsPath(options.manualLicenseFile)] : []),
        // Android ツールチェーンパスを C# 側の BuildFromCLI に渡す
        ...(jdkPath ? ['-arsist-jdk', this.normalizeOsPath(jdkPath)] : []),
        ...(androidSdkPath ? ['-arsist-android-sdk', this.normalizeOsPath(androidSdkPath)] : []),
        '-logFile', this.normalizeOsPath(logFile),
      ];

      const needsQuotes = (str: string) => str.includes(' ') || str.includes('"');
      const quoteForLog = (str: string) => needsQuotes(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
      const unityCommandLine = `${quoteForLog(this.unityPath)} ${args.map((a) => quoteForLog(a)).join(' ')}`;
      this.emit('log', `[Unity] Starting build: ${unityCommandLine}`);

      const env = { ...process.env };
      // HOME が未設定な環境を補正（ヘッドレス実行での認証問題対策）
      // Windows: USERPROFILE または TEMP を使用
      // Linux/macOS: HOME を使用
      if (!env.HOME) {
        try {
          if (process.platform === 'win32') {
            env.HOME = env.USERPROFILE || app.getPath('home');
          } else {
            env.HOME = app.getPath('home');
          }
        } catch {
          // ignore
        }
      }

      this.ensureWindowsShellAvailability(env);

      if (options?.manualLicenseFile) {
        env.UNITY_LICENSE_FILE = options.manualLicenseFile;
      }

      // JDK パス注入（Unity Android ビルドに必要）
      if (jdkPath) {
        if (!env.JAVA_HOME) env.JAVA_HOME = jdkPath;
        // PATH に bin を先頭追加しておくことで Unity が java コマンドを見つけやすくする
        const javaBin = path.join(jdkPath, 'bin');
        const pathSep = process.platform === 'win32' ? ';' : ':';
        const currentPath = env.PATH || '';
        if (!currentPath.includes(javaBin)) {
          env.PATH = `${javaBin}${pathSep}${currentPath}`;
        }
      }

      // Android SDK パス注入
      if (androidSdkPath) {
        if (!env.ANDROID_HOME) env.ANDROID_HOME = androidSdkPath;
        if (!env.ANDROID_SDK_ROOT) env.ANDROID_SDK_ROOT = androidSdkPath;
      }

      // Windowsでも shell 経由にせず、Unity.exe を直接起動する（スペース含むパスでも安全）
      this.currentProcess = spawn(this.unityPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        shell: false,
        windowsHide: true,
      });

      this.currentProcess.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            this.emit('log', `[Unity] ${line}`);
            this.parseUnityProgress(line);
          }
        }
      });

      this.currentProcess.stderr?.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            this.emit('log', `[Unity Error] ${line}`);
          }
        }
      });

      const timeout = setTimeout(() => {
        if (this.currentProcess) {
          this.emit('log', `[Unity] Build timed out after ${timeoutMinutes} minutes`);
          // Windows: SIGKILL が使えないため通常のkill()を使用
          if (process.platform === 'win32') {
            this.currentProcess.kill();
          } else {
            this.currentProcess.kill('SIGKILL');
          }
        }
      }, timeoutMinutes * 60 * 1000);

      this.currentProcess.on('close', async (code) => {
        clearTimeout(timeout);
        this.currentProcess = null;
        const logIssues = await this.readUnityLogIssues(logFile);
        if (logIssues.errors.length > 0) {
          logIssues.errors.forEach((line) => this.emit('log', `[Unity Error] ${line}`));
        }

        const isLicensingMessage = (text: string) => this.isLicensingNoise(text);

        const pickBestError = (errors: string[]) => {
          // 1) コンパイルエラー
          const csError = errors.find((e) => /error\s+CS\d+/i.test(e));
          if (csError) return csError;

          // 2) BuildFailedException / Player build error
          const buildFailure = errors.find((e) => /BuildFailedException|Error building Player/i.test(e));
          if (buildFailure) return buildFailure;

          // 3) ライセンス以外のエラーを優先
          const nonLicensing = errors.find((e) => !isLicensingMessage(e));
          if (nonLicensing) return nonLicensing;

          // 4) それでも無ければ先頭
          return errors[0];
        };

        // Unity はログに例外が出ても exit code 0 で成功することがあるため、
        // 成功コードの場合はビルド成功を優先する。
        if (code === 0) {
          resolve({ success: true });
          return;
        }

        if (logIssues.errors.length > 0) {
          const best = pickBestError(logIssues.errors);
          const hasNonLicensingError = logIssues.errors.some((e) => !isLicensingMessage(e));

          if (isLicensingMessage(best) && !hasNonLicensingError) {
            const hint: string[] = [];
            hint.push(best);
            hint.push('');
            hint.push('[Arsist] Unity licensing error in headless mode. This is usually NOT project logic.');
            hint.push('[Arsist] Check: Unity Hub login, system date/time, UnityLicensingClient install/permissions, network/proxy.');
            hint.push('');
            hint.push('[Arsist] Unity command line:');
            hint.push(unityCommandLine);
            hint.push('');
            hint.push(describeExecutionContext());
            resolve({ success: false, error: hint.join('\n') });
            return;
          }

          resolve({ success: false, error: best });
          return;
        }

        resolve({ success: false, error: `Unity build failed with exit code ${code}` });
      });

      this.currentProcess.on('error', (error) => {
        clearTimeout(timeout);
        this.currentProcess = null;
        resolve({ success: false, error: error.message });
      });
    });
  }

  private parseUnityProgress(line: string): void {
    // Unityのログから進捗を解析
    if (line.includes('Compiling shader')) {
      this.emitProgress('build', 55, 'シェーダーをコンパイル中...');
    } else if (line.includes('Building scene')) {
      this.emitProgress('build', 60, 'シーンをビルド中...');
    } else if (line.includes('Packaging assets')) {
      this.emitProgress('build', 70, 'アセットをパッケージ中...');
    } else if (line.includes('Creating APK')) {
      this.emitProgress('build', 80, 'APKを作成中...');
    } else if (line.includes('Build completed')) {
      this.emitProgress('build', 85, 'ビルド処理完了');
    }
  }

  private async verifyBuildOutput(
    config: UnityBuildConfig,
    options?: { sinceEpochMs?: number },
  ): Promise<string | null> {
    const projectName = (config.manifestData as any)?.projectName as string | undefined;
    const possibleOutputs = [
      path.join(config.outputPath, `${path.basename(config.projectPath)}.apk`),
      ...(projectName ? [path.join(config.outputPath, `${projectName}.apk`)] : []),
      path.join(config.outputPath, 'build.apk'),
      path.join(config.outputPath, 'ArsistApp.apk'),
    ];

    for (const output of possibleOutputs) {
      if (await fs.pathExists(output)) {
        try {
          const st = await fs.stat(output);
          if (options?.sinceEpochMs && st.mtimeMs < options.sinceEpochMs) {
            continue;
          }
          return output;
        } catch {
          // ignore
        }
      }
    }

    // ディレクトリ内の.apk/.aabファイルを探す（最新を優先）
    try {
      const files = await fs.readdir(config.outputPath);
      const candidates = files
        .filter((f) => f.toLowerCase().endsWith('.apk') || f.toLowerCase().endsWith('.aab'))
        .map((f) => path.join(config.outputPath, f));

      let best: { path: string; mtimeMs: number } | null = null;
      for (const candidate of candidates) {
        try {
          const st = await fs.stat(candidate);
          if (options?.sinceEpochMs && st.mtimeMs < options.sinceEpochMs) {
            continue;
          }
          if (!best || st.mtimeMs > best.mtimeMs) {
            best = { path: candidate, mtimeMs: st.mtimeMs };
          }
        } catch {
          // ignore
        }
      }

      if (best) return best.path;
    } catch (e) {
      // ignore
    }

    // サブディレクトリも含めて探索（Unity設定によっては下位フォルダへ出力されるため）
    try {
      const maxDepth = 5;
      const stack: Array<{ dir: string; depth: number }> = [{ dir: config.outputPath, depth: 0 }];
      let best: { path: string; mtimeMs: number } | null = null;

      while (stack.length > 0) {
        const current = stack.pop()!;
        if (current.depth > maxDepth) continue;

        const entries = await fs.readdir(current.dir);
        for (const entry of entries) {
          const fullPath = path.join(current.dir, entry);
          let stat;
          try {
            stat = await fs.stat(fullPath);
          } catch {
            continue;
          }

          if (stat.isDirectory()) {
            stack.push({ dir: fullPath, depth: current.depth + 1 });
            continue;
          }

          const lower = entry.toLowerCase();
          if (!lower.endsWith('.apk') && !lower.endsWith('.aab')) continue;
          if (options?.sinceEpochMs && stat.mtimeMs < options.sinceEpochMs) continue;

          if (!best || stat.mtimeMs > best.mtimeMs) {
            best = { path: fullPath, mtimeMs: stat.mtimeMs };
          }
        }
      }

      if (best) return best.path;
    } catch {
      // ignore
    }

    return null;
  }

  private async readUnityLogIssues(logFile: string): Promise<{ errors: string[]; warnings: string[] }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!await fs.pathExists(logFile)) {
      return { errors, warnings };
    }

    try {
      const content = await fs.readFile(logFile, 'utf-8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;

        if (/Scripts have compiler errors\./i.test(t)) {
          errors.push(t);
          continue;
        }

        if (this.isLicensingNoise(t)) {
          continue;
        }

        // Unity/CSC は "error CSxxxx" のように小文字になることがある
        // ただし "ValidationExceptions.json" のようなファイル名もあるため、Exception 判定はコロン付きに限定する
        if (/(^|\s)error(\s|:)/i.test(t) || (/Exception\s*:/i.test(t) && !this.isLicensingNoise(t)) || /BuildFailedException\s*:/i.test(t)) {
          errors.push(t);
          continue;
        }

        if (/(^|\s)warning(\s|:)/i.test(t)) {
          warnings.push(t);
        }
      }
    } catch (error) {
      this.emit('log', `[Arsist] Failed to read Unity log: ${(error as Error).message}`);
    }

    return { errors, warnings };
  }

  private async resolveAdapterDir(targetDevice: string): Promise<string | null> {
    const resolvedRepo = this.resolveRepoRoot();
    const adaptersRoot = resolvedRepo.path
      ? path.join(resolvedRepo.path, 'Adapters')
      : process.resourcesPath
        ? path.join(process.resourcesPath, 'Adapters')
        : path.join(__dirname, '../../..', 'Adapters');
    if (!await fs.pathExists(adaptersRoot)) return null;

    const direct = path.join(adaptersRoot, targetDevice);
    if (await fs.pathExists(direct)) return direct;

    const normalizedTarget = targetDevice.replace(/[-\s]/g, '_').toLowerCase();
    const entries = await fs.readdir(adaptersRoot);
    for (const entry of entries) {
      const normalizedEntry = entry.replace(/[-\s]/g, '_').toLowerCase();
      if (normalizedEntry === normalizedTarget) {
        return path.join(adaptersRoot, entry);
      }
    }

    return null;
  }

  private emitProgress(phase: string, progress: number, message: string): void {
    this.emit('progress', { phase, progress, message } as BuildProgress);
  }
}
