/**
 * 「描き終わった」の合図。読み込み中のもの (VRM) を数え、0 になってから数フレーム描いたら ready。
 */
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';

let pending = 0;
const listeners = new Set<() => void>();

export function beginLoad(): () => void {
  pending++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending--;
    listeners.forEach((l) => l());
  };
}

export function pendingLoads(): number {
  return pending;
}

/** Canvas の中に置く。読み込みが無くなってから `frames` フレーム描いたら onReady を 1 度だけ呼ぶ。 */
export function ReadyGate({ onReady, frames = 4 }: { onReady: () => void; frames?: number }) {
  const count = useRef(0);
  const fired = useRef(false);
  useEffect(() => () => { fired.current = true; }, []);
  useFrame(() => {
    if (fired.current) return;
    if (pending > 0) { count.current = 0; return; }
    if (++count.current >= frames) {
      fired.current = true;
      onReady();
    }
  });
  return null;
}
