// ==============================================
// Arsist Engine - Input
// 文字入力の設定をシーンから渡す
//
// どのキーボードを出すか (IR の arSettings.interaction.textInput) は、静的な
// ArsistTextEntry が持っている。シーンから静的な値は渡せないので、この小さな
// コンポーネントがビルド時に値を受け取り、起動時に渡す。
// ==============================================

using UnityEngine;

namespace Arsist.Runtime.Input
{
    [UnityEngine.Scripting.Preserve]
    public class ArsistTextEntryConfig : MonoBehaviour
    {
        [Tooltip("0=自動 (端末のものを試して、出なければアプリの中のもの) / 1=端末のものだけ / 2=アプリの中のものだけ")]
        [SerializeField] private int _mode;

        private void Awake()
        {
            ArsistTextEntry.SetMode(_mode switch
            {
                1 => ArsistTextEntry.Mode.DeviceOnly,
                2 => ArsistTextEntry.Mode.InAppOnly,
                _ => ArsistTextEntry.Mode.Auto,
            });
        }
    }
}
