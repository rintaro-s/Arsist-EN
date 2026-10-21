// ==============================================
// Arsist Engine - UI Binding Registry
// Assets/Arsist/Runtime/Scripting/UiBindingRegistry.cs
// ==============================================
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// UI 要素に bindingId を付与し、スクリプトエンジンから検索できるようにするコンポーネント。
    /// ビルドパイプラインが ui_layouts.json の bindingId を持つ要素に自動でアタッチする。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class UiBindingRegistry : MonoBehaviour
    {
        [SerializeField] public string bindingId;

        private void OnEnable()
        {
            if (!string.IsNullOrEmpty(bindingId))
            {
                UiBindingLookup.Register(bindingId, gameObject);
            }
        }

        // 隠した (SetActive(false)) だけでは表から外さない。外すと ui.setVisibility(id, false) のあとに
        // ui.setVisibility(id, true) も ui.setText(id, …) も要素を見つけられず、二度と出せなくなる。
        // 表から外すのは、要素そのものが無くなったときだけ。
        private void OnDestroy()
        {
            if (!string.IsNullOrEmpty(bindingId))
            {
                UiBindingLookup.Unregister(bindingId, gameObject);
            }
        }
    }
}
