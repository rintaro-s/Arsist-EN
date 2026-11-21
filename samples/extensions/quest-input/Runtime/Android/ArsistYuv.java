package com.arsist.recorder;

import java.nio.Buffer;
import java.nio.ByteBuffer;

/**
 * RGBA (8 bit x 4) → YUV 4:2:0 (BT.601, limited range 16..235 / 16..240)。H.264 の既定の色。
 *
 * 書き込み先は Y / U / V の 3 枚の面と、それぞれの行の間隔 (rowStride) と画素の間隔 (pixelStride)。
 * MediaCodec の Image (COLOR_FormatYUV420Flexible) がそのまま渡せる形で、NV12 (U と V が交互、
 * pixelStride 2) も I420 (別々、pixelStride 1) も同じ関数で書ける。
 *
 * android.* に依存しないので、デスクトップの JVM で確かめられる (tools/recorder-yuv-check)。
 *
 * 注意: ByteBuffer の position / clear は必ず Buffer にキャストして呼ぶ。JDK 9 以降と新しい
 * android.jar では ByteBuffer を返す版 (共変) があり、それで組むと古い端末で NoSuchMethodError になる。
 */
public final class ArsistYuv {

    private byte[] mRowA = new byte[0];
    private byte[] mRowB = new byte[0];
    private byte[] mLuma = new byte[0];

    /**
     * @param src       width * height * 4 バイトの RGBA。先頭の行が画の上 (flipRows なら画の下)
     * @param flipRows  src の行が下から上に並んでいるとき true (Unity の読み出しが下から上の端末)
     */
    public void convert(ByteBuffer src, int width, int height, boolean flipRows,
                        ByteBuffer y, int yRowStride, int yPixelStride,
                        ByteBuffer u, ByteBuffer v, int uvRowStride, int uvPixelStride) {
        if (width <= 0 || height <= 0 || (width & 1) != 0 || (height & 1) != 0) {
            throw new IllegalArgumentException("size must be even and positive: " + width + "x" + height);
        }
        int rowBytes = width * 4;
        if (src.capacity() < rowBytes * height) {
            throw new IllegalArgumentException("source is " + src.capacity() + " bytes, needs " + (rowBytes * height));
        }
        if (mRowA.length < rowBytes) {
            mRowA = new byte[rowBytes];
            mRowB = new byte[rowBytes];
        }
        if (mLuma.length < width) mLuma = new byte[width];

        ByteBuffer s = src.duplicate();
        ByteBuffer yd = y.duplicate();

        for (int row = 0; row < height; row += 2) {
            int srcA = flipRows ? height - 1 - row : row;
            int srcB = flipRows ? height - 2 - row : row + 1;
            ((Buffer) s).position(srcA * rowBytes);
            s.get(mRowA, 0, rowBytes);
            ((Buffer) s).position(srcB * rowBytes);
            s.get(mRowB, 0, rowBytes);

            writeLuma(mRowA, width, yd, row * yRowStride, yPixelStride);
            writeLuma(mRowB, width, yd, (row + 1) * yRowStride, yPixelStride);

            int uvBase = (row >> 1) * uvRowStride;
            for (int x = 0; x < width; x += 2) {
                int i = x * 4;
                int r = (mRowA[i] & 255) + (mRowA[i + 4] & 255) + (mRowB[i] & 255) + (mRowB[i + 4] & 255);
                int g = (mRowA[i + 1] & 255) + (mRowA[i + 5] & 255) + (mRowB[i + 1] & 255) + (mRowB[i + 5] & 255);
                int b = (mRowA[i + 2] & 255) + (mRowA[i + 6] & 255) + (mRowB[i + 2] & 255) + (mRowB[i + 6] & 255);
                r = (r + 2) >> 2;
                g = (g + 2) >> 2;
                b = (b + 2) >> 2;
                int at = uvBase + (x >> 1) * uvPixelStride;
                u.put(at, (byte) chromaU(r, g, b));
                v.put(at, (byte) chromaV(r, g, b));
            }
        }
    }

    private void writeLuma(byte[] rgba, int width, ByteBuffer y, int offset, int pixelStride) {
        if (pixelStride == 1) {
            for (int x = 0; x < width; x++) {
                int i = x * 4;
                mLuma[x] = (byte) luma(rgba[i] & 255, rgba[i + 1] & 255, rgba[i + 2] & 255);
            }
            ((Buffer) y).position(offset);
            y.put(mLuma, 0, width);
        } else {
            for (int x = 0; x < width; x++) {
                int i = x * 4;
                y.put(offset + x * pixelStride, (byte) luma(rgba[i] & 255, rgba[i + 1] & 255, rgba[i + 2] & 255));
            }
        }
    }

    // BT.601 limited range (整数近似。ITU-R BT.601 の係数 x 256)
    static int luma(int r, int g, int b) {
        return ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
    }

    static int chromaU(int r, int g, int b) {
        return ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
    }

    static int chromaV(int r, int g, int b) {
        return ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
    }
}
