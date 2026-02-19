/**
 * Arsist Engine — UI Store
 * エディタ状態管理 (プロジェクトIRとは無関係な純粋UI状態)
 */
import { create } from 'zustand';

export type ViewType = 'scene' | 'ui' | 'dataflow';

export interface ConsoleLog {
  type: 'info' | 'warning' | 'error';
  message: string;
  time: string;
}

interface UIState {
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;

  // ダイアログ
  showNewProjectDialog: boolean;
  showBuildDialog: boolean;
  showSettingsDialog: boolean;
  showPreviewDialog: boolean;
  showMCPDialog: boolean;
  setShowNewProjectDialog: (show: boolean) => void;
  setShowBuildDialog: (show: boolean) => void;
  setShowSettingsDialog: (show: boolean) => void;
  setShowPreviewDialog: (show: boolean) => void;
  setShowMCPDialog: (show: boolean) => void;

  // パネルサイズ
  leftPanelWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  setLeftPanelWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setBottomPanelHeight: (h: number) => void;

  // 3D ビューポート
  showGrid: boolean;
  showAxes: boolean;
  snapToGrid: boolean;
  setShowGrid: (v: boolean) => void;
  setShowAxes: (v: boolean) => void;
  setSnapToGrid: (v: boolean) => void;

  transformMode: 'translate' | 'rotate' | 'scale';
  transformSpace: 'local' | 'world';
  setTransformMode: (m: 'translate' | 'rotate' | 'scale') => void;
  setTransformSpace: (s: 'local' | 'world') => void;

  // ビルド
  buildProgress: number;
  buildMessage: string;
  buildLogs: string[];
  isBuilding: boolean;
  setBuildProgress: (p: number, msg: string) => void;
  addBuildLog: (log: string) => void;
  clearBuildLogs: () => void;
  setIsBuilding: (b: boolean) => void;

  // コンソール
  consoleLogs: ConsoleLog[];
  addConsoleLog: (log: Omit<ConsoleLog, 'time'>) => void;
  clearConsoleLogs: () => void;

  // 通知（addConsoleLog のラッパー）
  addNotification: (note: { type: string; message: string }) => void;

  // ボトムパネルタブ
  bottomTab: 'console' | 'datastore';
  setBottomTab: (tab: 'console' | 'datastore') => void;
}

export const useUIStore = create<UIState>((set) => ({
  currentView: 'scene',
  setCurrentView: (view) => set({ currentView: view }),

  showNewProjectDialog: false,
  showBuildDialog: false,
  showSettingsDialog: false,
  showPreviewDialog: false,
  showMCPDialog: false,
  setShowNewProjectDialog: (show) => set({ showNewProjectDialog: show }),
  setShowBuildDialog: (show) => set({ showBuildDialog: show }),
  setShowSettingsDialog: (show) => set({ showSettingsDialog: show }),
  setShowPreviewDialog: (show) => set({ showPreviewDialog: show }),
  setShowMCPDialog: (show) => set({ showMCPDialog: show }),

  leftPanelWidth: 260,
  rightPanelWidth: 300,
  bottomPanelHeight: 180,
  setLeftPanelWidth: (w) => set({ leftPanelWidth: Math.max(180, Math.min(480, w)) }),
  setRightPanelWidth: (w) => set({ rightPanelWidth: Math.max(220, Math.min(480, w)) }),
  setBottomPanelHeight: (h) => set({ bottomPanelHeight: Math.max(80, Math.min(400, h)) }),

  showGrid: true,
  showAxes: true,
  snapToGrid: false,
  setShowGrid: (v) => set({ showGrid: v }),
  setShowAxes: (v) => set({ showAxes: v }),
  setSnapToGrid: (v) => set({ snapToGrid: v }),

  transformMode: 'translate',
  transformSpace: 'world',
  setTransformMode: (m) => set({ transformMode: m }),
  setTransformSpace: (s) => set({ transformSpace: s }),

  buildProgress: 0,
  buildMessage: '',
  buildLogs: [],
  isBuilding: false,
  setBuildProgress: (p, msg) => set({ buildProgress: p, buildMessage: msg }),
  addBuildLog: (log) => set((s) => ({ buildLogs: [...s.buildLogs, log] })),
  clearBuildLogs: () => set({ buildLogs: [], buildProgress: 0, buildMessage: '' }),
  setIsBuilding: (b) => set({ isBuilding: b }),

  consoleLogs: [
    { type: 'info', message: 'Arsist Engine 起動完了', time: new Date().toLocaleTimeString() },
  ],
  addConsoleLog: (log) =>
    set((s) => ({
      consoleLogs: [...s.consoleLogs, { ...log, time: new Date().toLocaleTimeString() }],
    })),
  clearConsoleLogs: () => set({ consoleLogs: [] }),

  addNotification: (note) => {
    const type = note.type === 'success' ? 'info' : (note.type as 'info' | 'warning' | 'error');
    set((s) => ({
      consoleLogs: [...s.consoleLogs, { type, message: note.message, time: new Date().toLocaleTimeString() }],
    }));
  },

  bottomTab: 'console',
  setBottomTab: (tab) => set({ bottomTab: tab }),
}));
