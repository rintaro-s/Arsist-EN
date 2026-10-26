package com.arsist.recorder;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.media.Image;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.Buffer;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicIntegerArray;

/**
 * 録画 (quest-input 拡張機能の recorder)。H.264 + AAC の MP4 を MediaStore の Movies/&lt;folder&gt;/ に書く。
 *
 *   C# (メインスレッド)                         Java (このクラスの作業スレッド)
 *   begin → setSlot x N → setAudioBuffer → go   コーデックと MediaMuxer を用意 → state RECORDING
 *   acquireSlot → (GPU 読み出しが slot に入る)
 *   submit(slot, pts)                    ──▶  RGBA → YUV (ArsistYuv) → H.264 → slot を空きに戻す
 *   pushAudio(bytes, pts)                ──▶  PCM16 → AAC
 *   end                                  ──▶  終わりの印 → 書き切る → IS_PENDING=0 → state DONE
 *
 * 画の受け渡し: slot は C# が持つメモリ (NativeArray) を包んだ direct ByteBuffer。C# の読み出しが
 * そこへ直接入り、ここが直接読むので、JNI をまたいで画素をコピーしない。空きの slot が無ければ
 * acquireSlot が -1 を返し、C# はそのフレームを捨てる (エンコードが追いつかないときにメインスレッドを止めない)。
 *
 * C# からの呼び出しはすべて Unity のメインスレッドから (JNI がつながっているスレッド)。
 * 時刻 (pts) は C# が決める: 画は録り始めからの経過 (一時停止の分を引く)、音はサンプル数から。
 */
public final class ArsistRecorder {

    private static final String TAG = "ArsistRecorder";

    // state() の値 (C# の RecorderJava と同じ番号)
    public static final int IDLE = 0;
    public static final int STARTING = 1;
    public static final int RECORDING = 2;
    public static final int STOPPING = 3;
    public static final int DONE = 4;
    public static final int ERROR = 5;

    private static final int SLOT_FREE = 0;
    private static final int SLOT_CLAIMED = 1;
    private static final int SLOT_QUEUED = 2;

    private static final int COLOR_FLEXIBLE = MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible;
    private static final int COLOR_SEMI_PLANAR = 21; // COLOR_FormatYUV420SemiPlanar (NV12。非推奨だが古いエンコーダはこれしか言わない)
    private static final int COLOR_PLANAR = 19;      // COLOR_FormatYUV420Planar (I420)

    private static Session sSession;
    private static volatile String sLastError = "";
    private static volatile String sLastResult = "";

    private ArsistRecorder() {}

    // ================= C# から =================

    public static synchronized boolean begin(Context context, String folder, String displayName,
                                             int width, int height, int fps, int bitrate,
                                             int audioRate, boolean flipRows, int slotCount) {
        try {
            if (sSession != null && !sSession.finished()) {
                fail("already recording (state " + sSession.state + ")");
                return false;
            }
            if (context == null) { fail("no context"); return false; }
            if (width < 16 || height < 16 || (width & 1) != 0 || (height & 1) != 0) {
                fail("bad size " + width + "x" + height + " (needs even numbers, at least 16)");
                return false;
            }
            if (slotCount < 1 || slotCount > 8) { fail("bad slot count " + slotCount); return false; }
            sLastError = "";
            sSession = new Session(context.getApplicationContext(), folder, displayName, width, height,
                    Math.max(1, fps), Math.max(100000, bitrate), Math.max(0, audioRate), flipRows, slotCount);
            return true;
        } catch (Throwable t) {
            fail("begin", t);
            return false;
        }
    }

    public static void setSlot(int index, ByteBuffer buffer) {
        Session s = sSession;
        if (s != null && index >= 0 && index < s.slots.length) s.slots[index] = buffer;
    }

    public static void setAudioBuffer(ByteBuffer buffer) {
        Session s = sSession;
        if (s != null) s.audioShared = buffer;
    }

