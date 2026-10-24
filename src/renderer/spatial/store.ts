/**
 * Layster.Spatial のエディタの状態。Virtual の projectStore とは別 (形が違うので混ぜない)。
 *
 * - 編集は update(fn) だけで行う。直前の形を取り消しの山に積む (同じ coalesce キーが 0.8 秒以内に続けば積まない:
 *   文字を打つたびに取り消しが 1 文字ずつになるのを防ぐ)
 * - 自動保存はしない (Ctrl+S / メニューの保存)
 * - 外 (エージェント) で project.spatial.json が変わったら、未保存の変更が無ければ読み直す。あれば知らせるだけ
 */
import { create } from 'zustand';
import type { SpaceFixture, SpatialProject } from '../../shared/layster/spatial/types';
import { BUILTIN_SPACES, DEFAULT_SPACE_IDS } from '../../shared/layster/spatial/spaces';
import { spatialApi } from './api';

export type SpatialSelection =
  | { kind: 'thing' | 'mind' | 'body' | 'rule' | 'script'; id: string }
  | { kind: 'recording' | 'settings' | 'spaces' }
  | null;

export type BottomTab = 'world' | 'mind' | 'problems';

export interface SpatialStatus {
  type: 'info' | 'error';
  key: string;
  params?: Record<string, string | number>;
}

interface SpatialState {
  project: SpatialProject | null;
  path: string | null;
  /** project が最後に保存 (読み込み) したものと違うか。取り消しで保存した形に戻れば false に戻る */
  dirty: boolean;
  /** 最後に保存 (読み込み) した形。編集は毎回新しいオブジェクトを作るので、同じものかは参照で比べられる */
  savedSnapshot: SpatialProject | null;
  /** 外で書き換えられたが、未保存の変更があるので読み直していない */
  externalChange: boolean;
  selection: SpatialSelection;
  /** World の表で選んだ entity */
  selectedEntity: string | null;
  activeSpace: string;
  projectSpaces: SpaceFixture[];
  bottomTab: BottomTab;
  /** Mind を試して返ってきた推測を、3D の表示に足す */
  previewBeliefs: SpaceFixture['entities'];
  status: SpatialStatus | null;
  showBuild: boolean;
  undoStack: SpatialProject[];
  redoStack: SpatialProject[];
  lastCoalesce: { key: string; at: number } | null;

  open: (project: SpatialProject, path: string | null) => void;
  close: () => void;
  update: (fn: (draft: SpatialProject) => void, coalesce?: string) => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<boolean>;
  reloadFromDisk: () => Promise<void>;
  setSelection: (s: SpatialSelection) => void;
  setSelectedEntity: (id: string | null) => void;
  setActiveSpace: (id: string) => void;
  setBottomTab: (tab: BottomTab) => void;
  setPreviewBeliefs: (entities: SpaceFixture['entities']) => void;
  setStatus: (status: SpatialStatus | null) => void;
  setShowBuild: (show: boolean) => void;
  loadSpaces: () => Promise<void>;
}

const UNDO_LIMIT = 100;
const COALESCE_MS = 800;

