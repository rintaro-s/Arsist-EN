package android.util;
/** デスクトップで動かすための最小の差し替え (実機では Android のものが使われる)。 */
public final class Log {
    public static int i(String tag, String msg) { System.out.println("I/" + tag + ": " + msg); return 0; }
    public static int e(String tag, String msg) { System.out.println("E/" + tag + ": " + msg); return 0; }
    public static int e(String tag, String msg, Throwable t) { System.out.println("E/" + tag + ": " + msg + " / " + t); return 0; }
}