    /** 作業スレッドを起こす。コーデックの用意はそちらでするので、ここはすぐ返る。 */
    public static synchronized boolean go() {
        Session s = sSession;
        if (s == null || s.thread != null) return false;
        for (int i = 0; i < s.slots.length; i++) {
            if (s.slots[i] == null || s.slots[i].capacity() < s.width * s.height * 4) {
                fail("slot " + i + " is missing or too small");
                s.state = ERROR;
                return false;
            }
        }
        s.thread = new Thread(s, "ArsistRecorder");
        s.thread.start();
        return true;
    }

    public static int state() {
        Session s = sSession;
        return s == null ? IDLE : s.state;
    }

    /** 空いている slot の番号。無ければ (エンコードが追いついていない・録っていない) -1。 */
    public static int acquireSlot() {
        Session s = sSession;
        if (s == null || s.state != RECORDING) return -1;
        for (int i = 0; i < s.slotState.length(); i++) {
            if (s.slotState.compareAndSet(i, SLOT_FREE, SLOT_CLAIMED)) return i;
        }
        return -1;
    }

    /** 読み出しが終わった slot をエンコードに回す。 */
    public static void submit(int slot, long ptsUs) {
        Session s = sSession;
        if (s == null || slot < 0 || slot >= s.slotState.length()) return;
        if (s.state != RECORDING || !s.slotState.compareAndSet(slot, SLOT_CLAIMED, SLOT_QUEUED)) {
            s.slotState.set(slot, SLOT_FREE);
            return;
        }
        s.jobs.offer(Job.frame(slot, ptsUs));
    }

    /** 読み出しに失敗した slot を空きに戻す。 */
    public static void cancel(int slot) {
        Session s = sSession;
        if (s != null && slot >= 0 && slot < s.slotState.length()) s.slotState.set(slot, SLOT_FREE);
    }

    /** setAudioBuffer の先頭 bytes バイト (PCM16 モノラル、リトルエンディアン) を写して渡す。 */
    public static void pushAudio(int bytes, long ptsUs) {
        Session s = sSession;
        if (s == null || s.state != RECORDING || s.audioRate <= 0 || s.audioShared == null || bytes <= 0) return;
        if (s.jobs.size() > 200) { s.audioDropped++; return; } // 作業スレッドが詰まっている
        byte[] copy = new byte[Math.min(bytes, s.audioShared.capacity())];
        ByteBuffer src = s.audioShared.duplicate();
        ((Buffer) src).clear();
        src.get(copy, 0, copy.length);
        s.jobs.offer(Job.audio(copy, ptsUs));
    }

    /** 止めて保存する。保存は作業スレッドで続き、終わると state が DONE (または ERROR) になる。 */
    public static void end() {
        Session s = sSession;
        if (s == null || s.finished()) return;
        if (s.thread == null) {
            s.state = ERROR;
            s.error = "stopped before it started";
            return;
        }
        if (s.state == STARTING || s.state == RECORDING) s.state = STOPPING;
        s.jobs.offer(Job.end());
    }

    /** アプリが終わるとき: 保存が終わるまで最大 ms 待つ。 */
    public static boolean awaitFinish(int ms) {
        Session s = sSession;
        if (s == null || s.thread == null) return true;
        try { s.thread.join(Math.max(0, ms)); } catch (InterruptedException ignored) { }
        return s.finished();
    }

    /** 最後に終わった録画の結果 (JSON)。 */
    public static String result() {
        return sLastResult;
    }

    public static String lastError() {
        return sLastError;
    }

