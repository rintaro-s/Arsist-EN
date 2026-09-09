// ==============================================
// ML Kit bundled OCR 実機検証スパイク
//
// 目的はひとつだけ: Google Play Services の無い Quest 3 で、
// APK に同梱した ML Kit のモデルだけで OCR が通るかを確かめる。
// カメラも XR も使わない（変数を減らすため）。StreamingAssets の
// テスト画像を読んで OCR し、画面と logcat に出す。
// ==============================================

using System;
using System.Collections;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;

public class OcrSpike : MonoBehaviour
{
    private const string GameObjectName = "OcrSpike";
    private const string TestImage = "ocr_test.png";

    private string _status = "starting...";
    private string _result = "";
    private string _device = "";
    private string _playServices = "(not checked)";
    private Texture2D _texture;
    private bool _busy;
    private GUIStyle _style;

    private void Awake()
    {
        gameObject.name = GameObjectName;
        Application.targetFrameRate = 60;
        _device = $"{SystemInfo.deviceModel} / Android API {GetApiLevel()}";
        Debug.Log("[OcrSpike] ===== spike started =====");
        Debug.Log($"[OcrSpike] device: {_device}");
    }

    private IEnumerator Start()
    {
        _playServices = CallStatic("playServicesStatus");
        Debug.Log($"[OcrSpike] GooglePlayServices availability code: {_playServices} (0 = available)");

        yield return LoadTestImage();

        if (_texture != null)
        {
            Recognize("japanese");
        }
    }

    private IEnumerator LoadTestImage()
    {
        var path = Path.Combine(Application.streamingAssetsPath, TestImage);
        var url = path.Contains("://") ? path : "file://" + path;
        _status = "loading test image...";

        using (var request = UnityWebRequest.Get(url))
        {
            yield return request.SendWebRequest();
            if (request.result != UnityWebRequest.Result.Success)
            {
                _status = $"image load failed: {request.error}";
                Debug.LogError("[OcrSpike] " + _status);
                yield break;
            }

            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!texture.LoadImage(request.downloadHandler.data))
            {
                _status = "image decode failed";
                Debug.LogError("[OcrSpike] " + _status);
                yield break;
            }
            _texture = texture;
            _status = $"image loaded {_texture.width}x{_texture.height}";
            Debug.Log("[OcrSpike] " + _status);
        }
    }

    private void Recognize(string script)
    {
        if (_busy || _texture == null) return;
        _busy = true;
        _status = $"recognizing ({script})...";
        _result = "";

        // Unity のテクスチャは下から上、Android の Bitmap は上から下なので反転して渡す。
        // 反転を忘れると「検出はされるが文字にならない」形で静かに失敗する。
        var pixels = _texture.GetPixels32();
        int w = _texture.width, h = _texture.height;
        var rgba = new byte[w * h * 4];
        for (int y = 0; y < h; y++)
        {
            int src = (h - 1 - y) * w;
            int dst = y * w * 4;
            for (int x = 0; x < w; x++)
            {
                var c = pixels[src + x];
                int o = dst + x * 4;
                rgba[o] = c.r;
                rgba[o + 1] = c.g;
                rgba[o + 2] = c.b;
                rgba[o + 3] = c.a;
            }
        }

        try
        {
            using (var bridge = new AndroidJavaClass("com.arsist.mlkit.ArsistMlkitOcr"))
            {
                bridge.CallStatic("recognizeRgba", rgba, w, h, script,
                    GameObjectName, nameof(OnOcrSuccess), nameof(OnOcrFailure));
            }
        }
        catch (Exception e)
        {
            _busy = false;
            _status = "bridge call failed";
            _result = e.ToString();
            Debug.LogError("[OcrSpike] " + _result);
        }
    }

    // Java 側から UnitySendMessage で名前解決されて呼ばれる。
    // 通常の参照が無いため、IL2CPP のマネージドコード除去に消される候補になる。
    // public + [Preserve] にし、ビルド側でも stripping を切ってある（SpikeBuild）。
    [UnityEngine.Scripting.Preserve]
    public void OnOcrSuccess(string payload)
    {
        _busy = false;
        int sep = payload.IndexOf('|');
        var ms = sep > 0 ? payload.Substring(0, sep) : "?";
        _result = sep >= 0 ? payload.Substring(sep + 1) : payload;
        _status = $"OK in {ms} ms";
        Debug.Log($"[OcrSpike] SUCCESS ({ms} ms)\n{_result}");
    }

    [UnityEngine.Scripting.Preserve]
    public void OnOcrFailure(string error)
    {
        _busy = false;
        _status = "FAILED";
        _result = error;
        Debug.LogError("[OcrSpike] FAILURE: " + error);
    }

    private static string CallStatic(string method)
    {
        try
        {
            using (var bridge = new AndroidJavaClass("com.arsist.mlkit.ArsistMlkitOcr"))
            {
                return bridge.CallStatic<string>(method);
            }
        }
        catch (Exception e)
        {
            return "error: " + e.Message;
        }
    }

    private static string GetApiLevel()
    {
        try
        {
            using (var version = new AndroidJavaClass("android.os.Build$VERSION"))
            {
                return version.GetStatic<int>("SDK_INT").ToString();
            }
        }
        catch
        {
            return "?";
        }
    }

    private void OnGUI()
    {
        // Canvas もフォントアセットも使わない。スパイクに要らない依存を持ち込まないため。
        if (_style == null)
        {
            _style = new GUIStyle(GUI.skin.label)
            {
                fontSize = Mathf.Max(18, Screen.height / 32),
                wordWrap = true,
                alignment = TextAnchor.UpperLeft,
            };
        }

        const int pad = 24;
        var rect = new Rect(pad, pad, Screen.width - pad * 2, Screen.height - pad * 2);
        GUILayout.BeginArea(rect);

        GUILayout.Label("ML Kit bundled OCR spike", _style);
        GUILayout.Label($"device: {_device}", _style);
        GUILayout.Label($"GooglePlayServices code: {_playServices}   (0 = available)", _style);
        GUILayout.Label($"status: {_status}", _style);
        GUILayout.Space(12);
        GUILayout.Label(_result, _style);
        GUILayout.Space(12);

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("Recognize (japanese)", GUILayout.Height(80))) Recognize("japanese");
        if (GUILayout.Button("Recognize (latin)", GUILayout.Height(80))) Recognize("latin");
        GUILayout.EndHorizontal();

        GUILayout.EndArea();
    }
}
