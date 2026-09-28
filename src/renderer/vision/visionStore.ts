/**
 * 画像処理エディタの揮発的な状態 (プロジェクト IR には入らないもの)。
 *
 * 試す素材、見ているフレーム、選んでいる一手、ステージの表示の仕方。
 * プロジェクトを閉じても困らないものだけをここに置く。
 */
import { create } from 'zustand';
import type { TestMedia } from './testMedia';

export type VisionSelection = { kind: 'source' } | { kind: 'op'; id: string } | { kind: 'outputs' };

export type StageMode = 'overlay' | 'raw';

/** 画をクリックして何を決めるか。 */
export type PickMode = 'none' | 'color' | 'brightness' | 'rect';

interface VisionEditorState {
  media: TestMedia | null;
  focus: number;
  selection: VisionSelection;
  /** overlay = 元の画に重ねて見せる, raw = その一手の結果そのもの */
  stageMode: StageMode;
  /** 元の画と結果の比較スライダー (0 = 元, 1 = 結果) */
  compare: number;
  /** 時間軸で自動再生しているか */
  playing: boolean;
  /** 実機の画を一定間隔で取り込み続ける */
  deviceLive: boolean;
  /** 画をクリックして設定する (色を拾う / 明るさを拾う / 見る枠を描く) */
  pickMode: PickMode;

  setMedia: (media: TestMedia | null) => void;
  appendFrame: (frame: TestMedia['frames'][number], name?: string, precropped?: boolean) => void;
  setFocus: (index: number) => void;
  stepFocus: (delta: number) => void;
  select: (selection: VisionSelection) => void;
  setStageMode: (mode: StageMode) => void;
  setCompare: (value: number) => void;
  setPlaying: (playing: boolean) => void;
  setDeviceLive: (live: boolean) => void;
  setPickMode: (mode: PickMode) => void;
}

export const useVisionStore = create<VisionEditorState>((set, get) => ({
  media: null,
  focus: 0,
  selection: { kind: 'source' },
  stageMode: 'overlay',
  compare: 1,
  playing: false,
  deviceLive: false,
  pickMode: 'none',

  setMedia: (media) => set({ media, focus: media ? media.frames.length - 1 : 0, playing: false }),

  appendFrame: (frame, name, precropped) => {
    const { media } = get();
    // 実機からの取り込みは「連続したフレーム」として溜める (最大 40)。他の素材からは切り替える。
    if (media && media.kind === 'device') {
      const frames = [...media.frames, frame].slice(-40);
      set({ media: { ...media, frames }, focus: frames.length - 1 });
    } else {
      set({ media: { kind: 'device', name: name ?? 'device', frames: [frame], fps: 1, precropped: precropped ?? true }, focus: 0 });
    }
  },

  setFocus: (index) => {
    const { media } = get();
    if (!media) return;
    set({ focus: Math.max(0, Math.min(media.frames.length - 1, index)) });
  },

  stepFocus: (delta) => {
    const { media, focus } = get();
    if (!media) return;
    const next = (focus + delta + media.frames.length) % media.frames.length;
    set({ focus: next });
  },

  select: (selection) => set({ selection, pickMode: 'none' }),
  setPickMode: (pickMode) => set({ pickMode }),
  setStageMode: (stageMode) => set({ stageMode }),
  setCompare: (compare) => set({ compare: Math.max(0, Math.min(1, compare)) }),
  setPlaying: (playing) => set({ playing }),
  setDeviceLive: (deviceLive) => set({ deviceLive }),
}));
