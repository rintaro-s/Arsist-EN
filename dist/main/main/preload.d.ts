declare const electronAPI: {
    project: {
        create: (options: any) => Promise<any>;
        load: (projectPath: string) => Promise<any>;
        save: (data: any) => Promise<any>;
        export: (options: any) => Promise<any>;
    };
    unity: {
        setPath: (unityPath: string) => Promise<any>;
        getPath: () => Promise<any>;
        build: (config: any) => Promise<any>;
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
        xrealStatus: () => Promise<any>;
        questStatus: () => Promise<any>;
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