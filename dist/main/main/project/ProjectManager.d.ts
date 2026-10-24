import type { ArsistProject, ProjectTemplate } from '../../shared/types';
import { type ExtensionDataUpgrade, type MissingRequirement } from '../../shared/extensions';
export interface CreateProjectOptions {
    name: string;
    path: string;
    template: ProjectTemplate;
    targetDevice: string;
}
/**
 * format: 'unity' と 'json' は manifest.json、'yaml' は manifest.yaml。中身はどれもビルドが
 * Assets/ArsistGenerated/ に書くもの (UnityBridge.generateBuildManifest) と同じ。
 */
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
    irVersion?: {
        found: number;
        supported: number;
    };
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
export declare class ProjectManager {
    /** 保存したファイルとその中身を知らせる先 (ProjectWatcher.recordOwnWrite) */
    private writeObserver;
    setWriteObserver(observer: ((file: string, text: string) => void) | null): void;
    private currentProject;
    private projectPath;
    /**
     * 古い版を開いていて、まだアップグレードを承諾されていない間 true。
     * この間は saveProject を断る。黙って新しい形で上書きすると、
     * 古いエディタに戻れなくなるうえ、何が変わったかも残らない。
     */
    private readOnly;
    /** シーン・UI の 2 つの写しを前回どう見たか (sceneCopies.ts)。プロジェクトが変わったら捨てる */
    private copiesSeen;
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
}
//# sourceMappingURL=ProjectManager.d.ts.map