import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { MainLayout } from './components/MainLayout';
import { WelcomeScreen } from './components/WelcomeScreen';
import { LiveLayoutMode } from './live/LiveLayoutMode';
import { BuildDialog } from './components/dialogs/BuildDialog';
import { NewProjectDialog } from './components/dialogs/NewProjectDialog';
import { SettingsDialog } from './components/dialogs/SettingsDialog';
import { PreviewDialog } from './components/dialogs/PreviewDialog';
import { MCPDialog } from './components/dialogs/MCPDialog';
import { SetupWizard } from './components/dialogs/SetupWizard';
import { IrUpgradeDialog } from './components/dialogs/IrUpgradeDialog';
import { MissingRequirementsDialog } from './components/dialogs/MissingRequirementsDialog';
import { AssistantPanel } from './components/ai/AssistantPanel';
import { ExternalChangeBanner } from './components/ai/ExternalChangeBanner';
import { PackageResultDialog } from './ai/packageActions';
import { useProjectStore } from './stores/projectStore';
import { useUIStore } from './stores/uiStore';
import { DataStoreProvider } from './stores/dataStoreContext';
import { SpatialWorkspace } from './spatial/SpatialWorkspace';
import { useSpatialStore } from './spatial/store';
import { openProjectFolder } from './spatial/openProject';

