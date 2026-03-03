/**
 * Arsist Engine - Preload Script
 * レンダラープロセスとメインプロセスの安全な橋渡し
 */
import { contextBridge, ipcRenderer } from 'electron';

// API定義
const electronAPI = {
  // プロジェクト管理
  project: {
    create: (options: any) => ipcRenderer.invoke('project:create', options),
    load: (projectPath: string) => ipcRenderer.invoke('project:load', projectPath),
    save: (data: any) => ipcRenderer.invoke('project:save', data),
    export: (options: any) => ipcRenderer.invoke('project:export', options),
  },

  // Unity連携
  unity: {
    setPath: (unityPath: string) => ipcRenderer.invoke('unity:set-path', unityPath),
    getPath: () => ipcRenderer.invoke('unity:get-path'),
    build: (config: any) => ipcRenderer.invoke('unity:build', config),
    cancelBuild: () => ipcRenderer.invoke('unity:cancel-build'),
    validate: () => ipcRenderer.invoke('unity:validate'),
    detectPaths: () => ipcRenderer.invoke('unity:detect-paths'),
    onBuildProgress: (callback: (progress: any) => void) => {
      const handler = (_: unknown, progress: any) => callback(progress);
      ipcRenderer.on('unity:build-progress', handler);
      return () => {
        ipcRenderer.removeListener('unity:build-progress', handler);
      };
    },
    onBuildLog: (callback: (log: string) => void) => {
      const handler = (_: unknown, log: string) => callback(log);
      ipcRenderer.on('unity:build-log', handler);
      return () => {
        ipcRenderer.removeListener('unity:build-log', handler);
      };
    },
  },

  // アダプター（SDKパッチ）管理
  adapters: {
    list: () => ipcRenderer.invoke('adapters:list'),
    get: (adapterId: string) => ipcRenderer.invoke('adapters:get', adapterId),
    applyPatch: (adapterId: string, projectPath: string) => 
      ipcRenderer.invoke('adapters:apply-patch', adapterId, projectPath),
  },

  // ファイルシステム
  fs: {
    readFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', filePath),
    writeFile: (filePath: string, content: string) => 
      ipcRenderer.invoke('fs:write-file', filePath, content),
    selectDirectory: () => ipcRenderer.invoke('fs:select-directory'),
    selectFile: (filters?: any[]) => ipcRenderer.invoke('fs:select-file', filters),
    exists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),
  },

  // SDK状態
  sdk: {
    xrealStatus: () => ipcRenderer.invoke('sdk:xreal-status'),
    questStatus: () => ipcRenderer.invoke('sdk:quest-status'),
    bundledDeps: () => ipcRenderer.invoke('sdk:bundled-deps'),
  },

  // アセット管理
  assets: {
    import: (params: { projectPath: string; sourcePath: string; kind?: 'model' | 'texture' | 'video' | 'other' }) =>
      ipcRenderer.invoke('assets:import', params),
    list: (params: { projectPath: string }) => ipcRenderer.invoke('assets:list', params),
  },

  // 設定ストア
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('store:set', key, value),
  },

  // MCP サーバー管理
  mcp: {
    start: (projectPath: string) => ipcRenderer.invoke('mcp:start', projectPath),
    stop: () => ipcRenderer.invoke('mcp:stop'),
    getStatus: () => ipcRenderer.invoke('mcp:status'),
    getClientConfig: () => ipcRenderer.invoke('mcp:get-client-config'),
  },

  // ウィンドウ操作
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },

  // メニューイベント
  menu: {
    onNewProject: (callback: () => void) => {
      ipcRenderer.on('menu:new-project', () => callback());
    },
    onSave: (callback: () => void) => {
      ipcRenderer.on('menu:save', () => callback());
    },
    onSaveAs: (callback: () => void) => {
      ipcRenderer.on('menu:save-as', () => callback());
    },
    onBuildSettings: (callback: () => void) => {
      ipcRenderer.on('menu:build-settings', () => callback());
    },
    onBuild: (callback: () => void) => {
      ipcRenderer.on('menu:build', () => callback());
    },
    onSettings: (callback: () => void) => {
      ipcRenderer.on('menu:settings', () => callback());
    },
    onDelete: (callback: () => void) => {
      ipcRenderer.on('menu:delete', () => callback());
    },
    onViewChange: (callback: (view: string) => void) => {
      ipcRenderer.on('menu:view', (_, view) => callback(view));
    },
    onProjectOpen: (callback: (path: string) => void) => {
      ipcRenderer.on('project:open', (_, path) => callback(path));
    },
  },
};

// コンテキストブリッジでAPIを公開
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// 型定義のエクスポート用
export type ElectronAPI = typeof electronAPI;