    /** 静止画 (JPEG) を Pictures/&lt;folder&gt;/ に保存する。結果は JSON。 */
    public static String savePhoto(Context context, String folder, String displayName, byte[] jpeg) {
        if (context == null || jpeg == null) return failJson("no context or no image");
        String relative = Environment.DIRECTORY_PICTURES + "/" + folder;
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver resolver = context.getContentResolver();
            Uri uri = null;
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, relative);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                uri = resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
                if (uri == null) throw new IllegalStateException("MediaStore insert returned null");
                OutputStream out = resolver.openOutputStream(uri);
                if (out == null) throw new IllegalStateException("cannot open " + uri);
                try { out.write(jpeg); } finally { out.close(); }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(uri, done, null, null);
                return "{\"ok\":true,\"file\":" + quote(relative + "/" + storedName(resolver, uri, displayName)) + ",\"uri\":" + quote(uri.toString())
                        + ",\"bytes\":" + jpeg.length + "}";
            } catch (Throwable t) {
                Log.w(TAG, "MediaStore photo failed, using the app folder: " + t);
                if (uri != null) {
                    try { resolver.delete(uri, null, null); } catch (Throwable ignored) { }
                }
            }
        }
        try {
            File dir = appDir(context, Environment.DIRECTORY_PICTURES, folder);
            File file = new File(dir, displayName);
            FileOutputStream out = new FileOutputStream(file);
            try { out.write(jpeg); } finally { out.close(); }
            return "{\"ok\":true,\"file\":" + quote(file.getAbsolutePath()) + ",\"uri\":" + quote(Uri.fromFile(file).toString())
                    + ",\"bytes\":" + jpeg.length + "}";
        } catch (Throwable t) {
            Log.e(TAG, "photo failed", t);
            return failJson("photo: " + describe(t));
        }
    }

    /** このアプリが Movies/&lt;folder&gt;/ (とアプリのフォルダ) に保存した動画。JSON の配列。 */
    public static String list(Context context, String folder) {
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        String relative = Environment.DIRECTORY_MOVIES + "/" + folder + "/";
        if (context != null && Build.VERSION.SDK_INT >= 29) {
            Cursor c = null;
            try {
                Uri base = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                String[] projection = {
                        MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME,
                        MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_ADDED,
                        MediaStore.MediaColumns.DURATION,
                };
                c = context.getContentResolver().query(base, projection,
                        MediaStore.MediaColumns.RELATIVE_PATH + "=?", new String[] { relative },
                        MediaStore.MediaColumns.DATE_ADDED + " DESC");
                while (c != null && c.moveToNext()) {
                    long id = c.getLong(0);
                    String name = c.getString(1);
                    if (!first) sb.append(',');
                    first = false;
                    sb.append("{\"file\":").append(quote(relative + name))
                      .append(",\"uri\":").append(quote(ContentUris.withAppendedId(base, id).toString()))
                      .append(",\"bytes\":").append(c.getLong(2))
                      .append(",\"date\":").append(quote(iso(c.getLong(3) * 1000L)))
                      .append(",\"seconds\":").append(Math.round(c.getLong(4) / 100.0) / 10.0)
                      .append('}');
                }
            } catch (Throwable t) {
                Log.w(TAG, "MediaStore query failed: " + t);
            } finally {
                if (c != null) c.close();
            }
        }
        if (context != null) {
            try {
                File dir = appDir(context, Environment.DIRECTORY_MOVIES, folder);
                File[] files = dir.listFiles();
                if (files != null) {
                    for (File f : files) {
                        if (!f.isFile() || !f.getName().endsWith(".mp4")) continue;
                        if (!first) sb.append(',');
                        first = false;
                        sb.append("{\"file\":").append(quote(f.getAbsolutePath()))
                          .append(",\"uri\":").append(quote(Uri.fromFile(f).toString()))
                          .append(",\"bytes\":").append(f.length())
                          .append(",\"date\":").append(quote(iso(f.lastModified())))
                          .append('}');
                    }
                }
            } catch (Throwable t) {
                Log.w(TAG, "listing the app folder failed: " + t);
            }
        }
        return sb.append(']').toString();
    }

    // ================= 1 回の録画 =================

    private static final class Job {
        static final int FRAME = 0, AUDIO = 1, END = 2;
        int kind;
        int slot;
        long pts;
        byte[] pcm;

        static Job frame(int slot, long pts) { Job j = new Job(); j.kind = FRAME; j.slot = slot; j.pts = pts; return j; }
        static Job audio(byte[] pcm, long pts) { Job j = new Job(); j.kind = AUDIO; j.pcm = pcm; j.pts = pts; return j; }
        static Job end() { Job j = new Job(); j.kind = END; return j; }
    }

    /** 書き始める前 (MediaMuxer の start 前) に出てきたエンコード済みのデータ。 */
    private static final class Pending {
        final boolean video;
        final byte[] data;
        final long pts;
        final int flags;

        Pending(boolean video, byte[] data, long pts, int flags) {
            this.video = video; this.data = data; this.pts = pts; this.flags = flags;
        }
    }

    private static final class Session implements Runnable {
        final Context context;
        final String folder, displayName;
        final int width, height, fps, bitrate, audioRate;
        final boolean flipRows;
        final ByteBuffer[] slots;
        final AtomicIntegerArray slotState;
        final LinkedBlockingQueue<Job> jobs = new LinkedBlockingQueue<>();
        volatile ByteBuffer audioShared;
        volatile int state = STARTING;
        volatile String error = "";
        volatile int audioDropped;
        Thread thread;

        // 作業スレッドだけが触る
        private MediaCodec video, audio;
        private MediaMuxer muxer;
        private int videoTrack = -1, audioTrack = -1;
        private boolean muxerStarted, videoEos, audioEos;
        private final List<Pending> pending = new ArrayList<>();
        private long lastVideoIn = -1, lastVideoOut = -1, lastAudioOut = -1, maxPts;
        private int frames, framesDropped, audioInputs;
        private boolean audioPrimed;
        private boolean useImage;
        private int bufferLayout; // COLOR_SEMI_PLANAR / COLOR_PLANAR (ByteBuffer で入れるとき)
        private int stride, sliceHeight;
        private final ArsistYuv yuv = new ArsistYuv();
        private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

        // 出力先
        private Uri uri;
        private ParcelFileDescriptor pfd;
        private File file;
        private String shownPath = "";

        Session(Context context, String folder, String displayName, int width, int height, int fps, int bitrate,
                int audioRate, boolean flipRows, int slotCount) {
            this.context = context;
            this.folder = folder == null || folder.isEmpty() ? "Arsist" : folder;
            this.displayName = displayName;
            this.width = width;
            this.height = height;
            this.fps = fps;
            this.bitrate = bitrate;
            this.audioRate = audioRate;
            this.flipRows = flipRows;
            this.slots = new ByteBuffer[slotCount];
            this.slotState = new AtomicIntegerArray(slotCount);
        }

        boolean finished() {
            return state == DONE || state == ERROR;
        }

        @Override
        public void run() {
            boolean ok = false;
            try {
                setUp();
                if (state == STARTING) state = RECORDING;
                loop();
                finishStreams();
                ok = true;
            } catch (Throwable t) {
                error = describe(t);
                Log.e(TAG, "recording failed", t);
            } finally {
                ok = closeAll(ok);
                for (int i = 0; i < slots.length; i++) {
                    slots[i] = null; // C# のメモリをもう読まない
                    slotState.set(i, SLOT_FREE);
                }
                audioShared = null;
                jobs.clear();
                sLastResult = resultJson(ok);
                if (!ok) sLastError = error;
                state = ok ? DONE : ERROR;
                Log.i(TAG, "finished: " + sLastResult);
            }
        }

        // ---- 用意 ----

        private void setUp() throws Exception {
            openOutput();

            video = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
            int[] formats = video.getCodecInfo().getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC).colorFormats;
            int color = pickColor(formats);
            if (color == 0) throw new IllegalStateException("the H.264 encoder takes no YUV 4:2:0 input (" + join(formats) + ")");
            useImage = color == COLOR_FLEXIBLE;
            bufferLayout = color == COLOR_PLANAR ? COLOR_PLANAR : COLOR_SEMI_PLANAR; // Flexible を ByteBuffer で入れるときは NV12

            MediaFormat format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height);
            format.setInteger(MediaFormat.KEY_COLOR_FORMAT, color);
            format.setInteger(MediaFormat.KEY_BIT_RATE, bitrate);
            format.setInteger(MediaFormat.KEY_FRAME_RATE, fps);
            format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
            video.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            video.start();
            MediaFormat in = video.getInputFormat();
            stride = in.containsKey(MediaFormat.KEY_STRIDE) ? Math.max(width, in.getInteger(MediaFormat.KEY_STRIDE)) : width;
            sliceHeight = in.containsKey(MediaFormat.KEY_SLICE_HEIGHT) ? Math.max(height, in.getInteger(MediaFormat.KEY_SLICE_HEIGHT)) : height;
            Log.i(TAG, "video " + width + "x" + height + " @" + fps + " " + bitrate + " bps, codec " + video.getName()
                    + ", color 0x" + Integer.toHexString(color) + (useImage ? " (Image)" : " (buffer, stride " + stride + ", slice " + sliceHeight + ")"));

            if (audioRate > 0) {
                MediaFormat a = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, audioRate, 1);
                a.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
                a.setInteger(MediaFormat.KEY_BIT_RATE, Math.min(128000, Math.max(32000, audioRate * 4)));
                a.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384);
                audio = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
                audio.configure(a, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
                audio.start();
                Log.i(TAG, "audio AAC " + audioRate + " Hz mono, codec " + audio.getName());
            } else {
                audioEos = true;
            }
        }

        private static int pickColor(int[] formats) {
            int found = 0;
            for (int f : formats) if (f == COLOR_FLEXIBLE) return f;
            for (int f : formats) if (f == COLOR_SEMI_PLANAR) return f;
            for (int f : formats) if (f == COLOR_PLANAR) found = f;
            return found;
        }

        /** MediaStore (Movies/<folder>/) に置く。駄目ならアプリのフォルダ (外部ストレージのアプリ専用領域)。 */
        private void openOutput() throws Exception {
            String relative = Environment.DIRECTORY_MOVIES + "/" + folder;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver resolver = context.getContentResolver();
                try {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, relative);
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    uri = resolver.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
                    if (uri == null) throw new IllegalStateException("MediaStore insert returned null");
                    pfd = resolver.openFileDescriptor(uri, "rw");
                    if (pfd == null) throw new IllegalStateException("cannot open " + uri);
                    muxer = new MediaMuxer(pfd.getFileDescriptor(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
                    shownPath = relative + "/" + storedName(resolver, uri, displayName);
                    return;
                } catch (Throwable t) {
                    Log.w(TAG, "MediaStore failed, writing to the app folder instead: " + t);
                    closeQuietly();
                    if (uri != null) {
                        try { resolver.delete(uri, null, null); } catch (Throwable ignored) { }
                        uri = null;
                    }
                }
            }
            File dir = appDir(context, Environment.DIRECTORY_MOVIES, folder);
            file = new File(dir, displayName);
            muxer = new MediaMuxer(file.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            shownPath = file.getAbsolutePath();
        }

        // ---- 回す ----

        private void loop() throws Exception {
            while (true) {
                Job job = jobs.poll(5, TimeUnit.MILLISECONDS);
                if (job != null) {
                    if (job.kind == Job.END) return;
                    if (job.kind == Job.FRAME) {
                        try {
                            encodeFrame(job.slot, job.pts);
                        } finally {
                            slotState.set(job.slot, SLOT_FREE);
                        }
                    } else {
                        encodeAudio(job.pcm, job.pts);
                    }
                }
                drain(video, true, false);
                if (audio != null) {
                    // 音を入れたのにマイクから 1 秒たっても何も来ないと、音のトラックの形が決まらず
                    // MediaMuxer が始まらない (= 画も書けない)。無音を 1 塊入れて形を決めさせる
                    if (!audioPrimed && audioInputs == 0 && frames >= fps) {
                        audioPrimed = true;
                        Log.w(TAG, "no sound from the microphone after 1 s; priming the AAC track with silence");
                        encodeAudio(new byte[2048], 0);
                    }
                    drain(audio, false, false);
                }
            }
        }

        private void encodeFrame(int slot, long pts) {
            ByteBuffer src = slots[slot];
            if (src == null) return;
            int index = -1;
            for (int attempt = 0; attempt < 5 && index < 0; attempt++) {
                index = video.dequeueInputBuffer(10000);
                if (index < 0) drain(video, true, false);
            }
            if (index < 0) { framesDropped++; return; }

            if (pts <= lastVideoIn) pts = lastVideoIn + 1000; // 増え続けること
            lastVideoIn = pts;

            int size = width * height * 3 / 2;
            Image image = null;
            if (useImage) {
                try { image = video.getInputImage(index); } catch (Throwable t) { image = null; }
                if (image == null) {
                    useImage = false; // この端末は Image を出さない: 以後は ByteBuffer (NV12)
                    Log.w(TAG, "getInputImage returned null; feeding NV12 buffers");
                }
            }
            if (image != null) {
                Image.Plane[] p = image.getPlanes();
                yuv.convert(src, width, height, flipRows,
                        p[0].getBuffer(), p[0].getRowStride(), p[0].getPixelStride(),
                        p[1].getBuffer(), p[2].getBuffer(), p[1].getRowStride(), p[1].getPixelStride());
            } else {
                ByteBuffer in = video.getInputBuffer(index);
                ((Buffer) in).clear();
                int ySize = stride * sliceHeight;
                if (bufferLayout == COLOR_PLANAR) {
                    int cStride = stride / 2;
                    int uOffset = ySize;
                    int vOffset = ySize + cStride * (sliceHeight / 2);
                    yuv.convert(src, width, height, flipRows, in, stride, 1,
                            slice(in, uOffset), slice(in, vOffset), cStride, 1);
                    size = vOffset + cStride * (sliceHeight / 2);
                } else {
                    yuv.convert(src, width, height, flipRows, in, stride, 1,
                            slice(in, ySize), slice(in, ySize + 1), stride, 2);
                    size = ySize + stride * (sliceHeight / 2);
                }
                size = Math.min(size, in.capacity());
            }
            video.queueInputBuffer(index, 0, size, pts, 0);
            frames++;
            if (pts > maxPts) maxPts = pts;
        }

        private static ByteBuffer slice(ByteBuffer b, int offset) {
            ByteBuffer d = b.duplicate();
            ((Buffer) d).clear();
            ((Buffer) d).position(offset);
            return d.slice();
        }

        private void encodeAudio(byte[] pcm, long pts) {
            int offset = 0;
            while (offset < pcm.length) {
                int index = audio.dequeueInputBuffer(10000);
                if (index < 0) {
                    drain(audio, false, false);
                    index = audio.dequeueInputBuffer(10000);
                    if (index < 0) { audioDropped++; return; }
                }
                ByteBuffer in = audio.getInputBuffer(index);
                ((Buffer) in).clear();
                int n = Math.min(pcm.length - offset, in.remaining()) & ~1;
                if (n <= 0) { audio.queueInputBuffer(index, 0, 0, pts, 0); return; }
                in.put(pcm, offset, n);
                long at = pts + (offset / 2) * 1000000L / audioRate;
                audio.queueInputBuffer(index, 0, n, at, 0);
                audioInputs++;
                offset += n;
                long end = pts + (pcm.length / 2) * 1000000L / audioRate;
                if (end > maxPts) maxPts = end;
            }
        }

        /** 出てきた分を書く。untilEos なら終わりの印が出るまで (最大 3 秒) 待つ。 */
        private void drain(MediaCodec codec, boolean isVideo, boolean untilEos) {
            long deadline = System.currentTimeMillis() + 3000;
            while (true) {
                if (isVideo ? videoEos : audioEos) return;
                int out = codec.dequeueOutputBuffer(info, untilEos ? 10000 : 0);
                if (out == MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (!untilEos || System.currentTimeMillis() > deadline) return;
                    continue;
                }
                if (out == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    addTrack(isVideo, codec.getOutputFormat());
                    continue;
                }
                if (out < 0) continue; // INFO_OUTPUT_BUFFERS_CHANGED (古い API)
                ByteBuffer data = codec.getOutputBuffer(out);
                boolean config = (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0;
                if (!config && info.size > 0 && data != null) {
                    ((Buffer) data).position(info.offset);
                    ((Buffer) data).limit(info.offset + info.size);
                    write(isVideo, data, info.presentationTimeUs, info.flags);
                }
                codec.releaseOutputBuffer(out, false);
                if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                    if (isVideo) videoEos = true; else audioEos = true;
                    return;
                }
            }
        }

        private void addTrack(boolean isVideo, MediaFormat format) {
            if (muxerStarted) {
                Log.w(TAG, "format changed after the muxer started; ignored");
                return;
            }
            if (isVideo) videoTrack = muxer.addTrack(format);
            else audioTrack = muxer.addTrack(format);
            if (videoTrack >= 0 && (audio == null || audioTrack >= 0)) {
                muxer.start();
                muxerStarted = true;
                for (Pending p : pending) {
                    ByteBuffer b = ByteBuffer.wrap(p.data);
                    writeNow(p.video, b, p.pts, p.flags, p.data.length);
                }
                pending.clear();
            }
        }

        private void write(boolean isVideo, ByteBuffer data, long pts, int flags) {
            if (!muxerStarted) {
                if (pending.size() > 2000) return; // もう一方がいつまでも始まらない
                byte[] copy = new byte[data.remaining()];
                data.get(copy);
                pending.add(new Pending(isVideo, copy, pts, flags));
                return;
            }
            writeNow(isVideo, data, pts, flags, data.remaining());
        }

        private void writeNow(boolean isVideo, ByteBuffer data, long pts, int flags, int size) {
            // MediaMuxer は時刻が戻ると例外を投げるので、同じトラックの中では増え続けるようにする
            long last = isVideo ? lastVideoOut : lastAudioOut;
            if (pts < last) pts = last;
            if (isVideo) lastVideoOut = pts; else lastAudioOut = pts;
            MediaCodec.BufferInfo bi = new MediaCodec.BufferInfo();
            bi.set(data.position(), size, pts, flags & ~MediaCodec.BUFFER_FLAG_END_OF_STREAM);
            if (size <= 0) return;
            muxer.writeSampleData(isVideo ? videoTrack : audioTrack, data, bi);
        }

        // ---- 終わり ----

        private void finishStreams() {
            signalEos(video, lastVideoIn < 0 ? 0 : lastVideoIn + 1);
            if (audio != null) signalEos(audio, Math.max(0, lastAudioOut + 1));
            drain(video, true, true);
            if (audio != null) drain(audio, false, true);
            if (!videoEos) Log.w(TAG, "video encoder did not finish in time");
            if (!audioEos) Log.w(TAG, "audio encoder did not finish in time");
        }

        private void signalEos(MediaCodec codec, long pts) {
            long deadline = System.currentTimeMillis() + 1000;
            while (System.currentTimeMillis() < deadline) {
                int index = codec.dequeueInputBuffer(10000);
                if (index >= 0) {
                    codec.queueInputBuffer(index, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                    return;
                }
                drain(codec, codec == video, false);
            }
        }

        /** コーデック・MediaMuxer・ファイルを閉じる。保存できていれば IS_PENDING=0、駄目なら消す。 */
        private boolean closeAll(boolean ok) {
            try { if (video != null) { video.stop(); } } catch (Throwable ignored) { }
            try { if (video != null) { video.release(); } } catch (Throwable ignored) { }
            try { if (audio != null) { audio.stop(); } } catch (Throwable ignored) { }
            try { if (audio != null) { audio.release(); } } catch (Throwable ignored) { }
            if (muxer != null) {
                if (!muxerStarted || frames == 0) {
                    if (ok) { ok = false; error = "nothing was recorded (no video frames reached the encoder)"; }
                } else {
                    try {
                        muxer.stop();
                    } catch (Throwable t) {
                        if (ok) { ok = false; error = "finishing the MP4 failed: " + describe(t); }
                    }
                }
                try { muxer.release(); } catch (Throwable ignored) { }
                muxer = null;
            }
            long bytes = 0;
            try { if (pfd != null) bytes = pfd.getStatSize(); } catch (Throwable ignored) { }
            if (file != null) bytes = file.length();
            mBytes = bytes;
            closeQuietly();
            if (uri != null) {
                ContentResolver resolver = context.getContentResolver();
                try {
                    if (ok) {
                        ContentValues done = new ContentValues();
                        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                        resolver.update(uri, done, null, null);
                    } else {
                        resolver.delete(uri, null, null);
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "MediaStore update failed: " + t);
                }
            } else if (!ok && file != null) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
            return ok;
        }

        private long mBytes;

        private void closeQuietly() {
            try { if (pfd != null) pfd.close(); } catch (Throwable ignored) { }
            pfd = null;
        }

        private String resultJson(boolean ok) {
            StringBuilder sb = new StringBuilder("{\"ok\":").append(ok);
            if (ok) {
                sb.append(",\"file\":").append(quote(shownPath));
                sb.append(",\"uri\":").append(quote(uri != null ? uri.toString() : file != null ? Uri.fromFile(file).toString() : ""));
                sb.append(",\"bytes\":").append(mBytes);
            } else {
                sb.append(",\"error\":").append(quote(error == null || error.isEmpty() ? "recording failed" : error));
            }
            sb.append(",\"seconds\":").append(Math.round(maxPts / 100000.0) / 10.0);
            sb.append(",\"width\":").append(width).append(",\"height\":").append(height);
            sb.append(",\"frames\":").append(frames);
            sb.append(",\"encoderDropped\":").append(framesDropped);
            sb.append(",\"audio\":").append(audioRate > 0);
            sb.append(",\"audioDropped\":").append(audioDropped);
            return sb.append('}').toString();
        }
    }

    // ================= 小物 =================

    private static File appDir(Context context, String type, String folder) {
        File base = context.getExternalFilesDir(type);
        if (base == null) base = new File(context.getFilesDir(), type);
        File dir = new File(base, folder);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    /** 同じ名前が既にあると MediaStore が "(1)" を付けるので、実際の名前を読み直す。 */
    private static String storedName(ContentResolver resolver, Uri uri, String fallback) {
        Cursor c = null;
        try {
            c = resolver.query(uri, new String[] { MediaStore.MediaColumns.DISPLAY_NAME }, null, null, null);
            if (c != null && c.moveToFirst() && c.getString(0) != null) return c.getString(0);
        } catch (Throwable ignored) {
        } finally {
            if (c != null) c.close();
        }
        return fallback;
    }

    private static String iso(long millis) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(millis));
    }

    private static String join(int[] values) {
        StringBuilder sb = new StringBuilder();
        for (int v : values) {
            if (sb.length() > 0) sb.append(", ");
            sb.append("0x").append(Integer.toHexString(v));
        }
        return sb.toString();
    }

    /** 理由を必ず残す。getMessage() が null の例外があるので、種類も書く。 */
    private static String describe(Throwable t) {
        String m = t.getMessage();
        return t.getClass().getSimpleName() + (m == null ? "" : ": " + m);
    }

    private static void fail(String reason) {
        sLastError = reason;
        Log.e(TAG, reason);
    }

    private static void fail(String what, Throwable t) {
        sLastError = what + ": " + describe(t);
        Log.e(TAG, sLastError, t);
    }

    private static String failJson(String error) {
        return "{\"ok\":false,\"error\":" + quote(error) + "}";
    }

    static String quote(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format(Locale.US, "\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}
