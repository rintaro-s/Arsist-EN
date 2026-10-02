// ==============================================
// Arsist Engine - Extensions: scene host
// Assets/Arsist/Runtime/Extensions/ArsistExtensionHost.cs
// (MonoBehaviour はファイル名とクラス名が同じでないとシーンに保存できないので、別ファイル)
// ==============================================

using UnityEngine;

namespace Arsist.Runtime.Extensions
{
    /// <summary>
    /// シーンに 1 つ置かれ、拡張機能を起こす。ビルドが、有効な拡張機能があるときだけ置く。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    [DisallowMultipleComponent]
    public sealed class ArsistExtensionHost : MonoBehaviour
    {
        private void Start()
        {
            ArsistExtensions.StartAll(this);
        }
    }
}
