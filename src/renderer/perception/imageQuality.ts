/**
 * 参照写真の「追跡しやすさ」スコア。
 *
 * 画像アンカーが動かない原因のほとんどは、認識器ではなく参照写真そのもの
 * （ボケ・低コントラスト・繰り返し模様・のっぺりした面）にある。
 * ランタイムと同じ FAST-9 のコーナー判定を縮小画像に掛けて密度を測り、
 * エディタ上で事前に警告できるようにする。
 *
 * あくまで目安であり、ビルドは止めない。
 */

/** Bresenham 半径3の円（16点）。行順は上下どちらでも密度は変わらないので不問。 */
const CIRCLE_DX = [0, 1, 2, 3, 3, 3, 2, 1, 0, -1, -2, -3, -3, -3, -2, -1];
const CIRCLE_DY = [3, 3, 2, 1, 0, -1, -2, -3, -3, -3, -2, -1, 0, 1, 2, 3];

const FAST_THRESHOLD = 18;
const BORDER = 4;

/** 「良好」とみなすコーナー密度（画素あたり）。実測でこの辺りから安定して検出できる。 */
const GOOD_CORNER_DENSITY = 0.004;

/**
 * 参照写真の短辺の最低画素数。
 *
 * ランタイムの ORB は 1.2 倍ずつ 6 段のピラミッドを作り、各段で外周 22px を
 * 特徴点に使えない領域として捨てる。最小の段は原寸の約 0.4 倍なので、
 * 短辺がこれを下回ると「1つも特徴が取れない」状態になる。
 * 実際に 48x48 のロゴを参照写真に指定して踏んだ（コーナー密度は高いのに 0 features）。
 */
const MIN_SHORT_SIDE = 240;
/** ここを超えていれば解像度としては十分。 */
const GOOD_SHORT_SIDE = 480;

export type ImageQualityReason = 'ok' | 'tooSmall' | 'lowContrast' | 'fewFeatures';

export interface ImageQualityResult {
  /** 0-100。40 未満は実用にならない可能性が高い。 */
  score: number;
  cornerCount: number;
  /** 輝度の標準偏差 (0-255)。低いとコントラスト不足。 */
  contrast: number;
  /** 元画像の解像度（縮小前）。 */
  width: number;
  height: number;
  /** スコアが低い場合の主因。UI はこれで文言を選ぶ。 */
  reason: ImageQualityReason;
}

/**
 * @param gray 8bit グレースケール（長さ width*height、行順は問わない）
 */
export function scoreReferenceImage(
  gray: Uint8Array | number[],
  width: number,
  height: number,
  /** 縮小前の解像度。省略時は width/height をそのまま使う。 */
  sourceWidth = width,
  sourceHeight = height,
): ImageQualityResult {
  if (width <= 2 * BORDER || height <= 2 * BORDER) {
    return {
      score: 0, cornerCount: 0, contrast: 0,
      width: sourceWidth, height: sourceHeight, reason: 'tooSmall',
    };
  }

  const offsets = CIRCLE_DX.map((dx, i) => CIRCLE_DY[i] * width + dx);

  let corners = 0;
  let sum = 0;
  let sumSq = 0;
  const total = width * height;

  for (let i = 0; i < total; i++) {
    const v = gray[i];
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / total;
  const contrast = Math.sqrt(Math.max(0, sumSq / total - mean * mean));

  for (let y = BORDER; y < height - BORDER; y++) {
    const row = y * width;
    for (let x = BORDER; x < width - BORDER; x++) {
      const idx = row + x;
      const p = gray[idx];
      const hi = p + FAST_THRESHOLD;
      const lo = p - FAST_THRESHOLD;

      // 9連続の弧は等間隔4点のうち必ず2点以上を含む。
      // よく見る「3点以上」は FAST-12 の条件で、FAST-9 に使うと
      // 直角コーナー（4点中2点しか同じ側に来ない）を丸ごと取りこぼす。
      let brighter = 0;
      let darker = 0;
      for (let k = 0; k < 16; k += 4) {
        const s = gray[idx + offsets[k]];
        if (s > hi) brighter++;
        else if (s < lo) darker++;
      }
      if (brighter < 2 && darker < 2) continue;

      let runBright = 0;
      let runDark = 0;
      let isCorner = false;
      for (let k = 0; k < 24; k++) {
        const s = gray[idx + offsets[k & 15]];
        if (s > hi) {
          runBright++;
          runDark = 0;
        } else if (s < lo) {
          runDark++;
          runBright = 0;
        } else {
          runBright = 0;
          runDark = 0;
        }
        if (runBright >= 9 || runDark >= 9) {
          isCorner = true;
          break;
        }
      }
      if (isCorner) corners++;
    }
  }

  const density = corners / total;
  let score = Math.min(1, density / GOOD_CORNER_DENSITY) * 100;
  let reason: ImageQualityReason = 'ok';

  if (score < 60) reason = 'fewFeatures';

  // コントラストが乏しい写真は、コーナーが出ていても実機の照明差で崩れやすい
  if (contrast < 30) {
    score *= contrast / 30;
    reason = 'lowContrast';
  }

  // 解像度が足りない写真は、模様がどれだけ細かくても実機では1つも特徴が取れない。
  // 密度の評価とは独立した上限として掛ける（ここを見落として 48x48 の画像に
  // 72/100 を出してしまったことがある）。
  const shortSide = Math.min(sourceWidth, sourceHeight);
  if (shortSide < GOOD_SHORT_SIDE) {
    score *= Math.max(0, Math.min(1, (shortSide - MIN_SHORT_SIDE / 2) / (GOOD_SHORT_SIDE - MIN_SHORT_SIDE / 2)));
    if (shortSide < MIN_SHORT_SIDE) {
      score = 0;
      reason = 'tooSmall';
    } else if (score < 60) {
      reason = 'tooSmall';
    }
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    cornerCount: corners,
    contrast: Math.round(contrast),
    width: sourceWidth,
    height: sourceHeight,
    reason,
  };
}

/**
 * ブラウザで読み込んだ画像から直接スコアを出す。
 * 長辺 320px 程度に縮めてから測る（元解像度に依存しないようにするため）。
 */
export async function scoreImageFromUrl(url: string): Promise<ImageQualityResult | null> {
  const image = await loadImage(url);
  if (!image) return null;

  const maxSide = 320;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    gray[i] = (data[o] * 19595 + data[o + 1] * 38470 + data[o + 2] * 7471) >> 16;
  }
  // 縮小後の画素で密度を測りつつ、解像度の判定には元のサイズを使う
  return scoreReferenceImage(gray, w, h, image.width, image.height);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
