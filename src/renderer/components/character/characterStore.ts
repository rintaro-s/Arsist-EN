/**
 * キャラクターの動きの一覧 (Assets/Animations/*.fbx) と、3D ビューで試しに流している動き。
 *
 * 一覧はインスペクタと 3D ビューの両方が読むので、ここで 1 回だけ取りに行く。
 * 名前 = ファイル名 (拡張子なし) = スクリプトの vrm.playAnimation の名前 = 物の character.animation。
 */
import { create } from 'zustand';

export interface AnimationItem {
  name: string;
  assetPath: string;
  bytes: number;
}

interface CharacterState {
  projectPath: string | null;
  animations: AnimationItem[];
  loading: boolean;
  /**
   * インスペクタの ▶ / ■ で選んだもの (その物だけ)。name が null なら止めている。
   * preview が無ければ、選んでいる物の「最初の動き」を流す。
   */
  preview: { objectId: string; name: string | null } | null;
  reload: (projectPath: string | null) => Promise<void>;
  playPreview: (objectId: string, name: string) => void;
  stopPreview: (objectId: string) => void;
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  projectPath: null,
  animations: [],
  loading: false,
  preview: null,
  reload: async (projectPath) => {
    if (!projectPath) { set({ projectPath: null, animations: [] }); return; }
    set({ loading: true, projectPath });
    try {
      const r = await window.electronAPI?.animations?.list({ projectPath });
      if (get().projectPath === projectPath) set({ animations: r?.success ? r.animations : [] });
    } finally {
      set({ loading: false });
    }
  },
  playPreview: (objectId, name) => set({ preview: { objectId, name } }),
  stopPreview: (objectId) => set({ preview: { objectId, name: null } }),
}));

/** 3D ビューでこの物に流す動きの名前。選んでいなければ流さない (位置合わせの邪魔にならないように) */
export function previewAnimationFor(
  preview: CharacterState['preview'],
  objectId: string,
  isSelected: boolean,
  startAnimation: string | undefined,
): string | null {
  if (!isSelected) return null;
  if (preview && preview.objectId === objectId) return preview.name;
  return startAnimation || null;
}
