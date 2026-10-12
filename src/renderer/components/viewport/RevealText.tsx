/**
 * 「書いていくように出す」(UIElement.reveal、IR v5) のプレビュー。
 *
 * 実機と同じく、文字が変わるたび (と、インスペクタの「もう一度」) に先頭から 1 文字ずつ出す。
 * 残りは透明で場所を取っておく (書いている途中で枠の大きさが変わらないように。実機の TextMeshPro も同じ)。
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { TextReveal } from '../../../shared/types';

interface RevealReplayState {
  /** 要素 id → 何回目の「もう一度」か */
  nonce: Record<string, number>;
  replay: (elementId: string) => void;
}

export const useRevealReplay = create<RevealReplayState>((set) => ({
  nonce: {},
  replay: (elementId) => set((s) => ({ nonce: { ...s.nonce, [elementId]: (s.nonce[elementId] ?? 0) + 1 } })),
}));

export function RevealText({ elementId, text, reveal }: { elementId: string; text: string; reveal?: TextReveal }) {
  const nonce = useRevealReplay((s) => s.nonce[elementId] ?? 0);
  const chars = Array.from(text);
  const speed = reveal && reveal.speed > 0 ? reveal.speed : 0;
  const [shown, setShown] = useState(speed ? 0 : chars.length);

  useEffect(() => {
    if (!speed) { setShown(chars.length); return; }
    setShown(0);
    const startedAt = performance.now();
    let frame = 0;
    const tick = () => {
      const n = Math.min(chars.length, Math.floor(((performance.now() - startedAt) / 1000) * speed));
      setShown(n);
      if (n < chars.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, speed, nonce]);

  if (!speed) return <>{text}</>;
  return (
    <>
      {chars.slice(0, shown).join('')}
      <span style={{ opacity: 0 }} data-arsist-reveal-rest>{chars.slice(shown).join('')}</span>
    </>
  );
}
