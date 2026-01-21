/**
 * Arsist Engine - Project Store
 * プロジェクト状態管理 (Zustand)
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';
import type { 
  ArsistProject, 
  SceneData, 
  SceneObject, 
  UILayoutData, 
  UIElement,
  LogicGraphData,
  LogicNode,
  LogicConnection,
  UIAuthoringMode,
  UISyncMode
} from '../../shared/types';
import { layoutToHtml, htmlToLayout } from '../utils/uiCodeSync';

function ensureUICode(state: { project: ArsistProject | null }) {
  if (!state.project) return;
  if (!state.project.uiCode) {
    state.project.uiCode = {
      html: '',
      css: '',
      js: '',
      lastSyncedFrom: 'none',
    };
  }
  if (!state.project.uiAuthoring) {
    state.project.uiAuthoring = {
      mode: 'code',
      syncMode: 'code-to-visual',
    };
  }
  if (state.project.uiAuthoring.mode === 'code' && state.project.uiAuthoring.syncMode !== 'code-to-visual') {
    state.project.uiAuthoring.syncMode = 'code-to-visual';
  }
}

function shouldSyncVisualToCode(state: { project: ArsistProject | null }): boolean {
  const authoring = state.project?.uiAuthoring?.mode || 'hybrid';
  if (authoring === 'code' || authoring === 'visual') return false;
  const mode = state.project?.uiAuthoring?.syncMode || 'two-way';
  return mode === 'two-way' || mode === 'visual-to-code';
}

function shouldSyncCodeToVisual(state: { project: ArsistProject | null }): boolean {
  const authoring = state.project?.uiAuthoring?.mode || 'hybrid';
  if (authoring === 'visual') return false;
  if (authoring === 'code') return true;
  const mode = state.project?.uiAuthoring?.syncMode || 'two-way';
  return mode === 'two-way' || mode === 'code-to-visual';
}

function syncCodeFromUIIfNeeded(state: any, force = false) {
  if (!state.project || !state.currentUILayoutId) return;
  if (state.project?.uiAuthoring?.mode === 'code') return;
  if (!force && !shouldSyncVisualToCode(state)) return;

  const layout = state.project.uiLayouts.find((l: UILayoutData) => l.id === state.currentUILayoutId);
  if (!layout) return;
  ensureUICode(state);
  state.project.uiCode.html = layoutToHtml(layout);
  state.project.uiCode.lastSyncedFrom = 'visual';
}

function syncUIFromCodeInternal(state: any) {
  if (!state.project || !state.currentUILayoutId) return;
  const layoutIndex = state.project.uiLayouts.findIndex((l: UILayoutData) => l.id === state.currentUILayoutId);
  if (layoutIndex === -1) return;

  const currentLayout = state.project.uiLayouts[layoutIndex];
  const updatedLayout = htmlToLayout(state.project.uiCode.html, currentLayout);
  state.project.uiLayouts[layoutIndex].root = updatedLayout.root;
  state.selectedUIElementId = null;
  state.isDirty = true;
}

interface ProjectState {
  project: ArsistProject | null;
  projectPath: string | null;
  isDirty: boolean;
  
  // シーン関連
  currentSceneId: string | null;
  selectedObjectIds: string[];
  
  // UI関連
  currentUILayoutId: string | null;
  selectedUIElementId: string | null;
  
  // ロジック関連
  currentLogicGraphId: string | null;
  selectedNodeIds: string[];
  
  // アクション
  createProject: (options: any) => Promise<void>;
  loadProject: (path: string) => Promise<void>;
  saveProject: () => Promise<void>;
  closeProject: () => void;
  
  // シーン操作
  addScene: (name: string) => void;
  removeScene: (sceneId: string) => void;
  setCurrentScene: (sceneId: string) => void;
  
  // オブジェクト操作
  addObject: (obj: Partial<SceneObject>) => void;
  updateObject: (objectId: string, updates: Partial<SceneObject>) => void;
  removeObject: (objectId: string) => void;
  selectObjects: (objectIds: string[]) => void;
  duplicateObject: (objectId: string) => void;
  
  // UI操作
  addUILayout: (name: string) => void;
  setCurrentUILayout: (layoutId: string) => void;
  addUIElement: (parentId: string | null, element: Partial<UIElement>) => void;
  updateUIElement: (elementId: string, updates: Partial<UIElement>) => void;
  removeUIElement: (elementId: string) => void;
  selectUIElement: (elementId: string | null) => void;
  setUICode: (fileType: 'html' | 'css' | 'js', content: string) => { success: boolean; error?: string };
  syncUIFromCode: () => { success: boolean; error?: string };
  syncCodeFromUI: () => void;
  setUIAuthoring: (mode: UIAuthoringMode, syncMode?: UISyncMode) => void;

  // AR設定
  updateARSettings: (updates: Partial<ArsistProject['arSettings']>) => void;
  
  // ロジック操作
  addLogicGraph: (name: string) => void;
  setCurrentLogicGraph: (graphId: string) => void;
  addLogicNode: (node: Partial<LogicNode>) => void;
  updateLogicNode: (nodeId: string, updates: Partial<LogicNode>) => void;
  removeLogicNode: (nodeId: string) => void;
  addLogicConnection: (connection: Omit<LogicConnection, 'id'>) => void;
  removeLogicConnection: (connectionId: string) => void;
  selectNodes: (nodeIds: string[]) => void;
}

export const useProjectStore = create<ProjectState>()(
  immer((set, get) => ({
    project: null,
    projectPath: null,
    isDirty: false,
    currentSceneId: null,
    selectedObjectIds: [],
    currentUILayoutId: null,
    selectedUIElementId: null,
    currentLogicGraphId: null,
    selectedNodeIds: [],

    // ========================================
    // プロジェクト管理
    // ========================================

    createProject: async (options) => {
      if (!window.electronAPI) return;
      
      const result = await window.electronAPI.project.create(options);
      if (result.success) {
        set((state) => {
          state.project = result.project;
          if (state.project) {
            state.project.uiAuthoring = {
              mode: 'code',
              syncMode: 'code-to-visual',
            };
          }
          state.projectPath = options.path + '/' + options.name;
          state.isDirty = false;
          state.currentSceneId = result.project.scenes[0]?.id || null;
          state.currentUILayoutId = result.project.uiLayouts[0]?.id || null;
          state.currentLogicGraphId = result.project.logicGraphs[0]?.id || null;
          // コード専用ではUI→コード同期を行わない
        });
      }
    },

    loadProject: async (path) => {
      if (!window.electronAPI) return;
      
      const result = await window.electronAPI.project.load(path);
      if (result.success) {
        set((state) => {
          state.project = result.project;
          if (state.project) {
            state.project.uiAuthoring = {
              mode: 'code',
              syncMode: 'code-to-visual',
            };
          }
          state.projectPath = path;
          state.isDirty = false;
          state.currentSceneId = result.project.scenes[0]?.id || null;
          state.currentUILayoutId = result.project.uiLayouts[0]?.id || null;
          state.currentLogicGraphId = result.project.logicGraphs[0]?.id || null;
          // コード専用ではUI→コード同期を行わない
        });
      }
    },

    saveProject: async () => {
      const { project, projectPath } = get();
      if (!project || !projectPath || !window.electronAPI) return;
      
      const result = await window.electronAPI.project.save(project);
      if (result.success) {
        set((state) => {
          state.isDirty = false;
        });
      }
    },

    closeProject: () => {
      set((state) => {
        state.project = null;
        state.projectPath = null;
        state.isDirty = false;
        state.currentSceneId = null;
        state.selectedObjectIds = [];
        state.currentUILayoutId = null;
        state.selectedUIElementId = null;
        state.currentLogicGraphId = null;
        state.selectedNodeIds = [];
      });
    },

    // ========================================
    // シーン操作
    // ========================================

    addScene: (name) => {
      set((state) => {
        if (!state.project) return;
        const newScene: SceneData = {
          id: uuidv4(),
          name,
          objects: [],
        };
        state.project.scenes.push(newScene);
        state.currentSceneId = newScene.id;
        state.isDirty = true;
      });
    },

    removeScene: (sceneId) => {
      set((state) => {
        if (!state.project) return;
        state.project.scenes = state.project.scenes.filter(s => s.id !== sceneId);
        if (state.currentSceneId === sceneId) {
          state.currentSceneId = state.project.scenes[0]?.id || null;
        }
        state.isDirty = true;
      });
    },

    setCurrentScene: (sceneId) => {
      set((state) => {
        state.currentSceneId = sceneId;
        state.selectedObjectIds = [];
      });
    },

    // ========================================
    // オブジェクト操作
    // ========================================

    addObject: (obj) => {
      set((state) => {
        if (!state.project || !state.currentSceneId) return;
        const scene = state.project.scenes.find(s => s.id === state.currentSceneId);
        if (!scene) return;

        const newObject: SceneObject = {
          id: uuidv4(),
          name: obj.name || 'New Object',
          type: obj.type || 'primitive',
          primitiveType: obj.primitiveType || 'cube',
          modelPath: obj.modelPath,
          transform: obj.transform || {
            position: { x: 0, y: 0, z: 2 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          material: obj.material || {
            color: '#FFFFFF',
            metallic: 0.5,
            roughness: 0.5,
          },
          components: obj.components || [],
        };

        scene.objects.push(newObject);
        state.selectedObjectIds = [newObject.id];
        state.isDirty = true;
      });
    },

    updateObject: (objectId, updates) => {
      set((state) => {
        if (!state.project || !state.currentSceneId) return;
        const scene = state.project.scenes.find(s => s.id === state.currentSceneId);
        if (!scene) return;

        const objIndex = scene.objects.findIndex(o => o.id === objectId);
        if (objIndex !== -1) {
          scene.objects[objIndex] = { ...scene.objects[objIndex], ...updates };
          state.isDirty = true;
        }
      });
    },

    removeObject: (objectId) => {
      set((state) => {
        if (!state.project || !state.currentSceneId) return;
        const scene = state.project.scenes.find(s => s.id === state.currentSceneId);
        if (!scene) return;

        scene.objects = scene.objects.filter(o => o.id !== objectId);
        state.selectedObjectIds = state.selectedObjectIds.filter(id => id !== objectId);
        state.isDirty = true;
      });
    },

    selectObjects: (objectIds) => {
      set((state) => {
        state.selectedObjectIds = objectIds;
      });
    },

    duplicateObject: (objectId) => {
      set((state) => {
        if (!state.project || !state.currentSceneId) return;
        const scene = state.project.scenes.find(s => s.id === state.currentSceneId);
        if (!scene) return;

        const original = scene.objects.find(o => o.id === objectId);
        if (!original) return;

        const duplicate: SceneObject = {
          ...JSON.parse(JSON.stringify(original)),
          id: uuidv4(),
          name: `${original.name} (Copy)`,
        };
        duplicate.transform.position.x += 0.5;

        scene.objects.push(duplicate);
        state.selectedObjectIds = [duplicate.id];
        state.isDirty = true;
      });
    },

    // ========================================
    // UI操作
    // ========================================

    addUILayout: (name) => {
      set((state) => {
        if (!state.project) return;
        const newLayout: UILayoutData = {
          id: uuidv4(),
          name,
          root: {
            id: uuidv4(),
            type: 'Panel',
            layout: 'FlexColumn',
            style: {},
            children: [],
          },
        };
        state.project.uiLayouts.push(newLayout);
        state.currentUILayoutId = newLayout.id;
        state.isDirty = true;
        syncCodeFromUIIfNeeded(state);
      });
    },

    setCurrentUILayout: (layoutId) => {
      set((state) => {
        state.currentUILayoutId = layoutId;
        state.selectedUIElementId = null;
      });
    },

    addUIElement: (parentId, element) => {
      set((state) => {
        if (!state.project || !state.currentUILayoutId) return;
        const layout = state.project.uiLayouts.find(l => l.id === state.currentUILayoutId);
        if (!layout) return;

        const newElement: UIElement = {
          id: uuidv4(),
          type: element.type || 'Panel',
          style: element.style || {},
          children: [],
          ...element,
        };

        const addToParent = (el: UIElement): boolean => {
          if (el.id === parentId) {
            el.children.push(newElement);
            return true;
          }
          for (const child of el.children) {
            if (addToParent(child)) return true;
          }
          return false;
        };

        if (!parentId) {
          layout.root.children.push(newElement);
        } else {
          addToParent(layout.root);
        }

        state.selectedUIElementId = newElement.id;
        state.isDirty = true;
        syncCodeFromUIIfNeeded(state);
      });
    },

    updateUIElement: (elementId, updates) => {
      set((state) => {
        if (!state.project || !state.currentUILayoutId) return;
        const layout = state.project.uiLayouts.find(l => l.id === state.currentUILayoutId);
        if (!layout) return;

        const updateInTree = (el: UIElement): boolean => {
          if (el.id === elementId) {
            Object.assign(el, updates);
            return true;
          }
          for (const child of el.children) {
            if (updateInTree(child)) return true;
          }
          return false;
        };

        updateInTree(layout.root);
        state.isDirty = true;
        syncCodeFromUIIfNeeded(state);
      });
    },

    removeUIElement: (elementId) => {
      set((state) => {
        if (!state.project || !state.currentUILayoutId) return;
        const layout = state.project.uiLayouts.find(l => l.id === state.currentUILayoutId);
        if (!layout) return;

        const removeFromTree = (el: UIElement): boolean => {
          const index = el.children.findIndex(c => c.id === elementId);
          if (index !== -1) {
            el.children.splice(index, 1);
            return true;
          }
          for (const child of el.children) {
            if (removeFromTree(child)) return true;
          }
          return false;
        };

        removeFromTree(layout.root);
        if (state.selectedUIElementId === elementId) {
          state.selectedUIElementId = null;
        }
        state.isDirty = true;
        syncCodeFromUIIfNeeded(state);
      });
    },

    selectUIElement: (elementId) => {
      set((state) => {
        state.selectedUIElementId = elementId;
      });
    },

    setUICode: (fileType, content) => {
      let error: string | undefined;
      set((state) => {
        if (!state.project) return;

        ensureUICode(state);
        state.project.uiCode[fileType] = content;
        state.project.uiCode.lastSyncedFrom = 'code';
        state.isDirty = true;

        if (fileType === 'html' && shouldSyncCodeToVisual(state)) {
          try {
            syncUIFromCodeInternal(state);
          } catch (e) {
            error = (e as Error).message;
          }
        }
      });

      if (error) return { success: false, error };
      return { success: true };
    },

    syncUIFromCode: () => {
      let error: string | undefined;
      set((state) => {
        if (!state.project) return;
        ensureUICode(state);
        try {
          syncUIFromCodeInternal(state);
        } catch (e) {
          error = (e as Error).message;
        }
      });

      if (error) return { success: false, error };
      return { success: true };
    },

    syncCodeFromUI: () => {
      set((state) => {
        if (!state.project) return;
        syncCodeFromUIIfNeeded(state, true);
      });
    },

    setUIAuthoring: (mode, syncMode) => {
      set((state) => {
        if (!state.project) return;
        state.project.uiAuthoring = {
          mode,
          syncMode: syncMode || state.project.uiAuthoring?.syncMode || 'two-way',
        };
        state.isDirty = true;
      });
    },

    updateARSettings: (updates) => {
      set((state) => {
        if (!state.project) return;
        const currentFloating = state.project.arSettings.floatingScreen ?? { width: 800, height: 600, distance: 2, lockToGaze: false };
        const incomingFloating = updates.floatingScreen;
        state.project.arSettings = {
          ...state.project.arSettings,
          ...updates,
          floatingScreen: incomingFloating ? {
            width: incomingFloating.width ?? currentFloating.width,
            height: incomingFloating.height ?? currentFloating.height,
            distance: incomingFloating.distance ?? currentFloating.distance,
            lockToGaze: incomingFloating.lockToGaze ?? currentFloating.lockToGaze,
          } : currentFloating,
        };
        state.isDirty = true;
      });
    },

    // ========================================
    // ロジック操作
    // ========================================

    addLogicGraph: (name) => {
      set((state) => {
        if (!state.project) return;
        const newGraph: LogicGraphData = {
          id: uuidv4(),
          name,
          nodes: [],
          connections: [],
        };
        state.project.logicGraphs.push(newGraph);
        state.currentLogicGraphId = newGraph.id;
        state.isDirty = true;
      });
    },

    setCurrentLogicGraph: (graphId) => {
      set((state) => {
        state.currentLogicGraphId = graphId;
        state.selectedNodeIds = [];
      });
    },

    addLogicNode: (node) => {
      set((state) => {
        if (!state.project || !state.currentLogicGraphId) return;
        const graph = state.project.logicGraphs.find(g => g.id === state.currentLogicGraphId);
        if (!graph) return;

        const newNode: LogicNode = {
          id: uuidv4(),
          type: node.type || 'action',
          position: node.position || { x: 100, y: 100 },
          ...node,
        };

        graph.nodes.push(newNode);
        state.selectedNodeIds = [newNode.id];
        state.isDirty = true;
      });
    },

    updateLogicNode: (nodeId, updates) => {
      set((state) => {
        if (!state.project || !state.currentLogicGraphId) return;
        const graph = state.project.logicGraphs.find(g => g.id === state.currentLogicGraphId);
        if (!graph) return;

        const nodeIndex = graph.nodes.findIndex(n => n.id === nodeId);
        if (nodeIndex !== -1) {
          graph.nodes[nodeIndex] = { ...graph.nodes[nodeIndex], ...updates };
          state.isDirty = true;
        }
      });
    },

    removeLogicNode: (nodeId) => {
      set((state) => {
        if (!state.project || !state.currentLogicGraphId) return;
        const graph = state.project.logicGraphs.find(g => g.id === state.currentLogicGraphId);
        if (!graph) return;

        graph.nodes = graph.nodes.filter(n => n.id !== nodeId);
        graph.connections = graph.connections.filter(
          c => c.sourceNodeId !== nodeId && c.targetNodeId !== nodeId
        );
        state.selectedNodeIds = state.selectedNodeIds.filter(id => id !== nodeId);
        state.isDirty = true;
      });
    },

    addLogicConnection: (connection) => {
      set((state) => {
        if (!state.project || !state.currentLogicGraphId) return;
        const graph = state.project.logicGraphs.find(g => g.id === state.currentLogicGraphId);
        if (!graph) return;

        const newConnection: LogicConnection = {
          id: uuidv4(),
          ...connection,
        };

        graph.connections.push(newConnection);
        state.isDirty = true;
      });
    },

    removeLogicConnection: (connectionId) => {
      set((state) => {
        if (!state.project || !state.currentLogicGraphId) return;
        const graph = state.project.logicGraphs.find(g => g.id === state.currentLogicGraphId);
        if (!graph) return;

        graph.connections = graph.connections.filter(c => c.id !== connectionId);
        state.isDirty = true;
      });
    },

    selectNodes: (nodeIds) => {
      set((state) => {
        state.selectedNodeIds = nodeIds;
      });
    },
  }))
);
