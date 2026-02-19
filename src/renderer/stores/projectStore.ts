/**
 * Arsist Engine — Project Store
 * プロジェクト中間表現 (IR) の状態管理
 *
 * DataSource → DataStore → UI の3層構造。
 * ロジックグラフやコードエディタは存在しない。
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
  DataSourceDefinition,
  TransformDefinition,
  ARSettings,
} from '../../shared/types';

// ========================================
// Store 型定義
// ========================================

interface ProjectState {
  project: ArsistProject | null;
  projectPath: string | null;
  isDirty: boolean;

  // Scene
  currentSceneId: string | null;
  selectedObjectIds: string[];

  // UI
  currentUILayoutId: string | null;
  selectedUIElementId: string | null;

  // DataFlow
  selectedDataSourceId: string | null;
  selectedTransformId: string | null;

  // --- プロジェクトライフサイクル ---
  createProject: (options: CreateProjectOptions) => Promise<void>;
  loadProject: (path: string) => Promise<void>;
  saveProject: () => Promise<void>;
  closeProject: () => void;

  // --- Scene ---
  addScene: (name: string) => void;
  removeScene: (sceneId: string) => void;
  setCurrentScene: (sceneId: string) => void;

  // --- Object ---
  addObject: (obj: Partial<SceneObject>) => void;
  updateObject: (objectId: string, updates: Partial<SceneObject>) => void;
  removeObject: (objectId: string) => void;
  selectObjects: (objectIds: string[]) => void;
  duplicateObject: (objectId: string) => void;

  // --- UI Layout ---
  addUILayout: (name: string, scope: 'uhd' | 'canvas') => string | null;
  setCurrentUILayout: (layoutId: string) => void;
  addUIElement: (parentId: string | null, element: Partial<UIElement>) => void;
  updateUIElement: (elementId: string, updates: Partial<UIElement>) => void;
  removeUIElement: (elementId: string) => void;
  selectUIElement: (elementId: string | null) => void;

  // --- DataFlow ---
  addDataSource: (source: Partial<DataSourceDefinition>) => void;
  updateDataSource: (id: string, updates: Partial<DataSourceDefinition>) => void;
  removeDataSource: (id: string) => void;
  selectDataSource: (id: string | null) => void;

  addTransform: (transform: Partial<TransformDefinition>) => void;
  updateTransform: (id: string, updates: Partial<TransformDefinition>) => void;
  removeTransform: (id: string) => void;
  selectTransform: (id: string | null) => void;

  // --- AR ---
  updateARSettings: (updates: Partial<ARSettings>) => void;
}

interface CreateProjectOptions {
  name: string;
  path: string;
  template: string;
  targetDevice: string;
  trackingMode?: string;
  presentationMode?: string;
}

// ========================================
// Store 実装
// ========================================

export const useProjectStore = create<ProjectState>()(
  immer((set, get) => ({
    project: null,
    projectPath: null,
    isDirty: false,
    currentSceneId: null,
    selectedObjectIds: [],
    currentUILayoutId: null,
    selectedUIElementId: null,
    selectedDataSourceId: null,
    selectedTransformId: null,

    // ========================================
    // プロジェクトライフサイクル
    // ========================================

    createProject: async (options) => {
      if (!window.electronAPI) return;
      const result = await window.electronAPI.project.create(options);
      if (result.success) {
        set((s) => {
          s.project = result.project;
          s.projectPath = options.path + '/' + options.name;
          s.isDirty = false;
          s.currentSceneId = result.project.scenes[0]?.id ?? null;
          s.currentUILayoutId = result.project.uiLayouts[0]?.id ?? null;
          s.selectedDataSourceId = null;
          s.selectedTransformId = null;
        });
      }
    },

    loadProject: async (path) => {
      if (!window.electronAPI) return;
      const result = await window.electronAPI.project.load(path);
      if (result.success) {
        set((s) => {
          s.project = result.project;
          s.projectPath = path;
          s.isDirty = false;
          s.currentSceneId = result.project.scenes[0]?.id ?? null;
          s.currentUILayoutId = result.project.uiLayouts[0]?.id ?? null;
          s.selectedDataSourceId = null;
          s.selectedTransformId = null;
        });
      }
    },

    saveProject: async () => {
      const { project, projectPath } = get();
      if (!project || !projectPath || !window.electronAPI) return;
      const result = await window.electronAPI.project.save(project);
      if (result.success) {
        set((s) => {
          s.isDirty = false;
        });
      }
    },

    closeProject: () => {
      set((s) => {
        s.project = null;
        s.projectPath = null;
        s.isDirty = false;
        s.currentSceneId = null;
        s.selectedObjectIds = [];
        s.currentUILayoutId = null;
        s.selectedUIElementId = null;
        s.selectedDataSourceId = null;
        s.selectedTransformId = null;
      });
    },

    // ========================================
    // Scene
    // ========================================

    addScene: (name) => {
      set((s) => {
        if (!s.project) return;
        const scene: SceneData = { id: uuidv4(), name, objects: [] };
        s.project.scenes.push(scene);
        s.currentSceneId = scene.id;
        s.isDirty = true;
      });
    },

    removeScene: (sceneId) => {
      set((s) => {
        if (!s.project) return;
        s.project.scenes = s.project.scenes.filter((sc) => sc.id !== sceneId);
        if (s.currentSceneId === sceneId) {
          s.currentSceneId = s.project.scenes[0]?.id ?? null;
        }
        s.isDirty = true;
      });
    },

    setCurrentScene: (sceneId) => {
      set((s) => {
        s.currentSceneId = sceneId;
        s.selectedObjectIds = [];
      });
    },

    // ========================================
    // Object
    // ========================================

    addObject: (obj) => {
      set((s) => {
        if (!s.project || !s.currentSceneId) return;
        const scene = s.project.scenes.find((sc) => sc.id === s.currentSceneId);
        if (!scene) return;

        const newObj: SceneObject = {
          id: uuidv4(),
          name: obj.name || 'New Object',
          type: obj.type || 'primitive',
          primitiveType: obj.primitiveType,
          modelPath: obj.modelPath,
          canvasSettings: obj.canvasSettings,
          transform: obj.transform || {
            position: { x: 0, y: 0, z: 2 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          material: obj.material || { color: '#FFFFFF', metallic: 0.5, roughness: 0.5 },
        };

        scene.objects.push(newObj);
        s.selectedObjectIds = [newObj.id];
        s.isDirty = true;
      });
    },

    updateObject: (objectId, updates) => {
      set((s) => {
        if (!s.project || !s.currentSceneId) return;
        const scene = s.project.scenes.find((sc) => sc.id === s.currentSceneId);
        if (!scene) return;
        const idx = scene.objects.findIndex((o) => o.id === objectId);
        if (idx !== -1) {
          scene.objects[idx] = { ...scene.objects[idx], ...updates };
          s.isDirty = true;
        }
      });
    },

    removeObject: (objectId) => {
      set((s) => {
        if (!s.project || !s.currentSceneId) return;
        const scene = s.project.scenes.find((sc) => sc.id === s.currentSceneId);
        if (!scene) return;
        scene.objects = scene.objects.filter((o) => o.id !== objectId);
        s.selectedObjectIds = s.selectedObjectIds.filter((id) => id !== objectId);
        s.isDirty = true;
      });
    },

    selectObjects: (objectIds) => {
      set((s) => {
        s.selectedObjectIds = objectIds;
      });
    },

    duplicateObject: (objectId) => {
      set((s) => {
        if (!s.project || !s.currentSceneId) return;
        const scene = s.project.scenes.find((sc) => sc.id === s.currentSceneId);
        if (!scene) return;
        const original = scene.objects.find((o) => o.id === objectId);
        if (!original) return;
        const dup: SceneObject = {
          ...JSON.parse(JSON.stringify(original)),
          id: uuidv4(),
          name: `${original.name} (Copy)`,
        };
        dup.transform.position.x += 0.5;
        scene.objects.push(dup);
        s.selectedObjectIds = [dup.id];
        s.isDirty = true;
      });
    },

    // ========================================
    // UI Layout
    // ========================================

    addUILayout: (name, scope) => {
      let layoutId: string | null = null;
      set((s) => {
        if (!s.project) return;
        layoutId = uuidv4();
        const resolution =
          scope === 'canvas'
            ? { width: 1024, height: 1024 }
            : { width: 1920, height: 1080 };
        const layout: UILayoutData = {
          id: layoutId,
          name,
          scope,
          resolution,
          root: {
            id: uuidv4(),
            type: 'Panel',
            layout: 'Absolute',
            style: { width: '100%', height: '100%' },
            children: [],
          },
        };
        s.project.uiLayouts.push(layout);
        s.currentUILayoutId = layout.id;
        s.isDirty = true;
      });
      return layoutId;
    },

    setCurrentUILayout: (layoutId) => {
      set((s) => {
        s.currentUILayoutId = layoutId;
        s.selectedUIElementId = null;
      });
    },

    addUIElement: (parentId, element) => {
      set((s) => {
        if (!s.project || !s.currentUILayoutId) return;
        const layout = s.project.uiLayouts.find((l) => l.id === s.currentUILayoutId);
        if (!layout) return;

        const newEl: UIElement = {
          id: uuidv4(),
          type: element.type || 'Panel',
          style: element.style || {},
          children: [],
          ...element,
        };

        const addToParent = (el: UIElement): boolean => {
          if (el.id === parentId) {
            el.children.push(newEl);
            return true;
          }
          for (const child of el.children) {
            if (addToParent(child)) return true;
          }
          return false;
        };

        if (!parentId) {
          layout.root.children.push(newEl);
        } else {
          addToParent(layout.root);
        }
        s.selectedUIElementId = newEl.id;
        s.isDirty = true;
      });
    },

    updateUIElement: (elementId, updates) => {
      set((s) => {
        if (!s.project || !s.currentUILayoutId) return;
        const layout = s.project.uiLayouts.find((l) => l.id === s.currentUILayoutId);
        if (!layout) return;

        const walk = (el: UIElement): boolean => {
          if (el.id === elementId) {
            Object.assign(el, updates);
            return true;
          }
          for (const child of el.children) {
            if (walk(child)) return true;
          }
          return false;
        };
        walk(layout.root);
        s.isDirty = true;
      });
    },

    removeUIElement: (elementId) => {
      set((s) => {
        if (!s.project || !s.currentUILayoutId) return;
        const layout = s.project.uiLayouts.find((l) => l.id === s.currentUILayoutId);
        if (!layout) return;

        const removeFromTree = (el: UIElement): boolean => {
          const idx = el.children.findIndex((c) => c.id === elementId);
          if (idx !== -1) {
            el.children.splice(idx, 1);
            return true;
          }
          for (const child of el.children) {
            if (removeFromTree(child)) return true;
          }
          return false;
        };
        removeFromTree(layout.root);
        if (s.selectedUIElementId === elementId) s.selectedUIElementId = null;
        s.isDirty = true;
      });
    },

    selectUIElement: (elementId) => {
      set((s) => {
        s.selectedUIElementId = elementId;
      });
    },

    // ========================================
    // DataFlow — DataSource
    // ========================================

    addDataSource: (source) => {
      set((s) => {
        if (!s.project) return;
        const ds: DataSourceDefinition = {
          id: uuidv4(),
          type: source.type || 'System_Clock',
          mode: source.mode || 'polling',
          storeAs: source.storeAs || `data_${s.project.dataFlow.dataSources.length}`,
          updateRate: source.updateRate,
          parameters: source.parameters,
        };
        s.project.dataFlow.dataSources.push(ds);
        s.selectedDataSourceId = ds.id;
        s.isDirty = true;
      });
    },

    updateDataSource: (id, updates) => {
      set((s) => {
        if (!s.project) return;
        const idx = s.project.dataFlow.dataSources.findIndex((d) => d.id === id);
        if (idx !== -1) {
          s.project.dataFlow.dataSources[idx] = {
            ...s.project.dataFlow.dataSources[idx],
            ...updates,
          };
          s.isDirty = true;
        }
      });
    },

    removeDataSource: (id) => {
      set((s) => {
        if (!s.project) return;
        s.project.dataFlow.dataSources = s.project.dataFlow.dataSources.filter((d) => d.id !== id);
        if (s.selectedDataSourceId === id) s.selectedDataSourceId = null;
        s.isDirty = true;
      });
    },

    selectDataSource: (id) => {
      set((s) => {
        s.selectedDataSourceId = id;
        s.selectedTransformId = null;
      });
    },

    // ========================================
    // DataFlow — Transform
    // ========================================

    addTransform: (transform) => {
      set((s) => {
        if (!s.project) return;
        const tf: TransformDefinition = {
          id: uuidv4(),
          type: transform.type || 'Formula',
          inputs: transform.inputs || [],
          storeAs: transform.storeAs || `calc_${s.project.dataFlow.transforms.length}`,
          expression: transform.expression,
          updateRate: transform.updateRate,
          parameters: transform.parameters,
        };
        s.project.dataFlow.transforms.push(tf);
        s.selectedTransformId = tf.id;
        s.isDirty = true;
      });
    },

    updateTransform: (id, updates) => {
      set((s) => {
        if (!s.project) return;
        const idx = s.project.dataFlow.transforms.findIndex((t) => t.id === id);
        if (idx !== -1) {
          s.project.dataFlow.transforms[idx] = {
            ...s.project.dataFlow.transforms[idx],
            ...updates,
          };
          s.isDirty = true;
        }
      });
    },

    removeTransform: (id) => {
      set((s) => {
        if (!s.project) return;
        s.project.dataFlow.transforms = s.project.dataFlow.transforms.filter((t) => t.id !== id);
        if (s.selectedTransformId === id) s.selectedTransformId = null;
        s.isDirty = true;
      });
    },

    selectTransform: (id) => {
      set((s) => {
        s.selectedTransformId = id;
        s.selectedDataSourceId = null;
      });
    },

    // ========================================
    // AR Settings
    // ========================================

    updateARSettings: (updates) => {
      set((s) => {
        if (!s.project) return;
        s.project.arSettings = { ...s.project.arSettings, ...updates };
        s.isDirty = true;
      });
    },
  })),
);
