// ==============================================
// Arsist Engine - Perception / Text
// ML Kit Text Recognition v2 (bundled) を使う端末内認識器
//
// モデルは APK に同梱されており、Google Play Services にもモデルの
// ネット配信にも依存しない。Quest 3 実機で確認済み
// (doc/12-ar-behaviors.md §4a、tools/mlkit-spike/)。
//
// Java 側 (Assets/Plugins/Android/ArsistMlkitOcr.java) は結果を
// UnityPlayer.UnitySendMessage で返す。これはメインスレッドへの
// マーシャリングを勝手にやってくれるので、受け口の GameObject を1つ用意する。
// ==============================================

using System;
using UnityEngine;

namespace Arsist.Runtime.Perception.Text
{
    public sealed class MlKitTextRecognizer : IArsistTextRecognizer
    {
        public const string JavaClassName = "com.arsist.mlkit.ArsistMlkitOcr";
        private const string BridgeObjectName = "[ArsistMlKitBridge]";

        private ArsistMlKitBridge _bridge;
        private bool _classChecked;
        private bool _classAvailable;

        public string Description => "ML Kit Text Recognition v2 (bundled, on-device)";

        public bool IsAvailable
        {
            get
            {
                if (_classChecked) return _classAvailable;
                _classChecked = true;
#if UNITY_ANDROID && !UNITY_EDITOR
                try
                {
                    using (var _ = new AndroidJavaClass(JavaClassName))
                    {
                        _classAvailable = true;
                    }
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[Arsist] ML Kit bridge not present: {e.Message}");
                    _classAvailable = false;
                }
#else
                _classAvailable = false;
#endif
                return _classAvailable;
            }
        }

        public void Recognize(RgbaImage image, string script, Action<TextResult> done)
        {
            if (!image.IsValid)
            {
                done?.Invoke(TextResult.Failure("invalidImage"));
                return;
            }
            if (!IsAvailable)
            {
                done?.Invoke(TextResult.Failure("engineUnavailable"));
                return;
            }

            EnsureBridge();
            if (_bridge == null)
            {
                done?.Invoke(TextResult.Failure("engineUnavailable"));
                return;
            }
            if (!_bridge.TryBegin(done))
            {
                // 同じ認識器に二重で投げない（タスク側でもキューしているが念のため）
                done?.Invoke(TextResult.Failure("busy"));
                return;
            }

            try
            {
                using (var java = new AndroidJavaClass(JavaClassName))
                {
                    java.CallStatic("recognizeRgba",
                        image.Pixels, image.Width, image.Height,
                        string.IsNullOrEmpty(script) ? "japanese" : script,
                        BridgeObjectName,
                        nameof(ArsistMlKitBridge.OnOcrSuccess),
                        nameof(ArsistMlKitBridge.OnOcrFailure));
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[Arsist] ML Kit call failed: {e}");
                _bridge.Complete(TextResult.Failure("engine"));
            }
        }

        private void EnsureBridge()
        {
            if (_bridge != null) return;

            var existing = GameObject.Find(BridgeObjectName);
            if (existing == null)
            {
                existing = new GameObject(BridgeObjectName);
                UnityEngine.Object.DontDestroyOnLoad(existing);
            }
            _bridge = existing.GetComponent<ArsistMlKitBridge>();
            if (_bridge == null) _bridge = existing.AddComponent<ArsistMlKitBridge>();
        }
    }

    /// <summary>
    /// UnitySendMessage の受け口。
    /// メソッドは名前で解決されるため通常の参照が無く、IL2CPP の
    /// コード除去に消される候補になる。public + Preserve にしておくこと
    /// （消えると「OCR が返ってこない」という紛らわしい失敗になる）。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistMlKitBridge : MonoBehaviour
    {
        private Action<TextResult> _pending;

        public bool TryBegin(Action<TextResult> done)
        {
            if (_pending != null) return false;
            _pending = done;
            return true;
        }

        public void Complete(TextResult result)
        {
            var pending = _pending;
            _pending = null;
            pending?.Invoke(result);
        }

        [UnityEngine.Scripting.Preserve]
        public void OnOcrSuccess(string payload)
        {
            // Java 側は "経過ms|認識テキスト" で返す (UnitySendMessage は引数1つ)
            int separator = payload?.IndexOf('|') ?? -1;
            int elapsed = 0;
            string text = payload ?? string.Empty;
            if (separator > 0)
            {
                int.TryParse(payload.Substring(0, separator), out elapsed);
                text = payload.Substring(separator + 1);
            }
            Complete(TextResult.Success(text, elapsed));
        }

        [UnityEngine.Scripting.Preserve]
        public void OnOcrFailure(string error)
        {
            Debug.LogWarning($"[Arsist] ML Kit OCR failed: {error}");
            Complete(TextResult.Failure("engine"));
        }
    }
}
