// quest-input の録画 (ArsistRecorder) が使う RGBA → YUV 4:2:0 の変換 (ArsistYuv) を、
// デスクトップの JVM で確かめる。実機では「色が変」「上下が逆」「緑の縞」としか見えないので、ここで固定する。
//
//   - 色: BT.601 limited range の式 (浮動小数点で計算した値) と ±1 で合うか (白・黒・赤・緑・青・灰)
//   - 4:2:0 の色差: 2x2 の平均になっているか
//   - 並べ方: I420 (U と V が別、pixelStride 1)、NV12 (交互、pixelStride 2)、行の間隔 (stride) が幅より広いとき
//   - 行の向き: flipRows で上下が入れ替わるか
//   - 行の間隔の余り (stride - width) を書き潰さないか
import com.arsist.recorder.ArsistYuv;

import java.nio.ByteBuffer;

public class YuvCheck {
    static int failures = 0;

    static void expect(String label, boolean ok, String detail) {
        System.out.println((ok ? "PASS  " : "FAIL  ") + label + (ok || detail == null ? "" : ": " + detail));
        if (!ok) failures++;
    }

    // 参照: BT.601 limited range (浮動小数点)
    static double refY(double r, double g, double b) { return 16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255.0; }
    static double refU(double r, double g, double b) { return 128 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255.0; }
    static double refV(double r, double g, double b) { return 128 + (112.0 * r - 93.786 * g - 18.214 * b) / 255.0; }

    /** 上半分と下半分で色が違う RGBA (先頭の行が画の上)。 */
    static ByteBuffer image(int w, int h, int[] top, int[] bottom) {
        ByteBuffer b = ByteBuffer.allocateDirect(w * h * 4);
        for (int y = 0; y < h; y++) {
            int[] c = y < h / 2 ? top : bottom;
            for (int x = 0; x < w; x++) {
                int i = (y * w + x) * 4;
                b.put(i, (byte) c[0]); b.put(i + 1, (byte) c[1]); b.put(i + 2, (byte) c[2]); b.put(i + 3, (byte) 255);
            }
        }
        return b;
    }

    static int u8(ByteBuffer b, int i) { return b.get(i) & 255; }

    static void colors() {
        int[][] cases = {
            { 255, 255, 255 }, { 0, 0, 0 }, { 255, 0, 0 }, { 0, 255, 0 }, { 0, 0, 255 }, { 128, 128, 128 }, { 30, 200, 90 },
        };
        String[] names = { "white", "black", "red", "green", "blue", "grey", "mixed" };
        ArsistYuv yuv = new ArsistYuv();
        for (int k = 0; k < cases.length; k++) {
            int[] c = cases[k];
            int w = 4, h = 4;
            ByteBuffer src = image(w, h, c, c);
            ByteBuffer y = ByteBuffer.allocate(w * h), u = ByteBuffer.allocate(w * h / 4), v = ByteBuffer.allocate(w * h / 4);
            yuv.convert(src, w, h, false, y, w, 1, u, v, w / 2, 1);
            double ey = refY(c[0], c[1], c[2]), eu = refU(c[0], c[1], c[2]), ev = refV(c[0], c[1], c[2]);
            boolean ok = Math.abs(u8(y, 0) - ey) <= 1 && Math.abs(u8(u, 0) - eu) <= 1 && Math.abs(u8(v, 0) - ev) <= 1;
            expect("BT.601 " + names[k], ok, String.format("got Y%d U%d V%d, want Y%.1f U%.1f V%.1f", u8(y, 0), u8(u, 0), u8(v, 0), ey, eu, ev));
        }
    }

    static void chromaAverage() {
        // 2x2 のうち 1 画素だけ赤、残り黒: 色差は 4 画素の平均 (R=64) の色
        int w = 2, h = 2;
        ByteBuffer src = ByteBuffer.allocateDirect(16);
        src.put(0, (byte) 255);
        for (int i = 3; i < 16; i += 4) src.put(i, (byte) 255);
        ByteBuffer y = ByteBuffer.allocate(4), u = ByteBuffer.allocate(1), v = ByteBuffer.allocate(1);
        new ArsistYuv().convert(src, w, h, false, y, w, 1, u, v, 1, 1);
        expect("4:2:0 chroma is the 2x2 average", Math.abs(u8(v, 0) - refV(64, 0, 0)) <= 1 && Math.abs(u8(u, 0) - refU(64, 0, 0)) <= 1,
                "V " + u8(v, 0) + " want " + refV(64, 0, 0));
        expect("luma stays per pixel", u8(y, 0) == (int) Math.round(refY(255, 0, 0)) || Math.abs(u8(y, 0) - refY(255, 0, 0)) <= 1,
                "Y0 " + u8(y, 0));
        expect("luma of the black pixels is 16", u8(y, 1) == 16 && u8(y, 2) == 16 && u8(y, 3) == 16, null);
    }

