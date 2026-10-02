// ==============================================
// Arsist Extension: quest-room — keeps a pinned object on its spatial anchor
// Extensions/quest-room/Runtime/RoomPinFollower.cs
// (MonoBehaviour はファイル名とクラス名を揃える)
// ==============================================

using UnityEngine;

namespace Arsist.Extensions.QuestRoom
{
    [UnityEngine.Scripting.Preserve]
    [DisallowMultipleComponent]
    public sealed class RoomPinFollower : MonoBehaviour
    {
        /// <summary>OVRSpatialAnchor の付いた Transform。物はこの姿勢にそのまま重なる。</summary>
        public Transform anchor;

        private void LateUpdate()
        {
            if (anchor == null) return;
            transform.SetPositionAndRotation(anchor.position, anchor.rotation);
        }
    }
}
