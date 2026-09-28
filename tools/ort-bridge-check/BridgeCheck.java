// C# (ArsistOrtRunner) が Java ブリッジに対してしている呼び出しを、そのままなぞる。
// 実機でしか動かない道なので、ここで一度でも通しておかないと「理由の無いエラー」しか残らない。
import com.arsist.ort.ArsistOnnxRuntime;
import java.util.*;

public class BridgeCheck {
    static int failures = 0;

    static void expect(String label, boolean ok, String detail) {
        System.out.println((ok ? "PASS  " : "FAIL  ") + label + (detail == null || detail.isEmpty() ? "" : ": " + detail));
        if (!ok) failures++;
    }

    public static void main(String[] args) throws Exception {
        String model = args[0];
        int session = ArsistOnnxRuntime.open(model, 4);
        expect("open", session != 0, ArsistOnnxRuntime.lastError());
        if (session == 0) { System.exit(1); }

        String describe = ArsistOnnxRuntime.describe(session);
        expect("describe returns json", describe != null && describe.startsWith("{\"inputs\""), describe == null ? "null" : describe.substring(0, Math.min(200, describe.length())));

        // C# が input_ids に対してするのと同じ呼び出し
        long[] shape = new long[] { 1, 3 };
        long[] ids = new long[] { 1, 2, 3 };
        int h = ArsistOnnxRuntime.createLong(shape, ids);
        expect("createLong([1,3])", h != 0, ArsistOnnxRuntime.lastError());

        // スカラー (num_logits_to_keep) は形が空
        int scalar = ArsistOnnxRuntime.createLong(new long[0], new long[] { 1 });
        expect("createLong(scalar)", scalar != 0, ArsistOnnxRuntime.lastError());

        // 形と値の数が合わないものは、理由付きで断ること
        int bad = ArsistOnnxRuntime.createLong(new long[] { 1, 5 }, new long[] { 1, 2 });
        expect("createLong rejects a mismatch with a reason", bad == 0 && ArsistOnnxRuntime.lastError().contains("needs 5"), ArsistOnnxRuntime.lastError());

        int floats = ArsistOnnxRuntime.createFloat(new long[] { 1, 2, 2 }, new float[] { 0, 0, 0, 0 });
        expect("createFloat", floats != 0, ArsistOnnxRuntime.lastError());

        ArsistOnnxRuntime.release(h, false);
        ArsistOnnxRuntime.release(scalar, false);
        ArsistOnnxRuntime.release(floats, false);
        ArsistOnnxRuntime.closeSession(session);
        System.out.println(failures == 0 ? "\nBRIDGE CHECKS PASSED" : "\n" + failures + " FAILED");
        System.exit(failures == 0 ? 0 : 1);
    }
}
