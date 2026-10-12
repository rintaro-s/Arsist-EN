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
    /** 古い版の IR を今の版で書き戻す (承諾後)。元のファイルは Backups/ に残る */
    upgrade: () => ipcRenderer.invoke('project:upgrade'),
  },

  // 学習済みモデル (ONNX)
  model: {
    /** ファイル選択 → Assets/Models へコピー → 入出力を読んで定義の下書きを返す */
    import: (projectPath: string, sourcePath?: string) =>
      ipcRenderer.invoke('model:import', { projectPath, sourcePath }),
    inspect: (projectPath: string, file: string) => ipcRenderer.invoke('model:inspect', { projectPath, file }),
    readLabels: (path?: string) => ipcRenderer.invoke('model:read-labels', { path }),
    /** 文章のモデルの tokenizer.json を取り込む (隣の tokenizer_config.json なども読む) */
    importTokenizer: (projectPath: string, modelName?: string, sourcePath?: string) =>
      ipcRenderer.invoke('model:import-tokenizer', { projectPath, modelName, sourcePath }),
    /** Hugging Face のリポジトリにある ONNX の候補 (精度違い) を読む */
    hfInspect: (repo: string) => ipcRenderer.invoke('model:hf-inspect', { repo }),
    /** 選んだ 1 本を落として取り込む。進み具合は onHfProgress に届く */
    hfImport: (runId: string, repo: string, variantPath: string, projectPath?: string, name?: string) =>
      ipcRenderer.invoke('model:hf-import', { runId, repo, variantPath, projectPath, name }),
    hfCancel: (runId: string) => ipcRenderer.invoke('model:hf-cancel', runId),
    onHfProgress: (callback: (payload: { runId: string; progress: any }) => void) => {
      const handler = (_: unknown, payload: { runId: string; progress: any }) => callback(payload);
      ipcRenderer.on('model:hf-progress', handler);
      return () => {
        ipcRenderer.removeListener('model:hf-progress', handler);
      };
    },
    /** 「試す」: 実機と同じ C# を ONNX Runtime で動かす。途中経過は onTryLine に届く */
    try: (runId: string, projectPath: string | undefined, request: unknown) =>
      ipcRenderer.invoke('model:try', { runId, projectPath, request }),
    cancelTry: (runId: string) => ipcRenderer.invoke('model:try-cancel', runId),
    onTryLine: (callback: (payload: { runId: string; line: any }) => void) => {
      const handler = (_: unknown, payload: { runId: string; line: any }) => callback(payload);
      ipcRenderer.on('model:try-line', handler);
      return () => {
        ipcRenderer.removeListener('model:try-line', handler);
      };
    },
  },

  // Unity連携
  vision: {
    /** パイプラインを1枚の画像に流し、各ステップの結果を返す */
    preview: (
      pipeline: unknown,
      image: { width: number; height: number; rgba: Uint8Array },
      options?: {
        models?: unknown[];
        projectPath?: string;
        frames?: Array<{ width: number; height: number; rgba: Uint8Array }>;
        focus?: number;
        fps?: number;
        probe?: { index: number; ops: unknown[] };
      },
    ) => ipcRenderer.invoke('vision:preview', { pipeline, image, ...(options ?? {}) }),
  },

  // 端末への配布 (adb)
  device: {
    /** つながっている端末を並べる */
    list: () => ipcRenderer.invoke('device:list'),
    /** ビルドした APK を入れる */
    install: (serial: string, apkPath: string) => ipcRenderer.invoke('device:install', { serial, apkPath }),
    onInstallLog: (callback: (line: string) => void) => {
      const handler = (_: unknown, line: string) => callback(line);
      ipcRenderer.on('device:install-log', handler);
      return () => {
        ipcRenderer.removeListener('device:install-log', handler);
      };
    },
  },

  unity: {
    setPath: (unityPath: string) => ipcRenderer.invoke('unity:set-path', unityPath),
    getPath: () => ipcRenderer.invoke('unity:get-path'),
    /** Android ビルドに使える Gradle のパス。無ければ null */
    detectGradle: () => ipcRenderer.invoke('unity:detect-gradle'),
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

  // 拡張機能 (Extensions/<id>/)
  extensions: {
    list: (targetDevice?: string) => ipcRenderer.invoke('extensions:list', targetDevice),
    openUserDir: () => ipcRenderer.invoke('extensions:open-user-dir'),
    import: (kind: 'package' | 'folder') => ipcRenderer.invoke('extensions:import', kind),
    install: (source: string, force?: boolean) => ipcRenderer.invoke('extensions:install', source, force),
    uninstall: (id: string) => ipcRenderer.invoke('extensions:uninstall', id),
    linkFolder: () => ipcRenderer.invoke('extensions:link-folder'),
    readme: (id: string) => ipcRenderer.invoke('extensions:readme', id),
    openDir: (id: string) => ipcRenderer.invoke('extensions:open-dir', id),
    unlinkFolder: (dir: string) => ipcRenderer.invoke('extensions:unlink-folder', dir),
    export: (id: string) => ipcRenderer.invoke('extensions:export', id),
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
    getDir: () => ipcRenderer.invoke('sdk:get-dir'),
    setDir: (sdkDir: string) => ipcRenderer.invoke('sdk:set-dir', sdkDir),
    xrealStatus: () => ipcRenderer.invoke('sdk:xreal-status'),
    questStatus: () => ipcRenderer.invoke('sdk:quest-status'),
    bundledDeps: () => ipcRenderer.invoke('sdk:bundled-deps'),
  },

  // アセット管理
  assets: {
    import: (params: { projectPath: string; sourcePath: string; kind?: 'model' | 'texture' | 'video' | 'animation' | 'other' }) =>
      ipcRenderer.invoke('assets:import', params),
    list: (params: { projectPath: string }) => ipcRenderer.invoke('assets:list', params),
  },

  // キャラクターの動き (Assets/Animations/<名前>.fbx。名前 = スクリプトの vrm.playAnimation の名前)
  animations: {
    import: (params: { projectPath: string; sourcePath: string; name?: string }) =>
      ipcRenderer.invoke('animations:import', params),
    list: (params: { projectPath: string }) => ipcRenderer.invoke('animations:list', params),
    // VRM の形式 ('1.0' / '0.x')。エンジン標準の読み込みは 0.x だけなので、インスペクタが 1.0 を知らせる
    vrmSpec: (params: { projectPath: string; modelPath: string }) => ipcRenderer.invoke('animations:vrm-spec', params),
  },

  // 設定ストア
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('store:set', key, value),
  },

  // MCP サーバー管理
  // MCP: 外部のエージェント (Claude Code / Codex / Qwen Code / Claude Desktop …) への登録と自己診断
  mcp: {
    agents: (includeProject: boolean) => ipcRenderer.invoke('mcp:agents', includeProject),
    register: (id: string, includeProject: boolean) => ipcRenderer.invoke('mcp:register', id, includeProject),
    unregister: (id: string) => ipcRenderer.invoke('mcp:unregister', id),
    selfTest: (includeProject: boolean) => ipcRenderer.invoke('mcp:self-test', includeProject),
  },

  // 内蔵エージェント (OpenAI 互換 API)
  assistant: {
    getSettings: () => ipcRenderer.invoke('assistant:get-settings'),
    setSettings: (settings: unknown) => ipcRenderer.invoke('assistant:set-settings', settings),
    models: (override?: { baseUrl?: string; apiKey?: string }) => ipcRenderer.invoke('assistant:models', override),
    send: (conversationId: string, text: string, context: unknown) => ipcRenderer.invoke('assistant:send', conversationId, text, context),
    abort: (conversationId: string) => ipcRenderer.invoke('assistant:abort', conversationId),
    reset: (conversationId: string) => ipcRenderer.invoke('assistant:reset', conversationId),
    undo: (snapshotId: string) => ipcRenderer.invoke('assistant:undo', snapshotId),
    onEvent: (callback: (payload: { conversationId: string; event: unknown }) => void) => {
      const handler = (_: unknown, payload: { conversationId: string; event: unknown }) => callback(payload);
      ipcRenderer.on('assistant:event', handler);
      return () => { ipcRenderer.removeListener('assistant:event', handler); };
    },
  },

  // プロジェクトの .arsist 書き出し / 読み込みと、外での変更の知らせ
  projectPackage: {
    export: (projectPath: string, bundleExtensions: boolean) => ipcRenderer.invoke('project:export-package', projectPath, bundleExtensions),
    import: () => ipcRenderer.invoke('project:import-package'),
    installStagedExtension: (stagedDir: string) => ipcRenderer.invoke('project:install-staged-extension', stagedDir),
    onExternalChange: (callback: (payload: { projectPath: string; files: string[] }) => void) => {
      const handler = (_: unknown, payload: { projectPath: string; files: string[] }) => callback(payload);
      ipcRenderer.on('project:external-change', handler);
      return () => { ipcRenderer.removeListener('project:external-change', handler); };
    },
    /** 書き出し / 読み込みの最中 (選択画面を閉じてから終わるまで)。終わると null */
    onBusy: (callback: (state: { action: 'export' | 'import'; file: string } | null) => void) => {
      const handler = (_: unknown, state: { action: 'export' | 'import'; file: string } | null) => callback(state);
      ipcRenderer.on('project:package-busy', handler);
      return () => { ipcRenderer.removeListener('project:package-busy', handler); };
    },
  },

  // ウィンドウ操作
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },

  // アプリ全般（UI言語などメインプロセスと同期する設定）
  app: {
    setLanguage: (lang: 'en' | 'ja') => ipcRenderer.invoke('app:set-language', lang),
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
