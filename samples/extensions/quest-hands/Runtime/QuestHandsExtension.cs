// ==============================================
// Arsist Extension: quest-hands — entry point
// samples/extensions/quest-hands/Runtime/QuestHandsExtension.cs
//
// 追跡している手と Touch コントローラーを 3D の空間に置く。仮想の物との前後が正しくなる
// (これが無いと、パススルーの本物の手は、どんな仮想の物よりも後ろに見える)。
//   仮想 (virtual)  手は関節から形を作って描く。コントローラーは Meta の SDK の模型 (ビルドがシーンに置く)
//   本物 (real)     同じ形を深度にだけ描く。見えるのはパススルーの自分の手で、奥の仮想の物はそれに隠れる
//
// requires に sdk:meta-core があるので Quest のビルドにしか入らない。XR Hands と Meta の SDK を直接使う。
// ==============================================

using Arsist.Runtime.Extensions;
using UnityEngine;

namespace Arsist.Extensions.QuestHands
{
    [UnityEngine.Scripting.Preserve]
    public sealed class QuestHandsExtension : ArsistRuntimeExtension
    {
        public const string ExtensionId = "quest-hands";

        internal static HandVisualService Service { get; private set; }

        public override string Id => ExtensionId;

        public override void RegisterScriptGlobals(ArsistScriptBridge script, ArsistExtensionContext context)
        {
            script.Set("handVisuals", new HandVisualsApi(() => Service));
        }

        public override void OnStart(ArsistExtensionContext context)
        {
            var go = new GameObject("[QuestHands]");
            Service = go.AddComponent<HandVisualService>();
            Service.Init(context);
        }
    }
}
