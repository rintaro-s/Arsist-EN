// ==============================================
// Arsist Engine - Layster.Spatial: シーンの物と thing の対応
// Assets/Arsist/Runtime/Spatial/ArsistSpatialThing.cs
//
// ビルド (ArsistBuildPipeline.TagSpatialThing) が、spatial.json の things[].object に当たる
// シーンの物にだけ付ける。ArsistSpatialRuntime はこれで物を見つける (名前は重複しうるので使わない)。
// ==============================================

using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    [UnityEngine.Scripting.Preserve]
    [DisallowMultipleComponent]
    public sealed class ArsistSpatialThing : MonoBehaviour
    {
        private static readonly List<ArsistSpatialThing> All = new List<ArsistSpatialThing>();

        [Tooltip("spatial.json の things[].id")]
        public string thingId;

        private void Awake()
        {
            if (!All.Contains(this)) All.Add(this);
        }

        private void OnDestroy()
        {
            All.Remove(this);
        }

        public static ArsistSpatialThing Find(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            foreach (var t in All) if (t != null && t.thingId == id) return t;
            // まだ Awake していない (無効な物の下など) こともあるので、シーンからも探す
#if UNITY_2023_1_OR_NEWER
            foreach (var t in Object.FindObjectsByType<ArsistSpatialThing>(FindObjectsInactive.Include, FindObjectsSortMode.None))
#else
            foreach (var t in Object.FindObjectsOfType<ArsistSpatialThing>(true))
#endif
            {
                if (t == null || t.thingId != id) continue;
                if (!All.Contains(t)) All.Add(t);
                return t;
            }
            return null;
        }
    }
}
