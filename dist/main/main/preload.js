"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Arsist Engine - Preload Script
 * レンダラープロセスとメインプロセスの安全な橋渡し
 */
const electron_1 = require("electron");
// API定義
const electronAPI = {
    // プロジェクト管理
    project: {
        create: (options) => electron_1.ipcRenderer.invoke('project:create', options),
        load: (projectPath) => electron_1.ipcRenderer.invoke('project:load', projectPath),
        save: (data) => electron_1.ipcRenderer.invoke('project:save', data),
        export: (options) => electron_1.ipcRenderer.invoke('project:export', options),
        /** 古い版の IR を今の版で書き戻す (承諾後)。元のファイルは Backups/ に残る */
        upgrade: () => electron_1.ipcRenderer.invoke('project:upgrade'),
    },
    // 学習済みモデル (ONNX)
    model: {
        /** ファイル選択 → Assets/Models へコピー → 入出力を読んで定義の下書きを返す */
        import: (projectPath, sourcePath) => electron_1.ipcRenderer.invoke('model:import', { projectPath, sourcePath }),
        inspect: (projectPath, file) => electron_1.ipcRenderer.invoke('model:inspect', { projectPath, file }),
        readLabels: (path) => electron_1.ipcRenderer.invoke('model:read-labels', { path }),
        /** 文章のモデルの tokenizer.json を取り込む (隣の tokenizer_config.json なども読む) */
        importTokenizer: (projectPath, modelName, sourcePath) => electron_1.ipcRenderer.invoke('model:import-tokenizer', { projectPath, modelName, sourcePath }),
        /** Hugging Face のリポジトリにある ONNX の候補 (精度違い) を読む */
        hfInspect: (repo) => electron_1.ipcRenderer.invoke('model:hf-inspect', { repo }),
        /** 選んだ 1 本を落として取り込む。進み具合は onHfProgress に届く */
        hfImport: (runId, repo, variantPath, projectPath, name) => electron_1.ipcRenderer.invoke('model:hf-import', { runId, repo, variantPath, projectPath, name }),
        hfCancel: (runId) => electron_1.ipcRenderer.invoke('model:hf-cancel', runId),
        onHfProgress: (callback) => {
            const handler = (_, payload) => callback(payload);
            electron_1.ipcRenderer.on('model:hf-progress', handler);
            return () => {
                electron_1.ipcRenderer.removeListener('model:hf-progress', handler);
            };
        },
        /** 「試す」: 実機と同じ C# を ONNX Runtime で動かす。途中経過は onTryLine に届く */
        try: (runId, projectPath, request) => electron_1.ipcRenderer.invoke('model:try', { runId, projectPath, request }),
        cancelTry: (runId) => electron_1.ipcRenderer.invoke('model:try-cancel', runId),
        onTryLine: (callback) => {
            const handler = (_, payload) => callback(payload);
            electron_1.ipcRenderer.on('model:try-line', handler);
            return () => {
                electron_1.ipcRenderer.removeListener('model:try-line', handler);
            };
        },
    },
    // Unity連携
    vision: {
        /** パイプラインを1枚の画像に流し、各ステップの結果を返す */
        preview: (pipeline, image, options) => electron_1.ipcRenderer.invoke('vision:preview', { pipeline, image, ...(options ?? {}) }),
    },
    // 端末への配布 (adb)
    device: {
        /** つながっている端末を並べる */
        list: () => electron_1.ipcRenderer.invoke('device:list'),
        /** ビルドした APK を入れる */
        install: (serial, apkPath) => electron_1.ipcRenderer.invoke('device:install', { serial, apkPath }),
        onInstallLog: (callback) => {
            const handler = (_, line) => callback(line);
            electron_1.ipcRenderer.on('device:install-log', handler);
            return () => {
                electron_1.ipcRenderer.removeListener('device:install-log', handler);
            };
        },
    },
    unity: {
        setPath: (unityPath) => electron_1.ipcRenderer.invoke('unity:set-path', unityPath),
        getPath: () => electron_1.ipcRenderer.invoke('unity:get-path'),
        /** Android ビルドに使える Gradle のパス。無ければ null */
        detectGradle: () => electron_1.ipcRenderer.invoke('unity:detect-gradle'),
        build: (config) => electron_1.ipcRenderer.invoke('unity:build', config),
        cancelBuild: () => electron_1.ipcRenderer.invoke('unity:cancel-build'),
        validate: () => electron_1.ipcRenderer.invoke('unity:validate'),
        detectPaths: () => electron_1.ipcRenderer.invoke('unity:detect-paths'),
        onBuildProgress: (callback) => {
            const handler = (_, progress) => callback(progress);
            electron_1.ipcRenderer.on('unity:build-progress', handler);
            return () => {
                electron_1.ipcRenderer.removeListener('unity:build-progress', handler);
            };
        },
        onBuildLog: (callback) => {
            const handler = (_, log) => callback(log);
            electron_1.ipcRenderer.on('unity:build-log', handler);
            return () => {
                electron_1.ipcRenderer.removeListener('unity:build-log', handler);
            };
        },
    },
    // アダプター（SDKパッチ）管理
    adapters: {
        list: () => electron_1.ipcRenderer.invoke('adapters:list'),
        get: (adapterId) => electron_1.ipcRenderer.invoke('adapters:get', adapterId),
        applyPatch: (adapterId, projectPath) => electron_1.ipcRenderer.invoke('adapters:apply-patch', adapterId, projectPath),
    },
    // ファイルシステム
    fs: {
        readFile: (filePath) => electron_1.ipcRenderer.invoke('fs:read-file', filePath),
        writeFile: (filePath, content) => electron_1.ipcRenderer.invoke('fs:write-file', filePath, content),
        selectDirectory: () => electron_1.ipcRenderer.invoke('fs:select-directory'),
        selectFile: (filters) => electron_1.ipcRenderer.invoke('fs:select-file', filters),
        exists: (filePath) => electron_1.ipcRenderer.invoke('fs:exists', filePath),
    },
    // SDK状態
    sdk: {
        getDir: () => electron_1.ipcRenderer.invoke('sdk:get-dir'),
        setDir: (sdkDir) => electron_1.ipcRenderer.invoke('sdk:set-dir', sdkDir),
        xrealStatus: () => electron_1.ipcRenderer.invoke('sdk:xreal-status'),
        questStatus: () => electron_1.ipcRenderer.invoke('sdk:quest-status'),
        bundledDeps: () => electron_1.ipcRenderer.invoke('sdk:bundled-deps'),
    },
    // アセット管理
    assets: {
        import: (params) => electron_1.ipcRenderer.invoke('assets:import', params),
        list: (params) => electron_1.ipcRenderer.invoke('assets:list', params),
    },
    // 設定ストア
    store: {
        get: (key) => electron_1.ipcRenderer.invoke('store:get', key),
        set: (key, value) => electron_1.ipcRenderer.invoke('store:set', key, value),
    },
    // MCP サーバー管理
    mcp: {
        start: (projectPath) => electron_1.ipcRenderer.invoke('mcp:start', projectPath),
        stop: () => electron_1.ipcRenderer.invoke('mcp:stop'),
        getStatus: () => electron_1.ipcRenderer.invoke('mcp:status'),
        getClientConfig: () => electron_1.ipcRenderer.invoke('mcp:get-client-config'),
    },
    // ウィンドウ操作
    window: {
        minimize: () => electron_1.ipcRenderer.invoke('window:minimize'),
        maximize: () => electron_1.ipcRenderer.invoke('window:maximize'),
        close: () => electron_1.ipcRenderer.invoke('window:close'),
    },
    // アプリ全般（UI言語などメインプロセスと同期する設定）
    app: {
        setLanguage: (lang) => electron_1.ipcRenderer.invoke('app:set-language', lang),
    },
    // メニューイベント
    menu: {
        onNewProject: (callback) => {
            electron_1.ipcRenderer.on('menu:new-project', () => callback());
        },
        onSave: (callback) => {
            electron_1.ipcRenderer.on('menu:save', () => callback());
        },
        onSaveAs: (callback) => {
            electron_1.ipcRenderer.on('menu:save-as', () => callback());
        },
        onBuildSettings: (callback) => {
            electron_1.ipcRenderer.on('menu:build-settings', () => callback());
        },
        onBuild: (callback) => {
            electron_1.ipcRenderer.on('menu:build', () => callback());
        },
        onSettings: (callback) => {
            electron_1.ipcRenderer.on('menu:settings', () => callback());
        },
        onDelete: (callback) => {
            electron_1.ipcRenderer.on('menu:delete', () => callback());
        },
        onViewChange: (callback) => {
            electron_1.ipcRenderer.on('menu:view', (_, view) => callback(view));
        },
        onProjectOpen: (callback) => {
            electron_1.ipcRenderer.on('project:open', (_, path) => callback(path));
        },
    },
};
// コンテキストブリッジでAPIを公開
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
//# sourceMappingURL=preload.js.map