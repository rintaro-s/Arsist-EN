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
exports.UnityBuilder = void 0;
/**
 * Arsist Engine - Unity Builder
 * Unity CLI連携によるヘッドレスビルド実行
 */
const events_1 = require("events");
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
const electron_1 = require("electron");
const os = __importStar(require("os"));
class UnityBuilder extends events_1.EventEmitter {
    unityPath;
    currentProcess = null;
    unityTemplatePath;
    buildInProgress = false;
    lastLogFile = null;
    isLicensingNoise(text) {
        const s = text || '';
        return (/Access token is unavailable/i.test(s) ||
            /Licensing::Module/i.test(s) ||
            /Licensing::Client/i.test(s) ||
            /LicensingClient has failed validation/i.test(s) ||
            /Code\s*10\s*while verifying Licensing Client signature/i.test(s) ||
            /Exception\s*occ?u?r?e?d?\s+while\s+accepting\s+client\s+connection/i.test(s) ||
            (/System\.IO\.IOException/i.test(s) && /(pipe|\u30D1\u30A4\u30D7)/i.test(s)));
    }
    constructor(unityPath) {
        super();
        this.unityPath = unityPath;
        this.unityTemplatePath = path.join(__dirname, '../../..', 'UnityBackend', 'ArsistBuilder');
    }
    resolveUnityTemplatePath() {
        const searched = [];
        const cwd = process.cwd();
        searched.push(path.join(cwd, 'UnityBackend', 'ArsistBuilder'));
        try {
            const appPath = electron_1.app.getAppPath();
            searched.push(path.join(appPath, 'UnityBackend', 'ArsistBuilder'));
        }
        catch {
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
    resolveRepoRoot() {
        const searched = [];
        const candidates = [];
        candidates.push(process.cwd());
        try {
            const appPath = electron_1.app.getAppPath();
            candidates.push(appPath);
            candidates.push(path.dirname(appPath));
        }
        catch {
            // ignore
        }
        // dist/main/main/unity -> repoRoot は ../../../..
        candidates.push(path.join(__dirname, '../../../..'));
        candidates.push(path.join(__dirname, '../../..'));
        for (const c of candidates) {
            const root = path.resolve(c);
            if (searched.includes(root))
                continue;
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
    getUnityPath() {
        return this.unityPath;
    }
    setUnityPath(unityPath) {
        this.unityPath = unityPath;
    }
    /**
     * Unity実行環境の検証
     */
    async validate(requiredVersion) {
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
        }
        catch (error) {
            return { valid: false, error: error.message };
        }
    }
    /**
     * ULFファイルの有効性チェック
     */
    async validateLicenseFile(ulfPath) {
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
        }
        catch (error) {
            return { valid: false, error: `Failed to validate license file: ${error.message}` };
        }
    }
    normalizeOsPath(p) {
        if (!p)
            return p;
        if (process.platform === 'win32') {
            return p.replace(/\//g, '\\');
        }
        return p.replace(/\\/g, '/');
    }
    async importManualLicense(ulfPath, logFile) {
        return new Promise((resolve) => {
            const args = [
                '-batchmode',
                '-nographics',
                '-quit',
                '-manualLicenseFile', this.normalizeOsPath(ulfPath),
                '-logFile', this.normalizeOsPath(logFile),
            ];
            const needsQuotes = (str) => str.includes(' ') || str.includes('"');
            const quoteForLog = (str) => needsQuotes(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
            this.emit('log', `[Unity] Importing manual license: ${quoteForLog(this.unityPath)} ${args.map(quoteForLog).join(' ')}`);
            const env = { ...process.env };
            if (!env.HOME) {
                try {
                    env.HOME = process.platform === 'win32' ? (env.USERPROFILE || electron_1.app.getPath('home')) : electron_1.app.getPath('home');
                }
                catch {
                    // ignore
                }
            }
            env.UNITY_LICENSE_FILE = ulfPath;
            const p = (0, child_process_1.spawn)(this.unityPath, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                env,
                shell: false,
                windowsHide: true,
            });
            const chunks = [];
            p.stdout?.on('data', (d) => chunks.push(d.toString()));
            p.stderr?.on('data', (d) => chunks.push(d.toString()));
            const timeout = setTimeout(() => {
                try {
                    if (process.platform === 'win32')
                        p.kill();
                    else
                        p.kill('SIGKILL');
                }
                catch {
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
                }
                catch {
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
    async build(config) {
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
                }
                else {
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
                }
                else {
                    await fs.ensureDir(config.projectPath);
                }
            }
            catch (error) {
                return { success: false, error: `Failed to prepare project path: ${error.message}` };
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
            const isLicensingError = (msg) => {
                return this.isLicensingNoise(msg);
            };
            const findManualLicenseFile = async () => {
                // Unity Hubでログイン済みでも、ヘッドレス環境ではtoken更新に失敗することがある。
                // その場合に備えて、ローカルの .ulf を指定して起動できるようにする。
                // (Linuxの一般的な配置先)
                const home = (() => {
                    try {
                        return electron_1.app.getPath('home');
                    }
                    catch {
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
                        if (p && await fs.pathExists(p))
                            return p;
                    }
                    catch {
                        // ignore
                    }
                }
                return null;
            };
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
        }
        catch (error) {
            return { success: false, error: error.message };
        }
        finally {
            this.buildInProgress = false;
        }
    }
    /**
     * ビルドキャンセル
     */
    cancel() {
        if (this.currentProcess) {
            // Windows: シグナルが使えないため通常のkill()を使用
            if (process.platform === 'win32') {
                this.currentProcess.kill();
            }
            else {
                this.currentProcess.kill('SIGTERM');
            }
            this.currentProcess = null;
            this.emit('log', '[Arsist] Build cancelled by user');
        }
    }
    // ========================================
    // Private Methods
    // ========================================
    async getUnityVersion() {
        return new Promise((resolve, reject) => {
            const process = (0, child_process_1.spawn)(this.unityPath, ['-version'], { stdio: 'pipe' });
            let output = '';
            process.stdout?.on('data', (data) => {
                output += data.toString();
            });
            process.on('close', (code) => {
                if (code === 0) {
                    resolve(output.trim());
                }
                else {
                    reject(new Error('Failed to get Unity version'));
                }
            });
            process.on('error', reject);
        });
    }
    isUnityVersionCompatible(actual, required) {
        const actualVersion = this.normalizeUnityVersion(actual);
        const requiredVersion = this.normalizeUnityVersion(required);
        if (!actualVersion || !requiredVersion)
            return true;
        return this.compareVersions(actualVersion, requiredVersion) >= 0;
    }
    normalizeUnityVersion(version) {
        const match = version.match(/\d+\.\d+\.\d+(?:f\d+)?/);
        return match ? match[0] : null;
    }
    compareVersions(a, b) {
        const parse = (v) => v.replace('f', '.').split('.').map(n => parseInt(n, 10));
        const av = parse(a);
        const bv = parse(b);
        const len = Math.max(av.length, bv.length);
        for (let i = 0; i < len; i++) {
            const diff = (av[i] || 0) - (bv[i] || 0);
            if (diff !== 0)
                return diff;
        }
        return 0;
    }
    async prepareUnityProject(workingDir) {
        await fs.ensureDir(workingDir);
        await fs.emptyDir(workingDir);
        await fs.copy(this.unityTemplatePath, workingDir);
        return workingDir;
    }
    async transferProjectData(unityProjectPath, config) {
        const dataDir = path.join(unityProjectPath, 'Assets', 'ArsistGenerated');
        await fs.ensureDir(dataDir);
        if (!config.manifestData || !config.scenesData || !config.uiData) {
            throw new Error('Invalid project data: manifest/scenes/ui is required');
        }
        // マニフェスト
        await fs.writeJSON(path.join(dataDir, 'manifest.json'), config.manifestData, { spaces: 2 });
        // シーンデータ
        await fs.writeJSON(path.join(dataDir, 'scenes.json'), config.scenesData, { spaces: 2 });
        // UIデータ
        await fs.writeJSON(path.join(dataDir, 'ui_layouts.json'), config.uiData, { spaces: 2 });
        // DataFlow定義を出力
        const dataFlowData = config.manifestData?.dataFlow;
        if (dataFlowData) {
            await fs.writeJSON(path.join(dataDir, 'dataflow.json'), dataFlowData, { spaces: 2 });
            this.emit('log', '[Arsist] DataFlow definition exported');
        }
        // Arsistプロジェクト内AssetsをUnityプロジェクトにコピー（実アセットとしてUnityに取り込ませる）
        if (config.sourceProjectPath) {
            const sourceAssets = path.join(config.sourceProjectPath, 'Assets');
            if (await fs.pathExists(sourceAssets)) {
                const destAssets = path.join(unityProjectPath, 'Assets', 'ArsistProjectAssets');
                await fs.ensureDir(destAssets);
                await fs.copy(sourceAssets, destAssets, { overwrite: true });
                this.emit('log', '[Arsist] Project Assets copied into Unity (Assets/ArsistProjectAssets)');
            }
            else {
                this.emit('log', `[Arsist] Project Assets folder not found: ${sourceAssets}`);
            }
        }
        this.emit('log', '[Arsist] Project data transferred to Unity');
    }
    async applyDevicePatch(unityProjectPath, targetDevice) {
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
    isXrealTarget(targetDevice) {
        const normalized = (targetDevice || '').toLowerCase();
        return normalized.includes('xreal');
    }
    isQuestTarget(targetDevice) {
        const normalized = (targetDevice || '').toLowerCase();
        return normalized.includes('quest') || normalized.includes('meta');
    }
    async integrateRequiredSdks(unityProjectPath, targetDevice) {
        if (this.isXrealTarget(targetDevice)) {
            await this.integrateXrealSdk(unityProjectPath);
        }
        if (this.isQuestTarget(targetDevice)) {
            await this.integrateQuestSdk(unityProjectPath);
        }
    }
    async integrateXrealSdk(unityProjectPath) {
        const resolvedRepo = this.resolveRepoRoot();
        if (!resolvedRepo.path) {
            throw new Error(`XREAL SDK not found (repo root not detected).\nSearched:\n- ${resolvedRepo.searched.join('\n- ')}`);
        }
        const sdkSourceDir = path.join(resolvedRepo.path, 'sdk', 'com.xreal.xr', 'package');
        const sdkPackageJson = path.join(sdkSourceDir, 'package.json');
        if (!await fs.pathExists(sdkPackageJson)) {
            throw new Error(`XREAL SDK not found. Place the XREAL UPM package at sdk/com.xreal.xr/package (package.json missing).\nLooked for:\n- ${sdkPackageJson}`);
        }
        const destDir = path.join(unityProjectPath, 'Packages', 'com.xreal.xr');
        await fs.ensureDir(path.dirname(destDir));
        await fs.copy(sdkSourceDir, destDir, { overwrite: true });
        const manifestPath = path.join(unityProjectPath, 'Packages', 'manifest.json');
        if (!await fs.pathExists(manifestPath)) {
            throw new Error(`Unity manifest.json not found: ${manifestPath}`);
        }
        const manifest = await fs.readJSON(manifestPath);
        const dependencies = (manifest.dependencies ?? {});
        // Packages/manifest.json からの相対パス（同じフォルダ内のcom.xreal.xr）
        dependencies['com.xreal.xr'] = 'file:com.xreal.xr';
        manifest.dependencies = dependencies;
        await fs.writeJSON(manifestPath, manifest, { spaces: 2 });
        this.emit('log', '[Arsist] Embedded XREAL SDK: Packages/com.xreal.xr (manifest.json updated)');
    }
    async integrateQuestSdk(unityProjectPath) {
        const resolvedRepo = this.resolveRepoRoot();
        if (!resolvedRepo.path) {
            throw new Error(`Quest SDK not found (repo root not detected).\nSearched:\n- ${resolvedRepo.searched.join('\n- ')}`);
        }
        const questSdkDir = path.join(resolvedRepo.path, 'sdk', 'quest');
        if (!await fs.pathExists(questSdkDir)) {
            throw new Error(`Quest SDK directory not found: ${questSdkDir}`);
        }
        const files = await fs.readdir(questSdkDir);
        const coreTgz = files.find((f) => /^com\.meta\.xr\.sdk\.core-.*\.tgz$/i.test(f));
        const mrukTgz = files.find((f) => /^com\.meta\.xr\.mrutilitykit-.*\.tgz$/i.test(f));
        if (!coreTgz) {
            throw new Error(`Quest SDK core package not found. Place com.meta.xr.sdk.core-*.tgz under sdk/quest.\nLooked in:\n- ${questSdkDir}`);
        }
        const packagesDir = path.join(unityProjectPath, 'Packages');
        await fs.ensureDir(packagesDir);
        const copiedPackages = [];
        const copyTgzToPackages = async (packageId, fileName) => {
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
        const dependencies = (manifest.dependencies ?? {});
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
    async applyQuestXrBootstrap(unityProjectPath, repoRoot) {
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
        const copySettingIfExists = async (fileName) => {
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
    async readQuestSampleDependencies(repoRoot) {
        const sampleManifestPath = path.join(repoRoot, 'sdk', 'quest', 'Unity-InteractionSDK-Samples', 'Packages', 'manifest.json');
        if (!await fs.pathExists(sampleManifestPath)) {
            return null;
        }
        try {
            const sampleManifest = await fs.readJSON(sampleManifestPath);
            const deps = sampleManifest?.dependencies;
            if (!deps || typeof deps !== 'object')
                return null;
            return deps;
        }
        catch {
            return null;
        }
    }
    applyQuestRequiredDependencies(targetDependencies, sampleDependencies) {
        const setIfMissing = (pkg, fallbackVersion) => {
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
                if (!pkg.startsWith('com.unity.modules.'))
                    continue;
                if (!targetDependencies[pkg]) {
                    targetDependencies[pkg] = version;
                }
            }
        }
    }
    async executeUnityBuild(unityProjectPath, config, options) {
        return new Promise((resolve) => {
            const timeoutMinutes = config.buildTimeoutMinutes ?? 60;
            const logFile = config.logFilePath || path.join(config.outputPath, 'unity_build.log');
            this.lastLogFile = logFile;
            const describeExecutionContext = () => {
                const lines = [];
                lines.push(`[Arsist] platform=${process.platform}`);
                if (typeof process.getuid === 'function') {
                    try {
                        lines.push(`[Arsist] uid=${process.getuid()} gid=${process.getgid?.()}`);
                    }
                    catch {
                        // ignore
                    }
                }
                try {
                    const u = os.userInfo();
                    lines.push(`[Arsist] user=${u.username} homedir=${u.homedir}`);
                }
                catch {
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
            const needsQuotes = (str) => str.includes(' ') || str.includes('"');
            const quoteForLog = (str) => needsQuotes(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
            const unityCommandLine = `${quoteForLog(this.unityPath)} ${args.map((a) => quoteForLog(a)).join(' ')}`;
            this.emit('log', `[Unity] Starting build: ${unityCommandLine}`);
            const env = { ...process.env };
            // HOME が未設定な環境を補正（ヘッドレス実行での認証問題対策）
            // Windows: USERPROFILE または TEMP を使用
            // Linux/macOS: HOME を使用
            if (!env.HOME) {
                try {
                    if (process.platform === 'win32') {
                        env.HOME = env.USERPROFILE || electron_1.app.getPath('home');
                    }
                    else {
                        env.HOME = electron_1.app.getPath('home');
                    }
                }
                catch {
                    // ignore
                }
            }
            if (options?.manualLicenseFile) {
                env.UNITY_LICENSE_FILE = options.manualLicenseFile;
            }
            // Windowsでも shell 経由にせず、Unity.exe を直接起動する（スペース含むパスでも安全）
            this.currentProcess = (0, child_process_1.spawn)(this.unityPath, args, {
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
                    }
                    else {
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
                const isLicensingMessage = (text) => this.isLicensingNoise(text);
                const pickBestError = (errors) => {
                    // 1) コンパイルエラー
                    const csError = errors.find((e) => /error\s+CS\d+/i.test(e));
                    if (csError)
                        return csError;
                    // 2) BuildFailedException / Player build error
                    const buildFailure = errors.find((e) => /BuildFailedException|Error building Player/i.test(e));
                    if (buildFailure)
                        return buildFailure;
                    // 3) ライセンス以外のエラーを優先
                    const nonLicensing = errors.find((e) => !isLicensingMessage(e));
                    if (nonLicensing)
                        return nonLicensing;
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
                        const hint = [];
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
    parseUnityProgress(line) {
        // Unityのログから進捗を解析
        if (line.includes('Compiling shader')) {
            this.emitProgress('build', 55, 'シェーダーをコンパイル中...');
        }
        else if (line.includes('Building scene')) {
            this.emitProgress('build', 60, 'シーンをビルド中...');
        }
        else if (line.includes('Packaging assets')) {
            this.emitProgress('build', 70, 'アセットをパッケージ中...');
        }
        else if (line.includes('Creating APK')) {
            this.emitProgress('build', 80, 'APKを作成中...');
        }
        else if (line.includes('Build completed')) {
            this.emitProgress('build', 85, 'ビルド処理完了');
        }
    }
    async verifyBuildOutput(config, options) {
        const projectName = config.manifestData?.projectName;
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
                }
                catch {
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
            let best = null;
            for (const candidate of candidates) {
                try {
                    const st = await fs.stat(candidate);
                    if (options?.sinceEpochMs && st.mtimeMs < options.sinceEpochMs) {
                        continue;
                    }
                    if (!best || st.mtimeMs > best.mtimeMs) {
                        best = { path: candidate, mtimeMs: st.mtimeMs };
                    }
                }
                catch {
                    // ignore
                }
            }
            if (best)
                return best.path;
        }
        catch (e) {
            // ignore
        }
        // サブディレクトリも含めて探索（Unity設定によっては下位フォルダへ出力されるため）
        try {
            const maxDepth = 5;
            const stack = [{ dir: config.outputPath, depth: 0 }];
            let best = null;
            while (stack.length > 0) {
                const current = stack.pop();
                if (current.depth > maxDepth)
                    continue;
                const entries = await fs.readdir(current.dir);
                for (const entry of entries) {
                    const fullPath = path.join(current.dir, entry);
                    let stat;
                    try {
                        stat = await fs.stat(fullPath);
                    }
                    catch {
                        continue;
                    }
                    if (stat.isDirectory()) {
                        stack.push({ dir: fullPath, depth: current.depth + 1 });
                        continue;
                    }
                    const lower = entry.toLowerCase();
                    if (!lower.endsWith('.apk') && !lower.endsWith('.aab'))
                        continue;
                    if (options?.sinceEpochMs && stat.mtimeMs < options.sinceEpochMs)
                        continue;
                    if (!best || stat.mtimeMs > best.mtimeMs) {
                        best = { path: fullPath, mtimeMs: stat.mtimeMs };
                    }
                }
            }
            if (best)
                return best.path;
        }
        catch {
            // ignore
        }
        return null;
    }
    async readUnityLogIssues(logFile) {
        const errors = [];
        const warnings = [];
        if (!await fs.pathExists(logFile)) {
            return { errors, warnings };
        }
        try {
            const content = await fs.readFile(logFile, 'utf-8');
            const lines = content.split(/\r?\n/);
            for (const line of lines) {
                const t = line.trim();
                if (!t)
                    continue;
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
        }
        catch (error) {
            this.emit('log', `[Arsist] Failed to read Unity log: ${error.message}`);
        }
        return { errors, warnings };
    }
    async resolveAdapterDir(targetDevice) {
        const resolvedRepo = this.resolveRepoRoot();
        const adaptersRoot = resolvedRepo.path ? path.join(resolvedRepo.path, 'Adapters') : path.join(__dirname, '../../..', 'Adapters');
        if (!await fs.pathExists(adaptersRoot))
            return null;
        const direct = path.join(adaptersRoot, targetDevice);
        if (await fs.pathExists(direct))
            return direct;
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
    emitProgress(phase, progress, message) {
        this.emit('progress', { phase, progress, message });
    }
}
exports.UnityBuilder = UnityBuilder;
//# sourceMappingURL=UnityBuilder.js.map