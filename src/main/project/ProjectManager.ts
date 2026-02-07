/**
 * Arsist Engine - Project Manager
 * プロジェクトの作成、読み込み、保存、エクスポート管理
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import * as YAML from 'yaml';
import { 
  ArsistProject, 
  ProjectTemplate, 
  SceneData, 
  UILayoutData, 
  LogicGraphData,
  UIAuthoringMode,
  UISyncMode,
  UIAuthoringSettings,
  ARSettings,
  UICodeBundle
} from '../../shared/types';

export interface CreateProjectOptions {
  name: string;
  path: string;
  template: ProjectTemplate;
  targetDevice: string;
  uiAuthoringMode?: UIAuthoringMode;
  uiSyncMode?: UISyncMode;
}

export interface ExportOptions {
  format: 'unity' | 'json' | 'yaml';
  outputPath: string;
  includeAssets: boolean;
}

export class ProjectManager {
  private currentProject: ArsistProject | null = null;
  private projectPath: string | null = null;

  /**
   * 新規プロジェクトを作成
   */
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
      await fs.ensureDir(path.join(projectDir, 'Logic'));
      await fs.ensureDir(path.join(projectDir, 'Build'));

      // プロジェクト定義作成
      const arSettings = this.createARSettings(options.template);
      const uiAuthoring = this.createUIAuthoring(options.uiAuthoringMode, options.uiSyncMode);
      const uiCode = this.createInitialUICode(options.template);

      const project: ArsistProject = {
        id: uuidv4(),
        name: options.name,
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        appType: this.getAppTypeFromTemplate(options.template),
        targetDevice: options.targetDevice,
        arSettings,
        uiAuthoring,
        uiCode,
        designSystem: {
          defaultFont: 'Roboto-Regular.ttf',
          primaryColor: '#569cd6',
          secondaryColor: '#4ec9b0',
          backgroundColor: '#1e1e1e',
          textColor: '#FFFFFF',
        },
        scenes: [],
        uiLayouts: [],
        logicGraphs: [],
        buildSettings: {
          packageName: `com.arsist.${options.name.toLowerCase().replace(/\s+/g, '')}`,
          version: '1.0.0',
          versionCode: 1,
          minSdkVersion: 29,
          targetSdkVersion: 34,
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
      const initialLogic = this.createInitialLogic();

      project.scenes.push(initialScene);
      project.uiLayouts.push(initialUI);
      project.logicGraphs.push(initialLogic);

      // ファイル保存
      await fs.writeJSON(path.join(projectDir, 'project.json'), project, { spaces: 2 });
      await fs.writeJSON(path.join(projectDir, 'Scenes', `${initialScene.id}.json`), initialScene, { spaces: 2 });
      await fs.writeJSON(path.join(projectDir, 'UI', `${initialUI.id}.json`), initialUI, { spaces: 2 });
      await fs.writeJSON(path.join(projectDir, 'Logic', `${initialLogic.id}.json`), initialLogic, { spaces: 2 });

      this.currentProject = project;
      this.projectPath = projectDir;

      return { success: true, project };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 既存プロジェクトを読み込み
   */
  async loadProject(projectPath: string): Promise<{ success: boolean; project?: ArsistProject; error?: string }> {
    try {
      const projectFile = path.join(projectPath, 'project.json');
      
      if (!await fs.pathExists(projectFile)) {
        return { success: false, error: 'project.json not found' };
      }

      const project: ArsistProject = await fs.readJSON(projectFile);

      // 新しい設定のデフォルトを補完（後方互換）
      if (!project.arSettings) {
        project.arSettings = this.createARSettingsFromAppType(project.appType);
      }
      if (!project.uiAuthoring) {
        project.uiAuthoring = this.createUIAuthoring();
      }
      if (!project.uiCode) {
        project.uiCode = this.createInitialUICodeFromAppType(project.appType);
      }

      // シーン、UI、ロジックの詳細を読み込み
      project.scenes = await this.loadScenes(projectPath, project.scenes);
      project.uiLayouts = await this.loadUILayouts(projectPath, project.uiLayouts);
      project.logicGraphs = await this.loadLogicGraphs(projectPath, project.logicGraphs);

      this.currentProject = project;
      this.projectPath = projectPath;

      return { success: true, project };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * プロジェクトを保存
   */
  async saveProject(data: Partial<ArsistProject>): Promise<{ success: boolean; error?: string }> {
    if (!this.currentProject || !this.projectPath) {
      return { success: false, error: 'No project loaded' };
    }

    try {
      // プロジェクトデータを更新
      Object.assign(this.currentProject, data);
      this.currentProject.updatedAt = new Date().toISOString();

      // メインプロジェクトファイル保存
      await fs.writeJSON(path.join(this.projectPath, 'project.json'), this.currentProject, { spaces: 2 });

      // 各シーンを個別ファイルに保存
      for (const scene of this.currentProject.scenes) {
        await fs.writeJSON(
          path.join(this.projectPath, 'Scenes', `${scene.id}.json`),
          scene,
          { spaces: 2 }
        );
      }

      // 各UIレイアウトを保存
      for (const ui of this.currentProject.uiLayouts) {
        await fs.writeJSON(
          path.join(this.projectPath, 'UI', `${ui.id}.json`),
          ui,
          { spaces: 2 }
        );
      }

      // 各ロジックグラフを保存
      for (const logic of this.currentProject.logicGraphs) {
        await fs.writeJSON(
          path.join(this.projectPath, 'Logic', `${logic.id}.json`),
          logic,
          { spaces: 2 }
        );
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Unityビルド用にエクスポート
   */
  async exportProject(options: ExportOptions): Promise<{ success: boolean; outputPath?: string; error?: string }> {
    if (!this.currentProject || !this.projectPath) {
      return { success: false, error: 'No project loaded' };
    }

    try {
      const exportDir = options.outputPath;
      await fs.ensureDir(exportDir);

      // Unity用マニフェスト生成
      const manifest = this.generateUnityManifest();
      
      if (options.format === 'json') {
        await fs.writeJSON(path.join(exportDir, 'manifest.json'), manifest, { spaces: 2 });
      } else if (options.format === 'yaml') {
        await fs.writeFile(path.join(exportDir, 'manifest.yaml'), YAML.stringify(manifest));
      }

      // シーンデータ出力
      await fs.writeJSON(
        path.join(exportDir, 'scenes.json'),
        this.currentProject.scenes,
        { spaces: 2 }
      );

      // UIレイアウトデータ出力
      await fs.writeJSON(
        path.join(exportDir, 'ui_layouts.json'),
        this.currentProject.uiLayouts,
        { spaces: 2 }
      );

      // UIコード（HTML/CSS/JS）を出力
      if (this.currentProject.uiCode) {
        const uiCodeDir = path.join(exportDir, 'UICode');
        await fs.ensureDir(uiCodeDir);
        
        // HTML生成（完全なHTMLドキュメント）
        const htmlContent = this.generateCompleteHTML(
          this.currentProject.uiCode.html || '',
          this.currentProject.uiCode.css || '',
          this.currentProject.uiCode.js || ''
        );
        
        await fs.writeFile(path.join(uiCodeDir, 'index.html'), htmlContent);
        await fs.writeFile(path.join(uiCodeDir, 'styles.css'), this.currentProject.uiCode.css || '');
        await fs.writeFile(path.join(uiCodeDir, 'script.js'), this.currentProject.uiCode.js || '');
        
        console.log('[ProjectManager] UI Code exported to UICode/');
      }

      // ロジックグラフをC#コードに変換
      const logicCode = this.convertLogicToCode(this.currentProject.logicGraphs);
      await fs.writeFile(path.join(exportDir, 'GeneratedLogic.cs'), logicCode);

      // アセットをコピー
      if (options.includeAssets) {
        await fs.copy(
          path.join(this.projectPath, 'Assets'),
          path.join(exportDir, 'Assets')
        );
      }

      return { success: true, outputPath: exportDir };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 現在のプロジェクトを取得
   */
  getCurrentProject(): ArsistProject | null {
    return this.currentProject;
  }

  /**
   * プロジェクトパスを取得
   */
  getProjectPath(): string | null {
    return this.projectPath;
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  private getAppTypeFromTemplate(template: ProjectTemplate): string {
    switch (template) {
      case '3d_ar_scene': return '3D_AR';
      case '2d_floating_screen': return '2D_Floating';
      case 'head_locked_hud': return '2D_HeadLocked';
      default: return '3D_AR';
    }
  }

  private createInitialScene(template: ProjectTemplate): SceneData {
    const scene: SceneData = {
      id: uuidv4(),
      name: 'MainScene',
      objects: [],
    };

    if (template === '3d_ar_scene') {
      // 3Dシーン用のサンプルオブジェクト
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
        components: [],
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
        components: [],
      });
    }

    return scene;
  }

  private createInitialUI(template: ProjectTemplate): UILayoutData {
    const ui: UILayoutData = {
      id: uuidv4(),
      name: 'MainUI',
      root: {
        id: uuidv4(),
        type: 'Panel',
        layout: 'FlexColumn',
        style: {
          backgroundColor: '#00000088',
          blur: 15,
          borderRadius: 20,
          padding: { top: 20, right: 20, bottom: 20, left: 20 },
        },
        children: [],
      },
    };

    if (template === 'head_locked_hud') {
      // HUD用のサンプルUI
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
      // フローティングスクリーン用
      ui.root.style = {
        ...ui.root.style,
        width: 1920,
        height: 1080,
        backgroundColor: '#000000FF',
      };
    }

    return ui;
  }

  private createInitialLogic(): LogicGraphData {
    return {
      id: uuidv4(),
      name: 'MainLogic',
      nodes: [
        {
          id: uuidv4(),
          type: 'event',
          eventType: 'OnStart',
          position: { x: 100, y: 100 },
          outputs: ['exec'],
        },
      ],
      connections: [],
    };
  }

  private async loadScenes(projectPath: string, sceneRefs: SceneData[]): Promise<SceneData[]> {
    const scenes: SceneData[] = [];
    for (const ref of sceneRefs) {
      try {
        const scenePath = path.join(projectPath, 'Scenes', `${ref.id}.json`);
        if (await fs.pathExists(scenePath)) {
          scenes.push(await fs.readJSON(scenePath));
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
          layouts.push(await fs.readJSON(uiPath));
        }
      } catch (e) {
        console.error(`Failed to load UI layout ${ref.id}:`, e);
      }
    }
    return layouts;
  }

  private async loadLogicGraphs(projectPath: string, logicRefs: LogicGraphData[]): Promise<LogicGraphData[]> {
    const graphs: LogicGraphData[] = [];
    for (const ref of logicRefs) {
      try {
        const logicPath = path.join(projectPath, 'Logic', `${ref.id}.json`);
        if (await fs.pathExists(logicPath)) {
          graphs.push(await fs.readJSON(logicPath));
        }
      } catch (e) {
        console.error(`Failed to load logic graph ${ref.id}:`, e);
      }
    }
    return graphs;
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
      uiAuthoring: this.currentProject.uiAuthoring,
      uiCode: this.currentProject.uiCode,
      designSystem: this.currentProject.designSystem,
      // Unity側(ArsistBuildPipeline.cs)は `manifest.build` を参照する
      build: androidBuild,
      // 互換用（古いキー）
      buildSettings: this.currentProject.buildSettings,
      // ランタイム（UDP/TCP等）
      remoteInput: remoteInput,
      exportedAt: new Date().toISOString(),
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

  private createARSettingsFromAppType(appType: string): ARSettings {
    switch (appType) {
      case '2D_Floating':
        return this.createARSettings('2d_floating_screen');
      case '2D_HeadLocked':
        return this.createARSettings('head_locked_hud');
      case '3D_AR':
      default:
        return this.createARSettings('3d_ar_scene');
    }
  }

  private createUIAuthoring(mode: UIAuthoringMode = 'code', syncMode: UISyncMode = 'code-to-visual'): UIAuthoringSettings {
    return {
      mode,
      syncMode,
    };
  }

  private createInitialUICode(template: ProjectTemplate): UICodeBundle {
    return this.createInitialUICodeFromAppType(this.getAppTypeFromTemplate(template));
  }

  private createInitialUICodeFromAppType(appType: string): UICodeBundle {
    const baseHtml = appType === '2D_HeadLocked'
      ? '<div class="hud" data-arsist-root="true" data-arsist-type="Panel"><h1 data-arsist-type="Text">HUD</h1><p data-arsist-type="Text">Status: OK</p></div>'
      : appType === '2D_Floating'
        ? '<div class="screen" data-arsist-root="true" data-arsist-type="Panel"><h1 data-arsist-type="Text">Floating Screen</h1><p data-arsist-type="Text">Tap to interact</p></div>'
        : '<div class="panel" data-arsist-root="true" data-arsist-type="Panel"><h1 data-arsist-type="Text">AR Scene UI</h1><p data-arsist-type="Text">Place UI in space</p></div>';

    const baseCss = `body { margin:0; font-family: Inter, system-ui, sans-serif; color:#fff; }
.hud, .screen, .panel { background: rgba(0,0,0,0.4); padding: 24px; border-radius: 12px; }`;

    const baseJs = `console.log('Arsist UI loaded');`;

    return {
      html: baseHtml,
      css: baseCss,
      js: baseJs,
      lastSyncedFrom: 'none',
    };
  }

  private convertLogicToCode(graphs: LogicGraphData[]): string {
    let code = `// Auto-generated by Arsist Engine
// Do not edit manually
using UnityEngine;
using System;

namespace Arsist.Generated
{
`;

    for (const graph of graphs) {
      code += `    public class ${this.sanitizeClassName(graph.name)} : MonoBehaviour
    {
`;
      // ノードをC#コードに変換
      for (const node of graph.nodes) {
        if (node.type === 'event' && node.eventType === 'OnStart') {
          code += `        void Start()
        {
            // Generated from visual script
        }

`;
        } else if (node.type === 'event' && node.eventType === 'OnUpdate') {
          code += `        void Update()
        {
            // Generated from visual script
        }

`;
        }
      }
      code += `    }

`;
    }

    code += `}
`;
    return code;
  }

  private sanitizeClassName(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
  }
  /**
   * HTML断片からビルド用の完全なHTMLドキュメントを生成
   */
  private generateCompleteHTML(htmlFragment: string, css: string, js: string): string {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arsist UI</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: 'Inter', system-ui, sans-serif;
      background: transparent;
      color: #ffffff;
    }
    ${css}
  </style>
</head>
<body>
  ${htmlFragment}
  <script>
    // Arsist Bridge for Unity Communication
    window.ArsistBridge = window.ArsistBridge || {
      sendEvent: function(eventName, data) {
        console.log('[ArsistBridge] Event:', eventName, data);
        // Unity側で受信する処理を実装
        if (typeof unityInstance !== 'undefined') {
          unityInstance.SendMessage('ArsistBridge', 'OnEvent', JSON.stringify({ event: eventName, data: data }));
        }
      },
      receiveEvent: function(eventName, callback) {
        console.log('[ArsistBridge] Registered event:', eventName);
        window['arsist_' + eventName] = callback;
      }
    };
    
    ${js}
  </script>
</body>
</html>`;
  }}