declare global {
  interface Window {
    electronAPI: {
      project: {
        create: (options: any) => Promise<any>;
        load: (path: string) => Promise<any>;
        save: (data: any) => Promise<any>;
        export: (options: any) => Promise<any>;
        upgrade: () => Promise<{ success: boolean; error?: string; backupPath?: string }>;
      };
      model: {
        import: (projectPath: string, sourcePath?: string) => Promise<{
          success: boolean;
          error?: string;
          model?: import('../shared/types').ModelDefinition;
          warnings?: string[];
        }>;
        inspect: (projectPath: string, file: string) => Promise<
          { success: true; inspection: import('../shared/types').ModelInspection & { warnings: string[] } }
          | { success: false; error: string }
        >;
        readLabels: (path?: string) => Promise<{ success: boolean; labels?: string[]; error?: string }>;
        importTokenizer: (projectPath: string, modelName?: string, sourcePath?: string) => Promise<{
          success: boolean;
          error?: string;
          info?: {
            tokenizer: string;
            kind?: string;
            chatFormat?: import('../shared/types').ChatFormatName;
            eosTokens?: string[];
            labels?: string[];
            warnings: string[];
          };
        }>;
        hfInspect: (repo: string) => Promise<
          { success: true; info: import('../main/model/HuggingFace').HfRepoInfo }
          | { success: false; error: string }
        >;
        hfImport: (runId: string, repo: string, variantPath: string, projectPath?: string, name?: string) => Promise<{
          success: boolean;
          error?: string;
          model?: import('../shared/types').ModelDefinition;
          warnings?: string[];
        }>;
        hfCancel: (runId: string) => Promise<{ success: boolean }>;
        onHfProgress: (callback: (payload: { runId: string; progress: import('../main/model/HuggingFace').HfDownloadProgress }) => void) => () => void;
        try: (runId: string, projectPath: string | undefined, request: unknown) => Promise<{
          ok: boolean;
          error?: string;
          unavailable?: string;
          cancelled?: boolean;
          signature?: Record<string, unknown>;
          result?: Record<string, unknown>;
        }>;
        cancelTry: (runId: string) => Promise<{ success: boolean }>;
        onTryLine: (callback: (payload: { runId: string; line: Record<string, unknown> & { type: string } }) => void) => () => void;
      };
      vision: {
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
        ) => Promise<{
          ok: boolean;
          error?: string;
          gated?: boolean;
          gateReason?: string;
          unavailable?: string;
          events?: string[];
          probes?: Array<{
            id: string;
            op: string;
            kind?: string;
            width?: number;
            height?: number;
            rgba?: Uint8Array;
            record?: Record<string, unknown>;
            items?: unknown[];
            count?: number;
            boundary?: number[];
            coverage?: number;
            stopped?: string;
            error?: string;
          }>;
          focus?: number;
          frames?: Array<{
            index: number;
            ok: boolean;
            error?: string;
            gated?: boolean;
            gateReason?: string;
            events?: string[];
            values?: Record<string, unknown>;
            counts?: Record<string, number>;
          }>;
          notes?: string[];
          values?: Record<string, unknown>;
          steps: {
            name: string;
            kind: string;
            width?: number;
            height?: number;
            rgba?: Uint8Array;
            record?: Record<string, unknown>;
            items?: unknown[];
            count?: number;
            boundary?: number[];
          }[];
        }>;
      };
      device: {
        list: () => Promise<{
          success: boolean;
          error?: string;
          adbMissing?: boolean;
          adbPath?: string;
          devices: Array<{ serial: string; state: string; model?: string; label: string }>;
        }>;
        install: (serial: string, apkPath: string) => Promise<{ success: boolean; error?: string; adbMissing?: boolean }>;
        onInstallLog: (callback: (line: string) => void) => () => void;
      };
      unity: {
        setPath: (path: string) => Promise<any>;
        getPath: () => Promise<string>;
        detectGradle?: () => Promise<string | null>;
        build: (config: any) => Promise<any>;
        cancelBuild: () => Promise<{ success: boolean; error?: string }>;
        validate: () => Promise<any>;
        detectPaths: () => Promise<{ success: boolean; candidates: string[]; error?: string }>;
        onBuildProgress: (callback: (progress: any) => void) => () => void;
        onBuildLog: (callback: (log: string) => void) => () => void;
      };
      adapters: {
        list: () => Promise<any[]>;
        get: (id: string) => Promise<any>;
        applyPatch: (id: string, path: string) => Promise<any>;
      };
      extensions?: {
        list: (targetDevice?: string) => Promise<import('./extensions/useExtensions').ExtensionListResult>;
        openUserDir: () => Promise<{ success: boolean; path?: string; error?: string }>;
        import: (kind: 'package' | 'folder') => Promise<import('./extensions/useExtensions').InstallReply>;
        install: (source: string, force?: boolean) => Promise<import('./extensions/useExtensions').InstallReply>;
        uninstall: (id: string) => Promise<{ ok: boolean; error?: string }>;
        linkFolder: () => Promise<{ ok: boolean; canceled?: boolean; dir?: string; ids?: string[]; error?: string }>;
        readme: (id: string) => Promise<{ ok: boolean; text?: string | null; error?: string }>;
        openDir: (id: string) => Promise<{ success: boolean; path?: string; error?: string }>;
        unlinkFolder: (dir: string) => Promise<{ ok: boolean; dir?: string; error?: string }>;
        export: (id: string) => Promise<{ ok: boolean; canceled?: boolean; file?: string; error?: string }>;
      };
      sdk?: {
        xrealStatus: () => Promise<{ exists: boolean; path?: string; version?: string; error?: string }>;
        questStatus: () => Promise<{ exists: boolean; path?: string; corePackage?: string; mrukPackage?: string; error?: string }>;
      };
      fs: {
        readFile: (path: string) => Promise<any>;
        writeFile: (path: string, content: string) => Promise<any>;
        selectDirectory: () => Promise<string | null>;
        selectFile: (filters?: any[]) => Promise<string | null>;
      };
      assets: {
        import: (params: {
          projectPath: string;
          sourcePath: string;
          kind?: 'model' | 'texture' | 'video' | 'animation' | 'other';
        }) => Promise<{ success: boolean; assetPath?: string; error?: string }>;
        list: (params: { projectPath: string }) => Promise<{ success: boolean; items: any[]; error?: string }>;
      };
      animations: {
        import: (params: { projectPath: string; sourcePath: string; name?: string }) =>
          Promise<{ success: boolean; name?: string; assetPath?: string; existed?: boolean; error?: string }>;
        list: (params: { projectPath: string }) =>
          Promise<{ success: boolean; animations: Array<{ name: string; assetPath: string; bytes: number }>; error?: string }>;
        vrmSpec: (params: { projectPath: string; modelPath: string }) =>
          Promise<{ success: boolean; spec: '1.0' | '0.x' | 'unknown' | null; error?: string }>;
      };
      store: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<any>;
      };
      app?: {
        setLanguage: (lang: 'en' | 'ja') => void;
      };
      mcp?: {
        agents: (includeProject: boolean) => Promise<import('./ai/types').McpAgentsInfo>;
        register: (id: string, includeProject: boolean) => Promise<{ ok: boolean; message: string; configPath?: string | null }>;
        unregister: (id: string) => Promise<{ ok: boolean; message: string; configPath?: string | null }>;
        selfTest: (includeProject: boolean) => Promise<{ ok: boolean; tools?: number; ms?: number; error?: string; stderr?: string }>;
      };
      assistant?: {
        getSettings: () => Promise<import('./ai/types').AssistantSettingsView>;
        setSettings: (settings: { baseUrl?: string; model?: string; temperature?: number | null; maxSteps?: number; apiKey?: string | null }) => Promise<{ ok: boolean }>;
        models: (override?: { baseUrl?: string; apiKey?: string }) => Promise<{ ok: boolean; models?: string[]; error?: string }>;
        send: (conversationId: string, text: string, context: { selection?: string; language?: string; targetDevice?: string }) => Promise<{ ok: boolean; error?: string }>;
        abort: (conversationId: string) => Promise<{ ok: boolean }>;
        reset: (conversationId: string) => Promise<{ ok: boolean }>;
        undo: (snapshotId: string) => Promise<{ ok: boolean; error?: string }>;
        onEvent: (callback: (payload: { conversationId: string; event: import('./ai/types').AssistantEvent }) => void) => () => void;
      };
      /** Layster.Spatial (src/shared/layster/spatial/ipc.ts) */
      spatial?: import('./spatial/api').SpatialBridge;
      projectPackage?: {
        export: (projectPath: string, bundleExtensions: boolean) => Promise<{ ok: boolean; canceled?: boolean; file?: string; files?: number; bytes?: number; extensions?: Array<{ id: string; version: string; bundled: boolean }>; error?: string }>;
        import: () => Promise<import('./ai/types').PackageImportReply>;
        installStagedExtension: (stagedDir: string) => Promise<{ ok: boolean; id?: string; version?: string; error?: string }>;
        onExternalChange: (callback: (payload: { projectPath: string; files: string[] }) => void) => () => void;
        onBusy: (callback: (state: { action: 'export' | 'import'; file: string } | null) => void) => () => void;
      };
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
      };
      menu: {
        onNewProject: (callback: () => void) => void;
        onSave: (callback: () => void) => void;
        onSaveAs: (callback: () => void) => void;
        onBuildSettings: (callback: () => void) => void;
        onBuild: (callback: () => void) => void;
        onSettings: (callback: () => void) => void;
        onDelete: (callback: () => void) => void;
        onViewChange: (callback: (view: string) => void) => void;
        onProjectOpen: (callback: (path: string) => void) => void;
      };
    };
  }
}

