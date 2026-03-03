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
    },
    // Unity連携
    unity: {
        setPath: (unityPath) => electron_1.ipcRenderer.invoke('unity:set-path', unityPath),
        getPath: () => electron_1.ipcRenderer.invoke('unity:get-path'),
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