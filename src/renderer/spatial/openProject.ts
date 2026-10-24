/**
 * フォルダを開く: Virtual (project.json) か Spatial (project.spatial.json) かを main に訊いて、合う画面で開く。
 * ようこそ画面・メニューの「開く」・最近のプロジェクトがすべてここを通る。
 */
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import { detectProjectKind, spatialApi } from './api';
import { useSpatialStore } from './store';

export interface OpenOutcome {
  kind: 'virtual' | 'spatial';
  ok: boolean;
  /** i18n のキーと値 (Spatial を開けなかったとき) */
  error?: { key: string; params?: Record<string, string | number> };
}

export async function openProjectFolder(path: string): Promise<OpenOutcome> {
  const info = await detectProjectKind(path);
  if (info.kind === 'spatial') {
    const api = spatialApi();
    if (!api) return { kind: 'spatial', ok: false, error: { key: 'spatial.status.noBridge' } };
    try {
      const result = await api.load(path);
      if (!result.success || !result.project) {
        const error = result.tooNew
          ? { key: 'spatial.status.tooNew' }
          : { key: 'spatial.status.loadFailed', params: { error: result.error ?? '' } };
        useUIStore.getState().addNotification({ type: 'error', message: `${path}: ${result.error ?? 'load failed'}` });
        return { kind: 'spatial', ok: false, error };
      }
      // 開いている Virtual は閉じる (2 つの画面を同時には出さない)
      if (useProjectStore.getState().project) useProjectStore.getState().closeProject();
      useSpatialStore.getState().open(result.project, result.path ?? path);
      for (const notice of result.notices ?? []) console.info(`[Layster] ${notice}`);
      return { kind: 'spatial', ok: true };
    } catch (e) {
      return { kind: 'spatial', ok: false, error: { key: 'spatial.status.loadFailed', params: { error: (e as Error).message } } };
    }
  }
  useSpatialStore.getState().close();
  await useProjectStore.getState().loadProject(path);
  return { kind: 'virtual', ok: !!useProjectStore.getState().project };
}
