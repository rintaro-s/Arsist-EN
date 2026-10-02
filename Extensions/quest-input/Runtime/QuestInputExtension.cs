// ==============================================
// Arsist Extension: quest-input — entry point
// Extensions/quest-input/Runtime/QuestInputExtension.cs
//
// Quest の入力 (Touch コントローラー・ハンドトラッキング・システム / 物理キーボード・マイク・
// ヘッドセットの状態) を、スクリプト (controller / hands / mic / keyboard / headset)、
// store (input.* / mic.* / keyboard.* / headset.*)、スクリプトイベント (quest-input:*) と、
// コードを書かない「つかめる物」として使えるようにする。
//
// requires に sdk:meta-core があるので Quest のビルドにしか入らない。Meta の SDK (OVRManager /
// OVRPlugin) と XR Hands を #if 無しで直接使っている。
// ==============================================

using Arsist.Runtime.Extensions;
using UnityEngine;

namespace Arsist.Extensions.QuestInput
{
    [UnityEngine.Scripting.Preserve]
    public sealed class QuestInputExtension : ArsistRuntimeExtension
    {
        public const string ExtensionId = "quest-input";

        /// <summary>OnStart で作られる。スクリプトの API はこれを通して入力を見る。</summary>
        internal static QuestInputService Service { get; private set; }

        public override string Id => ExtensionId;

        public override void RegisterScriptGlobals(ArsistScriptBridge script, ArsistExtensionContext context)
        {
            // スクリプトエンジンは Awake で、入力の係は Start で作られる。API は呼ばれた時点の
            // Service を見る。on() の表は static (InputEvents) なので、先に登録しても取りこぼさない。
            script.Set("controller", new ControllerApi(script, () => Service));
            script.Set("hands", new HandsApi(script, () => Service));
            script.Set("mic", new MicApi(script, () => Service));
            script.Set("keyboard", new KeyboardApi(script, () => Service));
            script.Set("headset", new HeadsetApi(script, () => Service));
        }

        public override void OnStart(ArsistExtensionContext context)
        {
            var go = new GameObject("[QuestInput]");
            Service = go.AddComponent<QuestInputService>();
            Service.Init(context);
        }
    }
}
