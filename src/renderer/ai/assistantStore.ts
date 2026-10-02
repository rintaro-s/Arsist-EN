/**
 * 内蔵 AI アシスタントの会話 (画面の表示用)。欄を閉じても消えないように、コンポーネントの外に置く。
 * 会話の中身 (API に送る履歴) は main が持っている (src/main/agent/assistant.ts)。ここは見せ方だけ。
 */
import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { AssistantEvent } from './types';

export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; ok?: boolean; summary?: string }
  | { kind: 'error'; text: string }
  | { kind: 'info'; text: string }
  | { kind: 'undo'; snapshotId: string; done?: boolean };

interface AssistantState {
  conversationId: string;
  items: ChatItem[];
  running: boolean;
  step: number;
  /** この依頼の前の写し (元に戻す用) */
  pendingSnapshot: string | null;
  add: (item: ChatItem) => void;
  apply: (event: AssistantEvent) => { changed: boolean } | null;
  start: () => void;
  markUndone: (snapshotId: string) => void;
  newConversation: () => string;
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  conversationId: uuidv4(),
  items: [],
  running: false,
  step: 0,
  pendingSnapshot: null,

  add: (item) => set((s) => ({ items: [...s.items, item] })),

  start: () => set({ running: true, step: 0, pendingSnapshot: null }),

  apply: (event) => {
    switch (event.type) {
      case 'thinking':
        set({ step: event.step });
        return null;
      case 'tool-call':
        set((s) => ({ items: [...s.items, { kind: 'tool', id: event.id, name: event.name }] }));
        return null;
      case 'tool-result':
        set((s) => ({
          items: s.items.map((it) => (it.kind === 'tool' && it.id === event.id ? { ...it, ok: event.ok, summary: event.summary } : it)),
        }));
        return null;
      case 'snapshot':
        set({ pendingSnapshot: event.snapshotId });
        return null;
      case 'message':
        set((s) => ({ items: [...s.items, { kind: 'assistant', text: event.content }] }));
        return null;
      case 'error':
        set((s) => ({ items: [...s.items, { kind: 'error', text: event.message }] }));
        return null;
      case 'done': {
        const snapshot = get().pendingSnapshot;
        set((s) => ({
          running: false,
          items: event.changed && snapshot ? [...s.items, { kind: 'undo', snapshotId: snapshot }] : s.items,
          pendingSnapshot: null,
        }));
        return { changed: event.changed };
      }
      default:
        return null;
    }
  },

  markUndone: (snapshotId) => set((s) => ({
    items: s.items.map((it) => (it.kind === 'undo' && it.snapshotId === snapshotId ? { ...it, done: true } : it)),
  })),

  newConversation: () => {
    const id = uuidv4();
    set({ conversationId: id, items: [], running: false, step: 0, pendingSnapshot: null });
    return id;
  },
}));
