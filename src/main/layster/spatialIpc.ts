/**
 * Layster.Spatial のエディタと main の間 (SPATIAL_IPC、src/shared/layster/spatial/ipc.ts)。
 *
 * main.ts は registerSpatialIpc を 1 回呼ぶだけ。ビルドは Virtual の 'unity:build' と同じ道
 * (deps.runUnityBuild。進み具合とログも同じ 'unity:build-progress' / 'unity:build-log' で届く) を通る。
 */
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ipcMain, dialog, type BrowserWindow } from 'electron';
import { SPATIAL_IPC } from '../../shared/layster/spatial/ipc';
import type {
  ImportAssetRequest, ImportAssetResult, SecretsRequest, SecretsResult, SpatialBuildRequest, SpatialBuildResult,
  SpatialCreateRequest, SpatialLoadResult, SpatialSpacesResult, TryMindRequest, TryMindResult,
} from '../../shared/layster/spatial/ipc';
import type { SpaceFixture, SpatialProject } from '../../shared/layster/spatial/types';
import { BUILTIN_SPACES } from '../../shared/layster/spatial/spaces';
import { validateSpatialProject } from '../../shared/layster/spatial/validate';
import { LowerError, lowerSpatialProject } from '../../shared/layster/spatial/lower';
import type { UnityBuildConfig } from '../unity/UnityBuilder';
import { detectProjectKind } from './projectKind';
import {
  ASSET_KINDS, createSpatialProjectOnDisk, importSpatialAsset, listProjectSpaces, loadSpatialProject, readSecrets,
  readSpatialProject, saveProjectSpace, saveSpatialProject, setSecret, setSpatialWriteObserver,
} from './SpatialProjectManager';
import { SpatialWatcher } from './spatialWatcher';
import { callMind } from './mindClient';

export interface SpatialIpcDeps {
  getWindow(): BrowserWindow | null;
  addRecent(projectPath: string): void;
  /** 'unity:build' と同じビルド (Unity のパス・sdk・拡張機能の置き場・進み具合の通知はそちらで決める) */
  runUnityBuild(config: UnityBuildConfig): Promise<{ success: boolean; outputPath?: string; error?: string; warnings?: string[] }>;
  /** ビルドのログ 1 行 (エディタのビルドのログ欄に出る) */
  buildLog(line: string): void;
  /** electron-store の値 (unityManualLicenseFile など) */
  getSetting(key: string): unknown;
}

/** 今開いている Spatial のプロジェクトのフォルダ (無ければ null)。 */
let currentDir: string | null = null;
let watcher: SpatialWatcher | null = null;

export function currentSpatialProjectDir(): string | null {
  return currentDir;
}

export function closeSpatialWatcher(): void {
  watcher?.close();
}

function requireDir(): string {
  if (!currentDir) throw new Error('no Layster.Spatial project is open');
  return currentDir;
}

