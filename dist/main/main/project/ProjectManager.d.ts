import { ArsistProject, ProjectTemplate, UIAuthoringMode, UISyncMode } from '../../shared/types';
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
export declare class ProjectManager {
    private currentProject;
    private projectPath;
    /**
     * 新規プロジェクトを作成
     */
    createProject(options: CreateProjectOptions): Promise<{
        success: boolean;
        project?: ArsistProject;
        error?: string;
    }>;
    /**
     * 既存プロジェクトを読み込み
     */
    loadProject(projectPath: string): Promise<{
        success: boolean;
        project?: ArsistProject;
        error?: string;
    }>;
    /**
     * プロジェクトを保存
     */
    saveProject(data: Partial<ArsistProject>): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Unityビルド用にエクスポート
     */
    exportProject(options: ExportOptions): Promise<{
        success: boolean;
        outputPath?: string;
        error?: string;
    }>;
    /**
     * 現在のプロジェクトを取得
     */
    getCurrentProject(): ArsistProject | null;
    /**
     * プロジェクトパスを取得
     */
    getProjectPath(): string | null;
    private getAppTypeFromTemplate;
    private createInitialScene;
    private createInitialUI;
    private createInitialLogic;
    private loadScenes;
    private loadUILayouts;
    private loadLogicGraphs;
    private generateUnityManifest;
    private createARSettings;
    private createARSettingsFromAppType;
    private createUIAuthoring;
    private createInitialUICode;
    private createInitialUICodeFromAppType;
    private convertLogicToCode;
    private sanitizeClassName;
    /**
     * HTML断片からビルド用の完全なHTMLドキュメントを生成
     */
    private generateCompleteHTML;
}
//# sourceMappingURL=ProjectManager.d.ts.map