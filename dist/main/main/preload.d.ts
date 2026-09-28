declare const electronAPI: {
    project: {
        create: (options: any) => Promise<any>;
        load: (projectPath: string) => Promise<any>;
        save: (data: any) => Promise<any>;
        export: (options: any) => Promise<any>;
        /** 古い版の IR を今の版で書き戻す (承諾後)。元のファイルは Backups/ に残る */
        upgrade: () => Promise<any>;
    };
    model: {
        /** ファイル選択 → Assets/Models へコピー → 入出力を読んで定義の下書きを返す */
        import: (projectPath: string, sourcePath?: string) => Promise<any>;
        inspect: (projectPath: string, file: string) => Promise<any>;
        readLabels: (path?: string) => Promise<any>;
        /** 文章のモデルの tokenizer.json を取り込む (隣の tokenizer_config.json なども読む) */
        importTokenizer: (projectPath: string, modelName?: string, sourcePath?: string) => Promise<any>;
        /** Hugging Face のリポジトリにある ONNX の候補 (精度違い) を読む */
        hfInspect: (repo: string) => Promise<any>;
        /** 選んだ 1 本を落として取り込む。進み具合は onHfProgress に届く */
        hfImport: (runId: string, repo: string, variantPath: string, projectPath?: string, name?: string) => Promise<any>;
        hfCancel: (runId: string) => Promise<any>;
        onHfProgress: (callback: (payload: {
            runId: string;
            progress: any;
        }) => void) => () => void;
        /** 「試す」: 実機と同じ C# を ONNX Runtime で動かす。途中経過は onTryLine に届く */
        try: (runId: string, projectPath: string | undefined, request: unknown) => Promise<any>;
        cancelTry: (runId: string) => Promise<any>;
        onTryLine: (callback: (payload: {
            runId: string;
            line: any;
        }) => void) => () => void;
    };
    vision: {
        /** パイプラインを1枚の画像に流し、各ステップの結果を返す */
        preview: (pipeline: unknown, image: {
            width: number;
            height: number;
            rgba: Uint8Array;
        }, options?: {
            models?: unknown[];
            projectPath?: string;
            frames?: Array<{
                width: number;
                height: number;
                rgba: Uint8Array;
            }>;
            focus?: number;
            fps?: number;
            probe?: {
                index: number;
                ops: unknown[];
            };
        }) => Promise<any>;
    };
    device: {
        /** つながっている端末を並べる */
        list: () => Promise<any>;
        /** ビルドした APK を入れる */
        install: (serial: string, apkPath: string) => Promise<any>;
        onInstallLog: (callback: (line: string) => void) => () => void;
    };
    unity: {
        setPath: (unityPath: string) => Promise<any>;
        getPath: () => Promise<any>;
        /** Android ビルドに使える Gradle のパス。無ければ null */
        detectGradle: () => Promise<any>;
        build: (config: any) => Promise<any>;
        cancelBuild: () => Promise<any>;
        validate: () => Promise<any>;
        detectPaths: () => Promise<any>;
        onBuildProgress: (callback: (progress: any) => void) => () => void;
        onBuildLog: (callback: (log: string) => void) => () => void;
    };
    adapters: {
        list: () => Promise<any>;
        get: (adapterId: string) => Promise<any>;
        applyPatch: (adapterId: string, projectPath: string) => Promise<any>;
    };
    fs: {
        readFile: (filePath: string) => Promise<any>;
        writeFile: (filePath: string, content: string) => Promise<any>;
        selectDirectory: () => Promise<any>;
        selectFile: (filters?: any[]) => Promise<any>;
        exists: (filePath: string) => Promise<any>;
    };
    sdk: {
        getDir: () => Promise<any>;
        setDir: (sdkDir: string) => Promise<any>;
        xrealStatus: () => Promise<any>;
        questStatus: () => Promise<any>;
        bundledDeps: () => Promise<any>;
    };
    assets: {
        import: (params: {
            projectPath: string;
            sourcePath: string;
            kind?: "model" | "texture" | "video" | "other";
        }) => Promise<any>;
        list: (params: {
            projectPath: string;
        }) => Promise<any>;
    };
    store: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<any>;
    };
    mcp: {
        start: (projectPath: string) => Promise<any>;
        stop: () => Promise<any>;
        getStatus: () => Promise<any>;
        getClientConfig: () => Promise<any>;
    };
    window: {
        minimize: () => Promise<any>;
        maximize: () => Promise<any>;
        close: () => Promise<any>;
    };
    app: {
        setLanguage: (lang: "en" | "ja") => Promise<any>;
    };
    menu: {
        onNewProject: (callback: () => void) => void;
        onSave: (callback: () => void) => void;
        onSaveAs: (callback: () => void) => void;
        onBuildSettings: (callback: () => void) => void;
        onBuild: (callback: () => void) => void;
        onSettings: (callback: () => void) => void;
        onDelete: (callback: () => void) => void;
        onViewChange: (callback: (view: string) => void) => void;
        onProjectOpen: (callback: (path: string) => void) => void;
    };
};
export type ElectronAPI = typeof electronAPI;
export {};
//# sourceMappingURL=preload.d.ts.map