export function registerSpatialIpc(deps: SpatialIpcDeps): void {
  watcher = new SpatialWatcher((projectPath, files) => {
    deps.getWindow()?.webContents.send(SPATIAL_IPC.changed, { projectPath, files });
  });
  setSpatialWriteObserver((file, text) => watcher?.recordOwnWrite(file, text));

  const opened = (dir: string) => {
    currentDir = dir;
    deps.addRecent(dir);
    watcher?.watch(dir);
  };

  ipcMain.handle(SPATIAL_IPC.detect, async (_e, dir: string) => detectProjectKind(dir));

  ipcMain.handle(SPATIAL_IPC.create, async (_e, req: SpatialCreateRequest): Promise<SpatialLoadResult> => {
    try {
      const { project, path: dir } = await createSpatialProjectOnDisk(req, randomUUID());
      opened(dir);
      return { success: true, project, path: dir };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(SPATIAL_IPC.load, async (_e, dir: string): Promise<SpatialLoadResult> => {
    const res = await loadSpatialProject(dir);
    if (res.success) opened(dir);
    return res;
  });

  ipcMain.handle(SPATIAL_IPC.save, async (_e, project: SpatialProject): Promise<{ success: boolean; error?: string }> => {
    try {
      await saveSpatialProject(requireDir(), project);
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(SPATIAL_IPC.spaces, async (): Promise<SpatialSpacesResult> => ({
    builtin: [...BUILTIN_SPACES],
    project: currentDir ? await listProjectSpaces(currentDir) : [],
  }));

  ipcMain.handle(SPATIAL_IPC.saveSpace, async (_e, fixture: SpaceFixture): Promise<{ success: boolean; error?: string }> => {
    try {
      await saveProjectSpace(requireDir(), fixture);
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(SPATIAL_IPC.tryMind, async (_e, req: TryMindRequest): Promise<TryMindResult> => {
    const secrets = currentDir ? await readSecrets(currentDir) : {};
    return callMind(req.mind, req.request, { edge: req.edge, secrets });
  });

  ipcMain.handle(SPATIAL_IPC.secrets, async (_e, req: SecretsRequest): Promise<SecretsResult> => {
    try {
      const dir = requireDir();
      if (req?.op === 'set') return { success: true, names: await setSecret(dir, req.name, req.value) };
      if (req?.op === 'remove') return { success: true, names: await setSecret(dir, req.name, null) };
      return { success: true, names: Object.keys(await readSecrets(dir)).sort() };
    } catch (e) {
      return { success: false, names: [], error: (e as Error).message };
    }
  });

  ipcMain.handle(SPATIAL_IPC.importAsset, async (_e, req: ImportAssetRequest): Promise<ImportAssetResult> => {
    try {
      const dir = requireDir();
      const spec = ASSET_KINDS[req?.kind];
      if (!spec) return { success: false, error: `unknown asset kind: ${req?.kind}` };
      let source = req.sourcePath;
      if (!source) {
        const win = deps.getWindow();
        const options = {
          properties: ['openFile' as const],
          filters: [{ name: req.kind, extensions: spec.extensions.map((x) => x.slice(1)) }],
        };
        const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
        if (picked.canceled || picked.filePaths.length === 0) return { success: false, cancelled: true };
        source = picked.filePaths[0];
      }
      return await importSpatialAsset(dir, req.kind, source);
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(SPATIAL_IPC.build, async (_e, req: SpatialBuildRequest): Promise<SpatialBuildResult> => {
    try {
      const dir = requireDir();
      // ビルドするのは保存してあるもの (エディタはビルドの前に保存する。Virtual と同じ)
      const { project } = await readSpatialProject(dir);
      const problems = validateSpatialProject(project);
      const errors = problems.filter((p) => p.level === 'error');
      for (const p of problems) deps.buildLog(`[Layster] ${p.level === 'error' ? 'ERROR' : 'WARNING'}: ${p.path}: ${p.message.en}`);
      if (errors.length > 0) {
        return { success: false, error: `${errors.length} problem(s) stop the build`, problems: errors };
      }
      const lowered = lowerSpatialProject(project, { secrets: await readSecrets(dir), targetDevice: req.targetDevice });
      for (const w of lowered.warnings) deps.buildLog(`[Layster] WARNING: ${w}`);
      for (const name of lowered.bakedSecrets) {
        deps.buildLog(`[Layster] WARNING: the key "${name}" is baked into the APK (anyone with the APK can read it)`);
      }
      deps.buildLog(`[Layster] Spatial build: ${lowered.spatialData.things.length} thing(s), ${lowered.spatialData.minds.length} mind(s), ${lowered.spatialData.bodies.length} body(ies), ${lowered.spatialData.rules.length} rule(s)`);
      const manual = deps.getSetting('unityManualLicenseFile');
      const result = await deps.runUnityBuild({
        projectPath: path.join(req.outputPath, 'TempUnityProject'),
        sourceProjectPath: dir,
        outputPath: req.outputPath,
        targetDevice: req.targetDevice || project.targetDevice,
        buildTarget: 'Android',
        developmentBuild: !!req.developmentBuild,
        cleanBuild: !!req.cleanBuild,
        manualLicenseFile: typeof manual === 'string' && manual ? manual : undefined,
        manifestData: lowered.manifestData,
        scenesData: lowered.scenesData,
        uiData: lowered.uiData,
        scriptsData: lowered.scriptsData,
        spatialData: lowered.spatialData,
      });
      return {
        success: result.success,
        outputPath: result.outputPath,
        error: result.error,
        warnings: [...lowered.warnings, ...(result.warnings ?? [])],
      };
    } catch (e) {
      const message = e instanceof LowerError ? e.message : (e as Error).message;
      return { success: false, error: message };
    }
  });
}
