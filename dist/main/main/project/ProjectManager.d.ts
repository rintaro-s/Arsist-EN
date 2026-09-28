import type { ArsistProject, ProjectTemplate } from '../../shared/types';
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
}
export interface LoadProjectResult {
    success: boolean;
    project?: ArsistProject;
    error?: string;
    /** error === 'irTooNew' のときの詳細 */
    irVersion?: {
        found: number;
        supported: number;
    };
    /** 古い版だったとき。メモリ上は移行済みだが、承諾されるまで保存できない */
    upgrade?: PendingUpgrade;
}
export declare class ProjectManager {
    private currentProject;
    private projectPath;
    /**
     * 古い版を開いていて、まだアップグレードを承諾されていない間 true。
     * この間は saveProject を断る。黙って新しい形で上書きすると、
     * 古いエディタに戻れなくなるうえ、何が変わったかも残らない。
     */
    private readOnly;
    private pendingUpgrade;
    createProject(options: CreateProjectOptions): Promise<{
        success: boolean;
        project?: ArsistProject;
        error?: string;
    }>;
    loadProject(projectPath: string): Promise<LoadProjectResult>;
    upgradeProject(): Promise<{
        success: boolean;
        error?: string;
        backupPath?: string;
    }>;
    /** 読み取り専用で開いたままにする (アップグレードを見送る)。 */
    isReadOnly(): boolean;
    getPendingUpgrade(): PendingUpgrade | null;
    saveProject(data: Partial<ArsistProject>): Promise<{
        success: boolean;
        error?: string;
    }>;
    exportProject(options: ExportOptions): Promise<{
        success: boolean;
        outputPath?: string;
        error?: string;
    }>;
    getCurrentProject(): ArsistProject | null;
    getProjectPath(): string | null;
    private createInitialScene;
    private createInitialUI;
    private loadScenes;
    private loadUILayouts;
    private generateUnityManifest;
}
//# sourceMappingURL=ProjectManager.d.ts.map