export const useSpatialStore = create<SpatialState>((set, get) => ({
  project: null,
  path: null,
  dirty: false,
  savedSnapshot: null,
  externalChange: false,
  selection: null,
  selectedEntity: null,
  activeSpace: DEFAULT_SPACE_IDS[0],
  projectSpaces: [],
  bottomTab: 'world',
  previewBeliefs: [],
  status: null,
  showBuild: false,
  undoStack: [],
  redoStack: [],
  lastCoalesce: null,

  open: (project, path) => {
    const first = project.spaces?.use?.[0] ?? DEFAULT_SPACE_IDS[0];
    set({
      project, path, dirty: false, savedSnapshot: project, externalChange: false,
      selection: project.things[0] ? { kind: 'thing', id: project.things[0].id } : { kind: 'settings' },
      selectedEntity: null, activeSpace: first, previewBeliefs: [], undoStack: [], redoStack: [], lastCoalesce: null, status: null,
    });
    void get().loadSpaces();
  },

  close: () => set({ project: null, path: null, dirty: false, savedSnapshot: null, selection: null, undoStack: [], redoStack: [], projectSpaces: [], externalChange: false }),

  update: (fn, coalesce) => {
    const { project, undoStack, lastCoalesce } = get();
    if (!project) return;
    const next = structuredClone(project);
    fn(next);
    next.updatedAt = new Date().toISOString();
    const now = Date.now();
    const merge = coalesce && lastCoalesce && lastCoalesce.key === coalesce && now - lastCoalesce.at < COALESCE_MS;
    set({
      project: next,
      dirty: true,
      undoStack: merge ? undoStack : [...undoStack, project].slice(-UNDO_LIMIT),
      redoStack: [],
      lastCoalesce: coalesce ? { key: coalesce, at: now } : null,
    });
  },

  undo: () => {
    const { project, undoStack, redoStack } = get();
    if (!project || undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    set({ project: prev, undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, project], dirty: prev !== get().savedSnapshot, lastCoalesce: null });
  },

  redo: () => {
    const { project, undoStack, redoStack } = get();
    if (!project || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    set({ project: next, redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, project], dirty: next !== get().savedSnapshot, lastCoalesce: null });
  },

  save: async () => {
    const { project } = get();
    const api = spatialApi();
    if (!project) return false;
    if (!api) {
      set({ status: { type: 'error', key: 'spatial.status.noBridge' } });
      return false;
    }
    try {
      const result = await api.save(project);
      if (!result.success) {
        set({ status: { type: 'error', key: 'spatial.status.saveFailed', params: { error: result.error ?? '' } } });
        return false;
      }
      // 保存している間に編集が続いていたら、保存したものだけを「保存済み」とする
      set((s) => ({ dirty: s.project !== project, savedSnapshot: project, externalChange: false, status: { type: 'info', key: 'spatial.status.saved' } }));
      return true;
    } catch (e) {
      set({ status: { type: 'error', key: 'spatial.status.saveFailed', params: { error: (e as Error).message } } });
      return false;
    }
  },

  reloadFromDisk: async () => {
    const { path, selection, activeSpace } = get();
    const api = spatialApi();
    if (!path || !api) return;
    const result = await api.load(path);
    if (!result.success || !result.project) {
      set({ status: { type: 'error', key: 'spatial.status.loadFailed', params: { error: result.error ?? '' } } });
      return;
    }
    const p = result.project;
    const keep = selection && 'id' in selection
      ? (selection.kind === 'thing' ? p.things : selection.kind === 'mind' ? p.minds : selection.kind === 'body' ? p.bodies
        : selection.kind === 'rule' ? p.rules : p.scripts).some((x) => x.id === selection.id)
      : true;
    set({
      project: p, dirty: false, savedSnapshot: p, externalChange: false,
      selection: keep ? selection : null,
      activeSpace: p.spaces.use.includes(activeSpace) ? activeSpace : (p.spaces.use[0] ?? activeSpace),
      undoStack: [], redoStack: [], lastCoalesce: null,
      status: { type: 'info', key: 'spatial.status.reloaded' },
    });
    void get().loadSpaces();
  },

  setSelection: (selection) => set({ selection }),
  setSelectedEntity: (selectedEntity) => set({ selectedEntity }),
  setActiveSpace: (activeSpace) => set({ activeSpace, selectedEntity: null, previewBeliefs: [] }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setPreviewBeliefs: (previewBeliefs) => set({ previewBeliefs }),
  setStatus: (status) => set({ status }),
  setShowBuild: (showBuild) => set({ showBuild }),

  loadSpaces: async () => {
    const api = spatialApi();
    if (!api) return;
    try {
      const result = await api.spaces();
      set({ projectSpaces: Array.isArray(result?.project) ? result.project : [] });
    } catch {
      /* 組み込みの空間だけでも使える */
    }
  },
}));

/** 組み込み + プロジェクトの空間から id で探す。 */
export function findSpace(id: string, projectSpaces: SpaceFixture[]): SpaceFixture | undefined {
  return projectSpaces.find((s) => s.id === id) ?? BUILTIN_SPACES.find((s) => s.id === id);
}

/** 新しい id ("panel", "panel-2", …)。 */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const clean = base.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  if (!set.has(clean)) return clean;
  for (let i = 2; ; i++) if (!set.has(`${clean}-${i}`)) return `${clean}-${i}`;
}