    /** I420 と NV12 を、幅より広い行の間隔 (stride) で書き、上下の色と余白を確かめる。 */
    static void layouts() {
        int w = 8, h = 4, stride = 16, slice = 4;
        int[] white = { 255, 255, 255 }, blue = { 0, 0, 255 };
        int yWhite = (int) Math.round(refY(255, 255, 255)), yBlue = (int) Math.round(refY(0, 0, 255));
        int uBlue = (int) Math.round(refU(0, 0, 255)), vBlue = (int) Math.round(refV(0, 0, 255));
        ByteBuffer src = image(w, h, white, blue);

        for (int flip = 0; flip < 2; flip++) {
            boolean flipRows = flip == 1;
            String tag = flipRows ? " (flipRows)" : "";
            int[] topY = flipRows ? new int[] { yBlue } : new int[] { yWhite };
            int[] bottomY = flipRows ? new int[] { yWhite } : new int[] { yBlue };

            // NV12: Y (stride x slice) の後ろに UV が交互
            ByteBuffer nv12 = ByteBuffer.allocateDirect(stride * slice * 3 / 2);
            for (int i = 0; i < nv12.capacity(); i++) nv12.put(i, (byte) 0x5A);
            ByteBuffer uv = slice(nv12, stride * slice), vv = slice(nv12, stride * slice + 1);
            new ArsistYuv().convert(src, w, h, flipRows, nv12, stride, 1, uv, vv, stride, 2);
            int top = u8(nv12, 0), bottom = u8(nv12, (h - 1) * stride);
            expect("NV12 luma rows" + tag, Math.abs(top - topY[0]) <= 1 && Math.abs(bottom - bottomY[0]) <= 1, "top " + top + " bottom " + bottom);
            int uvRowBlue = flipRows ? 0 : 1; // 4 行なので UV は 2 行。青は画の下半分
            int at = stride * slice + uvRowBlue * stride;
            expect("NV12 U/V interleaved" + tag, Math.abs(u8(nv12, at) - uBlue) <= 1 && Math.abs(u8(nv12, at + 1) - vBlue) <= 1,
                    "U " + u8(nv12, at) + " V " + u8(nv12, at + 1));
            expect("NV12 stride padding untouched" + tag, u8(nv12, w) == 0x5A && u8(nv12, stride * slice + w) == 0x5A, null);

            // I420: Y の後ろに U (stride/2)、その後ろに V
            int cStride = stride / 2;
            ByteBuffer i420 = ByteBuffer.allocate(stride * slice + 2 * cStride * slice / 2);
            for (int i = 0; i < i420.capacity(); i++) i420.put(i, (byte) 0x5A);
            int uOff = stride * slice, vOff = uOff + cStride * slice / 2;
            new ArsistYuv().convert(src, w, h, flipRows, i420, stride, 1, slice(i420, uOff), slice(i420, vOff), cStride, 1);
            int ub = u8(i420, uOff + uvRowBlue * cStride), vb = u8(i420, vOff + uvRowBlue * cStride);
            expect("I420 planes" + tag, Math.abs(ub - uBlue) <= 1 && Math.abs(vb - vBlue) <= 1, "U " + ub + " V " + vb);
            expect("I420 chroma padding untouched" + tag, u8(i420, uOff + w / 2) == 0x5A, null);
        }
    }

    /** Image の Y 面が pixelStride 2 のとき (まれだが仕様上ありうる)。 */
    static void lumaPixelStride() {
        int w = 4, h = 2;
        ByteBuffer src = image(w, h, new int[] { 255, 255, 255 }, new int[] { 255, 255, 255 });
        ByteBuffer y = ByteBuffer.allocate(w * h * 2);
        ByteBuffer u = ByteBuffer.allocate(4), v = ByteBuffer.allocate(4);
        new ArsistYuv().convert(src, w, h, false, y, w * 2, 2, u, v, 2, 1);
        expect("luma with pixelStride 2", u8(y, 0) == 235 && u8(y, 2) == 235 && u8(y, 1) == 0, "Y " + u8(y, 0) + "," + u8(y, 1) + "," + u8(y, 2));
    }

    static void rejectsOdd() {
        boolean threw = false;
        try {
            new ArsistYuv().convert(ByteBuffer.allocate(3 * 2 * 4), 3, 2, false, ByteBuffer.allocate(6), 3, 1,
                    ByteBuffer.allocate(2), ByteBuffer.allocate(2), 2, 1);
        } catch (IllegalArgumentException e) {
            threw = true;
        }
        expect("odd sizes are refused with a reason", threw, null);
    }

    static ByteBuffer slice(ByteBuffer b, int offset) {
        ByteBuffer d = b.duplicate();
        ((java.nio.Buffer) d).position(offset);
        return d.slice();
    }

    /** 1920x1080 の 1 フレームに掛かる時間 (目安。実機の CPU はこれより遅い)。 */
    static void timing() {
        int w = 1920, h = 1080;
        ByteBuffer src = image(w, h, new int[] { 10, 20, 30 }, new int[] { 200, 100, 50 });
        ByteBuffer out = ByteBuffer.allocateDirect(w * h * 3 / 2);
        ArsistYuv yuv = new ArsistYuv();
        for (int i = 0; i < 10; i++) yuv.convert(src, w, h, true, out, w, 1, slice(out, w * h), slice(out, w * h + 1), w, 2);
        long t0 = System.nanoTime();
        int n = 20;
        for (int i = 0; i < n; i++) yuv.convert(src, w, h, true, out, w, 1, slice(out, w * h), slice(out, w * h + 1), w, 2);
        double ms = (System.nanoTime() - t0) / 1e6 / n;
        System.out.println(String.format("INFO  1920x1080 RGBA -> NV12: %.1f ms per frame on this desktop JVM", ms));
    }

    public static void main(String[] args) {
        colors();
        chromaAverage();
        layouts();
        lumaPixelStride();
        rejectsOdd();
        timing();
        System.out.println(failures == 0 ? "\nall YUV checks passed" : "\n" + failures + " YUV check(s) FAILED");
        System.exit(failures == 0 ? 0 : 1);
    }
}
