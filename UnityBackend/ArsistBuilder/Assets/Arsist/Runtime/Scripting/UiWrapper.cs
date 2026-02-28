// ==============================================
// Arsist Engine - UI Wrapper
// Assets/Arsist/Runtime/Scripting/UiWrapper.cs
// ==============================================
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// スクリプト上の ui オブジェクト。bindingId で UI 要素を操作する。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class UiWrapper
    {
        // ─────────────────────────────────────
        // ui.setText(id, text)
        // ─────────────────────────────────────
        [UnityEngine.Scripting.Preserve]
        public void setText(string elementId, string text)
        {
            var go = UiBindingLookup.Find(elementId);
            if (go == null) { Warn(elementId, "setText"); return; }

            var tmp = go.GetComponentInChildren<TMP_Text>(true);
            if (tmp != null) { tmp.text = text; return; }

            var ugui = go.GetComponentInChildren<Text>(true);
            if (ugui != null) { ugui.text = text; return; }

            Warn(elementId, "setText (no text component found)");
        }

        // ─────────────────────────────────────
        // ui.setVisibility(id, isVisible)
        // ─────────────────────────────────────
        [UnityEngine.Scripting.Preserve]
        public void setVisibility(string elementId, bool isVisible)
        {
            var go = UiBindingLookup.Find(elementId);
            if (go == null) { Warn(elementId, "setVisibility"); return; }
            go.SetActive(isVisible);
        }

        // ─────────────────────────────────────
        // ui.setColor(id, hexColor)
        // ─────────────────────────────────────
        [UnityEngine.Scripting.Preserve]
        public void setColor(string elementId, string hexColor)
        {
            var go = UiBindingLookup.Find(elementId);
            if (go == null) { Warn(elementId, "setColor"); return; }

            if (!ColorUtility.TryParseHtmlString(hexColor, out var color))
            {
                Debug.LogWarning($"[Arsist] ui.setColor: invalid color '{hexColor}'");
                return;
            }

            var tmp = go.GetComponentInChildren<TMP_Text>(true);
            if (tmp != null) { tmp.color = color; return; }

            var graphic = go.GetComponentInChildren<Graphic>(true);
            if (graphic != null) { graphic.color = color; return; }
        }

        // ─────────────────────────────────────
        // ui.setAlpha(id, alpha)
        // ─────────────────────────────────────
        [UnityEngine.Scripting.Preserve]
        public void setAlpha(string elementId, float alpha)
        {
            var go = UiBindingLookup.Find(elementId);
            if (go == null) { Warn(elementId, "setAlpha"); return; }

            var cg = go.GetComponent<CanvasGroup>();
            if (cg != null) { cg.alpha = alpha; return; }

            var graphic = go.GetComponentInChildren<Graphic>(true);
            if (graphic != null)
            {
                var c = graphic.color;
                c.a = alpha;
                graphic.color = c;
            }
        }

        // ─────────────────────────────────────
        // ui.setText3D(id, text)  — TextMeshPro (3D世界空間)
        // ─────────────────────────────────────
        [UnityEngine.Scripting.Preserve]
        public void setText3D(string elementId, string text)
        {
            var go = UiBindingLookup.Find(elementId);
            if (go == null) { Warn(elementId, "setText3D"); return; }

            var tmp3d = go.GetComponentInChildren<TextMeshPro>(true);
            if (tmp3d != null) { tmp3d.text = text; return; }

            // 3D が見つからなければ uGUI にフォールバック
            setText(elementId, text);
        }

        private static void Warn(string id, string op) =>
            Debug.LogWarning($"[Arsist] ui.{op}: bindingId '{id}' not found. Check that UI element is active in scene.");
    }
}