export default function App() {
  const { project, saveProject, handleExternalChange } = useProjectStore();
  // Layster.Spatial のプロジェクトを開いているときは、Virtual の画面の代わりに Spatial の画面を出す
  const spatialProject = useSpatialStore((s) => s.project);

  // 開いているプロジェクトが外 (AI エージェント・MCP) で変わったら読み直す
  useEffect(() => {
    const off = window.electronAPI?.projectPackage?.onExternalChange((payload) => { void handleExternalChange(payload); });
    return () => off?.();
  }, [handleExternalChange]);
  const { 
    showNewProjectDialog, 
    showBuildDialog,
    showSettingsDialog,
    showPreviewDialog,
    showMCPDialog,
    showSetupWizard,
    setShowNewProjectDialog,
    setShowBuildDialog,
    setShowSettingsDialog,
    setShowPreviewDialog,
    setShowMCPDialog,
    setShowSetupWizard,
    setCurrentView,
    setShowVisionTab,
    appMode,
    showAssistant,
    setShowAssistant,
  } = useUIStore();

  // 画像処理タブは既定で隠す (設定で出せる)
  useEffect(() => {
    if (!window.electronAPI) return;
    void window.electronAPI.store.get('showVisionTab').then((show: unknown) => {
      if (show === true) setShowVisionTab(true);
    });
  }, [setShowVisionTab]);

  // Auto-show wizard on first launch (no Unity path configured yet)
  useEffect(() => {
    if (!window.electronAPI) return;
    (async () => {
      try {
        const completed = await window.electronAPI.store.get('setupWizardCompleted');
        if (completed) return;
        const unityPath = await window.electronAPI.unity.getPath();
        if (!unityPath) setShowSetupWizard(true);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    if (!project) return;
    if (project.appType === 'head_locked_hud') {
      setCurrentView('ui');
    } else {
      setCurrentView('scene');
    }
  }, [project?.id]);

  useEffect(() => {
    // Set up menu event listeners
    if (window.electronAPI) {
      window.electronAPI.menu.onNewProject(() => {
        setShowNewProjectDialog(true);
      });

      window.electronAPI.menu.onSave(() => {
        if (useSpatialStore.getState().project) void useSpatialStore.getState().save();
        else saveProject();
      });

      window.electronAPI.menu.onBuild(() => {
        if (useSpatialStore.getState().project) useSpatialStore.getState().setShowBuild(true);
        else setShowBuildDialog(true);
      });

      window.electronAPI.menu.onBuildSettings(() => {
        if (useSpatialStore.getState().project) useSpatialStore.getState().setShowBuild(true);
        else setShowBuildDialog(true);
      });

      window.electronAPI.menu.onSettings(() => {
        setShowSettingsDialog(true);
      });

      window.electronAPI.menu.onViewChange((view) => {
        if (view === '3d') setCurrentView('scene');
        else if (view === '2d') setCurrentView('ui');
        else if (view === 'dataflow') setCurrentView('ui');
        else if (view === 'script') setCurrentView('script');
      });

      window.electronAPI.menu.onProjectOpen(async (path) => {
        // Virtual (project.json) か Spatial (project.spatial.json) かで開く画面を変える
        await openProjectFolder(path);
      });
    }
  }, []);

  return (
    <DataStoreProvider initialData={{}}>
      <div className="flex flex-col h-screen w-screen bg-arsist-bg">
        <TitleBar />
        
        {spatialProject ? (
          <SpatialWorkspace />
        ) : project ? (
          // ライブ配置モードは通常の編集UIと完全に別画面（パネル構成もツールバーも共有しない）
          appMode === 'live' ? <LiveLayoutMode /> : <MainLayout />
        ) : (
          <WelcomeScreen onNewProject={() => setShowNewProjectDialog(true)} />
        )}

        {/* Dialogs */}
        {showNewProjectDialog && (
          <NewProjectDialog onClose={() => setShowNewProjectDialog(false)} />
        )}
        
        {showBuildDialog && (
          <BuildDialog onClose={() => setShowBuildDialog(false)} />
        )}

        {showSettingsDialog && (
          <SettingsDialog onClose={() => setShowSettingsDialog(false)} />
        )}

        {showPreviewDialog && (
          <PreviewDialog onClose={() => setShowPreviewDialog(false)} />
        )}

        {showMCPDialog && (
          <MCPDialog onClose={() => setShowMCPDialog(false)} />
        )}

        <IrUpgradeDialog />
        <MissingRequirementsDialog />
        <PackageResultDialog />
        {project && <ExternalChangeBanner />}
        {project && showAssistant && <AssistantPanel onClose={() => setShowAssistant(false)} />}
        {showSetupWizard && (
          <SetupWizard onClose={() => setShowSetupWizard(false)} />
        )}
      </div>
    </DataStoreProvider>
  );
}
