/**
 * Layster.Spatial — main への型付きの呼び口 (src/shared/layster/spatial/ipc.ts の約束どおり)。
 *
 * main 側 (src/main/layster/) が preload で window.electronAPI.spatial を出す。
 * 出ていない (古い main・ブラウザだけで開いた) ときは undefined を返し、画面は「保存できない」と出す。
 */
import type {
  ImportAssetRequest, ImportAssetResult, ProjectKindInfo, SecretsRequest, SecretsResult, SpatialBuildRequest,
  SpatialBuildResult, SpatialCreateRequest, SpatialLoadResult, SpatialSpacesResult, TryMindRequest, TryMindResult,
} from '../../shared/layster/spatial/ipc';
import type { SpaceFixture, SpatialProject } from '../../shared/layster/spatial/types';

export interface SpatialBridge {
  detect(dir: string): Promise<ProjectKindInfo>;
  create(request: SpatialCreateRequest): Promise<SpatialLoadResult>;
  load(dir: string): Promise<SpatialLoadResult>;
  save(project: SpatialProject): Promise<{ success: boolean; error?: string }>;
  spaces(): Promise<SpatialSpacesResult>;
  saveSpace(space: SpaceFixture): Promise<{ success: boolean; error?: string }>;
  tryMind(request: TryMindRequest): Promise<TryMindResult>;
  secrets(request: SecretsRequest): Promise<SecretsResult>;
  importAsset(request: ImportAssetRequest): Promise<ImportAssetResult>;
  build(request: SpatialBuildRequest): Promise<SpatialBuildResult>;
  onChanged(callback: (payload: { path?: string }) => void): () => void;
}

export function spatialApi(): SpatialBridge | undefined {
  return (window as unknown as { electronAPI?: { spatial?: SpatialBridge } }).electronAPI?.spatial;
}

/** フォルダが何のプロジェクトか。main が古くて分からないときは 'virtual' とみなす (今までどおり開く)。 */
export async function detectProjectKind(dir: string): Promise<ProjectKindInfo> {
  const api = spatialApi();
  if (!api) return { kind: 'virtual' };
  try {
    return await api.detect(dir);
  } catch {
    return { kind: 'virtual' };
  }
}
