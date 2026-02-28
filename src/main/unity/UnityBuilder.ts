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

export class UnityBuilder extends EventEmitter {
  private unityPath: string;
  private currentProcess: ChildProcess | null = null;
  private unityTemplatePath: string;
  private buildInProgress = false;
  private lastLogFile: string | null = null;

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
    this.unityTemplatePath = path.join(__dirname, '../../..', 'UnityBackend', 'ArsistBuilder');
  }

  private resolveUnityTemplatePath(): { path: string | null; searched: string[] } {
    const searched: string[] = [];

    const cwd = process.cwd();
    searched.push(path.join(cwd, 'UnityBackend', 'ArsistBuilder'));

    try {
      const appPath = app.getAppPath();
      searched.push(path.join(appPath, 'UnityBackend', 'ArsistBuilder'));
    } catch {
      // ignore
    }

    searched.push(path.join(__dirname, '../../../..', 'UnityBackend', 'ArsistBuilder'));

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
        await fs.emptyDir(config.outputPath);
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
      const unityProjectPath = await this.prepareUnityProject(config.projectPath);

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

      // Phase 4: Unityビルド実行
      this.emitProgress('build', 50, 'Unityビルドを実行中...');
      const buildStartedAt = Date.now();
      const isLicensingError = (msg?: string) => {
        return this.isLicensingNoise(msg);
      };

      const findManualLicenseFile = async (): Promise<string | null> => {
        // Unity Hubでログイン済みでも、ヘッドレス環境ではtoken更新に失敗することがある。
        // その場合に備えて、ローカルの .ulf を指定して起動できるようにする。
        // (Linuxの一般的な配置先)
        const home = (() => {
          try {
            return app.getPath('home');
          } catch {
            return process.env.HOME || '';
          }
        })();

        const candidates = [
          path.join(home, '.local', 'share', 'unity3d', 'Unity', 'Unity_lic.ulf'),
          path.join(home, '.config', 'unity3d', 'Unity', 'Unity_lic.ulf'),
          path.join(home, '.local', 'share', 'unity3d', 'Unity', 'Unity_lic.ulf.bak'),
        ].filter(Boolean);

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

  private async prepareUnityProject(workingDir: string): Promise<string> {
    await fs.ensureDir(workingDir);
    await fs.emptyDir(workingDir);
    await fs.copy(this.unityTemplatePath, workingDir);
    
    // Ensure TextMeshPro package is in manifest
    const manifestPath = path.join(workingDir, 'Packages', 'manifest.json');
    if (await fs.pathExists(manifestPath)) {
      const manifest = await fs.readJSON(manifestPath);
      const dependencies = (manifest.dependencies ?? {}) as Record<string, string>;
      if (!dependencies['com.unity.textmeshpro']) {
        dependencies['com.unity.textmeshpro'] = '3.0.9';
        manifest.dependencies = dependencies;
        await fs.writeJSON(manifestPath, manifest, { spaces: 2 });
        this.emit('log', '[Arsist] Added TextMeshPro package to Unity manifest');
      }
    }
    
    return workingDir;
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

    // ローカル nupkg の探索ルート（resolveRepoRoot でリポジトリルートを取得）
    const resolvedRepo   = this.resolveRepoRoot();
    const localNupkgDir  = resolvedRepo.path
      ? path.join(resolvedRepo.path, 'sdk', 'nupkg')
      : path.join(process.cwd(), 'sdk', 'nupkg');

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

    // マニフェスト
    await fs.writeJSON(
      path.join(dataDir, 'manifest.json'),
      config.manifestData,
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

    // Arsistプロジェクト内AssetsをUnityプロジェクトにコピー（実アセットとしてUnityに取り込ませる）
    if (config.sourceProjectPath) {
      const sourceAssets = path.join(config.sourceProjectPath, 'Assets');
      if (await fs.pathExists(sourceAssets)) {
        const destAssets = path.join(unityProjectPath, 'Assets', 'ArsistProjectAssets');
        await fs.ensureDir(destAssets);
        await fs.copy(sourceAssets, destAssets, { overwrite: true });
        this.emit('log', '[Arsist] Project Assets copied into Unity (Assets/ArsistProjectAssets)');
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
        await fs.copy(manifestPatch, destManifest, { overwrite: true });
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
          await fs.copy(path.join(scriptsPatch, file), path.join(destScripts, file), { overwrite: true });
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
      await fs.copy(packagesPatch, destPackages, { overwrite: true });
      this.emit('log', '[Arsist] Applied packages patch');
    }

    this.emit('log', `[Arsist] Device patch applied for ${targetDevice}`);
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
    const resolvedRepo = this.resolveRepoRoot();
    if (!resolvedRepo.path) {
      throw new Error(
        `XREAL SDK not found (repo root not detected).\nSearched:\n- ${resolvedRepo.searched.join('\n- ')}`
      );
    }

    const sdkSourceDir = path.join(resolvedRepo.path, 'sdk', 'com.xreal.xr', 'package');
    const sdkPackageJson = path.join(sdkSourceDir, 'package.json');

    if (!await fs.pathExists(sdkPackageJson)) {
      throw new Error(
        `XREAL SDK not found. Place the XREAL UPM package at sdk/com.xreal.xr/package (package.json missing).\nLooked for:\n- ${sdkPackageJson}`
      );
    }

    const destDir = path.join(unityProjectPath, 'Packages', 'com.xreal.xr');
    await fs.ensureDir(path.dirname(destDir));
    await fs.copy(sdkSourceDir, destDir, { overwrite: true });

    const manifestPath = path.join(unityProjectPath, 'Packages', 'manifest.json');
    if (!await fs.pathExists(manifestPath)) {
      throw new Error(`Unity manifest.json not found: ${manifestPath}`);
    }

    const manifest = await fs.readJSON(manifestPath);
    const dependencies = (manifest.dependencies ?? {}) as Record<string, string>;
    // Packages/manifest.json からの相対パス（同じフォルダ内のcom.xreal.xr）
    dependencies['com.xreal.xr'] = 'file:com.xreal.xr';
    manifest.dependencies = dependencies;
    await fs.writeJSON(manifestPath, manifest, { spaces: 2 });

    this.emit('log', '[Arsist] Embedded XREAL SDK: Packages/com.xreal.xr (manifest.json updated)');
  }

  private async integrateQuestSdk(unityProjectPath: string): Promise<void> {
    const resolvedRepo = this.resolveRepoRoot();
    if (!resolvedRepo.path) {
      throw new Error(
        `Quest SDK not found (repo root not detected).\nSearched:\n- ${resolvedRepo.searched.join('\n- ')}`
      );
    }

    const questSdkDir = path.join(resolvedRepo.path, 'sdk', 'quest');
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
      await fs.copy(source, destination, { overwrite: true });
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
    const questSampleDependencies = await this.readQuestSampleDependencies(resolvedRepo.path);
    this.applyQuestRequiredDependencies(dependencies, questSampleDependencies);

    manifest.dependencies = dependencies;
    await fs.writeJSON(manifestPath, manifest, { spaces: 2 });

    const names = copiedPackages.map((p) => `${p.id} -> ${p.fileName}`).join(', ');
    const physics2d = dependencies['com.unity.modules.physics2d'] || '(missing)';
    await this.applyQuestXrBootstrap(unityProjectPath, resolvedRepo.path);
    this.emit('log', `[Arsist] Embedded Quest SDK packages: ${names} (manifest.json updated)`);
    this.emit('log', `[Arsist] Quest dependencies ensured (physics2d=${physics2d})`);
  }

  private async applyQuestXrBootstrap(unityProjectPath: string, repoRoot: string): Promise<void> {
    const sampleRoot = path.join(repoRoot, 'sdk', 'quest', 'Unity-InteractionSDK-Samples');
    if (!await fs.pathExists(sampleRoot)) {
      this.emit('log', `[Arsist] Quest XR bootstrap skipped: sample root not found (${sampleRoot})`);
      return;
    }

    const sampleAssetsXr = path.join(sampleRoot, 'Assets', 'XR');
    const sampleProjectSettings = path.join(sampleRoot, 'ProjectSettings');

    if (await fs.pathExists(sampleAssetsXr)) {
      const destAssetsXr = path.join(unityProjectPath, 'Assets', 'XR');
      await fs.copy(sampleAssetsXr, destAssetsXr, { overwrite: true });
    }

    const copySettingIfExists = async (fileName: string) => {
      const src = path.join(sampleProjectSettings, fileName);
      const dst = path.join(unityProjectPath, 'ProjectSettings', fileName);
      if (await fs.pathExists(src)) {
        await fs.copy(src, dst, { overwrite: true });
      }
    };

    await copySettingIfExists('EditorBuildSettings.asset');
    await copySettingIfExists('XRPackageSettings.asset');
    await copySettingIfExists('XRSettings.asset');

    this.emit('log', '[Arsist] Quest XR bootstrap assets/settings applied (Assets/XR + ProjectSettings XR files)');
  }

  private async readQuestSampleDependencies(repoRoot: string): Promise<Record<string, string> | null> {
    const sampleManifestPath = path.join(
      repoRoot,
      'sdk',
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

  private async executeUnityBuild(
    unityProjectPath: string,
    config: UnityBuildConfig,
    options?: { batchMode?: boolean; noGraphics?: boolean; manualLicenseFile?: string },
  ): Promise<{ success: boolean; error?: string }> {
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

      if (options?.manualLicenseFile) {
        env.UNITY_LICENSE_FILE = options.manualLicenseFile;
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
    const adaptersRoot = resolvedRepo.path ? path.join(resolvedRepo.path, 'Adapters') : path.join(__dirname, '../../..', 'Adapters');
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
