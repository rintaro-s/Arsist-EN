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
} from '../../shared/types';
import { CURRENT_IR_VERSION } from '../../shared/irVersion';
import { IrVersionError, migrateProject, type MigrationOutcome } from './migrations';
import { checkProjectRequirements, migrateExtensionData, type ExtensionDataUpgrade, type MissingRequirement } from '../../shared/extensions';
import { getExtensionCatalog } from '../extensions/catalogService';
import { describeJsonError, resolveSceneAndUiCopies, seenAfterSave, stableStringify, syncStaleCopies, type CopySeen } from './sceneCopies';
import { listBuiltinAdapterNames } from '../adapters/adapterDirs';
import { atomicWriteJson } from './projectIO';
import { createARSettings, createInitialDataFlow } from './defaults';

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

/**
 * 古い版のプロジェクトを開いたときに、レンダラへ返す「アップグレードの提案」。
 * ユーザーが承諾するまでファイルは書き換えない (Unity と同じ)。
 */
export interface PendingUpgrade {
  from: number;
  to: number;
  /** 適用した移行の id (i18n: ir.migration.<id>) */
  applied: string[];
  /** 実際に変わった項目 */
  changes: string[];
  /**
   * 拡張機能のデータの移行 (拡張機能を更新して、そのデータの形が新しくなったとき)。
   * IR 本体の版とは独立なので、from === to (本体は今の版) でもこれだけがあることがある。
   */
  extensions?: ExtensionDataUpgrade[];
}

export interface LoadProjectResult {
  success: boolean;
  project?: ArsistProject;
  error?: string;
  /** error === 'irTooNew' のときの詳細 */
  irVersion?: { found: number; supported: number };
  /**
   * error === 'requirementsMissing' のとき: このプロジェクトが使う拡張機能・端末のうち、
   * このエディタに無いもの。入れてから開き直す (エディタは開かない)。
   */
  missing?: MissingRequirement[];
  /** 古い版だったとき。メモリ上は移行済みだが、承諾されるまで保存できない */
  upgrade?: PendingUpgrade;
  /**
   * 読むときに起きたこと (project.json の写しを使った・書きかけの JSON を待っている・足りない項目を補った…)。
   * エディタはコンソールに出す。AI エージェントが JSON を直接書いたとき、何がどう読まれたかが分かるように。
   */
  notices?: string[];
}

// ========================================
// ProjectManager
// ========================================

export class ProjectManager {
  /** 保存したファイルとその中身を知らせる先 (ProjectWatcher.recordOwnWrite) */
  private writeObserver: ((file: string, text: string) => void) | null = null;

  setWriteObserver(observer: ((file: string, text: string) => void) | null): void {
    this.writeObserver = observer;
  }

  private currentProject: ArsistProject | null = null;
  private projectPath: string | null = null;
  /**
   * 古い版を開いていて、まだアップグレードを承諾されていない間 true。
   * この間は saveProject を断る。黙って新しい形で上書きすると、
   * 古いエディタに戻れなくなるうえ、何が変わったかも残らない。
   */
  private readOnly = false;
  /** シーン・UI の 2 つの写しを前回どう見たか (sceneCopies.ts)。プロジェクトが変わったら捨てる */
  private copiesSeen: { path: string; seen: Map<string, CopySeen> } | null = null;
  private pendingUpgrade: PendingUpgrade | null = null;

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
      await fs.ensureDir(path.join(projectDir, 'Scripts'));
      await fs.ensureDir(path.join(projectDir, 'Build'));

      const arSettings = createARSettings(options.template);
      const normalizedTarget = (options.targetDevice || '').toLowerCase();
      const isQuest = normalizedTarget.includes('quest') || normalizedTarget.includes('meta');

