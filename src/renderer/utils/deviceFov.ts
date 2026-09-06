/**
 * デバイスの視野角(FOV)を adapter.json から取得する。
 *
 * シーンビューポートの視錐台表示と、ライブ配置モード / シミュレーションの
 * 「ユーザーが見ている画面」の両方が同じ値を使う必要があるため、共有モジュールに置く。
 */
import { useEffect, useState } from 'react';

export interface DeviceFov {
  horizontal: number;
  vertical: number;
}

/**
 * adapter.json の display から視野角を取り出す。
 *
 * XREAL_One は display.fieldOfView が直下にあるが、Meta_Quest は
 * display.quest3 / display.quest2 のように機種ごとにぶら下がっている。
 * どちらの形でも拾えるようにする。
 */
export function extractDeviceFov(adapter: any): DeviceFov | null {
  const display = adapter?.display;
  if (!display || typeof display !== 'object') return null;

  const read = (candidate: any): DeviceFov | null => {
    const fov = candidate?.fieldOfView;
    const h = Number(fov?.horizontal);
    const v = Number(fov?.vertical);
    if (!Number.isFinite(h) || !Number.isFinite(v) || h <= 0 || v <= 0) return null;
    return { horizontal: h, vertical: v };
  };

  return read(display) ?? Object.values(display).map(read).find((f): f is DeviceFov => f !== null) ?? null;
}

/**
 * ターゲットデバイスの視野角を adapter.json から取得する。
 * 取れなかった場合は null を返し、視錐台は描かない（適当な値でそれっぽく
 * 描くと「実機でもこの範囲に入る」と誤解されるため）。
 */
export function useDeviceFov(targetDevice: string | undefined): DeviceFov | null {
  const [fov, setFov] = useState<DeviceFov | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFov(null);
    if (!targetDevice || !window.electronAPI?.adapters) return;

    window.electronAPI.adapters
      .get(targetDevice)
      .then((adapter) => {
        if (!cancelled) setFov(extractDeviceFov(adapter));
      })
      .catch(() => {
        if (!cancelled) setFov(null);
      });

    return () => {
      cancelled = true;
    };
  }, [targetDevice]);

  return fov;
}
