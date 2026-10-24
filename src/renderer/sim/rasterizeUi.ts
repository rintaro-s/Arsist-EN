/**
 * UI レイアウト (Layster.Virtual) → canvas。プレビューの SimpleUIRenderer の DOM を、SVG の foreignObject に入れて画像にする。
 * (SimpleUIRenderer は inline style だけで描くので、そのまま SVG の中で同じ見た目になる。フォントは OS のもの)
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SimpleUIRenderer } from '../components/dialogs/PreviewDialog';
import type { UILayoutData } from '../../shared/types';

const MAX_SIDE = 2048;
const FONT = "system-ui, 'Noto Sans CJK JP', 'Noto Sans JP', sans-serif";

export async function rasterizeLayout(layout: UILayoutData): Promise<HTMLCanvasElement> {
  const width = Math.max(1, Math.round(layout.resolution?.width || 1024));
  const height = Math.max(1, Math.round(layout.resolution?.height || 1024));
  const markup = renderToStaticMarkup(createElement(SimpleUIRenderer, { element: layout.root }));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;position:relative;overflow:hidden;font-family:${FONT};box-sizing:border-box">` +
    markup +
    `</div></foreignObject></svg>`;
  const image = new Image();
  image.decoding = 'sync';
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('UI layout could not be rasterized'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const g = canvas.getContext('2d');
  g?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
