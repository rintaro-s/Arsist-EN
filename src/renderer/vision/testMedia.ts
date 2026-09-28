/**
 * 試す素材: 写真 1 枚、写真の束、動画から抜いたフレーム、実機が処理した画。
 *
 * どれも「下から上の行順の RGBA」(ColorImage の規約) の列に揃える。
 * 動画は一定間隔で抜く (track / stabilize / motion / event は連続したフレームでしか確かめられない)。
 */
import type { PerceptionTask } from '../../shared/types';

export interface TestImage {
  width: number;
  height: number;
  rgba: Uint8Array;
  name: string;
}

export interface TestMedia {
  kind: 'image' | 'images' | 'video' | 'device';
  name: string;
  frames: TestImage[];
  /** フレームの間隔 (1 秒あたりの枚数) */
  fps: number;
  /** 実機の画は既にタスクの枠で切り出されている */
  precropped?: boolean;
}

/** 大きすぎる写真をそのまま流すと、プレビューが目に見えて遅くなる。 */
export const MAX_TEST_WIDTH = 640;
export const MAX_VIDEO_FRAMES = 40;

function toBottomUp(context: CanvasRenderingContext2D, width: number, height: number): Uint8Array {
  const topDown = context.getImageData(0, 0, width, height).data;
  // canvas は上から下、ColorImage は下から上。ここを揃えないと上下が逆になる。
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const source = (height - 1 - y) * width * 4;
    rgba.set(topDown.subarray(source, source + width * 4), y * width * 4);
  }
  return rgba;
}

function fitSize(width: number, height: number): { width: number; height: number } {
  const scale = width > MAX_TEST_WIDTH ? MAX_TEST_WIDTH / width : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function decodeTestImage(file: Blob, name: string): Promise<TestImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitSize(bitmap.width, bitmap.height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas is unavailable');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return { width, height, rgba: toBottomUp(context, width, height), name };
}

/** 動画を一定間隔で抜く。長い動画は先頭から MAX_VIDEO_FRAMES 枚まで。 */
export async function sampleVideo(file: File, fps = 2, maxFrames = MAX_VIDEO_FRAMES): Promise<TestMedia> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('video could not be decoded'));
    });
    const { width, height } = fitSize(video.videoWidth, video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas is unavailable');

    const frames: TestImage[] = [];
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const count = Math.max(1, Math.min(maxFrames, Math.floor(duration * fps) + 1));
    for (let i = 0; i < count; i++) {
      const time = Math.min(duration, i / fps);
      await new Promise<void>((resolve, reject) => {
        const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
        video.addEventListener('seeked', onSeeked);
        video.onerror = () => reject(new Error('video seek failed'));
        video.currentTime = time;
      });
      context.drawImage(video, 0, 0, width, height);
      frames.push({ width, height, rgba: toBottomUp(context, width, height), name: `${file.name} @${time.toFixed(1)}s` });
    }
    return { kind: 'video', name: file.name, frames, fps };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 実機から来た JPEG (base64) を 1 フレームにする。 */
export async function decodeDeviceJpeg(base64: string, name: string): Promise<TestImage> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return decodeTestImage(new Blob([bytes], { type: 'image/jpeg' }), name);
}

/**
 * タスクが見る枠で切り出す。実機では静止画を枠で切ってからパイプラインに渡すので、
 * エディタでも同じ画を流さないと、閾値や位置が実機とずれる。
 */
export function cropToTask(image: TestImage, task: PerceptionTask | null): TestImage {
  if (!task || task.source.kind !== 'viewport') return image;
  const r = task.source.rect;
  if (r.x <= 0 && r.y <= 0 && r.width >= 1 && r.height >= 1) return image;

  const x0 = Math.max(0, Math.min(image.width - 1, Math.round(r.x * image.width)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.round(r.y * image.height)));
  const w = Math.max(8, Math.min(image.width - x0, Math.round(r.width * image.width)));
  const h = Math.max(8, Math.min(image.height - y0, Math.round(r.height * image.height)));

  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const source = ((y0 + y) * image.width + x0) * 4;
    rgba.set(image.rgba.subarray(source, source + w * 4), y * w * 4);
  }
  return { width: w, height: h, rgba, name: image.name };
}

export function mediaFromImage(image: TestImage): TestMedia {
  return { kind: 'image', name: image.name, frames: [image], fps: 2 };
}

/** ドロップや選択で来たファイル群を素材にする。動画は 1 本目だけ。 */
export async function mediaFromFiles(files: File[]): Promise<TestMedia | null> {
  const video = files.find((f) => f.type.startsWith('video/'));
  if (video) return sampleVideo(video);

  const images = files.filter((f) => f.type.startsWith('image/'));
  if (images.length === 0) return null;
  // 名前順に並べる (連番の写真を時間順に流せるように)
  images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const frames: TestImage[] = [];
  for (const file of images) frames.push(await decodeTestImage(file, file.name));
  return frames.length === 1
    ? mediaFromImage(frames[0])
    : { kind: 'images', name: `${images.length} photos`, frames, fps: 2 };
}

/**
 * 素材のフレームを、切り出す前のままステージに出せる PreviewStep にする。
 * フレームは既に C# の結果と同じ向き (下から上) なので、並べ替えずに包むだけ。
 * カメラのカードで「見る枠」を重ねて見せるため。
 */
export function frameAsStep(image: TestImage, name = 'media'): { name: string; kind: 'color'; width: number; height: number; rgba: Uint8Array } {
  return { name, kind: 'color', width: image.width, height: image.height, rgba: image.rgba };
}
