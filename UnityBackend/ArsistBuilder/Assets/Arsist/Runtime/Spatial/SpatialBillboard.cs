// ==============================================
// Arsist Engine - Layster.Spatial: 札をいつもユーザーの方へ向ける
// Assets/Arsist/Runtime/Spatial/SpatialBillboard.cs
// ==============================================

using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    /// <summary>札をいつもユーザーの方へ向ける。</summary>
    public sealed class SpatialBillboard : MonoBehaviour
    {
        private void LateUpdate()
        {
            var cam = Camera.main;
            if (cam == null) return;
            var d = transform.position - cam.transform.position;
            d.y = 0;
            if (d.sqrMagnitude > 1e-6f) transform.rotation = Quaternion.LookRotation(d, Vector3.up);
        }
    }
}
