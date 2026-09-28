/**
 * モデルタブの揮発的な状態 (IR には入らない)。
 * 画像処理エディタなど他の画面から「このモデルを開く」ときにも使う。
 */
import { create } from 'zustand';

interface ModelsViewState {
  selectedId: string | null;
  /** 取り込んだ直後の注意 (モデル id → 警告コード) */
  warnings: Record<string, string[]>;
  select: (id: string | null) => void;
  setWarnings: (id: string, warnings: string[]) => void;
}

export const useModelsStore = create<ModelsViewState>((set) => ({
  selectedId: null,
  warnings: {},
  select: (selectedId) => set({ selectedId }),
  setWarnings: (id, warnings) => set((state) => ({ warnings: { ...state.warnings, [id]: warnings } })),
}));
