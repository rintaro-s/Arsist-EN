/**
 * シミュレータの画面の共通部品: デバイスの視野の枠 (アスペクト)、隅の但し書き、読み込みの印。
 */
import type { ReactNode } from 'react';
import type { DeviceFov } from '../utils/deviceFov';

export function deviceAspect(fov: DeviceFov | null): number {
  if (!fov) return 16 / 9;
  const h = Math.tan((fov.horizontal / 2) * (Math.PI / 180));
  const v = Math.tan((fov.vertical / 2) * (Math.PI / 180));
  return v > 0 ? h / v : 16 / 9;
}

/** 画像 (width × height) に収まる、aspect の枠。 */
export function fitBox(width: number, height: number, aspect: number): { width: number; height: number } {
  return width / aspect <= height ? { width, height: Math.round(width / aspect) } : { width: Math.round(height * aspect), height };
}

/** 画像全体。中央にデバイスの視野の枠、外は黒 (見えない所)。 */
export function SimFrame({ width, height, box, caption, children, outside }: {
  width: number;
  height: number;
  box: { width: number; height: number } | null;
  caption: string;
  children: ReactNode;
  /** 枠の外 (画像全体) に重ねるもの */
  outside?: ReactNode;
}) {
  return (
    <div style={{ position: 'relative', width, height, background: '#000', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: box ? (width - box.width) / 2 : 0,
          top: box ? (height - box.height) / 2 : 0,
          width: box ? box.width : width,
          height: box ? box.height : height,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
      {outside}
      <div
        data-sim-caption
        style={{
          position: 'absolute', left: 6, bottom: 6, padding: '2px 7px', borderRadius: 4,
          background: 'rgba(0,0,0,0.62)', color: '#f0f0f0', font: '12px/1.4 system-ui, sans-serif', whiteSpace: 'nowrap',
        }}
      >
        {caption}
      </div>
    </div>
  );
}

export function fovText(fov: DeviceFov | null): string {
  return fov ? `FOV ${fov.horizontal}°×${fov.vertical}°` : 'FOV unknown (16:9, 50° v)';
}
