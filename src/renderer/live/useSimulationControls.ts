/**
 * Arsist Engine — シミュレーション視点の操作
 *
 * 実機に繋がずPC上で「どう見えるか」を確かめるとき、仮想の視点を動かす操作を提供する。
 *   ドラッグ    : 見回す
 *   W/A/S/D    : 前後左右移動（視線方向基準）
 *   Q/E        : 下降 / 上昇
 *   Shift      : 高速移動
 *
 * 実機接続中（enabled=false）は何もしない。実機の姿勢はユーザーの頭が決めるものなので、
 * エディタ側から勝手に動かすことはしない。
 */
import { useEffect, useRef } from 'react';
import { useLiveStore } from './liveStore';
import { forwardFromYawPitch } from './useLiveScene';

const MOVE_SPEED = 1.6; // m/s
const FAST_MULTIPLIER = 3;
const LOOK_SENSITIVITY = 0.22; // deg / px
const PITCH_LIMIT = 89;

export function useSimulationControls(
  targetRef: React.RefObject<HTMLElement>,
  enabled: boolean,
): void {
  const setSimulatedPose = useLiveStore((s) => s.setSimulatedPose);
  const keys = useRef<Set<string>>(new Set());
  const dragging = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = targetRef.current;
    if (!el || !enabled) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging.current = true;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current || !lastPointer.current) return;
      const dx = e.clientX - lastPointer.current.x;
      const dy = e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };

      const pose = useLiveStore.getState().simulatedPose;
      setSimulatedPose({
        ...pose,
        yaw: pose.yaw + dx * LOOK_SENSITIVITY,
        pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pose.pitch + dy * LOOK_SENSITIVITY)),
      });
    };

    const endDrag = (e: PointerEvent) => {
      dragging.current = false;
      lastPointer.current = null;
      el.releasePointerCapture?.(e.pointerId);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      keys.current.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const onBlur = () => keys.current.clear();

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    let raf = 0;
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      if (keys.current.size > 0) {
        const pose = useLiveStore.getState().simulatedPose;
        const forward = forwardFromYawPitch(pose.yaw, pose.pitch);
        // 水平移動は視線の水平成分を使う（上を向いていても前進で浮き上がらない）
        const flatLen = Math.hypot(forward.x, forward.z) || 1;
        const fx = forward.x / flatLen;
        const fz = forward.z / flatLen;
        // 右方向 = up × forward (Unityと同じ左手系での右)
        const rx = fz;
        const rz = -fx;

        const fast = keys.current.has('shift') ? FAST_MULTIPLIER : 1;
        const d = MOVE_SPEED * fast * dt;
        let { x, y, z } = pose.position;

        if (keys.current.has('w')) { x += fx * d; z += fz * d; }
        if (keys.current.has('s')) { x -= fx * d; z -= fz * d; }
        if (keys.current.has('a')) { x -= rx * d; z -= rz * d; }
        if (keys.current.has('d')) { x += rx * d; z += rz * d; }
        if (keys.current.has('e')) { y += d; }
        if (keys.current.has('q')) { y -= d; }

        if (x !== pose.position.x || y !== pose.position.y || z !== pose.position.z) {
          setSimulatedPose({ ...pose, position: { x, y, z } });
        }
      }

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      cancelAnimationFrame(raf);
      keys.current.clear();
    };
  }, [targetRef, enabled, setSimulatedPose]);
}