      const project: ArsistProject = {
        id: uuidv4(),
        name: options.name,
        version: '1.0.0',
        irVersion: CURRENT_IR_VERSION,
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
        dataFlow: createInitialDataFlow(),
        scenes: [],
        uiLayouts: [],
        models: [],
        extensions: {},
        storage: { persist: [] },
        buildSettings: {
          packageName: `com.arsist.${options.name.toLowerCase().replace(/\s+/g, '')}`,
          version: '1.0.0',
          versionCode: 1,
          minSdkVersion: isQuest ? 32 : 29,
          // Quest の要件は「target 32 以上」。ただし 32 ちょうどにしてはいけない:
          // Unity 同梱の Android SDK は platforms;android-32 を持っておらず
          // (Unity 6 は 34/35/36)、compileSdk として要求された時点で Gradle が
          // 「licences have not been accepted」で落ちる。要件を満たす最小ではなく、
          // Unity が実際に持っている 34 を既定にする。
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

      project.scenes.push(initialScene);
      project.uiLayouts.push(initialUI);

      // ファイル保存
      await fs.writeJSON(path.join(projectDir, 'project.json'), project, { spaces: 2 });
      await fs.writeJSON(path.join(projectDir, 'Scenes', `${initialScene.id}.json`), initialScene, { spaces: 2 });
      await fs.writeJSON(path.join(projectDir, 'UI', `${initialUI.id}.json`), initialUI, { spaces: 2 });

      this.currentProject = project;
      this.projectPath = projectDir;
      this.readOnly = false;
      this.pendingUpgrade = null;

      return { success: true, project };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /* ------------------------------------------------
   * 既存プロジェクトを読み込み
   *
   * 版の扱いは Unity と同じ:
   *   - 今の版より古い → メモリ上で移行して開き、`upgrade` を返す。
   *     ユーザーが upgradeProject() で承諾するまで読み取り専用 (保存を断る)。
   *   - 今の版より新しい → 開かない ('irTooNew')。壊すよりは断る方がよい。
   * ----------------------------------------------- */
  async loadProject(projectPath: string): Promise<LoadProjectResult> {
    try {
      const projectFile = path.join(projectPath, 'project.json');

      if (!(await fs.pathExists(projectFile))) {
        return { success: false, error: 'project.json not found' };
      }

      const rawText = await fs.readFile(projectFile, 'utf8');
      let raw: any;
      try {
        raw = JSON.parse(rawText);
      } catch (e) {
        // 書きかけ・書き間違い。どこが悪いかを行と桁で返す (エディタは今の中身のまま、直れば読み直す)
        return { success: false, error: `project.json: ${describeJsonError(rawText, e)}` };
      }

      let migration: MigrationOutcome;
      try {
        migration = migrateProject(raw);
      } catch (e) {
        if (e instanceof IrVersionError) {
          return { success: false, error: 'irTooNew', irVersion: { found: e.found, supported: e.supported } };
        }
        throw e;
      }
      const project = migration.project as ArsistProject;

      // このプロジェクトが使う拡張機能と端末が、このエディタに揃っているか。
      // IR は有効にした拡張機能を id で、端末をアダプタ名で持っているので、開く前に分かる。
      // 足りないまま開くと、拡張機能の設定が画面に出ないまま保存され、ビルドからも黙って外れる。
      const catalog = await getExtensionCatalog(true);
      const missing = checkProjectRequirements(
        project,
        catalog.extensions.map((e) => e.manifest),
        await listBuiltinAdapterNames(),
        CURRENT_IR_VERSION,
      );
      if (missing.length > 0) {
        return { success: false, error: 'requirementsMissing', missing };
      }

      let upgrade: PendingUpgrade | undefined = migration.from < migration.to
        ? { from: migration.from, to: migration.to, applied: migration.applied, changes: migration.changes }
        : undefined;

      // シーン、UIの詳細を読み込み (project.json の写しと個別ファイルのうち、変わった方を使う。sceneCopies.ts)
      const copies = await resolveSceneAndUiCopies(projectPath, project, {
        seen: this.copiesSeen && path.resolve(this.copiesSeen.path) === path.resolve(projectPath) ? this.copiesSeen.seen : undefined,
      });
      project.scenes = copies.scenes;
      project.uiLayouts = copies.uiLayouts;
      if (!Array.isArray(project.scripts)) project.scripts = [];

      // 拡張機能のデータ (extensions.<id> と物の ext.<id>)。拡張機能ごとの版で移行する。
      // シーンの物にも掛けるので、シーンを読んだ後。本体の IR と同じく、承諾までは書き戻さない。
      try {
        const ext = migrateExtensionData(project as unknown as Record<string, any>, catalog.extensions.map((e) => e.manifest));
        for (const problem of ext.problems) console.warn(`[Arsist] extension data: ${problem}`);
        if (ext.upgrades.length > 0) {
          upgrade = upgrade ?? { from: migration.to, to: migration.to, applied: [], changes: [] };
          upgrade.extensions = ext.upgrades;
        }
      } catch (e) {
        // 拡張機能の一覧が読めなくても、プロジェクト自体は開く (データには触れていない)
        console.warn(`[Arsist] extension data was not checked: ${(e as Error).message}`);
      }

      // Scripts ディレクトリが存在しない場合は作成 (読み取り専用で開くときは触らない)
      if (!upgrade) await fs.ensureDir(path.join(projectPath, 'Scripts'));

      this.currentProject = project;
      this.projectPath = projectPath;
      this.readOnly = upgrade !== undefined;
      this.pendingUpgrade = upgrade ?? null;
      this.copiesSeen = { path: projectPath, seen: copies.seen };

      // 外でどちらか一方の写しだけが書き換えられていたら、もう一方にも同じ中身を写して揃える。
      // 揃えないと、次にエージェントが古い方を読んで書き換え、今の編集を消してしまう。
      // 写すのはエージェントが書いた中身そのもの (補った値は入れない)。古い版のプロジェクト (承諾待ち) には書かない。
      if (!upgrade && copies.stale.length > 0) {
        try {
          const written = await syncStaleCopies(projectPath, copies.stale, async (file, data) => {
            const text = await atomicWriteJson(file, data);
            this.writeObserver?.(file, text);
          });
          for (const item of copies.stale) {
            const v = stableStringify(item.value);
            copies.seen.set(`${item.kind}:${item.id}`, { file: v, embedded: v, chosen: v });
          }
          if (written.length > 0) copies.notes.push(`made the two copies match again: wrote ${written.join(', ')}`);
        } catch (e) {
          copies.notes.push(`could not make the two copies match: ${(e as Error).message}`);
        }
      }

      return { success: true, project, upgrade, notices: copies.notes.length > 0 ? copies.notes : undefined };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /* ------------------------------------------------
   * 古い版のプロジェクトを今の版で書き戻す (ユーザーの承諾後)。
   *
   * 元の project.json は Backups/ に残す。移行は自動で戻せないので、
   * 古いエディタに戻りたくなったときの唯一の道がこれ。
   * ----------------------------------------------- */
  async upgradeProject(): Promise<{ success: boolean; error?: string; backupPath?: string }> {
    if (!this.currentProject || !this.projectPath) {
      return { success: false, error: 'No project loaded' };
    }
    const upgrade = this.pendingUpgrade;
    if (!upgrade) return { success: true };

    try {
      const projectFile = path.join(this.projectPath, 'project.json');
      const backupDir = path.join(this.projectPath, 'Backups');
      await fs.ensureDir(backupDir);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `project.v${upgrade.from}.${stamp}.json`);
      if (await fs.pathExists(projectFile)) await fs.copy(projectFile, backupPath);

      this.readOnly = false;
      this.pendingUpgrade = null;
      this.currentProject.irVersion = CURRENT_IR_VERSION;

      const saved = await this.saveProject({});
      if (!saved.success) {
        this.readOnly = true;
        this.pendingUpgrade = upgrade;
        return { success: false, error: saved.error };
      }
      return { success: true, backupPath };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** 読み取り専用で開いたままにする (アップグレードを見送る)。 */
  isReadOnly(): boolean {
    return this.readOnly;
  }

  getPendingUpgrade(): PendingUpgrade | null {
    return this.pendingUpgrade;
  }

  /* ------------------------------------------------
   * プロジェクトを保存
   * ----------------------------------------------- */
  async saveProject(data: Partial<ArsistProject>): Promise<{ success: boolean; error?: string }> {
    if (!this.currentProject || !this.projectPath) {
      return { success: false, error: 'No project loaded' };
    }
    if (this.readOnly) {
      // 古い版のまま。アップグレードを承諾するまで書き換えない。
      return { success: false, error: 'readOnly' };
    }

    try {
      Object.assign(this.currentProject, data);
      this.currentProject.updatedAt = new Date().toISOString();

      // 1 ファイルずつ「一時ファイル → 置き換え」で書く (途中で落ちても半端な JSON を残さない。
      // MCP のエージェントが同時に読んでも、書きかけを見ない)。書いた中身は監視役に知らせ、
      // 自分の保存を「外での変更」と取り違えないようにする。
      const save = async (file: string, data: unknown) => {
        const text = await atomicWriteJson(file, data);
        this.writeObserver?.(file, text);
      };

      // メインプロジェクトファイル保存
      await save(path.join(this.projectPath, 'project.json'), this.currentProject);

      // 各シーンを個別ファイルに保存
      for (const scene of this.currentProject.scenes) {
        await save(path.join(this.projectPath, 'Scenes', `${scene.id}.json`), scene);
      }

      // 各UIレイアウトを保存
      for (const ui of this.currentProject.uiLayouts) {
        await save(path.join(this.projectPath, 'UI', `${ui.id}.json`), ui);
      }
      // 2 つの写しは今同じ中身。次に外で変わったら、変わった方が分かる
      this.copiesSeen = { path: this.projectPath, seen: seenAfterSave(this.currentProject.scenes, this.currentProject.uiLayouts) };

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

      // スクリプトバンドル出力 (Jint用 JSON IR)
      const scriptBundle = {
        version: '1.0',
        scripts: (this.currentProject.scripts ?? [])
          .filter((sc) => sc.enabled)
          .map((sc) => ({ id: sc.id, trigger: sc.trigger, code: sc.code, enabled: sc.enabled })),
      };
      await fs.writeJSON(path.join(exportDir, 'scripts.json'), scriptBundle, { spaces: 2 });

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

  private generateUnityManifest(): object {
    if (!this.currentProject) return {};

    const { remoteInput, ...androidBuild } = this.currentProject.buildSettings as any;
    const scripts = this.currentProject.scripts ?? [];
    const hasActiveScripts = scripts.some((sc: any) => sc.enabled);

    return {
      projectId: this.currentProject.id,
      projectName: this.currentProject.name,
      version: this.currentProject.version,
      irVersion: this.currentProject.irVersion ?? CURRENT_IR_VERSION,
      appType: this.currentProject.appType,
      targetDevice: this.currentProject.targetDevice,
      arSettings: this.currentProject.arSettings,
      designSystem: this.currentProject.designSystem,
      dataFlow: this.currentProject.dataFlow,
      build: androidBuild,
      buildSettings: this.currentProject.buildSettings,
      remoteInput,
      scripting: {
        enabled: hasActiveScripts,
      },
      models: this.currentProject.models ?? [],
      exportedAt: new Date().toISOString(),
    };
  }
}
