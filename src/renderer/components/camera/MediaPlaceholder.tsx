/**
 * UI の Image が source (カメラ / 配信、doc/23) を持つときの、エディタとプレビューでの見た目。
 * 実機の映像はエディタでは出せないので、何が映るかを書いた板にする。
 *   camera → 暗い市松模様の上にカメラの名前 (プレビューのシミュレーターは shot にカメラから見た画を渡せる)
 *   stream → 「配信: <url>」
 * 実機の画像と同じく、絵は枠からはみ出さないように収める (contain)。mirror は左右反転。
 *
 * 色は実機の画面の見本なので固定 (エディタのテーマに合わせない。UI の下書きの他の要素と同じ)。
 * renderToStaticMarkup (rasterizeUi) からも描くので、inline style だけで描く。
 */
import { createContext } from 'react';
import type { MediaSource } from '../../../shared/types';

/**
 * 画像の source の見え方を外から渡す (プレビューのシミュレーター)。
 * cameraName: source.camera (id か assetId) → 表示名、shot: カメラから見た画 (data URL)
 */
export interface MediaView {
  cameraName?: (ref: string) => string | undefined;
  shot?: (ref: string) => string | undefined;
}
export const MediaViewContext = createContext<MediaView | null>(null);

const CHECKER = 'repeating-conic-gradient(#20242c 0% 25%, #2a2f39 0% 50%) 50% / 24px 24px';

export function MediaPlaceholder({ source, label, shot }: { source: MediaSource; label: string; shot?: string }) {
  const flip = source.mirror ? 'scaleX(-1)' : undefined;
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: CHECKER, pointerEvents: 'none' }}>
      {shot && (
        <img src={shot} alt="" draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', transform: flip }} />
      )}
      <div style={{
        position: 'absolute', left: 6, bottom: 6, right: 6, display: 'flex', justifyContent: 'flex-start',
      }}>
        <span style={{
          maxWidth: '100%', padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.55)', color: '#d4d8de',
          fontSize: 16, fontFamily: 'system-ui, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {source.kind === 'camera' ? '● ' : '▶ '}{label}{source.mirror ? ' ⇋' : ''}
        </span>
      </div>
    </div>
  );
}
