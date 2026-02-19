/**
 * Arsist Engine — Project Manager
 * プロジェクトの作成、読み込み、保存、エクスポート管理
 *
 * DataSource → DataStore → UI の3層構造。
 * ロジックグラフや UIコードバンドルは存在しない。
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import * as YAML from 'yaml';
import type {
  ArsistProject,
  ProjectTemplate,
  SceneData,
  UILayoutData,
  ARSettings,
  DataFlowDefinition,
} from '../../shared/types';

// ========================================
// Public Interfaces
// ========================================

export interface CreateProjectOptions {
  name: string;
  path: string;
  template: ProjectTemplate;
  targetDevice: string;
  trackingMode?: string;
  presentationMode?: string;
}

export interface ExportOptions {
  format: 'unity' | 'json' | 'yaml';
  outputPath: string;
  includeAssets: boolean;
}

// ========================================
// ProjectManager
// ========================================

export class ProjectManager {
  private currentProject: ArsistProject | null = null;
  private projectPath: string | null = null;

  /* ------------------------------------------------
   * 新規プロジェクト作成
   * ----------------------------------------------- */
  async createProject(options: CreateProjectOptions): Promise<{ success: boolean; project?: ArsistProject; error?: string }> {
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
      await fs.ensureDir(path.join(projectDir, 'Build'));

      const arSettings = this.createARSettings(options.template);
      const normalizedTarget = (options.targetDevice || '').toLowerCase();
      const isQuest = normalizedTarget.includes('quest') || normalizedTarget.includes('meta');

      const project: ArsistProject = {
        id: uuidv4(),
        name: options.name,
        version: '1.0.0',
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
        dataFlow: this.createInitialDataFlow(),
        scenes: [],
        uiLayouts: [],
        buildSettings: {
          packageName: `com.arsist.${options.name.toLowerCase().replace(/\s+/g, '')}`,
          version: '1.0.0',
          versionCode: 1,
          minSdkVersion: isQuest ? 32 : 29,
          targetSdkVersion: isQuest ? 32 : 34,
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

      return { success: true, project };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /* ------------------------------------------------
   * 既存プロジェクトを読み込み
   * ----------------------------------------------- */
  async loadProject(projectPath: string): Promise<{ success: boolean; project?: ArsistProject; error?: string }> {
    try {
      const projectFile = path.join(projectPath, 'project.json');

      if (!(await fs.pathExists(projectFile))) {
        return { success: false, error: 'project.json not found' };
      }

      const project: ArsistProject = await fs.readJSON(projectFile);

      // 後方互換: 旧テンプレート名を新名に変換
      if (!['3d_ar_scene', '2d_floating_screen', 'head_locked_hud'].includes(project.appType as string)) {
        project.appType = this.migrateAppType(project.appType as string);
      }

      // 後方互換: AR設定が無ければ生成
      if (!project.arSettings) {
        project.arSettings = this.createARSettings(project.appType);
      }

      // 後方互換: DataFlow が無ければ空で生成
      if (!project.dataFlow) {
        project.dataFlow = this.createInitialDataFlow();
      }

      // 後方互換: 旧フィールド削除
      delete (project as any).logicGraphs;
      delete (project as any).uiAuthoring;
      delete (project as any).uiCode;

      // シーン、UIの詳細を読み込み
      project.scenes = await this.loadScenes(projectPath, project.scenes);
      project.uiLayouts = await this.loadUILayouts(projectPath, project.uiLayouts);

      this.currentProject = project;
      this.projectPath = projectPath;

      return { success: true, project };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /* ------------------------------------------------
   * プロジェクトを保存
   * ----------------------------------------------- */
  async saveProject(data: Partial<ArsistProject>): Promise<{ success: boolean; error?: string }> {
    if (!this.currentProject || !this.projectPath) {
      return { success: false, error: 'No project loaded' };
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
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /* ------------------------------------------------
   * Unityビルド用にエクスポート
   * ----------------------------------------------- */
  async exportProject(options: ExportOptions): Promise<{ success: boolean; outputPath?: string; error?: string }> {
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
      } else if (options.format === 'yaml') {
        await fs.writeFile(path.join(exportDir, 'manifest.yaml'), YAML.stringify(manifest));
      }

      // シーンデータ出力
      await fs.writeJSON(path.join(exportDir, 'scenes.json'), this.currentProject.scenes, { spaces: 2 });

      // UIレイアウトデータ出力
      await fs.writeJSON(path.join(exportDir, 'ui_layouts.json'), this.currentProject.uiLayouts, { spaces: 2 });

      // DataFlow 定義出力
      await fs.writeJSON(path.join(exportDir, 'dataflow.json'), this.currentProject.dataFlow, { spaces: 2 });

      // アセットをコピー
      if (options.includeAssets) {
        await fs.copy(path.join(this.projectPath, 'Assets'), path.join(exportDir, 'Assets'));
      }

      return { success: true, outputPath: exportDir };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  getCurrentProject(): ArsistProject | null {
    return this.currentProject;
  }

  getProjectPath(): string | null {
    return this.projectPath;
  }

  // ========================================
  // Private Helpers
  // ========================================

  /** 旧テンプレート名を新名に変換（後方互換） */
  private migrateAppType(oldType: string): ProjectTemplate {
    switch (oldType) {
      case '3D_AR':
        return '3d_ar_scene';
      case '2D_Floating':
        return '2d_floating_screen';
      case '2D_HeadLocked':
        return 'head_locked_hud';
      default:
        return '3d_ar_scene';
    }
  }

  private createInitialScene(template: ProjectTemplate): SceneData {
    const scene: SceneData = {
      id: uuidv4(),
      name: 'MainScene',
      objects: [],
    };

    if (template === '3d_ar_scene') {
      scene.objects.push({
        id: uuidv4(),
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
        id: uuidv4(),
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

  private createInitialUI(template: ProjectTemplate): UILayoutData {
    const ui: UILayoutData = {
      id: uuidv4(),
      name: 'MainUI',
      scope: 'uhd',
      resolution: { width: 1920, height: 1080 },
      root: {
        id: uuidv4(),
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
          id: uuidv4(),
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
          id: uuidv4(),
          type: 'Text',
          content: '00:00:00',
          style: {
            fontSize: 32,
            color: '#4ec9b0',
          },
          children: [],
        },
      ];
    } else if (template === '2d_floating_screen') {
      ui.root.style = {
        ...ui.root.style,
        width: 1920,
        height: 1080,
        backgroundColor: '#000000FF',
      };
    }

    return ui;
  }

  private createInitialDataFlow(): DataFlowDefinition {
    return {
      dataSources: [],
      transforms: [],
    };
  }

  private createARSettings(template: ProjectTemplate): ARSettings {
    switch (template) {
      case '3d_ar_scene':
        return {
          trackingMode: '6dof',
          presentationMode: 'world_anchored',
          worldScale: 1,
          defaultDepth: 2,
        };
      case '2d_floating_screen':
        return {
          trackingMode: '3dof',
          presentationMode: 'floating_screen',
          worldScale: 1,
          defaultDepth: 2,
          floatingScreen: {
            width: 1.6,
            height: 0.9,
            distance: 2,
            lockToGaze: true,
          },
        };
      case 'head_locked_hud':
        return {
          trackingMode: 'head_locked',
          presentationMode: 'head_locked_hud',
          worldScale: 1,
          defaultDepth: 1,
        };
      default:
        return {
          trackingMode: '6dof',
          presentationMode: 'world_anchored',
          worldScale: 1,
          defaultDepth: 2,
        };
    }
  }

  private async loadScenes(projectPath: string, sceneRefs: SceneData[]): Promise<SceneData[]> {
    const scenes: SceneData[] = [];
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
      } catch (e) {
        console.error(`Failed to load scene ${ref.id}:`, e);
      }
    }
    return scenes;
  }

  private async loadUILayouts(projectPath: string, uiRefs: UILayoutData[]): Promise<UILayoutData[]> {
    const layouts: UILayoutData[] = [];
    for (const ref of uiRefs) {
      try {
        const uiPath = path.join(projectPath, 'UI', `${ref.id}.json`);
        if (await fs.pathExists(uiPath)) {
          const layout = await fs.readJSON(uiPath);
          // 後方互換
          if (!layout.scope) layout.scope = 'uhd';
          if (!layout.resolution) {
            layout.resolution = layout.scope === 'canvas'
              ? { width: 1024, height: 1024 }
              : { width: 1920, height: 1080 };
          }
          layouts.push(layout);
        }
      } catch (e) {
        console.error(`Failed to load UI layout ${ref.id}:`, e);
      }
    }
    return layouts;
  }

  private generateUnityManifest(): object {
    if (!this.currentProject) return {};

    const { remoteInput, ...androidBuild } = this.currentProject.buildSettings as any;

    return {
      projectId: this.currentProject.id,
      projectName: this.currentProject.name,
      version: this.currentProject.version,
      appType: this.currentProject.appType,
      targetDevice: this.currentProject.targetDevice,
      arSettings: this.currentProject.arSettings,
      designSystem: this.currentProject.designSystem,
      dataFlow: this.currentProject.dataFlow,
      build: androidBuild,
      buildSettings: this.currentProject.buildSettings,
      remoteInput,
      exportedAt: new Date().toISOString(),
    };
  }
}
