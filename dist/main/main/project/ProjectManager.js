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
exports.ProjectManager = void 0;
/**
 * Arsist Engine — Project Manager
 * プロジェクトの作成、読み込み、保存、エクスポート管理
 *
 * DataSource → DataStore → UI の3層構造。
 * ロジックグラフや UIコードバンドルは存在しない。
 */
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
const uuid_1 = require("uuid");
const YAML = __importStar(require("yaml"));
const irVersion_1 = require("../../shared/irVersion");
const migrations_1 = require("./migrations");
const defaults_1 = require("./defaults");
// ========================================
// ProjectManager
// ========================================
class ProjectManager {
    currentProject = null;
    projectPath = null;
    /**
     * 古い版を開いていて、まだアップグレードを承諾されていない間 true。
     * この間は saveProject を断る。黙って新しい形で上書きすると、
     * 古いエディタに戻れなくなるうえ、何が変わったかも残らない。
     */
    readOnly = false;
    pendingUpgrade = null;
    /* ------------------------------------------------
     * 新規プロジェクト作成
     * ----------------------------------------------- */
    async createProject(options) {
        try {
            const projectDir = path.join(options.path, options.name);
            // ディレクトリ作成
            await fs.ensureDir(projectDir);
            await fs.ensureDir(path.join(projectDir, 'Assets'));
            await fs.ensureDir(path.join(projectDir, 'Assets', 'Textures'));
            await fs.ensureDir(path.join(projectDir, 'Assets', 'Models'));
            await fs.ensureDir(path.join(projectDir, 'Assets', 'Fonts'));
            await fs.ensureDir(path.join(projectDir, 'Assets', 'Audio'));
            await fs.ensureDir(path.join(projectDir, 'Scenes'));
            await fs.ensureDir(path.join(projectDir, 'UI'));
            await fs.ensureDir(path.join(projectDir, 'Scripts'));
            await fs.ensureDir(path.join(projectDir, 'Build'));
            const arSettings = (0, defaults_1.createARSettings)(options.template);
            const normalizedTarget = (options.targetDevice || '').toLowerCase();
            const isQuest = normalizedTarget.includes('quest') || normalizedTarget.includes('meta');
            const project = {
                id: (0, uuid_1.v4)(),
                name: options.name,
                version: '1.0.0',
                irVersion: irVersion_1.CURRENT_IR_VERSION,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                appType: options.template,
                targetDevice: options.targetDevice,
                arSettings,
                designSystem: {
                    defaultFont: 'Roboto-Regular.ttf',
                    primaryColor: '#569cd6',
                    secondaryColor: '#4ec9b0',
                    backgroundColor: '#1e1e1e',
                    textColor: '#FFFFFF',
                },
                dataFlow: (0, defaults_1.createInitialDataFlow)(),
                scenes: [],
                uiLayouts: [],
                models: [],
                buildSettings: {
                    packageName: `com.arsist.${options.name.toLowerCase().replace(/\s+/g, '')}`,
                    version: '1.0.0',
                    versionCode: 1,
                    minSdkVersion: isQuest ? 32 : 29,
                    // Quest の要件は「target 32 以上」。ただし 32 ちょうどにしてはいけない:
                    // Unity 同梱の Android SDK は platforms;android-32 を持っておらず
                    // (Unity 6 は 34/35/36)、compileSdk として要求された時点で Gradle が
                    // 「licences have not been accepted」で落ちる。要件を満たす最小ではなく、
                    // Unity が実際に持っている 34 を既定にする。
                    targetSdkVersion: 34,
                    remoteInput: {
                        udp: { enabled: true, port: 19100 },
                        tcp: { enabled: true, port: 19101 },
                        allowedEvents: [],
                    },
                },
            };
            // テンプレートに基づいて初期シーン・UI作成
            const initialScene = this.createInitialScene(options.template);
            const initialUI = this.createInitialUI(options.template);
            project.scenes.push(initialScene);
            project.uiLayouts.push(initialUI);
            // ファイル保存
            await fs.writeJSON(path.join(projectDir, 'project.json'), project, { spaces: 2 });
            await fs.writeJSON(path.join(projectDir, 'Scenes', `${initialScene.id}.json`), initialScene, { spaces: 2 });
            await fs.writeJSON(path.join(projectDir, 'UI', `${initialUI.id}.json`), initialUI, { spaces: 2 });
            this.currentProject = project;
            this.projectPath = projectDir;
            this.readOnly = false;
            this.pendingUpgrade = null;
            return { success: true, project };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    /* ------------------------------------------------
     * 既存プロジェクトを読み込み
     *
     * 版の扱いは Unity と同じ:
     *   - 今の版より古い → メモリ上で移行して開き、`upgrade` を返す。
     *     ユーザーが upgradeProject() で承諾するまで読み取り専用 (保存を断る)。
     *   - 今の版より新しい → 開かない ('irTooNew')。壊すよりは断る方がよい。
     * ----------------------------------------------- */
    async loadProject(projectPath) {
        try {
            const projectFile = path.join(projectPath, 'project.json');
            if (!(await fs.pathExists(projectFile))) {
                return { success: false, error: 'project.json not found' };
            }
            const raw = await fs.readJSON(projectFile);
            let migration;
            try {
                migration = (0, migrations_1.migrateProject)(raw);
            }
            catch (e) {
                if (e instanceof migrations_1.IrVersionError) {
                    return { success: false, error: 'irTooNew', irVersion: { found: e.found, supported: e.supported } };
                }
                throw e;
            }
            const project = migration.project;
            const upgrade = migration.from < migration.to
                ? { from: migration.from, to: migration.to, applied: migration.applied, changes: migration.changes }
                : undefined;
            // Scripts ディレクトリが存在しない場合は作成 (読み取り専用で開くときは触らない)
            if (!upgrade)
                await fs.ensureDir(path.join(projectPath, 'Scripts'));
            // シーン、UIの詳細を読み込み
            project.scenes = await this.loadScenes(projectPath, project.scenes);
            project.uiLayouts = await this.loadUILayouts(projectPath, project.uiLayouts);
            this.currentProject = project;
            this.projectPath = projectPath;
            this.readOnly = upgrade !== undefined;
            this.pendingUpgrade = upgrade ?? null;
            return { success: true, project, upgrade };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    /* ------------------------------------------------
     * 古い版のプロジェクトを今の版で書き戻す (ユーザーの承諾後)。
     *
     * 元の project.json は Backups/ に残す。移行は自動で戻せないので、
     * 古いエディタに戻りたくなったときの唯一の道がこれ。
     * ----------------------------------------------- */
    async upgradeProject() {
        if (!this.currentProject || !this.projectPath) {
            return { success: false, error: 'No project loaded' };
        }
        const upgrade = this.pendingUpgrade;
        if (!upgrade)
            return { success: true };
        try {
            const projectFile = path.join(this.projectPath, 'project.json');
            const backupDir = path.join(this.projectPath, 'Backups');
            await fs.ensureDir(backupDir);
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(backupDir, `project.v${upgrade.from}.${stamp}.json`);
            if (await fs.pathExists(projectFile))
                await fs.copy(projectFile, backupPath);
            this.readOnly = false;
            this.pendingUpgrade = null;
            this.currentProject.irVersion = irVersion_1.CURRENT_IR_VERSION;
            const saved = await this.saveProject({});
            if (!saved.success) {
                this.readOnly = true;
                this.pendingUpgrade = upgrade;
                return { success: false, error: saved.error };
            }
            return { success: true, backupPath };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    /** 読み取り専用で開いたままにする (アップグレードを見送る)。 */
    isReadOnly() {
        return this.readOnly;
    }
    getPendingUpgrade() {
        return this.pendingUpgrade;
    }
    /* ------------------------------------------------
     * プロジェクトを保存
     * ----------------------------------------------- */
    async saveProject(data) {
        if (!this.currentProject || !this.projectPath) {
            return { success: false, error: 'No project loaded' };
        }
        if (this.readOnly) {
            // 古い版のまま。アップグレードを承諾するまで書き換えない。
            return { success: false, error: 'readOnly' };
        }
        try {
            Object.assign(this.currentProject, data);
            this.currentProject.updatedAt = new Date().toISOString();
            // メインプロジェクトファイル保存
            await fs.writeJSON(path.join(this.projectPath, 'project.json'), this.currentProject, { spaces: 2 });
            // 各シーンを個別ファイルに保存
            for (const scene of this.currentProject.scenes) {
                await fs.writeJSON(path.join(this.projectPath, 'Scenes', `${scene.id}.json`), scene, { spaces: 2 });
            }
            // 各UIレイアウトを保存
            for (const ui of this.currentProject.uiLayouts) {
                await fs.writeJSON(path.join(this.projectPath, 'UI', `${ui.id}.json`), ui, { spaces: 2 });
            }
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    /* ------------------------------------------------
     * Unityビルド用にエクスポート
     * ----------------------------------------------- */
    async exportProject(options) {
        if (!this.currentProject || !this.projectPath) {
            return { success: false, error: 'No project loaded' };
        }
        try {
            const exportDir = options.outputPath;
            await fs.ensureDir(exportDir);
            // Unity用マニフェスト
            const manifest = this.generateUnityManifest();
            if (options.format === 'json') {
                await fs.writeJSON(path.join(exportDir, 'manifest.json'), manifest, { spaces: 2 });
            }
            else if (options.format === 'yaml') {
                await fs.writeFile(path.join(exportDir, 'manifest.yaml'), YAML.stringify(manifest));
            }
            // シーンデータ出力
            await fs.writeJSON(path.join(exportDir, 'scenes.json'), this.currentProject.scenes, { spaces: 2 });
            // UIレイアウトデータ出力
            await fs.writeJSON(path.join(exportDir, 'ui_layouts.json'), this.currentProject.uiLayouts, { spaces: 2 });
            // DataFlow 定義出力
            await fs.writeJSON(path.join(exportDir, 'dataflow.json'), this.currentProject.dataFlow, { spaces: 2 });
            // スクリプトバンドル出力 (Jint用 JSON IR)
            const scriptBundle = {
                version: '1.0',
                scripts: (this.currentProject.scripts ?? [])
                    .filter((sc) => sc.enabled)
                    .map((sc) => ({ id: sc.id, trigger: sc.trigger, code: sc.code, enabled: sc.enabled })),
            };
            await fs.writeJSON(path.join(exportDir, 'scripts.json'), scriptBundle, { spaces: 2 });
            // アセットをコピー
            if (options.includeAssets) {
                await fs.copy(path.join(this.projectPath, 'Assets'), path.join(exportDir, 'Assets'));
            }
            return { success: true, outputPath: exportDir };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    getCurrentProject() {
        return this.currentProject;
    }
    getProjectPath() {
        return this.projectPath;
    }
    // ========================================
    // Private Helpers
    // ========================================
    createInitialScene(template) {
        const scene = {
            id: (0, uuid_1.v4)(),
            name: 'MainScene',
            objects: [],
        };
        if (template === '3d_ar_scene') {
            scene.objects.push({
                id: (0, uuid_1.v4)(),
                name: 'SampleCube',
                type: 'primitive',
                primitiveType: 'cube',
                transform: {
                    position: { x: 0, y: 0, z: 2 },
                    rotation: { x: 0, y: 45, z: 0 },
                    scale: { x: 0.3, y: 0.3, z: 0.3 },
                },
                material: {
                    color: '#FF5722',
                    metallic: 0.5,
                    roughness: 0.5,
                },
            });
        }
        if (template === '2d_floating_screen') {
            scene.objects.push({
                id: (0, uuid_1.v4)(),
                name: 'FloatingScreen',
                type: 'primitive',
                primitiveType: 'plane',
                transform: {
                    position: { x: 0, y: 0, z: 2 },
                    rotation: { x: 0, y: 0, z: 0 },
                    scale: { x: 1.6, y: 0.9, z: 1 },
                },
                material: {
                    color: '#1e1e1e',
                    metallic: 0,
                    roughness: 1,
                },
            });
        }
        return scene;
    }
    createInitialUI(template) {
        const ui = {
            id: (0, uuid_1.v4)(),
            name: 'MainUI',
            scope: 'uhd',
            resolution: { width: 1920, height: 1080 },
            root: {
                id: (0, uuid_1.v4)(),
                type: 'Panel',
                layout: 'FlexColumn',
                style: {
                    backgroundColor: '#00000088',
                    borderRadius: 20,
                    padding: { top: 20, right: 20, bottom: 20, left: 20 },
                },
                children: [],
            },
        };
        if (template === 'head_locked_hud') {
            ui.root.children = [
                {
                    id: (0, uuid_1.v4)(),
                    type: 'Text',
                    content: 'STATUS',
                    style: {
                        fontSize: 18,
                        color: '#FFFFFF',
                        fontWeight: 'bold',
                    },
                    children: [],
                },
                {
                    id: (0, uuid_1.v4)(),
                    type: 'Text',
                    content: '00:00:00',
                    style: {
                        fontSize: 32,
                        color: '#4ec9b0',
                    },
                    children: [],
                },
            ];
        }
        else if (template === '2d_floating_screen') {
            ui.root.style = {
                ...ui.root.style,
                width: 1920,
                height: 1080,
                backgroundColor: '#000000FF',
            };
        }
        return ui;
    }
    async loadScenes(projectPath, sceneRefs) {
        const scenes = [];
        for (const ref of sceneRefs) {
            try {
                const scenePath = path.join(projectPath, 'Scenes', `${ref.id}.json`);
                if (await fs.pathExists(scenePath)) {
                    const scene = await fs.readJSON(scenePath);
                    // 後方互換: objects.type === 'ui_surface' → 'canvas'
                    for (const obj of scene.objects || []) {
                        if (obj.type === 'ui_surface') {
                            obj.type = 'canvas';
                            if (obj.uiSurface) {
                                obj.canvasSettings = {
                                    layoutId: obj.uiSurface.layoutId || '',
                                    widthMeters: obj.uiSurface.width || 1.2,
                                    heightMeters: obj.uiSurface.height || 0.7,
                                    pixelsPerUnit: obj.uiSurface.pixelsPerUnit || 1000,
                                };
                                delete obj.uiSurface;
                            }
                        }
                        // 旧 components フィールド削除
                        delete obj.components;
                    }
                    scenes.push(scene);
                }
            }
            catch (e) {
                console.error(`Failed to load scene ${ref.id}:`, e);
            }
        }
        return scenes;
    }
    async loadUILayouts(projectPath, uiRefs) {
        const layouts = [];
        for (const ref of uiRefs) {
            try {
                const uiPath = path.join(projectPath, 'UI', `${ref.id}.json`);
                if (await fs.pathExists(uiPath)) {
                    const layout = await fs.readJSON(uiPath);
                    // 後方互換
                    if (!layout.scope)
                        layout.scope = 'uhd';
                    if (!layout.resolution) {
                        layout.resolution = layout.scope === 'canvas'
                            ? { width: 1024, height: 1024 }
                            : { width: 1920, height: 1080 };
                    }
                    layouts.push(layout);
                }
            }
            catch (e) {
                console.error(`Failed to load UI layout ${ref.id}:`, e);
            }
        }
        return layouts;
    }
    generateUnityManifest() {
        if (!this.currentProject)
            return {};
        const { remoteInput, ...androidBuild } = this.currentProject.buildSettings;
        const scripts = this.currentProject.scripts ?? [];
        const hasActiveScripts = scripts.some((sc) => sc.enabled);
        return {
            projectId: this.currentProject.id,
            projectName: this.currentProject.name,
            version: this.currentProject.version,
            irVersion: this.currentProject.irVersion ?? irVersion_1.CURRENT_IR_VERSION,
            appType: this.currentProject.appType,
            targetDevice: this.currentProject.targetDevice,
            arSettings: this.currentProject.arSettings,
            designSystem: this.currentProject.designSystem,
            dataFlow: this.currentProject.dataFlow,
            build: androidBuild,
            buildSettings: this.currentProject.buildSettings,
            remoteInput,
            scripting: {
                enabled: hasActiveScripts,
            },
            models: this.currentProject.models ?? [],
            exportedAt: new Date().toISOString(),
        };
    }
}
exports.ProjectManager = ProjectManager;
//# sourceMappingURL=ProjectManager.js.map