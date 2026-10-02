// ==============================================
// Arsist Extension: quest-room — entry point
// Extensions/quest-room/Runtime/QuestRoomExtension.cs
//
// この拡張機能は requires で cap:scene-understanding + sdk:meta-mruk を求めているので、
// Quest 向けで、sdk/quest に MRUK があるビルドにしか入らない。だから Meta の SDK
// (Meta.XR.MRUtilityKit / OVRSpatialAnchor) を #if 無しで直接使っている。
// ==============================================

using Arsist.Runtime.Extensions;
using UnityEngine;

namespace Arsist.Extensions.QuestRoom
{
    [UnityEngine.Scripting.Preserve]
    public sealed class QuestRoomExtension : ArsistRuntimeExtension
    {
        public const string ExtensionId = "quest-room";

        /// <summary>OnStart で作られる。スクリプトの room.* はこれを通して部屋を見る。</summary>
        internal static QuestRoomService Service { get; private set; }

        /// <summary>
        /// Service ができたとき。スクリプト (onStart) が部屋の係より先に走って room.onReady を
        /// 呼んでいても、ここで拾ってつなぐ。
        /// </summary>
        internal static event System.Action ServiceStarted;

        public override string Id => ExtensionId;

        public override void RegisterScriptGlobals(ArsistScriptBridge script, ArsistExtensionContext context)
        {
            // スクリプトエンジンは Awake で作られ、部屋の係は Start で作られる。
            // room.* は呼ばれた時点の Service を見るので、順番に依存しない。
            script.Set("room", new RoomScriptApi(script, () => Service));
        }

        public override void OnStart(ArsistExtensionContext context)
        {
            var go = new GameObject("[QuestRoom]");
            Service = go.AddComponent<QuestRoomService>();
            ServiceStarted?.Invoke();
            Service.Init(context);
        }
    }
}
